import type { PoolClient } from 'pg';
import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { emitWorkflowEvent } from '../workflows/workflowEmitter';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import { pushNewCandidateForReview } from '../../lib/pushEvents';
import { logger } from '../../middleware/errorHandler';

/** Pipeline-stages waar een Hiring Manager review op moet doen. */
const HM_REVIEW_STAGE_NAMES = [
  'Hiring Manager Review',
  'Interview',
  'Technische test',
];

// ── Pipeline templates → stages ───────────────────────────────────────────────

/** UUID of the seeded "Bureau Pipeline" system template (migration 002). */
export const BUREAU_PIPELINE_TEMPLATE_ID =
  '00000000-0000-0000-0000-000000000001';

/**
 * Resolves which pipeline template to apply when a job is created.
 *
 * Resolution order:
 *   1. The explicit `templateId` argument, if provided. Must be visible to
 *      the tenant (system template OR owned by tenant).
 *   2. The system default (is_default = TRUE AND is_system = TRUE).
 *   3. The hardcoded BUREAU_PIPELINE_TEMPLATE_ID as a last-resort fallback,
 *      so a fresh DB without seed still gets a deterministic answer.
 *
 * Returns the resolved template id, or null if no usable template exists.
 * Use the returned id with `instantiateTemplateStagesForJob`.
 */
export async function resolvePipelineTemplateId(
  client: PoolClient,
  tenantId: string,
  templateId?: string | null
): Promise<string | null> {
  if (templateId) {
    // RLS already restricts visibility (tenant_id IS NULL OR matches tenant),
    // but we double-check for a clear 400 instead of a silent miss.
    const { rows } = await client.query(
      `SELECT id FROM pipeline_templates
       WHERE id = $1 AND (tenant_id IS NULL OR tenant_id = $2)
       LIMIT 1`,
      [templateId, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(
        400,
        'INVALID_PIPELINE_TEMPLATE',
        'Pipeline-template niet gevonden of niet toegankelijk voor deze tenant'
      );
    }
    return rows[0].id;
  }

  // Lookup the system default. Prefer system+default; fall back to any default.
  const { rows: defaults } = await client.query(
    `SELECT id FROM pipeline_templates
     WHERE is_default = TRUE
       AND (tenant_id IS NULL OR tenant_id = $1)
     ORDER BY is_system DESC, tenant_id NULLS LAST
     LIMIT 1`,
    [tenantId]
  );
  if (defaults[0]) return defaults[0].id;

  // Last resort: known seeded UUID.
  const { rows: bureau } = await client.query(
    `SELECT id FROM pipeline_templates WHERE id = $1 LIMIT 1`,
    [BUREAU_PIPELINE_TEMPLATE_ID]
  );
  return bureau[0]?.id ?? null;
}

/**
 * Clones pipeline_template_stages → pipeline_stages for the given job.
 * Idempotent: if the job already has stages, no-op (returns the existing
 * count). This makes it safe to call on retry or via a future "apply
 * template" endpoint when the job is still empty.
 *
 * Returns the number of stages now present on the job.
 */
export async function instantiateTemplateStagesForJob(
  client: PoolClient,
  tenantId: string,
  jobId: string,
  templateId: string
): Promise<number> {
  // Idempotency guard: if any stages exist for this job, skip insert.
  const { rows: existing } = await client.query(
    `SELECT COUNT(*)::int AS n FROM pipeline_stages
     WHERE job_id = $1 AND tenant_id = $2`,
    [jobId, tenantId]
  );
  if (existing[0].n > 0) return existing[0].n;

  // Single INSERT…SELECT keeps it atomic and avoids a per-stage round-trip.
  const { rowCount } = await client.query(
    `INSERT INTO pipeline_stages (tenant_id, job_id, name, position, color)
     SELECT $1, $2, pts.name, pts.position, pts.color
       FROM pipeline_template_stages pts
      WHERE pts.template_id = $3
      ORDER BY pts.position ASC`,
    [tenantId, jobId, templateId]
  );

  return rowCount ?? 0;
}

/**
 * Applies a pipeline template to an existing job. Used by the (future)
 * PATCH endpoint that lets users swap templates after creation. Only
 * allowed when the job has no stages yet (otherwise we'd silently lose
 * stage history / application stage assignments).
 */
export async function applyPipelineTemplateToJob(
  tenantId: string,
  jobId: string,
  templateId?: string
) {
  return withTenant(tenantId, async (client) => {
    const { rows: [job] } = await client.query(
      `SELECT id FROM jobs WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [jobId, tenantId]
    );
    if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');

    const resolvedId = await resolvePipelineTemplateId(client, tenantId, templateId);
    if (!resolvedId) {
      throw new AppError(
        500,
        'NO_PIPELINE_TEMPLATE',
        'Geen pipeline-template beschikbaar (seed ontbreekt?)'
      );
    }

    const count = await instantiateTemplateStagesForJob(
      client,
      tenantId,
      jobId,
      resolvedId
    );
    return { template_id: resolvedId, stage_count: count };
  });
}

// ── Stages ────────────────────────────────────────────────────────────────────

export async function getStagesForJob(tenantId: string, jobId: string) {
  return withTenant(tenantId, async (client) => {
    // Verify job exists
    const { rows: [job] } = await client.query(
      `SELECT id FROM jobs WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [jobId, tenantId]
    );
    if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');

    const { rows } = await client.query(
      `SELECT ps.id, ps.name, ps.position, ps.color, ps.created_at,
              COUNT(a.id) as application_count
       FROM pipeline_stages ps
       LEFT JOIN applications a ON a.stage_id = ps.id AND a.status = 'active'
       WHERE ps.job_id = $1 AND ps.tenant_id = $2
       GROUP BY ps.id
       ORDER BY ps.position ASC`,
      [jobId, tenantId]
    );
    return rows;
  });
}

export async function createStage(
  tenantId: string,
  jobId: string,
  data: { name: string; color?: string; position?: number }
) {
  return withTenant(tenantId, async (client) => {
    const { rows: [job] } = await client.query(
      `SELECT id FROM jobs WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [jobId, tenantId]
    );
    if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');

    let position = data.position;
    if (position === undefined) {
      const { rows: [maxRow] } = await client.query(
        `SELECT COALESCE(MAX(position), 0) + 1 as next_pos FROM pipeline_stages WHERE job_id = $1`,
        [jobId]
      );
      position = maxRow.next_pos;
    }

    const { rows: [stage] } = await client.query(
      `INSERT INTO pipeline_stages (tenant_id, job_id, name, position, color)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [tenantId, jobId, data.name, position, data.color ?? '#6366f1']
    );

    return stage;
  });
}

export async function updateStage(
  tenantId: string,
  stageId: string,
  data: { name?: string; color?: string; position?: number }
) {
  return withTenant(tenantId, async (client) => {
    const { rows: [existing] } = await client.query(
      `SELECT id FROM pipeline_stages WHERE id = $1 AND tenant_id = $2`,
      [stageId, tenantId]
    );
    if (!existing) throw new AppError(404, 'STAGE_NOT_FOUND', 'Pipelinefase niet gevonden');

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
    if (data.color !== undefined) { fields.push(`color = $${idx++}`); values.push(data.color); }
    if (data.position !== undefined) { fields.push(`position = $${idx++}`); values.push(data.position); }

    if (fields.length === 0) throw new AppError(400, 'NO_FIELDS', 'Geen velden om bij te werken');

    values.push(stageId, tenantId);

    const { rows: [stage] } = await client.query(
      `UPDATE pipeline_stages SET ${fields.join(', ')}
       WHERE id = $${idx++} AND tenant_id = $${idx}
       RETURNING *`,
      values
    );

    return stage;
  });
}

export async function deleteStage(
  tenantId: string,
  stageId: string
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    const { rows: [stage] } = await client.query(
      `SELECT id, job_id, position FROM pipeline_stages WHERE id = $1 AND tenant_id = $2`,
      [stageId, tenantId]
    );
    if (!stage) throw new AppError(404, 'STAGE_NOT_FOUND', 'Pipelinefase niet gevonden');

    // Find previous stage to move applications to
    const { rows: [prevStage] } = await client.query(
      `SELECT id FROM pipeline_stages
       WHERE job_id = $1 AND tenant_id = $2 AND position < $3
       ORDER BY position DESC LIMIT 1`,
      [stage.job_id, tenantId, stage.position]
    );

    // Move applications to previous stage (or null if no previous)
    await client.query(
      `UPDATE applications SET stage_id = $1, updated_at = now()
       WHERE stage_id = $2 AND tenant_id = $3`,
      [prevStage?.id ?? null, stageId, tenantId]
    );

    await client.query(
      `DELETE FROM pipeline_stages WHERE id = $1 AND tenant_id = $2`,
      [stageId, tenantId]
    );
  });
}

// ── Applications ──────────────────────────────────────────────────────────────

export async function getApplicationsForJob(tenantId: string, jobId: string) {
  return withTenant(tenantId, async (client) => {
    const { rows: [job] } = await client.query(
      `SELECT id FROM jobs WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [jobId, tenantId]
    );
    if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');

    // Get stages
    const { rows: stages } = await client.query(
      `SELECT id, name, position, color FROM pipeline_stages WHERE job_id = $1 AND tenant_id = $2 ORDER BY position`,
      [jobId, tenantId]
    );

    // Get all active applications with candidate info
    const { rows: applications } = await client.query(
      `SELECT a.id, a.candidate_id, a.stage_id, a.status, a.applied_at, a.updated_at,
              c.name as candidate_name, c.email as candidate_email,
              c.phone as candidate_phone, c.skills as candidate_skills,
              c.ai_score, c.resume_url, c.source
       FROM applications a
       JOIN candidates c ON c.id = a.candidate_id
       WHERE a.job_id = $1 AND a.tenant_id = $2 AND a.status = 'active'
       ORDER BY a.applied_at DESC`,
      [jobId, tenantId]
    );

    // Group by stage
    const grouped: Record<string, { stage: typeof stages[0]; applications: typeof applications }> = {};

    for (const stage of stages) {
      grouped[stage.id] = { stage, applications: [] };
    }
    // Also add an "unassigned" bucket
    const unassigned: typeof applications = [];

    for (const app of applications) {
      if (app.stage_id && grouped[app.stage_id]) {
        grouped[app.stage_id].applications.push(app);
      } else {
        unassigned.push(app);
      }
    }

    return { stages: Object.values(grouped), unassigned };
  });
}

export async function addToPipeline(
  tenantId: string,
  userId: string,
  data: { job_id: string; candidate_id: string; stage_id?: string }
) {
  return withTenant(tenantId, async (client) => {
    // Validate job
    const { rows: [job] } = await client.query(
      `SELECT id FROM jobs WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [data.job_id, tenantId]
    );
    if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');

    // Validate candidate
    const { rows: [candidate] } = await client.query(
      `SELECT id FROM candidates WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [data.candidate_id, tenantId]
    );
    if (!candidate) throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');

    // Determine stage — use first stage if not specified
    let stageId = data.stage_id ?? null;
    if (!stageId) {
      const { rows: [firstStage] } = await client.query(
        `SELECT id FROM pipeline_stages WHERE job_id = $1 AND tenant_id = $2 ORDER BY position ASC LIMIT 1`,
        [data.job_id, tenantId]
      );
      stageId = firstStage?.id ?? null;
    }

    const { rows: [application] } = await client.query(
      `INSERT INTO applications (tenant_id, job_id, candidate_id, stage_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, job_id, candidate_id) DO NOTHING
       RETURNING *`,
      [tenantId, data.job_id, data.candidate_id, stageId]
    );

    if (!application) {
      throw new AppError(409, 'ALREADY_APPLIED', 'Kandidaat is al toegevoegd aan deze vacature');
    }

    await client.query(
      `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
       VALUES ($1, 'application', $2, $3, 'added_to_pipeline', $4)`,
      [tenantId, application.id, userId, JSON.stringify({ job_id: data.job_id, candidate_id: data.candidate_id })]
    );

    return application;
  });
}

export async function updateApplication(
  tenantId: string,
  applicationId: string,
  userId: string,
  data: { stage_id?: string | null; status?: string },
  ctx: AuditContext = {}
) {
  const { application, stageTransition } = await withTenant(tenantId, async (client) => {
    const { rows: [existing] } = await client.query(
      `SELECT id, stage_id, status, candidate_id, job_id
       FROM applications WHERE id = $1 AND tenant_id = $2`,
      [applicationId, tenantId]
    );
    if (!existing) throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Sollicitatie niet gevonden');

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.stage_id !== undefined) {
      // Validate stage belongs to same job
      if (data.stage_id !== null) {
        const { rows: [stage] } = await client.query(
          `SELECT ps.id FROM pipeline_stages ps
           JOIN applications a ON a.job_id = ps.job_id
           WHERE ps.id = $1 AND a.id = $2 AND ps.tenant_id = $3`,
          [data.stage_id, applicationId, tenantId]
        );
        if (!stage) throw new AppError(400, 'INVALID_STAGE', 'Ongeldige pipelinefase voor deze vacature');
      }
      fields.push(`stage_id = $${idx++}`);
      values.push(data.stage_id);
    }

    if (data.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(data.status);
    }

    if (fields.length === 0) throw new AppError(400, 'NO_FIELDS', 'Geen velden om bij te werken');

    fields.push(`updated_at = now()`);
    values.push(applicationId, tenantId);

    const { rows: [application] } = await client.query(
      `UPDATE applications SET ${fields.join(', ')}
       WHERE id = $${idx++} AND tenant_id = $${idx}
       RETURNING *`,
      values
    );

    const action = data.stage_id ? 'stage_changed' : 'status_changed';
    await client.query(
      `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
       VALUES ($1, 'application', $2, $3, $4, $5)`,
      [tenantId, applicationId, userId, action, JSON.stringify(data)]
    );

    // If the stage actually changed, capture the transition for post-commit emit.
    const stageTransition =
      data.stage_id !== undefined && data.stage_id !== existing.stage_id
        ? {
            from_stage: existing.stage_id as string | null,
            to_stage: (data.stage_id ?? null) as string | null,
            candidate_id: existing.candidate_id as string,
            job_id: existing.job_id as string,
          }
        : null;

    // ─── Audit-log (Q1.2 follow-up) ──────────────────────────────────────
    // Drie scenario's:
    //  1. Stage-change → APPLICATION_STAGE_CHANGED (with from/to)
    //  2. Status='rejected' → APPLICATION_REJECTED
    //  3. Status='hired' → APPLICATION_HIRED
    // We schrijven beide events los wanneer er tegelijk een stage-change
    // én status-change is — dat is de cleanste audit-trail.
    if (stageTransition) {
      await logAudit(
        client,
        tenantId,
        {
          action: AuditActions.APPLICATION_STAGE_CHANGED,
          entityType: 'application',
          entityId: applicationId,
          before: {
            stage_id: existing.stage_id,
            status: existing.status,
          },
          after: {
            stage_id: application.stage_id,
            status: application.status,
            from_stage: stageTransition.from_stage,
            to_stage: stageTransition.to_stage,
            candidate_id: stageTransition.candidate_id,
            job_id: stageTransition.job_id,
          },
          userId,
        },
        ctx
      );
    }

    if (
      data.status !== undefined &&
      data.status !== existing.status &&
      (data.status === 'rejected' || data.status === 'hired')
    ) {
      await logAudit(
        client,
        tenantId,
        {
          action:
            data.status === 'rejected'
              ? AuditActions.APPLICATION_REJECTED
              : AuditActions.APPLICATION_HIRED,
          entityType: 'application',
          entityId: applicationId,
          before: { status: existing.status },
          after: {
            status: application.status,
            candidate_id: existing.candidate_id,
            job_id: existing.job_id,
          },
          userId,
        },
        ctx
      );
    }

    return { application, stageTransition };
  });

  // Post-commit emit for the workflow engine. entityId = application_id by
  // contract for the `candidate.stage_changed` trigger; the action executors
  // use `payload.candidate_id` / `payload.job_id` when needed.
  if (stageTransition) {
    await emitWorkflowEvent(tenantId, 'candidate.stage_changed', applicationId, {
      ...stageTransition,
      user_id: userId,
    });

    // Sprint Q2.4 — push de Hiring Manager wanneer een kandidaat
    // doorschuift naar een HM-review stage. Faal-tolerant: een fout
    // hier mag de pipeline-update nooit ongedaan maken.
    void notifyHiringManagerOnStageChange(
      tenantId,
      applicationId,
      stageTransition.to_stage,
      stageTransition.candidate_id,
      stageTransition.job_id
    );
  }

  return application;
}

/**
 * Background notify-helper: detecteer of de nieuwe stage een HM-review
 * stage is en stuur dan een push naar alle hiring_managers + de
 * recruiter van de job.
 *
 * Errors gaan naar de logger maar bubbelen niet — push-fail mag de
 * stage-transition niet ongedaan maken.
 */
async function notifyHiringManagerOnStageChange(
  tenantId: string,
  applicationId: string,
  toStageId: string | null,
  candidateId: string,
  jobId: string
): Promise<void> {
  if (!toStageId) return;

  try {
    const data = await withTenant(tenantId, async (client) => {
      const { rows: stageRows } = await client.query(
        `SELECT name FROM pipeline_stages WHERE id = $1 AND tenant_id = $2`,
        [toStageId, tenantId]
      );
      if (stageRows.length === 0) return null;
      const stageName = stageRows[0].name as string;
      if (!HM_REVIEW_STAGE_NAMES.includes(stageName)) return null;

      const { rows: jobRows } = await client.query(
        `SELECT id, title, recruiter_id FROM jobs
         WHERE id = $1 AND tenant_id = $2`,
        [jobId, tenantId]
      );
      if (jobRows.length === 0) return null;
      const job = jobRows[0];

      const { rows: candRows } = await client.query(
        `SELECT name FROM candidates WHERE id = $1 AND tenant_id = $2`,
        [candidateId, tenantId]
      );
      const candidateName = candRows[0]?.name ?? 'Kandidaat';

      // Hiring managers via job_team_members; defensive try/catch voor envs
      // waar de tabel nog niet bestaat (oudere migraties).
      let hmUserIds: string[] = [];
      try {
        const { rows: hmRows } = await client.query(
          `SELECT user_id FROM job_team_members
           WHERE job_id = $1 AND tenant_id = $2 AND role = 'hiring_manager'`,
          [jobId, tenantId]
        );
        hmUserIds = hmRows.map((r) => r.user_id as string);
      } catch (err) {
        if ((err as { code?: string })?.code !== '42P01') throw err;
      }

      // Fallback: als geen expliciete HM is toegewezen, push de recruiter
      // (die is in een MKB-setup vaak ook de HM).
      if (hmUserIds.length === 0 && job.recruiter_id) {
        hmUserIds = [job.recruiter_id];
      }

      return { hmUserIds, candidateName, jobTitle: job.title as string };
    });

    if (!data) return;

    for (const userId of data.hmUserIds) {
      await pushNewCandidateForReview(
        tenantId,
        userId,
        data.candidateName,
        data.jobTitle,
        candidateId,
        applicationId
      );
    }
  } catch (err) {
    logger.error('[pipeline] HM push notify failed', {
      applicationId,
      error: (err as Error).message,
    });
  }
}

export async function removeApplication(
  tenantId: string,
  applicationId: string,
  userId: string
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    const { rows: [app] } = await client.query(
      `DELETE FROM applications WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [applicationId, tenantId]
    );
    if (!app) throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Sollicitatie niet gevonden');

    await client.query(
      `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
       VALUES ($1, 'application', $2, $3, 'removed_from_pipeline', '{}')`,
      [tenantId, applicationId, userId]
    );
  });
}
