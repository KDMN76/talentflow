/**
 * EU AI Act — human-oversight-gate + kandidaat-AI-transparantie.
 *
 * Twee verantwoordelijkheden:
 *
 * 1) Human-oversight-gate (art. 14). De workflow-engine mag een kandidaat
 *    nooit AUTOMATISCH afwijzen of naar een afwijzings-stage verplaatsen.
 *    `isRejectionStageName` + `createActionProposal` vormen samen de
 *    afdwinging: workflowActions.ts detecteert een reject-move en schrijft
 *    hier een voorstel (`ai_action_proposals.status='pending_review'`)
 *    i.p.v. de actie uit te voeren. Een recruiter beslist in de UI;
 *    `decideAiActionProposal` voert de actie pas uit ná goedkeuring en logt
 *    de menselijke beslissing append-only in `audit_events`.
 *
 * 2) Kandidaat-AI-samenvatting (art. 13). `getCandidateAiSummary` levert
 *    per kandidaat welke AI-verwerkingscategorieën zijn toegepast (uit
 *    `ai_events` — alléén metadata, nooit prompts/hashes) zodat een
 *    kandidaat geïnformeerd kan worden.
 */

import type { PoolClient } from 'pg';
import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';

// ─────────────────────────────────────────────────────────────────────────────
// Rejection-stage detectie (pure — exported voor tests)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stage-namen die duiden op een afwijzing. Pipeline-stages hebben geen
 * type-kolom (001_init.sql: alleen name/position/color), dus naam-matching
 * is het afdwingingspunt. Bewust ruim: NL + EN varianten.
 */
const REJECTION_STAGE_PATTERN =
  /(reject|afgewezen|afwijz|afgekeurd|declin|denied|niet\s*(aangenomen|geschikt)|turned\s*down)/i;

export function isRejectionStageName(name: string | null | undefined): boolean {
  if (!name) return false;
  return REJECTION_STAGE_PATTERN.test(name);
}

/**
 * Workflow-actietypes die ALTIJD een menselijke goedkeuring vereisen,
 * ongeacht de stage-naam. `move_to_stage` wordt daarnaast gegate wanneer de
 * doel-stage een rejection-stage is (zie isRejectionStageName).
 */
export const GATED_ACTION_TYPES = new Set([
  'reject',
  'reject_application',
  'move_to_rejected',
]);

export function isGatedActionType(actionType: string): boolean {
  return GATED_ACTION_TYPES.has(actionType);
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AiProposalStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'failed';

export interface AiActionProposalRow {
  id: string;
  tenant_id: string;
  source: string;
  source_id: string | null;
  action_type: string;
  action_config: Record<string, unknown>;
  trigger_event: string | null;
  entity_type: string;
  entity_id: string;
  candidate_id: string | null;
  job_id: string | null;
  reason: string | null;
  status: AiProposalStatus;
  proposed_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
}

export interface CreateProposalInput {
  source: string;
  sourceId?: string | null;
  actionType: string;
  actionConfig: Record<string, unknown>;
  triggerEvent?: string | null;
  entityType?: string;
  entityId: string;
  candidateId?: string | null;
  jobId?: string | null;
  reason?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Proposal aanmaken — binnen de transactie van de caller (workflow-runner)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schrijf een voorstel. Idempotent per (tenant, source, action_type, entity):
 * een tweede trigger op dezelfde entiteit met een nog openstaand voorstel is
 * een no-op (partial unique index uit migration 043).
 *
 * Returnt het proposal-id, of null wanneer er al een openstaand voorstel was.
 * Schrijft ook een `ai_proposal.created` audit-rij (append-only bewijs dat
 * de gate greep).
 */
export async function createActionProposal(
  client: PoolClient,
  tenantId: string,
  input: CreateProposalInput
): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO ai_action_proposals
       (tenant_id, source, source_id, action_type, action_config,
        trigger_event, entity_type, entity_id, candidate_id, job_id, reason)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (tenant_id, source, action_type, entity_id)
       WHERE status = 'pending_review'
     DO NOTHING
     RETURNING id`,
    [
      tenantId,
      input.source,
      input.sourceId ?? null,
      input.actionType,
      JSON.stringify(input.actionConfig ?? {}),
      input.triggerEvent ?? null,
      input.entityType ?? 'application',
      input.entityId,
      input.candidateId ?? null,
      input.jobId ?? null,
      input.reason ?? null,
    ]
  );

  const proposalId = rows[0]?.id ?? null;

  if (proposalId) {
    await logAudit(client, tenantId, {
      action: AuditActions.AI_PROPOSAL_CREATED,
      entityType: 'ai_action_proposal',
      entityId: proposalId,
      after: {
        source: input.source,
        source_id: input.sourceId ?? null,
        action_type: input.actionType,
        target_entity_type: input.entityType ?? 'application',
        target_entity_id: input.entityId,
        candidate_id: input.candidateId ?? null,
        job_id: input.jobId ?? null,
        reason: input.reason ?? null,
      },
      userId: null,
    });
  }

  return proposalId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Proposals lezen
// ─────────────────────────────────────────────────────────────────────────────

export interface ListProposalFilters {
  status?: AiProposalStatus;
  limit?: number;
  offset?: number;
}

export async function listAiActionProposals(
  tenantId: string,
  filters: ListProposalFilters = {}
): Promise<Array<AiActionProposalRow & {
  candidate_name: string | null;
  job_title: string | null;
  workflow_name: string | null;
  target_stage_name: string | null;
}>> {
  const limit = Math.max(1, Math.min(filters.limit ?? 50, 200));
  const offset = Math.max(0, filters.offset ?? 0);

  return withTenant(tenantId, async (client) => {
    const conditions: string[] = ['p.tenant_id = $1'];
    const values: unknown[] = [tenantId];
    let idx = 2;
    if (filters.status) {
      conditions.push(`p.status = $${idx++}`);
      values.push(filters.status);
    }

    const { rows } = await client.query(
      `SELECT p.*,
              c.name  AS candidate_name,
              j.title AS job_title,
              w.name  AS workflow_name,
              ps.name AS target_stage_name
         FROM ai_action_proposals p
         LEFT JOIN candidates c ON c.id = p.candidate_id AND c.tenant_id = p.tenant_id
         LEFT JOIN jobs j       ON j.id = p.job_id       AND j.tenant_id = p.tenant_id
         LEFT JOIN workflows w  ON w.id = p.source_id    AND w.tenant_id = p.tenant_id
         LEFT JOIN pipeline_stages ps
           ON ps.tenant_id = p.tenant_id
          AND ps.id = NULLIF(p.action_config->>'stage_id', '')::uuid
        WHERE ${conditions.join(' AND ')}
        ORDER BY p.proposed_at DESC
        LIMIT $${idx++} OFFSET $${idx}`,
      [...values, limit, offset]
    );
    return rows;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Menselijke beslissing — approve voert uit, reject niet. Beide gelogd.
// ─────────────────────────────────────────────────────────────────────────────

export interface DecideProposalResult {
  proposal: AiActionProposalRow;
  executed: boolean;
}

export async function decideAiActionProposal(
  tenantId: string,
  proposalId: string,
  userId: string,
  decision: 'approve' | 'reject',
  note: string | null = null,
  ctx: AuditContext = {}
): Promise<DecideProposalResult> {
  return withTenant(tenantId, async (client) => {
    const { rows: [proposal] } = await client.query<AiActionProposalRow>(
      `SELECT * FROM ai_action_proposals
        WHERE id = $1 AND tenant_id = $2
        FOR UPDATE`,
      [proposalId, tenantId]
    );
    if (!proposal) {
      throw new AppError(404, 'AI_PROPOSAL_NOT_FOUND', 'AI-voorstel niet gevonden');
    }
    if (proposal.status !== 'pending_review') {
      throw new AppError(
        409,
        'AI_PROPOSAL_ALREADY_DECIDED',
        'Dit AI-voorstel is al beoordeeld'
      );
    }

    let executed = false;
    let newStatus: AiProposalStatus = decision === 'approve' ? 'approved' : 'rejected';
    let executionError: string | null = null;

    if (decision === 'approve') {
      try {
        executed = await executeApprovedProposal(client, tenantId, proposal, userId);
        if (!executed) {
          // Doel bestaat niet meer (application/stage verwijderd) — markeer
          // als failed zodat de wachtrij niet blijft hangen.
          newStatus = 'failed';
          executionError = 'target application or stage no longer exists';
        }
      } catch (err) {
        newStatus = 'failed';
        executionError = (err as Error).message;
      }
    }

    const { rows: [updated] } = await client.query<AiActionProposalRow>(
      `UPDATE ai_action_proposals
          SET status = $1,
              decided_at = now(),
              decided_by = $2,
              decision_note = $3,
              updated_at = now()
        WHERE id = $4 AND tenant_id = $5
        RETURNING *`,
      [newStatus, userId, note, proposalId, tenantId]
    );

    // Append-only bewijs van de menselijke beslissing (wie/wanneer/welk
    // voorstel) — EU AI Act art. 14 + art. 12 logging.
    await logAudit(
      client,
      tenantId,
      {
        action:
          decision === 'approve'
            ? AuditActions.AI_PROPOSAL_APPROVED
            : AuditActions.AI_PROPOSAL_REJECTED,
        entityType: 'ai_action_proposal',
        entityId: proposalId,
        before: {
          status: proposal.status,
          action_type: proposal.action_type,
          target_entity_type: proposal.entity_type,
          target_entity_id: proposal.entity_id,
          candidate_id: proposal.candidate_id,
          job_id: proposal.job_id,
        },
        after: {
          status: newStatus,
          decision,
          decision_note: note,
          executed,
          execution_error: executionError,
        },
        userId,
      },
      ctx
    );

    return { proposal: updated, executed };
  });
}

/**
 * Voer de goedgekeurde actie daadwerkelijk uit. Ondersteunt de
 * stage-move die de gate onderschepte. Returnt false als het doel
 * (application of stage) niet meer bestaat.
 */
async function executeApprovedProposal(
  client: PoolClient,
  tenantId: string,
  proposal: AiActionProposalRow,
  userId: string
): Promise<boolean> {
  const config = (proposal.action_config ?? {}) as Record<string, unknown>;
  const stageId = typeof config.stage_id === 'string' ? config.stage_id : null;
  const stageName = typeof config.stage_name === 'string' ? config.stage_name : null;

  const { rows: [app] } = await client.query(
    `SELECT id, job_id, stage_id, status, candidate_id
       FROM applications WHERE id = $1 AND tenant_id = $2`,
    [proposal.entity_id, tenantId]
  );
  if (!app) return false;

  let resolvedStageId = stageId;
  if (!resolvedStageId && stageName) {
    const { rows: [stage] } = await client.query(
      `SELECT id FROM pipeline_stages
        WHERE job_id = $1 AND tenant_id = $2 AND lower(name) = lower($3)
        LIMIT 1`,
      [app.job_id, tenantId, stageName]
    );
    resolvedStageId = stage?.id ?? null;
  }
  if (!resolvedStageId) return false;

  await client.query(
    `UPDATE applications
        SET stage_id = $1, updated_at = now()
      WHERE id = $2 AND tenant_id = $3`,
    [resolvedStageId, proposal.entity_id, tenantId]
  );

  // Zichtbaar in de user-facing activity-feed, net als handmatige moves.
  await client.query(
    `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
     VALUES ($1, 'application', $2, $3, 'stage_changed', $4)`,
    [
      tenantId,
      proposal.entity_id,
      userId,
      JSON.stringify({
        stage_id: resolvedStageId,
        via: 'ai_proposal_approval',
        proposal_id: proposal.id,
      }),
    ]
  );

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Kandidaat-AI-samenvatting (art. 13 — transparantie richting kandidaat)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Feature → verwerkingscategorie. De web-kant vertaalt categorie-keys naar
 * NL/EN labels; onbekende features vallen terug op 'other'.
 */
const FEATURE_CATEGORIES: Record<string, string> = {
  resume_parser: 'profile_parsing',
  embedding: 'semantic_indexing',
  match_explanation: 'matching',
  bias_check: 'bias_monitoring',
  jd_generator: 'content_generation',
  interview_summary: 'interview_ai',
  interview_transcription: 'interview_ai',
  reply_classifier: 'communication_ai',
  outreach_draft: 'communication_ai',
};

export function categorizeAiFeature(feature: string): string {
  return FEATURE_CATEGORIES[feature] ?? 'other';
}

export interface CandidateAiSummaryEntry {
  feature: string;
  category: string;
  event_count: number;
  first_used_at: string;
  last_used_at: string;
  models: string[];
}

export interface CandidateAiSummary {
  candidate_id: string;
  entries: CandidateAiSummaryEntry[];
  has_ai_processing: boolean;
  generated_at: string;
}

/**
 * Welke AI-verwerkingen zijn op deze kandidaat toegepast, en wanneer.
 * Bewust GEEN prompts, input-hashes of output-samenvattingen — alleen
 * categorieën, datums en modelnamen. Tenant-scoped via RLS.
 */
export async function getCandidateAiSummary(
  tenantId: string,
  candidateId: string
): Promise<CandidateAiSummary> {
  return withTenant(tenantId, async (client) => {
    const { rows: [candidate] } = await client.query(
      `SELECT id FROM candidates WHERE id = $1 AND tenant_id = $2`,
      [candidateId, tenantId]
    );
    if (!candidate) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
    }

    const { rows } = await client.query<{
      feature: string;
      event_count: number;
      first_used_at: string;
      last_used_at: string;
      models: string[];
    }>(
      `SELECT feature,
              COUNT(*)::int              AS event_count,
              MIN(created_at)::text      AS first_used_at,
              MAX(created_at)::text      AS last_used_at,
              ARRAY_AGG(DISTINCT model)  AS models
         FROM ai_events
        WHERE tenant_id = $1
          AND entity_type = 'candidate'
          AND entity_id = $2
          AND status IN ('success', 'mocked')
        GROUP BY feature
        ORDER BY MAX(created_at) DESC`,
      [tenantId, candidateId]
    );

    const entries: CandidateAiSummaryEntry[] = rows.map((r) => ({
      feature: r.feature,
      category: categorizeAiFeature(r.feature),
      event_count: r.event_count,
      first_used_at: r.first_used_at,
      last_used_at: r.last_used_at,
      models: r.models ?? [],
    }));

    return {
      candidate_id: candidateId,
      entries,
      has_ai_processing: entries.length > 0,
      generated_at: new Date().toISOString(),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Retention-check (EU AI Act art. 12/19 — logging van high-risk AI ≥ 6 mnd)
// ─────────────────────────────────────────────────────────────────────────────

/** Minimale bewaartermijn voor AI-logging in maanden (EU AI Act art. 19). */
export const AI_EVENTS_MIN_RETENTION_MONTHS = 6;

export interface AiRetentionStatus {
  /** Vereiste minimumbewaartermijn in maanden. */
  minimum_retention_months: number;
  /** Oudste ai_event van deze tenant (ISO), of null zonder events. */
  oldest_event_at: string | null;
  /** Jongste ai_event van deze tenant (ISO), of null zonder events. */
  newest_event_at: string | null;
  /** Totaal aantal gelogde AI-events voor deze tenant. */
  total_events: number;
  /** Hoeveel maanden logging er daadwerkelijk ligt (0 zonder events). */
  months_covered: number;
  /**
   * Structurele garantie: ai_events is WORM (migration 008 blokkeert
   * UPDATE/DELETE via trigger) en geen enkele retention-/cleanup-job
   * ruimt deze tabel op — de bewaartermijn kan dus niet geschonden worden.
   */
  worm_protected: boolean;
  /**
   * true zodra de bewaargarantie staat. Omdat de garantie structureel is
   * (WORM + geen cleanup-jobs) is dit altijd true; het veld bestaat zodat
   * de UI dit kan tonen en een toekomstige wijziging expliciet moet kiezen
   * om dit op false te zetten.
   */
  compliant: boolean;
  generated_at: string;
}

/**
 * Retentie-status van de AI-logging (ai_events) voor het compliance/analytics
 * dashboard. Puur lezend; tenant-scoped via RLS.
 */
export async function getAiRetentionStatus(
  tenantId: string
): Promise<AiRetentionStatus> {
  return withTenant(tenantId, async (client) => {
    const { rows: [row] } = await client.query<{
      oldest: string | null;
      newest: string | null;
      total: string;
    }>(
      `SELECT MIN(created_at)::text AS oldest,
              MAX(created_at)::text AS newest,
              COUNT(*)::text        AS total
         FROM ai_events
        WHERE tenant_id = $1`,
      [tenantId]
    );

    const oldest = row?.oldest ?? null;
    const newest = row?.newest ?? null;
    const total = parseInt(row?.total ?? '0', 10) || 0;

    let monthsCovered = 0;
    if (oldest) {
      const ms = Date.now() - new Date(oldest).getTime();
      monthsCovered = Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24 * 30.44)));
    }

    return {
      minimum_retention_months: AI_EVENTS_MIN_RETENTION_MONTHS,
      oldest_event_at: oldest,
      newest_event_at: newest,
      total_events: total,
      months_covered: monthsCovered,
      worm_protected: true,
      compliant: true,
      generated_at: new Date().toISOString(),
    };
  });
}
