/**
 * CSV import worker — Sprint Q1.2.
 *
 * Pipeline:
 *   1) status='parsing' → laad CSV bytes uit storage, parse
 *   2) status='importing' → loop in batches van 100. Per row:
 *        - vereist email (skip met error_log indien missing en mapping zegt email)
 *        - dedup-check op email; bestaat al → skipped_count++
 *        - INSERT INTO candidates met mapped fields
 *      Update processed/imported/skipped counts elke 100 rows.
 *   3) status='done' / 'failed' + completed_at + audit-row.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { PoolClient } from 'pg';
import { pool } from '../../db/pool';
import { logger } from '../../middleware/errorHandler';
import { getStorage } from '../../lib/storage';
import { parseCsv } from '../../modules/candidates/bulkImport.service';
import { logAudit } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';

interface CsvImportJobData {
  tenantId: string;
  userId: string;
  importId: string;
  storageKey: string;
}

interface CsvImportRow {
  id: string;
  tenant_id: string;
  user_id: string;
  storage_key: string | null;
  mapping: Record<string, string>;
  status: string;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BATCH_SIZE = 100;

const CANDIDATE_COLUMNS_ALLOWED = new Set([
  'name',
  'first_name',
  'last_name',
  'email',
  'phone',
  'candidate_reference',
  'current_position',
  'current_company',
  'industry',
  'description',
  'source',
  'address_city',
  'address_country',
  'years_of_experience',
  'tags',
  'notes',
  'skills',
]);

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

async function withTenantTx<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (!UUID_REGEX.test(tenantId)) {
    throw new Error('Invalid tenant_id format');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function loadImport(tenantId: string, importId: string): Promise<CsvImportRow | null> {
  return withTenantTx(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, tenant_id, user_id, storage_key, mapping, status
       FROM csv_imports
       WHERE id = $1 AND tenant_id = $2`,
      [importId, tenantId]
    );
    return (rows[0] as CsvImportRow | undefined) ?? null;
  });
}

async function setStatus(
  tenantId: string,
  importId: string,
  status: 'parsing' | 'importing' | 'done' | 'failed',
  patch: Partial<{
    total_rows: number;
    processed_rows: number;
    imported_count: number;
    skipped_count: number;
    error_count: number;
    errors: Array<{ row_idx: number; message: string }>;
    completed_at: Date | null;
  }> = {}
): Promise<void> {
  await withTenantTx(tenantId, async (client) => {
    const sets: string[] = [`status = $1`];
    const values: unknown[] = [status];
    let idx = 2;

    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (key === 'errors') {
        sets.push(`errors = $${idx++}::jsonb`);
        values.push(JSON.stringify(value));
      } else {
        sets.push(`${key} = $${idx++}`);
        values.push(value);
      }
    }

    if (status === 'done' || status === 'failed') {
      sets.push(`completed_at = COALESCE(completed_at, now())`);
    }

    values.push(importId, tenantId);
    await client.query(
      `UPDATE csv_imports SET ${sets.join(', ')}
       WHERE id = $${idx++} AND tenant_id = $${idx}`,
      values
    );
  });
}

function rowToCandidatePayload(
  row: Record<string, string>,
  mapping: Record<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [csvCol, candidateField] of Object.entries(mapping)) {
    if (!CANDIDATE_COLUMNS_ALLOWED.has(candidateField)) continue;
    const raw = (row[csvCol] ?? '').trim();
    if (!raw) continue;

    if (candidateField === 'years_of_experience') {
      const n = Number(raw);
      if (!Number.isNaN(n)) out[candidateField] = n;
      continue;
    }
    if (
      candidateField === 'skills' ||
      candidateField === 'tags'
    ) {
      out[candidateField] = raw
        .split(/[,;|]/)
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }
    out[candidateField] = raw;
  }

  // Sync name when only first/last given
  if (!out.name && (out.first_name || out.last_name)) {
    out.name = `${out.first_name ?? ''} ${out.last_name ?? ''}`.trim();
  }
  return out;
}

async function processCsvImportJob(job: Job<CsvImportJobData>): Promise<void> {
  const { tenantId, userId, importId, storageKey } = job.data;

  if (!tenantId || !importId || !storageKey) {
    logger.error('[csvImport] invalid payload — drop', { jobId: job.id, data: job.data });
    return;
  }

  logger.info('[csvImport] start', { jobId: job.id, importId });

  const importRow = await loadImport(tenantId, importId);
  if (!importRow) {
    logger.warn('[csvImport] import row missing — drop', { tenantId, importId });
    return;
  }

  await setStatus(tenantId, importId, 'parsing');

  let buffer: Buffer;
  try {
    const storage = getStorage();
    const stream = await storage.getStream(storageKey);
    buffer = await streamToBuffer(stream);
  } catch (err) {
    await setStatus(tenantId, importId, 'failed', {
      errors: [{ row_idx: -1, message: `Kon CSV niet lezen: ${(err as Error).message}` }],
    });
    return;
  }

  const { rows } = parseCsv(buffer);
  await setStatus(tenantId, importId, 'importing', {
    total_rows: rows.length,
    processed_rows: 0,
    imported_count: 0,
    skipped_count: 0,
    error_count: 0,
  });

  const errors: Array<{ row_idx: number; message: string }> = [];
  let imported = 0;
  let skipped = 0;
  let errored = 0;

  // Process in batches — every BATCH_SIZE rows commit + checkpoint progress.
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const slice = rows.slice(i, i + BATCH_SIZE);
    const sliceStart = i;

    try {
      await withTenantTx(tenantId, async (client) => {
        for (let j = 0; j < slice.length; j++) {
          const rowIdx = sliceStart + j;
          const payload = rowToCandidatePayload(slice[j], importRow.mapping);

          if (!payload.name && !payload.first_name && !payload.last_name) {
            errors.push({ row_idx: rowIdx, message: 'Geen naam-veld aanwezig' });
            errored++;
            continue;
          }

          // Email-dedup
          if (payload.email && typeof payload.email === 'string') {
            const { rows: dups } = await client.query(
              `SELECT id FROM candidates
               WHERE tenant_id = $1 AND deleted_at IS NULL AND lower(email) = lower($2)`,
              [tenantId, payload.email]
            );
            if (dups.length > 0) {
              skipped++;
              continue;
            }
          }

          // Build INSERT
          const cols = ['tenant_id', ...Object.keys(payload)];
          const placeholders = cols.map((_, idx) => `$${idx + 1}`);
          const values = [tenantId, ...Object.values(payload)];

          try {
            await client.query(
              `INSERT INTO candidates (${cols.join(', ')})
               VALUES (${placeholders.join(', ')})`,
              values
            );
            imported++;
          } catch (err: unknown) {
            const msg = (err as Error).message;
            errors.push({ row_idx: rowIdx, message: msg });
            errored++;
          }
        }
      });
    } catch (err) {
      // Hele batch faalde — markeer alle slice-rows als errored.
      for (let j = 0; j < slice.length; j++) {
        errors.push({
          row_idx: sliceStart + j,
          message: `Batch-fout: ${(err as Error).message}`,
        });
      }
      errored += slice.length;
    }

    await setStatus(tenantId, importId, 'importing', {
      processed_rows: Math.min(i + BATCH_SIZE, rows.length),
      imported_count: imported,
      skipped_count: skipped,
      error_count: errored,
      errors: errors.slice(0, 200), // cap stored errors
    });
  }

  await setStatus(tenantId, importId, errored > 0 && imported === 0 ? 'failed' : 'done', {
    processed_rows: rows.length,
    imported_count: imported,
    skipped_count: skipped,
    error_count: errored,
    errors: errors.slice(0, 200),
  });

  // Audit final result
  await withTenantTx(tenantId, async (client) => {
    await logAudit(client, tenantId, {
      action:
        errored > 0 && imported === 0
          ? AuditActions.CSV_IMPORT_FAILED
          : AuditActions.CSV_IMPORT_COMPLETED,
      entityType: 'csv_import',
      entityId: importId,
      after: { imported, skipped, errored, total: rows.length },
      userId,
    });
  });

  logger.info('[csvImport] done', { jobId: job.id, importId, imported, skipped, errored });
}

// DISABLE_INLINE_WORKERS guard — zie resumeParser.worker.ts voor details.
const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let csvImportWorker: Worker<CsvImportJobData> | null = null;

if (!shouldStartWorker) {
  logger.info(
    '[csvImport] inline worker disabled (DISABLE_INLINE_WORKERS=true)'
  );
} else {
  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  csvImportWorker = new Worker<CsvImportJobData>(
    'csv-import',
    processCsvImportJob,
    { connection }
  );

  csvImportWorker.on('completed', (job) => {
    logger.info('[csvImport] Job completed', { jobId: job.id });
  });

  csvImportWorker.on('failed', (job, err) => {
    logger.error('[csvImport] Job failed', { jobId: job?.id, error: err.message });
  });
}

export { csvImportWorker };
