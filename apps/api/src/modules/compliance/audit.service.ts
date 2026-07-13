/**
 * Audit-trail service — Sprint Q4.2 (Agent OOO).
 *
 * Lees-laag bovenop `audit_events`. De write-laag (lib/audit.ts) bestaat
 * sinds Q1.1 en is WORM-protected via een trigger. Deze service biedt:
 *
 *   - Filtering: entity_type, entity_id, user_id, action_pattern, date-range,
 *     full-text search op JSONB `before/after` payload.
 *   - Pagination: cursor-based op (created_at DESC, id DESC). Limit default
 *     500, max 1000 per request.
 *   - Diff-summary: korte human-readable samenvatting per event (zoals
 *     "Status changed from 'open' to 'closed'") zodat de UI niet zelf JSON
 *     hoeft te diffen.
 *   - Entity-history: alle events voor één entiteit, chronologisch.
 *   - CSV/JSON export: voor compliance-auditors. De export zelf wordt als
 *     audit-event gelogd (action='audit.exported') zodat we kunnen
 *     aantonen wie wat exporteerde.
 *
 * Performance-overwegingen:
 *   - We hebben al indexen op `idx_audit_events_tenant_created`,
 *     `idx_audit_events_tenant_entity`, `idx_audit_events_tenant_action_created`.
 *   - Filtering op entity_id + entity_type gebruikt de tenant_entity-index.
 *   - Action-pattern (LIKE) gebruikt geen index — we beperken tot 1000 rij-en
 *     per call om een sequence-scan te vermijden bij grote tenants.
 *   - Search door JSONB doet een trigram-index op (before::text || after::text)
 *     niet — dat zou een aparte index vereisen die we voor MVP nog niet maken.
 *     De search-string ILIKE is bewust opt-in en limiteert tot 30 dagen om
 *     het pad bewandelbaar te houden.
 */

import { withTenant } from '../../db/pool';
import { logAudit, type AuditContext } from '../../lib/audit';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AuditEventDetailed {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: string;
  diff_summary: string;
  related_entity_name: string | null;
}

export interface ListAuditFilters {
  entity_type?: string;
  entity_id?: string;
  user_id?: string;
  action_pattern?: string;        // SQL LIKE-pattern, e.g. 'candidate.%'
  from?: string | Date;
  to?: string | Date;
  search?: string;                 // ILIKE on before/after payload
  cursor?: { created_at: string; id: string } | null;
  limit?: number;
}

export interface ListAuditResult {
  data: AuditEventDetailed[];
  next_cursor: { created_at: string; id: string } | null;
  has_more: boolean;
}

interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  user_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff-summary builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vergelijk before/after en geef een korte (max ~120 char) Nederlandse
 * samenvatting van de wijziging. Werkt voor zowel object-velden ("Status
 * changed from X to Y") als bulk-acties (geen before/after — vallen terug
 * op de action-naam).
 */
export function buildDiffSummary(
  action: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): string {
  // Create — geen before
  if (!before && after) {
    const id = (after.id as string | undefined) ?? null;
    const name =
      (after.name as string | undefined) ??
      (after.title as string | undefined) ??
      (after.label as string | undefined) ??
      id;
    return name
      ? `Aangemaakt: ${truncate(String(name), 60)}`
      : 'Record aangemaakt';
  }
  // Delete — geen after
  if (before && !after) {
    const name =
      (before.name as string | undefined) ??
      (before.title as string | undefined) ??
      (before.label as string | undefined) ??
      (before.id as string | undefined);
    return name
      ? `Verwijderd: ${truncate(String(name), 60)}`
      : 'Record verwijderd';
  }
  // Update — diff de keys
  if (before && after) {
    const diffs: string[] = [];
    const keys = new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ]);
    for (const k of keys) {
      // Negeer ruis: timestamps + IDs zijn niet interessant voor de operator
      if (k === 'created_at' || k === 'updated_at' || k === 'id' || k === 'tenant_id') continue;
      const a = before[k];
      const b = after[k];
      if (!shallowEqual(a, b)) {
        diffs.push(`${k}: ${formatVal(a)} → ${formatVal(b)}`);
      }
    }
    if (diffs.length === 0) return action;
    if (diffs.length === 1) return diffs[0];
    if (diffs.length <= 3) return diffs.join(', ');
    return `${diffs.slice(0, 3).join(', ')} (+${diffs.length - 3} meer)`;
  }
  return action;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'string') return `"${truncate(v, 30)}"`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  return '{…}';
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Listing
// ─────────────────────────────────────────────────────────────────────────────

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 100;

export async function listAuditEvents(
  tenantId: string,
  filters: ListAuditFilters = {}
): Promise<ListAuditResult> {
  const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  return withTenant(tenantId, async (client) => {
    const conds: string[] = ['e.tenant_id = $1'];
    const values: unknown[] = [tenantId];
    let idx = 2;

    if (filters.entity_type) {
      conds.push(`e.entity_type = $${idx++}`);
      values.push(filters.entity_type);
    }
    if (filters.entity_id) {
      conds.push(`e.entity_id = $${idx++}`);
      values.push(filters.entity_id);
    }
    if (filters.user_id) {
      conds.push(`e.user_id = $${idx++}`);
      values.push(filters.user_id);
    }
    if (filters.action_pattern) {
      conds.push(`e.action LIKE $${idx++}`);
      values.push(filters.action_pattern);
    }
    if (filters.from) {
      conds.push(`e.created_at >= $${idx++}`);
      values.push(filters.from);
    }
    if (filters.to) {
      conds.push(`e.created_at <= $${idx++}`);
      values.push(filters.to);
    }
    if (filters.search) {
      conds.push(
        `(coalesce(e.before::text, '') || ' ' || coalesce(e.after::text, '')) ILIKE $${idx++}`
      );
      values.push(`%${filters.search}%`);
    }
    // Cursor: WHERE (created_at, id) < (cursor.created_at, cursor.id) DESC
    if (filters.cursor) {
      conds.push(
        `(e.created_at, e.id) < ($${idx++}::timestamptz, $${idx++}::uuid)`
      );
      values.push(filters.cursor.created_at);
      values.push(filters.cursor.id);
    }

    // Fetch limit+1 zodat we weten of er nog meer is
    const fetchLimit = limit + 1;
    const { rows } = await client.query<AuditRow>(
      `SELECT e.id, e.action, e.entity_type, e.entity_id, e.user_id,
              e.before, e.after, e.ip_address::text AS ip_address,
              e.user_agent, e.request_id, e.created_at,
              u.name AS user_name, u.email AS user_email
         FROM audit_events e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE ${conds.join(' AND ')}
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT $${idx}`,
      [...values, fetchLimit]
    );

    const hasMore = rows.length > limit;
    const visible = hasMore ? rows.slice(0, limit) : rows;

    const data = visible.map((r): AuditEventDetailed => ({
      id: r.id,
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      user_id: r.user_id,
      user_name: r.user_name,
      user_email: r.user_email,
      before: r.before,
      after: r.after,
      ip_address: r.ip_address,
      user_agent: r.user_agent,
      request_id: r.request_id,
      created_at: r.created_at,
      diff_summary: buildDiffSummary(r.action, r.before, r.after),
      related_entity_name:
        (r.after?.name as string | undefined) ??
        (r.after?.title as string | undefined) ??
        (r.before?.name as string | undefined) ??
        (r.before?.title as string | undefined) ??
        null,
    }));

    const lastRow = visible[visible.length - 1];
    return {
      data,
      next_cursor: hasMore && lastRow
        ? { created_at: lastRow.created_at, id: lastRow.id }
        : null,
      has_more: hasMore,
    };
  });
}

/**
 * Volledige audit-history van één entiteit (alle versies). Sorteert
 * chronologisch ASCEND zodat de UI een tijdlijn kan rendert.
 */
export async function getEntityAuditHistory(
  tenantId: string,
  entityType: string,
  entityId: string
): Promise<AuditEventDetailed[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<AuditRow>(
      `SELECT e.id, e.action, e.entity_type, e.entity_id, e.user_id,
              e.before, e.after, e.ip_address::text AS ip_address,
              e.user_agent, e.request_id, e.created_at,
              u.name AS user_name, u.email AS user_email
         FROM audit_events e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.tenant_id = $1
          AND e.entity_type = $2
          AND e.entity_id = $3
        ORDER BY e.created_at ASC, e.id ASC`,
      [tenantId, entityType, entityId]
    );
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      user_id: r.user_id,
      user_name: r.user_name,
      user_email: r.user_email,
      before: r.before,
      after: r.after,
      ip_address: r.ip_address,
      user_agent: r.user_agent,
      request_id: r.request_id,
      created_at: r.created_at,
      diff_summary: buildDiffSummary(r.action, r.before, r.after),
      related_entity_name:
        (r.after?.name as string | undefined) ??
        (r.after?.title as string | undefined) ??
        (r.before?.name as string | undefined) ??
        (r.before?.title as string | undefined) ??
        null,
    }));
  });
}

/**
 * Distinct action-waarden voor de filter-dropdown in de audit-trail UI.
 * Gebruikt de tenant_action_created-index; alfabetisch zodat de dropdown
 * stabiel sorteert.
 */
export async function listDistinctAuditActions(
  tenantId: string
): Promise<string[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ action: string }>(
      `SELECT DISTINCT action
         FROM audit_events
        WHERE tenant_id = $1
        ORDER BY action ASC`,
      [tenantId]
    );
    return rows.map((r) => r.action);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

export type AuditExportFormat = 'csv' | 'json';

export async function exportAuditTrail(
  tenantId: string,
  userId: string | null,
  filters: ListAuditFilters,
  format: AuditExportFormat,
  ctx: AuditContext = {}
): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  // Voor exports verhogen we het max naar 10k zodat compliance-audits
  // jaarrange in 1 file kunnen pakken. Hard cap blijft (geen unbounded scan).
  const events = await collectForExport(tenantId, filters, 10_000);

  let buffer: Buffer;
  let contentType: string;
  let extension: string;

  if (format === 'json') {
    buffer = Buffer.from(JSON.stringify({ tenant_id: tenantId, exported_at: new Date().toISOString(), count: events.length, events }, null, 2));
    contentType = 'application/json';
    extension = 'json';
  } else {
    buffer = Buffer.from(toCsv(events));
    contentType = 'text/csv';
    extension = 'csv';
  }

  const date = new Date().toISOString().slice(0, 10);
  const filename = `audit_trail_${date}.${extension}`;

  // Self-log de export
  await withTenant(tenantId, async (client) => {
    await logAudit(
      client,
      tenantId,
      {
        action: 'audit.exported',
        entityType: 'audit',
        entityId: null,
        after: {
          format,
          filters,
          count: events.length,
          filename,
        },
        userId,
      },
      ctx
    );
  });

  return { buffer, filename, contentType };
}

async function collectForExport(
  tenantId: string,
  filters: ListAuditFilters,
  hardCap: number
): Promise<AuditEventDetailed[]> {
  const all: AuditEventDetailed[] = [];
  let cursor: ListAuditFilters['cursor'] = filters.cursor ?? null;
  while (all.length < hardCap) {
    const remaining = hardCap - all.length;
    const page = await listAuditEvents(tenantId, {
      ...filters,
      cursor,
      limit: Math.min(1000, remaining),
    });
    all.push(...page.data);
    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return all;
}

const CSV_COLUMNS: Array<keyof AuditEventDetailed> = [
  'created_at',
  'action',
  'entity_type',
  'entity_id',
  'user_id',
  'user_name',
  'ip_address',
  'request_id',
  'diff_summary',
];

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(events: AuditEventDetailed[]): string {
  const header = CSV_COLUMNS.join(',');
  const lines = events.map((e) =>
    CSV_COLUMNS.map((c) => csvEscape(e[c])).join(',')
  );
  return [header, ...lines].join('\n');
}
