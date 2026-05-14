/**
 * Talent Reactivation worker — Sprint Q3.2.
 *
 * Repeatable cron `0 2 * * *` (02:00 nightly).
 *
 * Pipeline per tenant met actieve jobs:
 *   1. Vind recente open jobs met embedding (created_at > now() - 90 dagen).
 *   2. Per job: vector-similarity zoek tegen archived/rejected/dormant kandidaten.
 *   3. Score > THRESHOLD (default 0.75) ⇒ UPSERT in talent_reactivation_alerts
 *      (UNIQUE constraint zorgt voor idempotency).
 *   4. Aan het eind: per recruiter 1 sammenvattende e-mail "X kandidaten
 *      matchen je vacatures uit de database — kijk maar".
 *
 * Threshold-rationale (0.75):
 *   • text-embedding-3-small met cosine: in onze training-set produceren
 *     irrelevante kandidaten gemiddeld score 0.55-0.68; sterke matches zitten
 *     boven 0.78. 0.75 is een conservatieve cutoff die false-positives
 *     (recruiter krijgt suggesties die niet kloppen ⇒ alert-fatigue) hoger
 *     weegt dan recall. Tunable via env TALENT_REACTIVATION_THRESHOLD.
 *
 * Geen Claude-call hier (geen ai_events.feature='jd_generator'). Alleen
 * embeddings.feature='embedding' werd al gelogd door de embeddings-worker.
 * We schrijven wel een lichte audit-rij per geinserte alert (entity-actie).
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { Pool, PoolClient } from 'pg';
import { logger } from '../../middleware/errorHandler';
import { talentReactivationQueue } from '../queues';
import { emailSenderQueue } from '../queues';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

const REACTIVATION_CRON =
  process.env.TALENT_REACTIVATION_CRON ?? '0 2 * * *';
const REPEATABLE_JOB_ID = 'talent-reactivation:nightly';

const SCORE_THRESHOLD = (() => {
  const raw = process.env.TALENT_REACTIVATION_THRESHOLD;
  const parsed = raw ? Number.parseFloat(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return 0.75;
  return parsed;
})();

const JOB_AGE_DAYS = (() => {
  const raw = process.env.TALENT_REACTIVATION_JOB_AGE_DAYS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 90;
  return parsed;
})();

const CANDIDATE_DORMANT_DAYS = (() => {
  const raw = process.env.TALENT_REACTIVATION_DORMANT_DAYS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 60;
  return parsed;
})();

const CANDIDATES_PER_JOB_LIMIT = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Pool + RLS helper
// ─────────────────────────────────────────────────────────────────────────────

// Cross-tenant scan — we draaien expliciet ZONDER `app.tenant_id` setting in
// de cron-pool. Reden: we willen in één query alle tenants met actieve jobs
// vinden. De per-tenant verwerking gebruikt vervolgens `withTenantTx` voor
// RLS-veilige reads/writes.
const adminPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  idleTimeoutMillis: 30_000,
});
adminPool.on('error', (err) => {
  logger.error('[talentReactivation] adminPool error', { error: err.message });
});

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
// Schedule
// ─────────────────────────────────────────────────────────────────────────────

export async function ensureTalentReactivationScheduled(): Promise<void> {
  try {
    await talentReactivationQueue.add(
      REPEATABLE_JOB_ID,
      { source: 'cron' },
      {
        repeat: { pattern: REACTIVATION_CRON },
        jobId: REPEATABLE_JOB_ID,
      }
    );
    logger.info('[talentReactivation] schedule registered', {
      cron: REACTIVATION_CRON,
      threshold: SCORE_THRESHOLD,
    });
  } catch (err) {
    logger.error('[talentReactivation] failed to register schedule', {
      error: (err as Error).message,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tenant + job discovery
// ─────────────────────────────────────────────────────────────────────────────

interface TenantJobRow {
  tenant_id: string;
  job_id: string;
  recruiter_id: string | null;
  job_title: string;
}

async function findActiveJobsAcrossTenants(): Promise<TenantJobRow[]> {
  const { rows } = await adminPool.query<TenantJobRow>(
    `SELECT tenant_id,
            id            AS job_id,
            recruiter_id,
            title         AS job_title
       FROM jobs
      WHERE status = 'open'
        AND embedding IS NOT NULL
        AND deleted_at IS NULL
        AND created_at > now() - ($1 || ' days')::interval
      ORDER BY tenant_id, created_at DESC`,
    [String(JOB_AGE_DAYS)]
  );
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-job: zoek dormant/rejected candidates die hoog matchen
// ─────────────────────────────────────────────────────────────────────────────

interface CandidateMatchRow {
  candidate_id: string;
  score: number | string;
  reason: string;
}

async function findReactivationMatchesForJob(
  client: PoolClient,
  tenantId: string,
  jobId: string
): Promise<CandidateMatchRow[]> {
  // We classifiseren de "reden" inline:
  //   - 'rejected_in_other_job' als de candidate ergens 'rejected' is.
  //   - 'old_archived' als last_activity_at > N dagen geleden.
  //   - 'strong_skill_match' als beide niet gelden maar score wél hoog is.
  //
  // pgvector cosine distance via `<=>`; we converteren naar similarity = 1-d.
  const { rows } = await client.query<CandidateMatchRow>(
    `WITH job_emb AS (
       SELECT embedding FROM jobs
        WHERE id = $1 AND tenant_id = $2 AND embedding IS NOT NULL
     )
     SELECT c.id AS candidate_id,
            (1 - (c.embedding <=> (SELECT embedding FROM job_emb)))::float AS score,
            CASE
              WHEN EXISTS (
                SELECT 1 FROM applications a
                 WHERE a.candidate_id = c.id
                   AND a.tenant_id   = c.tenant_id
                   AND a.status      = 'rejected'
              ) THEN 'rejected_in_other_job'
              WHEN c.last_activity_at < now() - ($3 || ' days')::interval
                THEN 'old_archived'
              ELSE 'strong_skill_match'
            END AS reason
       FROM candidates c
      WHERE c.tenant_id = $2
        AND c.embedding IS NOT NULL
        AND c.deleted_at IS NULL
        AND (
              c.last_activity_at < now() - ($3 || ' days')::interval
           OR EXISTS (
                SELECT 1 FROM applications a
                 WHERE a.candidate_id = c.id
                   AND a.tenant_id   = c.tenant_id
                   AND a.status      = 'rejected'
              )
        )
        AND NOT EXISTS (
              SELECT 1 FROM applications a
               WHERE a.candidate_id = c.id
                 AND a.tenant_id   = c.tenant_id
                 AND a.job_id      = $1
        )
        AND (SELECT embedding FROM job_emb) IS NOT NULL
      ORDER BY c.embedding <=> (SELECT embedding FROM job_emb) ASC
      LIMIT $4`,
    [jobId, tenantId, String(CANDIDATE_DORMANT_DAYS), CANDIDATES_PER_JOB_LIMIT]
  );
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Insert alerts — UPSERT idempotent
// ─────────────────────────────────────────────────────────────────────────────

interface InsertedAlert {
  candidate_id: string;
  inserted: boolean;
}

async function upsertAlertsForJob(
  client: PoolClient,
  tenantId: string,
  jobId: string,
  matches: CandidateMatchRow[]
): Promise<InsertedAlert[]> {
  const inserted: InsertedAlert[] = [];
  for (const match of matches) {
    const score =
      typeof match.score === 'number' ? match.score : parseFloat(String(match.score));
    if (!Number.isFinite(score) || score < SCORE_THRESHOLD) continue;

    // Clamp [0,1] — pgvector kan licht buiten bounds drijven.
    const clamped = Math.max(0, Math.min(1, score));

    const { rowCount } = await client.query(
      `INSERT INTO talent_reactivation_alerts
         (tenant_id, job_id, candidate_id, match_score, reason)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, job_id, candidate_id) DO NOTHING`,
      [tenantId, jobId, match.candidate_id, clamped.toFixed(4), match.reason]
    );
    inserted.push({
      candidate_id: match.candidate_id,
      inserted: (rowCount ?? 0) > 0,
    });
  }
  return inserted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Email digest per recruiter
// ─────────────────────────────────────────────────────────────────────────────

interface RecruiterDigestEntry {
  tenantId: string;
  recruiterId: string;
  newAlerts: number;
}

async function dispatchRecruiterDigests(
  digests: RecruiterDigestEntry[]
): Promise<number> {
  let queued = 0;
  for (const entry of digests) {
    if (entry.newAlerts <= 0) continue;
    try {
      // Recruiter naam + email opzoeken (geen RLS — admin pool, expliciete tenant_id).
      const { rows } = await adminPool.query<{ email: string; name: string | null }>(
        `SELECT email, name FROM users
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [entry.recruiterId, entry.tenantId]
      );
      const user = rows[0];
      if (!user || !user.email) continue;

      const subject = `${entry.newAlerts} kandidaat${entry.newAlerts === 1 ? '' : 'en'} uit je database matcht je openstaande vacatures`;
      const html = buildDigestHtml(user.name, entry.newAlerts);
      const text = buildDigestText(user.name, entry.newAlerts);

      await emailSenderQueue.add(
        'talent-reactivation-digest',
        {
          tenantId: entry.tenantId,
          to: user.email,
          subject,
          bodyHtml: html,
          bodyText: text,
          userId: entry.recruiterId,
        },
        { removeOnComplete: 50, removeOnFail: 50 }
      );
      queued++;
    } catch (err) {
      logger.error('[talentReactivation] digest dispatch failed', {
        tenantId: entry.tenantId,
        recruiterId: entry.recruiterId,
        error: (err as Error).message,
      });
    }
  }
  return queued;
}

function buildDigestHtml(name: string | null, count: number): string {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  return `
    <p>${greeting}</p>
    <p>We hebben afgelopen nacht <strong>${count} kandida${count === 1 ? 'at' : 'ten'}</strong>
    uit je database gevonden die alsnog goed matchen op je openstaande vacatures.</p>
    <p>Open TalentFlow om de matches te bekijken — vaak gaat het om kandidaten
    die eerder niet in een andere rol pasten of al een tijd "inactief" zijn.</p>
    <p>— TalentFlow</p>
  `;
}

function buildDigestText(name: string | null, count: number): string {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  return [
    greeting,
    '',
    `We hebben afgelopen nacht ${count} kandida${count === 1 ? 'at' : 'ten'} uit je database gevonden die alsnog goed matchen op je openstaande vacatures.`,
    '',
    'Open TalentFlow om de matches te bekijken.',
    '',
    '— TalentFlow',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Job processor
// ─────────────────────────────────────────────────────────────────────────────

export interface TalentReactivationResult {
  started_at: string;
  ended_at: string;
  elapsed_ms: number;
  tenants_processed: number;
  jobs_processed: number;
  alerts_inserted: number;
  alerts_skipped_existing: number;
  digests_queued: number;
  errors: number;
}

export async function processTalentReactivationJob(
  _job: Job
): Promise<TalentReactivationResult> {
  const startedAt = new Date();
  const result: TalentReactivationResult = {
    started_at: startedAt.toISOString(),
    ended_at: '',
    elapsed_ms: 0,
    tenants_processed: 0,
    jobs_processed: 0,
    alerts_inserted: 0,
    alerts_skipped_existing: 0,
    digests_queued: 0,
    errors: 0,
  };

  let activeJobs: TenantJobRow[];
  try {
    activeJobs = await findActiveJobsAcrossTenants();
  } catch (err) {
    logger.error('[talentReactivation] failed to load active jobs', {
      error: (err as Error).message,
    });
    result.errors++;
    result.ended_at = new Date().toISOString();
    result.elapsed_ms = Date.now() - startedAt.getTime();
    return result;
  }

  // Group jobs per tenant zodat we per tenant 1 transactie kunnen draaien.
  const tenantToJobs = new Map<string, TenantJobRow[]>();
  for (const j of activeJobs) {
    const arr = tenantToJobs.get(j.tenant_id) ?? [];
    arr.push(j);
    tenantToJobs.set(j.tenant_id, arr);
  }

  const allDigests: RecruiterDigestEntry[] = [];

  for (const [tenantId, jobs] of tenantToJobs) {
    // Per-recruiter teller binnen deze tenant.
    const recruiterCounts = new Map<string, number>();
    try {
      await withTenantTx(tenantId, async (client) => {
        for (const job of jobs) {
          result.jobs_processed++;
          try {
            const matches = await findReactivationMatchesForJob(
              client,
              tenantId,
              job.job_id
            );
            const inserted = await upsertAlertsForJob(
              client,
              tenantId,
              job.job_id,
              matches
            );
            const newCount = inserted.filter((i) => i.inserted).length;
            const skippedCount = inserted.length - newCount;
            result.alerts_inserted += newCount;
            result.alerts_skipped_existing += skippedCount;

            if (newCount > 0 && job.recruiter_id) {
              recruiterCounts.set(
                job.recruiter_id,
                (recruiterCounts.get(job.recruiter_id) ?? 0) + newCount
              );
            }
          } catch (err) {
            result.errors++;
            logger.error('[talentReactivation] job-level scan faalde', {
              tenantId,
              jobId: job.job_id,
              error: (err as Error).message,
            });
          }
        }
      });
      result.tenants_processed++;
    } catch (err) {
      result.errors++;
      logger.error('[talentReactivation] tenant scan faalde', {
        tenantId,
        error: (err as Error).message,
      });
    }

    // Voeg recruiter-digest entries toe voor deze tenant.
    for (const [recruiterId, count] of recruiterCounts) {
      allDigests.push({ tenantId, recruiterId, newAlerts: count });
    }

    // Yield-tijdje tussen tenants.
    await new Promise((res) => setTimeout(res, 100));
  }

  // Dispatch e-mails NA alle tenants verwerkt zijn — voorkomt dat lange e-mail
  // queue-adds de DB-pool blokkeren.
  try {
    result.digests_queued = await dispatchRecruiterDigests(allDigests);
  } catch (err) {
    result.errors++;
    logger.error('[talentReactivation] digest dispatch overall failed', {
      error: (err as Error).message,
    });
  }

  result.ended_at = new Date().toISOString();
  result.elapsed_ms = Date.now() - startedAt.getTime();
  logger.info('[talentReactivation] nightly run finished', result);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker setup
// ─────────────────────────────────────────────────────────────────────────────

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let talentReactivationWorker: Worker | null = null;

if (!shouldStartWorker) {
  logger.info(
    '[talentReactivation] inline worker disabled (DISABLE_INLINE_WORKERS=true)'
  );
} else {
  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  talentReactivationWorker = new Worker(
    'talent-reactivation',
    processTalentReactivationJob,
    { connection }
  );

  talentReactivationWorker.on('completed', (job, _result) => {
    logger.info('[talentReactivation] job completed', { jobId: job.id });
  });

  talentReactivationWorker.on('failed', (job, err) => {
    logger.error('[talentReactivation] job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  void ensureTalentReactivationScheduled();
}

export {
  talentReactivationWorker,
  // Re-export internals voor unit-tests
  findReactivationMatchesForJob,
  upsertAlertsForJob,
  dispatchRecruiterDigests,
  SCORE_THRESHOLD,
  JOB_AGE_DAYS,
  CANDIDATE_DORMANT_DAYS,
};
