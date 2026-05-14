/**
 * JD bias-/clarity-/inclusivity-check.
 *
 * Pattern volgt aiParser.ts:
 *  - Anthropic Claude met fallback-model bij transient errors.
 *  - Mock-fallback in dev (warning bij missende key); throw in productie.
 *  - Output strikt JSON, gevalideerd met zod.
 *
 * Cache:
 *  - jd_hash = SHA-256 van canonical(JD-tekst). Bij identieke hash hergebruiken
 *    we de laatste row uit `job_bias_checks` ipv opnieuw te bellen.
 */

import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../middleware/errorHandler';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type BiasFlagType =
  | 'gendered_language'
  | 'age_indicator'
  | 'unrealistic_requirement'
  | 'exclusionary'
  | 'jargon';

export interface BiasFlag {
  type: BiasFlagType;
  text: string;
  suggestion: string;
}

export interface BiasCheckResult {
  bias_flags: BiasFlag[];
  clarity_score: number;
  inclusivity_score: number;
  computed_at: string;
  cached: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PRIMARY_MODEL = 'claude-opus-4-7';
const FALLBACK_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1500;
const MAX_JD_CHARS = 12_000;

const SYSTEM_PROMPT = [
  'Je bent een Nederlandstalige recruitment-AI die vacatureteksten analyseert op bias en helderheid.',
  'Je krijgt een vacaturetekst en moet deze beoordelen.',
  '',
  'STRIKT OUTPUT-FORMAAT:',
  '- Antwoord UITSLUITEND met een geldig JSON-object — geen begeleidende tekst.',
  '- GEEN markdown-fences (```), GEEN uitleg, GEEN voor- of nawoord.',
  '- Het JSON-object moet exact deze keys hebben: bias_flags, clarity_score, inclusivity_score.',
  '',
  'VELD-INSTRUCTIES:',
  '- bias_flags: array van {type, text, suggestion}.',
  '  - type ∈ ["gendered_language","age_indicator","unrealistic_requirement","exclusionary","jargon"].',
  '  - text: de exacte phrase uit de tekst die het probleem geeft (max 200 tekens).',
  '  - suggestion: NL-talige verbetering (max 200 tekens).',
  '- clarity_score: integer 0-100 — 100 = glashelder, 0 = onleesbaar.',
  '- inclusivity_score: integer 0-100 — 100 = volledig inclusief, 0 = sterk uitsluitend.',
  '',
  'Analyseer beknopt en feitelijk. Maximaal 10 bias_flags.',
].join('\n');

// ─────────────────────────────────────────────────────────────────────────────
// zod schema
// ─────────────────────────────────────────────────────────────────────────────

const biasFlagSchema = z.object({
  type: z.enum([
    'gendered_language',
    'age_indicator',
    'unrealistic_requirement',
    'exclusionary',
    'jargon',
  ]),
  text: z.string().trim().min(1).max(400),
  suggestion: z.string().trim().min(1).max(400),
});

const biasResultSchema = z.object({
  bias_flags: z.array(biasFlagSchema).max(20).default([]),
  clarity_score: z.number().int().min(0).max(100),
  inclusivity_score: z.number().int().min(0).max(100),
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a canonical JD-string + SHA-256 hash. Inputs are title, description
 * and required_skills (sorted, lower-cased). Whitespace is collapsed so
 * cosmetic edits don't bust the cache.
 */
export function computeJdHash(input: {
  title: string | null;
  description: string | null;
  required_skills: string[] | null;
}): { canonical: string; hash: string } {
  const skills = (input.required_skills ?? [])
    .map((s) => s.toLowerCase().trim())
    .filter(Boolean)
    .sort();
  const canonical = [
    (input.title ?? '').trim(),
    (input.description ?? '').replace(/\s+/g, ' ').trim(),
    skills.join(','),
  ].join('\n---\n');
  const hash = crypto.createHash('sha256').update(canonical).digest('hex');
  return { canonical, hash };
}

function extractJson(raw: string): unknown {
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error(
      `bias-check: geen JSON-object gevonden in respons (preview: ${raw.slice(0, 500)})`
    );
  }
  const slice = raw.slice(first, last + 1);
  try {
    return JSON.parse(slice);
  } catch (err) {
    throw new Error(
      `bias-check: JSON.parse faalde (${(err as Error).message}); preview: ${raw.slice(0, 500)}`
    );
  }
}

function getResponseText(message: Anthropic.Messages.Message): string {
  for (const block of message.content) {
    if (block.type === 'text') return block.text;
  }
  return '';
}

function isTransientApiError(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number };
  const status = e?.status ?? e?.statusCode;
  return status === 429 || status === 500 || status === 502 || status === 503;
}

// ─── Mock (dev-zonder-API-key) ──────────────────────────────────────────────

function buildMockResult(): {
  bias_flags: BiasFlag[];
  clarity_score: number;
  inclusivity_score: number;
} {
  return {
    bias_flags: [
      {
        type: 'gendered_language',
        text: 'rockstar developer',
        suggestion: 'Vervang door "ervaren ontwikkelaar" — neutraler en concreter.',
      },
      {
        type: 'unrealistic_requirement',
        text: '10+ jaar ervaring met React',
        suggestion:
          'React bestaat sinds 2013; 10+ jaar is feitelijk onmogelijk. Heroverweeg naar 5+ jaar.',
      },
    ],
    clarity_score: 72,
    inclusivity_score: 68,
  };
}

// ─── Anthropic-client (lazy singleton) ──────────────────────────────────────

let cachedClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY ontbreekt: vereist voor bias-check in productie.'
      );
    }
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

let warnedAboutMissingKey = false;
function shouldUseMockFallback(): boolean {
  if (process.env.ANTHROPIC_API_KEY) return false;
  if (process.env.NODE_ENV === 'production') return false;
  if (!warnedAboutMissingKey) {
    logger.warn(
      '[jobBiasCheck] ANTHROPIC_API_KEY ontbreekt — dev-fallback met mock-resultaat actief'
    );
    warnedAboutMissingKey = true;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function checkJobBias(
  tenantId: string,
  jobId: string
): Promise<BiasCheckResult> {
  return withTenant(tenantId, async (client) => {
    const { rows: [job] } = await client.query(
      `SELECT id, title, description, required_skills
       FROM jobs
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [jobId, tenantId]
    );
    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');
    }

    const { canonical, hash } = computeJdHash({
      title: job.title,
      description: job.description,
      required_skills: job.required_skills ?? [],
    });

    // Cache lookup — most recent row with same hash.
    const { rows: [cached] } = await client.query(
      `SELECT bias_flags, clarity_score, inclusivity_score, computed_at
       FROM job_bias_checks
       WHERE tenant_id = $1 AND job_id = $2 AND jd_hash = $3
       ORDER BY computed_at DESC
       LIMIT 1`,
      [tenantId, jobId, hash]
    );

    if (cached) {
      return {
        bias_flags: (cached.bias_flags as BiasFlag[]) ?? [],
        clarity_score: cached.clarity_score ?? 0,
        inclusivity_score: cached.inclusivity_score ?? 0,
        computed_at: new Date(cached.computed_at).toISOString(),
        cached: true,
      };
    }

    // Compute (mock or live).
    let computed: {
      bias_flags: BiasFlag[];
      clarity_score: number;
      inclusivity_score: number;
    };

    if (shouldUseMockFallback()) {
      computed = buildMockResult();
    } else {
      const anthropic = getAnthropicClient();
      const safeText = canonical.slice(0, MAX_JD_CHARS);

      const userPrompt = [
        'Hieronder volgt de canonical-vorm van een vacaturetekst (titel + beschrijving + sorted skills).',
        'Analyseer en retourneer JSON volgens het afgesproken schema.',
        '',
        '--- BEGIN VACATURE ---',
        safeText,
        '--- EINDE VACATURE ---',
      ].join('\n');

      const callModel = async (
        model: string
      ): Promise<Anthropic.Messages.Message> => {
        return anthropic.messages.create({
          model,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
        });
      };

      let response: Anthropic.Messages.Message;
      try {
        response = await callModel(PRIMARY_MODEL);
      } catch (err) {
        if (!isTransientApiError(err)) throw err;
        logger.warn('[jobBiasCheck] primary model faalde — retry op fallback', {
          model: PRIMARY_MODEL,
          fallback: FALLBACK_MODEL,
          error: (err as Error).message,
        });
        response = await callModel(FALLBACK_MODEL);
      }

      const rawText = getResponseText(response);
      if (!rawText) {
        throw new Error('bias-check: lege respons van Claude (geen text-block).');
      }

      const candidate = extractJson(rawText);
      const validated = biasResultSchema.safeParse(candidate);
      if (!validated.success) {
        const issues = validated.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        throw new Error(
          `bias-check: schema-validatie faalde (${issues}); preview: ${rawText.slice(0, 500)}`
        );
      }
      computed = validated.data;
    }

    // Persist a fresh cache row.
    const { rows: [persisted] } = await client.query(
      `INSERT INTO job_bias_checks
         (tenant_id, job_id, jd_hash, bias_flags, clarity_score, inclusivity_score)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING computed_at`,
      [
        tenantId,
        jobId,
        hash,
        JSON.stringify(computed.bias_flags),
        computed.clarity_score,
        computed.inclusivity_score,
      ]
    );

    return {
      bias_flags: computed.bias_flags,
      clarity_score: computed.clarity_score,
      inclusivity_score: computed.inclusivity_score,
      computed_at: new Date(persisted.computed_at).toISOString(),
      cached: false,
    };
  });
}
