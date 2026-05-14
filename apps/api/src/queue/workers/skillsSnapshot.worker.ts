/**
 * Skills-snapshot worker — Sprint Q3.6 (Agent HHH).
 *
 * Repeatable cron `0 1 * * 1` (elke maandag 01:00 UTC).
 *
 * Per tenant met candidates+jobs:
 *   1. Bereken voor elke ESCO-skill die gemapt is op kandidaten OF op open jobs
 *      drie tellers voor de afgelopen ISO-week:
 *        - candidate_count: kandidaten met die skill
 *        - job_demand:      open jobs die die skill vragen (required OR nice-to-have)
 *        - hire_count:      hires (applications.status='hired') deze week op
 *                            jobs die die skill vroegen.
 *   2. INSERT in skills_trending_snapshots met UNIQUE(tenant, esco_skill, week)
 *      → re-runs voor dezelfde week zijn idempotent.
 *
 * Plus een lichtgewicht on-demand variant `enqueueSkillsRefresh` die door
 * candidate/job CRUD-flows aangeroepen kan worden om mappings opnieuw op te
 * bouwen na grote wijzigingen.
 *
 * Threshold-keuzes:
 *   - Cron 01:00 UTC maandag: na de week-rollover, voor het werkrooster, en
 *     in een laag-traffic uur zodat we de hele tenant-set in serie kunnen doen.
 *   - We schrijven snapshot voor ELKE skill met >0 totaal (candidate_count
 *     of job_demand) — gefilterd zodat we niet voor alle 300 ESCO-skills
 *     elke week een rij dumpen voor lege tenants.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { Pool, PoolClient } from 'pg';
import { logger } from '../../middleware/errorHandler';
import { skillsSnapshotQueue, skillsRefreshQueue } from '../queues';
import {
  syncCandidateSkillsToEsco,
  syncJobSkillsToEsco,
} from '../../modules/skills/skills.service';

// ────────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const SNAPSHOT_CRON =
  process.env.SKILLS_SNAPSHOT_CRON ?? '0 1 * * 1'; // ma 01:00
const REPEATABLE_JOB_ID = 'skills-snapshot:weekly';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cross-tenant scan — admin-pool zonder app.tenant_id setting voor de tenant-
// discovery. Per-tenant aggregates draaien in een transactie met SET LOCAL.
const adminPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  idleTimeoutMillis: 30_000,
});
adminPool.on('error', (err) => {
  logger.error('[skillsSnapshot] adminPool error', { error: err.message });
});

async function withTenantTx<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (!UUID_REGEX.test(tenantId)) {
    throw new Error('Invalid tenant_id format');
  }
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Schedule
// ────────────────────────────────────────────────────────────────────────────

export async function ensureSkillsSnapshotScheduled(): Promise<void> {
  try {
    await skillsSnapshotQueue.add(
      REPEATABLE_JOB_ID,
      { source: 'cron' },
      { repeat: { pattern: SNAPSHOT_CRON }, jobId: REPEATABLE_JOB_ID }
    );
    logger.info('[skillsSnapshot] schedule registered', { cron: SNAPSHOT_CRON });
  } catch (err) {
    logger.error('[skillsSnapshot] failed to register schedule', {
      error: (err as Error).message,
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * ISO week start (maandag 00:00 UTC) van een gegeven datum.
 * Geëxporteerd voor unit-tests.
 */
export function isoWeekStarting(d: Date = new Date()): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay(); // 0=zon, 1=maa, ..., 6=zat
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  x.setUTCDate(x.getUTCDate() + offsetToMonday);
  return x;
}

interface TenantRow {
  id: string;
}

async function findTenantsWithSkillData(): Promise<TenantRow[]> {
  // Tenants met EITHER candidates EITHER jobs.
  const { rows } = await adminPool.query<TenantRow>(
    `SELECT DISTINCT id FROM (
       SELECT tenant_id AS id FROM candidates WHERE deleted_at IS NULL
       UNION
       SELECT tenant_id AS id FROM jobs       WHERE deleted_at IS NULL
     ) t
     ORDER BY id`
  );
  return rows;
}

// ────────────────────────────────────────────────────────────────────────────
// Per-tenant snapshot
// ────────────────────────────────────────────────────────────────────────────

export interface TenantSnapshotResult {
  tenant_id: string;
  skills_snapshotted: number;
  errors: number;
}

export async function snapshotTenantSkills(
  tenantId: string,
  weekStarting: Date
): Promise<TenantSnapshotResult> {
  const out: TenantSnapshotResult = {
    tenant_id: tenantId,
    skills_snapshotted: 0,
    errors: 0,
  };

  const weekStartIso = weekStarting.toISOString().slice(0, 10);

  try {
    await withTenantTx(tenantId, async (client) => {
      // Eén query bouwt het hele aggregate via UNION + GROUP BY. Filter in
      // de outer-WHERE op (cnt+demand+hires) > 0 zodat lege rijen niet
      // weggeschreven worden.
      const { rowCount } = await client.query(
        `WITH skill_universe AS (
           SELECT esco_skill_id FROM candidate_skill_mappings
           UNION
           SELECT esco_skill_id FROM job_skill_mappings
         ),
         cand_counts AS (
           SELECT esco_skill_id, COUNT(DISTINCT candidate_id)::int AS c_count
             FROM candidate_skill_mappings
            GROUP BY esco_skill_id
         ),
         job_counts AS (
           SELECT m.esco_skill_id, COUNT(DISTINCT m.job_id)::int AS j_count
             FROM job_skill_mappings m
             JOIN jobs j ON j.id = m.job_id
            WHERE j.deleted_at IS NULL
              AND j.status = 'open'
            GROUP BY m.esco_skill_id
         ),
         hire_counts AS (
           SELECT m.esco_skill_id, COUNT(DISTINCT a.id)::int AS h_count
             FROM job_skill_mappings m
             JOIN applications a ON a.job_id = m.job_id
            WHERE a.status = 'hired'
              AND a.updated_at >= $2::date
              AND a.updated_at <  $2::date + INTERVAL '7 days'
            GROUP BY m.esco_skill_id
         )
         INSERT INTO skills_trending_snapshots
           (tenant_id, esco_skill_id, week_starting,
            candidate_count, job_demand, hire_count)
         SELECT current_setting('app.tenant_id', true)::uuid,
                u.esco_skill_id,
                $2::date,
                COALESCE(cc.c_count, 0),
                COALESCE(jc.j_count, 0),
                COALESCE(hc.h_count, 0)
           FROM skill_universe u
           LEFT JOIN cand_counts cc ON cc.esco_skill_id = u.esco_skill_id
           LEFT JOIN job_counts  jc ON jc.esco_skill_id = u.esco_skill_id
           LEFT JOIN hire_counts hc ON hc.esco_skill_id = u.esco_skill_id
          WHERE COALESCE(cc.c_count, 0)
              + COALESCE(jc.j_count, 0)
              + COALESCE(hc.h_count, 0) > 0
         ON CONFLICT (tenant_id, esco_skill_id, week_starting) DO UPDATE
           SET candidate_count = EXCLUDED.candidate_count,
               job_demand      = EXCLUDED.job_demand,
               hire_count      = EXCLUDED.hire_count`,
        [tenantId, weekStartIso]
      );
      out.skills_snapshotted = rowCount ?? 0;
    });
  } catch (err) {
    out.errors++;
    logger.error('[skillsSnapshot] tenant snapshot faalde', {
      tenantId,
      error: (err as Error).message,
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Top-level processor: weekly snapshot voor alle tenants
// ────────────────────────────────────────────────────────────────────────────

export interface SkillsSnapshotResult {
  started_at: string;
  ended_at: string;
  elapsed_ms: number;
  tenants_processed: number;
  total_skills_snapshotted: number;
  errors: number;
}

export async function processSkillsSnapshotJob(
  _job: Job
): Promise<SkillsSnapshotResult> {
  const startedAt = new Date();
  const result: SkillsSnapshotResult = {
    started_at: startedAt.toISOString(),
    ended_at: '',
    elapsed_ms: 0,
    tenants_processed: 0,
    total_skills_snapshotted: 0,
    errors: 0,
  };

  const weekStart = isoWeekStarting(startedAt);

  let tenants: TenantRow[];
  try {
    tenants = await findTenantsWithSkillData();
  } catch (err) {
    result.errors++;
    logger.error('[skillsSnapshot] failed to load tenants', {
      error: (err as Error).message,
    });
    result.ended_at = new Date().toISOString();
    result.elapsed_ms = Date.now() - startedAt.getTime();
    return result;
  }

  for (const t of tenants) {
    const r = await snapshotTenantSkills(t.id, weekStart);
    result.tenants_processed++;
    result.total_skills_snapshotted += r.skills_snapshotted;
    result.errors += r.errors;
    // Yield kort tussen tenants — voorkomt connection-storm op de DB-pool.
    await new Promise((res) => setTimeout(res, 50));
  }

  result.ended_at = new Date().toISOString();
  result.elapsed_ms = Date.now() - startedAt.getTime();
  logger.info('[skillsSnapshot] weekly run finished', result);
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// On-demand refresh (lichte job: re-sync mappings voor één entiteit)
// ────────────────────────────────────────────────────────────────────────────

export interface SkillsRefreshJobData {
  tenantId: string;
  entity: 'candidate' | 'job';
  entityId: string;
}

export async function enqueueSkillsRefresh(
  data: SkillsRefreshJobData
): Promise<void> {
  if (!UUID_REGEX.test(data.tenantId) || !UUID_REGEX.test(data.entityId)) {
    return;
  }
  try {
    await skillsRefreshQueue.add('refresh-mappings', data, {
      removeOnComplete: 50,
      removeOnFail: 100,
    });
  } catch (err) {
    logger.warn('[skillsSnapshot] enqueueSkillsRefresh failed', {
      error: (err as Error).message,
      data,
    });
  }
}

export async function processSkillsRefreshJob(
  job: Job<SkillsRefreshJobData>
): Promise<{ mapped: number; unmapped: number }> {
  const { tenantId, entity, entityId } = job.data;
  if (entity === 'candidate') {
    return syncCandidateSkillsToEsco(tenantId, entityId);
  }
  return syncJobSkillsToEsco(tenantId, entityId);
}

// ────────────────────────────────────────────────────────────────────────────
// Worker setup
// ────────────────────────────────────────────────────────────────────────────

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let snapshotWorker: Worker | null = null;
let refreshWorker: Worker | null = null;

if (!shouldStartWorker) {
  logger.info(
    '[skillsSnapshot] inline worker disabled (DISABLE_INLINE_WORKERS=true)'
  );
} else {
  const conn = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  snapshotWorker = new Worker('skills-snapshot', processSkillsSnapshotJob, {
    connection: conn,
  });
  snapshotWorker.on('completed', (j) =>
    logger.info('[skillsSnapshot] job completed', { jobId: j.id })
  );
  snapshotWorker.on('failed', (j, err) =>
    logger.error('[skillsSnapshot] job failed', {
      jobId: j?.id,
      error: err.message,
    })
  );

  refreshWorker = new Worker('skills-refresh', processSkillsRefreshJob, {
    connection: conn,
  });
  refreshWorker.on('failed', (j, err) =>
    logger.error('[skillsRefresh] job failed', {
      jobId: j?.id,
      error: err.message,
    })
  );

  void ensureSkillsSnapshotScheduled();
}

export { snapshotWorker, refreshWorker };
