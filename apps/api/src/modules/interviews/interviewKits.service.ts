/**
 * Interview Kits — gestructureerde question-sets voor interviews.
 *
 * Een kit hoort bij een job (job_id gezet) of is global (job_id NULL,
 * zichtbaar voor alle jobs binnen de tenant). Elke kit heeft een lijst van
 * questions met categorie, optionele follow-ups en evaluation-criteria.
 *
 * is_default = TRUE betekent: dit kit wordt automatisch gekozen als er
 * geen expliciete kit voor een interview wordt opgegeven. Maximaal één
 * default per (job_id, tenant_id) bucket — de service forceert dat bij
 * create/update.
 */

import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type InterviewQuestionCategory =
  | 'behavioral'
  | 'technical'
  | 'culture'
  | 'experience';

export interface InterviewQuestion {
  id: string;
  text: string;
  category: InterviewQuestionCategory;
  suggested_followups?: string[];
  evaluation_criteria?: string;
  expected_duration_minutes?: number;
}

export interface InterviewKit {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  job_id: string | null;
  questions: InterviewQuestion[];
  scorecard_template_id: string | null;
  estimated_duration_minutes: number;
  is_default: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateInterviewKitInput {
  name: string;
  description?: string;
  job_id?: string | null;
  questions: InterviewQuestion[];
  scorecard_template_id?: string | null;
  estimated_duration_minutes?: number;
  is_default?: boolean;
}

export type UpdateInterviewKitInput = Partial<CreateInterviewKitInput>;

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function parseJsonArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? (p as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function rowToKit(row: Record<string, unknown>): InterviewKit {
  return {
    ...(row as unknown as InterviewKit),
    questions: parseJsonArray<InterviewQuestion>(row.questions),
  };
}

function validateQuestions(questions: InterviewQuestion[]): void {
  if (!Array.isArray(questions)) {
    throw new AppError(400, 'INVALID_QUESTIONS', 'questions moet een array zijn');
  }
  for (const q of questions) {
    if (!q.id || typeof q.id !== 'string') {
      throw new AppError(400, 'INVALID_QUESTION_ID', 'Elke vraag heeft een id');
    }
    if (!q.text || typeof q.text !== 'string') {
      throw new AppError(400, 'INVALID_QUESTION_TEXT', 'Elke vraag heeft text');
    }
    if (!['behavioral', 'technical', 'culture', 'experience'].includes(q.category)) {
      throw new AppError(
        400,
        'INVALID_QUESTION_CATEGORY',
        'category moet behavioral|technical|culture|experience zijn'
      );
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CRUD
// ────────────────────────────────────────────────────────────────────────────

export async function listInterviewKits(
  tenantId: string,
  jobId?: string | null
): Promise<InterviewKit[]> {
  return withTenant(tenantId, async (client) => {
    const params: unknown[] = [tenantId];
    let where = 'tenant_id = $1 AND deleted_at IS NULL';
    if (jobId) {
      params.push(jobId);
      // Match job-specifieke + global kits zodat de UI beide kan tonen.
      where += ` AND (job_id = $${params.length} OR job_id IS NULL)`;
    }
    const { rows } = await client.query(
      `SELECT * FROM interview_kits
       WHERE ${where}
       ORDER BY is_default DESC, name ASC`,
      params
    );
    return rows.map(rowToKit);
  });
}

export async function getInterviewKit(
  tenantId: string,
  id: string
): Promise<InterviewKit> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM interview_kits
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'INTERVIEW_KIT_NOT_FOUND', 'Interview kit niet gevonden');
    }
    return rowToKit(rows[0]);
  });
}

export async function createInterviewKit(
  tenantId: string,
  userId: string,
  input: CreateInterviewKitInput,
  ctx: AuditContext = {}
): Promise<InterviewKit> {
  if (!input.name || input.name.trim().length === 0) {
    throw new AppError(400, 'NAME_REQUIRED', 'name is verplicht');
  }
  validateQuestions(input.questions);

  const duration = input.estimated_duration_minutes ?? 60;
  if (duration < 5 || duration > 480) {
    throw new AppError(
      400,
      'INVALID_DURATION',
      'estimated_duration_minutes moet tussen 5 en 480 liggen'
    );
  }

  return withTenant(tenantId, async (client) => {
    if (input.is_default) {
      // Eén default per (job_id) bucket. NULL job_id behandelen we als eigen
      // bucket — daarvoor gebruiken we een sentinel-UUID in COALESCE.
      await client.query(
        `UPDATE interview_kits
         SET is_default = FALSE, updated_at = now()
         WHERE tenant_id = $1
           AND COALESCE(job_id, '00000000-0000-0000-0000-000000000000'::uuid) =
               COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
           AND is_default = TRUE
           AND deleted_at IS NULL`,
        [tenantId, input.job_id ?? null]
      );
    }

    const { rows } = await client.query(
      `INSERT INTO interview_kits
         (tenant_id, name, description, job_id, questions,
          scorecard_template_id, estimated_duration_minutes, is_default)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       RETURNING *`,
      [
        tenantId,
        input.name,
        input.description ?? null,
        input.job_id ?? null,
        JSON.stringify(input.questions),
        input.scorecard_template_id ?? null,
        duration,
        input.is_default ?? false,
      ]
    );

    const kit = rowToKit(rows[0]);
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.INTERVIEW_KIT_CREATED,
        entityType: 'interview_kit',
        entityId: kit.id,
        after: { name: kit.name, job_id: kit.job_id, is_default: kit.is_default },
        userId,
      },
      ctx
    );
    return kit;
  });
}

export async function updateInterviewKit(
  tenantId: string,
  id: string,
  userId: string,
  patch: UpdateInterviewKitInput,
  ctx: AuditContext = {}
): Promise<InterviewKit> {
  if (patch.questions !== undefined) {
    validateQuestions(patch.questions);
  }
  if (patch.estimated_duration_minutes !== undefined) {
    const d = patch.estimated_duration_minutes;
    if (d < 5 || d > 480) {
      throw new AppError(400, 'INVALID_DURATION', 'duration buiten 5..480');
    }
  }

  return withTenant(tenantId, async (client) => {
    const { rows: existing } = await client.query(
      `SELECT * FROM interview_kits
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId]
    );
    if (existing.length === 0) {
      throw new AppError(404, 'INTERVIEW_KIT_NOT_FOUND', 'Interview kit niet gevonden');
    }

    // Bouw dynamisch de UPDATE — alleen meegegeven velden patchen.
    const sets: string[] = [];
    const params: unknown[] = [];
    function add(col: string, value: unknown, jsonbCast = false): void {
      params.push(value);
      sets.push(`${col} = $${params.length}${jsonbCast ? '::jsonb' : ''}`);
    }
    if (patch.name !== undefined) add('name', patch.name);
    if (patch.description !== undefined) add('description', patch.description);
    if (patch.job_id !== undefined) add('job_id', patch.job_id);
    if (patch.questions !== undefined)
      add('questions', JSON.stringify(patch.questions), true);
    if (patch.scorecard_template_id !== undefined)
      add('scorecard_template_id', patch.scorecard_template_id);
    if (patch.estimated_duration_minutes !== undefined)
      add('estimated_duration_minutes', patch.estimated_duration_minutes);
    if (patch.is_default !== undefined) add('is_default', patch.is_default);

    if (sets.length === 0) {
      // Niks te patchen — geef bestaande terug om idempotent te zijn.
      return rowToKit(existing[0]);
    }
    sets.push(`updated_at = now()`);

    if (patch.is_default === true) {
      // Andere defaults in dezelfde bucket terugdraaien.
      const targetJobId = patch.job_id !== undefined
        ? patch.job_id ?? null
        : (existing[0] as { job_id: string | null }).job_id;
      await client.query(
        `UPDATE interview_kits
         SET is_default = FALSE, updated_at = now()
         WHERE tenant_id = $1
           AND id <> $2
           AND COALESCE(job_id, '00000000-0000-0000-0000-000000000000'::uuid) =
               COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
           AND is_default = TRUE
           AND deleted_at IS NULL`,
        [tenantId, id, targetJobId]
      );
    }

    params.push(id, tenantId);
    const idx = params.length - 1;
    const { rows } = await client.query(
      `UPDATE interview_kits SET ${sets.join(', ')}
       WHERE id = $${idx} AND tenant_id = $${idx + 1}
       RETURNING *`,
      params
    );

    const kit = rowToKit(rows[0]);
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.INTERVIEW_KIT_UPDATED,
        entityType: 'interview_kit',
        entityId: kit.id,
        before: existing[0],
        after: { name: kit.name, job_id: kit.job_id, is_default: kit.is_default },
        userId,
      },
      ctx
    );
    return kit;
  });
}

export async function deleteInterviewKit(
  tenantId: string,
  id: string,
  userId?: string,
  ctx: AuditContext = {}
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `UPDATE interview_kits
       SET deleted_at = now(), updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       RETURNING id, name`,
      [id, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'INTERVIEW_KIT_NOT_FOUND', 'Interview kit niet gevonden');
    }
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.INTERVIEW_KIT_DELETED,
        entityType: 'interview_kit',
        entityId: id,
        before: rows[0],
        userId: userId ?? null,
      },
      ctx
    );
  });
}
