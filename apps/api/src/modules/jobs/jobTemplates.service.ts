/**
 * Job templates — herbruikbare blueprints voor `jobs`.
 *
 * Twee paden:
 *   - listJobTemplates / get / create / delete           (CRUD)
 *   - instantiateFromTemplate                            (template → job)
 *   - duplicateJob (template-based)                      (job → template → job)
 *
 * Een job-template is een JSONB-snapshot van mutable job-velden. Bij
 * instantiate halen we het JSONB op, mergen met overrides, en delegeren
 * naar `jobsService.createJob` zodat de bestaande pipeline-template /
 * audit / embedding-flow ongewijzigd blijft.
 */

import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import { createJob, type CreateJobInput } from './jobs.service';

export interface JobTemplate {
  id: string;
  tenant_id: string | null;
  name: string;
  description: string | null;
  job_data: Record<string, unknown>;
  is_system: boolean;
  created_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTemplate(row: Record<string, unknown>): JobTemplate {
  return {
    ...(row as unknown as JobTemplate),
    job_data: parseJsonObject(row.job_data),
  };
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Mutable job-velden die we in een template opslaan. Komt overeen met
 * MUTABLE_JOB_COLUMNS in jobs.service.ts. We hardcoderen ze hier zodat een
 * wijziging in jobs.service merkbaar is via de tests.
 */
const TEMPLATEABLE_JOB_FIELDS = [
  'title',
  'description',
  'department',
  'location',
  'salary_min',
  'salary_max',
  'employment_type',
  'recruiter_id',
  'headcount',
  'experience_level',
  'contract_type',
  'contract_details',
  'open_date',
  'close_date',
  'industry',
  'remote_type',
  'office_address',
  'package_details',
  'currency',
  'salary_frequency',
  'required_skills',
  'nice_to_have_skills',
  // status wordt bewust NIET overgenomen — instantiate start altijd 'draft'
] as const;

function pickTemplateableFields(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of TEMPLATEABLE_JOB_FIELDS) {
    if (source[f] !== undefined && source[f] !== null) {
      out[f] = source[f];
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// CRUD
// ────────────────────────────────────────────────────────────────────────────

export async function listJobTemplates(tenantId: string): Promise<JobTemplate[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM job_templates
       WHERE (tenant_id IS NULL OR tenant_id = $1)
         AND deleted_at IS NULL
       ORDER BY is_system DESC, name ASC`,
      [tenantId]
    );
    return rows.map(rowToTemplate);
  });
}

export async function getJobTemplate(
  tenantId: string,
  id: string
): Promise<JobTemplate> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM job_templates
       WHERE id = $1
         AND (tenant_id IS NULL OR tenant_id = $2)
         AND deleted_at IS NULL`,
      [id, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'JOB_TEMPLATE_NOT_FOUND', 'Job-template niet gevonden');
    }
    return rowToTemplate(rows[0]);
  });
}

export async function createJobTemplate(
  tenantId: string,
  userId: string,
  name: string,
  jobData: Record<string, unknown>,
  description: string | null = null,
  ctx: AuditContext = {}
): Promise<JobTemplate> {
  if (!name || name.trim().length === 0) {
    throw new AppError(400, 'NAME_REQUIRED', 'Template-naam is verplicht');
  }

  const cleanData = pickTemplateableFields(jobData);

  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO job_templates
         (tenant_id, name, description, job_data, is_system, created_by)
       VALUES ($1, $2, $3, $4::jsonb, FALSE, $5)
       RETURNING *`,
      [tenantId, name, description, JSON.stringify(cleanData), userId]
    );
    const tmpl = rowToTemplate(rows[0]);

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.JOB_TEMPLATE_CREATED,
        entityType: 'job_template',
        entityId: tmpl.id,
        after: { name: tmpl.name, fields: Object.keys(cleanData) },
        userId,
      },
      ctx
    );

    return tmpl;
  });
}

export async function deleteJobTemplate(
  tenantId: string,
  userId: string,
  id: string,
  ctx: AuditContext = {}
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    // System templates (tenant_id NULL) mogen NIET door tenants weg —
    // deze policy beschermt de TalentFlow-leverbare set.
    const { rows: existing } = await client.query(
      `SELECT id, tenant_id, name, is_system FROM job_templates WHERE id = $1`,
      [id]
    );
    if (existing.length === 0) {
      throw new AppError(404, 'JOB_TEMPLATE_NOT_FOUND', 'Job-template niet gevonden');
    }
    const row = existing[0] as { tenant_id: string | null; is_system: boolean; name: string };
    if (row.is_system || row.tenant_id === null) {
      throw new AppError(403, 'SYSTEM_TEMPLATE', 'System-templates kunnen niet worden verwijderd');
    }
    if (row.tenant_id !== tenantId) {
      // RLS zou dit ook al blokkeren maar we falen hier expliciet voor duidelijkheid.
      throw new AppError(404, 'JOB_TEMPLATE_NOT_FOUND', 'Job-template niet gevonden');
    }

    await client.query(
      `UPDATE job_templates SET deleted_at = now() WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.JOB_TEMPLATE_DELETED,
        entityType: 'job_template',
        entityId: id,
        before: row,
        userId,
      },
      ctx
    );
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Instantiate
// ────────────────────────────────────────────────────────────────────────────

/**
 * Instantieer een nieuwe job uit een template. Overrides hebben voorrang
 * boven template-velden. Delegeert naar jobsService.createJob — daarmee
 * krijgt de nieuwe job pipeline-stages, audit, en embedding-queue.
 */
export async function instantiateFromTemplate(
  tenantId: string,
  userId: string,
  templateId: string,
  overrides: Partial<CreateJobInput> = {},
  ctx: AuditContext = {}
): Promise<unknown> {
  const tmpl = await getJobTemplate(tenantId, templateId);

  const merged: CreateJobInput = {
    ...(tmpl.job_data as unknown as CreateJobInput),
    ...overrides,
    title: (overrides.title ?? (tmpl.job_data.title as string | undefined) ?? tmpl.name),
  };

  const created = await createJob(tenantId, userId, merged, ctx);

  // Audit-trail: koppel job → template voor traceability.
  await withTenant(tenantId, async (client) => {
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.JOB_INSTANTIATED_FROM_TEMPLATE,
        entityType: 'job',
        entityId: (created as { id: string }).id,
        after: { template_id: templateId, template_name: tmpl.name },
        userId,
      },
      ctx
    );
  });

  return created;
}

/**
 * Job dupliceren — implementatie als "template flow":
 *   1) Snapshot bron-job-velden in een ad-hoc dict
 *   2) Mergen met overrides
 *   3) Delegeer naar createJob (die regenereert reference, pipeline, etc.)
 *
 * Wordt gebruikt door de jobs.controller's `duplicateJob` route. De legacy
 * `jobsService.duplicateJob` blijft bestaan voor backwards compat.
 */
export async function duplicateJob(
  tenantId: string,
  userId: string,
  jobId: string,
  overrides: Partial<CreateJobInput> = {},
  ctx: AuditContext = {}
): Promise<unknown> {
  const source = await withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM jobs WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [jobId, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');
    }
    return rows[0] as Record<string, unknown>;
  });

  const snapshot = pickTemplateableFields(source);
  const merged: CreateJobInput = {
    ...(snapshot as unknown as CreateJobInput),
    ...overrides,
    title:
      overrides.title ??
      `${(source.title as string | undefined) ?? 'Untitled'} (kopie)`,
  };

  return createJob(tenantId, userId, merged, ctx);
}
