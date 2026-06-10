/**
 * Sourcing-agent run lifecycle — Sprint Q4.5 (Agent WWW).
 *
 * Beheert agent_runs (queued → running → review_required → completed/cancelled/failed)
 * en agent_findings (pending_review → approved/rejected/contacted/dismissed).
 *
 * Approve: maakt een echte `candidates`-rij wanneer de finding geen interne
 *          candidate al gekoppeld heeft (external source). Emit eventBus
 *          'findingApproved' zodat Agent XXX outreach kan starten.
 * Reject:  bewaart reden + reviewer + timestamp; geen candidate-creatie.
 *
 * BullMQ enqueue gebeurt via apps/api/src/queue/queues `sourcingAgentQueue`.
 */

import type { PoolClient } from 'pg';
import { withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import {
  logAudit,
  type AuditContext,
} from '../../lib/audit';
import { eventBus } from '../../lib/eventBus';
import { sourcingAgentQueue } from '../../queue/queues';
import { recordAgentAction } from './searchAgent.service';
import { createCandidate } from '../candidates/candidates.service';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'review_required'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentRunTrigger = 'manual' | 'scheduled' | 'reactivation' | 'expansion';

export interface AgentRun {
  id: string;
  tenant_id: string;
  brief_id: string;
  status: AgentRunStatus;
  trigger: AgentRunTrigger;
  started_at: string | null;
  finished_at: string | null;
  candidates_found: number;
  candidates_approved: number;
  candidates_rejected: number;
  expansion_iteration: number;
  current_query: unknown;
  reasoning_log: Array<Record<string, unknown>>;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type AgentFindingStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'contacted'
  | 'dismissed';

export interface AgentFinding {
  id: string;
  tenant_id: string;
  run_id: string;
  brief_id: string;
  candidate_id: string | null;
  external_source: string | null;
  external_url: string | null;
  external_id: string | null;
  full_name: string | null;
  current_title: string | null;
  current_company: string | null;
  location: string | null;
  headline: string | null;
  summary: string | null;
  skills: string[];
  languages: string[];
  match_score: number | null;
  match_reasoning: string | null;
  status: AgentFindingStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AgentAction {
  id: string;
  tenant_id: string;
  run_id: string;
  finding_id: string | null;
  action: string;
  payload: Record<string, unknown>;
  reasoning: string | null;
  ai_model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
  requires_approval: boolean;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function arr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p.map(String) : []; }
    catch { return []; }
  }
  return [];
}

function obj(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

function arrOfObj(v: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

function toIso(v: Date | string | null): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : v;
}

function toRunRow(row: any): AgentRun {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    brief_id: row.brief_id,
    status: row.status,
    trigger: row.trigger,
    started_at: toIso(row.started_at),
    finished_at: toIso(row.finished_at),
    candidates_found: row.candidates_found,
    candidates_approved: row.candidates_approved,
    candidates_rejected: row.candidates_rejected,
    expansion_iteration: row.expansion_iteration,
    current_query: row.current_query ?? null,
    reasoning_log: arrOfObj(row.reasoning_log),
    error_message: row.error_message,
    created_by: row.created_by,
    created_at: toIso(row.created_at)!,
    updated_at: toIso(row.updated_at)!,
  };
}

function toFindingRow(row: any): AgentFinding {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    run_id: row.run_id,
    brief_id: row.brief_id,
    candidate_id: row.candidate_id,
    external_source: row.external_source,
    external_url: row.external_url,
    external_id: row.external_id,
    full_name: row.full_name,
    current_title: row.current_title,
    current_company: row.current_company,
    location: row.location,
    headline: row.headline,
    summary: row.summary,
    skills: arr(row.skills),
    languages: arr(row.languages),
    match_score: row.match_score === null ? null : Number(row.match_score),
    match_reasoning: row.match_reasoning,
    status: row.status,
    reviewed_at: toIso(row.reviewed_at),
    reviewed_by: row.reviewed_by,
    review_note: row.review_note,
    metadata: obj(row.metadata),
    created_at: toIso(row.created_at)!,
  };
}

function toActionRow(row: any): AgentAction {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    run_id: row.run_id,
    finding_id: row.finding_id,
    action: row.action,
    payload: obj(row.payload),
    reasoning: row.reasoning,
    ai_model: row.ai_model,
    prompt_tokens: row.prompt_tokens,
    completion_tokens: row.completion_tokens,
    cost_usd: row.cost_usd === null ? null : Number(row.cost_usd),
    requires_approval: row.requires_approval,
    approved_by: row.approved_by,
    approved_at: toIso(row.approved_at),
    created_at: toIso(row.created_at)!,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Run lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export async function enqueueRun(
  tenantId: string,
  briefId: string,
  trigger: AgentRunTrigger,
  userId: string | null,
  ctx: AuditContext = {}
): Promise<AgentRun> {
  const run = await withTenant(tenantId, async (client) => {
    const { rows: briefRows } = await client.query<{ id: string; active: boolean }>(
      `SELECT id, active FROM agent_briefs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [briefId, tenantId]
    );
    if (briefRows.length === 0) {
      throw new AppError(404, 'AGENT_BRIEF_NOT_FOUND', 'Brief niet gevonden');
    }
    if (!briefRows[0].active) {
      throw new AppError(409, 'AGENT_BRIEF_INACTIVE', 'Brief is gearchiveerd');
    }
    const { rows } = await client.query<any>(
      `INSERT INTO agent_runs
         (tenant_id, brief_id, status, trigger, created_by)
       VALUES ($1, $2, 'queued', $3, $4)
       RETURNING *`,
      [tenantId, briefId, trigger, userId]
    );
    const newRun = toRunRow(rows[0]);
    await logAudit(client, tenantId, {
      action: 'agent_run.queued',
      entityType: 'agent_run',
      entityId: newRun.id,
      after: { brief_id: briefId, trigger },
      userId,
    }, ctx);
    return newRun;
  });

  // Push naar BullMQ. Worker pickt deze op en draait runSearchAgent.
  try {
    await sourcingAgentQueue.add(
      'sourcing-agent-run',
      { tenantId, runId: run.id },
      { jobId: `sourcing:${run.id}` }
    );
  } catch (err) {
    logger.error('[sourcingAgent] enqueue failed', {
      runId: run.id,
      error: (err as Error).message,
    });
    // Mark failed zodat UI niet eindeloos in queued blijft staan.
    await withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE agent_runs SET status = 'failed', error_message = $3, updated_at = now()
          WHERE id = $1 AND tenant_id = $2`,
        [run.id, tenantId, `enqueue failed: ${(err as Error).message}`]
      );
    });
  }
  return run;
}

export async function getRun(tenantId: string, runId: string): Promise<AgentRun> {
  return withTenant(tenantId, async (client) => loadRun(client, tenantId, runId));
}

async function loadRun(client: PoolClient, tenantId: string, runId: string): Promise<AgentRun> {
  const { rows } = await client.query(
    `SELECT * FROM agent_runs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [runId, tenantId]
  );
  if (rows.length === 0) throw new AppError(404, 'AGENT_RUN_NOT_FOUND', 'Run niet gevonden');
  return toRunRow(rows[0]);
}

export interface ListRunsFilters {
  status?: AgentRunStatus;
  brief_id?: string;
  cursor?: string | null;
  limit?: number;
}

export async function listRuns(
  tenantId: string,
  filters: ListRunsFilters = {}
): Promise<{ data: AgentRun[]; nextCursor: string | null }> {
  const limit = Math.max(1, Math.min(200, filters.limit ?? 50));
  return withTenant(tenantId, async (client) => {
    const params: unknown[] = [tenantId];
    const wheres: string[] = ['tenant_id = $1'];
    if (filters.status) {
      params.push(filters.status);
      wheres.push(`status = $${params.length}`);
    }
    if (filters.brief_id) {
      params.push(filters.brief_id);
      wheres.push(`brief_id = $${params.length}`);
    }
    if (filters.cursor) {
      params.push(filters.cursor);
      wheres.push(`created_at < (SELECT created_at FROM agent_runs WHERE id = $${params.length})`);
    }
    params.push(limit + 1);
    const sql = `SELECT * FROM agent_runs WHERE ${wheres.join(' AND ')}
                 ORDER BY created_at DESC, id DESC LIMIT $${params.length}`;
    const { rows } = await client.query(sql, params);
    const runs = rows.map(toRunRow);
    const hasMore = runs.length > limit;
    const data = hasMore ? runs.slice(0, limit) : runs;
    return { data, nextCursor: hasMore ? data[data.length - 1].id : null };
  });
}

export async function cancelRun(
  tenantId: string,
  runId: string,
  userId: string | null,
  ctx: AuditContext = {}
): Promise<AgentRun> {
  return withTenant(tenantId, async (client) => {
    const before = await loadRun(client, tenantId, runId);
    if (before.status === 'completed' || before.status === 'cancelled') return before;
    const { rows } = await client.query(
      `UPDATE agent_runs
          SET status = 'cancelled', finished_at = COALESCE(finished_at, now()), updated_at = now()
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [runId, tenantId]
    );
    const after = toRunRow(rows[0]);
    await logAudit(client, tenantId, {
      action: 'agent_run.cancelled',
      entityType: 'agent_run',
      entityId: runId,
      before,
      after,
      userId,
    }, ctx);
    return after;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Findings
// ─────────────────────────────────────────────────────────────────────────────

export interface ListFindingsFilters {
  run_id?: string;
  brief_id?: string;
  status?: AgentFindingStatus;
  cursor?: string | null;
  limit?: number;
}

export async function listFindings(
  tenantId: string,
  filters: ListFindingsFilters = {}
): Promise<{ data: AgentFinding[]; nextCursor: string | null }> {
  const limit = Math.max(1, Math.min(200, filters.limit ?? 50));
  return withTenant(tenantId, async (client) => {
    const params: unknown[] = [tenantId];
    const wheres: string[] = ['tenant_id = $1'];
    if (filters.run_id) {
      params.push(filters.run_id);
      wheres.push(`run_id = $${params.length}`);
    }
    if (filters.brief_id) {
      params.push(filters.brief_id);
      wheres.push(`brief_id = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      wheres.push(`status = $${params.length}`);
    }
    if (filters.cursor) {
      params.push(filters.cursor);
      wheres.push(`created_at < (SELECT created_at FROM agent_findings WHERE id = $${params.length})`);
    }
    params.push(limit + 1);
    const sql = `SELECT * FROM agent_findings WHERE ${wheres.join(' AND ')}
                 ORDER BY match_score DESC NULLS LAST, created_at DESC, id DESC
                 LIMIT $${params.length}`;
    const { rows } = await client.query(sql, params);
    const findings = rows.map(toFindingRow);
    const hasMore = findings.length > limit;
    const data = hasMore ? findings.slice(0, limit) : findings;
    return { data, nextCursor: hasMore ? data[data.length - 1].id : null };
  });
}

async function loadFinding(
  client: PoolClient,
  tenantId: string,
  findingId: string
): Promise<AgentFinding> {
  const { rows } = await client.query(
    `SELECT * FROM agent_findings WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [findingId, tenantId]
  );
  if (rows.length === 0) {
    throw new AppError(404, 'AGENT_FINDING_NOT_FOUND', 'Finding niet gevonden');
  }
  return toFindingRow(rows[0]);
}

export async function approveFinding(
  tenantId: string,
  findingId: string,
  userId: string | null,
  note: string | null = null,
  ctx: AuditContext = {}
): Promise<AgentFinding> {
  // ── Stap 1: lees finding + maybe-create candidate, in een tx. ──────────
  const result = await withTenant(tenantId, async (client) => {
    const before = await loadFinding(client, tenantId, findingId);
    if (before.status === 'approved') return { finding: before, ranCreate: false };

    let candidateId = before.candidate_id;
    if (!candidateId) {
      // Net-new external candidate — maak een echte candidates-rij.
      // Sla expliciet email/phone over: external sources hebben die zelden
      // direct, en duplicate-check is verantwoordelijkheid van outreach.
      try {
        const descriptionParts = [
          before.current_title ? `Title: ${before.current_title}` : null,
          before.current_company ? `Company: ${before.current_company}` : null,
          before.headline ? `Headline: ${before.headline}` : null,
          before.summary ?? null,
          before.external_url ? `Source URL: ${before.external_url}` : null,
        ].filter(Boolean);
        const created = await createCandidate(
          tenantId,
          userId ?? findingId,
          {
            name: before.full_name ?? 'Onbekend',
            description: descriptionParts.length > 0 ? descriptionParts.join('\n') : undefined,
            address_city: before.location?.split(',')[0]?.trim() || undefined,
            address_country: before.location?.split(',').slice(1).join(',').trim() || undefined,
            source: `agent:${before.external_source ?? 'unknown'}`,
            skills: before.skills,
            languages: before.languages,
          },
          ctx
        );
        candidateId = (created as { id: string }).id;
      } catch (err) {
        logger.warn('[sourcingAgent] candidate creation failed during approve', {
          findingId,
          error: (err as Error).message,
        });
        // We falen niet — markeer alleen approved zonder candidate_id koppeling.
      }
    }

    const { rows } = await client.query(
      `UPDATE agent_findings
          SET status = 'approved',
              candidate_id = COALESCE($3, candidate_id),
              reviewed_at = now(),
              reviewed_by = $4,
              review_note = $5
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [findingId, tenantId, candidateId, userId, note]
    );
    const after = toFindingRow(rows[0]);

    await client.query(
      `UPDATE agent_runs SET candidates_approved = candidates_approved + 1, updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [after.run_id, tenantId]
    );

    await recordAgentAction(client, tenantId, {
      runId: after.run_id,
      findingId: after.id,
      action: 'finding_approved',
      payload: { candidate_id: candidateId, note },
      reasoning: note ?? 'Approved by recruiter',
      requiresApproval: false,
    });

    await logAudit(client, tenantId, {
      action: 'agent_finding.approved',
      entityType: 'agent_finding',
      entityId: findingId,
      before, after,
      userId,
    }, ctx);

    return { finding: after, ranCreate: !before.candidate_id && !!candidateId };
  });

  // ── Stap 2: emit eventBus zodat XXX (outreach) kan starten. ────────────
  try {
    if (result.finding.candidate_id) {
      eventBus.emit('findingApproved', {
        tenantId,
        findingId: result.finding.id,
        candidateId: result.finding.candidate_id,
        briefId: result.finding.brief_id,
        approvedBy: userId,
      });
    }
  } catch (err) {
    logger.warn('[sourcingAgent] eventBus emit failed', { error: (err as Error).message });
  }

  return result.finding;
}

export async function rejectFinding(
  tenantId: string,
  findingId: string,
  reason: string,
  userId: string | null,
  ctx: AuditContext = {}
): Promise<AgentFinding> {
  return withTenant(tenantId, async (client) => {
    const before = await loadFinding(client, tenantId, findingId);
    const { rows } = await client.query(
      `UPDATE agent_findings
          SET status = 'rejected', reviewed_at = now(), reviewed_by = $3, review_note = $4
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [findingId, tenantId, userId, reason]
    );
    const after = toFindingRow(rows[0]);

    await client.query(
      `UPDATE agent_runs SET candidates_rejected = candidates_rejected + 1, updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [after.run_id, tenantId]
    );

    await recordAgentAction(client, tenantId, {
      runId: after.run_id,
      findingId: after.id,
      action: 'candidate_dismissed',
      payload: { reason },
      reasoning: reason,
      requiresApproval: false,
    });

    await logAudit(client, tenantId, {
      action: 'agent_finding.rejected',
      entityType: 'agent_finding',
      entityId: findingId,
      before, after,
      userId,
    }, ctx);
    return after;
  });
}

export async function bulkApprove(
  tenantId: string,
  findingIds: string[],
  userId: string | null,
  ctx: AuditContext = {}
): Promise<{ approved: number; failed: number }> {
  let approved = 0;
  let failed = 0;
  for (const id of findingIds) {
    try {
      await approveFinding(tenantId, id, userId, null, ctx);
      approved++;
    } catch (err) {
      failed++;
      logger.warn('[sourcingAgent] bulkApprove single failed', { id, error: (err as Error).message });
    }
  }
  return { approved, failed };
}

export async function bulkReject(
  tenantId: string,
  findingIds: string[],
  reason: string,
  userId: string | null,
  ctx: AuditContext = {}
): Promise<{ rejected: number; failed: number }> {
  let rejected = 0;
  let failed = 0;
  for (const id of findingIds) {
    try {
      await rejectFinding(tenantId, id, reason, userId, ctx);
      rejected++;
    } catch (err) {
      failed++;
      logger.warn('[sourcingAgent] bulkReject single failed', { id, error: (err as Error).message });
    }
  }
  return { rejected, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions (audit timeline)
// ─────────────────────────────────────────────────────────────────────────────

export async function listActionsForRun(
  tenantId: string,
  runId: string,
  limit = 200
): Promise<AgentAction[]> {
  const cap = Math.max(1, Math.min(1000, limit));
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM agent_actions
        WHERE tenant_id = $1 AND run_id = $2
        ORDER BY created_at ASC
        LIMIT $3`,
      [tenantId, runId, cap]
    );
    return rows.map(toActionRow);
  });
}

/**
 * Tenant-brede audit-trail (alle runs). Meest recente acties eerst —
 * dit voedt de cross-run "Audit trail"-tab in de UI.
 */
export async function listActions(
  tenantId: string,
  limit = 500
): Promise<AgentAction[]> {
  const cap = Math.max(1, Math.min(1000, limit));
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM agent_actions
        WHERE tenant_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [tenantId, cap]
    );
    return rows.map(toActionRow);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory
// ─────────────────────────────────────────────────────────────────────────────

export type MemoryScope = 'tenant' | 'recruiter' | 'brief';

export interface AgentMemoryRow {
  id: string;
  tenant_id: string;
  scope: MemoryScope;
  scope_id: string | null;
  key: string;
  value: unknown;
  created_at: string;
  updated_at: string;
}

export async function listMemory(
  tenantId: string,
  scope?: MemoryScope,
  scopeId?: string | null
): Promise<AgentMemoryRow[]> {
  return withTenant(tenantId, async (client) => {
    const params: unknown[] = [tenantId];
    const wheres: string[] = ['tenant_id = $1'];
    if (scope) {
      params.push(scope);
      wheres.push(`scope = $${params.length}`);
    }
    if (scopeId !== undefined) {
      if (scopeId === null) {
        wheres.push('scope_id IS NULL');
      } else {
        params.push(scopeId);
        wheres.push(`scope_id = $${params.length}`);
      }
    }
    const { rows } = await client.query(
      `SELECT id, tenant_id, scope, scope_id, key, value, created_at, updated_at
         FROM agent_memory
        WHERE ${wheres.join(' AND ')}
        ORDER BY updated_at DESC`,
      params
    );
    return rows.map((r: any) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      scope: r.scope,
      scope_id: r.scope_id,
      key: r.key,
      value: typeof r.value === 'string' ? safeParseJson(r.value) : r.value,
      created_at: toIso(r.created_at)!,
      updated_at: toIso(r.updated_at)!,
    }));
  });
}

function safeParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

export async function upsertMemory(
  tenantId: string,
  scope: MemoryScope,
  scopeId: string | null,
  key: string,
  value: unknown
): Promise<AgentMemoryRow> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO agent_memory (tenant_id, scope, scope_id, key, value)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (tenant_id, scope, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       RETURNING id, tenant_id, scope, scope_id, key, value, created_at, updated_at`,
      [tenantId, scope, scopeId, key, JSON.stringify(value)]
    );
    const r = rows[0] as any;
    return {
      id: r.id,
      tenant_id: r.tenant_id,
      scope: r.scope,
      scope_id: r.scope_id,
      key: r.key,
      value: typeof r.value === 'string' ? safeParseJson(r.value) : r.value,
      created_at: toIso(r.created_at)!,
      updated_at: toIso(r.updated_at)!,
    };
  });
}

export async function deleteMemory(tenantId: string, memoryId: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `DELETE FROM agent_memory WHERE id = $1 AND tenant_id = $2`,
      [memoryId, tenantId]
    );
    if (!rowCount) throw new AppError(404, 'AGENT_MEMORY_NOT_FOUND', 'Memory-record niet gevonden');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Stale-run sweeper (called from cron worker)
// ─────────────────────────────────────────────────────────────────────────────

export async function findStaleRuns(autoCloseDays = 7): Promise<number> {
  // Cross-tenant scan — aangeroepen door de cron-worker met bewuste superuser
  // pool. We gebruiken hier `withTenant` niet; in plaats daarvan return we de
  // SQL-statement-string + count zodat de worker zelf de scan in een admin-pool
  // doet. Voor MVP doen we niets behalve een placeholder: de worker doet
  // de echte query. We exposen wel de helper.
  return autoCloseDays; // worker calls direct SQL
}
