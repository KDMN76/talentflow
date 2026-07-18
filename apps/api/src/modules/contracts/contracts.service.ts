/**
 * Contracts service — Sprint Q4.4 (Agent TTT).
 *
 * Plaatsings-contracten voor temp/contract/permanent/freelance. Alle queries
 * via `withTenant(tenantId, ...)` zodat RLS automatisch isoleert. Audit-events
 * (platform-wide) gaan via `lib/audit.ts`. State-machine van een contract:
 *
 *   draft ──► active ──► renewed ──► active ──► … ──► ended
 *                  │                                     ▲
 *                  └──► terminated                       │
 *                                                        │
 *                              cron `markEndedDueDate` ──┘
 *
 * Side-effects bij termination: alle pending notification-rows (sent_at IS
 * NULL) worden gewist zodat een terminated contract geen "verloopt over 7
 * dagen" e-mail meer triggert.
 */

import type { PoolClient } from 'pg';
import { withTenant, withoutTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export type ContractType = 'temp' | 'contract' | 'permanent' | 'freelance';
export type ContractStatus =
  | 'draft'
  | 'active'
  | 'ended'
  | 'terminated'
  | 'renewed';

export interface ContractRow {
  id: string;
  tenant_id: string;
  candidate_id: string;
  application_id: string | null;
  client_organization_id: string | null;
  job_id: string | null;
  contract_type: ContractType;
  status: ContractStatus;
  start_date: string;
  end_date: string | null;
  weekly_hours: number | null;
  hourly_rate_candidate: number | null;
  hourly_rate_client: number | null;
  margin_percent: number | null;
  currency: string;
  cao: string | null;
  wtza_compliant: boolean | null;
  metadata: Record<string, unknown>;
  signed_at: string | null;
  terminated_at: string | null;
  termination_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractExtensionRow {
  id: string;
  tenant_id: string;
  contract_id: string;
  previous_end_date: string;
  new_end_date: string;
  reason: string | null;
  signed_at: string | null;
  signed_by: string | null;
  created_at: string;
}

export interface ContractNotificationRow {
  id: string;
  tenant_id: string;
  contract_id: string;
  notification_type:
    | 'expiring_30d'
    | 'expiring_14d'
    | 'expiring_7d'
    | 'ended';
  scheduled_for: string;
  sent_at: string | null;
  recipients: unknown[];
  created_at: string;
}

export interface CreateContractInput {
  candidate_id: string;
  application_id?: string | null;
  client_organization_id?: string | null;
  job_id?: string | null;
  contract_type?: ContractType;
  status?: ContractStatus;
  start_date: string;
  end_date?: string | null;
  weekly_hours?: number | null;
  hourly_rate_candidate?: number | null;
  hourly_rate_client?: number | null;
  currency?: string;
  cao?: string | null;
  wtza_compliant?: boolean | null;
  metadata?: Record<string, unknown>;
  signed_at?: string | null;
}

export interface ListContractsFilters {
  status?: ContractStatus;
  candidateId?: string;
  jobId?: string;
  cursor?: string;
  limit?: number;
}

export interface ListContractsResult {
  data: ContractRow[];
  next_cursor: string | null;
}

export interface UpdateContractPatch {
  contract_type?: ContractType;
  // No `status` field: lifecycle transitions must go through the dedicated
  // terminateContract()/renewContract()/extendContract() functions, which
  // validate the state machine and its side effects. A generic PATCH must
  // never be able to flip status directly.
  start_date?: string;
  end_date?: string | null;
  weekly_hours?: number | null;
  hourly_rate_candidate?: number | null;
  hourly_rate_client?: number | null;
  currency?: string;
  cao?: string | null;
  wtza_compliant?: boolean | null;
  metadata?: Record<string, unknown>;
  signed_at?: string | null;
  client_organization_id?: string | null;
  application_id?: string | null;
  job_id?: string | null;
}

export interface OperationOptions {
  userId?: string | null;
  auditCtx?: AuditContext;
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function toNumeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function rowToContract(row: Record<string, unknown>): ContractRow {
  return {
    id: row.id as string,
    tenant_id: row.tenant_id as string,
    candidate_id: row.candidate_id as string,
    application_id: (row.application_id as string | null) ?? null,
    client_organization_id: (row.client_organization_id as string | null) ?? null,
    job_id: (row.job_id as string | null) ?? null,
    contract_type: (row.contract_type as ContractType) ?? 'temp',
    status: (row.status as ContractStatus) ?? 'draft',
    start_date: typeof row.start_date === 'string'
      ? row.start_date
      : (row.start_date as Date)?.toISOString?.().slice(0, 10) ?? '',
    end_date:
      row.end_date === null || row.end_date === undefined
        ? null
        : typeof row.end_date === 'string'
          ? row.end_date
          : (row.end_date as Date).toISOString().slice(0, 10),
    weekly_hours: toNumeric(row.weekly_hours),
    hourly_rate_candidate: toNumeric(row.hourly_rate_candidate),
    hourly_rate_client: toNumeric(row.hourly_rate_client),
    margin_percent: toNumeric(row.margin_percent),
    currency: (row.currency as string) ?? 'EUR',
    cao: (row.cao as string | null) ?? null,
    wtza_compliant: (row.wtza_compliant as boolean | null) ?? null,
    metadata:
      typeof row.metadata === 'string'
        ? JSON.parse(row.metadata as string)
        : ((row.metadata as Record<string, unknown>) ?? {}),
    signed_at: (row.signed_at as string | null) ?? null,
    terminated_at: (row.terminated_at as string | null) ?? null,
    termination_reason: (row.termination_reason as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: (row.updated_at as string) ?? (row.created_at as string),
  };
}

/**
 * Bereken margin_percent uit candidate + client rate. Formule:
 *
 *   margin = (client - candidate) / client * 100
 *
 * Twee `null`s of een client-rate van 0 → null (geen margin definieerbaar).
 */
export function computeMarginPercent(
  candidateRate: number | null | undefined,
  clientRate: number | null | undefined
): number | null {
  const cand = toNumeric(candidateRate);
  const client = toNumeric(clientRate);
  if (cand === null || client === null || client <= 0) return null;
  const pct = ((client - cand) / client) * 100;
  // Round naar 2 decimalen om numeric(5,2) te respecteren.
  return Math.round(pct * 100) / 100;
}

// ───────────────────────────────────────────────────────────────────────────
// CRUD
// ───────────────────────────────────────────────────────────────────────────

export async function createContract(
  tenantId: string,
  input: CreateContractInput,
  options: OperationOptions = {}
): Promise<ContractRow> {
  if (!input.candidate_id) {
    throw new AppError(400, 'INVALID_INPUT', 'candidate_id is verplicht');
  }
  if (!input.start_date) {
    throw new AppError(400, 'INVALID_INPUT', 'start_date is verplicht');
  }

  const margin = computeMarginPercent(
    input.hourly_rate_candidate,
    input.hourly_rate_client
  );

  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query(
      `INSERT INTO contracts
         (tenant_id, candidate_id, application_id, client_organization_id, job_id,
          contract_type, status, start_date, end_date, weekly_hours,
          hourly_rate_candidate, hourly_rate_client, margin_percent, currency,
          cao, wtza_compliant, metadata, signed_at, created_by)
       VALUES ($1, $2, $3, $4, $5,
               $6, $7, $8, $9, $10,
               $11, $12, $13, $14,
               $15, $16, $17::jsonb, $18, $19)
       RETURNING *`,
      [
        tenantId,
        input.candidate_id,
        input.application_id ?? null,
        input.client_organization_id ?? null,
        input.job_id ?? null,
        input.contract_type ?? 'temp',
        input.status ?? 'draft',
        input.start_date,
        input.end_date ?? null,
        input.weekly_hours ?? null,
        input.hourly_rate_candidate ?? null,
        input.hourly_rate_client ?? null,
        margin,
        input.currency ?? 'EUR',
        input.cao ?? null,
        input.wtza_compliant ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.signed_at ?? null,
        options.userId ?? null,
      ]
    );

    const contract = rowToContract(row as Record<string, unknown>);

    await logAudit(
      client,
      tenantId,
      {
        action: 'contract.created',
        entityType: 'contract',
        entityId: contract.id,
        userId: options.userId ?? null,
        after: contract,
      },
      options.auditCtx ?? {}
    );

    // Bij creatie als 'active' óf 'draft' met end_date plannen we direct de
    // expiry-notifications zodat ze idempotent in de queue staan.
    if (contract.end_date && contract.status !== 'terminated') {
      await scheduleExpiryNotificationsInTx(client, tenantId, contract);
    }

    return contract;
  });
}

export async function listContracts(
  tenantId: string,
  filters: ListContractsFilters = {}
): Promise<ListContractsResult> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);

  return withTenant(tenantId, async (client) => {
    const where: string[] = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];
    let p = 2;

    if (filters.status) {
      where.push(`status = $${p++}`);
      params.push(filters.status);
    }
    if (filters.candidateId) {
      where.push(`candidate_id = $${p++}`);
      params.push(filters.candidateId);
    }
    if (filters.jobId) {
      where.push(`job_id = $${p++}`);
      params.push(filters.jobId);
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
      `SELECT * FROM contracts
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC, id DESC
       LIMIT $${p}`,
      params
    );

    const data = rows.slice(0, limit).map(rowToContract);
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

export async function getContract(
  tenantId: string,
  id: string
): Promise<ContractRow & { extensions: ContractExtensionRow[] }> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query(
      `SELECT * FROM contracts WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    if (!row) {
      throw new AppError(404, 'CONTRACT_NOT_FOUND', 'Contract niet gevonden');
    }

    const { rows: extRows } = await client.query(
      `SELECT * FROM contract_extensions
       WHERE tenant_id = $1 AND contract_id = $2
       ORDER BY created_at DESC`,
      [tenantId, id]
    );

    return {
      ...rowToContract(row as Record<string, unknown>),
      extensions: (extRows as ContractExtensionRow[]) ?? [],
    };
  });
}

export async function updateContract(
  tenantId: string,
  id: string,
  patch: UpdateContractPatch,
  options: OperationOptions = {}
): Promise<ContractRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: [existing] } = await client.query(
      `SELECT * FROM contracts WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [id, tenantId]
    );
    if (!existing) {
      throw new AppError(404, 'CONTRACT_NOT_FOUND', 'Contract niet gevonden');
    }

    const before = rowToContract(existing as Record<string, unknown>);

    if (
      (before.status === 'ended' || before.status === 'terminated') &&
      // Allow transitioning back to active via patch only if explicit reactivate
      // not in scope: forbid all non-trivial edits on closed contracts.
      Object.keys(patch).some((k) => k !== 'metadata')
    ) {
      throw new AppError(
        409,
        'CONTRACT_CLOSED',
        'Kan een afgerond/beëindigd contract niet aanpassen'
      );
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let p = 1;

    const assign = (col: string, val: unknown, jsonb = false) => {
      if (jsonb) {
        fields.push(`${col} = $${p++}::jsonb`);
        values.push(JSON.stringify(val));
      } else {
        fields.push(`${col} = $${p++}`);
        values.push(val);
      }
    };

    if (patch.contract_type !== undefined) assign('contract_type', patch.contract_type);
    if (patch.start_date !== undefined) assign('start_date', patch.start_date);
    if (patch.end_date !== undefined) assign('end_date', patch.end_date);
    if (patch.weekly_hours !== undefined) assign('weekly_hours', patch.weekly_hours);
    if (patch.currency !== undefined) assign('currency', patch.currency);
    if (patch.cao !== undefined) assign('cao', patch.cao);
    if (patch.wtza_compliant !== undefined) assign('wtza_compliant', patch.wtza_compliant);
    if (patch.metadata !== undefined) assign('metadata', patch.metadata, true);
    if (patch.signed_at !== undefined) assign('signed_at', patch.signed_at);
    if (patch.client_organization_id !== undefined) {
      assign('client_organization_id', patch.client_organization_id);
    }
    if (patch.application_id !== undefined) assign('application_id', patch.application_id);
    if (patch.job_id !== undefined) assign('job_id', patch.job_id);

    // Recompute margin if either rate changed.
    let newCandRate = before.hourly_rate_candidate;
    let newClientRate = before.hourly_rate_client;
    if (patch.hourly_rate_candidate !== undefined) {
      assign('hourly_rate_candidate', patch.hourly_rate_candidate);
      newCandRate = toNumeric(patch.hourly_rate_candidate);
    }
    if (patch.hourly_rate_client !== undefined) {
      assign('hourly_rate_client', patch.hourly_rate_client);
      newClientRate = toNumeric(patch.hourly_rate_client);
    }
    if (
      patch.hourly_rate_candidate !== undefined ||
      patch.hourly_rate_client !== undefined
    ) {
      const margin = computeMarginPercent(newCandRate, newClientRate);
      assign('margin_percent', margin);
    }

    if (fields.length === 0) {
      throw new AppError(400, 'NO_FIELDS', 'Geen velden om bij te werken');
    }

    fields.push(`updated_at = now()`);
    values.push(id, tenantId);

    const { rows: [updated] } = await client.query(
      `UPDATE contracts SET ${fields.join(', ')}
       WHERE id = $${p++} AND tenant_id = $${p++}
       RETURNING *`,
      values
    );
    const after = rowToContract(updated as Record<string, unknown>);

    await logAudit(
      client,
      tenantId,
      {
        action: 'contract.updated',
        entityType: 'contract',
        entityId: id,
        userId: options.userId ?? null,
        before,
        after,
      },
      options.auditCtx ?? {}
    );

    // End-date wijziging → opnieuw plannen.
    if (after.end_date !== before.end_date && after.end_date) {
      await scheduleExpiryNotificationsInTx(client, tenantId, after);
    }

    return after;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// State transitions
// ───────────────────────────────────────────────────────────────────────────

export async function extendContract(
  tenantId: string,
  contractId: string,
  newEndDate: string,
  reason: string | null,
  options: OperationOptions = {}
): Promise<{ contract: ContractRow; extension: ContractExtensionRow }> {
  if (!newEndDate) {
    throw new AppError(400, 'INVALID_INPUT', 'new_end_date is verplicht');
  }

  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query(
      `SELECT * FROM contracts WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [contractId, tenantId]
    );
    if (!row) {
      throw new AppError(404, 'CONTRACT_NOT_FOUND', 'Contract niet gevonden');
    }
    const before = rowToContract(row as Record<string, unknown>);
    if (before.status === 'terminated') {
      throw new AppError(
        409,
        'CONTRACT_TERMINATED',
        'Een beëindigd contract kan niet verlengd worden'
      );
    }
    if (!before.end_date) {
      throw new AppError(
        409,
        'NO_END_DATE',
        'Contract zonder einddatum kan niet verlengd worden'
      );
    }
    if (newEndDate <= before.end_date) {
      throw new AppError(
        400,
        'EXTENSION_NOT_LATER',
        'Nieuwe einddatum moet later zijn dan huidige einddatum'
      );
    }

    const { rows: [ext] } = await client.query<ContractExtensionRow>(
      `INSERT INTO contract_extensions
         (tenant_id, contract_id, previous_end_date, new_end_date, reason,
          signed_at, signed_by)
       VALUES ($1, $2, $3, $4, $5, now(), $6)
       RETURNING *`,
      [
        tenantId,
        contractId,
        before.end_date,
        newEndDate,
        reason,
        options.userId ?? null,
      ]
    );

    // Verlengd → markeer renewed → terug naar active in dezelfde transactie.
    // We willen de history bewaren: elke extension blijft in
    // contract_extensions zichtbaar.
    const { rows: [updated] } = await client.query(
      `UPDATE contracts
       SET end_date = $1,
           status = 'active',
           updated_at = now(),
           metadata = jsonb_set(
             COALESCE(metadata, '{}'::jsonb),
             '{last_renewed_at}',
             to_jsonb(now())
           )
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [newEndDate, contractId, tenantId]
    );
    const after = rowToContract(updated as Record<string, unknown>);

    await logAudit(
      client,
      tenantId,
      {
        action: 'contract.extended',
        entityType: 'contract',
        entityId: contractId,
        userId: options.userId ?? null,
        before,
        after: { ...after, extension_id: ext.id, reason },
      },
      options.auditCtx ?? {}
    );

    // Schedule nieuwe expiry-notifications voor het nieuwe einde — oude rows
    // (sent_at IS NULL) wegen we niet apart op: ze refereren aan de oude
    // einddatum maar de UNIQUE-constraint maakt nieuwe inserts idempotent.
    // We DELETE eerst de oude pending rows zodat we niet stale notify'en.
    await client.query(
      `DELETE FROM contract_notification_queue
       WHERE tenant_id = $1 AND contract_id = $2 AND sent_at IS NULL`,
      [tenantId, contractId]
    );
    await scheduleExpiryNotificationsInTx(client, tenantId, after);

    return { contract: after, extension: ext };
  });
}

export async function terminateContract(
  tenantId: string,
  contractId: string,
  reason: string,
  options: OperationOptions & { effectiveDate?: string | null } = {}
): Promise<ContractRow> {
  if (!reason || !reason.trim()) {
    throw new AppError(400, 'INVALID_INPUT', 'Reden is verplicht');
  }

  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query(
      `SELECT * FROM contracts WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [contractId, tenantId]
    );
    if (!row) {
      throw new AppError(404, 'CONTRACT_NOT_FOUND', 'Contract niet gevonden');
    }
    const before = rowToContract(row as Record<string, unknown>);
    if (before.status === 'terminated') {
      throw new AppError(
        409,
        'ALREADY_TERMINATED',
        'Contract is al beëindigd'
      );
    }

    const effective = options.effectiveDate ?? null;

    const { rows: [updated] } = await client.query(
      `UPDATE contracts
       SET status = 'terminated',
           terminated_at = now(),
           termination_reason = $1,
           end_date = COALESCE($2::date, end_date, $3::date),
           updated_at = now()
       WHERE id = $4 AND tenant_id = $5
       RETURNING *`,
      [reason, effective, new Date().toISOString().slice(0, 10), contractId, tenantId]
    );
    const after = rowToContract(updated as Record<string, unknown>);

    // Cancel pending notifications.
    await client.query(
      `DELETE FROM contract_notification_queue
       WHERE tenant_id = $1 AND contract_id = $2 AND sent_at IS NULL`,
      [tenantId, contractId]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: 'contract.terminated',
        entityType: 'contract',
        entityId: contractId,
        userId: options.userId ?? null,
        before,
        after: { ...after, termination_reason: reason },
      },
      options.auditCtx ?? {}
    );

    return after;
  });
}

/**
 * Wordt door de cron worker aangeroepen — flipt contracts met
 * `status='active'` en `end_date < today` naar `status='ended'`. Cross-tenant
 * (de worker zet zelf de tenant context per row).
 */
export async function markEndedDueDate(
  tenantId: string
): Promise<number> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `UPDATE contracts
       SET status = 'ended', updated_at = now()
       WHERE tenant_id = $1
         AND status = 'active'
         AND end_date IS NOT NULL
         AND end_date < CURRENT_DATE
       RETURNING id`,
      [tenantId]
    );
    return rows.length;
  });
}

/**
 * Lijstje van alle tenants met minstens 1 active contract — input voor de
 * cron-worker zodat hij per tenant kan fanout-en. Cross-tenant query.
 */
export async function listTenantsWithActiveContracts(): Promise<string[]> {
  return withoutTenant(async (client) => {
    const { rows } = await client.query<{ tenant_id: string }>(
      `SELECT DISTINCT tenant_id
       FROM contracts
       WHERE status IN ('active','renewed')
         AND end_date IS NOT NULL`
    );
    return rows.map((r) => r.tenant_id);
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Notifications
// ───────────────────────────────────────────────────────────────────────────

interface ScheduledOffset {
  type: 'expiring_30d' | 'expiring_14d' | 'expiring_7d' | 'ended';
  days_before: number;
}

const NOTIFICATION_OFFSETS: ScheduledOffset[] = [
  { type: 'expiring_30d', days_before: 30 },
  { type: 'expiring_14d', days_before: 14 },
  { type: 'expiring_7d', days_before: 7 },
  { type: 'ended', days_before: 0 },
];

function offsetDate(isoDate: string, daysBack: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

async function scheduleExpiryNotificationsInTx(
  client: PoolClient,
  tenantId: string,
  contract: ContractRow
): Promise<void> {
  if (!contract.end_date) return;
  if (contract.status === 'terminated') return;

  for (const offset of NOTIFICATION_OFFSETS) {
    const scheduledFor = offsetDate(contract.end_date, offset.days_before);
    await client.query(
      `INSERT INTO contract_notification_queue
         (tenant_id, contract_id, notification_type, scheduled_for)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, contract_id, notification_type)
       DO UPDATE SET scheduled_for = EXCLUDED.scheduled_for,
                     sent_at = CASE
                       WHEN contract_notification_queue.scheduled_for
                            = EXCLUDED.scheduled_for
                       THEN contract_notification_queue.sent_at
                       ELSE NULL
                     END`,
      [tenantId, contract.id, offset.type, scheduledFor]
    );
  }
}

export async function scheduleExpiryNotifications(
  tenantId: string,
  contractId: string
): Promise<void> {
  const contract = await getContract(tenantId, contractId);
  await withTenant(tenantId, async (client) => {
    await scheduleExpiryNotificationsInTx(client, tenantId, contract);
  });
}

export async function listNotifications(
  tenantId: string,
  contractId: string
): Promise<ContractNotificationRow[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM contract_notification_queue
       WHERE tenant_id = $1 AND contract_id = $2
       ORDER BY scheduled_for ASC, notification_type ASC`,
      [tenantId, contractId]
    );
    return rows as ContractNotificationRow[];
  });
}

/**
 * Used by cron worker — fetches today's due notifications across ALL tenants.
 * Returns full rows including tenant_id zodat de worker per row kan
 * `withTenant` aanroepen om recipients/contract-info op te halen.
 */
export async function listDueNotificationsAcrossTenants(
  today: string
): Promise<ContractNotificationRow[]> {
  return withoutTenant(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM contract_notification_queue
       WHERE scheduled_for <= $1::date
         AND sent_at IS NULL
       ORDER BY scheduled_for ASC
       LIMIT 1000`,
      [today]
    );
    return rows as ContractNotificationRow[];
  });
}

export async function markNotificationSent(
  tenantId: string,
  notificationId: string,
  recipients: unknown[]
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `UPDATE contract_notification_queue
       SET sent_at = now(), recipients = $1::jsonb
       WHERE id = $2 AND tenant_id = $3`,
      [JSON.stringify(recipients), notificationId, tenantId]
    );
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Margin re-compute (used after rate changes via background recalculation)
// ───────────────────────────────────────────────────────────────────────────

export async function recomputeMargins(
  tenantId: string,
  contractId?: string
): Promise<number> {
  return withTenant(tenantId, async (client) => {
    const params: unknown[] = [tenantId];
    let where = `tenant_id = $1`;
    if (contractId) {
      params.push(contractId);
      where += ` AND id = $2`;
    }
    const { rows } = await client.query(
      `SELECT id, hourly_rate_candidate, hourly_rate_client
       FROM contracts WHERE ${where}`,
      params
    );
    let n = 0;
    for (const r of rows) {
      const margin = computeMarginPercent(
        r.hourly_rate_candidate as number | null,
        r.hourly_rate_client as number | null
      );
      await client.query(
        `UPDATE contracts SET margin_percent = $1, updated_at = now()
         WHERE id = $2 AND tenant_id = $3`,
        [margin, r.id, tenantId]
      );
      n++;
    }
    return n;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Cursor encoding
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
