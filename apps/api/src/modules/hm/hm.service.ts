import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';

// ─────────────────────────────────────────────────────────────────────────────
// Hiring Manager service — simplified view of the recruitment platform.
//
// Hiring Managers (HM) only see jobs assigned to them and applications that
// require their feedback. They can quickly approve / reject / defer a
// candidate — the heavy lifting (sourcing, scheduling, etc.) stays with the
// recruiter.
//
// GEEN mock-fallbacks: een DB-fout propageert als echte fout naar de client.
// Eerder degradeerden alle reads/writes bij een missing-table (42P01) naar
// verzonnen data — een demo of productie-omgeving toonde dan nepkandidaten
// en "gelukte" reviews die nergens waren opgeslagen.
// ─────────────────────────────────────────────────────────────────────────────

const HM_REVIEW_STAGES = ['Interview', 'Technische test', 'Aanbieding', 'Offer'];

// ─── Dashboard ───────────────────────────────────────────────────────────────

export interface HmDashboard {
  open_jobs: number;
  pending_reviews: number;
  approved_today: number;
  rejected_today: number;
}

export async function getMyDashboard(
  tenantId: string,
  userId: string
): Promise<HmDashboard> {
  return withTenant(tenantId, async (client) => {
      const { rows: [openJobsRow] } = await client.query(
        `SELECT COUNT(*) as count FROM jobs
         WHERE tenant_id = $1 AND recruiter_id = $2
           AND status = 'open' AND deleted_at IS NULL`,
        [tenantId, userId]
      );

      // HM-beslissingen leven in `activities` (hm_approved/hm_rejected/
      // hm_deferred) — NIET in `scorecards`: die tabel heeft interviewer_id +
      // recommendation (interview-evaluaties), geen reviewer_id/decision.
      // De oude scorecards-queries gaven daardoor 42703 undefined_column → 500.
      const { rows: [pendingRow] } = await client.query(
        `SELECT COUNT(DISTINCT a.id) as count
         FROM applications a
         JOIN jobs j ON j.id = a.job_id AND j.tenant_id = a.tenant_id
         LEFT JOIN pipeline_stages ps ON ps.id = a.stage_id
         WHERE a.tenant_id = $1
           AND j.recruiter_id = $2
           AND a.status = 'active'
           AND ps.name = ANY($3::text[])
           AND NOT EXISTS (
             SELECT 1 FROM activities act
             WHERE act.entity_type = 'application'
               AND act.entity_id = a.id
               AND act.user_id = $2
               AND act.tenant_id = $1
               AND act.action IN ('hm_approved', 'hm_rejected')
           )`,
        [tenantId, userId, HM_REVIEW_STAGES]
      );

      const { rows: [actRow] } = await client.query(
        `SELECT
           COUNT(*) FILTER (WHERE action = 'hm_approved') as approved,
           COUNT(*) FILTER (WHERE action = 'hm_rejected') as rejected
         FROM activities
         WHERE tenant_id = $1
           AND user_id = $2
           AND entity_type = 'application'
           AND created_at >= date_trunc('day', now())`,
        [tenantId, userId]
      );
      const approvedToday = parseInt(actRow.approved ?? '0', 10);
      const rejectedToday = parseInt(actRow.rejected ?? '0', 10);

      return {
        open_jobs: parseInt(openJobsRow.count, 10),
        pending_reviews: parseInt(pendingRow.count, 10),
        approved_today: approvedToday,
        rejected_today: rejectedToday,
      };
  });
}

// ─── My Jobs ─────────────────────────────────────────────────────────────────

export interface HmJob {
  id: string;
  title: string;
  application_count: number;
  location: string | null;
}

export async function getMyJobs(
  tenantId: string,
  userId: string
): Promise<HmJob[]> {
  return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT j.id, j.title, j.location,
                COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'active') as application_count
         FROM jobs j
         LEFT JOIN applications a ON a.job_id = j.id AND a.tenant_id = j.tenant_id
         WHERE j.tenant_id = $1
           AND j.recruiter_id = $2
           AND j.status = 'open'
           AND j.deleted_at IS NULL
         GROUP BY j.id
         ORDER BY j.created_at DESC`,
        [tenantId, userId]
      );

      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        location: r.location ?? null,
        application_count: parseInt(r.application_count, 10) || 0,
      }));
  });
}

// ─── Pending Reviews ─────────────────────────────────────────────────────────

export interface HmPendingReview {
  application_id: string;
  candidate_id: string;
  candidate_name: string;
  candidate_email: string | null;
  candidate_position: string | null;
  ai_score: number | null;
  applied_at: string;
  job_id: string;
  job_title: string;
  stage_id: string | null;
  stage_name: string | null;
  summary: string | null;
  skills: string[];
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function getPendingReviews(
  tenantId: string,
  userId: string
): Promise<HmPendingReview[]> {
  return withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT a.id              as application_id,
                a.applied_at,
                a.job_id,
                a.stage_id,
                c.id              as candidate_id,
                c.name            as candidate_name,
                c.email           as candidate_email,
                c.current_position as candidate_position,
                c.skills          as candidate_skills,
                c.ai_score,
                c.notes           as summary,
                j.title           as job_title,
                ps.name           as stage_name
         FROM applications a
         JOIN jobs j        ON j.id  = a.job_id  AND j.tenant_id = a.tenant_id
         JOIN candidates c  ON c.id  = a.candidate_id AND c.tenant_id = a.tenant_id
         LEFT JOIN pipeline_stages ps ON ps.id = a.stage_id
         WHERE a.tenant_id = $1
           AND j.recruiter_id = $2
           AND a.status = 'active'
           AND ps.name = ANY($3::text[])
           AND j.deleted_at IS NULL
           AND c.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM activities act
             WHERE act.entity_type = 'application'
               AND act.entity_id = a.id
               AND act.user_id = $2
               AND act.tenant_id = $1
               AND act.action IN ('hm_approved', 'hm_rejected')
           )
         ORDER BY a.applied_at DESC
         LIMIT 20`,
        [tenantId, userId, HM_REVIEW_STAGES]
      );

      return rows.map((r) => ({
        application_id: r.application_id,
        candidate_id: r.candidate_id,
        candidate_name: r.candidate_name,
        candidate_email: r.candidate_email ?? null,
        candidate_position: r.candidate_position ?? null,
        ai_score: r.ai_score !== null && r.ai_score !== undefined ? Number(r.ai_score) : null,
        applied_at: r.applied_at,
        job_id: r.job_id,
        job_title: r.job_title,
        stage_id: r.stage_id ?? null,
        stage_name: r.stage_name ?? null,
        summary: r.summary ?? null,
        skills: toStringArray(r.candidate_skills),
      }));
  });
}

// ─── Review Application ──────────────────────────────────────────────────────

export type HmDecision = 'approve' | 'reject' | 'later';

export async function reviewApplication(
  tenantId: string,
  userId: string,
  applicationId: string,
  decision: HmDecision,
  notes?: string
) {
  return withTenant(tenantId, async (client) => {
      // 1. Verify application belongs to a job assigned to this HM
      const { rows: [app] } = await client.query(
        `SELECT a.id, a.job_id, a.candidate_id, a.stage_id, a.status
         FROM applications a
         JOIN jobs j ON j.id = a.job_id AND j.tenant_id = a.tenant_id
         WHERE a.id = $1 AND a.tenant_id = $2 AND j.recruiter_id = $3
           AND j.deleted_at IS NULL`,
        [applicationId, tenantId, userId]
      );
      if (!app) {
        throw new AppError(
          404,
          'APPLICATION_NOT_FOUND',
          'Sollicitatie niet gevonden of niet toegewezen aan jou'
        );
      }

      // 2. De beslissing wordt vastgelegd in de activities-log (stap 4).
      // NIET in `scorecards` schrijven: die tabel is voor interview-evaluaties
      // (interviewer_id/recommendation) en heeft geen decision-kolom — de
      // eerdere INSERT gaf 42703 undefined_column → 500 bij elke review.

      // 3. Apply the decision
      let updated = app;

      if (decision === 'approve') {
        // Move to next pipeline stage (if one exists)
        const { rows: [currentStage] } = await client.query(
          `SELECT ps.id, ps.position, ps.job_id
           FROM pipeline_stages ps
           WHERE ps.id = $1 AND ps.tenant_id = $2`,
          [app.stage_id, tenantId]
        );

        let nextStageId: string | null = null;
        if (currentStage) {
          const { rows: [nextStage] } = await client.query(
            `SELECT id FROM pipeline_stages
             WHERE job_id = $1 AND tenant_id = $2 AND position > $3
             ORDER BY position ASC LIMIT 1`,
            [currentStage.job_id, tenantId, currentStage.position]
          );
          nextStageId = nextStage?.id ?? null;
        }

        const { rows: [moved] } = await client.query(
          `UPDATE applications
             SET stage_id = COALESCE($1, stage_id), updated_at = now()
           WHERE id = $2 AND tenant_id = $3
           RETURNING *`,
          [nextStageId, applicationId, tenantId]
        );
        updated = moved;
      } else if (decision === 'reject') {
        const { rows: [rejected] } = await client.query(
          `UPDATE applications
             SET status = 'rejected', updated_at = now()
           WHERE id = $1 AND tenant_id = $2
           RETURNING *`,
          [applicationId, tenantId]
        );
        updated = rejected;
      }
      // 'later' → no movement

      // 4. Activity log
      const action =
        decision === 'approve' ? 'hm_approved'
        : decision === 'reject' ? 'hm_rejected'
        : 'hm_deferred';

      await client.query(
        `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
         VALUES ($1, 'application', $2, $3, $4, $5)`,
        [
          tenantId,
          applicationId,
          userId,
          action,
          JSON.stringify({ decision, notes: notes ?? null }),
        ]
      );

      return updated;
  });
}

// ─── Application Details ─────────────────────────────────────────────────────

export async function getApplicationDetails(
  tenantId: string,
  userId: string,
  applicationId: string
) {
  return withTenant(tenantId, async (client) => {
      const { rows: [row] } = await client.query(
        `SELECT a.id            as application_id,
                a.status,
                a.applied_at,
                a.updated_at,
                a.stage_id,
                ps.name          as stage_name,
                j.id             as job_id,
                j.title          as job_title,
                j.location       as job_location,
                j.department     as job_department,
                c.id             as candidate_id,
                c.name           as candidate_name,
                c.email          as candidate_email,
                c.phone          as candidate_phone,
                c.skills         as candidate_skills,
                c.ai_score       as candidate_ai_score,
                c.resume_url     as candidate_resume_url,
                c.notes          as candidate_summary,
                c.source         as candidate_source,
                c.tags           as candidate_tags
         FROM applications a
         JOIN jobs j        ON j.id = a.job_id        AND j.tenant_id = a.tenant_id
         JOIN candidates c  ON c.id = a.candidate_id  AND c.tenant_id = a.tenant_id
         LEFT JOIN pipeline_stages ps ON ps.id = a.stage_id
         WHERE a.id = $1 AND a.tenant_id = $2 AND j.recruiter_id = $3
           AND j.deleted_at IS NULL AND c.deleted_at IS NULL`,
        [applicationId, tenantId, userId]
      );

      if (!row) {
        throw new AppError(
          404,
          'APPLICATION_NOT_FOUND',
          'Sollicitatie niet gevonden of niet toegewezen aan jou'
        );
      }

      // Previous notes from scorecards + activity timeline.
      // Echte scorecards-kolommen: interviewer_id + recommendation
      // (geen reviewer_id/decision — dat gaf 42703 → 500).
      const { rows: previousReviews } = await client.query(
        `SELECT sc.interviewer_id as reviewer_id,
                sc.recommendation as decision,
                sc.notes, sc.created_at,
                u.name as reviewer_name
         FROM scorecards sc
         LEFT JOIN users u ON u.id = sc.interviewer_id
         WHERE sc.application_id = $1 AND sc.tenant_id = $2
         ORDER BY sc.created_at DESC`,
        [applicationId, tenantId]
      );

      const { rows: timeline } = await client.query(
        `SELECT a.id, a.action, a.payload, a.created_at,
                u.name as user_name
         FROM activities a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE a.entity_type = 'application'
           AND a.entity_id = $1
           AND a.tenant_id = $2
         ORDER BY a.created_at DESC`,
        [applicationId, tenantId]
      );

      return {
        application: {
          id: row.application_id,
          status: row.status,
          applied_at: row.applied_at,
          updated_at: row.updated_at,
          stage_id: row.stage_id,
          stage_name: row.stage_name,
        },
        job: {
          id: row.job_id,
          title: row.job_title,
          location: row.job_location,
          department: row.job_department,
        },
        candidate: {
          id: row.candidate_id,
          name: row.candidate_name,
          email: row.candidate_email,
          phone: row.candidate_phone,
          skills: row.candidate_skills ?? [],
          ai_score: row.candidate_ai_score !== null && row.candidate_ai_score !== undefined
            ? Number(row.candidate_ai_score)
            : null,
          resume_url: row.candidate_resume_url,
          source: row.candidate_source,
          tags: row.candidate_tags ?? [],
          summary: row.candidate_summary,
        },
        previous_reviews: previousReviews,
        timeline,
      };
  });
}

// ─── Stats (swipe-deck header) ───────────────────────────────────────────────

export interface HmStats {
  to_review: number;
  scorecards_due_today: number;
  scorecards_overdue: number;
  approved_today: number;
}

export async function getStats(
  tenantId: string,
  userId: string
): Promise<HmStats> {
  const [dashboard, deadlines] = await Promise.all([
    getMyDashboard(tenantId, userId),
    getScorecardDeadlines(tenantId, userId),
  ]);
  return {
    to_review: dashboard.pending_reviews,
    scorecards_due_today: deadlines.filter((d) => d.bucket === 'today').length,
    scorecards_overdue: deadlines.filter((d) => d.bucket === 'overdue').length,
    approved_today: dashboard.approved_today,
  };
}

// ─── Scorecard deadlines ─────────────────────────────────────────────────────
//
// Open scorecards voor deze hiring manager: elke actieve sollicitatie in een
// HM-reviewfase (van een job die aan deze HM is toegewezen) waarvoor deze
// gebruiker nog geen ingediende scorecard heeft op de huidige fase.
//
// Deadline-regel (deterministisch, uit echte data — geen verzonnen datums):
//   - is er een afgelopen interview voor de sollicitatie → scheduled_end + 48u
//   - anders → laatste stage-wijziging (applications.updated_at) + 72u

export type HmDeadlineBucket = 'overdue' | 'today' | 'this_week' | 'later';

export interface HmScorecardDeadline {
  application_id: string;
  candidate_name: string;
  job_id: string;
  job_title: string;
  stage_id: string | null;
  stage_name: string | null;
  due_at: string;
  bucket: HmDeadlineBucket;
}

function bucketFor(due: Date, now: Date): HmDeadlineBucket {
  if (due.getTime() < now.getTime()) return 'overdue';
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  if (due.getTime() <= endOfToday.getTime()) return 'today';
  if (due.getTime() <= now.getTime() + 7 * 24 * 3600 * 1000) return 'this_week';
  return 'later';
}

export async function getScorecardDeadlines(
  tenantId: string,
  userId: string
): Promise<HmScorecardDeadline[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT a.id            as application_id,
              a.stage_id,
              c.name          as candidate_name,
              j.id            as job_id,
              j.title         as job_title,
              ps.name         as stage_name,
              COALESCE(
                (SELECT MAX(i.scheduled_end) + INTERVAL '48 hours'
                   FROM interviews i
                  WHERE i.application_id = a.id
                    AND i.tenant_id = a.tenant_id
                    AND i.scheduled_end < now()
                    AND i.cancelled_at IS NULL),
                a.updated_at + INTERVAL '72 hours'
              ) as due_at
       FROM applications a
       JOIN jobs j       ON j.id = a.job_id       AND j.tenant_id = a.tenant_id
       JOIN candidates c ON c.id = a.candidate_id AND c.tenant_id = a.tenant_id
       LEFT JOIN pipeline_stages ps ON ps.id = a.stage_id
       WHERE a.tenant_id = $1
         AND j.recruiter_id = $2
         AND a.status = 'active'
         AND ps.name = ANY($3::text[])
         AND j.deleted_at IS NULL
         AND c.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM scorecards sc
           WHERE sc.application_id = a.id
             AND sc.tenant_id = a.tenant_id
             AND sc.interviewer_id = $2
             AND (sc.stage_id = a.stage_id OR (sc.stage_id IS NULL AND a.stage_id IS NULL))
             AND sc.submitted_at IS NOT NULL
         )
       ORDER BY due_at ASC
       LIMIT 100`,
      [tenantId, userId, HM_REVIEW_STAGES]
    );

    const now = new Date();
    return rows.map((r) => {
      const due = new Date(r.due_at);
      return {
        application_id: r.application_id,
        candidate_name: r.candidate_name,
        job_id: r.job_id,
        job_title: r.job_title,
        stage_id: r.stage_id ?? null,
        stage_name: r.stage_name ?? null,
        due_at: due.toISOString(),
        bucket: bucketFor(due, now),
      };
    });
  });
}
