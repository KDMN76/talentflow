/**
 * Brief service — Sprint Q4.5 (Agent WWW).
 *
 * Recruiter geeft de agent een natuurlijke-taal brief; Claude (of mock-mode
 * regex-parser) extraheert must_have / nice_to_have / exclusions / target_count /
 * search_locations. Persisted in `agent_briefs` (RLS).
 *
 * Mock-mode (AI_MOCK=true OR geen ANTHROPIC_API_KEY): heuristische parser die
 * uit een built-in keyword-list skills herkent en regex'en gebruikt voor
 * jaren ervaring + doel-aantal. Genoeg voor tests + CI zonder API-kosten.
 *
 * Logging: Claude-call → ai_events('brief_parser') + agent_actions
 * (zie searchAgent.service voor de helper). Brief-CRUD → audit_events.
 */

import type { PoolClient } from 'pg';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import {
  logAudit,
  type AuditContext,
} from '../../lib/audit';
import { logAIEvent } from '../../lib/aiEvents';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentBrief {
  id: string;
  tenant_id: string;
  job_id: string | null;
  brief_text: string;
  must_have: string[];
  nice_to_have: string[];
  exclusions: string[];
  target_count: number;
  search_locations: string[];
  language_preferences: string[];
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateBriefInput {
  job_id?: string | null;
  brief_text: string;
  must_have?: string[];
  nice_to_have?: string[];
  exclusions?: string[];
  target_count?: number;
  search_locations?: string[];
  language_preferences?: string[];
}

export interface UpdateBriefInput {
  job_id?: string | null;
  brief_text?: string;
  must_have?: string[];
  nice_to_have?: string[];
  exclusions?: string[];
  target_count?: number;
  search_locations?: string[];
  language_preferences?: string[];
  active?: boolean;
}

export interface ListBriefFilters {
  job_id?: string | null;
  active?: boolean;
  cursor?: string | null;
  limit?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation schemas
// ─────────────────────────────────────────────────────────────────────────────

export const createBriefSchema = z.object({
  job_id: z.string().uuid().nullable().optional(),
  brief_text: z.string().trim().min(20, 'Brief moet minstens 20 tekens bevatten').max(20_000),
  must_have: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  nice_to_have: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  exclusions: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  target_count: z.number().int().min(1).max(500).optional(),
  search_locations: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  language_preferences: z.array(z.string().trim().min(1).max(8)).max(10).optional(),
});

export const updateBriefSchema = createBriefSchema.partial().extend({
  active: z.boolean().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Constants — Claude-mode
// ─────────────────────────────────────────────────────────────────────────────

const PRIMARY_MODEL = 'claude-opus-4-7';
const FALLBACK_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1500;

const SYSTEM_PROMPT = [
  'Je bent een Nederlandstalige recruitment-AI die natural-language sourcing-briefs analyseert.',
  'Je krijgt een ruwe brief van een recruiter en extraheert gestructureerde requirements.',
  '',
  'STRIKT OUTPUT-FORMAAT:',
  '- Antwoord UITSLUITEND met een geldig JSON-object — geen markdown, geen uitleg.',
  '- Schema: { "must_have": string[], "nice_to_have": string[], "exclusions": string[], "target_count": number, "search_locations": string[] }',
  '',
  'VELD-INSTRUCTIES:',
  '- must_have: harde eisen (skills, jaren ervaring, certificeringen). Max 15 items.',
  '- nice_to_have: voorkeuren maar geen blockers. Max 15 items.',
  '- exclusions: expliciet uitgesloten (bijv. ex-werkgever, specifieke industrie). Max 10 items.',
  '- target_count: hoeveel kandidaten wil de recruiter (default 25 als niet genoemd).',
  '- search_locations: city/region/country strings ("Amsterdam","Randstad","Netherlands"). Max 10.',
].join('\n');

// Mock-mode keyword bank — uitbreidbaar zonder migration.
const SKILL_KEYWORDS = [
  'javascript','typescript','react','vue','angular','node','nodejs','python','java','golang','rust',
  'kotlin','swift','c#','c++','php','ruby','sql','postgresql','mysql','mongodb','redis',
  'aws','azure','gcp','kubernetes','docker','terraform','ansible','jenkins','gitlab','github',
  'graphql','rest','grpc','microservices','kafka','rabbitmq','elasticsearch',
  'nextjs','nestjs','express','spring','django','flask','rails','laravel',
  'product management','project management','scrum','agile','prince2','pmi',
  'data engineering','data science','machine learning','ai','llm','nlp','computer vision',
  'devops','sre','security','penetration testing','iso 27001','gdpr',
  'sales','account management','recruiting','sourcing','hr','finance','controlling',
  'dutch','nederlands','english','engels','german','duits','french','frans',
];

const LOCATION_KEYWORDS = [
  'amsterdam','rotterdam','utrecht','den haag','the hague','eindhoven','groningen','tilburg','breda',
  'arnhem','nijmegen','almere','randstad','noord-holland','zuid-holland','flevoland',
  'netherlands','nederland','holland','belgium','belgië','germany','duitsland','remote',
];

const EXCLUSION_HINT_PHRASES = [
  /\bgeen\s+([^,\.\n]{3,80})/gi,
  /\bnot?\s+(?:from|at)\s+([^,\.\n]{3,80})/gi,
  /\bexcluding\s+([^,\.\n]{3,80})/gi,
  /\buitgesloten[:\s]+([^,\.\n]{3,80})/gi,
];

const NICE_TO_HAVE_HINT_PHRASES = [
  /\bnice[\s-]to[\s-]have[:\s]+([^.\n]{3,200})/gi,
  /\bpre\s*(?:is\s*een\s*)?pre[:\s]+([^.\n]{3,200})/gi,
  /\bpr[ée]/gi, // weak — handled separately
];

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic client (lazy)
// ─────────────────────────────────────────────────────────────────────────────

let cachedClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY ontbreekt: vereist voor brief parsing in productie.');
    }
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

let warnedAboutMissingKey = false;
function shouldUseMock(): boolean {
  if (process.env.AI_MOCK === 'true') return true;
  if (process.env.ANTHROPIC_API_KEY) return false;
  if (process.env.NODE_ENV === 'production') return false;
  if (!warnedAboutMissingKey) {
    logger.warn('[sourcingAgent] ANTHROPIC_API_KEY ontbreekt — brief-parser draait in mock-mode');
    warnedAboutMissingKey = true;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock parser — heuristisch maar deterministisch
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedBriefStructure {
  must_have: string[];
  nice_to_have: string[];
  exclusions: string[];
  target_count: number;
  search_locations: string[];
}

export function parseBriefMock(text: string): ParsedBriefStructure {
  const lower = text.toLowerCase();

  // 1) skills / must-haves
  const skillsFound = new Set<string>();
  for (const kw of SKILL_KEYWORDS) {
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(lower)) skillsFound.add(kw);
  }

  // years of experience → e.g. "5 jaar ervaring", "5+ years experience"
  const yoeMatch = /(\d{1,2})\+?\s*(jaar|jaren|years?)\s*(ervaring|experience)/i.exec(text);
  const must_have: string[] = Array.from(skillsFound).slice(0, 12);
  if (yoeMatch) {
    must_have.push(`${yoeMatch[1]}+ ${yoeMatch[2].toLowerCase().startsWith('jaar') ? 'jaar' : 'years'} ervaring`);
  }

  // 2) target_count
  const tcMatch = /(\d{1,3})\s*(kandidaten|candidates|profielen|profiles)/i.exec(text);
  const target_count = tcMatch ? Math.min(500, Math.max(1, parseInt(tcMatch[1], 10))) : 25;

  // 3) locations
  const locFound = new Set<string>();
  for (const loc of LOCATION_KEYWORDS) {
    const re = new RegExp(`\\b${loc}\\b`, 'i');
    if (re.test(text)) locFound.add(loc);
  }

  // 4) nice-to-have hints
  const nice_to_have: string[] = [];
  for (const re of NICE_TO_HAVE_HINT_PHRASES) {
    let match: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((match = re.exec(text)) && nice_to_have.length < 8) {
      if (match[1]) nice_to_have.push(match[1].trim().slice(0, 120));
    }
  }

  // 5) exclusions hints
  const exclusions: string[] = [];
  for (const re of EXCLUSION_HINT_PHRASES) {
    let match: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((match = re.exec(text)) && exclusions.length < 8) {
      if (match[1]) exclusions.push(match[1].trim().slice(0, 120));
    }
  }

  return {
    must_have: must_have.slice(0, 15),
    nice_to_have: dedupe(nice_to_have).slice(0, 15),
    exclusions: dedupe(exclusions).slice(0, 10),
    target_count,
    search_locations: Array.from(locFound).slice(0, 10),
  };
}

function dedupe<T extends string>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const v of arr) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Real Claude parsing
// ─────────────────────────────────────────────────────────────────────────────

const aiParseSchema = z.object({
  must_have: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  nice_to_have: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  exclusions: z.array(z.string().trim().min(1).max(200)).max(15).default([]),
  target_count: z.number().int().min(1).max(500).default(25),
  search_locations: z.array(z.string().trim().min(1).max(120)).max(15).default([]),
});

function extractJson(raw: string): unknown {
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error(`brief.parser: geen JSON-object in respons (preview: ${raw.slice(0, 300)})`);
  }
  return JSON.parse(raw.slice(first, last + 1));
}

function getResponseText(message: Anthropic.Messages.Message): string {
  for (const block of message.content) {
    if (block.type === 'text') return block.text;
  }
  return '';
}

interface ParseBriefResult extends ParsedBriefStructure {
  _meta: {
    mocked: boolean;
    model: string;
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
  };
}

export async function parseBriefWithAI(briefText: string): Promise<ParseBriefResult> {
  const startedAt = Date.now();
  if (shouldUseMock()) {
    const parsed = parseBriefMock(briefText);
    return {
      ...parsed,
      _meta: {
        mocked: true,
        model: `${PRIMARY_MODEL}-mock`,
        latencyMs: Date.now() - startedAt,
      },
    };
  }

  const client = getAnthropicClient();
  const userPrompt = [
    'Hieronder een sourcing-brief. Extraheer requirements als JSON conform het afgesproken schema.',
    '',
    '--- BEGIN BRIEF ---',
    briefText.slice(0, 8000),
    '--- EINDE BRIEF ---',
  ].join('\n');

  const callModel = async (model: string): Promise<Anthropic.Messages.Message> =>
    client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

  let modelUsed = PRIMARY_MODEL;
  let response: Anthropic.Messages.Message;
  try {
    response = await callModel(PRIMARY_MODEL);
  } catch (err) {
    const status = (err as { status?: number; statusCode?: number }).status
      ?? (err as { status?: number; statusCode?: number }).statusCode;
    if (status !== 429 && status !== 500 && status !== 502 && status !== 503) throw err;
    logger.warn('[sourcingAgent] brief-parser primary failed — retrying on fallback', {
      error: (err as Error).message,
    });
    response = await callModel(FALLBACK_MODEL);
    modelUsed = FALLBACK_MODEL;
  }

  const raw = getResponseText(response);
  const candidate = extractJson(raw);
  const validated = aiParseSchema.parse(candidate);
  return {
    ...validated,
    _meta: {
      mocked: false,
      model: modelUsed,
      latencyMs: Date.now() - startedAt,
      inputTokens: response.usage?.input_tokens ?? undefined,
      outputTokens: response.usage?.output_tokens ?? undefined,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

interface AgentBriefRow {
  id: string;
  tenant_id: string;
  job_id: string | null;
  brief_text: string;
  must_have: string | string[];
  nice_to_have: string | string[];
  exclusions: string | string[];
  target_count: number;
  search_locations: string | string[];
  language_preferences: string | string[];
  active: boolean;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function parseJsonArr(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function rowToBrief(row: AgentBriefRow): AgentBrief {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    job_id: row.job_id,
    brief_text: row.brief_text,
    must_have: parseJsonArr(row.must_have),
    nice_to_have: parseJsonArr(row.nice_to_have),
    exclusions: parseJsonArr(row.exclusions),
    target_count: row.target_count,
    search_locations: parseJsonArr(row.search_locations),
    language_preferences: parseJsonArr(row.language_preferences),
    active: row.active,
    created_by: row.created_by,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public service
// ─────────────────────────────────────────────────────────────────────────────

export async function createBrief(
  tenantId: string,
  input: CreateBriefInput,
  userId: string | null,
  ctx: AuditContext = {}
): Promise<AgentBrief> {
  const briefText = input.brief_text;

  // Parse via AI (or mock) — eventuele user-supplied velden overrulen.
  let parsed: ParseBriefResult;
  try {
    parsed = await parseBriefWithAI(briefText);
  } catch (err) {
    logger.error('[sourcingAgent] brief-parser failed, falling back to mock', {
      error: (err as Error).message,
    });
    const fallback = parseBriefMock(briefText);
    parsed = {
      ...fallback,
      _meta: {
        mocked: true,
        model: 'mock-fallback-after-error',
        latencyMs: 0,
      },
    };
  }

  void logAIEvent(tenantId, {
    feature: 'sourcing_brief_parser',
    model: parsed._meta.model,
    provider: parsed._meta.mocked ? 'mock' : 'anthropic',
    input: briefText,
    inputTokens: parsed._meta.inputTokens,
    outputTokens: parsed._meta.outputTokens,
    outputSummary: `must_have=${parsed.must_have.length} nice=${parsed.nice_to_have.length} excl=${parsed.exclusions.length}`,
    latencyMs: parsed._meta.latencyMs,
    entityType: 'agent_brief',
    userId,
    status: parsed._meta.mocked ? 'mocked' : 'success',
  });

  const must_have = input.must_have ?? parsed.must_have;
  const nice_to_have = input.nice_to_have ?? parsed.nice_to_have;
  const exclusions = input.exclusions ?? parsed.exclusions;
  const target_count = input.target_count ?? parsed.target_count;
  const search_locations = input.search_locations ?? parsed.search_locations;
  const language_preferences = input.language_preferences ?? ['nl', 'en'];

  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<AgentBriefRow>(
      `INSERT INTO agent_briefs
        (tenant_id, job_id, brief_text, must_have, nice_to_have, exclusions,
         target_count, search_locations, language_preferences, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9::jsonb, $10)
       RETURNING *`,
      [
        tenantId,
        input.job_id ?? null,
        briefText,
        JSON.stringify(must_have),
        JSON.stringify(nice_to_have),
        JSON.stringify(exclusions),
        target_count,
        JSON.stringify(search_locations),
        JSON.stringify(language_preferences),
        userId,
      ]
    );
    const brief = rowToBrief(rows[0]);
    await logAudit(client, tenantId, {
      action: 'agent_brief.created',
      entityType: 'agent_brief',
      entityId: brief.id,
      after: { job_id: brief.job_id, target_count: brief.target_count, mocked: parsed._meta.mocked },
      userId,
    }, ctx);
    return brief;
  });
}

export async function getBrief(tenantId: string, briefId: string): Promise<AgentBrief> {
  return withTenant(tenantId, async (client) => loadBrief(client, tenantId, briefId));
}

async function loadBrief(client: PoolClient, tenantId: string, briefId: string): Promise<AgentBrief> {
  const { rows } = await client.query<AgentBriefRow>(
    `SELECT * FROM agent_briefs WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [briefId, tenantId]
  );
  if (rows.length === 0) {
    throw new AppError(404, 'AGENT_BRIEF_NOT_FOUND', 'Brief niet gevonden');
  }
  return rowToBrief(rows[0]);
}

export async function listBriefs(
  tenantId: string,
  filters: ListBriefFilters = {}
): Promise<{ data: AgentBrief[]; nextCursor: string | null }> {
  const limit = Math.max(1, Math.min(200, filters.limit ?? 50));
  return withTenant(tenantId, async (client) => {
    const params: unknown[] = [tenantId];
    const conditions: string[] = ['tenant_id = $1'];
    if (filters.job_id !== undefined) {
      params.push(filters.job_id);
      conditions.push(filters.job_id === null
        ? 'job_id IS NULL'
        : `job_id = $${params.length}`);
    }
    if (filters.active !== undefined) {
      params.push(filters.active);
      conditions.push(`active = $${params.length}`);
    }
    if (filters.cursor) {
      params.push(filters.cursor);
      conditions.push(`created_at < (SELECT created_at FROM agent_briefs WHERE id = $${params.length})`);
    }
    params.push(limit + 1);
    const sql = `SELECT * FROM agent_briefs
                 WHERE ${conditions.join(' AND ')}
                 ORDER BY created_at DESC, id DESC
                 LIMIT $${params.length}`;
    const { rows } = await client.query<AgentBriefRow>(sql, params);
    const briefs = rows.map(rowToBrief);
    const hasMore = briefs.length > limit;
    const data = hasMore ? briefs.slice(0, limit) : briefs;
    const nextCursor = hasMore ? data[data.length - 1].id : null;
    return { data, nextCursor };
  });
}

export async function updateBrief(
  tenantId: string,
  briefId: string,
  input: UpdateBriefInput,
  userId: string | null,
  ctx: AuditContext = {}
): Promise<AgentBrief> {
  return withTenant(tenantId, async (client) => {
    const before = await loadBrief(client, tenantId, briefId);
    const sets: string[] = [];
    const params: unknown[] = [];
    function set(field: string, value: unknown, jsonb = false) {
      params.push(jsonb ? JSON.stringify(value) : value);
      sets.push(`${field} = $${params.length}${jsonb ? '::jsonb' : ''}`);
    }
    if (input.job_id !== undefined) set('job_id', input.job_id);
    if (input.brief_text !== undefined) set('brief_text', input.brief_text);
    if (input.must_have !== undefined) set('must_have', input.must_have, true);
    if (input.nice_to_have !== undefined) set('nice_to_have', input.nice_to_have, true);
    if (input.exclusions !== undefined) set('exclusions', input.exclusions, true);
    if (input.target_count !== undefined) set('target_count', input.target_count);
    if (input.search_locations !== undefined) set('search_locations', input.search_locations, true);
    if (input.language_preferences !== undefined) set('language_preferences', input.language_preferences, true);
    if (input.active !== undefined) set('active', input.active);
    if (sets.length === 0) return before;
    sets.push('updated_at = now()');
    params.push(briefId);
    params.push(tenantId);
    const sql = `UPDATE agent_briefs SET ${sets.join(', ')}
                 WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
                 RETURNING *`;
    const { rows } = await client.query<AgentBriefRow>(sql, params);
    if (rows.length === 0) throw new AppError(404, 'AGENT_BRIEF_NOT_FOUND', 'Brief niet gevonden');
    const after = rowToBrief(rows[0]);
    await logAudit(client, tenantId, {
      action: 'agent_brief.updated',
      entityType: 'agent_brief',
      entityId: briefId,
      before,
      after,
      userId,
    }, ctx);
    return after;
  });
}

export async function archiveBrief(
  tenantId: string,
  briefId: string,
  userId: string | null,
  ctx: AuditContext = {}
): Promise<AgentBrief> {
  return updateBrief(tenantId, briefId, { active: false }, userId, ctx);
}
