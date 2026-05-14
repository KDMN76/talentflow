/**
 * Talent-Fit service — Sprint Q3.3.
 *
 * Verantwoordelijkheden:
 *   1. trainTalentFitModel(tenantId)        — trainer-pipeline (data-collect + train + persist)
 *   2. getActiveModel(tenantId)             — lees actieve model
 *   3. predictForCandidateJob(...)          — prediction (incl. cache + similar hires)
 *   4. findSimilarPastHires(...)            — top-N hires die op een kandidaat lijken
 *   5. getRankedCandidatesForJob(...)       — kandidaten gesorteerd op combined_score
 *
 * RLS-strategie: alle tenant-data via withTenant. We gebruiken nooit een
 * tenant-loze pool — ook training niet (training pakt 1 tenant tegelijk).
 *
 * INSUFFICIENT_DATA-rationale:
 *   • Logistic regression met 10 features en L2-regularisatie heeft realistisch
 *     ~20 samples per class nodig om AUC > 0.65 te halen op een held-out set.
 *     Onder die threshold is het signaal te zwak en bouwen we vooral noise in.
 *   • 20 hires + 20 rejects komt overeen met ~3-6 maanden recruiting bij een
 *     mid-size bureau (10-20 plaatsingen/maand × ~25% hire-rate).
 */

import type { PoolClient } from 'pg';
import { withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import { logAudit } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import {
  extractFeatures,
  TalentFitFeatures,
  CandidateInput,
  JobInput,
  cosineSimilarity,
} from '../../lib/talentFit/features';
import {
  trainLogisticRegression,
  predictFitScore,
  TrainedModel,
} from '../../lib/talentFit/trainer';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const MIN_SAMPLES_PER_CLASS = 20;
export const COSINE_WEIGHT = 0.6;
export const FIT_WEIGHT = 0.4;
export const SIMILAR_HIRES_DEFAULT_LIMIT = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface TalentFitModelRow {
  id: string;
  tenant_id: string;
  coefficients: TrainedModel & { features: string[] };
  feature_names: string[];
  trained_on: number;
  hires: number;
  rejects: number;
  precision_at_1: number | null;
  recall_at_10: number | null;
  auc: number | null;
  trained_at: string;
  trained_by: string;
  active: boolean;
}

export interface SimilarHire {
  candidate_id: string;
  candidate_name: string;
  job_title: string | null;
  hired_at: string | null;
  similarity: number;
}

export interface PredictionResult {
  fit_score: number | null;
  combined_score: number;
  cosine_sim: number;
  features: TalentFitFeatures;
  similar_hires: SimilarHire[];
  has_active_model: boolean;
  model_id: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function combinedScore(cosine: number, fit: number | null): number {
  if (fit === null || !Number.isFinite(fit)) return clamp01(cosine);
  return clamp01(COSINE_WEIGHT * cosine + FIT_WEIGHT * fit);
}

/**
 * pgvector embeddings worden als strings geretourneerd ('[0.1, 0.2, ...]'). We
 * parsen lazy zodat we alleen werk doen wanneer een caller de vector echt nodig
 * heeft (similar-hires lookup).
 */
function parseEmbedding(value: unknown): number[] | null {
  if (!value) return null;
  if (Array.isArray(value)) return value as number[];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
    const parts = trimmed.slice(1, -1).split(',');
    const out = new Array<number>(parts.length);
    for (let i = 0; i < parts.length; i++) {
      const n = parseFloat(parts[i]);
      if (!Number.isFinite(n)) return null;
      out[i] = n;
    }
    return out;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source-stats — succes-rate per source voor deze tenant
// ─────────────────────────────────────────────────────────────────────────────

async function loadTenantSourceStats(
  client: PoolClient,
  tenantId: string
): Promise<Record<string, number>> {
  const { rows } = await client.query<{ source: string | null; hires: string; total: string }>(
    `SELECT lower(c.source) AS source,
            SUM(CASE WHEN a.status = 'hired' THEN 1 ELSE 0 END) AS hires,
            COUNT(*)                                            AS total
       FROM applications a
       JOIN candidates  c ON c.id = a.candidate_id AND c.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1
        AND a.status IN ('hired','rejected','offer_declined')
      GROUP BY lower(c.source)`,
    [tenantId]
  );
  const stats: Record<string, number> = {};
  let totalAll = 0;
  let hiresAll = 0;
  for (const r of rows) {
    const total = parseInt(r.total, 10) || 0;
    const hires = parseInt(r.hires, 10) || 0;
    if (total === 0) continue;
    if (r.source) stats[r.source] = hires / total;
    totalAll += total;
    hiresAll += hires;
  }
  stats.__avg__ = totalAll > 0 ? hiresAll / totalAll : 0.5;
  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Training data collector
// ─────────────────────────────────────────────────────────────────────────────

interface TrainingRow {
  candidate: CandidateInput;
  job: JobInput;
  status: 'hired' | 'rejected' | 'offer_declined';
}

async function loadTrainingData(
  client: PoolClient,
  tenantId: string
): Promise<TrainingRow[]> {
  const { rows } = await client.query(
    `SELECT a.status,
            -- candidate
            c.id                           AS c_id,
            c.embedding                    AS c_embedding,
            c.skills                       AS c_skills,
            c.current_position             AS c_current_position,
            c.years_of_experience          AS c_yoe,
            c.source                       AS c_source,
            c.resume_url                   AS c_resume_url,
            c.last_activity_at             AS c_last_activity_at,
            -- job
            j.id                           AS j_id,
            j.title                        AS j_title,
            j.embedding                    AS j_embedding,
            j.required_skills              AS j_required_skills,
            j.description                  AS j_description,
            -- candidate_skills (gestructureerd)
            COALESCE(
              (
                SELECT json_agg(json_build_object('skill', cs.skill, 'score', cs.score))
                  FROM candidate_skills cs
                 WHERE cs.candidate_id = c.id
                   AND cs.tenant_id = c.tenant_id
              ),
              '[]'::json
            )                              AS c_candidate_skills
       FROM applications a
       JOIN candidates  c ON c.id = a.candidate_id AND c.tenant_id = a.tenant_id
       JOIN jobs        j ON j.id = a.job_id       AND j.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1
        AND a.status IN ('hired','rejected','offer_declined')
        AND c.deleted_at IS NULL
        AND j.deleted_at IS NULL`,
    [tenantId]
  );

  return rows.map((r): TrainingRow => ({
    status: r.status,
    candidate: {
      id: r.c_id,
      embedding: parseEmbedding(r.c_embedding),
      skills: r.c_skills ?? [],
      candidate_skills: Array.isArray(r.c_candidate_skills)
        ? r.c_candidate_skills
        : [],
      current_position: r.c_current_position,
      years_of_experience: typeof r.c_yoe === 'number' ? r.c_yoe : null,
      source: r.c_source,
      resume_url: r.c_resume_url,
      last_activity_at: r.c_last_activity_at,
    },
    job: {
      id: r.j_id,
      title: r.j_title,
      embedding: parseEmbedding(r.j_embedding),
      required_skills: r.j_required_skills ?? [],
      description: r.j_description,
      level: null, // Q3.3 — job.level kolom bestaat nog niet; YOE-target = default 5j.
    },
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// trainTalentFitModel
// ─────────────────────────────────────────────────────────────────────────────

export async function trainTalentFitModel(
  tenantId: string,
  triggeredBy: string = 'cron'
): Promise<TalentFitModelRow> {
  return withTenant(tenantId, async (client) => {
    const rows = await loadTrainingData(client, tenantId);
    const hires = rows.filter((r) => r.status === 'hired');
    const rejects = rows.filter(
      (r) => r.status === 'rejected' || r.status === 'offer_declined'
    );

    if (hires.length < MIN_SAMPLES_PER_CLASS || rejects.length < MIN_SAMPLES_PER_CLASS) {
      throw new AppError(
        422,
        'INSUFFICIENT_DATA',
        `Minimaal ${MIN_SAMPLES_PER_CLASS} hires én ${MIN_SAMPLES_PER_CLASS} rejects nodig (${hires.length}/${rejects.length})`,
        { hires: hires.length, rejects: rejects.length, threshold: MIN_SAMPLES_PER_CLASS }
      );
    }

    const sourceStats = await loadTenantSourceStats(client, tenantId);
    const examples = rows.map((r) => ({
      features: extractFeatures(r.candidate, r.job, sourceStats),
      label: (r.status === 'hired' ? 1 : 0) as 0 | 1,
    }));

    const model = trainLogisticRegression(examples);

    // Persist: deactiveer oude active models, insert nieuwe.
    await client.query(
      `UPDATE talent_fit_models SET active = FALSE
        WHERE tenant_id = $1 AND active = TRUE`,
      [tenantId]
    );
    const coefficients = {
      features: model.feature_names,
      weights: model.weights,
      intercept: model.intercept,
      normalization: model.normalization,
    };
    const { rows: inserted } = await client.query<TalentFitModelRow>(
      `INSERT INTO talent_fit_models
         (tenant_id, coefficients, feature_names, trained_on, hires, rejects,
          precision_at_1, recall_at_10, auc, trained_by, active)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6,
               $7, $8, $9, $10, TRUE)
       RETURNING *`,
      [
        tenantId,
        JSON.stringify(coefficients),
        model.feature_names,
        examples.length,
        hires.length,
        rejects.length,
        model.metrics.precision_at_1.toFixed(4),
        model.metrics.recall_at_10.toFixed(4),
        model.metrics.auc.toFixed(4),
        triggeredBy,
      ]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.TALENT_FIT_MODEL_TRAINED,
        entityType: 'talent_fit_model',
        entityId: inserted[0].id,
        after: {
          trained_on: examples.length,
          hires: hires.length,
          rejects: rejects.length,
          metrics: model.metrics,
          triggered_by: triggeredBy,
        },
        userId: null,
      }
    );

    logger.info('[talentFit] model trained', {
      tenantId,
      modelId: inserted[0].id,
      trainedOn: examples.length,
      hires: hires.length,
      rejects: rejects.length,
      metrics: model.metrics,
    });

    return inserted[0];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// getActiveModel
// ─────────────────────────────────────────────────────────────────────────────

function rowToModel(row: TalentFitModelRow | undefined | null): TrainedModel | null {
  if (!row) return null;
  const coeffs = row.coefficients as unknown as {
    weights: number[];
    intercept: number;
    normalization: { mean: number; std: number }[];
  };
  if (!coeffs?.weights || !coeffs?.normalization) return null;
  return {
    feature_names: row.feature_names,
    weights: coeffs.weights,
    intercept: coeffs.intercept,
    normalization: coeffs.normalization,
    trained_on: row.trained_on,
    metrics: {
      precision_at_1: toNumberOrNull(row.precision_at_1) ?? 0,
      recall_at_10: toNumberOrNull(row.recall_at_10) ?? 0,
      auc: toNumberOrNull(row.auc) ?? 0,
    },
  };
}

export async function getActiveModel(
  tenantId: string
): Promise<{ row: TalentFitModelRow; model: TrainedModel } | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<TalentFitModelRow>(
      `SELECT * FROM talent_fit_models
        WHERE tenant_id = $1 AND active = TRUE
        ORDER BY trained_at DESC
        LIMIT 1`,
      [tenantId]
    );
    const row = rows[0];
    if (!row) return null;
    const model = rowToModel(row);
    if (!model) return null;
    return { row, model };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// findSimilarPastHires
// ─────────────────────────────────────────────────────────────────────────────

export async function findSimilarPastHires(
  tenantId: string,
  candidateId: string,
  jobIdOrTitle?: string,
  limit: number = SIMILAR_HIRES_DEFAULT_LIMIT
): Promise<SimilarHire[]> {
  return withTenant(tenantId, async (client) => {
    return findSimilarPastHiresInClient(client, tenantId, candidateId, jobIdOrTitle, limit);
  });
}

async function findSimilarPastHiresInClient(
  client: PoolClient,
  tenantId: string,
  candidateId: string,
  jobIdOrTitle: string | undefined,
  limit: number
): Promise<SimilarHire[]> {
  // 1) candidate embedding ophalen
  const { rows: candRows } = await client.query<{ embedding: unknown }>(
    `SELECT embedding FROM candidates
      WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [candidateId, tenantId]
  );
  if (candRows.length === 0 || !candRows[0].embedding) return [];

  // 2) Optional: job-title-similarity filter. Bij UUID = job.id, anders = title-string.
  let jobTitleFilter: string | null = null;
  let jobIdFilter: string | null = null;
  if (jobIdOrTitle) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobIdOrTitle);
    if (isUuid) {
      const { rows } = await client.query<{ title: string | null }>(
        `SELECT title FROM jobs WHERE id = $1 AND tenant_id = $2`,
        [jobIdOrTitle, tenantId]
      );
      jobTitleFilter = rows[0]?.title ?? null;
      jobIdFilter = jobIdOrTitle;
    } else {
      jobTitleFilter = jobIdOrTitle;
    }
  }

  const params: unknown[] = [candidateId, tenantId, Math.max(1, Math.min(limit, 50))];
  let titleClause = '';
  if (jobTitleFilter) {
    params.push(`%${jobTitleFilter.toLowerCase()}%`);
    titleClause = `AND lower(j.title) LIKE $${params.length}`;
  }
  if (jobIdFilter) {
    params.push(jobIdFilter);
    // Niet 'zelfde job' filter — we zoeken juist hires van soortgelijke rollen, dus skipped.
  }

  const sql = `
    SELECT c.id            AS candidate_id,
           c.name          AS candidate_name,
           j.title         AS job_title,
           a.updated_at    AS hired_at,
           (1 - (c.embedding <=> (SELECT embedding FROM candidates WHERE id = $1 AND tenant_id = $2)))::float AS similarity
      FROM applications a
      JOIN candidates  c ON c.id = a.candidate_id AND c.tenant_id = a.tenant_id
      JOIN jobs        j ON j.id = a.job_id       AND j.tenant_id = a.tenant_id
     WHERE a.tenant_id = $2
       AND a.status    = 'hired'
       AND c.id       <> $1
       AND c.embedding IS NOT NULL
       AND c.deleted_at IS NULL
       ${titleClause}
     ORDER BY c.embedding <=> (SELECT embedding FROM candidates WHERE id = $1 AND tenant_id = $2) ASC
     LIMIT $3
  `;

  const { rows } = await client.query<{
    candidate_id: string;
    candidate_name: string;
    job_title: string | null;
    hired_at: Date | string | null;
    similarity: number | string;
  }>(sql, params);

  return rows.map((r) => ({
    candidate_id: r.candidate_id,
    candidate_name: r.candidate_name,
    job_title: r.job_title,
    hired_at: toIso(r.hired_at),
    similarity: clamp01(toNumberOrNull(r.similarity) ?? 0),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// predictForCandidateJob
// ─────────────────────────────────────────────────────────────────────────────

interface HydratedCandidate {
  id: string;
  embedding: unknown;
  skills: string[] | null;
  current_position: string | null;
  years_of_experience: number | null;
  source: string | null;
  resume_url: string | null;
  description: string | null;
  ai_summary: string | null;
  last_activity_at: Date | string | null;
  candidate_skills: Array<{ skill: string; score?: number | null }>;
}

interface HydratedJob {
  id: string;
  title: string | null;
  embedding: unknown;
  required_skills: string[] | null;
  description: string | null;
}

async function hydrateCandidate(
  client: PoolClient,
  tenantId: string,
  candidateId: string
): Promise<HydratedCandidate | null> {
  const { rows } = await client.query<HydratedCandidate>(
    `SELECT c.id,
            c.embedding,
            c.skills,
            c.current_position,
            c.years_of_experience,
            c.source,
            c.resume_url,
            c.notes        AS description,
            (
              SELECT cr.ai_summary
                FROM candidate_resumes cr
               WHERE cr.candidate_id = c.id
                 AND cr.tenant_id = c.tenant_id
                 AND cr.ai_summary IS NOT NULL
               ORDER BY cr.is_primary DESC, cr.parsed_at DESC NULLS LAST
               LIMIT 1
            )                 AS ai_summary,
            c.last_activity_at,
            COALESCE(
              (
                SELECT json_agg(json_build_object('skill', cs.skill, 'score', cs.score))
                  FROM candidate_skills cs
                 WHERE cs.candidate_id = c.id AND cs.tenant_id = c.tenant_id
              ),
              '[]'::json
            )                 AS candidate_skills
       FROM candidates c
      WHERE c.id = $1 AND c.tenant_id = $2 AND c.deleted_at IS NULL`,
    [candidateId, tenantId]
  );
  return rows[0] ?? null;
}

async function hydrateJob(
  client: PoolClient,
  tenantId: string,
  jobId: string
): Promise<HydratedJob | null> {
  const { rows } = await client.query<HydratedJob>(
    `SELECT id, title, embedding, required_skills, description
       FROM jobs
      WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [jobId, tenantId]
  );
  return rows[0] ?? null;
}

export async function predictForCandidateJob(
  tenantId: string,
  jobId: string,
  candidateId: string,
  options: { use_cache?: boolean } = {}
): Promise<PredictionResult> {
  const useCache = options.use_cache ?? true;
  return withTenant(tenantId, async (client) => {
    const job = await hydrateJob(client, tenantId, jobId);
    if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');
    const candidate = await hydrateCandidate(client, tenantId, candidateId);
    if (!candidate) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
    }

    // Active model laden binnen dezelfde transactie (RLS-safe).
    const { rows: modelRows } = await client.query<TalentFitModelRow>(
      `SELECT * FROM talent_fit_models
        WHERE tenant_id = $1 AND active = TRUE
        ORDER BY trained_at DESC LIMIT 1`,
      [tenantId]
    );
    const modelRow = modelRows[0] ?? null;
    const model = rowToModel(modelRow);

    // Cache hit?
    if (useCache && modelRow) {
      const { rows: cacheRows } = await client.query<{
        fit_score: string | number;
        combined_score: string | number;
        feature_values: TalentFitFeatures | null;
        similar_hires: string[] | null;
      }>(
        `SELECT fit_score, combined_score, feature_values, similar_hires
           FROM talent_fit_predictions
          WHERE tenant_id = $1 AND model_id = $2 AND job_id = $3 AND candidate_id = $4`,
        [tenantId, modelRow.id, jobId, candidateId]
      );
      const cached = cacheRows[0];
      if (cached && cached.feature_values) {
        const cosine = clamp01(cached.feature_values.cosine_sim ?? 0);
        return {
          fit_score: clamp01(toNumberOrNull(cached.fit_score) ?? 0),
          combined_score: clamp01(toNumberOrNull(cached.combined_score) ?? 0),
          cosine_sim: cosine,
          features: cached.feature_values,
          similar_hires: [], // niet gecachet — de UI vraagt opnieuw indien nodig
          has_active_model: true,
          model_id: modelRow.id,
        };
      }
    }

    // Verzamel features
    const sourceStats = await loadTenantSourceStats(client, tenantId);
    const candEmb = parseEmbedding(candidate.embedding);
    const jobEmb = parseEmbedding(job.embedding);
    const candidateInput: CandidateInput = {
      id: candidate.id,
      embedding: candEmb,
      skills: candidate.skills ?? [],
      candidate_skills: Array.isArray(candidate.candidate_skills)
        ? candidate.candidate_skills
        : [],
      current_position: candidate.current_position,
      years_of_experience: candidate.years_of_experience,
      source: candidate.source,
      resume_url: candidate.resume_url,
      description: candidate.description,
      ai_summary: candidate.ai_summary,
      last_activity_at: candidate.last_activity_at,
    };
    const jobInput: JobInput = {
      id: job.id,
      title: job.title,
      embedding: jobEmb,
      required_skills: job.required_skills ?? [],
      description: job.description,
      level: null,
    };
    const features = extractFeatures(candidateInput, jobInput, sourceStats);

    // De cosine die we naar de UI willen sturen is de "rauwe" 0..1 cosine — niet
    // de [0,1]-mapped (1+cos)/2 die in features.cosine_sim zit. We berekenen
    // 'm hier opnieuw zodat de UI dezelfde getallen toont als de matching service.
    const rawCosine = candEmb && jobEmb
      ? Math.max(0, Math.min(1, cosineSimilarity(candEmb, jobEmb) * 2 - 1))
      : 0;

    let fitScore: number | null = null;
    if (model) {
      fitScore = predictFitScore(model, features);
    }
    const combined = combinedScore(rawCosine, fitScore);

    // Similar hires (top-3) — best-effort. Faalt → leeg.
    let similar: SimilarHire[] = [];
    try {
      similar = await findSimilarPastHiresInClient(
        client,
        tenantId,
        candidateId,
        job.title ?? undefined,
        SIMILAR_HIRES_DEFAULT_LIMIT
      );
    } catch (err) {
      logger.warn('[talentFit] similar-hires lookup faalde', {
        tenantId,
        jobId,
        candidateId,
        error: (err as Error).message,
      });
    }

    // Cache UPSERT — alleen als er een active model is.
    if (modelRow && fitScore !== null) {
      const similarIds = similar.map((s) => s.candidate_id);
      await client.query(
        `INSERT INTO talent_fit_predictions
           (tenant_id, model_id, job_id, candidate_id,
            fit_score, combined_score, feature_values, similar_hires, computed_at)
         VALUES ($1, $2, $3, $4,
                 $5, $6, $7::jsonb, $8::uuid[], now())
         ON CONFLICT (tenant_id, model_id, job_id, candidate_id)
         DO UPDATE SET
            fit_score      = EXCLUDED.fit_score,
            combined_score = EXCLUDED.combined_score,
            feature_values = EXCLUDED.feature_values,
            similar_hires  = EXCLUDED.similar_hires,
            computed_at    = now()`,
        [
          tenantId,
          modelRow.id,
          jobId,
          candidateId,
          clamp01(fitScore).toFixed(4),
          clamp01(combined).toFixed(4),
          JSON.stringify(features),
          similarIds,
        ]
      );
    }

    return {
      fit_score: fitScore,
      combined_score: combined,
      cosine_sim: rawCosine,
      features,
      similar_hires: similar,
      has_active_model: !!modelRow,
      model_id: modelRow?.id ?? null,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// getRankedCandidatesForJob — talent-fit lijst, gesorteerd op combined_score
// ─────────────────────────────────────────────────────────────────────────────

export interface RankedCandidate {
  candidate_id: string;
  candidate_name: string;
  candidate_email: string | null;
  cosine_score: number;
  fit_score: number | null;
  combined_score: number;
  match_percent: number;
  has_active_model: boolean;
}

export async function getRankedCandidatesForJob(
  tenantId: string,
  jobId: string,
  limit: number = 20
): Promise<RankedCandidate[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit) || 20));
  return withTenant(tenantId, async (client) => {
    const job = await hydrateJob(client, tenantId, jobId);
    if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');
    const jobEmb = parseEmbedding(job.embedding);
    if (!jobEmb) return [];

    // Active model
    const { rows: modelRows } = await client.query<TalentFitModelRow>(
      `SELECT * FROM talent_fit_models
        WHERE tenant_id = $1 AND active = TRUE
        ORDER BY trained_at DESC LIMIT 1`,
      [tenantId]
    );
    const modelRow = modelRows[0] ?? null;
    const model = rowToModel(modelRow);

    // Top-N kandidaten via cosine — daarna re-rank in JS via combined_score.
    const { rows: candidateRows } = await client.query<{
      id: string;
      name: string;
      email: string | null;
      embedding: unknown;
      skills: string[] | null;
      current_position: string | null;
      years_of_experience: number | null;
      source: string | null;
      resume_url: string | null;
      description: string | null;
      last_activity_at: Date | string | null;
      candidate_skills: Array<{ skill: string; score?: number | null }>;
      cosine: number | string;
    }>(
      `SELECT c.id, c.name, c.email, c.embedding, c.skills,
              c.current_position, c.years_of_experience, c.source,
              c.resume_url, c.notes AS description, c.last_activity_at,
              COALESCE(
                (
                  SELECT json_agg(json_build_object('skill', cs.skill, 'score', cs.score))
                    FROM candidate_skills cs
                   WHERE cs.candidate_id = c.id AND cs.tenant_id = c.tenant_id
                ),
                '[]'::json
              ) AS candidate_skills,
              (1 - (c.embedding <=> (SELECT embedding FROM jobs WHERE id = $1 AND tenant_id = $2)))::float AS cosine
         FROM candidates c
        WHERE c.tenant_id = $2
          AND c.deleted_at IS NULL
          AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> (SELECT embedding FROM jobs WHERE id = $1 AND tenant_id = $2) ASC
        LIMIT $3`,
      [jobId, tenantId, Math.min(safeLimit * 3, 200)] // pull breder, re-rank, snij
    );

    const sourceStats = model ? await loadTenantSourceStats(client, tenantId) : {};
    const ranked: RankedCandidate[] = candidateRows.map((row) => {
      const cosine = clamp01(toNumberOrNull(row.cosine) ?? 0);
      let fit: number | null = null;
      if (model) {
        const features = extractFeatures(
          {
            id: row.id,
            embedding: parseEmbedding(row.embedding),
            skills: row.skills ?? [],
            candidate_skills: row.candidate_skills,
            current_position: row.current_position,
            years_of_experience: row.years_of_experience,
            source: row.source,
            resume_url: row.resume_url,
            description: row.description,
            last_activity_at: row.last_activity_at,
          },
          {
            id: job.id,
            title: job.title,
            embedding: jobEmb,
            required_skills: job.required_skills ?? [],
            description: job.description,
          },
          sourceStats
        );
        fit = predictFitScore(model, features);
      }
      const combined = combinedScore(cosine, fit);
      return {
        candidate_id: row.id,
        candidate_name: row.name,
        candidate_email: row.email,
        cosine_score: cosine,
        fit_score: fit,
        combined_score: combined,
        match_percent: Math.round(combined * 100),
        has_active_model: !!modelRow,
      };
    });

    ranked.sort((a, b) => b.combined_score - a.combined_score);
    return ranked.slice(0, safeLimit);
  });
}
