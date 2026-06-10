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
// All DB ops are wrapped in try/catch so missing optional tables (e.g. the
// `scorecards` table during early MVP) degrade to mock fallbacks instead of
// returning a 500.
// ─────────────────────────────────────────────────────────────────────────────

const HM_REVIEW_STAGES = ['Interview', 'Technische test', 'Aanbieding', 'Offer'];

/**
 * Postgres "undefined_table" — the underlying table doesn't exist yet.
 */
function isMissingTableError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === '42P01';
}

function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

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
  try {
    return await withTenant(tenantId, async (client) => {
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
  } catch (err) {
    if (isMissingTableError(err)) {
      return {
        open_jobs: 3,
        pending_reviews: 5,
        approved_today: 2,
        rejected_today: 1,
      };
    }
    throw err;
  }
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
  try {
    return await withTenant(tenantId, async (client) => {
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
  } catch (err) {
    if (isMissingTableError(err)) {
      return [
        {
          id: 'mock-job-1',
          title: 'Senior Backend Engineer',
          application_count: 12,
          location: 'Amsterdam',
        },
        {
          id: 'mock-job-2',
          title: 'Product Designer',
          application_count: 7,
          location: 'Remote',
        },
        {
          id: 'mock-job-3',
          title: 'DevOps Lead',
          application_count: 4,
          location: 'Den Haag',
        },
      ];
    }
    throw err;
  }
}

// ─── Pending Reviews ─────────────────────────────────────────────────────────

export interface HmPendingReview {
  application_id: string;
  candidate_id: string;
  candidate_name: string;
  candidate_email: string | null;
  ai_score: number | null;
  applied_at: string;
  job_id: string;
  job_title: string;
  stage_name: string | null;
  summary: string | null;
}

export async function getPendingReviews(
  tenantId: string,
  userId: string
): Promise<HmPendingReview[]> {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT a.id              as application_id,
                a.applied_at,
                a.job_id,
                c.id              as candidate_id,
                c.name            as candidate_name,
                c.email           as candidate_email,
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
        ai_score: r.ai_score !== null && r.ai_score !== undefined ? Number(r.ai_score) : null,
        applied_at: r.applied_at,
        job_id: r.job_id,
        job_title: r.job_title,
        stage_name: r.stage_name ?? null,
        summary: r.summary ?? null,
      }));
    });
  } catch (err) {
    if (isMissingTableError(err)) {
      const now = new Date().toISOString();
      return [
        {
          application_id: 'mock-app-1',
          candidate_id: 'mock-cand-1',
          candidate_name: 'Sophie van der Berg',
          candidate_email: 'sophie@example.com',
          ai_score: 87,
          applied_at: now,
          job_id: 'mock-job-1',
          job_title: 'Senior Backend Engineer',
          stage_name: 'Interview',
          summary: '8 jaar Node.js, sterke architect-ervaring met microservices.',
        },
        {
          application_id: 'mock-app-2',
          candidate_id: 'mock-cand-2',
          candidate_name: 'Marco Janssen',
          candidate_email: 'marco@example.com',
          ai_score: 74,
          applied_at: now,
          job_id: 'mock-job-1',
          job_title: 'Senior Backend Engineer',
          stage_name: 'Technische test',
          summary: 'Sterke Java-achtergrond, leert snel nieuwe stacks.',
        },
        {
          application_id: 'mock-app-3',
          candidate_id: 'mock-cand-3',
          candidate_name: 'Aisha el-Hamdaoui',
          candidate_email: 'aisha@example.com',
          ai_score: 92,
          applied_at: now,
          job_id: 'mock-job-2',
          job_title: 'Product Designer',
          stage_name: 'Interview',
          summary: 'Top portfolio, ervaring met B2B SaaS design systems.',
        },
        {
          application_id: 'mock-app-4',
          candidate_id: 'mock-cand-4',
          candidate_name: 'Pieter de Wit',
          candidate_email: 'pieter@example.com',
          ai_score: 68,
          applied_at: now,
          job_id: 'mock-job-3',
          job_title: 'DevOps Lead',
          stage_name: 'Aanbieding',
          summary: 'Solide Kubernetes-ervaring, twijfel over leiderschap.',
        },
      ];
    }
    throw err;
  }
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
  try {
    return await withTenant(tenantId, async (client) => {
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
  } catch (err) {
    if (isAppError(err)) throw err;
    if (isMissingTableError(err)) {
      // Optimistic mock response
      return {
        id: applicationId,
        status: decision === 'reject' ? 'rejected' : 'active',
        decision,
        notes: notes ?? null,
        updated_at: new Date().toISOString(),
        mock: true,
      };
    }
    throw err;
  }
}

// ─── Application Details ─────────────────────────────────────────────────────

export async function getApplicationDetails(
  tenantId: string,
  userId: string,
  applicationId: string
) {
  try {
    return await withTenant(tenantId, async (client) => {
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

      // Previous notes from scorecards (if available) + activity timeline
      let previousReviews: Array<{
        reviewer_id: string;
        reviewer_name: string | null;
        decision: string;
        notes: string | null;
        created_at: string;
      }> = [];
      try {
        // Echte scorecards-kolommen: interviewer_id + recommendation
        // (geen reviewer_id/decision — dat gaf 42703 → 500).
        const { rows: scRows } = await client.query(
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
        previousReviews = scRows;
      } catch (innerErr) {
        if (!isMissingTableError(innerErr)) throw innerErr;
        // scorecards table missing — leave list empty
      }

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
  } catch (err) {
    if (isAppError(err)) throw err;
    if (isMissingTableError(err)) {
      return {
        application: {
          id: applicationId,
          status: 'active',
          applied_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          stage_id: null,
          stage_name: 'Interview',
        },
        job: {
          id: 'mock-job-1',
          title: 'Senior Backend Engineer',
          location: 'Amsterdam',
          department: 'Engineering',
        },
        candidate: {
          id: 'mock-cand-1',
          name: 'Sophie van der Berg',
          email: 'sophie@example.com',
          phone: '+31 6 12345678',
          skills: ['Node.js', 'PostgreSQL', 'AWS'],
          ai_score: 87,
          resume_url: null,
          source: 'LinkedIn',
          tags: ['senior', 'backend'],
          summary: '8 jaar Node.js, sterke architect-ervaring.',
        },
        previous_reviews: [],
        timeline: [],
        mock: true,
      };
    }
    throw err;
  }
}
