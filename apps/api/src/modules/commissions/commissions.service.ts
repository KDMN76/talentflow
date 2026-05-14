/**
 * Commissions service — Sprint Q4.4 (Agent UUU).
 *
 * Verantwoordelijk voor:
 *   - schemes (CRUD)
 *   - assignments (recruiter + contract + scheme + share-percent)
 *   - records (berekend per invoice trigger; status workflow)
 *
 * Multi-tenancy: ALLE queries via `withTenant`.
 *
 * Scheme-types:
 *   - flat                : config { amount }
 *   - percent_of_fee      : config { percent }   → invoice.subtotal * pct
 *   - percent_of_margin   : config { percent }   → margin (client - cand) * pct
 *   - tiered              : config { tiers: [{ up_to, percent }, …] }
 *                            → progressieve berekening op base_amount
 *   - recurring_monthly   : config { amount }   → amount × full months in periode
 */

import type { PoolClient } from 'pg';
import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export type CommissionSchemeType =
  | 'flat'
  | 'percent_of_fee'
  | 'percent_of_margin'
  | 'tiered'
  | 'recurring_monthly';

export type CommissionStatus =
  | 'pending'
  | 'approved'
  | 'paid'
  | 'disputed';

export interface CommissionSchemeRow {
  id: string;
  tenant_id: string;
  name: string;
  type: CommissionSchemeType;
  config: Record<string, unknown>;
  active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface CommissionAssignmentRow {
  id: string;
  tenant_id: string;
  recruiter_id: string | null;
  contract_id: string;
  scheme_id: string;
  share_percent: number;
  notes: string | null;
  created_at: string;
}

export interface CommissionRecordRow {
  id: string;
  tenant_id: string;
  assignment_id: string;
  recruiter_id: string | null;
  contract_id: string | null;
  invoice_id: string | null;
  base_amount: number;
  commission_amount: number;
  period_start: string | null;
  period_end: string | null;
  status: CommissionStatus;
  paid_at: string | null;
  created_at: string;
}

interface TieredConfig {
  tiers: Array<{ up_to: number | null; percent: number }>;
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function rowToScheme(row: Record<string, unknown>): CommissionSchemeRow {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    name: String(row.name),
    type: row.type as CommissionSchemeType,
    config: (row.config as Record<string, unknown>) ?? {},
    active: Boolean(row.active),
    is_default: Boolean(row.is_default),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function rowToAssignment(row: Record<string, unknown>): CommissionAssignmentRow {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    recruiter_id: (row.recruiter_id as string | null) ?? null,
    contract_id: String(row.contract_id),
    scheme_id: String(row.scheme_id),
    share_percent: Number(row.share_percent),
    notes: (row.notes as string | null) ?? null,
    created_at: String(row.created_at),
  };
}

function rowToRecord(row: Record<string, unknown>): CommissionRecordRow {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    assignment_id: String(row.assignment_id),
    recruiter_id: (row.recruiter_id as string | null) ?? null,
    contract_id: (row.contract_id as string | null) ?? null,
    invoice_id: (row.invoice_id as string | null) ?? null,
    base_amount: Number(row.base_amount ?? 0),
    commission_amount: Number(row.commission_amount ?? 0),
    period_start: (row.period_start as string | null) ?? null,
    period_end: (row.period_end as string | null) ?? null,
    status: row.status as CommissionStatus,
    paid_at: (row.paid_at as string | null) ?? null,
    created_at: String(row.created_at),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Bereken commission_amount op een base + share, volgens scheme-type.
 *
 * - flat              : config.amount  (geen share-scaling — recruiter krijgt
 *                        zijn deel via separate assignments met eigen share).
 * - percent_of_fee    : base * percent / 100
 * - percent_of_margin : margin * percent / 100   (caller geeft margin als base)
 * - tiered            : progressief over base
 * - recurring_monthly : config.amount × full months in periode
 *
 * Share wordt buiten deze functie toegepast (caller doet × share/100) zodat
 * "tiered" niet dubbel-geschaald wordt.
 */
export function computeCommissionAmount(
  scheme: { type: CommissionSchemeType; config: Record<string, unknown> },
  base: number,
  periodStart: string | null = null,
  periodEnd: string | null = null
): number {
  const cfg = scheme.config as Record<string, unknown>;
  switch (scheme.type) {
    case 'flat': {
      const amount = Number(cfg.amount ?? 0);
      return round2(amount);
    }
    case 'percent_of_fee':
    case 'percent_of_margin': {
      const pct = Number(cfg.percent ?? 0);
      return round2((base * pct) / 100);
    }
    case 'tiered': {
      const tiered = cfg as unknown as TieredConfig;
      if (!Array.isArray(tiered.tiers) || tiered.tiers.length === 0) return 0;
      let remaining = base;
      let total = 0;
      let lastUpTo = 0;
      // Sort by up_to ascending (null = infinity)
      const tiers = [...tiered.tiers].sort((a, b) => {
        const av = a.up_to ?? Infinity;
        const bv = b.up_to ?? Infinity;
        return av - bv;
      });
      for (const tier of tiers) {
        if (remaining <= 0) break;
        const cap = tier.up_to ?? Infinity;
        const slice = Math.min(remaining, cap - lastUpTo);
        if (slice > 0) {
          total += (slice * Number(tier.percent ?? 0)) / 100;
          remaining -= slice;
          lastUpTo = cap;
        }
      }
      return round2(total);
    }
    case 'recurring_monthly': {
      const amount = Number(cfg.amount ?? 0);
      if (!periodStart || !periodEnd) return round2(amount);
      const start = new Date(`${periodStart}T00:00:00Z`);
      const end = new Date(`${periodEnd}T00:00:00Z`);
      let months = 0;
      const cursor = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)
      );
      while (cursor <= end) {
        const monthEnd = new Date(
          Date.UTC(
            cursor.getUTCFullYear(),
            cursor.getUTCMonth() + 1,
            0
          )
        );
        // Tellen als het hele kalender-maand binnen de periode valt.
        if (cursor >= start && monthEnd <= end) months++;
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
      // Edge: korte periode binnen één maand → tel één keer.
      if (months === 0 && start <= end) months = 1;
      return round2(amount * months);
    }
    default:
      return 0;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Schemes
// ───────────────────────────────────────────────────────────────────────────

export async function listSchemes(
  tenantId: string
): Promise<CommissionSchemeRow[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM commission_schemes ORDER BY created_at DESC, id DESC`
    );
    return rows.map(rowToScheme);
  });
}

export async function createScheme(
  tenantId: string,
  data: {
    name: string;
    type: CommissionSchemeType;
    config: Record<string, unknown>;
    active?: boolean;
    is_default?: boolean;
    userId?: string | null;
    auditCtx?: AuditContext;
  }
): Promise<CommissionSchemeRow> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO commission_schemes
         (tenant_id, name, type, config, active, is_default)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING *`,
      [
        tenantId,
        data.name,
        data.type,
        JSON.stringify(data.config),
        data.active ?? true,
        data.is_default ?? false,
      ]
    );
    const scheme = rowToScheme(rows[0]);
    await logAudit(
      client,
      tenantId,
      {
        action: 'commissions.scheme.created',
        entityType: 'commission_scheme',
        entityId: scheme.id,
        userId: data.userId ?? null,
        after: { name: scheme.name, type: scheme.type },
      },
      data.auditCtx ?? {}
    );
    return scheme;
  });
}

export async function updateScheme(
  tenantId: string,
  schemeId: string,
  patch: {
    name?: string;
    config?: Record<string, unknown>;
    active?: boolean;
    is_default?: boolean;
    userId?: string | null;
    auditCtx?: AuditContext;
  }
): Promise<CommissionSchemeRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: existing } = await client.query(
      `SELECT * FROM commission_schemes WHERE id = $1`,
      [schemeId]
    );
    if (!existing[0]) {
      throw new AppError(
        404,
        'SCHEME_NOT_FOUND',
        'Commissie-regeling niet gevonden'
      );
    }
    const fields: string[] = [];
    const params: unknown[] = [];
    if (patch.name !== undefined) {
      params.push(patch.name);
      fields.push(`name = $${params.length}`);
    }
    if (patch.config !== undefined) {
      params.push(JSON.stringify(patch.config));
      fields.push(`config = $${params.length}::jsonb`);
    }
    if (patch.active !== undefined) {
      params.push(patch.active);
      fields.push(`active = $${params.length}`);
    }
    if (patch.is_default !== undefined) {
      params.push(patch.is_default);
      fields.push(`is_default = $${params.length}`);
    }
    if (fields.length === 0) {
      return rowToScheme(existing[0]);
    }
    fields.push(`updated_at = now()`);
    params.push(schemeId);
    const { rows } = await client.query(
      `UPDATE commission_schemes SET ${fields.join(', ')}
        WHERE id = $${params.length}
       RETURNING *`,
      params
    );
    const scheme = rowToScheme(rows[0]);
    await logAudit(
      client,
      tenantId,
      {
        action: 'commissions.scheme.updated',
        entityType: 'commission_scheme',
        entityId: scheme.id,
        userId: patch.userId ?? null,
        before: existing[0],
        after: scheme,
      },
      patch.auditCtx ?? {}
    );
    return scheme;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Assignments
// ───────────────────────────────────────────────────────────────────────────

export async function listAssignments(
  tenantId: string,
  filters: { contract_id?: string; recruiter_id?: string } = {}
): Promise<CommissionAssignmentRow[]> {
  return withTenant(tenantId, async (client) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.contract_id) {
      params.push(filters.contract_id);
      conditions.push(`contract_id = $${params.length}`);
    }
    if (filters.recruiter_id) {
      params.push(filters.recruiter_id);
      conditions.push(`recruiter_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await client.query(
      `SELECT * FROM commission_assignments ${where}
        ORDER BY created_at DESC, id DESC`
    );
    return rows.map(rowToAssignment);
  });
}

export async function assignToContract(
  tenantId: string,
  data: {
    contract_id: string;
    recruiter_id: string | null;
    scheme_id: string;
    share_percent?: number;
    notes?: string | null;
    userId?: string | null;
    auditCtx?: AuditContext;
  }
): Promise<CommissionAssignmentRow> {
  const share = data.share_percent ?? 100;
  if (share < 0 || share > 100) {
    throw new AppError(
      400,
      'INVALID_SHARE_PERCENT',
      'share_percent moet 0-100 zijn'
    );
  }
  return withTenant(tenantId, async (client) => {
    // Validate scheme exists + active
    const { rows: schemes } = await client.query(
      `SELECT id, active FROM commission_schemes WHERE id = $1`,
      [data.scheme_id]
    );
    if (!schemes[0]) {
      throw new AppError(404, 'SCHEME_NOT_FOUND', 'Commissie-regeling niet gevonden');
    }
    const { rows } = await client.query(
      `INSERT INTO commission_assignments
         (tenant_id, recruiter_id, contract_id, scheme_id, share_percent, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        tenantId,
        data.recruiter_id,
        data.contract_id,
        data.scheme_id,
        share,
        data.notes ?? null,
      ]
    );
    const assignment = rowToAssignment(rows[0]);
    await logAudit(
      client,
      tenantId,
      {
        action: 'commissions.assignment.created',
        entityType: 'commission_assignment',
        entityId: assignment.id,
        userId: data.userId ?? null,
        after: assignment,
      },
      data.auditCtx ?? {}
    );
    return assignment;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Records
// ───────────────────────────────────────────────────────────────────────────

interface InternalSchemeWithAssignment {
  assignment_id: string;
  recruiter_id: string | null;
  contract_id: string;
  share_percent: number;
  scheme_type: CommissionSchemeType;
  scheme_config: Record<string, unknown>;
}

async function loadAssignmentsForContract(
  client: PoolClient,
  contractId: string
): Promise<InternalSchemeWithAssignment[]> {
  const { rows } = await client.query<{
    id: string;
    recruiter_id: string | null;
    contract_id: string;
    share_percent: string;
    scheme_type: CommissionSchemeType;
    scheme_config: Record<string, unknown>;
  }>(
    `SELECT a.id,
            a.recruiter_id,
            a.contract_id,
            a.share_percent,
            s.type   AS scheme_type,
            s.config AS scheme_config
       FROM commission_assignments a
       JOIN commission_schemes s ON s.id = a.scheme_id AND s.tenant_id = a.tenant_id
      WHERE a.contract_id = $1
        AND s.active = TRUE`,
    [contractId]
  );
  return rows.map((r) => ({
    assignment_id: r.id,
    recruiter_id: r.recruiter_id,
    contract_id: r.contract_id,
    share_percent: Number(r.share_percent),
    scheme_type: r.scheme_type,
    scheme_config: r.scheme_config ?? {},
  }));
}

/**
 * Genereer commission_records voor alle actieve assignments op het contract
 * dat aan deze invoice hangt. Wordt aangeroepen door issueInvoice() na een
 * succesvolle issue.
 */
export async function recordCommissionsForInvoice(
  tenantId: string,
  invoiceId: string
): Promise<CommissionRecordRow[]> {
  return withTenant(tenantId, async (client) => {
    const { rows: invRows } = await client.query<{
      id: string;
      contract_id: string | null;
      subtotal_amount: string;
      period_start: string | null;
      period_end: string | null;
    }>(
      `SELECT id, contract_id, subtotal_amount, period_start, period_end
         FROM invoices
        WHERE id = $1`,
      [invoiceId]
    );
    const inv = invRows[0];
    if (!inv || !inv.contract_id) return [];

    // Margin: client - candidate, op basis van timesheet summary in periode.
    let candidateAmount = 0;
    if (inv.period_start && inv.period_end) {
      const { rows: tsRows } = await client.query<{
        candidate_total: string | null;
      }>(
        `SELECT COALESCE(SUM(t.total_hours * COALESCE(c.hourly_rate_candidate, 0)
                            + t.total_overtime_hours * 1.25
                            * COALESCE(c.hourly_rate_candidate, 0)), 0)
                AS candidate_total
           FROM timesheets t
           JOIN contracts c ON c.id = t.contract_id
          WHERE t.contract_id = $1
            AND t.status = 'approved'
            AND t.week_start >= $2::date
            AND t.week_start <= $3::date`,
        [inv.contract_id, inv.period_start, inv.period_end]
      );
      candidateAmount = Number(tsRows[0]?.candidate_total ?? 0);
    }
    const subtotal = Number(inv.subtotal_amount ?? 0);
    const margin = round2(subtotal - candidateAmount);

    const assignments = await loadAssignmentsForContract(client, inv.contract_id);
    const created: CommissionRecordRow[] = [];
    for (const a of assignments) {
      const base =
        a.scheme_type === 'percent_of_margin' ? margin : subtotal;
      const rawAmount = computeCommissionAmount(
        { type: a.scheme_type, config: a.scheme_config },
        base,
        inv.period_start,
        inv.period_end
      );
      const scaled = round2((rawAmount * a.share_percent) / 100);
      const { rows } = await client.query(
        `INSERT INTO commission_records
           (tenant_id, assignment_id, recruiter_id, contract_id, invoice_id,
            base_amount, commission_amount, period_start, period_end, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
         RETURNING *`,
        [
          tenantId,
          a.assignment_id,
          a.recruiter_id,
          a.contract_id,
          invoiceId,
          base,
          scaled,
          inv.period_start,
          inv.period_end,
        ]
      );
      created.push(rowToRecord(rows[0]));
    }
    return created;
  });
}

export interface ListRecordsOptions {
  recruiter_id?: string;
  status?: CommissionStatus;
  contract_id?: string;
  cursor?: string;
  limit?: number;
}

export async function listCommissions(
  tenantId: string,
  opts: ListRecordsOptions = {}
): Promise<{ data: CommissionRecordRow[]; next_cursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return withTenant(tenantId, async (client) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts.recruiter_id) {
      params.push(opts.recruiter_id);
      conditions.push(`recruiter_id = $${params.length}`);
    }
    if (opts.status) {
      params.push(opts.status);
      conditions.push(`status = $${params.length}`);
    }
    if (opts.contract_id) {
      params.push(opts.contract_id);
      conditions.push(`contract_id = $${params.length}`);
    }
    if (opts.cursor) {
      params.push(opts.cursor);
      conditions.push(`created_at < $${params.length}`);
    }
    params.push(limit + 1);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await client.query(
      `SELECT * FROM commission_records ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length}`,
      params
    );
    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: slice.map(rowToRecord),
      next_cursor: hasMore ? String(rows[limit - 1].created_at) : null,
    };
  });
}

async function transitionRecord(
  tenantId: string,
  recordId: string,
  to: CommissionStatus,
  options: { userId?: string | null; auditCtx?: AuditContext; reason?: string } = {}
): Promise<CommissionRecordRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: existing } = await client.query(
      `SELECT * FROM commission_records WHERE id = $1 FOR UPDATE`,
      [recordId]
    );
    if (!existing[0]) {
      throw new AppError(
        404,
        'COMMISSION_NOT_FOUND',
        'Commissie-record niet gevonden'
      );
    }
    const before = rowToRecord(existing[0]);
    const allowed: Record<CommissionStatus, CommissionStatus[]> = {
      pending: ['approved', 'disputed'],
      approved: ['paid', 'disputed'],
      paid: [],
      disputed: ['pending', 'approved'],
    };
    if (!allowed[before.status].includes(to)) {
      throw new AppError(
        409,
        'INVALID_COMMISSION_TRANSITION',
        `Transitie ${before.status} → ${to} niet toegestaan`
      );
    }
    const params: unknown[] = [to];
    let extraSet = '';
    if (to === 'paid') {
      extraSet = ', paid_at = now()';
    }
    params.push(recordId);
    const { rows } = await client.query(
      `UPDATE commission_records
          SET status = $1${extraSet}
        WHERE id = $${params.length}
        RETURNING *`,
      params
    );
    await logAudit(
      client,
      tenantId,
      {
        action: `commissions.record.${to}`,
        entityType: 'commission_record',
        entityId: recordId,
        userId: options.userId ?? null,
        before: { status: before.status },
        after: { status: to, reason: options.reason ?? null },
      },
      options.auditCtx ?? {}
    );
    return rowToRecord(rows[0]);
  });
}

export const approveCommission = (
  tenantId: string,
  recordId: string,
  options?: { userId?: string | null; auditCtx?: AuditContext }
) => transitionRecord(tenantId, recordId, 'approved', options ?? {});

export const payCommission = (
  tenantId: string,
  recordId: string,
  options?: { userId?: string | null; auditCtx?: AuditContext }
) => transitionRecord(tenantId, recordId, 'paid', options ?? {});

export const disputeCommission = (
  tenantId: string,
  recordId: string,
  reason: string,
  options?: { userId?: string | null; auditCtx?: AuditContext }
) =>
  transitionRecord(tenantId, recordId, 'disputed', {
    ...(options ?? {}),
    reason,
  });
