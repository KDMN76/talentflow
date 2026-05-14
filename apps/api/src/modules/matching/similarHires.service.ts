/**
 * Similar-hires explainer service — Sprint Q3.3.
 *
 * Verrijkt de Talent-Fit signalen met menselijk-leesbare context: voor een
 * gegeven kandidaat (of job) toont het de top-N historische, succesvolle
 * hires die qua embedding op de query lijken. Per hire ook welke skills
 * overlappen + de job-titel waarvoor ze zijn aangenomen.
 *
 * Verschil met `talentFit.service.findSimilarPastHires` (Agent YY):
 *   • findSimilarPastHires retourneert puur cosine + IDs — bedoeld als
 *     feature-vector-cache voor de logistic-regression.
 *   • DIT bestand voegt UI-context toe (job-titel, hire-datum, gedeelde
 *     skills) zodat de recruiter "Lijkt op X eerder aangenomen kandidaten"
 *     kan klikken en daadwerkelijk de namen + rollen ziet.
 *
 * Caching:
 *   - DB-cache (talent_fit_predictions.similar_hires) is al door Agent YY
 *     beheerd; dit is een READ-pad. We cachen het verrijkte resultaat
 *     in-memory met een TTL van 1 uur omdat de vector-index ook al snel is
 *     en we niet opnieuw een tabel willen introduceren voor deze
 *     UI-explainer.
 *
 * RLS:
 *   - Alle queries draaien onder `withTenant` zodat de RLS-policy op
 *     candidates / applications / jobs / candidate_skills automatisch
 *     filtert. Geen tenant_id-comparissons in de WHERE — RLS regelt 't.
 */

import { withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface SimilarHireDetail {
  candidate_id: string;
  candidate_name: string;
  candidate_position: string | null;
  job_id: string;
  job_title: string;
  hired_at: string;
  /** Cosine similarity 0–1 tussen query-kandidaat en deze hire. */
  cosine_to_query: number;
  /** Top-5 overlappende skills (case-insensitive vergelijking). */
  shared_skills: string[];
}

export interface GetSimilarHiresOptions {
  /** Optioneel filter: alleen hires voor deze specifieke job. */
  jobId?: string;
  /** Aantal hires (default 5, max 25 — voorkomt expensive index-scans). */
  limit?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 25;
const MAX_SHARED_SKILLS = 5;

/**
 * In-memory TTL-cache. Key: `${tenantId}:${candidateId}:${jobId|''}`.
 *
 * 1 uur is een bewuste keuze: hires worden zelden ge-update na het feit, en
 * een nieuwe hire die toegevoegd wordt valt binnen 1 uur in de volgende read.
 * Dit is een READ-only explainer; we hebben geen invalidation-pad nodig.
 *
 * Bewust geen Redis: één Map per node is goed genoeg, en het pad wordt al
 * bewaakt door de talent_fit_predictions DB-cache (cosine-rang van top-3
 * IDs zit daar al opgeslagen). Deze in-memory cache slaat alleen de
 * verrijking op, niet de cosine zelf.
 */
const TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  expiresAt: number;
  payload: SimilarHireDetail[];
}

const cache = new Map<string, CacheEntry>();

function cacheKey(
  tenantId: string,
  scope: 'candidate' | 'job',
  primaryId: string,
  jobId: string | undefined
): string {
  return `${scope}:${tenantId}:${primaryId}:${jobId ?? ''}`;
}

function readCache(key: string): SimilarHireDetail[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.payload;
}

function writeCache(key: string, payload: SimilarHireDetail[]): void {
  cache.set(key, {
    expiresAt: Date.now() + TTL_MS,
    payload,
  });
}

/**
 * Test-only: leeg de in-memory cache. Niet exporteren naar productie-callers.
 * Vitest reset module-state niet automatisch tussen test-files.
 */
export function __resetSimilarHiresCacheForTests(): void {
  cache.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function clampUnit(score: number): number {
  if (!Number.isFinite(score)) return 0;
  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}

// ─────────────────────────────────────────────────────────────────────────────
// getSimilarHiresForCandidate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Top-N historische hires die qua embedding op de gegeven kandidaat lijken.
 *
 * Logica:
 *   1. Resolve de query-kandidaat (404 als niet bestaat / soft-deleted).
 *   2. Vind candidates met `applications.status = 'hired'` (binnen tenant
 *      via RLS), exclusief de query-kandidaat zelf, exclusief candidates
 *      zonder embedding.
 *   3. Optioneel: alleen hires voor de gegeven job_id (via applications.job_id).
 *   4. Order by cosine similarity DESC, return top-N met shared_skills.
 *
 * Performance: de pgvector HNSW-index op candidates.embedding wordt gebruikt
 * door `c.embedding <=> q.embedding` ASC — we nemen <= cosine_distance niet
 * de inverse, omdat HNSW alleen de operator-vorm versnelt.
 */
export async function getSimilarHiresForCandidate(
  tenantId: string,
  candidateId: string,
  options: GetSimilarHiresOptions = {}
): Promise<SimilarHireDetail[]> {
  const limit = clampLimit(options.limit);
  const key = cacheKey(tenantId, 'candidate', candidateId, options.jobId);

  const cached = readCache(key);
  if (cached) {
    // Slice in case the cached entry was for a higher limit.
    return cached.slice(0, limit);
  }

  const result = await withTenant(tenantId, async (client) => {
    // 1. Verifieer query-kandidaat.
    const { rows: queryRows } = await client.query<{
      id: string;
      has_embedding: boolean;
    }>(
      `SELECT id, embedding IS NOT NULL AS has_embedding
         FROM candidates
        WHERE id = $1
          AND tenant_id = $2
          AND deleted_at IS NULL`,
      [candidateId, tenantId]
    );
    if (queryRows.length === 0) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
    }
    if (!queryRows[0].has_embedding) {
      logger.info('[similarHires] kandidaat zonder embedding — return []', {
        tenantId,
        candidateId,
      });
      return [];
    }

    // 2. Top-N hires (cosine-similar). We gebruiken DISTINCT ON zodat een
    //    kandidaat die meerdere keren is gehired (meerdere applications)
    //    maar één keer in de output verschijnt — met de meest recente hire.
    //
    //    De WHERE-clauses zijn defense-in-depth: RLS zou tenant_id al filteren
    //    maar we voegen 'm expliciet toe voor clarity en om plan-stabiliteit
    //    te garanderen tegenover de planner-keuze van de pg-versie.
    const params: unknown[] = [candidateId, tenantId, limit];
    let jobFilter = '';
    if (options.jobId) {
      params.push(options.jobId);
      jobFilter = `AND a.job_id = $${params.length}`;
    }

    const { rows } = await client.query<{
      candidate_id: string;
      candidate_name: string;
      candidate_position: string | null;
      job_id: string;
      job_title: string;
      hired_at: Date | string;
      cosine_to_query: number | string;
    }>(
      `SELECT *
         FROM (
           SELECT DISTINCT ON (c.id)
             c.id                                         AS candidate_id,
             c.name                                       AS candidate_name,
             c.current_position                           AS candidate_position,
             a.job_id                                     AS job_id,
             j.title                                      AS job_title,
             a.updated_at                                 AS hired_at,
             (1 - (c.embedding <=> q.embedding))::float8  AS cosine_to_query
           FROM candidates q
           JOIN candidates c
             ON c.tenant_id = q.tenant_id
            AND c.id <> q.id
            AND c.deleted_at IS NULL
            AND c.embedding IS NOT NULL
           JOIN applications a
             ON a.tenant_id = c.tenant_id
            AND a.candidate_id = c.id
            AND a.status = 'hired'
            ${jobFilter}
           JOIN jobs j
             ON j.tenant_id = a.tenant_id
            AND j.id = a.job_id
            AND j.deleted_at IS NULL
           WHERE q.id = $1
             AND q.tenant_id = $2
             AND q.deleted_at IS NULL
           ORDER BY c.id, a.updated_at DESC
         ) AS dedup
        ORDER BY cosine_to_query DESC
        LIMIT $3`,
      params
    );

    if (rows.length === 0) {
      return [];
    }

    // 3. Verzamel shared_skills via een tweede query — efficiënter dan
    //    json_agg in de cosine-query (die hindert de planner). We gebruiken
    //    LOWER(skill) voor case-insensitive overlap.
    const candidateIds = rows.map((r) => r.candidate_id);
    const { rows: skillRows } = await client.query<{
      candidate_id: string;
      shared: string[];
    }>(
      `WITH query_skills AS (
         SELECT DISTINCT LOWER(TRIM(skill)) AS skill_norm, skill AS skill_orig
           FROM candidate_skills
          WHERE tenant_id = $1
            AND candidate_id = $2
       )
       SELECT cs.candidate_id,
              ARRAY(
                SELECT cs2.skill
                  FROM candidate_skills cs2
                  JOIN query_skills qs ON LOWER(TRIM(cs2.skill)) = qs.skill_norm
                 WHERE cs2.tenant_id = $1
                   AND cs2.candidate_id = cs.candidate_id
                 ORDER BY cs2.score DESC NULLS LAST
                 LIMIT $4
              ) AS shared
         FROM candidate_skills cs
        WHERE cs.tenant_id = $1
          AND cs.candidate_id = ANY($3::uuid[])
        GROUP BY cs.candidate_id`,
      [tenantId, candidateId, candidateIds, MAX_SHARED_SKILLS]
    );

    const sharedByCandidate = new Map<string, string[]>();
    for (const row of skillRows) {
      sharedByCandidate.set(
        row.candidate_id,
        Array.isArray(row.shared) ? row.shared.slice(0, MAX_SHARED_SKILLS) : []
      );
    }

    return rows.map((row): SimilarHireDetail => ({
      candidate_id: row.candidate_id,
      candidate_name: row.candidate_name,
      candidate_position: row.candidate_position ?? null,
      job_id: row.job_id,
      job_title: row.job_title,
      hired_at: toIsoString(row.hired_at),
      cosine_to_query: clampUnit(toNumber(row.cosine_to_query)),
      shared_skills: sharedByCandidate.get(row.candidate_id) ?? [],
    }));
  });

  writeCache(key, result);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// getSimilarHiresForJob
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Top-N historische hires van vergelijkbare jobs.
 *
 * Stap 1: vind de top-K (=20) jobs die qua embedding op deze job lijken.
 * Stap 2: vind binnen die jobs de hires (applications.status='hired'),
 * dedupliceer per kandidaat, retourneer top-N met shared_skills t.o.v. de
 * job-required_skills (we comparen kandidaat-skills tegen de title +
 * description-skills via candidate_skills).
 *
 * shared_skills: hier interpreteren we het als de top-skills van de hire
 * zelf (we hebben geen "job_skills"-tabel; required_skills is een TEXT[]
 * op jobs). We resolven shared = intersect(candidate_skills, jobs.required_skills).
 */
export async function getSimilarHiresForJob(
  tenantId: string,
  jobId: string,
  limit?: number
): Promise<SimilarHireDetail[]> {
  const safeLimit = clampLimit(limit);
  const key = cacheKey(tenantId, 'job', jobId, undefined);
  const cached = readCache(key);
  if (cached) {
    return cached.slice(0, safeLimit);
  }

  const result = await withTenant(tenantId, async (client) => {
    const { rows: jobRows } = await client.query<{
      id: string;
      has_embedding: boolean;
      required_skills: string[] | null;
    }>(
      `SELECT id,
              embedding IS NOT NULL AS has_embedding,
              required_skills
         FROM jobs
        WHERE id = $1
          AND tenant_id = $2
          AND deleted_at IS NULL`,
      [jobId, tenantId]
    );
    if (jobRows.length === 0) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');
    }
    if (!jobRows[0].has_embedding) {
      logger.info('[similarHires] job zonder embedding — return []', {
        tenantId,
        jobId,
      });
      return [];
    }
    const requiredSkills = Array.isArray(jobRows[0].required_skills)
      ? jobRows[0].required_skills
      : [];

    // Top-K vergelijkbare jobs (incl. zichzelf) — pak hires daaruit.
    const { rows } = await client.query<{
      candidate_id: string;
      candidate_name: string;
      candidate_position: string | null;
      job_id: string;
      job_title: string;
      hired_at: Date | string;
      cosine_to_query: number | string;
    }>(
      `WITH similar_jobs AS (
         SELECT j.id, j.title, j.embedding
           FROM jobs q
           JOIN jobs j
             ON j.tenant_id = q.tenant_id
            AND j.deleted_at IS NULL
            AND j.embedding IS NOT NULL
          WHERE q.id = $1
            AND q.tenant_id = $2
            AND q.deleted_at IS NULL
          ORDER BY j.embedding <=> q.embedding ASC
          LIMIT 20
       )
       SELECT *
         FROM (
           SELECT DISTINCT ON (c.id)
             c.id                                         AS candidate_id,
             c.name                                       AS candidate_name,
             c.current_position                           AS candidate_position,
             a.job_id                                     AS job_id,
             sj.title                                     AS job_title,
             a.updated_at                                 AS hired_at,
             (1 - (
               (SELECT embedding FROM jobs WHERE id = $1 AND tenant_id = $2)
               <=> sj.embedding
             ))::float8                                   AS cosine_to_query
           FROM similar_jobs sj
           JOIN applications a
             ON a.tenant_id = $2
            AND a.job_id = sj.id
            AND a.status = 'hired'
           JOIN candidates c
             ON c.tenant_id = $2
            AND c.id = a.candidate_id
            AND c.deleted_at IS NULL
            AND c.embedding IS NOT NULL
           ORDER BY c.id, a.updated_at DESC
         ) AS dedup
        ORDER BY cosine_to_query DESC
        LIMIT $3`,
      [jobId, tenantId, safeLimit]
    );

    if (rows.length === 0) {
      return [];
    }

    // shared_skills: voor de job-context zijn dit de overlappingen tussen
    // candidate-skills en de job's required_skills. Als required_skills
    // leeg is, vallen we terug op de top-N skills van de kandidaat zelf.
    const candidateIds = rows.map((r) => r.candidate_id);
    const { rows: skillRows } = await client.query<{
      candidate_id: string;
      shared: string[];
    }>(
      requiredSkills.length > 0
        ? `SELECT cs.candidate_id,
                  ARRAY(
                    SELECT cs2.skill
                      FROM candidate_skills cs2
                     WHERE cs2.tenant_id = $1
                       AND cs2.candidate_id = cs.candidate_id
                       AND LOWER(TRIM(cs2.skill)) = ANY(
                         SELECT LOWER(TRIM(unnest)) FROM unnest($3::text[])
                       )
                     ORDER BY cs2.score DESC NULLS LAST
                     LIMIT $4
                  ) AS shared
             FROM candidate_skills cs
            WHERE cs.tenant_id = $1
              AND cs.candidate_id = ANY($2::uuid[])
            GROUP BY cs.candidate_id`
        : `SELECT cs.candidate_id,
                  ARRAY(
                    SELECT cs2.skill
                      FROM candidate_skills cs2
                     WHERE cs2.tenant_id = $1
                       AND cs2.candidate_id = cs.candidate_id
                     ORDER BY cs2.score DESC NULLS LAST
                     LIMIT $3
                  ) AS shared
             FROM candidate_skills cs
            WHERE cs.tenant_id = $1
              AND cs.candidate_id = ANY($2::uuid[])
            GROUP BY cs.candidate_id`,
      requiredSkills.length > 0
        ? [tenantId, candidateIds, requiredSkills, MAX_SHARED_SKILLS]
        : [tenantId, candidateIds, MAX_SHARED_SKILLS]
    );

    const sharedByCandidate = new Map<string, string[]>();
    for (const row of skillRows) {
      sharedByCandidate.set(
        row.candidate_id,
        Array.isArray(row.shared) ? row.shared.slice(0, MAX_SHARED_SKILLS) : []
      );
    }

    return rows.map((row): SimilarHireDetail => ({
      candidate_id: row.candidate_id,
      candidate_name: row.candidate_name,
      candidate_position: row.candidate_position ?? null,
      job_id: row.job_id,
      job_title: row.job_title,
      hired_at: toIsoString(row.hired_at),
      cosine_to_query: clampUnit(toNumber(row.cosine_to_query)),
      shared_skills: sharedByCandidate.get(row.candidate_id) ?? [],
    }));
  });

  writeCache(key, result);
  return result;
}
