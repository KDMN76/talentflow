import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import type { PoolClient } from 'pg';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface JobHealthBreakdown {
  /** Weighted aggregate, 0-100. */
  health_score: number;
  days_open: number;
  candidates_total: number;
  candidates_in_funnel: number;
  velocity_score: number;
  drop_off_score: number;
  recency_score: number;
  predicted_close_date: string | null;
  computed_at: string;
  weights: { velocity: number; drop_off: number; recency: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cache-TTL: hergebruik snapshots <6 uur oud. Hieronder zou de UI te oude
 * data laten zien; daarboven herberekenen we (en schrijven nieuwe rij).
 */
const CACHE_TTL_HOURS = 6;

/**
 * Aggregator-weights — surfaced in the response for tooltip transparency.
 * velocity (40%) + drop_off (30%) + recency (30%) = 100%.
 */
const HEALTH_WEIGHTS = {
  velocity: 0.4,
  drop_off: 0.3,
  recency: 0.3,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(n: number, min = 0, max = 100): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, Math.round(n)));
}

async function ensureJobExists(
  client: PoolClient,
  jobId: string,
  tenantId: string
): Promise<{ id: string; open_date: Date | null; created_at: Date }> {
  const { rows: [row] } = await client.query(
    `SELECT id, open_date, created_at
     FROM jobs
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [jobId, tenantId]
  );
  if (!row) {
    throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');
  }
  return row;
}

/**
 * Fetch the latest snapshot if it's still within the TTL window.
 */
async function fetchFreshSnapshot(
  client: PoolClient,
  tenantId: string,
  jobId: string
): Promise<JobHealthBreakdown | null> {
  const { rows: [row] } = await client.query(
    `SELECT *
     FROM job_health_snapshots
     WHERE tenant_id = $1 AND job_id = $2
       AND computed_at > now() - ($3 || ' hours')::interval
     ORDER BY computed_at DESC
     LIMIT 1`,
    [tenantId, jobId, String(CACHE_TTL_HOURS)]
  );

  if (!row) return null;

  return {
    health_score: row.health_score,
    days_open: row.days_open ?? 0,
    candidates_total: row.candidates_total ?? 0,
    candidates_in_funnel: row.candidates_in_funnel ?? 0,
    velocity_score: row.velocity_score ?? 0,
    drop_off_score: row.drop_off_score ?? 0,
    recency_score: row.recency_score ?? 0,
    predicted_close_date: row.predicted_close_date
      ? new Date(row.predicted_close_date).toISOString().slice(0, 10)
      : null,
    computed_at: new Date(row.computed_at).toISOString(),
    weights: { ...HEALTH_WEIGHTS },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function getJobHealth(
  tenantId: string,
  jobId: string
): Promise<JobHealthBreakdown> {
  return withTenant(tenantId, async (client) => {
    const job = await ensureJobExists(client, jobId, tenantId);

    // Try cache first.
    const cached = await fetchFreshSnapshot(client, tenantId, jobId);
    if (cached) return cached;

    // ─── Compute sub-scores ──────────────────────────────────────────────────

    const openFrom: Date = job.open_date ?? job.created_at;
    const now = Date.now();
    const daysOpen = Math.max(
      0,
      Math.floor((now - new Date(openFrom).getTime()) / (1000 * 60 * 60 * 24))
    );

    // Application counts
    const { rows: [counts] } = await client.query(
      `SELECT
         COUNT(*)::int                                                             AS total,
         COUNT(*) FILTER (WHERE status <> 'rejected')::int                         AS in_funnel,
         COUNT(*) FILTER (WHERE applied_at >= now() - interval '7 days')::int      AS last_7_days,
         COUNT(*) FILTER (WHERE applied_at <  now() - interval '7 days'
                          AND applied_at >= now() - interval '14 days')::int       AS prior_7_days,
         MAX(GREATEST(applied_at, updated_at))                                      AS last_activity_at
       FROM applications
       WHERE job_id = $1 AND tenant_id = $2`,
      [jobId, tenantId]
    );

    const total = counts?.total ?? 0;
    const inFunnel = counts?.in_funnel ?? 0;
    const last7 = counts?.last_7_days ?? 0;
    const prior7 = counts?.prior_7_days ?? 0;
    const lastActivityAt: Date | null = counts?.last_activity_at ?? null;

    // Velocity: ratio recent vs prior week. Capped to 100.
    // - 0 applications recent  -> 0
    // - same as prior          -> 100
    // - more than prior        -> >100, clamped to 100
    let velocityScore: number;
    if (last7 === 0 && prior7 === 0) {
      velocityScore = total === 0 ? 0 : 50; // unknown trend → neutral
    } else if (prior7 === 0) {
      velocityScore = last7 > 0 ? 100 : 0;
    } else {
      velocityScore = clamp((last7 / prior7) * 100);
    }

    // Drop-off: candidates concentrated in stage 1 = bad.
    // Score = 100 - (stage1_count / total) * 100, clamped.
    let dropOffScore = 100;
    if (total > 0) {
      const { rows: [stage1] } = await client.query(
        `SELECT COUNT(*)::int as cnt
         FROM applications a
         JOIN pipeline_stages ps ON ps.id = a.stage_id AND ps.tenant_id = a.tenant_id
         WHERE a.job_id = $1 AND a.tenant_id = $2 AND ps.position = 1
           AND a.status = 'active'`,
        [jobId, tenantId]
      );
      const stuck = stage1?.cnt ?? 0;
      dropOffScore = clamp(100 - (stuck / total) * 100);
    }

    // Recency: 100 - days_since_last * 5; floor 0.
    let recencyScore: number;
    if (!lastActivityAt) {
      recencyScore = 0;
    } else {
      const daysSince = Math.max(
        0,
        Math.floor(
          (now - new Date(lastActivityAt).getTime()) / (1000 * 60 * 60 * 24)
        )
      );
      recencyScore = clamp(100 - daysSince * 5);
    }

    const healthScore = clamp(
      velocityScore * HEALTH_WEIGHTS.velocity +
        dropOffScore * HEALTH_WEIGHTS.drop_off +
        recencyScore * HEALTH_WEIGHTS.recency
    );

    // Predicted close-date — simple linear projection from velocity_score.
    let predictedCloseDate: string | null = null;
    if (total > 0) {
      let daysAhead: number | null = null;
      if (velocityScore >= 70) daysAhead = 14;
      else if (velocityScore >= 30) daysAhead = 30;
      else if (velocityScore > 0) daysAhead = 60;
      // velocityScore === 0 → null (not extrapolable)

      if (daysAhead !== null) {
        const d = new Date(now + daysAhead * 24 * 60 * 60 * 1000);
        predictedCloseDate = d.toISOString().slice(0, 10);
      }
    }

    // Persist the snapshot.
    const { rows: [persisted] } = await client.query(
      `INSERT INTO job_health_snapshots (
         tenant_id, job_id,
         health_score, days_open, candidates_total, candidates_in_funnel,
         velocity_score, drop_off_score, recency_score, predicted_close_date
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING computed_at`,
      [
        tenantId,
        jobId,
        healthScore,
        daysOpen,
        total,
        inFunnel,
        velocityScore,
        dropOffScore,
        recencyScore,
        predictedCloseDate,
      ]
    );

    return {
      health_score: healthScore,
      days_open: daysOpen,
      candidates_total: total,
      candidates_in_funnel: inFunnel,
      velocity_score: velocityScore,
      drop_off_score: dropOffScore,
      recency_score: recencyScore,
      predicted_close_date: predictedCloseDate,
      computed_at: new Date(persisted.computed_at).toISOString(),
      weights: { ...HEALTH_WEIGHTS },
    };
  });
}
