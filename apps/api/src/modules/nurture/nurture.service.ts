/**
 * Nurture-sequence service — Sprint Q4.5 (Agent XXX).
 *
 * CRUD over `nurture_sequences` + `nurture_steps` + `nurture_enrollments`.
 * Owns the per-enrollment cron loop that drafts the next step and schedules
 * its send. Cooperates with `outreach.service` for the actual AI draft +
 * approve/send lifecycle.
 *
 * Step ordering: `step_order` is a positive integer, unique per sequence.
 * Re-ordering happens via a single transaction that rewrites the orders so
 * we never violate the UNIQUE constraint mid-flight.
 *
 * Enrollment state-machine:
 *
 *   pending_approval ──► active ──► (advanced N times) ──► completed
 *           │              │   ▲
 *           │              ├───┘ paused / resumed
 *           │              └──► replied (terminal)
 *           └──► stopped (terminal, e.g. recruiter rejected first message)
 */

import type { PoolClient } from 'pg';
import { withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import {
  draftOutreachMessage,
  approveMessage,
  type OutreachChannel,
  type DraftSignals,
} from '../outreach/outreach.service';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export interface SequenceRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  active: boolean;
  total_steps: number;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StepRow {
  id: string;
  tenant_id: string;
  sequence_id: string;
  step_order: number;
  channel: OutreachChannel;
  delay_days: number;
  ai_personalize: boolean;
  template_subject: string | null;
  template_body: string | null;
  stop_on_reply: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface EnrollmentRow {
  id: string;
  tenant_id: string;
  candidate_id: string;
  finding_id: string | null;
  sequence_id: string;
  status:
    | 'pending_approval'
    | 'active'
    | 'paused'
    | 'stopped'
    | 'completed'
    | 'replied';
  current_step_order: number;
  next_send_at: string | null;
  enrolled_by: string | null;
  enrolled_at: string;
  stopped_at: string | null;
  stopped_reason: string | null;
  metadata: Record<string, unknown>;
}

export interface SequenceWithSteps extends SequenceRow {
  steps: StepRow[];
}

// ───────────────────────────────────────────────────────────────────────────
// Sequences CRUD
// ───────────────────────────────────────────────────────────────────────────

export interface CreateSequenceInput {
  name: string;
  description?: string | null;
  metadata?: Record<string, unknown>;
}

export interface OperationCtx {
  userId: string | null;
  auditCtx?: AuditContext;
}

export async function createSequence(
  tenantId: string,
  input: CreateSequenceInput,
  ctx: OperationCtx
): Promise<SequenceRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<SequenceRow>(
      `INSERT INTO nurture_sequences (tenant_id, name, description, metadata, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING *`,
      [
        tenantId,
        input.name.trim(),
        input.description ?? null,
        JSON.stringify(input.metadata ?? {}),
        ctx.userId,
      ]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: 'nurture.sequence.created',
        entityType: 'nurture_sequence',
        entityId: row.id,
        userId: ctx.userId,
        after: { name: row.name },
      },
      ctx.auditCtx ?? {}
    );
    return row;
  });
}

export async function updateSequence(
  tenantId: string,
  sequenceId: string,
  patch: Partial<CreateSequenceInput> & { active?: boolean },
  ctx: OperationCtx
): Promise<SequenceRow> {
  return withTenant(tenantId, async (client) => {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) {
      values.push(patch.name.trim());
      fields.push(`name = $${values.length}`);
    }
    if (patch.description !== undefined) {
      values.push(patch.description);
      fields.push(`description = $${values.length}`);
    }
    if (patch.active !== undefined) {
      values.push(patch.active);
      fields.push(`active = $${values.length}`);
    }
    if (patch.metadata !== undefined) {
      values.push(JSON.stringify(patch.metadata));
      fields.push(`metadata = $${values.length}::jsonb`);
    }
    if (fields.length === 0) {
      const { rows: [row] } = await client.query<SequenceRow>(
        `SELECT * FROM nurture_sequences WHERE id = $1 AND tenant_id = $2`,
        [sequenceId, tenantId]
      );
      if (!row) throw new AppError(404, 'SEQUENCE_NOT_FOUND', 'Sequence niet gevonden');
      return row;
    }
    fields.push(`updated_at = now()`);
    values.push(sequenceId, tenantId);
    const { rows: [row] } = await client.query<SequenceRow>(
      `UPDATE nurture_sequences SET ${fields.join(', ')}
        WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
        RETURNING *`,
      values
    );
    if (!row) throw new AppError(404, 'SEQUENCE_NOT_FOUND', 'Sequence niet gevonden');
    await logAudit(
      client,
      tenantId,
      {
        action: 'nurture.sequence.updated',
        entityType: 'nurture_sequence',
        entityId: row.id,
        userId: ctx.userId,
        after: patch,
      },
      ctx.auditCtx ?? {}
    );
    return row;
  });
}

export async function archiveSequence(
  tenantId: string,
  sequenceId: string,
  ctx: OperationCtx
): Promise<SequenceRow> {
  return updateSequence(tenantId, sequenceId, { active: false }, ctx);
}

export async function listSequences(
  tenantId: string,
  filters: { active?: boolean; cursor?: string; limit?: number }
): Promise<{ data: SequenceRow[]; next_cursor: string | null }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  return withTenant(tenantId, async (client) => {
    const conds: string[] = [`tenant_id = $1`];
    const values: unknown[] = [tenantId];
    if (filters.active !== undefined) {
      values.push(filters.active);
      conds.push(`active = $${values.length}`);
    }
    if (filters.cursor) {
      values.push(filters.cursor);
      conds.push(`created_at < $${values.length}`);
    }
    const { rows } = await client.query<SequenceRow>(
      `SELECT * FROM nurture_sequences
         WHERE ${conds.join(' AND ')}
         ORDER BY created_at DESC, id DESC
         LIMIT ${limit + 1}`,
      values
    );
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    return {
      data,
      next_cursor: hasMore ? data[data.length - 1].created_at : null,
    };
  });
}

export async function getSequenceWithSteps(
  tenantId: string,
  sequenceId: string
): Promise<SequenceWithSteps> {
  return withTenant(tenantId, async (client) => {
    const { rows: [seq] } = await client.query<SequenceRow>(
      `SELECT * FROM nurture_sequences WHERE id = $1 AND tenant_id = $2`,
      [sequenceId, tenantId]
    );
    if (!seq) throw new AppError(404, 'SEQUENCE_NOT_FOUND', 'Sequence niet gevonden');
    const { rows: steps } = await client.query<StepRow>(
      `SELECT * FROM nurture_steps WHERE sequence_id = $1 AND tenant_id = $2
        ORDER BY step_order ASC`,
      [sequenceId, tenantId]
    );
    return { ...seq, steps };
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Steps CRUD
// ───────────────────────────────────────────────────────────────────────────

export interface AddStepInput {
  channel: OutreachChannel;
  delay_days: number;
  ai_personalize?: boolean;
  template_subject?: string | null;
  template_body?: string | null;
  stop_on_reply?: boolean;
  metadata?: Record<string, unknown>;
}

export async function addStep(
  tenantId: string,
  sequenceId: string,
  input: AddStepInput,
  ctx: OperationCtx
): Promise<StepRow> {
  return withTenant(tenantId, async (client) => {
    // Verify sequence exists in this tenant.
    const { rows: [seq] } = await client.query<{ id: string }>(
      `SELECT id FROM nurture_sequences WHERE id = $1 AND tenant_id = $2`,
      [sequenceId, tenantId]
    );
    if (!seq) throw new AppError(404, 'SEQUENCE_NOT_FOUND', 'Sequence niet gevonden');

    const { rows: [maxRow] } = await client.query<{ max: number | null }>(
      `SELECT MAX(step_order) AS max FROM nurture_steps
         WHERE sequence_id = $1 AND tenant_id = $2`,
      [sequenceId, tenantId]
    );
    const nextOrder = (maxRow.max ?? 0) + 1;

    const { rows: [row] } = await client.query<StepRow>(
      `INSERT INTO nurture_steps
         (tenant_id, sequence_id, step_order, channel, delay_days,
          ai_personalize, template_subject, template_body,
          stop_on_reply, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       RETURNING *`,
      [
        tenantId,
        sequenceId,
        nextOrder,
        input.channel,
        Math.max(0, Math.floor(input.delay_days)),
        input.ai_personalize ?? true,
        input.template_subject ?? null,
        input.template_body ?? null,
        input.stop_on_reply ?? true,
        JSON.stringify(input.metadata ?? {}),
      ]
    );

    await client.query(
      `UPDATE nurture_sequences
          SET total_steps = total_steps + 1, updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [sequenceId, tenantId]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: 'nurture.step.created',
        entityType: 'nurture_step',
        entityId: row.id,
        userId: ctx.userId,
        after: { sequence_id: sequenceId, step_order: nextOrder, channel: input.channel },
      },
      ctx.auditCtx ?? {}
    );
    return row;
  });
}

export async function updateStep(
  tenantId: string,
  sequenceId: string,
  stepId: string,
  patch: Partial<AddStepInput>,
  ctx: OperationCtx
): Promise<StepRow> {
  return withTenant(tenantId, async (client) => {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.channel !== undefined) {
      values.push(patch.channel);
      fields.push(`channel = $${values.length}`);
    }
    if (patch.delay_days !== undefined) {
      values.push(Math.max(0, Math.floor(patch.delay_days)));
      fields.push(`delay_days = $${values.length}`);
    }
    if (patch.ai_personalize !== undefined) {
      values.push(patch.ai_personalize);
      fields.push(`ai_personalize = $${values.length}`);
    }
    if (patch.template_subject !== undefined) {
      values.push(patch.template_subject);
      fields.push(`template_subject = $${values.length}`);
    }
    if (patch.template_body !== undefined) {
      values.push(patch.template_body);
      fields.push(`template_body = $${values.length}`);
    }
    if (patch.stop_on_reply !== undefined) {
      values.push(patch.stop_on_reply);
      fields.push(`stop_on_reply = $${values.length}`);
    }
    if (patch.metadata !== undefined) {
      values.push(JSON.stringify(patch.metadata));
      fields.push(`metadata = $${values.length}::jsonb`);
    }
    if (fields.length === 0) {
      const { rows: [row] } = await client.query<StepRow>(
        `SELECT * FROM nurture_steps
           WHERE id = $1 AND tenant_id = $2 AND sequence_id = $3`,
        [stepId, tenantId, sequenceId]
      );
      if (!row) throw new AppError(404, 'STEP_NOT_FOUND', 'Stap niet gevonden');
      return row;
    }
    values.push(stepId, tenantId, sequenceId);
    const { rows: [row] } = await client.query<StepRow>(
      `UPDATE nurture_steps SET ${fields.join(', ')}
         WHERE id = $${values.length - 2}
           AND tenant_id = $${values.length - 1}
           AND sequence_id = $${values.length}
         RETURNING *`,
      values
    );
    if (!row) throw new AppError(404, 'STEP_NOT_FOUND', 'Stap niet gevonden');
    await logAudit(
      client,
      tenantId,
      {
        action: 'nurture.step.updated',
        entityType: 'nurture_step',
        entityId: row.id,
        userId: ctx.userId,
        after: patch,
      },
      ctx.auditCtx ?? {}
    );
    return row;
  });
}

export async function reorderSteps(
  tenantId: string,
  sequenceId: string,
  orderedStepIds: string[],
  ctx: OperationCtx
): Promise<StepRow[]> {
  return withTenant(tenantId, async (client) => {
    const { rows: existing } = await client.query<StepRow>(
      `SELECT * FROM nurture_steps WHERE sequence_id = $1 AND tenant_id = $2`,
      [sequenceId, tenantId]
    );
    const existingIds = new Set(existing.map((s) => s.id));
    if (existing.length !== orderedStepIds.length) {
      throw new AppError(
        400,
        'REORDER_LENGTH_MISMATCH',
        'Aantal stappen in reorder komt niet overeen'
      );
    }
    for (const id of orderedStepIds) {
      if (!existingIds.has(id)) {
        throw new AppError(400, 'REORDER_UNKNOWN_STEP', `Onbekende step id ${id}`);
      }
    }

    // Two-phase to avoid UNIQUE conflicts: first push everything to negative
    // numbers, then assign final orders.
    for (let i = 0; i < orderedStepIds.length; i++) {
      await client.query(
        `UPDATE nurture_steps SET step_order = $1
           WHERE id = $2 AND tenant_id = $3 AND sequence_id = $4`,
        [-(i + 1), orderedStepIds[i], tenantId, sequenceId]
      );
    }
    for (let i = 0; i < orderedStepIds.length; i++) {
      await client.query(
        `UPDATE nurture_steps SET step_order = $1
           WHERE id = $2 AND tenant_id = $3 AND sequence_id = $4`,
        [i + 1, orderedStepIds[i], tenantId, sequenceId]
      );
    }

    const { rows } = await client.query<StepRow>(
      `SELECT * FROM nurture_steps
         WHERE sequence_id = $1 AND tenant_id = $2
         ORDER BY step_order ASC`,
      [sequenceId, tenantId]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: 'nurture.step.reordered',
        entityType: 'nurture_sequence',
        entityId: sequenceId,
        userId: ctx.userId,
        after: { ordered_ids: orderedStepIds },
      },
      ctx.auditCtx ?? {}
    );

    return rows;
  });
}

export async function removeStep(
  tenantId: string,
  sequenceId: string,
  stepId: string,
  ctx: OperationCtx
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `DELETE FROM nurture_steps
         WHERE id = $1 AND tenant_id = $2 AND sequence_id = $3`,
      [stepId, tenantId, sequenceId]
    );
    if (rowCount === 0) {
      throw new AppError(404, 'STEP_NOT_FOUND', 'Stap niet gevonden');
    }
    await client.query(
      `UPDATE nurture_sequences
          SET total_steps = GREATEST(0, total_steps - 1), updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [sequenceId, tenantId]
    );
    // Re-sequence remaining steps to fill the gap.
    const { rows: remaining } = await client.query<{ id: string }>(
      `SELECT id FROM nurture_steps
         WHERE sequence_id = $1 AND tenant_id = $2
         ORDER BY step_order ASC`,
      [sequenceId, tenantId]
    );
    for (let i = 0; i < remaining.length; i++) {
      await client.query(
        `UPDATE nurture_steps SET step_order = $1
           WHERE id = $2 AND tenant_id = $3 AND sequence_id = $4`,
        [-(i + 1), remaining[i].id, tenantId, sequenceId]
      );
    }
    for (let i = 0; i < remaining.length; i++) {
      await client.query(
        `UPDATE nurture_steps SET step_order = $1
           WHERE id = $2 AND tenant_id = $3 AND sequence_id = $4`,
        [i + 1, remaining[i].id, tenantId, sequenceId]
      );
    }
    await logAudit(
      client,
      tenantId,
      {
        action: 'nurture.step.removed',
        entityType: 'nurture_step',
        entityId: stepId,
        userId: ctx.userId,
      },
      ctx.auditCtx ?? {}
    );
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Enrollments
// ───────────────────────────────────────────────────────────────────────────

export interface EnrollCandidateInput {
  candidateId: string;
  sequenceId: string;
  findingId?: string | null;
  requireApproval?: boolean;
  userId: string | null;
  signals?: DraftSignals;
  auditCtx?: AuditContext;
}

export async function enrollCandidate(
  tenantId: string,
  input: EnrollCandidateInput
): Promise<EnrollmentRow> {
  // 1) Insert enrollment
  const enrollment = await withTenant(tenantId, async (client) => {
    const { rows: [seq] } = await client.query<SequenceRow>(
      `SELECT * FROM nurture_sequences WHERE id = $1 AND tenant_id = $2`,
      [input.sequenceId, tenantId]
    );
    if (!seq) throw new AppError(404, 'SEQUENCE_NOT_FOUND', 'Sequence niet gevonden');
    if (!seq.active) {
      throw new AppError(400, 'SEQUENCE_INACTIVE', 'Sequence is gearchiveerd');
    }
    const { rows: [step1] } = await client.query<StepRow>(
      `SELECT * FROM nurture_steps
         WHERE sequence_id = $1 AND tenant_id = $2
         ORDER BY step_order ASC LIMIT 1`,
      [input.sequenceId, tenantId]
    );
    if (!step1) {
      throw new AppError(400, 'SEQUENCE_HAS_NO_STEPS', 'Sequence heeft geen stappen');
    }

    // Initial enrollment status: pending_approval if first step requires
    // approval (default for AI-personalized), else active.
    const requireApproval =
      input.requireApproval ?? (step1.ai_personalize !== false);
    const initialStatus = requireApproval ? 'pending_approval' : 'active';

    const { rows: [row] } = await client.query<EnrollmentRow>(
      `INSERT INTO nurture_enrollments
         (tenant_id, candidate_id, finding_id, sequence_id, status,
          current_step_order, next_send_at, enrolled_by)
       VALUES ($1, $2, $3, $4, $5, 0, now(), $6)
       ON CONFLICT (tenant_id, candidate_id, sequence_id) DO UPDATE
         SET status = EXCLUDED.status,
             current_step_order = EXCLUDED.current_step_order,
             next_send_at = EXCLUDED.next_send_at,
             enrolled_by = EXCLUDED.enrolled_by,
             enrolled_at = now(),
             stopped_at = NULL,
             stopped_reason = NULL,
             finding_id = COALESCE(EXCLUDED.finding_id, nurture_enrollments.finding_id)
       RETURNING *`,
      [
        tenantId,
        input.candidateId,
        input.findingId ?? null,
        input.sequenceId,
        initialStatus,
        input.userId,
      ]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: 'nurture.enrollment.created',
        entityType: 'nurture_enrollment',
        entityId: row.id,
        userId: input.userId,
        after: { candidate_id: input.candidateId, sequence_id: input.sequenceId },
      },
      input.auditCtx ?? {}
    );
    return { row, step1 };
  });

  // 2) Draft step 1 outside the tx (the draft has its own withTenant).
  try {
    await draftOutreachMessage(
      tenantId,
      input.candidateId,
      {
        channel: enrollment.step1.channel,
        template_subject: enrollment.step1.template_subject,
        template_body: enrollment.step1.template_body,
        ai_personalize: enrollment.step1.ai_personalize,
        step_id: enrollment.step1.id,
        enrollment_id: enrollment.row.id,
      },
      input.signals ?? {},
      {
        userId: input.userId ?? '00000000-0000-0000-0000-000000000000',
        requireApproval:
          input.requireApproval ?? (enrollment.step1.ai_personalize !== false),
        auditCtx: input.auditCtx,
      }
    );
  } catch (err) {
    logger.warn('[nurture] step1 draft failed — enrollment kept as pending', {
      enrollmentId: enrollment.row.id,
      error: (err as Error).message,
    });
  }

  return enrollment.row;
}

export async function pauseEnrollment(
  tenantId: string,
  enrollmentId: string,
  ctx: OperationCtx
): Promise<EnrollmentRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<EnrollmentRow>(
      `UPDATE nurture_enrollments
          SET status = 'paused'
        WHERE id = $1 AND tenant_id = $2
          AND status IN ('active','pending_approval')
        RETURNING *`,
      [enrollmentId, tenantId]
    );
    if (!row) throw new AppError(409, 'INVALID_STATUS', 'Kan enrollment niet pauzeren');
    await logAudit(
      client,
      tenantId,
      {
        action: 'nurture.enrollment.paused',
        entityType: 'nurture_enrollment',
        entityId: row.id,
        userId: ctx.userId,
      },
      ctx.auditCtx ?? {}
    );
    return row;
  });
}

export async function resumeEnrollment(
  tenantId: string,
  enrollmentId: string,
  ctx: OperationCtx
): Promise<EnrollmentRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<EnrollmentRow>(
      `UPDATE nurture_enrollments
          SET status = 'active', stopped_reason = NULL
        WHERE id = $1 AND tenant_id = $2 AND status = 'paused'
        RETURNING *`,
      [enrollmentId, tenantId]
    );
    if (!row) throw new AppError(409, 'INVALID_STATUS', 'Enrollment niet in paused-status');
    await logAudit(
      client,
      tenantId,
      {
        action: 'nurture.enrollment.resumed',
        entityType: 'nurture_enrollment',
        entityId: row.id,
        userId: ctx.userId,
      },
      ctx.auditCtx ?? {}
    );
    return row;
  });
}

export async function stopEnrollment(
  tenantId: string,
  enrollmentId: string,
  reason: string,
  ctx: OperationCtx
): Promise<EnrollmentRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<EnrollmentRow>(
      `UPDATE nurture_enrollments
          SET status = 'stopped',
              stopped_at = now(),
              stopped_reason = $1
        WHERE id = $2 AND tenant_id = $3
          AND status NOT IN ('stopped','completed','replied')
        RETURNING *`,
      [reason.slice(0, 500), enrollmentId, tenantId]
    );
    if (!row) throw new AppError(409, 'INVALID_STATUS', 'Enrollment al gestopt of afgerond');
    await logAudit(
      client,
      tenantId,
      {
        action: 'nurture.enrollment.stopped',
        entityType: 'nurture_enrollment',
        entityId: row.id,
        userId: ctx.userId,
        after: { reason },
      },
      ctx.auditCtx ?? {}
    );
    return row;
  });
}

/**
 * Sprint Q4.6 — pause every active/pending_approval enrollment a candidate
 * has, e.g. after a WhatsApp `STOP` keyword. Idempotent. Returns the
 * number of rows paused.
 */
export async function pauseAllEnrollmentsForCandidate(
  tenantId: string,
  candidateId: string,
  opts: { userId?: string | null; reason: string; auditCtx?: AuditContext }
): Promise<number> {
  return withTenant(tenantId, async (client) => {
    const { rowCount, rows } = await client.query<EnrollmentRow>(
      `UPDATE nurture_enrollments
          SET status         = 'paused',
              stopped_reason = $1
        WHERE tenant_id = $2 AND candidate_id = $3
          AND status IN ('active','pending_approval')
        RETURNING *`,
      [opts.reason.slice(0, 500), tenantId, candidateId]
    );
    for (const row of rows) {
      await logAudit(
        client,
        tenantId,
        {
          action: 'nurture.enrollment.paused',
          entityType: 'nurture_enrollment',
          entityId: row.id,
          userId: opts.userId ?? null,
          after: { reason: opts.reason },
        },
        opts.auditCtx ?? {}
      );
    }
    return rowCount ?? 0;
  });
}

export interface ListEnrollmentsFilters {
  candidate_id?: string;
  sequence_id?: string;
  status?: EnrollmentRow['status'];
  cursor?: string;
  limit?: number;
}

export async function listEnrollments(
  tenantId: string,
  filters: ListEnrollmentsFilters
): Promise<{ data: EnrollmentRow[]; next_cursor: string | null }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  return withTenant(tenantId, async (client) => {
    const conds: string[] = [`tenant_id = $1`];
    const values: unknown[] = [tenantId];
    if (filters.candidate_id) {
      values.push(filters.candidate_id);
      conds.push(`candidate_id = $${values.length}`);
    }
    if (filters.sequence_id) {
      values.push(filters.sequence_id);
      conds.push(`sequence_id = $${values.length}`);
    }
    if (filters.status) {
      values.push(filters.status);
      conds.push(`status = $${values.length}`);
    }
    if (filters.cursor) {
      values.push(filters.cursor);
      conds.push(`enrolled_at < $${values.length}`);
    }
    const { rows } = await client.query<EnrollmentRow>(
      `SELECT * FROM nurture_enrollments
         WHERE ${conds.join(' AND ')}
         ORDER BY enrolled_at DESC, id DESC
         LIMIT ${limit + 1}`,
      values
    );
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    return {
      data,
      next_cursor: hasMore ? data[data.length - 1].enrolled_at : null,
    };
  });
}

export async function getEnrollment(
  tenantId: string,
  enrollmentId: string
): Promise<EnrollmentRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<EnrollmentRow>(
      `SELECT * FROM nurture_enrollments WHERE id = $1 AND tenant_id = $2`,
      [enrollmentId, tenantId]
    );
    if (!row) throw new AppError(404, 'ENROLLMENT_NOT_FOUND', 'Enrollment niet gevonden');
    return row;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Cron — advance enrollments
// ───────────────────────────────────────────────────────────────────────────

export interface AdvanceResult {
  advanced: number;
  drafted: number;
  completed: number;
}

/**
 * Per-tenant cron tick. Finds active enrollments whose `next_send_at` is due,
 * draft the next step (if any), and reschedule. Caller is responsible for
 * iterating tenants — this function operates within a single `withTenant`.
 */
export async function advanceEnrollments(
  tenantId: string,
  now: Date = new Date()
): Promise<AdvanceResult> {
  const result: AdvanceResult = { advanced: 0, drafted: 0, completed: 0 };

  // Step 1: pull due rows.
  const due = await withTenant(tenantId, async (client) => {
    const { rows } = await client.query<EnrollmentRow>(
      `SELECT * FROM nurture_enrollments
         WHERE tenant_id = $1 AND status = 'active'
           AND next_send_at IS NOT NULL AND next_send_at <= $2
         ORDER BY next_send_at ASC
         LIMIT 200`,
      [tenantId, now]
    );
    return rows;
  });

  for (const enrollment of due) {
    try {
      const advanced = await advanceOne(tenantId, enrollment, now);
      result.advanced += 1;
      if (advanced.drafted) result.drafted += 1;
      if (advanced.completed) result.completed += 1;
    } catch (err) {
      logger.warn('[nurture] advance failed for enrollment', {
        enrollmentId: enrollment.id,
        error: (err as Error).message,
      });
    }
  }
  return result;
}

async function advanceOne(
  tenantId: string,
  enrollment: EnrollmentRow,
  now: Date
): Promise<{ drafted: boolean; completed: boolean }> {
  // Find next step (current_step_order + 1).
  const next = await withTenant(tenantId, async (client) => {
    const { rows: [step] } = await client.query<StepRow>(
      `SELECT * FROM nurture_steps
         WHERE sequence_id = $1 AND tenant_id = $2 AND step_order = $3
         LIMIT 1`,
      [enrollment.sequence_id, tenantId, enrollment.current_step_order + 1]
    );
    return step ?? null;
  });

  if (!next) {
    // No more steps — mark completed.
    await withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE nurture_enrollments
            SET status = 'completed', next_send_at = NULL
          WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
        [enrollment.id, tenantId]
      );
    });
    return { drafted: false, completed: true };
  }

  // Draft the next step.
  await draftOutreachMessage(
    tenantId,
    enrollment.candidate_id,
    {
      channel: next.channel,
      template_subject: next.template_subject,
      template_body: next.template_body,
      ai_personalize: next.ai_personalize,
      step_id: next.id,
      enrollment_id: enrollment.id,
    },
    {},
    {
      userId: enrollment.enrolled_by ?? '00000000-0000-0000-0000-000000000000',
      requireApproval: next.ai_personalize,
    }
  );

  // Update enrollment cursor + schedule next.
  const nextDelayDays = await withTenant(tenantId, async (client) => {
    const { rows: [further] } = await client.query<{ delay_days: number }>(
      `SELECT delay_days FROM nurture_steps
         WHERE sequence_id = $1 AND tenant_id = $2 AND step_order = $3
         LIMIT 1`,
      [enrollment.sequence_id, tenantId, enrollment.current_step_order + 2]
    );
    return further?.delay_days ?? null;
  });

  await withTenant(tenantId, async (client) => {
    const nextSendAt =
      nextDelayDays !== null
        ? new Date(now.getTime() + nextDelayDays * 24 * 60 * 60 * 1000)
        : null;
    await client.query(
      `UPDATE nurture_enrollments
          SET current_step_order = $1, next_send_at = $2
        WHERE id = $3 AND tenant_id = $4`,
      [enrollment.current_step_order + 1, nextSendAt, enrollment.id, tenantId]
    );
  });

  return { drafted: true, completed: false };
}
