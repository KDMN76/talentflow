/**
 * CSV bulk-import service voor kandidaten.
 *
 * Twee fases:
 *   1) previewCsv  — synchroon. Parseert het bestand, returned 10-row sample,
 *                    detected columns + suggested mapping + dup-prediction.
 *   2) startCsvImport — schrijft een `csv_imports` rij (status='pending'),
 *                       slaat de CSV op via storage-driver, queued een
 *                       BullMQ job. Worker neemt het over.
 *
 * Geen externe `csv-parse` dep — we hebben een volwaardige RFC-4180-achtige
 * mini-parser ingebouwd. Behandelt: quoted fields, escaped quotes ("" → "),
 * embedded newlines binnen quotes, CRLF/LF line endings, BOM.
 */

import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type CsvImportStatus =
  | 'pending'
  | 'parsing'
  | 'importing'
  | 'done'
  | 'failed';

export interface CsvImportError {
  row_idx: number;
  message: string;
}

export interface CsvImport {
  id: string;
  tenant_id: string;
  user_id: string;
  entity_type: 'candidate' | 'job';
  filename: string;
  total_rows: number;
  processed_rows: number;
  imported_count: number;
  skipped_count: number;
  error_count: number;
  status: CsvImportStatus;
  errors: CsvImportError[];
  mapping: Record<string, string>;
  storage_key: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface CsvImportPreview {
  total_rows: number;
  sample: Array<Record<string, string>>;
  detected_columns: string[];
  suggested_mapping: Record<string, string>;
  duplicates_predicted: number;
}

// ────────────────────────────────────────────────────────────────────────────
// CSV parser — RFC-4180-style
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse a CSV buffer into an array of {column → value} records.
 * First row is treated as header.
 */
export function parseCsv(buffer: Buffer): {
  headers: string[];
  rows: Array<Record<string, string>>;
} {
  let text = buffer.toString('utf-8');
  // Strip BOM if present
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      row.push(field);
      records.push(row);
      row = [];
      field = '';
      // swallow \r\n pair
      if (ch === '\r' && i + 1 < len && text[i + 1] === '\n') i += 2;
      else i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush trailing field/row (if no terminating newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  if (records.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = records[0].map((h) => h.trim());
  const rows: Array<Record<string, string>> = [];
  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    // Skip wholly empty rows (single empty field after blank line)
    if (rec.length === 1 && rec[0] === '') continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (rec[c] ?? '').trim();
    }
    rows.push(obj);
  }
  return { headers, rows };
}

// ────────────────────────────────────────────────────────────────────────────
// Mapping heuristics
// ────────────────────────────────────────────────────────────────────────────

/**
 * Guess CSV-column → candidate-field mapping from the header set.
 * Returns mapping keyed by *CSV column name*.
 */
export function suggestMapping(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) {
    const k = h.toLowerCase().replace(/[\s_-]+/g, '');
    const mapped = HEURISTIC_MAP[k];
    if (mapped) out[h] = mapped;
  }
  return out;
}

const HEURISTIC_MAP: Record<string, string> = {
  name: 'name',
  fullname: 'name',
  candidatename: 'name',
  firstname: 'first_name',
  voornaam: 'first_name',
  lastname: 'last_name',
  achternaam: 'last_name',
  surname: 'last_name',
  email: 'email',
  emailaddress: 'email',
  emailadres: 'email',
  phone: 'phone',
  telephone: 'phone',
  telefoon: 'phone',
  mobile: 'phone',
  reference: 'candidate_reference',
  candidatereference: 'candidate_reference',
  reference_id: 'candidate_reference',
  jobtitle: 'current_position',
  position: 'current_position',
  currentposition: 'current_position',
  title: 'current_position',
  company: 'current_company',
  currentcompany: 'current_company',
  employer: 'current_company',
  city: 'address_city',
  woonplaats: 'address_city',
  country: 'address_country',
  land: 'address_country',
  source: 'source',
  bron: 'source',
  industry: 'industry',
  branche: 'industry',
  description: 'description',
  bio: 'description',
  notes: 'notes',
  notities: 'notes',
  yearsofexperience: 'years_of_experience',
  ervaring: 'years_of_experience',
  skills: 'skills',
  vaardigheden: 'skills',
  tags: 'tags',
};

// ────────────────────────────────────────────────────────────────────────────
// Preview
// ────────────────────────────────────────────────────────────────────────────

export async function previewCsv(
  tenantId: string,
  csvBuffer: Buffer
): Promise<CsvImportPreview> {
  const { headers, rows } = parseCsv(csvBuffer);
  if (headers.length === 0) {
    throw new AppError(400, 'EMPTY_CSV', 'CSV-bestand bevat geen kolommen');
  }

  const sample = rows.slice(0, 10);
  const suggested = suggestMapping(headers);

  // Voorspel duplicates op basis van bestaande email-collisions.
  const emailColumn = Object.entries(suggested).find(([, v]) => v === 'email')?.[0];
  let duplicatesPredicted = 0;

  if (emailColumn) {
    const emails = rows
      .map((r) => (r[emailColumn] ?? '').trim().toLowerCase())
      .filter((e) => e.length > 0);

    if (emails.length > 0) {
      duplicatesPredicted = await withTenant(tenantId, async (client) => {
        const { rows: dupRows } = await client.query(
          `SELECT lower(email) AS email
           FROM candidates
           WHERE tenant_id = $1 AND deleted_at IS NULL
             AND lower(email) = ANY($2::text[])`,
          [tenantId, emails]
        );
        return dupRows.length;
      });
    }
  }

  return {
    total_rows: rows.length,
    sample,
    detected_columns: headers,
    suggested_mapping: suggested,
    duplicates_predicted: duplicatesPredicted,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Start import
// ────────────────────────────────────────────────────────────────────────────

export async function startCsvImport(
  tenantId: string,
  userId: string,
  csvBuffer: Buffer,
  filename: string,
  mapping: Record<string, string>,
  ctx: AuditContext = {}
): Promise<{ import_id: string }> {
  const { rows } = parseCsv(csvBuffer);
  const totalRows = rows.length;

  // Persist the CSV bytes so the worker can re-read without re-uploading.
  // We use the existing storage abstraction; bytes land under
  // tenants/<id>/csv-imports/<uuid>.csv.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getStorage } = require('../../lib/storage') as typeof import('../../lib/storage');

  return withTenant(tenantId, async (client) => {
    const { rows: ins } = await client.query(
      `INSERT INTO csv_imports
         (tenant_id, user_id, entity_type, filename, total_rows, status, mapping)
       VALUES ($1, $2, 'candidate', $3, $4, 'pending', $5::jsonb)
       RETURNING id`,
      [tenantId, userId, filename, totalRows, JSON.stringify(mapping)]
    );
    const importId = (ins[0] as { id: string }).id;

    // Storage write is best-effort: if MinIO is down we still record the
    // import as 'failed' rather than rolling back the row.
    let storageKey: string | null = null;
    try {
      const storage = getStorage();
      storageKey = `tenants/${tenantId}/csv-imports/${importId}.csv`;
      await storage.put(storageKey, csvBuffer, 'text/csv');
      await client.query(
        `UPDATE csv_imports SET storage_key = $1 WHERE id = $2`,
        [storageKey, importId]
      );
    } catch (err) {
      await client.query(
        `UPDATE csv_imports
         SET status = 'failed',
             errors = jsonb_build_array(jsonb_build_object('row_idx', -1, 'message', $1)),
             completed_at = now()
         WHERE id = $2`,
        [`Storage write failed: ${(err as Error).message}`, importId]
      );
      throw new AppError(
        500,
        'STORAGE_WRITE_FAILED',
        `Kon CSV niet opslaan: ${(err as Error).message}`
      );
    }

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.CSV_IMPORT_STARTED,
        entityType: 'csv_import',
        entityId: importId,
        after: { filename, total_rows: totalRows, mapping_keys: Object.keys(mapping) },
        userId,
      },
      ctx
    );

    // Queue the worker. Lazy require to avoid circular import-cycles in tests.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { csvImportQueue } = require('../../queue/queues') as typeof import('../../queue/queues');
      await csvImportQueue.add('import-candidates', {
        tenantId,
        userId,
        importId,
        storageKey,
      });
    } catch (err) {
      // Non-fatal: row exists with status='pending'. Operator can re-queue.
      // eslint-disable-next-line no-console
      console.warn('[bulkImport] Failed to queue worker', { error: (err as Error).message });
    }

    return { import_id: importId };
  });
}

export async function getImportStatus(
  tenantId: string,
  importId: string
): Promise<CsvImport> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM csv_imports WHERE id = $1 AND tenant_id = $2`,
      [importId, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'CSV_IMPORT_NOT_FOUND', 'CSV-import niet gevonden');
    }
    return rows[0] as CsvImport;
  });
}
