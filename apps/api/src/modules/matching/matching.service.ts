/**
 * Matching service — Slice 4 + Sprint Q3.3 Talent-Fit integratie (Agent ZZ).
 *
 * Levert top-N matches op basis van pgvector cosine-similarity tussen
 * candidates.embedding en jobs.embedding (1536 dims, text-embedding-3-small),
 * verrijkt met de Talent-Fit logistic-regression score wanneer er voor de
 * tenant een actief model bestaat.
 *
 * Sprint Q3.3 ranking-strategie:
 *   1. Initiële top-N selectie op cosine similarity DESC (HNSW-index pad).
 *   2. Voor elke kandidaat: roep `talentFitService.predictForCandidateJob`
 *      aan met `use_cache=true`. De cache TTL wordt door Agent YY's logica
 *      beheerd via de `talent_fit_predictions` tabel + 24u-staleness check.
 *   3. Met active model: re-rank op `combined_score` DESC; anders behoud
 *      cosine-volgorde.
 *   4. Bij ranking-met-actief-model: schrijf één audit-event
 *      MATCH_RANKED_BY_TALENT_FIT — non-blocking, voor compliance + drift
 *      monitoring.
 *
 * Backward-compat:
 *   - `match_percent` blijft het primaire UI-veld.
 *   - Zonder model: `match_percent = round(cosine * 100)`.
 *   - Met model:    `match_percent = round(combined_score * 100)`.
 *   - `score` blijft als alias bewaard zodat oudere tests/clients (Slice 4)
 *     niet breken — gelijk aan de raw cosine.
 *   - `fit_score: number | null` (per Agent ZZ contract met Agent AAA) —
 *     null wanneer er geen actief model is.
 *
 * Resilience: per-kandidaat-prediction-failure degradeert silent naar pure
 * cosine; één rotte rij verpest de lijst niet. Module-level fail-mode
 * (talent_fit_models tabel ontbreekt) geeft `has_active_model=false` voor
 * álle rijen — endpoint blijft werken.
 */

import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../middleware/errorHandler';
import { logAudit } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import * as talentFitService from './talentFit.service';

// ─────────────────────────────────────────────────────────────────────────────
// Public types — CONTRACT met Agent Q (controller) en Agent AAA (frontend)
// ─────────────────────────────────────────────────────────────────────────────

export interface JobMatch {
  candidate_id: string;
  candidate_name: string;
  candidate_email: string | null;
  candidate_position: string | null;
  /**
   * Raw cosine similarity 0–1. Backward-compat alias voor `cosine_score` —
   * Slice 4-tests/clients lezen dit veld.
   */
  score: number;
  /** Raw cosine — expliciet veld voor frontend-rendering. */
  cosine_score: number;
  /**
   * Talent-Fit-prediction (0..1). NULL wanneer er voor deze tenant geen
   * actief model is (cold-start, training-data te klein).
   */
  fit_score: number | null;
  /**
   * Combined score 0..1 (= cosine als geen model, anders 0.6*cosine+0.4*fit).
   * `match_percent = round(combined_score * 100)`.
   */
  combined_score: number;
  /** ROUND(combined_score * 100), 0–100 voor UI weergave. */
  match_percent: number;
  ai_explanation: string | null;
  /**
   * Aantal historische, succesvolle hires die qua embedding op deze kandidaat
   * lijken. 0 wanneer er geen model is of geen hires zijn. UI gebruikt dit
   * voor de "Lijkt op N eerder aangenomen ..."-badge.
   */
  similar_hire_count: number;
  /** True als er voor deze tenant een actief Talent-Fit model bestaat. */
  has_active_model: boolean;
  computed_at: string;
}

export interface CandidateMatch {
  job_id: string;
  job_title: string;
  job_status: string;
  /** Raw cosine — backward-compat alias voor `cosine_score`. */
  score: number;
  cosine_score: number;
  fit_score: number | null;
  combined_score: number;
  match_percent: number;
  ai_explanation: string | null;
  similar_hire_count: number;
  has_active_model: boolean;
  computed_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants & helpers
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const COSINE_WEIGHT = 0.6;
const FIT_WEIGHT = 0.4;

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
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

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function combinedFromCosineFit(cosine: number, fit: number | null): number {
  if (fit === null || !Number.isFinite(fit)) return clamp01(cosine);
  return clamp01(COSINE_WEIGHT * cosine + FIT_WEIGHT * fit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Talent-Fit prediction wrapper
//
// Per-(job, candidate) prediction — gaat via Agent YY's
// `talentFit.service.predictForCandidateJob` met `use_cache=true`. De
// service handelt cache lookup (talent_fit_predictions, 24u TTL via
// computed_at), feature-extractie en similar-hires-lookup af.
//
// We catchen alle errors zodat één corrupte rij de hele lijst niet sloopt.
// In dat geval krijgt de match `has_active_model=false` + cosine-only.
// ─────────────────────────────────────────────────────────────────────────────

interface PredictionShape {
  fit_score: number | null;
  combined_score: number;
  similar_hires_count: number;
  has_active_model: boolean;
  model_id: string | null;
}

const FALLBACK_PREDICTION: Readonly<PredictionShape> = Object.freeze({
  fit_score: null,
  combined_score: 0,
  similar_hires_count: 0,
  has_active_model: false,
  model_id: null,
});

async function safePredict(
  tenantId: string,
  jobId: string,
  candidateId: string,
  cosineScore: number
): Promise<PredictionShape> {
  try {
    const result = await talentFitService.predictForCandidateJob(
      tenantId,
      jobId,
      candidateId,
      { use_cache: true }
    );
    if (!result.has_active_model) {
      return {
        ...FALLBACK_PREDICTION,
        combined_score: clamp01(cosineScore),
      };
    }
    const fitScore =
      result.fit_score !== null && Number.isFinite(result.fit_score)
        ? clamp01(result.fit_score)
        : null;
    // Defensieve combined-recompute: YY's service combineert met de
    // (1+cos)/2-mapped cosine, terwijl de UI de raw cosine toont. We rebuilden
    // 'm hier zodat `cosine_score`, `combined_score` en `match_percent`
    // intern consistent zijn.
    const combined = combinedFromCosineFit(cosineScore, fitScore);
    return {
      fit_score: fitScore,
      combined_score: combined,
      similar_hires_count: Array.isArray(result.similar_hires)
        ? result.similar_hires.length
        : 0,
      has_active_model: true,
      model_id: result.model_id,
    };
  } catch (err) {
    logger.info('[matching] talentFit prediction faalde — fallback cosine', {
      tenantId,
      jobId,
      candidateId,
      error: (err as Error).message,
    });
    return {
      ...FALLBACK_PREDICTION,
      combined_score: clamp01(cosineScore),
    };
  }
}

/**
 * Achtergrond-audit: schrijft een MATCH_RANKED_BY_TALENT_FIT event nadat een
 * lijst is herrangschikt met een actief model. Non-blocking: faalt deze
 * write, dan loggen we 'm en gaan door.
 */
async function logRankingAudit(
  tenantId: string,
  payload: {
    job_id: string | null;
    candidate_id: string | null;
    candidate_count: number;
    model_id: string | null;
  }
): Promise<void> {
  try {
    await withTenant(tenantId, async (client) => {
      await logAudit(client, tenantId, {
        action: AuditActions.MATCH_RANKED_BY_TALENT_FIT,
        entityType: payload.job_id ? 'job' : 'candidate',
        entityId: payload.job_id ?? payload.candidate_id ?? null,
        after: payload,
      });
    });
  } catch (err) {
    logger.warn('[matching] audit MATCH_RANKED_BY_TALENT_FIT faalde', {
      error: (err as Error).message,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getJobMatches — kandidaten die matchen op deze vacature
// ─────────────────────────────────────────────────────────────────────────────

interface JobMatchBaseRow {
  candidate_id: string;
  candidate_name: string;
  candidate_email: string | null;
  candidate_position: string | null;
  score: number;
  ai_explanation: string | null;
  computed_at: string;
}

export async function getJobMatches(
  tenantId: string,
  jobId: string,
  limit: number = DEFAULT_LIMIT
): Promise<JobMatch[]> {
  const safeLimit = clampLimit(limit);

  // 1. Cosine-only top-N selectie (Slice 4 path). We sluiten de tx hier zodat
  //    we daarna predictForCandidateJob (eigen withTenant) kunnen aanroepen
  //    zonder nested-tx-conflicten.
  const baseRows = await withTenant(tenantId, async (client): Promise<JobMatchBaseRow[]> => {
    const { rows: [job] } = await client.query(
      `SELECT id, embedding IS NOT NULL AS has_embedding
       FROM jobs
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [jobId, tenantId]
    );
    if (!job) {
      throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');
    }
    if (!job.has_embedding) {
      logger.info('[matching] job zonder embedding — return []', {
        tenantId,
        jobId,
      });
      return [];
    }

    const { rows } = await client.query(
      `SELECT
         c.id                            AS candidate_id,
         c.name                          AS candidate_name,
         c.email                         AS candidate_email,
         c.current_position              AS candidate_position,
         (1 - (c.embedding <=> j.embedding))::float AS score,
         ms.ai_explanation,
         ms.explanation_at,
         COALESCE(ms.computed_at, now()) AS computed_at
       FROM jobs j
       JOIN candidates c
         ON c.tenant_id = j.tenant_id
        AND c.deleted_at IS NULL
        AND c.embedding IS NOT NULL
       LEFT JOIN match_scores ms
         ON ms.tenant_id = j.tenant_id
        AND ms.job_id = j.id
        AND ms.candidate_id = c.id
       WHERE j.id = $1 AND j.tenant_id = $2
       ORDER BY c.embedding <=> j.embedding ASC
       LIMIT $3`,
      [jobId, tenantId, safeLimit]
    );

    return rows.map((row): JobMatchBaseRow => ({
      candidate_id: row.candidate_id,
      candidate_name: row.candidate_name,
      candidate_email: row.candidate_email ?? null,
      candidate_position: row.candidate_position ?? null,
      score: toNumber(row.score),
      ai_explanation: row.ai_explanation ?? null,
      computed_at: toIsoString(row.computed_at),
    }));
  });

  if (baseRows.length === 0) return [];

  // 2. Talent-Fit verrijking — parallel-fanout om de N round-trips niet seq
  //    te laten oplopen. Concurrency is in de praktijk gelimiteerd door pg
  //    pool size (default 20) — daar past safeLimit ≤ 20 prima in.
  const predictions = await Promise.all(
    baseRows.map((row) =>
      safePredict(tenantId, jobId, row.candidate_id, row.score)
    )
  );

  const enriched: JobMatch[] = baseRows.map((row, idx): JobMatch => {
    const pred = predictions[idx];
    const cosine = clamp01(row.score);
    const finalScore = pred.has_active_model ? pred.combined_score : cosine;
    return {
      candidate_id: row.candidate_id,
      candidate_name: row.candidate_name,
      candidate_email: row.candidate_email,
      candidate_position: row.candidate_position,
      score: row.score,
      cosine_score: cosine,
      fit_score: pred.fit_score,
      combined_score: pred.has_active_model ? pred.combined_score : cosine,
      match_percent: Math.round(finalScore * 100),
      ai_explanation: row.ai_explanation,
      similar_hire_count: pred.similar_hires_count,
      has_active_model: pred.has_active_model,
      computed_at: row.computed_at,
    };
  });

  // 3. Re-rank op combined_score wanneer minstens één rij een active model
  //    rapporteert. We checken per-rij i.p.v. globaal omdat een transient
  //    failure van predictForCandidateJob lokaal terugvalt op cosine — de
  //    ranking blijft consistent met de meerderheid.
  const anyActive = enriched.some((r) => r.has_active_model);
  if (anyActive) {
    enriched.sort((a, b) => b.combined_score - a.combined_score);
    // Pak modelId van de eerste rij die er een heeft (allemaal hetzelfde model).
    const modelId =
      predictions.find((p) => p.has_active_model)?.model_id ?? null;
    void logRankingAudit(tenantId, {
      job_id: jobId,
      candidate_id: null,
      candidate_count: enriched.length,
      model_id: modelId,
    });
  }
  return enriched;
}

// ─────────────────────────────────────────────────────────────────────────────
// getCandidateMatches — vacatures die matchen op deze kandidaat
// ─────────────────────────────────────────────────────────────────────────────

interface CandidateMatchBaseRow {
  job_id: string;
  job_title: string;
  job_status: string;
  score: number;
  ai_explanation: string | null;
  computed_at: string;
}

export async function getCandidateMatches(
  tenantId: string,
  candidateId: string,
  limit: number = DEFAULT_LIMIT
): Promise<CandidateMatch[]> {
  const safeLimit = clampLimit(limit);

  const baseRows = await withTenant(
    tenantId,
    async (client): Promise<CandidateMatchBaseRow[]> => {
      const { rows: [candidate] } = await client.query(
        `SELECT id, embedding IS NOT NULL AS has_embedding
       FROM candidates
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [candidateId, tenantId]
      );
      if (!candidate) {
        throw new AppError(
          404,
          'CANDIDATE_NOT_FOUND',
          'Kandidaat niet gevonden'
        );
      }
      if (!candidate.has_embedding) {
        logger.info('[matching] candidate zonder embedding — return []', {
          tenantId,
          candidateId,
        });
        return [];
      }

      const { rows } = await client.query(
        `SELECT
         j.id                            AS job_id,
         j.title                         AS job_title,
         j.status                        AS job_status,
         (1 - (j.embedding <=> c.embedding))::float AS score,
         ms.ai_explanation,
         ms.explanation_at,
         COALESCE(ms.computed_at, now()) AS computed_at
       FROM candidates c
       JOIN jobs j
         ON j.tenant_id = c.tenant_id
        AND j.deleted_at IS NULL
        AND j.embedding IS NOT NULL
       LEFT JOIN match_scores ms
         ON ms.tenant_id = c.tenant_id
        AND ms.job_id = j.id
        AND ms.candidate_id = c.id
       WHERE c.id = $1 AND c.tenant_id = $2
       ORDER BY j.embedding <=> c.embedding ASC
       LIMIT $3`,
        [candidateId, tenantId, safeLimit]
      );

      return rows.map((row): CandidateMatchBaseRow => ({
        job_id: row.job_id,
        job_title: row.job_title,
        job_status: row.job_status,
        score: toNumber(row.score),
        ai_explanation: row.ai_explanation ?? null,
        computed_at: toIsoString(row.computed_at),
      }));
    }
  );

  if (baseRows.length === 0) return [];

  const predictions = await Promise.all(
    baseRows.map((row) =>
      safePredict(tenantId, row.job_id, candidateId, row.score)
    )
  );

  const enriched: CandidateMatch[] = baseRows.map(
    (row, idx): CandidateMatch => {
      const pred = predictions[idx];
      const cosine = clamp01(row.score);
      const finalScore = pred.has_active_model ? pred.combined_score : cosine;
      return {
        job_id: row.job_id,
        job_title: row.job_title,
        job_status: row.job_status,
        score: row.score,
        cosine_score: cosine,
        fit_score: pred.fit_score,
        combined_score: pred.has_active_model ? pred.combined_score : cosine,
        match_percent: Math.round(finalScore * 100),
        ai_explanation: row.ai_explanation,
        similar_hire_count: pred.similar_hires_count,
        has_active_model: pred.has_active_model,
        computed_at: row.computed_at,
      };
    }
  );

  const anyActive = enriched.some((r) => r.has_active_model);
  if (anyActive) {
    enriched.sort((a, b) => b.combined_score - a.combined_score);
    const modelId =
      predictions.find((p) => p.has_active_model)?.model_id ?? null;
    void logRankingAudit(tenantId, {
      job_id: null,
      candidate_id: candidateId,
      candidate_count: enriched.length,
      model_id: modelId,
    });
  }
  return enriched;
}
