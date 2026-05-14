/**
 * Timesheets service — Sprint Q4.4 (Agent TTT).
 *
 * Per-week timesheet voor uitzendcontracten. State-machine:
 *
 *      draft ──submit──► submitted ──approve──► approved
 *        ▲                  │
 *        │                  ├──reject──► rejected ──redraft──► draft
 *        │                  │
 *        └────dispute       └──dispute──► disputed
 *
 * Approvals: client-user OF recruiter/admin. Een "client-user" is een gebruiker
 * waarvan `users.role = 'client'` óf wiens organization_id matcht met
 * `contracts.client_organization_id`. We halen de check niet uit een externe
 * tabel — caller geeft `approverRole` en we slaan het op in de audit-row.
 *
 * Public token-route: zie publicTimesheetRoutes.ts. Die roept de "Public" set
 * aan (tenant ophalen via token, dan withTenant in service).
 */

import type { PoolClient } from 'pg';
import { withTenant, withoutTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { getContract } from '../contracts/contracts.service';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export type TimesheetStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'disputed';

export interface TimesheetRow {
  id: string;
  tenant_id: string;
  contract_id: string;
  candidate_id: string | null;
  week_start: string;
  week_end: string;
  status: TimesheetStatus;
  total_hours: number;
  total_overtime_hours: number;
  notes: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TimesheetEntryRow {
  id: string;
  tenant_id: string;
  timesheet_id: string;
  date: string;
  hours: number;
  overtime_hours: number;
  break_minutes: number;
  description: string | null;
  project_code: string | null;
  created_at: string;
}

export interface EntryInput {
  date: string;
  hours: number;
  overtime_hours?: number;
  break_minutes?: number;
  description?: string | null;
  project_code?: string | null;
}

export interface ListTimesheetsFilters {
  contractId?: string;
  status?: TimesheetStatus;
  weekStart?: string;
  cursor?: string;
  limit?: number;
}

export interface ListTimesheetsResult {
  data: TimesheetRow[];
  next_cursor: string | null;
}

export interface BillingSummary {
  total_hours: number;
  total_overtime_hours: number;
  total_amount_candidate: number;
  total_amount_client: number;
  currency: string;
  by_week: Array<{
    week_start: string;
    /** week_end is optional in UUU's contract — included for convenience. */
    week_end?: string;
    hours: number;
    overtime_hours: number;
    amount_candidate: number;
    amount_client: number;
  }>;
}

export type ApproverRole = 'client' | 'recruiter' | 'admin' | 'candidate' | string;

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function toNumeric(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function rowToTimesheet(row: Record<string, unknown>): TimesheetRow {
  return {
    id: row.id as string,
    tenant_id: row.tenant_id as string,
    contract_id: row.contract_id as string,
    candidate_id: (row.candidate_id as string | null) ?? null,
    week_start:
      typeof row.week_start === 'string'
        ? row.week_start
        : (row.week_start as Date).toISOString().slice(0, 10),
    week_end:
      typeof row.week_end === 'string'
        ? row.week_end
        : (row.week_end as Date).toISOString().slice(0, 10),
    status: (row.status as TimesheetStatus) ?? 'draft',
    total_hours: toNumeric(row.total_hours),
    total_overtime_hours: toNumeric(row.total_overtime_hours),
    notes: (row.notes as string | null) ?? null,
    submitted_at: (row.submitted_at as string | null) ?? null,
    approved_at: (row.approved_at as string | null) ?? null,
    approved_by: (row.approved_by as string | null) ?? null,
    rejected_at: (row.rejected_at as string | null) ?? null,
    rejection_reason: (row.rejection_reason as string | null) ?? null,
    metadata:
      typeof row.metadata === 'string'
        ? JSON.parse(row.metadata as string)
        : ((row.metadata as Record<string, unknown>) ?? {}),
    created_at: row.created_at as string,
    updated_at: (row.updated_at as string) ?? (row.created_at as string),
  };
}

function rowToEntry(row: Record<string, unknown>): TimesheetEntryRow {
  return {
    id: row.id as string,
    tenant_id: row.tenant_id as string,
    timesheet_id: row.timesheet_id as string,
    date:
      typeof row.date === 'string'
        ? row.date
        : (row.date as Date).toISOString().slice(0, 10),
    hours: toNumeric(row.hours),
    overtime_hours: toNumeric(row.overtime_hours),
    break_minutes: typeof row.break_minutes === 'number'
      ? row.break_minutes
      : Number(row.break_minutes ?? 0),
    description: (row.description as string | null) ?? null,
    project_code: (row.project_code as string | null) ?? null,
    created_at: row.created_at as string,
  };
}

function weekEndOf(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

async function writeTimesheetAudit(
  client: PoolClient,
  tenantId: string,
  timesheetId: string,
  actorUserId: string | null,
  actorRole: string | null,
  action: string,
  diff: Record<string, unknown>
): Promise<void> {
  try {
    await client.query(
      `INSERT INTO timesheet_audit
         (tenant_id, timesheet_id, actor_user_id, actor_role, action, diff)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [tenantId, timesheetId, actorUserId, actorRole, action, JSON.stringify(diff)]
    );
  } catch {
    /* swallow — audit moet hoofd-mutatie nooit blokkeren */
  }
}

async function recomputeTotals(
  client: PoolClient,
  tenantId: string,
  timesheetId: string
): Promise<{ total_hours: number; total_overtime_hours: number }> {
  const { rows: [agg] } = await client.query<{
    total_hours: string | number | null;
    total_overtime_hours: string | number | null;
  }>(
    `SELECT
       COALESCE(SUM(hours), 0)          AS total_hours,
       COALESCE(SUM(overtime_hours), 0) AS total_overtime_hours
     FROM timesheet_entries
     WHERE tenant_id = $1 AND timesheet_id = $2`,
    [tenantId, timesheetId]
  );
  const total = toNumeric(agg?.total_hours);
  const overtime = toNumeric(agg?.total_overtime_hours);
  await client.query(
    `UPDATE timesheets
     SET total_hours = $1, total_overtime_hours = $2, updated_at = now()
     WHERE id = $3 AND tenant_id = $4`,
    [total, overtime, timesheetId, tenantId]
  );
  return { total_hours: total, total_overtime_hours: overtime };
}

// ───────────────────────────────────────────────────────────────────────────
// Get-or-create
// ───────────────────────────────────────────────────────────────────────────

export async function getOrCreateTimesheet(
  tenantId: string,
  contractId: string,
  weekStart: string,
  candidateId: string | null
): Promise<TimesheetRow> {
  if (!weekStart) {
    throw new AppError(400, 'INVALID_INPUT', 'week_start is verplicht');
  }
  const weekEnd = weekEndOf(weekStart);

  return withTenant(tenantId, async (client) => {
    const { rows: [existing] } = await client.query(
      `SELECT * FROM timesheets
       WHERE tenant_id = $1 AND contract_id = $2 AND week_start = $3`,
      [tenantId, contractId, weekStart]
    );
    if (existing) return rowToTimesheet(existing as Record<string, unknown>);

    const { rows: [row] } = await client.query(
      `INSERT INTO timesheets
         (tenant_id, contract_id, candidate_id, week_start, week_end, status)
       VALUES ($1, $2, $3, $4, $5, 'draft')
       ON CONFLICT (tenant_id, contract_id, week_start)
       DO UPDATE SET updated_at = now()
       RETURNING *`,
      [tenantId, contractId, candidateId, weekStart, weekEnd]
    );

    const ts = rowToTimesheet(row as Record<string, unknown>);
    await writeTimesheetAudit(
      client,
      tenantId,
      ts.id,
      null,
      null,
      'created',
      { week_start: weekStart, week_end: weekEnd }
    );
    return ts;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Entries
// ───────────────────────────────────────────────────────────────────────────

function assertEditable(timesheet: TimesheetRow): void {
  if (timesheet.status === 'draft') return;
  if (timesheet.status === 'rejected') return;
  throw new AppError(
    409,
    'TIMESHEET_LOCKED',
    `Kan timesheet niet wijzigen — status=${timesheet.status}`
  );
}

export async function addOrUpdateEntry(
  tenantId: string,
  timesheetId: string,
  entryInput: EntryInput,
  actor: { userId?: string | null; role?: string | null } = {}
): Promise<{ entry: TimesheetEntryRow; totals: { total_hours: number; total_overtime_hours: number } }> {
  if (!entryInput.date) {
    throw new AppError(400, 'INVALID_INPUT', 'date is verplicht');
  }
  if (entryInput.hours < 0 || entryInput.hours > 24) {
    throw new AppError(400, 'INVALID_INPUT', 'hours moet tussen 0 en 24 zijn');
  }

  return withTenant(tenantId, async (client) => {
    const { rows: [tsRow] } = await client.query(
      `SELECT * FROM timesheets WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [timesheetId, tenantId]
    );
    if (!tsRow) {
      throw new AppError(404, 'TIMESHEET_NOT_FOUND', 'Timesheet niet gevonden');
    }
    const ts = rowToTimesheet(tsRow as Record<string, unknown>);
    assertEditable(ts);

    if (entryInput.date < ts.week_start || entryInput.date > ts.week_end) {
      throw new AppError(
        400,
        'DATE_OUT_OF_RANGE',
        'date valt buiten de week van de timesheet'
      );
    }

    const { rows: [existing] } = await client.query(
      `SELECT * FROM timesheet_entries
       WHERE tenant_id = $1 AND timesheet_id = $2 AND date = $3`,
      [tenantId, timesheetId, entryInput.date]
    );

    let row;
    if (existing) {
      const result = await client.query(
        `UPDATE timesheet_entries
         SET hours = $1,
             overtime_hours = $2,
             break_minutes = $3,
             description = $4,
             project_code = $5
         WHERE id = $6 AND tenant_id = $7
         RETURNING *`,
        [
          entryInput.hours,
          entryInput.overtime_hours ?? 0,
          entryInput.break_minutes ?? 0,
          entryInput.description ?? null,
          entryInput.project_code ?? null,
          (existing as Record<string, unknown>).id,
          tenantId,
        ]
      );
      row = result.rows[0];
    } else {
      const result = await client.query(
        `INSERT INTO timesheet_entries
           (tenant_id, timesheet_id, date, hours, overtime_hours, break_minutes,
            description, project_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          tenantId,
          timesheetId,
          entryInput.date,
          entryInput.hours,
          entryInput.overtime_hours ?? 0,
          entryInput.break_minutes ?? 0,
          entryInput.description ?? null,
          entryInput.project_code ?? null,
        ]
      );
      row = result.rows[0];
    }

    // Bij rejected → terug naar draft zodra weer wordt gewerkt.
    if (ts.status === 'rejected') {
      await client.query(
        `UPDATE timesheets
         SET status = 'draft', rejected_at = NULL, rejection_reason = NULL,
             updated_at = now()
         WHERE id = $1 AND tenant_id = $2`,
        [timesheetId, tenantId]
      );
    }

    const totals = await recomputeTotals(client, tenantId, timesheetId);

    await writeTimesheetAudit(
      client,
      tenantId,
      timesheetId,
      actor.userId ?? null,
      actor.role ?? null,
      existing ? 'entry_updated' : 'entry_added',
      { date: entryInput.date, hours: entryInput.hours, overtime_hours: entryInput.overtime_hours ?? 0 }
    );

    return { entry: rowToEntry(row as Record<string, unknown>), totals };
  });
}

export async function deleteEntry(
  tenantId: string,
  timesheetId: string,
  entryId: string,
  actor: { userId?: string | null; role?: string | null } = {}
): Promise<{ totals: { total_hours: number; total_overtime_hours: number } }> {
  return withTenant(tenantId, async (client) => {
    const { rows: [tsRow] } = await client.query(
      `SELECT * FROM timesheets WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [timesheetId, tenantId]
    );
    if (!tsRow) {
      throw new AppError(404, 'TIMESHEET_NOT_FOUND', 'Timesheet niet gevonden');
    }
    assertEditable(rowToTimesheet(tsRow as Record<string, unknown>));

    const { rowCount } = await client.query(
      `DELETE FROM timesheet_entries
       WHERE id = $1 AND tenant_id = $2 AND timesheet_id = $3`,
      [entryId, tenantId, timesheetId]
    );
    if (!rowCount) {
      throw new AppError(404, 'ENTRY_NOT_FOUND', 'Entry niet gevonden');
    }

    const totals = await recomputeTotals(client, tenantId, timesheetId);
    await writeTimesheetAudit(
      client,
      tenantId,
      timesheetId,
      actor.userId ?? null,
      actor.role ?? null,
      'entry_deleted',
      { entry_id: entryId }
    );
    return { totals };
  });
}

// ───────────────────────────────────────────────────────────────────────────
// State-transitions
// ───────────────────────────────────────────────────────────────────────────

export async function submitTimesheet(
  tenantId: string,
  timesheetId: string,
  candidateId: string | null,
  options: { auditCtx?: AuditContext; userId?: string | null } = {}
): Promise<TimesheetRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query(
      `SELECT * FROM timesheets WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [timesheetId, tenantId]
    );
    if (!row) {
      throw new AppError(404, 'TIMESHEET_NOT_FOUND', 'Timesheet niet gevonden');
    }
    const before = rowToTimesheet(row as Record<string, unknown>);
    if (before.status !== 'draft') {
      throw new AppError(
        409,
        'INVALID_TRANSITION',
        `Kan alleen vanuit 'draft' indienen — huidige status=${before.status}`
      );
    }
    if (candidateId && before.candidate_id && before.candidate_id !== candidateId) {
      throw new AppError(
        403,
        'WRONG_CANDIDATE',
        'Alleen de gekoppelde kandidaat kan deze timesheet indienen'
      );
    }
    const { rows: [updated] } = await client.query(
      `UPDATE timesheets
       SET status = 'submitted', submitted_at = now(), updated_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [timesheetId, tenantId]
    );
    const after = rowToTimesheet(updated as Record<string, unknown>);

    await writeTimesheetAudit(
      client,
      tenantId,
      timesheetId,
      options.userId ?? candidateId ?? null,
      'candidate',
      'submitted',
      { total_hours: after.total_hours }
    );
    await logAudit(
      client,
      tenantId,
      {
        action: 'timesheet.submitted',
        entityType: 'timesheet',
        entityId: timesheetId,
        userId: options.userId ?? null,
        before,
        after,
      },
      options.auditCtx ?? {}
    );
    return after;
  });
}

const APPROVER_ROLES = new Set(['recruiter', 'admin', 'client']);

export async function approveTimesheet(
  tenantId: string,
  timesheetId: string,
  approverUserId: string,
  approverRole: ApproverRole,
  options: { auditCtx?: AuditContext } = {}
): Promise<TimesheetRow> {
  if (!APPROVER_ROLES.has(approverRole)) {
    throw new AppError(
      403,
      'APPROVER_FORBIDDEN',
      'Alleen recruiter/admin/client mogen approven'
    );
  }

  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query(
      `SELECT * FROM timesheets WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [timesheetId, tenantId]
    );
    if (!row) {
      throw new AppError(404, 'TIMESHEET_NOT_FOUND', 'Timesheet niet gevonden');
    }
    const before = rowToTimesheet(row as Record<string, unknown>);
    if (before.status !== 'submitted') {
      throw new AppError(
        409,
        'INVALID_TRANSITION',
        `Kan alleen vanuit 'submitted' approven — huidige status=${before.status}`
      );
    }
    const { rows: [updated] } = await client.query(
      `UPDATE timesheets
       SET status = 'approved', approved_at = now(),
           approved_by = $1, updated_at = now()
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [approverUserId, timesheetId, tenantId]
    );
    const after = rowToTimesheet(updated as Record<string, unknown>);

    await writeTimesheetAudit(
      client,
      tenantId,
      timesheetId,
      approverUserId,
      approverRole,
      'approved',
      {
        total_hours: after.total_hours,
        total_overtime_hours: after.total_overtime_hours,
        approver_role: approverRole,
      }
    );
    await logAudit(
      client,
      tenantId,
      {
        action: 'timesheet.approved',
        entityType: 'timesheet',
        entityId: timesheetId,
        userId: approverUserId,
        before,
        after: { ...after, approver_role: approverRole },
      },
      options.auditCtx ?? {}
    );

    return after;
  });
}

export async function rejectTimesheet(
  tenantId: string,
  timesheetId: string,
  approverUserId: string,
  reason: string,
  options: { auditCtx?: AuditContext; approverRole?: ApproverRole } = {}
): Promise<TimesheetRow> {
  if (!reason || !reason.trim()) {
    throw new AppError(400, 'INVALID_INPUT', 'Reden is verplicht');
  }
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query(
      `SELECT * FROM timesheets WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [timesheetId, tenantId]
    );
    if (!row) {
      throw new AppError(404, 'TIMESHEET_NOT_FOUND', 'Timesheet niet gevonden');
    }
    const before = rowToTimesheet(row as Record<string, unknown>);
    if (before.status !== 'submitted') {
      throw new AppError(
        409,
        'INVALID_TRANSITION',
        `Kan alleen vanuit 'submitted' rejecten — huidige status=${before.status}`
      );
    }
    const { rows: [updated] } = await client.query(
      `UPDATE timesheets
       SET status = 'rejected', rejected_at = now(),
           rejection_reason = $1, updated_at = now()
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [reason, timesheetId, tenantId]
    );
    const after = rowToTimesheet(updated as Record<string, unknown>);

    await writeTimesheetAudit(
      client,
      tenantId,
      timesheetId,
      approverUserId,
      options.approverRole ?? null,
      'rejected',
      { reason }
    );
    await logAudit(
      client,
      tenantId,
      {
        action: 'timesheet.rejected',
        entityType: 'timesheet',
        entityId: timesheetId,
        userId: approverUserId,
        before,
        after,
      },
      options.auditCtx ?? {}
    );
    return after;
  });
}

export async function disputeTimesheet(
  tenantId: string,
  timesheetId: string,
  disputerUserId: string,
  reason: string,
  options: { auditCtx?: AuditContext; disputerRole?: string } = {}
): Promise<TimesheetRow> {
  if (!reason || !reason.trim()) {
    throw new AppError(400, 'INVALID_INPUT', 'Reden is verplicht');
  }
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query(
      `SELECT * FROM timesheets WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [timesheetId, tenantId]
    );
    if (!row) {
      throw new AppError(404, 'TIMESHEET_NOT_FOUND', 'Timesheet niet gevonden');
    }
    const before = rowToTimesheet(row as Record<string, unknown>);
    if (before.status === 'draft' || before.status === 'approved') {
      throw new AppError(
        409,
        'INVALID_TRANSITION',
        `Kan een ${before.status} timesheet niet disputen`
      );
    }
    const { rows: [updated] } = await client.query(
      `UPDATE timesheets
       SET status = 'disputed', updated_at = now(),
           metadata = jsonb_set(
             COALESCE(metadata, '{}'::jsonb),
             '{dispute_reason}',
             to_jsonb($1::text)
           )
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [reason, timesheetId, tenantId]
    );
    const after = rowToTimesheet(updated as Record<string, unknown>);

    await writeTimesheetAudit(
      client,
      tenantId,
      timesheetId,
      disputerUserId,
      options.disputerRole ?? null,
      'disputed',
      { reason }
    );
    await logAudit(
      client,
      tenantId,
      {
        action: 'timesheet.disputed',
        entityType: 'timesheet',
        entityId: timesheetId,
        userId: disputerUserId,
        before,
        after,
      },
      options.auditCtx ?? {}
    );
    return after;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Reads
// ───────────────────────────────────────────────────────────────────────────

export async function getTimesheet(
  tenantId: string,
  id: string
): Promise<TimesheetRow & { entries: TimesheetEntryRow[] }> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query(
      `SELECT * FROM timesheets WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    if (!row) {
      throw new AppError(404, 'TIMESHEET_NOT_FOUND', 'Timesheet niet gevonden');
    }
    const { rows: entries } = await client.query(
      `SELECT * FROM timesheet_entries
       WHERE tenant_id = $1 AND timesheet_id = $2
       ORDER BY date ASC`,
      [tenantId, id]
    );
    return {
      ...rowToTimesheet(row as Record<string, unknown>),
      entries: entries.map(rowToEntry),
    };
  });
}

export async function listTimesheets(
  tenantId: string,
  filters: ListTimesheetsFilters = {}
): Promise<ListTimesheetsResult> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  return withTenant(tenantId, async (client) => {
    const where: string[] = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];
    let p = 2;
    if (filters.contractId) {
      where.push(`contract_id = $${p++}`);
      params.push(filters.contractId);
    }
    if (filters.status) {
      where.push(`status = $${p++}`);
      params.push(filters.status);
    }
    if (filters.weekStart) {
      where.push(`week_start = $${p++}`);
      params.push(filters.weekStart);
    }
    if (filters.cursor) {
      const decoded = decodeCursor(filters.cursor);
      if (decoded) {
        where.push(`(created_at, id) < ($${p++}, $${p++})`);
        params.push(decoded.created_at, decoded.id);
      }
    }
    params.push(limit + 1);

    const { rows } = await client.query(
      `SELECT * FROM timesheets
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC, id DESC
       LIMIT $${p}`,
      params
    );
    const data = rows.slice(0, limit).map(rowToTimesheet);
    const next =
      rows.length > limit
        ? encodeCursor({
            created_at: data[data.length - 1].created_at,
            id: data[data.length - 1].id,
          })
        : null;
    return { data, next_cursor: next };
  });
}

export async function listTimesheetsForContract(
  tenantId: string,
  contractId: string,
  filters: Omit<ListTimesheetsFilters, 'contractId'> = {}
): Promise<ListTimesheetsResult> {
  return listTimesheets(tenantId, { ...filters, contractId });
}

export async function listForApprover(
  tenantId: string,
  approverUserId: string
): Promise<TimesheetRow[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT t.* FROM timesheets t
       JOIN contracts c ON c.id = t.contract_id AND c.tenant_id = t.tenant_id
       WHERE t.tenant_id = $1
         AND t.status = 'submitted'
       ORDER BY t.submitted_at ASC NULLS LAST
       LIMIT 200`,
      [tenantId]
    );
    // approverUserId may filter further in the future; for now list all
    // submitted timesheets in tenant scope. Caller is recruiter/admin which
    // sees the full submission queue.
    void approverUserId;
    return rows.map((r) => rowToTimesheet(r as Record<string, unknown>));
  });
}

export async function getTimesheetAudit(
  tenantId: string,
  timesheetId: string,
  limit = 200
): Promise<Array<{
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  diff: Record<string, unknown>;
  created_at: string;
}>> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, actor_user_id, actor_role, action, diff, created_at
       FROM timesheet_audit
       WHERE tenant_id = $1 AND timesheet_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [tenantId, timesheetId, Math.min(Math.max(limit, 1), 500)]
    );
    return rows as Array<{
      id: string;
      actor_user_id: string | null;
      actor_role: string | null;
      action: string;
      diff: Record<string, unknown>;
      created_at: string;
    }>;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Billing summary — consumed by Agent UUU's invoicing service
// ───────────────────────────────────────────────────────────────────────────

/**
 * Aggregeert ALLEEN approved timesheets in [periodStart, periodEnd] (week_start
 * tussen die data inclusief) en retourneert candidate-pay + client-bill
 * subtotalen op basis van de current contract-rates.
 *
 * UUU importeert deze functie. Wijzig de signature niet zonder UUU te
 * synchroniseren — dit is de cross-team contract.
 */
export async function summarizeApprovedHoursForBilling(
  tenantId: string,
  contractId: string,
  periodStart: string,
  periodEnd: string
): Promise<BillingSummary> {
  if (!periodStart || !periodEnd) {
    throw new AppError(
      400,
      'INVALID_PERIOD',
      'period_start en period_end zijn verplicht'
    );
  }
  if (periodStart > periodEnd) {
    throw new AppError(
      400,
      'INVALID_PERIOD',
      'period_start moet ≤ period_end zijn'
    );
  }

  const contract = await getContract(tenantId, contractId);
  const candRate = contract.hourly_rate_candidate ?? 0;
  const clientRate = contract.hourly_rate_client ?? 0;
  // Overtime tarif = 1.5× regular rate (NL CAO-default; tenants kunnen later
  // per-contract metadata.overtime_multiplier overrulen).
  const overtimeMult = (() => {
    const m = contract.metadata?.overtime_multiplier;
    if (typeof m === 'number' && m > 0) return m;
    return 1.5;
  })();

  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, week_start, week_end, total_hours, total_overtime_hours
       FROM timesheets
       WHERE tenant_id = $1
         AND contract_id = $2
         AND status = 'approved'
         AND week_start >= $3::date
         AND week_start <= $4::date
       ORDER BY week_start ASC`,
      [tenantId, contractId, periodStart, periodEnd]
    );

    const by_week: BillingSummary['by_week'] = [];
    let total_hours = 0;
    let total_overtime_hours = 0;
    let total_amount_candidate = 0;
    let total_amount_client = 0;

    for (const row of rows) {
      const hours = toNumeric(row.total_hours);
      const overtime = toNumeric(row.total_overtime_hours);
      const amount_candidate =
        hours * candRate + overtime * candRate * overtimeMult;
      const amount_client =
        hours * clientRate + overtime * clientRate * overtimeMult;

      by_week.push({
        week_start:
          typeof row.week_start === 'string'
            ? row.week_start
            : (row.week_start as Date).toISOString().slice(0, 10),
        week_end:
          typeof row.week_end === 'string'
            ? row.week_end
            : (row.week_end as Date).toISOString().slice(0, 10),
        hours,
        overtime_hours: overtime,
        amount_candidate: round2(amount_candidate),
        amount_client: round2(amount_client),
      });
      total_hours += hours;
      total_overtime_hours += overtime;
      total_amount_candidate += amount_candidate;
      total_amount_client += amount_client;
    }

    return {
      total_hours: round2(total_hours),
      total_overtime_hours: round2(total_overtime_hours),
      total_amount_candidate: round2(total_amount_candidate),
      total_amount_client: round2(total_amount_client),
      currency: contract.currency ?? 'EUR',
      by_week,
    };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ───────────────────────────────────────────────────────────────────────────
// Public token verification (used by publicTimesheetRoutes.ts)
// ───────────────────────────────────────────────────────────────────────────

import crypto from 'crypto';

export interface PortalTokenResolution {
  tenant_id: string;
  contract_id: string;
  candidate_id: string;
  token_id: string;
  expires_at: string;
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Vraag een nieuwe portal-token aan voor een (contract, candidate). De
 * raw token wordt teruggeleverd aan de caller (eenmalig zichtbaar voor
 * email-distributie); alleen de hash wordt opgeslagen.
 */
export async function createPortalToken(
  tenantId: string,
  contractId: string,
  candidateId: string,
  options: { ttlDays?: number; createdBy?: string | null } = {}
): Promise<{ id: string; token: string; expires_at: string }> {
  const ttlDays = options.ttlDays ?? 30;
  const raw = crypto.randomBytes(24).toString('base64url');
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + ttlDays * 86400 * 1000).toISOString();

  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<{ id: string; expires_at: string }>(
      `INSERT INTO timesheet_portal_tokens
         (tenant_id, contract_id, candidate_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, expires_at`,
      [tenantId, contractId, candidateId, tokenHash, expiresAt, options.createdBy ?? null]
    );
    return { id: row.id, token: raw, expires_at: row.expires_at };
  });
}

export async function resolvePortalToken(
  rawToken: string
): Promise<PortalTokenResolution | null> {
  if (!rawToken || rawToken.length < 8) return null;
  const tokenHash = hashToken(rawToken);
  try {
    return await withoutTenant(async (client) => {
      const { rows: [row] } = await client.query<{
        id: string;
        tenant_id: string;
        contract_id: string;
        candidate_id: string;
        expires_at: string;
        revoked_at: string | null;
      }>(
        `SELECT id, tenant_id, contract_id, candidate_id, expires_at, revoked_at
         FROM timesheet_portal_tokens
         WHERE token_hash = $1
         LIMIT 1`,
        [tokenHash]
      );
      if (!row) return null;
      if (row.revoked_at) return null;
      if (new Date(row.expires_at).getTime() < Date.now()) return null;

      // Update last_used_at — fire-and-forget binnen dezelfde verbinding zodat
      // de mock-helper ook deze call ziet.
      try {
        await client.query(
          `UPDATE timesheet_portal_tokens
           SET last_used_at = now()
           WHERE id = $1`,
          [row.id]
        );
      } catch {
        /* swallow — best-effort */
      }

      return {
        tenant_id: row.tenant_id,
        contract_id: row.contract_id,
        candidate_id: row.candidate_id,
        token_id: row.id,
        expires_at: row.expires_at,
      };
    });
  } catch {
    return null;
  }
}

export async function revokePortalToken(
  tenantId: string,
  tokenId: string
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `UPDATE timesheet_portal_tokens
       SET revoked_at = now()
       WHERE id = $1 AND tenant_id = $2`,
      [tokenId, tenantId]
    );
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Cursor encoding (shared)
// ───────────────────────────────────────────────────────────────────────────

function encodeCursor(input: { created_at: string; id: string }): string {
  return Buffer.from(JSON.stringify(input), 'utf8').toString('base64url');
}

function decodeCursor(
  cursor: string
): { created_at: string; id: string } | null {
  try {
    const obj = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (obj && typeof obj.created_at === 'string' && typeof obj.id === 'string') {
      return obj;
    }
  } catch {
    /* ignore */
  }
  return null;
}
