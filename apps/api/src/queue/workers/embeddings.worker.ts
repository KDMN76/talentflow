/**
 * Embeddings worker — Slice 4 (AI matching).
 *
 * Pipeline:
 *   1. Load entiteit (candidate of job) via RLS-veilige tenant-context
 *   2. Bouw embedding-tekst via buildCandidateEmbeddingText / buildJobEmbeddingText
 *   3. Vraag OpenAI text-embedding-3-small (of mock in dev)
 *   4. UPDATE candidates/jobs SET embedding = $1::vector, embedding_updated_at = now()
 *
 * Geen status-tabel: `embedding_updated_at IS NULL` betekent "nog niet
 * geïndexeerd" — UI kan dat netjes weergeven. Failures triggeren BullMQ
 * retry (3 attempts, exponential backoff).
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { PoolClient } from 'pg';
import { pool } from '../../db/pool';
import { logger } from '../../middleware/errorHandler';
import {
  generateEmbedding,
  formatVectorLiteral,
  buildCandidateEmbeddingText,
  buildJobEmbeddingText,
  type CandidateForEmbedding,
  type JobForEmbedding,
} from '../../lib/embeddings';

// ─────────────────────────────────────────────────────────────────────────────
// Job contract
// ─────────────────────────────────────────────────────────────────────────────

export interface EmbeddingsJobData {
  tenantId: string;
  entityType: 'candidate' | 'job';
  entityId: string;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─────────────────────────────────────────────────────────────────────────────
// RLS helper (worker-lokaal — vermijdt import-cycle met candidates.service)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Optionele kolom-detectie voor jobs (required_skills / nice_to_have_skills
// bestaan nog niet in 001_init.sql — defensief fallback). We cachen de
// kolomset per worker-process.
// ─────────────────────────────────────────────────────────────────────────────

interface JobOptionalCols {
  required_skills: boolean;
  nice_to_have_skills: boolean;
}

let jobColsCache: JobOptionalCols | null = null;

async function ensureJobColsKnown(client: PoolClient): Promise<JobOptionalCols> {
  if (jobColsCache) return jobColsCache;
  const { rows } = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'jobs'
       AND column_name IN ('required_skills', 'nice_to_have_skills')`
  );
  const set = new Set(rows.map((r) => r.column_name));
  jobColsCache = {
    required_skills: set.has('required_skills'),
    nice_to_have_skills: set.has('nice_to_have_skills'),
  };
  return jobColsCache;
}

// ─────────────────────────────────────────────────────────────────────────────
// Loaders
// ─────────────────────────────────────────────────────────────────────────────

async function loadCandidate(
  client: PoolClient,
  candidateId: string,
  tenantId: string
): Promise<CandidateForEmbedding | null> {
  // ai_summary leeft op candidate_resumes (primary CV). We mergen die in.
  const { rows } = await client.query(
    `SELECT c.name, c.first_name, c.last_name, c.current_position,
            c.current_company, c.description, c.skills, c.languages,
            c.years_of_experience, c.industry, c.current_department,
            c.address_city, c.address_country, c.diploma, c.university,
            (
              SELECT cr.ai_summary
              FROM candidate_resumes cr
              WHERE cr.candidate_id = c.id
                AND cr.tenant_id = c.tenant_id
                AND cr.ai_summary IS NOT NULL
              ORDER BY cr.is_primary DESC, cr.parsed_at DESC NULLS LAST,
                       cr.created_at DESC
              LIMIT 1
            ) AS ai_summary
     FROM candidates c
     WHERE c.id = $1 AND c.tenant_id = $2 AND c.deleted_at IS NULL`,
    [candidateId, tenantId]
  );
  return (rows[0] as CandidateForEmbedding | undefined) ?? null;
}

async function loadJob(
  client: PoolClient,
  jobId: string,
  tenantId: string
): Promise<JobForEmbedding | null> {
  const cols = await ensureJobColsKnown(client);

  const selects = [
    'title',
    'description',
    'location',
    'employment_type',
    'department',
  ];
  if (cols.required_skills) selects.push('required_skills');
  if (cols.nice_to_have_skills) selects.push('nice_to_have_skills');

  const { rows } = await client.query(
    `SELECT ${selects.join(', ')}
     FROM jobs
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [jobId, tenantId]
  );
  return (rows[0] as JobForEmbedding | undefined) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persisters
// ─────────────────────────────────────────────────────────────────────────────

async function persistEmbedding(
  client: PoolClient,
  table: 'candidates' | 'jobs',
  entityId: string,
  tenantId: string,
  vectorLiteral: string
): Promise<void> {
  await client.query(
    `UPDATE ${table}
     SET embedding = $1::vector,
         embedding_updated_at = now()
     WHERE id = $2 AND tenant_id = $3`,
    [vectorLiteral, entityId, tenantId]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Job processor
// ─────────────────────────────────────────────────────────────────────────────

async function processEmbeddingJob(job: Job<EmbeddingsJobData>): Promise<void> {
  const { tenantId, entityType, entityId } = job.data;

  if (!tenantId || !entityType || !entityId) {
    logger.error('[embeddings] invalide job-payload — drop', {
      jobId: job.id,
      data: job.data,
    });
    return;
  }
  if (entityType !== 'candidate' && entityType !== 'job') {
    logger.error('[embeddings] onbekend entityType — drop', {
      jobId: job.id,
      entityType,
    });
    return;
  }

  logger.info('[embeddings] start', {
    jobId: job.id,
    entityType,
    entityId,
  });

  // 1) Load entiteit + bouw tekst (in transactie, RLS-veilig)
  const text = await withTenantTx(tenantId, async (client) => {
    if (entityType === 'candidate') {
      const candidate = await loadCandidate(client, entityId, tenantId);
      if (!candidate) {
        logger.warn('[embeddings] candidate niet gevonden — skip', {
          tenantId,
          entityId,
        });
        return null;
      }
      return buildCandidateEmbeddingText(candidate);
    }
    const jobRow = await loadJob(client, entityId, tenantId);
    if (!jobRow) {
      logger.warn('[embeddings] job niet gevonden — skip', { tenantId, entityId });
      return null;
    }
    return buildJobEmbeddingText(jobRow);
  });

  if (!text) return; // entity niet (meer) gevonden

  if (text.trim().length === 0) {
    logger.warn('[embeddings] embedding-tekst leeg — skip', {
      tenantId,
      entityType,
      entityId,
    });
    return;
  }

  // 2) Genereer embedding (buiten transactie — kan lang duren / falen).
  //    auditMeta laat de embeddings-lib een ai_events-rij schrijven zodat
  //    elke inference voor compliance traceerbaar is.
  const result = await generateEmbedding(text, {
    tenantId,
    entityType,
    entityId,
  });
  const literal = formatVectorLiteral(result.embedding);

  // 3) Persist in een nieuwe RLS-transactie
  await withTenantTx(tenantId, async (client) => {
    await persistEmbedding(
      client,
      entityType === 'candidate' ? 'candidates' : 'jobs',
      entityId,
      tenantId,
      literal
    );
  });

  logger.info('[embeddings] done', {
    jobId: job.id,
    entityType,
    entityId,
    model: result.model,
    mocked: result.mocked === true,
    text_length: text.length,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker setup
// ─────────────────────────────────────────────────────────────────────────────

// DISABLE_INLINE_WORKERS guard — zie resumeParser.worker.ts voor details.
const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let embeddingsWorker: Worker<EmbeddingsJobData> | null = null;

if (!shouldStartWorker) {
  logger.info(
    '[embeddings] inline worker disabled (DISABLE_INLINE_WORKERS=true)'
  );
} else {
  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  if (!process.env.OPENAI_API_KEY) {
    logger.warn(
      '[embeddings] OPENAI_API_KEY ontbreekt — worker draait met deterministic mock-embeddings. ' +
        'Configureer de key vóór productie.'
    );
  }

  embeddingsWorker = new Worker<EmbeddingsJobData>(
    'embeddings',
    processEmbeddingJob,
    { connection }
  );

  embeddingsWorker.on('completed', (job) => {
    logger.info('[embeddings] Job completed', { jobId: job.id });
  });

  embeddingsWorker.on('failed', (job, err) => {
    logger.error('[embeddings] Job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });
}

export { embeddingsWorker };
