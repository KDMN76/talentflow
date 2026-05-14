/**
 * Search agent — Sprint Q4.5 (Agent WWW).
 *
 * Autonome boolean-search agent: deterministische loop rond Claude.
 *
 * Loop:
 *   1) expandInitialQuery(brief) → Claude (or mock) levert een boolean string.
 *   2) searchCandidatesAcrossSources(query, brief) → fan-out over enabled sources.
 *   3) Score + dedupe; if N >= target_count en avg_match_score > 0.7 → break.
 *   4) Else: expandQueryWithFeedback(query, candidates, brief) → Claude refines.
 *      Schrijf een agent_actions row + appendable reasoning_log entry.
 *   5) Loop tot MAX_ITERATIONS.
 *   6) Insert findings, set agent_runs.status = 'review_required'.
 *
 * EU AI Act compliance: élke Claude-call → ai_events row + agent_actions row.
 * Iedere candidate-surface → agent_actions met requires_approval=true.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { withTenant } from '../../db/pool';
import { logger } from '../../middleware/errorHandler';
import { logAIEvent } from '../../lib/aiEvents';
import { getEnabledSources } from './sources';
import type {
  BooleanQuery,
  RawCandidate,
  SourcingSource,
  SourcingSourceContext,
} from './sources/types';
import type { AgentBrief } from './brief.service';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PRIMARY_MODEL = 'claude-opus-4-7';
const FALLBACK_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1500;

const DEFAULT_MAX_ITERATIONS = (() => {
  const raw = process.env.SOURCING_AGENT_MAX_ITERATIONS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10) return 5;
  return parsed;
})();

const TARGET_AVG_SCORE_THRESHOLD = 0.7; // 70/100

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic-client (lazy)
// ─────────────────────────────────────────────────────────────────────────────

let cachedClient: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing — required in production');
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

let warnedMock = false;
function shouldUseMock(): boolean {
  if (process.env.AI_MOCK === 'true') return true;
  if (process.env.ANTHROPIC_API_KEY) return false;
  if (process.env.NODE_ENV === 'production') return false;
  if (!warnedMock) {
    logger.warn('[sourcingAgent] ANTHROPIC_API_KEY ontbreekt — agent draait in mock-mode');
    warnedMock = true;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock query expansion — deterministisch
// ─────────────────────────────────────────────────────────────────────────────

export function buildInitialMockQuery(brief: AgentBrief): BooleanQuery {
  const must = brief.must_have.map((s) => `"${s}"`).join(' AND ');
  const nice = brief.nice_to_have.map((s) => `"${s}"`).join(' OR ');
  const exclude = brief.exclusions.map((s) => `NOT "${s}"`).join(' ');
  const parts = [must, nice ? `(${nice})` : '', exclude].filter(Boolean);
  return {
    query: parts.join(' ') || (brief.brief_text.split(/\s+/).slice(0, 3).join(' ') || 'developer'),
    locations: brief.search_locations,
    exclusions: brief.exclusions,
  };
}

export function refineMockQuery(
  current: BooleanQuery,
  candidates: RawCandidate[],
  brief: AgentBrief,
  iteration: number
): BooleanQuery {
  // Deterministisch: te weinig kandidaten ⇒ broaden (drop laatste must-have);
  // te veel ⇒ narrow (extra nice-to-have als must).
  const target = brief.target_count;
  if (candidates.length < target / 2) {
    // Broaden: drop een must-have.
    const must = brief.must_have.slice(0, Math.max(1, brief.must_have.length - 1 - iteration));
    const query = must.map((s) => `"${s}"`).join(' OR ');
    return { ...current, query: query || current.query };
  }
  if (candidates.length > target * 2) {
    // Narrow: extra constraint.
    const extra = brief.nice_to_have[iteration % Math.max(1, brief.nice_to_have.length)];
    return {
      ...current,
      query: extra ? `${current.query} AND "${extra}"` : current.query,
    };
  }
  // Stable.
  return current;
}

// ─────────────────────────────────────────────────────────────────────────────
// Real Claude expansion
// ─────────────────────────────────────────────────────────────────────────────

const initialQuerySchema = z.object({
  boolean_query: z.string().min(3).max(1500),
  locations: z.array(z.string().min(1).max(120)).max(10).default([]),
  exclusions: z.array(z.string().min(1).max(120)).max(15).default([]),
  reasoning: z.string().max(2000).default(''),
});

const refineQuerySchema = initialQuerySchema;

function getResponseText(message: Anthropic.Messages.Message): string {
  for (const block of message.content) {
    if (block.type === 'text') return block.text;
  }
  return '';
}

function extractJson(raw: string): unknown {
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error(`searchAgent: geen JSON in respons (preview: ${raw.slice(0, 200)})`);
  }
  return JSON.parse(raw.slice(first, last + 1));
}

const INITIAL_SYSTEM_PROMPT = [
  'Je bent een sourcing-AI die boolean-zoekstrings bouwt voor recruitment.',
  'Je krijgt een brief en levert een boolean query + locations + exclusions als JSON.',
  '',
  'STRIKT JSON-FORMAAT:',
  '{ "boolean_query": "(react OR vue) AND typescript AND amsterdam", "locations": ["Amsterdam"], "exclusions": ["banking"], "reasoning": "korte uitleg" }',
  '',
  'Vermijd te brede queries — start met must-haves AND-ed; nice-to-haves OR-ed.',
].join('\n');

const REFINE_SYSTEM_PROMPT = [
  'Je bent een sourcing-AI die een boolean-query refined op basis van surfaced candidates.',
  'Te weinig kandidaten → broaden (drop must-haves of vervang door synoniem).',
  'Te veel of irrelevant → narrow (extra constraint).',
  '',
  'STRIKT JSON-FORMAAT:',
  '{ "boolean_query": "...", "locations": [...], "exclusions": [...], "reasoning": "..." }',
].join('\n');

export interface ExpansionResult {
  query: BooleanQuery;
  reasoning: string;
  meta: {
    mocked: boolean;
    model: string;
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
  };
}

export async function expandInitialQuery(brief: AgentBrief): Promise<ExpansionResult> {
  const startedAt = Date.now();
  if (shouldUseMock()) {
    const q = buildInitialMockQuery(brief);
    return {
      query: q,
      reasoning: `mock initial query — must_have(${brief.must_have.length}), nice_to_have(${brief.nice_to_have.length}), locations(${brief.search_locations.length})`,
      meta: { mocked: true, model: `${PRIMARY_MODEL}-mock`, latencyMs: Date.now() - startedAt },
    };
  }
  const client = getAnthropicClient();
  const userPrompt = JSON.stringify({
    must_have: brief.must_have,
    nice_to_have: brief.nice_to_have,
    exclusions: brief.exclusions,
    search_locations: brief.search_locations,
    brief_excerpt: brief.brief_text.slice(0, 800),
  });
  const callModel = (model: string) => client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: INITIAL_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });
  let modelUsed = PRIMARY_MODEL;
  let response: Anthropic.Messages.Message;
  try {
    response = await callModel(PRIMARY_MODEL);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 429 && status !== 500 && status !== 502 && status !== 503) throw err;
    response = await callModel(FALLBACK_MODEL);
    modelUsed = FALLBACK_MODEL;
  }
  const raw = getResponseText(response);
  const parsed = initialQuerySchema.parse(extractJson(raw));
  return {
    query: {
      query: parsed.boolean_query,
      locations: parsed.locations,
      exclusions: parsed.exclusions,
    },
    reasoning: parsed.reasoning,
    meta: {
      mocked: false,
      model: modelUsed,
      latencyMs: Date.now() - startedAt,
      inputTokens: response.usage?.input_tokens ?? undefined,
      outputTokens: response.usage?.output_tokens ?? undefined,
    },
  };
}

export async function expandQueryWithFeedback(
  current: BooleanQuery,
  candidates: RawCandidate[],
  brief: AgentBrief,
  iteration: number
): Promise<ExpansionResult> {
  const startedAt = Date.now();
  if (shouldUseMock()) {
    const refined = refineMockQuery(current, candidates, brief, iteration);
    const reasoning = candidates.length < brief.target_count / 2
      ? `mock refine — broadening (only ${candidates.length} candidates, target ${brief.target_count})`
      : candidates.length > brief.target_count * 2
        ? `mock refine — narrowing (${candidates.length} candidates exceeds target ${brief.target_count}*2)`
        : `mock refine — stable (${candidates.length} candidates ~ target ${brief.target_count})`;
    return {
      query: refined,
      reasoning,
      meta: { mocked: true, model: `${PRIMARY_MODEL}-mock`, latencyMs: Date.now() - startedAt },
    };
  }
  const client = getAnthropicClient();
  const userPrompt = JSON.stringify({
    current_query: current.query,
    candidates_count: candidates.length,
    target_count: brief.target_count,
    avg_score: candidates.length === 0
      ? 0
      : candidates.reduce((s, c) => s + (c.rawScore ?? 0), 0) / candidates.length,
    sample_candidates: candidates.slice(0, 5).map((c) => ({
      title: c.currentTitle,
      company: c.currentCompany,
      skills: c.skills.slice(0, 5),
    })),
    must_have: brief.must_have,
    nice_to_have: brief.nice_to_have,
    iteration,
  });
  const callModel = (model: string) => client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: REFINE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });
  let modelUsed = PRIMARY_MODEL;
  let response: Anthropic.Messages.Message;
  try {
    response = await callModel(PRIMARY_MODEL);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 429 && status !== 500 && status !== 502 && status !== 503) throw err;
    response = await callModel(FALLBACK_MODEL);
    modelUsed = FALLBACK_MODEL;
  }
  const raw = getResponseText(response);
  const parsed = refineQuerySchema.parse(extractJson(raw));
  return {
    query: {
      query: parsed.boolean_query,
      locations: parsed.locations.length > 0 ? parsed.locations : current.locations,
      exclusions: parsed.exclusions.length > 0 ? parsed.exclusions : current.exclusions,
    },
    reasoning: parsed.reasoning,
    meta: {
      mocked: false,
      model: modelUsed,
      latencyMs: Date.now() - startedAt,
      inputTokens: response.usage?.input_tokens ?? undefined,
      outputTokens: response.usage?.output_tokens ?? undefined,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Source orchestration
// ─────────────────────────────────────────────────────────────────────────────

export async function searchCandidatesAcrossSources(
  query: BooleanQuery,
  ctx: SourcingSourceContext,
  sources: SourcingSource[] = getEnabledSources()
): Promise<RawCandidate[]> {
  const all: RawCandidate[] = [];
  for (const source of sources) {
    if (!source.isEnabled()) continue;
    try {
      const found = await source.search(query, ctx);
      for (const c of found) {
        all.push({ ...c, metadata: { ...(c.metadata ?? {}), source: source.id } });
      }
    } catch (err) {
      logger.warn('[sourcingAgent] source threw, continuing', {
        source: source.id,
        error: (err as Error).message,
      });
    }
  }

  // Dedupe op (externalId || fullName|currentCompany).
  const seen = new Map<string, RawCandidate>();
  for (const c of all) {
    const key = c.externalId
      ? `${c.metadata?.source ?? 'x'}::${c.externalId}`
      : `${c.fullName}|${c.currentCompany ?? ''}`;
    const existing = seen.get(key);
    if (!existing || (c.rawScore ?? 0) > (existing.rawScore ?? 0)) {
      seen.set(key, c);
    }
  }
  return Array.from(seen.values()).sort((a, b) => (b.rawScore ?? 0) - (a.rawScore ?? 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent action logging helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentActionInput {
  runId: string;
  findingId?: string | null;
  action: string;
  payload?: Record<string, unknown>;
  reasoning?: string | null;
  aiModel?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  costUsd?: number | null;
  requiresApproval?: boolean;
}

export async function recordAgentAction(
  client: PoolClient,
  tenantId: string,
  input: AgentActionInput
): Promise<void> {
  await client.query(
    `INSERT INTO agent_actions
       (tenant_id, run_id, finding_id, action, payload, reasoning,
        ai_model, prompt_tokens, completion_tokens, cost_usd, requires_approval)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)`,
    [
      tenantId,
      input.runId,
      input.findingId ?? null,
      input.action,
      JSON.stringify(input.payload ?? {}),
      input.reasoning ?? null,
      input.aiModel ?? null,
      input.promptTokens ?? null,
      input.completionTokens ?? null,
      input.costUsd ?? null,
      input.requiresApproval ?? false,
    ]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Run agent
// ─────────────────────────────────────────────────────────────────────────────

interface RunSearchAgentOptions {
  maxIterations?: number;
}

export interface RunSearchAgentResult {
  runId: string;
  briefId: string;
  candidatesFound: number;
  iterations: number;
  finalQuery: BooleanQuery;
  status: 'review_required' | 'completed' | 'failed';
}

interface RunRow {
  id: string;
  tenant_id: string;
  brief_id: string;
  status: string;
  expansion_iteration: number;
  reasoning_log: unknown;
}

interface BriefRow {
  id: string;
  tenant_id: string;
  brief_text: string;
  must_have: unknown;
  nice_to_have: unknown;
  exclusions: unknown;
  target_count: number;
  search_locations: unknown;
  language_preferences: unknown;
  job_id: string | null;
  active: boolean;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function arr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.map(String) : [];
    } catch { return []; }
  }
  return [];
}

function rowToBrief(row: BriefRow): AgentBrief {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    job_id: row.job_id,
    brief_text: row.brief_text,
    must_have: arr(row.must_have),
    nice_to_have: arr(row.nice_to_have),
    exclusions: arr(row.exclusions),
    target_count: row.target_count,
    search_locations: arr(row.search_locations),
    language_preferences: arr(row.language_preferences),
    active: row.active,
    created_by: row.created_by,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export async function runSearchAgent(
  tenantId: string,
  runId: string,
  options: RunSearchAgentOptions = {}
): Promise<RunSearchAgentResult> {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  // 1) Load brief + run binnen één tx (RLS).
  const ctx = await withTenant(tenantId, async (client) => {
    const { rows: runRows } = await client.query<RunRow>(
      `SELECT id, tenant_id, brief_id, status, expansion_iteration, reasoning_log
         FROM agent_runs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [runId, tenantId]
    );
    if (runRows.length === 0) throw new Error(`agent_run ${runId} niet gevonden`);
    const run = runRows[0];
    if (run.status === 'cancelled' || run.status === 'completed') {
      return { run, brief: null };
    }
    const { rows: briefRows } = await client.query<BriefRow>(
      `SELECT * FROM agent_briefs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [run.brief_id, tenantId]
    );
    if (briefRows.length === 0) throw new Error(`brief ${run.brief_id} niet gevonden`);
    await client.query(
      `UPDATE agent_runs SET status = 'running', started_at = COALESCE(started_at, now()),
                            updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [runId, tenantId]
    );
    return { run, brief: rowToBrief(briefRows[0]) };
  });

  if (!ctx.brief) {
    return {
      runId,
      briefId: ctx.run.brief_id,
      candidatesFound: 0,
      iterations: 0,
      finalQuery: { query: '' },
      status: 'completed',
    };
  }
  const brief = ctx.brief;

  let iteration = 0;
  let currentQuery: BooleanQuery;
  let lastCandidates: RawCandidate[] = [];
  const reasoningLog: Array<{ iteration: number; reasoning: string; query: string; candidates: number; ts: string }> = [];

  // ── 2) Initial query expansion ───────────────────────────────────────────
  let initial: ExpansionResult;
  try {
    initial = await expandInitialQuery(brief);
  } catch (err) {
    logger.error('[sourcingAgent] initial expansion failed', { error: (err as Error).message, runId });
    await markRunFailed(tenantId, runId, (err as Error).message);
    return {
      runId, briefId: brief.id, candidatesFound: 0, iterations: 0,
      finalQuery: { query: '' }, status: 'failed',
    };
  }
  currentQuery = initial.query;

  void logAIEvent(tenantId, {
    feature: 'sourcing_agent_query_expand',
    model: initial.meta.model,
    provider: initial.meta.mocked ? 'mock' : 'anthropic',
    input: brief.brief_text,
    inputTokens: initial.meta.inputTokens,
    outputTokens: initial.meta.outputTokens,
    outputSummary: `initial: ${initial.query.query.slice(0, 100)}`,
    latencyMs: initial.meta.latencyMs,
    entityType: 'agent_run',
    entityId: runId,
    status: initial.meta.mocked ? 'mocked' : 'success',
  });

  await withTenant(tenantId, async (client) => {
    await recordAgentAction(client, tenantId, {
      runId,
      action: 'query_expanded',
      payload: { iteration: 0, query: initial.query },
      reasoning: initial.reasoning,
      aiModel: initial.meta.model,
      promptTokens: initial.meta.inputTokens ?? null,
      completionTokens: initial.meta.outputTokens ?? null,
      requiresApproval: false,
    });
  });
  reasoningLog.push({
    iteration: 0,
    reasoning: initial.reasoning,
    query: initial.query.query,
    candidates: 0,
    ts: new Date().toISOString(),
  });

  // ── 3) Iterative loop ────────────────────────────────────────────────────
  for (iteration = 1; iteration <= maxIterations; iteration++) {
    const candidates = await searchCandidatesAcrossSources(currentQuery, {
      tenantId,
      brief,
      limit: Math.max(brief.target_count, 25),
    });
    lastCandidates = candidates;

    const avgScore = candidates.length === 0
      ? 0
      : candidates.reduce((s, c) => s + ((c.rawScore ?? 0) / 100), 0) / candidates.length;

    // Termination check
    if (
      candidates.length >= brief.target_count &&
      avgScore >= TARGET_AVG_SCORE_THRESHOLD
    ) {
      logger.info('[sourcingAgent] termination: target reached', {
        runId, iteration, candidates: candidates.length, avgScore,
      });
      break;
    }

    if (iteration >= maxIterations) break;

    // Refine query via feedback
    let refined: ExpansionResult;
    try {
      refined = await expandQueryWithFeedback(currentQuery, candidates, brief, iteration);
    } catch (err) {
      logger.warn('[sourcingAgent] refine failed, breaking loop', {
        runId, iteration, error: (err as Error).message,
      });
      break;
    }
    currentQuery = refined.query;

    void logAIEvent(tenantId, {
      feature: 'sourcing_agent_query_refine',
      model: refined.meta.model,
      provider: refined.meta.mocked ? 'mock' : 'anthropic',
      input: JSON.stringify({ candidates: candidates.length, target: brief.target_count }),
      inputTokens: refined.meta.inputTokens,
      outputTokens: refined.meta.outputTokens,
      outputSummary: `refine#${iteration}: ${refined.query.query.slice(0, 100)}`,
      latencyMs: refined.meta.latencyMs,
      entityType: 'agent_run',
      entityId: runId,
      status: refined.meta.mocked ? 'mocked' : 'success',
    });

    await withTenant(tenantId, async (client) => {
      await recordAgentAction(client, tenantId, {
        runId,
        action: 'query_expanded',
        payload: {
          iteration,
          query: refined.query,
          candidates_seen: candidates.length,
          avg_score: avgScore,
        },
        reasoning: refined.reasoning,
        aiModel: refined.meta.model,
        promptTokens: refined.meta.inputTokens ?? null,
        completionTokens: refined.meta.outputTokens ?? null,
        requiresApproval: false,
      });
    });
    reasoningLog.push({
      iteration,
      reasoning: refined.reasoning,
      query: refined.query.query,
      candidates: candidates.length,
      ts: new Date().toISOString(),
    });
  }

  // ── 4) Persist findings ──────────────────────────────────────────────────
  const finalCandidates = lastCandidates.slice(0, Math.max(brief.target_count, 25));
  await persistFindings(tenantId, runId, brief.id, finalCandidates);

  await withTenant(tenantId, async (client) => {
    await client.query(
      `UPDATE agent_runs
          SET status = 'review_required',
              expansion_iteration = $3,
              candidates_found = $4,
              current_query = $5::jsonb,
              reasoning_log = $6::jsonb,
              finished_at = now(),
              updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [
        runId,
        tenantId,
        iteration,
        finalCandidates.length,
        JSON.stringify(currentQuery),
        JSON.stringify(reasoningLog),
      ]
    );
  });

  return {
    runId,
    briefId: brief.id,
    candidatesFound: finalCandidates.length,
    iterations: iteration,
    finalQuery: currentQuery,
    status: 'review_required',
  };
}

async function persistFindings(
  tenantId: string,
  runId: string,
  briefId: string,
  candidates: RawCandidate[]
): Promise<void> {
  if (candidates.length === 0) return;
  await withTenant(tenantId, async (client) => {
    for (const c of candidates) {
      const sourceId = (c.metadata?.source as string | undefined) ?? 'existing_db';
      const internalId = sourceId === 'existing_db'
        ? (c.metadata?.internal_candidate_id as string | null) ?? null
        : null;
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO agent_findings
             (tenant_id, run_id, brief_id, candidate_id, external_source,
              external_url, external_id, full_name, current_title, current_company,
              location, headline, summary, skills, languages,
              match_score, match_reasoning, metadata)
           VALUES ($1, $2, $3, $4, $5,
                   $6, $7, $8, $9, $10,
                   $11, $12, $13, $14::jsonb, $15::jsonb,
                   $16, $17, $18::jsonb)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [
            tenantId,
            runId,
            briefId,
            internalId,
            sourceId,
            c.externalUrl,
            c.externalId,
            c.fullName,
            c.currentTitle,
            c.currentCompany,
            c.location,
            c.headline,
            c.summary,
            JSON.stringify(c.skills ?? []),
            JSON.stringify(c.languages ?? []),
            c.rawScore ?? null,
            c.rawScore != null
              ? `Auto-scored ${c.rawScore} by source=${sourceId}`
              : null,
            JSON.stringify(c.metadata ?? {}),
          ]
        );
        if (rows.length > 0) {
          await recordAgentAction(client, tenantId, {
            runId,
            findingId: rows[0].id,
            action: 'candidate_surfaced',
            payload: {
              source: sourceId,
              external_id: c.externalId,
              full_name: c.fullName,
              raw_score: c.rawScore ?? null,
            },
            reasoning: `Surfaced from ${sourceId}`,
            requiresApproval: true,
          });
        }
      } catch (err) {
        // Per-candidate failure mag de hele run niet stuk maken.
        logger.warn('[sourcingAgent] finding insert failed', {
          error: (err as Error).message,
          runId,
          full_name: c.fullName,
        });
      }
    }
  });
}

async function markRunFailed(
  tenantId: string,
  runId: string,
  errorMessage: string
): Promise<void> {
  try {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE agent_runs
            SET status = 'failed', error_message = $3, finished_at = now(), updated_at = now()
          WHERE id = $1 AND tenant_id = $2`,
        [runId, tenantId, errorMessage]
      );
    });
  } catch (err) {
    logger.error('[sourcingAgent] markRunFailed failed', { error: (err as Error).message });
  }
}
