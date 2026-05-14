/**
 * Embeddings client voor TalentFlow AI-matching (Slice 4).
 *
 * Gebruikt OpenAI `text-embedding-3-small` (1536 dims, multilingual — werkt
 * out-of-the-box voor NL/EN/DE/FR, een differentiator t.o.v. Manatal dat
 * primair Engels is).
 *
 * In dev zonder OPENAI_API_KEY valt deze module terug op een DETERMINISTIC
 * hash-based mock-embedding. Dezelfde input produceert dezelfde 1536-floats,
 * en de output is L2-genormaliseerd zodat cosine-similarity nog steeds
 * werkbare scores oplevert voor lokale tests. In productie (NODE_ENV=production)
 * gooien we keihard een fout — we willen daar nooit fake vectors wegschrijven.
 */

import { createHash } from 'crypto';
import OpenAI from 'openai';
import { logger } from '../middleware/errorHandler';
import { logAIEvent } from './aiEvents';

// ─────────────────────────────────────────────────────────────────────────────
// Public types & constants
// ─────────────────────────────────────────────────────────────────────────────

export interface EmbeddingResult {
  /** Length 1536 (text-embedding-3-small dimensionality). */
  embedding: number[];
  model: string;
  /** True wanneer de mock-implementatie is gebruikt (dev only). */
  mocked?: boolean;
  /** Tokens consumed (only set when calling real OpenAI). */
  inputTokens?: number;
  /** End-to-end latency in milliseconds. */
  latencyMs?: number;
}

/**
 * Optional context that — when supplied — triggers `logAIEvent` for the
 * embedding-call. Worker / service callers passeren dit; library-callers
 * zonder tenantId krijgen geen AI-event-rij (dat is OK, we willen nooit
 * tenant-loos schrijven naar een tenant-isolated tabel).
 */
export interface EmbeddingAuditMeta {
  tenantId: string;
  entityType?: 'candidate' | 'job' | string;
  entityId?: string;
  userId?: string | null;
}

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMS = 1536;

/**
 * text-embedding-3-small heeft een 8192-token max input. We knippen op een
 * conservatieve karaktergrens (≈ 4 chars / token gemiddeld voor NL/EN). 30k
 * chars dekt verreweg de meeste CV's en job-omschrijvingen ruim.
 */
const MAX_INPUT_CHARS = 30_000;

// ─────────────────────────────────────────────────────────────────────────────
// Singleton client
// ─────────────────────────────────────────────────────────────────────────────

let cachedClient: OpenAI | null = null;
let warnedAboutMissingKey = false;

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[embeddings] OPENAI_API_KEY ontbreekt in productie — refusing to mock.'
      );
    }
    if (!warnedAboutMissingKey) {
      logger.warn(
        '[embeddings] OPENAI_API_KEY ontbreekt — gebruik deterministic mock-embeddings. ' +
          'Dit is alleen geldig in dev/test.'
      );
      warnedAboutMissingKey = true;
    }
    return null;
  }
  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey });
  }
  return cachedClient;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic mock embedding (dev only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Genereer een deterministic, L2-genormaliseerde 1536-floats vector op basis
 * van de SHA-256 hash van de input. Dezelfde tekst → identieke vector, en
 * tekst die een substring deelt produceert vergelijkbare vectors omdat we
 * de hash herhaaldelijk uitbreiden.
 *
 * Niet semantisch — twee verschillende teksten die hetzelfde betekenen krijgen
 * compleet andere mock-vectors. Maar wel voldoende om de pipeline (queue →
 * worker → DB → cosine query) end-to-end te testen.
 */
function deterministicMockEmbedding(text: string): number[] {
  const out = new Array<number>(EMBEDDING_DIMS);
  // Vul via opeenvolgende hashes: hash(text), hash(text||'1'), hash(text||'2'), ...
  // Elke hash levert 32 bytes → 8 floats (4 bytes elk, big-endian, schaal naar [-1, 1]).
  let written = 0;
  let counter = 0;
  while (written < EMBEDDING_DIMS) {
    const h = createHash('sha256').update(`${text}|${counter}`).digest();
    counter++;
    for (let i = 0; i + 4 <= h.length && written < EMBEDDING_DIMS; i += 4) {
      // Lees als unsigned 32-bit, schaal naar [-1, 1).
      const u = h.readUInt32BE(i);
      out[written++] = (u / 0xffffffff) * 2 - 1;
    }
  }

  // L2-normaliseer zodat cosine-similarity = dot product.
  let sumSq = 0;
  for (let i = 0; i < EMBEDDING_DIMS; i++) sumSq += out[i] * out[i];
  const norm = Math.sqrt(sumSq) || 1;
  for (let i = 0; i < EMBEDDING_DIMS; i++) out[i] /= norm;

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Genereer een embedding voor de gegeven tekst.
 *
 * @throws Error als input leeg is, OF in productie als OPENAI_API_KEY mist.
 *         Bij API-fouten gooit OpenAI zelf — caller (worker) handelt retry.
 */
export async function generateEmbedding(
  text: string,
  auditMeta?: EmbeddingAuditMeta
): Promise<EmbeddingResult> {
  const startedAt = Date.now();
  const trimmed = (text ?? '').trim();
  if (!trimmed) {
    throw new Error('[embeddings] Lege input — kan geen embedding genereren');
  }
  const truncated =
    trimmed.length > MAX_INPUT_CHARS ? trimmed.slice(0, MAX_INPUT_CHARS) : trimmed;

  const client = getOpenAIClient();
  if (!client) {
    const latencyMs = Date.now() - startedAt;
    const result: EmbeddingResult = {
      embedding: deterministicMockEmbedding(truncated),
      model: `${EMBEDDING_MODEL}-mock`,
      mocked: true,
      latencyMs,
    };
    if (auditMeta?.tenantId) {
      // fire-and-forget; logAIEvent swallows errors
      void logAIEvent(auditMeta.tenantId, {
        feature: 'embedding',
        model: result.model,
        provider: 'openai',
        input: truncated,
        latencyMs,
        outputSummary: `dims=${EMBEDDING_DIMS} mock`,
        entityType: auditMeta.entityType ?? null,
        entityId: auditMeta.entityId ?? null,
        userId: auditMeta.userId ?? null,
        status: 'mocked',
      });
    }
    return result;
  }

  try {
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: truncated,
      encoding_format: 'float',
    });

    const data = response.data?.[0]?.embedding;
    if (!Array.isArray(data) || data.length !== EMBEDDING_DIMS) {
      throw new Error(
        `[embeddings] Onverwachte response van OpenAI: dim=${data?.length ?? 'n/a'}`
      );
    }

    const latencyMs = Date.now() - startedAt;
    const result: EmbeddingResult = {
      embedding: data,
      model: response.model ?? EMBEDDING_MODEL,
      inputTokens: response.usage?.prompt_tokens,
      latencyMs,
    };

    if (auditMeta?.tenantId) {
      void logAIEvent(auditMeta.tenantId, {
        feature: 'embedding',
        model: result.model,
        provider: 'openai',
        input: truncated,
        inputTokens: response.usage?.prompt_tokens,
        latencyMs,
        outputSummary: `dims=${EMBEDDING_DIMS}`,
        entityType: auditMeta.entityType ?? null,
        entityId: auditMeta.entityId ?? null,
        userId: auditMeta.userId ?? null,
        status: 'success',
      });
    }
    return result;
  } catch (err) {
    if (auditMeta?.tenantId) {
      void logAIEvent(auditMeta.tenantId, {
        feature: 'embedding',
        model: EMBEDDING_MODEL,
        provider: 'openai',
        input: truncated,
        latencyMs: Date.now() - startedAt,
        entityType: auditMeta.entityType ?? null,
        entityId: auditMeta.entityId ?? null,
        userId: auditMeta.userId ?? null,
        status: 'failed',
        error: (err as Error).message?.slice(0, 1000) ?? 'unknown',
      });
    }
    throw err;
  }
}

/**
 * Format een floats-array als pgvector text literal: `[0.1,0.2,…]`.
 * Cast naar `vector` gebeurt in de UPDATE-query (`$1::vector`).
 */
export function formatVectorLiteral(embedding: number[]): string {
  // pgvector accepteert geen NaN/Infinity. Defensief: clamp NaN → 0.
  const safe = embedding.map((v) => (Number.isFinite(v) ? v : 0));
  return `[${safe.join(',')}]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Embedding text builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Subset van candidate-velden die we in de embedding-tekst opnemen. Optioneel
 * zodat callers met losse types (resumeParser na een COALESCE update, plain
 * candidates.service.ts row, etc.) één signature delen.
 */
export interface CandidateForEmbedding {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  current_position?: string | null;
  current_company?: string | null;
  description?: string | null;
  ai_summary?: string | null;
  skills?: string[] | null;
  languages?: string[] | null;
  years_of_experience?: number | null;
  industry?: string | null;
  current_department?: string | null;
  address_city?: string | null;
  address_country?: string | null;
  diploma?: string | null;
  university?: string | null;
}

function appendLine(lines: string[], label: string, value: unknown): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    const cleaned = value.filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
    if (cleaned.length === 0) return;
    lines.push(`${label}: ${cleaned.join(', ')}`);
    return;
  }
  const str = String(value).trim();
  if (str.length === 0) return;
  lines.push(`${label}: ${str}`);
}

/**
 * Bouwt een tekstrepresentatie van een kandidaat voor embedding. Hoe rijker
 * deze tekst, hoe beter de match. We labelen elke sectie zodat het
 * embedding-model semantische context heeft (Skills: vs. Description:).
 */
export function buildCandidateEmbeddingText(
  candidate: CandidateForEmbedding
): string {
  const lines: string[] = [];

  // Naam — first/last als beschikbaar, anders fallback `name`.
  const fullName =
    [candidate.first_name, candidate.last_name]
      .filter((v) => v && String(v).trim() !== '')
      .join(' ')
      .trim() ||
    candidate.name ||
    '';
  if (fullName) appendLine(lines, 'Name', fullName);

  appendLine(lines, 'Current Position', candidate.current_position);
  appendLine(lines, 'Current Company', candidate.current_company);
  appendLine(lines, 'Department', candidate.current_department);
  appendLine(lines, 'Industry', candidate.industry);
  appendLine(lines, 'Years of Experience', candidate.years_of_experience);
  appendLine(lines, 'Languages', candidate.languages);
  appendLine(lines, 'Skills', candidate.skills);
  appendLine(lines, 'Education', candidate.diploma);
  appendLine(lines, 'University', candidate.university);

  const location =
    [candidate.address_city, candidate.address_country]
      .filter((v) => v && String(v).trim() !== '')
      .join(', ') || null;
  appendLine(lines, 'Location', location);

  appendLine(lines, 'AI Summary', candidate.ai_summary);
  appendLine(lines, 'Description', candidate.description);

  return lines.join('\n');
}

export interface JobForEmbedding {
  title?: string | null;
  description?: string | null;
  required_skills?: string[] | null;
  nice_to_have_skills?: string[] | null;
  location?: string | null;
  employment_type?: string | null;
  department?: string | null;
}

/**
 * Bouwt een tekstrepresentatie van een job voor embedding.
 */
export function buildJobEmbeddingText(job: JobForEmbedding): string {
  const lines: string[] = [];

  appendLine(lines, 'Title', job.title);
  appendLine(lines, 'Department', job.department);
  appendLine(lines, 'Location', job.location);
  appendLine(lines, 'Employment Type', job.employment_type);
  appendLine(lines, 'Required Skills', job.required_skills);
  appendLine(lines, 'Nice-to-have Skills', job.nice_to_have_skills);
  appendLine(lines, 'Description', job.description);

  return lines.join('\n');
}
