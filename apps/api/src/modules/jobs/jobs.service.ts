import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import {
  instantiateTemplateStagesForJob,
  resolvePipelineTemplateId,
} from '../pipeline/pipeline.service';
import { emitWorkflowEvent } from '../workflows/workflowEmitter';
import { queueEmbedding } from '../matching/matchingEmitter';
import { autoPostJobToBoards } from '../job-boards/autoPost.service';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import { setValuesForEntity } from '../custom-fields/customFields.service';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full mutable column set on `jobs` after migrations 001 + 007. Used to build
 * dynamic INSERT/UPDATE statements without enumerating columns multiple
 * times. Order matches the migrations for grep-ability.
 *
 * Pipeline-related columns (e.g. `pipeline_template_id`) are intentionally
 * excluded — those flow through the pipeline service. `tenant_id`, `id` and
 * timestamps are managed by withTenant() / DB defaults.
 */
const MUTABLE_JOB_COLUMNS = [
  // Core (001_init.sql)
  'title',
  'description',
  'department',
  'location',
  'salary_min',
  'salary_max',
  'employment_type',
  'status',
  'recruiter_id',
  'organization_id',

  // Manatal-pariteit (007_job_detail_expansion.sql)
  'job_reference',
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

  // Pay Transparency (021_pay_transparency_dei.sql) — `salary_band_disclosed`
  // is GENERATED en bewust NIET muteerbaar; deze twee wél. Zonder deze
  // entries werden compensation_criteria/pay_transparency_required door
  // create/update stilletjes gedropt terwijl de contracts ze accepteren.
  'pay_transparency_required',
  'compensation_criteria',
] as const;

type MutableJobColumn = (typeof MUTABLE_JOB_COLUMNS)[number];

/**
 * Expliciete kolom-projectie voor RETURNING-clauses (create/update/duplicate).
 * Mirror't JobRowSchema en sluit `embedding`(vector(1536)) +
 * `embedding_updated_at` BEWUST uit: die horen niet in de API-wire-shape (intern,
 * alleen voor matching) en zouden per job ~15-30KB payload-bloat + een lek van
 * een intern veld opleveren. `RETURNING *` deed dat wél. getJob gebruikt exact
 * dezelfde lijst (met `j.`-alias) — hier zonder alias want RETURNING op de
 * ongeprefixte `jobs`-tabel.
 */
const JOB_RETURNING_COLUMNS = `id, tenant_id, title, description, department, location,
       salary_min, salary_max, employment_type, status, recruiter_id, organization_id,
       deleted_at, created_at, updated_at, job_reference, headcount, experience_level,
       contract_type, contract_details, open_date, close_date, industry, remote_type,
       office_address, package_details, currency, salary_frequency, required_skills,
       nice_to_have_skills, pay_transparency_required, salary_band_disclosed,
       compensation_criteria`;

/**
 * Alphabet excluding visually ambiguous chars (O/0, I/1) — matches the
 * candidate-reference style. 6 alphanumeric chars after the JOB- prefix.
 */
const JOB_REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOB_REFERENCE_LENGTH = 6;

const REFERENCE_RETRY_LIMIT = 1;

/** PostgreSQL unique-violation SQLSTATE. */
const PG_UNIQUE_VIOLATION = '23505';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function generateJobReference(): string {
  let out = 'JOB-';
  for (let i = 0; i < JOB_REFERENCE_LENGTH; i++) {
    out +=
      JOB_REFERENCE_ALPHABET[
        Math.floor(Math.random() * JOB_REFERENCE_ALPHABET.length)
      ];
  }
  return out;
}

/**
 * Builds the (columns, placeholders, values) tuple for an INSERT from a
 * validated payload. Only includes keys that are explicitly present
 * (i.e. !== undefined) so we let DB defaults apply otherwise.
 */
function buildInsertColumns(
  data: Record<string, unknown>,
  startIndex: number
): { cols: string[]; placeholders: string[]; values: unknown[]; nextIndex: number } {
  const cols: string[] = [];
  const placeholders: string[] = [];
  const values: unknown[] = [];
  let idx = startIndex;

  for (const col of MUTABLE_JOB_COLUMNS) {
    if (data[col] === undefined) continue;
    cols.push(col);
    placeholders.push(`$${idx++}`);
    values.push(data[col] ?? null);
  }
  return { cols, placeholders, values, nextIndex: idx };
}

// ─────────────────────────────────────────────────────────────────────────────
// List
// ─────────────────────────────────────────────────────────────────────────────

export interface JobListOptions {
  page: number;
  limit: number;
  status?: string;
  recruiterId?: string;
}

export async function listJobs(tenantId: string, opts: JobListOptions) {
  return withTenant(tenantId, async (client) => {
    const conditions: string[] = [`j.tenant_id = $1`, `j.deleted_at IS NULL`];
    const values: unknown[] = [tenantId];
    let idx = 2;

    if (opts.status) {
      conditions.push(`j.status = $${idx++}`);
      values.push(opts.status);
    }

    if (opts.recruiterId) {
      conditions.push(`j.recruiter_id = $${idx++}`);
      values.push(opts.recruiterId);
    }

    const where = conditions.join(' AND ');
    const offset = (opts.page - 1) * opts.limit;

    const { rows: countRows } = await client.query(
      `SELECT COUNT(*) as total FROM jobs j WHERE ${where}`,
      values
    );
    const total = parseInt(countRows[0].total, 10);

    const { rows } = await client.query(
      `SELECT j.id, j.title, j.description, j.department, j.location,
              j.salary_min, j.salary_max,
              j.employment_type, j.status, j.recruiter_id, j.organization_id,
              j.created_at, j.updated_at,
              j.job_reference, j.headcount, j.experience_level, j.contract_type,
              j.industry, j.remote_type, j.open_date, j.close_date,
              j.currency, j.salary_frequency,
              u.name as recruiter_name,
              o.name as organization_name,
              COUNT(DISTINCT a.id) as application_count
       FROM jobs j
       LEFT JOIN users u ON u.id = j.recruiter_id
       LEFT JOIN organizations o ON o.id = j.organization_id
       LEFT JOIN applications a ON a.job_id = j.id AND a.status = 'active'
       WHERE ${where}
       GROUP BY j.id, u.name, o.name
       ORDER BY j.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, opts.limit, offset]
    );

    return {
      data: rows,
      meta: { total, page: opts.page, limit: opts.limit, pages: Math.ceil(total / opts.limit) },
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateJobInput {
  title: string;
  description?: string | null;
  department?: string | null;
  location?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  employment_type?: string | null;
  status?: string | null;
  recruiter_id?: string | null;
  organization_id?: string | null;

  // Manatal-pariteit
  job_reference?: string | null;
  headcount?: number | null;
  experience_level?: string | null;
  contract_type?: string | null;
  contract_details?: string | null;
  open_date?: string | null;
  close_date?: string | null;
  industry?: string | null;
  remote_type?: string | null;
  office_address?: string | null;
  package_details?: string | null;
  currency?: string | null;
  salary_frequency?: string | null;
  required_skills?: string[] | null;
  nice_to_have_skills?: string[] | null;

  // Pay Transparency (021)
  pay_transparency_required?: boolean | null;
  compensation_criteria?: string | null;

  /**
   * Per-tenant custom-field waarden (`key → value`). Geen `jobs`-kolom: wordt
   * ná de job-insert via setValuesForEntity (EAV-store) gepersisteerd +
   * gevalideerd tegen de tenant-definities.
   */
  custom_fields?: Record<string, unknown> | null;

  /**
   * Optional. Defaults to the system "Bureau Pipeline" template
   * (resolved by `resolvePipelineTemplateId`).
   */
  pipeline_template_id?: string;
}

export async function createJob(
  tenantId: string,
  userId: string,
  data: CreateJobInput,
  ctx: AuditContext = {}
) {
  const userSuppliedReference = data.job_reference !== undefined && data.job_reference !== null;
  // custom_fields is geen jobs-kolom → apart houden en ná de insert persisteren.
  const customFields = data.custom_fields ?? undefined;

  const job = await withTenant(tenantId, async (client) => {
    const maxAttempts = REFERENCE_RETRY_LIMIT + 1;
    let lastErr: unknown = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Auto-generate job_reference if not supplied
      const payload: Record<string, unknown> = { ...data };
      if (!payload.job_reference) {
        payload.job_reference = generateJobReference();
      }
      // Apply defaults the legacy createJob applied so behaviour is preserved.
      if (payload.employment_type === undefined) {
        payload.employment_type = 'fulltime';
      }
      if (payload.status === undefined) {
        payload.status = 'draft';
      }
      // Strip niet-kolom-velden uit de row payload (buildInsertColumns negeert
      // ze al, maar expliciet weg voor duidelijkheid).
      delete payload.pipeline_template_id;
      delete payload.custom_fields;

      const { cols, placeholders, values } = buildInsertColumns(payload, 2); // $1 = tenant_id

      const allCols = ['tenant_id', ...cols];
      const allPlaceholders = ['$1', ...placeholders];
      const allValues = [tenantId, ...values];

      const sql = `INSERT INTO jobs (${allCols.join(', ')})
                   VALUES (${allPlaceholders.join(', ')})
                   RETURNING ${JOB_RETURNING_COLUMNS}`;

      try {
        const { rows: [job] } = await client.query(sql, allValues);

        // Resolve template (explicit → system default → seeded Bureau UUID) and
        // clone its stages into pipeline_stages for this job. Idempotent on retry.
        const templateId = await resolvePipelineTemplateId(
          client,
          tenantId,
          data.pipeline_template_id
        );
        if (!templateId) {
          throw new AppError(
            500,
            'NO_PIPELINE_TEMPLATE',
            'Geen pipeline-template beschikbaar (seed ontbreekt?)'
          );
        }
        await instantiateTemplateStagesForJob(client, tenantId, job.id, templateId);

        await client.query(
          `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
           VALUES ($1, 'job', $2, $3, 'created', $4)`,
          [
            tenantId,
            job.id,
            userId,
            JSON.stringify({ title: data.title, pipeline_template_id: templateId }),
          ]
        );

        await logAudit(
          client,
          tenantId,
          {
            action: AuditActions.JOB_CREATED,
            entityType: 'job',
            entityId: job.id,
            after: { ...job, _pipeline_template_id: templateId },
            userId,
          },
          ctx
        );

        return job;
      } catch (err: unknown) {
        const e = err as { code?: string; constraint?: string };
        const isReferenceCollision =
          e.code === PG_UNIQUE_VIOLATION &&
          (e.constraint === 'uq_jobs_job_reference' ||
            (typeof e.constraint === 'string' && e.constraint.includes('job_reference')));

        const canRetry =
          !userSuppliedReference && isReferenceCollision && attempt < maxAttempts - 1;
        if (canRetry) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }

    // Unreachable in practice; loop returns or throws.
    throw new AppError(
      409,
      'REFERENCE_COLLISION',
      'Kon geen unieke job_reference genereren',
      { lastError: (lastErr as Error | null)?.message }
    );
  });

  // Custom-field waarden persisteren ná de commit (de job-row bestaat dan en is
  // zichtbaar voor de eigen withTenant-transactie van setValuesForEntity).
  // Validatie tegen de tenant-definities zit in setValuesForEntity. Alleen
  // aanroepen bij daadwerkelijke waarden zodat de gewone flow ongemoeid blijft.
  if (customFields && Object.keys(customFields).length > 0) {
    await setValuesForEntity(tenantId, userId, 'job', job.id, customFields, ctx);
  }

  // Post-commit emit so workflow worker only sees rows that actually persisted.
  await emitWorkflowEvent(tenantId, 'job.created', job.id, {
    job,
    user_id: userId,
  });

  // Slice 4: queue embedding-generatie zodat matching direct werkt na create.
  await queueEmbedding(tenantId, 'job', job.id);

  // Auto-post: een vacature die direct als 'open' wordt aangemaakt is óók een
  // publicatie. De pay-transparency-gate (enforcePayTransparency middleware)
  // is dan al gepasseerd, dus de band is compleet. Faalt nooit hard.
  if (job.status === 'open') {
    await autoPostJobToBoards(tenantId, job.id, userId);
  }

  return job;
}

// ─────────────────────────────────────────────────────────────────────────────
// Get
// ─────────────────────────────────────────────────────────────────────────────

export async function getJob(tenantId: string, jobId: string) {
  return withTenant(tenantId, async (client) => {
    // Expliciete kolommenlijst i.p.v. `j.*`: de `embedding`(vector(1536)) en
    // `embedding_updated_at` kolommen horen NIET in de API-wire-shape (intern,
    // alleen voor matching) en zouden `JobDetailSchema.strict()` in dev/test
    // laten falen met `unrecognized_keys`. Lijst mirrort JobRowSchema 1-op-1.
    const { rows: [job] } = await client.query(
      `SELECT j.id, j.tenant_id, j.title, j.description, j.department, j.location,
              j.salary_min, j.salary_max, j.employment_type, j.status,
              j.recruiter_id, j.organization_id, j.deleted_at, j.created_at, j.updated_at,
              j.job_reference, j.headcount, j.experience_level, j.contract_type,
              j.contract_details, j.open_date, j.close_date, j.industry,
              j.remote_type, j.office_address, j.package_details, j.currency,
              j.salary_frequency, j.required_skills, j.nice_to_have_skills,
              j.pay_transparency_required, j.salary_band_disclosed,
              j.compensation_criteria,
              u.name as recruiter_name
       FROM jobs j
       LEFT JOIN users u ON u.id = j.recruiter_id
       WHERE j.id = $1 AND j.tenant_id = $2 AND j.deleted_at IS NULL`,
      [jobId, tenantId]
    );

    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');
    }

    // Get stages with application counts
    const { rows: stages } = await client.query(
      `SELECT ps.id, ps.name, ps.position, ps.color,
              COUNT(a.id) as application_count
       FROM pipeline_stages ps
       LEFT JOIN applications a ON a.stage_id = ps.id AND a.status = 'active'
       WHERE ps.job_id = $1 AND ps.tenant_id = $2
       GROUP BY ps.id
       ORDER BY ps.position ASC`,
      [jobId, tenantId]
    );

    return { ...job, stages };
  });
}

/**
 * Variant van getJob die custom_fields hydrateert (Sprint Q1.2). Wordt door
 * de Q1.2 controller gebruikt; bestaande getJob blijft compat.
 */
export async function getJobWithCustomFields(
  tenantId: string,
  jobId: string
): Promise<Record<string, unknown>> {
  const job = await getJob(tenantId, jobId);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getValuesForEntity } = require('../custom-fields/customFields.service') as
    typeof import('../custom-fields/customFields.service');
  const customFields = await getValuesForEntity(tenantId, 'job', jobId);
  return { ...job, custom_fields: customFields };
}

// ─────────────────────────────────────────────────────────────────────────────
// Update
// ─────────────────────────────────────────────────────────────────────────────

export type UpdateJobInput = Partial<Omit<CreateJobInput, 'pipeline_template_id'>>;

export async function updateJob(
  tenantId: string,
  jobId: string,
  userId: string,
  data: UpdateJobInput,
  ctx: AuditContext = {}
) {
  const { job, becameFilled, becameOpen } = await withTenant(tenantId, async (client) => {
    // Volledig before-snapshot voor audit; we hadden alleen `id, status` —
    // dat is niet genoeg voor een diff in audit_events.
    const { rows: [existing] } = await client.query(
      `SELECT * FROM jobs WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [jobId, tenantId]
    );
    if (!existing) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const col of MUTABLE_JOB_COLUMNS) {
      const key = col as MutableJobColumn;
      if ((data as Record<string, unknown>)[key] === undefined) continue;
      fields.push(`${col} = $${idx++}`);
      values.push((data as Record<string, unknown>)[key]);
    }

    if (fields.length === 0) {
      throw new AppError(400, 'NO_FIELDS', 'Geen velden om bij te werken');
    }

    // Leg het hire-moment vast zodra de vacature 'filled' wordt (en dat niet al
    // was). time-to-hire (aggregator + analytics) leunt hierop. filled_at zit
    // niet in MUTABLE_JOB_COLUMNS, dus dit dubbelt niet.
    if (data.status === 'filled' && existing.status !== 'filled') {
      fields.push(`filled_at = now()`);
    }

    fields.push(`updated_at = now()`);
    values.push(jobId, tenantId);

    const { rows: [job] } = await client.query(
      `UPDATE jobs SET ${fields.join(', ')}
       WHERE id = $${idx++} AND tenant_id = $${idx}
       RETURNING ${JOB_RETURNING_COLUMNS}`,
      values
    );

    await client.query(
      `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
       VALUES ($1, 'job', $2, $3, 'updated', $4)`,
      [tenantId, jobId, userId, JSON.stringify(data)]
    );

    // Detect status → 'filled' transition for the dedicated workflow trigger.
    const becameFilled =
      data.status === 'filled' && existing.status !== 'filled';

    // Detect status → 'open' transition (publiceren) voor auto-post. De
    // pay-transparency-gate zit vóór deze service (enforcePayTransparency in
    // jobs.router), dus bij het bereiken van dit punt is de band compleet.
    const becameOpen = data.status === 'open' && existing.status !== 'open';

    // Use 'filled' actie wanneer de status daarheen kantelt — geeft compliance
    // duidelijker signaal dan de generieke 'updated'. Anders: gewoon updated.
    await logAudit(
      client,
      tenantId,
      {
        action: becameFilled ? AuditActions.JOB_FILLED : AuditActions.JOB_UPDATED,
        entityType: 'job',
        entityId: jobId,
        before: existing,
        after: job,
        userId,
      },
      ctx
    );

    return { job, becameFilled, becameOpen };
  });

  if (becameFilled) {
    await emitWorkflowEvent(tenantId, 'job.filled', job.id, {
      job,
      user_id: userId,
    });
  }

  // Auto-post bij publiceren (opt-in per tenant). Post-commit zodat alleen
  // daadwerkelijk gepersisteerde publicaties worden gedistribueerd.
  if (becameOpen) {
    await autoPostJobToBoards(tenantId, job.id, userId);
  }

  // Slice 4: regenereer embedding na een update — bepalen welke velden
  // "relevant" zijn wordt onderhoudsdrama; embedding-worker is goedkoop genoeg.
  await queueEmbedding(tenantId, 'job', job.id);

  return job;
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete (soft)
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteJob(
  tenantId: string,
  jobId: string,
  userId: string,
  ctx: AuditContext = {}
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    // Snapshot vóór delete zodat audit-trail compleet is.
    const { rows: [existing] } = await client.query(
      `SELECT * FROM jobs WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [jobId, tenantId]
    );
    if (!existing) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');
    }

    const { rows: [job] } = await client.query(
      `UPDATE jobs SET deleted_at = now()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [jobId, tenantId]
    );

    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');
    }

    await client.query(
      `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
       VALUES ($1, 'job', $2, $3, 'deleted', '{}')`,
      [tenantId, jobId, userId]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.JOB_DELETED,
        entityType: 'job',
        entityId: jobId,
        before: existing,
        after: null,
        userId,
      },
      ctx
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Duplicate
// ─────────────────────────────────────────────────────────────────────────────

export async function duplicateJob(
  tenantId: string,
  jobId: string,
  userId: string
) {
  return withTenant(tenantId, async (client) => {
    const { rows: [source] } = await client.query(
      `SELECT * FROM jobs WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [jobId, tenantId]
    );

    if (!source) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');
    }

    // Build a copy of all mutable columns from the source. Reset status to
    // 'draft' on the copy and skip job_reference (will be regenerated below).
    const payload: Record<string, unknown> = {};
    for (const col of MUTABLE_JOB_COLUMNS) {
      if (col === 'status') {
        payload[col] = 'draft';
        continue;
      }
      if (col === 'job_reference') continue;
      if (col === 'title') {
        payload[col] = `${source.title} (kopie)`;
        continue;
      }
      payload[col] = source[col];
    }

    // Generate a fresh job_reference for the duplicate (with single retry on collision).
    const maxAttempts = REFERENCE_RETRY_LIMIT + 1;
    let newJob: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const attemptPayload: Record<string, unknown> = {
        ...payload,
        job_reference: generateJobReference(),
      };
      const { cols, placeholders, values } = buildInsertColumns(attemptPayload, 2);
      const allCols = ['tenant_id', ...cols];
      const allPlaceholders = ['$1', ...placeholders];
      const allValues = [tenantId, ...values];

      try {
        const { rows: [row] } = await client.query(
          `INSERT INTO jobs (${allCols.join(', ')})
           VALUES (${allPlaceholders.join(', ')})
           RETURNING ${JOB_RETURNING_COLUMNS}`,
          allValues
        );
        newJob = row;
        break;
      } catch (err: unknown) {
        const e = err as { code?: string; constraint?: string };
        const isReferenceCollision =
          e.code === PG_UNIQUE_VIOLATION &&
          typeof e.constraint === 'string' &&
          e.constraint.includes('job_reference');
        if (isReferenceCollision && attempt < maxAttempts - 1) continue;
        throw err;
      }
    }

    if (!newJob) {
      throw new AppError(
        409,
        'REFERENCE_COLLISION',
        'Kon geen unieke job_reference genereren voor kopie'
      );
    }

    // Copy pipeline stages
    const { rows: stages } = await client.query(
      `SELECT name, position, color FROM pipeline_stages WHERE job_id = $1 AND tenant_id = $2 ORDER BY position`,
      [jobId, tenantId]
    );

    for (const stage of stages) {
      await client.query(
        `INSERT INTO pipeline_stages (tenant_id, job_id, name, position, color) VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, newJob.id, stage.name, stage.position, stage.color]
      );
    }

    await client.query(
      `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
       VALUES ($1, 'job', $2, $3, 'duplicated', $4)`,
      [tenantId, newJob.id, userId, JSON.stringify({ source_id: jobId })]
    );

    return newJob;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────────────────────────────────────

export async function getJobStats(tenantId: string, jobId: string) {
  return withTenant(tenantId, async (client) => {
    const { rows: [job] } = await client.query(
      `SELECT id FROM jobs WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [jobId, tenantId]
    );
    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');
    }

    // Applications per stage
    const { rows: byStage } = await client.query(
      `SELECT ps.id as stage_id, ps.name as stage_name, ps.color, COUNT(a.id) as count
       FROM pipeline_stages ps
       LEFT JOIN applications a ON a.stage_id = ps.id AND a.status = 'active'
       WHERE ps.job_id = $1 AND ps.tenant_id = $2
       GROUP BY ps.id, ps.name, ps.color
       ORDER BY ps.position ASC`,
      [jobId, tenantId]
    );

    // Applications by status
    const { rows: byStatus } = await client.query(
      `SELECT status, COUNT(*) as count
       FROM applications
       WHERE job_id = $1 AND tenant_id = $2
       GROUP BY status`,
      [jobId, tenantId]
    );

    // Total and recent counts
    const { rows: [totals] } = await client.query(
      `SELECT
         COUNT(*) as total_applications,
         COUNT(*) FILTER (WHERE applied_at >= now() - interval '7 days') as this_week,
         COUNT(*) FILTER (WHERE applied_at >= now() - interval '30 days') as this_month,
         COUNT(*) FILTER (WHERE status = 'hired') as hired_count,
         COUNT(*) FILTER (WHERE status = 'rejected') as rejected_count
       FROM applications
       WHERE job_id = $1 AND tenant_id = $2`,
      [jobId, tenantId]
    );

    return { byStage, byStatus, ...totals };
  });
}
