/**
 * Skills-mapping engine — Sprint Q3.6 (Agent HHH).
 *
 * Bepaalt de beste ESCO-skill voor een ruwe skill-text uit candidates.skills
 * of jobs.required_skills. Drie-traps strategie:
 *
 *   1. Exact match op `lower(preferred_label)` — confidence 1.0.
 *   2. Match in `alt_labels[]` — confidence 0.9.
 *   3. Embedding cosine-similarity > minConfidence (default 0.85) — fuzzy fallback,
 *      confidence = cosine score. Lazy-genereert embedding op de ESCO-skill als die
 *      ontbreekt zodat we niet alle 300 vooraf hoeven te embedden.
 *
 * In-memory cache voor 1u zodat batch-mappings niet steeds dezelfde DB-hits doen.
 *
 * `esco_skills` heeft GEEN RLS (system-wide taxonomie), dus we gebruiken
 * `withoutTenant` voor alle reads en updates op die tabel.
 */

import type { PoolClient } from 'pg';
import { withoutTenant } from '../../db/pool';
import {
  generateEmbedding,
  formatVectorLiteral,
  EMBEDDING_DIMS,
} from '../embeddings';
import { logger } from '../../middleware/errorHandler';

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

export type SkillMatchVia = 'exact' | 'alt_label' | 'embedding' | 'manual';

export interface SkillMappingResult {
  esco_skill_id: string;
  preferred_label: string;
  category: string | null;
  confidence: number;
  matched_via: Exclude<SkillMatchVia, 'manual'>;
}

export interface MapTextOptions {
  /**
   * Minimale cosine-similarity (0–1) voor de embedding-fallback. Default 0.85.
   * Lager = meer recall, hoger = meer precisie.
   */
  minConfidence?: number;
  /**
   * Skip de embedding-fallback (bv. wanneer de caller het CPU-budget al heeft
   * besteed). Exact en alt_label matches blijven werken.
   */
  skipEmbedding?: boolean;
  /**
   * Optionele voorgegenereerde DB-client (bv. vanuit een transactie). Default
   * gebruikt `withoutTenant`.
   */
  client?: PoolClient;
}

export interface MappingBatchEntry {
  text: string;
  result: SkillMappingResult | null;
}

// ────────────────────────────────────────────────────────────────────────────
// In-memory cache (TTL 1 uur)
// ────────────────────────────────────────────────────────────────────────────

interface CacheEntry {
  value: SkillMappingResult | null;
  expiresAt: number;
}

const TTL_MS = 60 * 60 * 1000; // 1 uur
const cache = new Map<string, CacheEntry>();

/**
 * Reset de cache — alleen gebruikt door tests om strikt geïsoleerde runs te
 * garanderen, en voor admins om een seed-update meteen door te laten werken.
 */
export function clearMapperCache(): void {
  cache.clear();
}

function cacheGet(key: string): CacheEntry | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit;
}

function cacheSet(key: string, value: SkillMappingResult | null): void {
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

interface EscoSkillRow {
  id: string;
  preferred_label: string;
  category: string | null;
  alt_labels: string[];
  has_embedding: boolean;
}

interface EmbeddingMatchRow {
  id: string;
  preferred_label: string;
  category: string | null;
  similarity: number;
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

async function tryExactMatch(
  client: PoolClient,
  normalized: string
): Promise<EscoSkillRow | null> {
  const { rows } = await client.query<EscoSkillRow>(
    `SELECT id,
            preferred_label,
            category,
            alt_labels,
            (embedding IS NOT NULL) AS has_embedding
       FROM esco_skills
      WHERE lower(preferred_label) = $1
      LIMIT 1`,
    [normalized]
  );
  return rows[0] ?? null;
}

async function tryAltLabelMatch(
  client: PoolClient,
  normalized: string
): Promise<EscoSkillRow | null> {
  // We doen een case-insensitive vergelijking via EXISTS-subquery met unnest.
  // Geen GIN-trigram nodig — alt_labels is klein (~5 entries) per rij.
  const { rows } = await client.query<EscoSkillRow>(
    `SELECT id,
            preferred_label,
            category,
            alt_labels,
            (embedding IS NOT NULL) AS has_embedding
       FROM esco_skills
      WHERE EXISTS (
              SELECT 1 FROM unnest(alt_labels) AS al
               WHERE lower(al) = $1
            )
      LIMIT 1`,
    [normalized]
  );
  return rows[0] ?? null;
}

async function tryEmbeddingMatch(
  client: PoolClient,
  text: string,
  minConfidence: number
): Promise<EmbeddingMatchRow | null> {
  // 1) Genereer embedding voor de input.
  const { embedding } = await generateEmbedding(text);
  if (embedding.length !== EMBEDDING_DIMS) {
    logger.warn('[skills.mapper] onverwachte embedding-dim', {
      length: embedding.length,
    });
    return null;
  }
  const literal = formatVectorLiteral(embedding);

  // 2) Lazy-vul ESCO-embeddings: als er nog rijen ZONDER embedding zijn,
  //    genereer er één per call (max 1) zodat we niet de hele set vooraf
  //    moeten doen. Op productie loopt dit binnen ~300 calls vol.
  await ensureNextEscoEmbedding(client);

  // 3) Cosine-similarity zoek. `<=>` is cosine-distance; similarity = 1 - dist.
  const { rows } = await client.query<EmbeddingMatchRow>(
    `SELECT id,
            preferred_label,
            category,
            (1 - (embedding <=> $1::vector))::float AS similarity
       FROM esco_skills
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector ASC
      LIMIT 1`,
    [literal]
  );
  const top = rows[0];
  if (!top) return null;
  if (top.similarity < minConfidence) return null;
  return top;
}

/**
 * Lazy-fill: zoek 1 esco-skill zonder embedding, genereer er één en schrijf
 * 'm terug. Idempotent — bij gelijktijdige calls schrijft de tweede gewoon
 * dezelfde waarde terug. Gooit géén exception bij OpenAI-failures: we vallen
 * dan terug op de mock-embedding (offline tests + dev) of slaan deze cycle over.
 */
async function ensureNextEscoEmbedding(client: PoolClient): Promise<void> {
  try {
    const { rows } = await client.query<{ id: string; preferred_label: string }>(
      `SELECT id, preferred_label
         FROM esco_skills
        WHERE embedding IS NULL
        ORDER BY id
        LIMIT 1`
    );
    if (rows.length === 0) return;
    const target = rows[0];
    const buildText = `${target.preferred_label}`;
    const { embedding } = await generateEmbedding(buildText);
    const literal = formatVectorLiteral(embedding);
    await client.query(
      `UPDATE esco_skills SET embedding = $1::vector WHERE id = $2`,
      [literal, target.id]
    );
  } catch (err) {
    logger.warn('[skills.mapper] lazy-fill esco embedding faalde', {
      error: (err as Error).message,
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Map een ruwe skill-text naar de beste ESCO-skill. Retourneert null wanneer
 * geen match boven `minConfidence` gevonden is.
 */
export async function mapTextToEscoSkill(
  text: string,
  options: MapTextOptions = {}
): Promise<SkillMappingResult | null> {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;

  const normalized = normalize(trimmed);
  const cached = cacheGet(normalized);
  if (cached) return cached.value;

  const minConfidence = options.minConfidence ?? 0.85;

  const run = async (client: PoolClient): Promise<SkillMappingResult | null> => {
    // 1) exact
    const exact = await tryExactMatch(client, normalized);
    if (exact) {
      return {
        esco_skill_id: exact.id,
        preferred_label: exact.preferred_label,
        category: exact.category,
        confidence: 1.0,
        matched_via: 'exact',
      };
    }

    // 2) alt-label
    const alt = await tryAltLabelMatch(client, normalized);
    if (alt) {
      return {
        esco_skill_id: alt.id,
        preferred_label: alt.preferred_label,
        category: alt.category,
        confidence: 0.9,
        matched_via: 'alt_label',
      };
    }

    // 3) embedding fallback
    if (options.skipEmbedding) return null;
    const emb = await tryEmbeddingMatch(client, trimmed, minConfidence);
    if (emb) {
      // Clamp similarity naar [0,1] — pgvector kan licht buiten bounds drijven.
      const conf = Math.max(0, Math.min(1, Number(emb.similarity)));
      return {
        esco_skill_id: emb.id,
        preferred_label: emb.preferred_label,
        category: emb.category,
        confidence: conf,
        matched_via: 'embedding',
      };
    }

    return null;
  };

  const result = options.client
    ? await run(options.client)
    : await withoutTenant(run);

  cacheSet(normalized, result);
  return result;
}

/**
 * Batch-versie: dedupliceert op normalized text, hergebruikt de cache.
 * Retourneert per input-tekst (in de oorspronkelijke volgorde) een match-resultaat.
 */
export async function mapManySkillsToEsco(
  texts: string[],
  options: MapTextOptions = {}
): Promise<MappingBatchEntry[]> {
  // Dedupe op normalized text: we hoeven alleen unieke skills te resolven.
  const unique = new Map<string, string>(); // normalized → first-seen original
  for (const t of texts) {
    const trimmed = (t ?? '').trim();
    if (!trimmed) continue;
    const k = normalize(trimmed);
    if (!unique.has(k)) unique.set(k, trimmed);
  }

  // Resolve elk uniek item via mapTextToEscoSkill (cache + DB).
  const resolved = new Map<string, SkillMappingResult | null>();
  for (const [, original] of unique) {
    const r = await mapTextToEscoSkill(original, options);
    resolved.set(normalize(original), r);
  }

  // Bouw output in dezelfde volgorde als input.
  return texts.map((t) => {
    const trimmed = (t ?? '').trim();
    if (!trimmed) return { text: t, result: null };
    return { text: t, result: resolved.get(normalize(trimmed)) ?? null };
  });
}
