/**
 * Notification reminders worker — Sprint Q2.4.
 *
 * Drie repeatable jobs:
 *   - `reminders:hourly`        → cron `0 * * * *`  (elk uur)
 *       • Scorecard-deadlines: applications in stage 'Interview' >48u
 *         zonder scorecard → push (max 1x per 24u — gecontroleerd via
 *         notification_log).
 *       • Interview-reminders: scheduled interviews binnen de komende 60min
 *         (interviews-tabel optioneel — try/catch op 42P01).
 *
 *   - `reminders:daily-digest`  → cron `0 9 * * 1-5`  (09:00 ma-vr)
 *       • Per actieve user: tel pending reviews, scorecards due, interviews
 *         vandaag → één digest-push.
 *
 * Schedule wordt idempotent geregistreerd bij worker-start (zoals
 * retention.worker.ts).
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import { logger } from '../../middleware/errorHandler';
import { notificationRemindersQueue } from '../queues';
import {
  pushScorecardReminder,
  pushInterviewReminder,
  pushDailyDigest,
  type DailyDigestStats,
} from '../../lib/pushEvents';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

const HOURLY_CRON = process.env.NOTIFICATION_HOURLY_CRON ?? '0 * * * *';
const DIGEST_CRON = process.env.NOTIFICATION_DIGEST_CRON ?? '0 9 * * 1-5';

const HOURLY_JOB_ID = 'reminders:hourly';
const DIGEST_JOB_ID = 'reminders:daily-digest';

type ReminderJobName = typeof HOURLY_JOB_ID | typeof DIGEST_JOB_ID;

// We werken hier zonder withTenant omdat we cross-tenant scannen. Dat is
// veilig: alle queries zijn read-only counts en gebruiken expliciete
// tenant_id-clauses. RLS zou ons in deze cron juist tegenwerken.
const adminPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  idleTimeoutMillis: 30000,
});
adminPool.on('error', (err) => {
  logger.error('[reminders] adminPool error', { error: err.message });
});

export async function ensureRemindersScheduled(): Promise<void> {
  try {
    await notificationRemindersQueue.add(
      HOURLY_JOB_ID,
      { kind: 'hourly' },
      { repeat: { pattern: HOURLY_CRON }, jobId: HOURLY_JOB_ID }
    );
    await notificationRemindersQueue.add(
      DIGEST_JOB_ID,
      { kind: 'daily-digest' },
      { repeat: { pattern: DIGEST_CRON }, jobId: DIGEST_JOB_ID }
    );
    logger.info('[reminders] schedule registered', {
      hourly: HOURLY_CRON,
      digest: DIGEST_CRON,
    });
  } catch (err) {
    logger.error('[reminders] failed to register schedule', {
      error: (err as Error).message,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hourly: scorecard-deadlines + interview-reminders
// ─────────────────────────────────────────────────────────────────────────────

interface ScorecardDeadlineRow {
  tenant_id: string;
  user_id: string;
  application_id: string;
  candidate_name: string;
  stage_changed_at: Date;
}

async function processScorecardDeadlines(): Promise<number> {
  // Vind applications die >48u in een Interview-stage zitten zonder scorecard
  // van de toegewezen recruiter. Send max 1x per 24u op (user, application).
  let count = 0;
  try {
    const { rows } = await adminPool.query<ScorecardDeadlineRow>(
      `SELECT a.tenant_id,
              j.recruiter_id    AS user_id,
              a.id              AS application_id,
              c.name            AS candidate_name,
              a.updated_at      AS stage_changed_at
       FROM applications a
       JOIN jobs j        ON j.id = a.job_id        AND j.tenant_id = a.tenant_id
       JOIN candidates c  ON c.id = a.candidate_id  AND c.tenant_id = a.tenant_id
       JOIN pipeline_stages ps ON ps.id = a.stage_id
       WHERE ps.name = 'Interview'
         AND a.status = 'active'
         AND a.updated_at < now() - INTERVAL '48 hours'
         AND j.deleted_at IS NULL AND c.deleted_at IS NULL
         AND j.recruiter_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM scorecards sc
           WHERE sc.application_id = a.id AND sc.tenant_id = a.tenant_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM notification_log nl
           WHERE nl.tenant_id = a.tenant_id
             AND nl.user_id   = j.recruiter_id
             AND nl.event_type = 'scorecard_deadline'
             AND nl.payload->'data'->>'entityId' = a.id::text
             AND nl.created_at > now() - INTERVAL '24 hours'
         )
       LIMIT 200`
    );

    for (const row of rows) {
      const ageHours = Math.floor(
        (Date.now() - new Date(row.stage_changed_at).getTime()) / 3_600_000
      );
      // "Nog X uur" — we noemen 72u als deadline-default; de stage age
      // bepaalt hoe dringend. Als >72u, dringender boodschap (0 uur).
      const remaining = Math.max(72 - ageHours, 0);
      await pushScorecardReminder(
        row.tenant_id,
        row.user_id,
        row.candidate_name,
        remaining,
        row.application_id
      );
      count++;
    }
  } catch (err) {
    if ((err as { code?: string })?.code === '42P01') {
      logger.warn(
        '[reminders] scorecard deadline scan skipped — table missing'
      );
    } else {
      logger.error('[reminders] scorecard deadline scan failed', {
        error: (err as Error).message,
      });
    }
  }
  return count;
}

interface InterviewRow {
  tenant_id: string;
  user_id: string;
  application_id: string;
  candidate_name: string;
  scheduled_at: Date;
}

async function processInterviewReminders(): Promise<number> {
  // Interviews-tabel kan optioneel zijn. We proberen events met 'interview'
  // type uit een schema-tabel; bij 42P01 (table missing) silent skip.
  let count = 0;
  try {
    const { rows } = await adminPool.query<InterviewRow>(
      `SELECT a.tenant_id,
              j.recruiter_id     AS user_id,
              a.id               AS application_id,
              c.name             AS candidate_name,
              i.scheduled_at     AS scheduled_at
       FROM interviews i
       JOIN applications a ON a.id = i.application_id AND a.tenant_id = i.tenant_id
       JOIN jobs j         ON j.id = a.job_id        AND j.tenant_id = a.tenant_id
       JOIN candidates c   ON c.id = a.candidate_id  AND c.tenant_id = a.tenant_id
       WHERE i.scheduled_at BETWEEN now() + INTERVAL '50 minutes'
                                AND now() + INTERVAL '70 minutes'
         AND j.recruiter_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM notification_log nl
           WHERE nl.tenant_id = i.tenant_id
             AND nl.event_type = 'interview_reminder'
             AND nl.payload->'data'->>'entityId' = a.id::text
             AND nl.created_at > now() - INTERVAL '6 hours'
         )
       LIMIT 200`
    );

    for (const row of rows) {
      await pushInterviewReminder(
        row.tenant_id,
        row.user_id,
        row.candidate_name,
        'over ongeveer 60 minuten',
        row.application_id
      );
      count++;
    }
  } catch (err) {
    if ((err as { code?: string })?.code === '42P01') {
      // Tabel bestaat (nog) niet — geen probleem.
    } else {
      logger.error('[reminders] interview scan failed', {
        error: (err as Error).message,
      });
    }
  }
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily digest (09:00 werkdagen)
// ─────────────────────────────────────────────────────────────────────────────

interface DigestUserRow {
  tenant_id: string;
  user_id: string;
  pending_reviews: string;
  scorecards_due: string;
  interviews_today: string;
}

async function processDailyDigest(): Promise<number> {
  let count = 0;
  try {
    const { rows } = await adminPool.query<DigestUserRow>(
      `SELECT u.tenant_id,
              u.id AS user_id,
              COALESCE(pending.pending_reviews, 0)  AS pending_reviews,
              COALESCE(due.scorecards_due, 0)       AS scorecards_due,
              COALESCE(today.interviews_today, 0)   AS interviews_today
       FROM users u
       LEFT JOIN (
         SELECT j.recruiter_id AS user_id, j.tenant_id,
                COUNT(DISTINCT a.id) AS pending_reviews
         FROM applications a
         JOIN jobs j ON j.id = a.job_id AND j.tenant_id = a.tenant_id
         JOIN pipeline_stages ps ON ps.id = a.stage_id
         WHERE a.status = 'active'
           AND ps.name IN ('Interview','Technische test','Aanbieding','Hiring Manager Review')
           AND j.deleted_at IS NULL
         GROUP BY j.recruiter_id, j.tenant_id
       ) pending ON pending.user_id = u.id AND pending.tenant_id = u.tenant_id
       LEFT JOIN (
         SELECT j.recruiter_id AS user_id, j.tenant_id,
                COUNT(*) AS scorecards_due
         FROM applications a
         JOIN jobs j ON j.id = a.job_id AND j.tenant_id = a.tenant_id
         JOIN pipeline_stages ps ON ps.id = a.stage_id
         WHERE a.status = 'active'
           AND ps.name = 'Interview'
           AND a.updated_at < now() - INTERVAL '24 hours'
           AND NOT EXISTS (
             SELECT 1 FROM scorecards sc
             WHERE sc.application_id = a.id AND sc.tenant_id = a.tenant_id
           )
         GROUP BY j.recruiter_id, j.tenant_id
       ) due ON due.user_id = u.id AND due.tenant_id = u.tenant_id
       LEFT JOIN (
         SELECT 0::int AS interviews_today, NULL::uuid AS user_id, NULL::uuid AS tenant_id
       ) today ON today.user_id = u.id AND today.tenant_id = u.tenant_id
       WHERE u.deleted_at IS NULL
         AND (
           COALESCE(pending.pending_reviews, 0) > 0
           OR COALESCE(due.scorecards_due, 0) > 0
         )
       LIMIT 1000`
    );

    for (const row of rows) {
      const stats: DailyDigestStats = {
        pendingReviews: parseInt(row.pending_reviews, 10) || 0,
        scorecardsDue: parseInt(row.scorecards_due, 10) || 0,
        interviewsToday: parseInt(row.interviews_today, 10) || 0,
      };
      await pushDailyDigest(row.tenant_id, row.user_id, stats);
      count++;
    }
  } catch (err) {
    logger.error('[reminders] daily digest scan failed', {
      error: (err as Error).message,
    });
  }
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// Job processor
// ─────────────────────────────────────────────────────────────────────────────

interface ReminderJobResult {
  kind: ReminderJobName | 'unknown';
  scorecard_pushes?: number;
  interview_pushes?: number;
  digest_pushes?: number;
  elapsed_ms: number;
}

async function processReminderJob(job: Job): Promise<ReminderJobResult> {
  const start = Date.now();
  const name = job.name as ReminderJobName;
  const result: ReminderJobResult = { kind: name, elapsed_ms: 0 };

  if (name === HOURLY_JOB_ID) {
    result.scorecard_pushes = await processScorecardDeadlines();
    result.interview_pushes = await processInterviewReminders();
  } else if (name === DIGEST_JOB_ID) {
    result.digest_pushes = await processDailyDigest();
  } else {
    logger.warn('[reminders] unknown job', { name });
    result.kind = 'unknown';
  }

  result.elapsed_ms = Date.now() - start;
  logger.info('[reminders] job finished', result);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker setup
// ─────────────────────────────────────────────────────────────────────────────

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let remindersWorker: Worker | null = null;

if (!shouldStartWorker) {
  logger.info('[reminders] inline worker disabled');
} else {
  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  remindersWorker = new Worker(
    'notification-reminders',
    processReminderJob,
    { connection }
  );

  remindersWorker.on('completed', (job, result) => {
    logger.info('[reminders] Job completed', {
      jobId: job.id,
      result,
    });
  });

  remindersWorker.on('failed', (job, err) => {
    logger.error('[reminders] Job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  void ensureRemindersScheduled();
}

export {
  remindersWorker,
  processReminderJob,
  processScorecardDeadlines,
  processInterviewReminders,
  processDailyDigest,
};
