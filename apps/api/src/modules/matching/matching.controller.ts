import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import { withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import { AI_MATCH_DISCLOSURE_NL } from '../../lib/aiDisclosure';
import {
  generateMatchExplanation,
  type MatchExplanationInput,
} from '../../lib/matchExplanation';
import { logAIEvent } from '../../lib/aiEvents';
import { logAudit, auditCtxFromReq } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import * as matchingService from './matching.service';
import * as similarHiresService from './similarHires.service';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Default top-N for list endpoints — recruiter UI shows a leaderboard. */
const DEFAULT_MATCH_LIMIT = 20;
const MAX_MATCH_LIMIT = 100;

/**
 * TTL for cached AI explanations. After 7 days the next request re-generates.
 * Override via `MATCH_EXPLANATION_TTL_DAYS` env-var (integer, days). The TTL
 * exists to keep explanations relevant when the candidate's CV or the job
 * description changes; it's not a hard data-retention cap.
 */
function getExplanationTtlDays(): number {
  const raw = process.env.MATCH_EXPLANATION_TTL_DAYS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 7;
  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Query schemas
// ─────────────────────────────────────────────────────────────────────────────

const limitQuerySchema = z.object({
  limit: z
    .preprocess(
      (v) => (typeof v === 'string' && v.length > 0 ? Number.parseInt(v, 10) : v),
      z.number().int().min(1).max(MAX_MATCH_LIMIT).optional()
    )
    .optional(),
});

const uuidSchema = z
  .string()
  .uuid({ message: 'Ongeldig id-formaat (verwacht UUID)' });

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/matching/jobs/:jobId
// ─────────────────────────────────────────────────────────────────────────────

export async function getJobMatchesHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const jobId = uuidSchema.parse(req.params.jobId);
    const { limit } = limitQuerySchema.parse(req.query);
    const effectiveLimit = limit ?? DEFAULT_MATCH_LIMIT;

    const matches = await matchingService.getJobMatches(
      req.user!.tenantId,
      jobId,
      effectiveLimit
    );

    res.json({
      data: matches,
      meta: {
        limit: effectiveLimit,
        count: matches.length,
      },
      ai_disclosure: AI_MATCH_DISCLOSURE_NL,
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/matching/candidates/:candidateId
// ─────────────────────────────────────────────────────────────────────────────

export async function getCandidateMatchesHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const candidateId = uuidSchema.parse(req.params.candidateId);
    const { limit } = limitQuerySchema.parse(req.query);
    const effectiveLimit = limit ?? DEFAULT_MATCH_LIMIT;

    const matches = await matchingService.getCandidateMatches(
      req.user!.tenantId,
      candidateId,
      effectiveLimit
    );

    res.json({
      data: matches,
      meta: {
        limit: effectiveLimit,
        count: matches.length,
      },
      ai_disclosure: AI_MATCH_DISCLOSURE_NL,
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/matching/jobs/:jobId/candidates/:candidateId/explanation
//
// Lazy AI generation — only invoked when a recruiter explicitly opens the
// explanation panel. Cached for `MATCH_EXPLANATION_TTL_DAYS` days (default 7).
// ─────────────────────────────────────────────────────────────────────────────

interface HydratedJob {
  id: string;
  title: string;
  description: string | null;
}

interface HydratedCandidate {
  id: string;
  name: string;
  current_position: string | null;
  years_of_experience: number | null;
  ai_summary: string | null;
  skills: Array<{ skill: string; score: number }>;
}

interface CachedScoreRow {
  score: number | null;
  ai_explanation: string | null;
  explanation_at: Date | null;
  computed_at: Date | null;
}

/**
 * Diagnostiek voor de ai_events-log; gevuld vanuit de Claude-call of de
 * cache-hit, daarna ná res.json verwerkt door logAIEvent.
 */
type ExplanationMeta = {
  cached: boolean;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  model: string;
  mocked: boolean;
  text: string;
};

export async function generateMatchExplanationHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const jobId = (() => {
    try {
      return uuidSchema.parse(req.params.jobId);
    } catch {
      return req.params.jobId;
    }
  })();
  const candidateId = (() => {
    try {
      return uuidSchema.parse(req.params.candidateId);
    } catch {
      return req.params.candidateId;
    }
  })();
  const tenantId = req.user?.tenantId ?? '';
  const userId = req.user?.userId ?? null;

  // We tracken een lokale `explanationMeta` zodat we ná de transactie netjes
  // een ai_events-rij kunnen schrijven — los van de transactie zelf, want
  // failures in audit/ai_events mogen NOOIT de hoofd-respons blokkeren.
  let explanationMeta: ExplanationMeta | null = null;

  try {
    // Re-parse zodat zod-fouten via next() naar de error-handler gaan.
    uuidSchema.parse(req.params.jobId);
    uuidSchema.parse(req.params.candidateId);
    const ttlDays = getExplanationTtlDays();

    const result = await withTenant(tenantId, async (client) => {
      // 1. Verify job + candidate belong to this tenant (RLS-bound).
      const { rows: jobRows } = await client.query<HydratedJob>(
        `SELECT id, title, description
           FROM jobs
          WHERE id = $1
            AND tenant_id = $2
            AND deleted_at IS NULL`,
        [jobId, tenantId]
      );
      if (jobRows.length === 0) {
        throw new AppError(404, 'JOB_NOT_FOUND', 'Vacature niet gevonden');
      }
      const job = jobRows[0];

      const { rows: candidateRows } = await client.query<HydratedCandidate>(
        `SELECT c.id,
                c.name,
                c.current_position,
                c.years_of_experience,
                COALESCE(
                  (
                    SELECT cr.ai_summary
                      FROM candidate_resumes cr
                     WHERE cr.candidate_id = c.id
                       AND cr.tenant_id = $2
                       AND cr.ai_summary IS NOT NULL
                     ORDER BY cr.is_primary DESC, cr.parsed_at DESC NULLS LAST
                     LIMIT 1
                  ),
                  NULL
                ) AS ai_summary,
                COALESCE(
                  (
                    SELECT json_agg(
                             json_build_object('skill', cs.skill, 'score', cs.score)
                             ORDER BY cs.score DESC NULLS LAST
                           )
                      FROM candidate_skills cs
                     WHERE cs.candidate_id = c.id
                       AND cs.tenant_id = $2
                  ),
                  '[]'::json
                ) AS skills
           FROM candidates c
          WHERE c.id = $1
            AND c.tenant_id = $2
            AND c.deleted_at IS NULL`,
        [candidateId, tenantId]
      );
      if (candidateRows.length === 0) {
        throw new AppError(
          404,
          'CANDIDATE_NOT_FOUND',
          'Kandidaat niet gevonden'
        );
      }
      const candidate = candidateRows[0];

      // 2. Look up the cached score row (if any).
      const { rows: scoreRows } = await client.query<CachedScoreRow>(
        `SELECT score, ai_explanation, explanation_at, computed_at
           FROM match_scores
          WHERE tenant_id = $1
            AND job_id = $2
            AND candidate_id = $3`,
        [tenantId, jobId, candidateId]
      );
      const cached = scoreRows[0];
      const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
      const isFresh =
        cached?.ai_explanation &&
        cached?.explanation_at &&
        Date.now() - cached.explanation_at.getTime() < ttlMs;

      // 2a. Cache hit — return cached explanation.
      if (isFresh && cached) {
        const score = typeof cached.score === 'number' ? cached.score : 0;
        const cachedText = cached.ai_explanation as string;
        // Sla meta op zodat we ook voor cache-hits een ai_events-rij
        // schrijven (zonder token-counts — die hebben we niet meer).
        explanationMeta = {
          cached: true,
          latencyMs: 0,
          model: 'cache',
          mocked: false,
          text: cachedText,
        };
        return {
          cached: true as const,
          payload: {
            // We persist only the "text" portion of the explanation to the DB
            // (strengths/gaps are produced fresh from the AI call). When
            // serving a cache hit we return an empty arrays + the cached text;
            // the recruiter UI degrades gracefully.
            text: cachedText,
            strengths: [] as string[],
            gaps: [] as string[],
            // Q3.3: similar_hires_note wordt niet gepersisteerd in match_scores
            // (alleen text); bij cache-hit dus null. UI kan via het
            // /similar-hires endpoint alsnog de detail-lijst ophalen.
            similar_hires_note: null as string | null,
            score,
          },
        };
      }

      // 2b. Cache miss / stale — call Claude.
      //
      // Sprint Q3.3 (Agent ZZ): we doen een lichtgewicht lookup naar het
      // aantal similar past hires zodat Claude een `similar_hires_note` kan
      // produceren. We lezen rechtstreeks uit talent_fit_predictions zonder
      // recompute — als de cache leeg is geven we 0 door (Claude voegt
      // dan geen note toe). Dit voorkomt dat we hier een dure
      // predictForCandidateJob-call moeten doen voor wat decoratie.
      const { rows: tfpRows } = await client.query<{ count: number }>(
        `SELECT COALESCE(array_length(similar_hires, 1), 0)::int AS count
           FROM talent_fit_predictions
          WHERE tenant_id = $1 AND job_id = $2 AND candidate_id = $3
          ORDER BY computed_at DESC
          LIMIT 1`,
        [tenantId, jobId, candidateId]
      );
      const similarHiresCount = tfpRows[0]?.count ?? 0;

      const matchInput: MatchExplanationInput = {
        job: {
          title: job.title,
          description: job.description ?? undefined,
        },
        candidate: {
          name: candidate.name,
          current_position: candidate.current_position ?? undefined,
          ai_summary: candidate.ai_summary ?? undefined,
          skills: Array.isArray(candidate.skills) ? candidate.skills : [],
          years_of_experience: candidate.years_of_experience ?? undefined,
        },
        // Use cached score if we have one; otherwise derive a placeholder
        // (the explanation prompt only needs an approximate %). Once the
        // service-side cosine is recomputed below, the persisted row reflects
        // the authoritative number.
        match_percent:
          typeof cached?.score === 'number'
            ? Math.round(cached.score * 100)
            : 0,
        similar_hires_count: similarHiresCount,
      };

      const explanation = await generateMatchExplanation(matchInput);

      // Capture meta zodat we ná de transactie naar ai_events kunnen schrijven.
      explanationMeta = {
        cached: false,
        inputTokens: explanation._meta?.inputTokens,
        outputTokens: explanation._meta?.outputTokens,
        latencyMs: explanation._meta?.latencyMs ?? 0,
        model: explanation._meta?.model ?? 'claude-haiku-4-5',
        mocked: explanation._meta?.mocked ?? Boolean(explanation.mocked),
        text: explanation.text,
      };

      // 3. Recompute the authoritative cosine-similarity score so we never
      // persist a stale number alongside a fresh explanation. The cosine is
      // 1 - <vector cosine_distance>; both embeddings live on their own
      // tables (jobs.embedding, candidates.embedding) populated by Agent P's
      // embeddings.worker. If either is null we fall back to the cached score.
      let resolvedScore: number =
        typeof cached?.score === 'number' ? cached.score : 0;
      try {
        const { rows: scoreCalc } = await client.query<{ score: number | null }>(
          `SELECT (1 - (j.embedding <=> c.embedding))::float8 AS score
             FROM jobs j
             JOIN candidates c ON c.tenant_id = j.tenant_id
            WHERE j.id = $1
              AND c.id = $2
              AND j.tenant_id = $3
              AND j.embedding IS NOT NULL
              AND c.embedding IS NOT NULL`,
          [jobId, candidateId, tenantId]
        );
        if (scoreCalc.length > 0 && typeof scoreCalc[0].score === 'number') {
          // Clamp to [0, 1] — cosine distance can numerically drift slightly
          // outside the theoretical bounds with normalised vectors.
          const raw = scoreCalc[0].score;
          resolvedScore = raw < 0 ? 0 : raw > 1 ? 1 : raw;
        }
      } catch (err) {
        // If embeddings aren't available yet (Agent P's worker may not have
        // populated them, or migration 006 not yet run), fall back to
        // whatever score we had cached.
        logger.warn('[matchingController] kon score niet herberekenen', {
          tenantId,
          jobId,
          candidateId,
          error: (err as Error).message,
        });
      }

      // 4. UPSERT cache row.
      await client.query(
        `INSERT INTO match_scores (
            tenant_id, job_id, candidate_id, score,
            ai_explanation, explanation_at, computed_at
         )
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (tenant_id, job_id, candidate_id)
         DO UPDATE SET
            score          = EXCLUDED.score,
            ai_explanation = EXCLUDED.ai_explanation,
            explanation_at = EXCLUDED.explanation_at,
            computed_at    = EXCLUDED.computed_at`,
        [
          tenantId,
          jobId,
          candidateId,
          resolvedScore,
          explanation.text,
        ]
      );

      return {
        cached: false as const,
        payload: {
          text: explanation.text,
          strengths: explanation.strengths,
          gaps: explanation.gaps,
          similar_hires_note: explanation.similar_hires_note ?? null,
          score: resolvedScore,
        },
      };
    });

    res.json({
      explanation: result.payload.text,
      strengths: result.payload.strengths,
      gaps: result.payload.gaps,
      // Sprint Q3.3 — optionele Talent-Fit referentie. null bij cache-hits
      // (we persisteren alleen text in match_scores) of wanneer Claude geen
      // note heeft toegevoegd.
      similar_hires_note:
        ('similar_hires_note' in result.payload
          ? result.payload.similar_hires_note
          : null) ?? null,
      score: result.payload.score,
      match_percent: Math.round(result.payload.score * 100),
      cached: result.cached,
      ai_disclosure: AI_MATCH_DISCLOSURE_NL,
    });

    // ─── Compliance logging (Q1.2 — non-blocking) ────────────────────────
    // We schrijven hier — NA res.json — een ai_events-rij plus een audit-rij.
    // Beide zijn safe-by-default (errors gaan naar Sentry/logs, niet naar
    // de gebruiker). Cached responses loggen we óók, zonder token-counts.
    //
    // TS-narrowing: omdat explanationMeta in een closure wordt geset (in de
    // withTenant-callback), kan de control-flow analyzer niet bewijzen dat
    // het na de await niet null is. We trekken daarom een lokale
    // niet-nullable kopie.
    // We casten via `as ExplanationMeta | null` om TS' "never"-narrowing te
    // ontduiken: de waarde wordt in de withTenant-callback geset en TS' CFA
    // ziet die assignment niet door de async-closure heen.
    const meta = explanationMeta as ExplanationMeta | null;
    if (meta) {
      void logAIEvent(tenantId, {
        feature: 'match_explanation',
        model: meta.model,
        provider: meta.model === 'cache' ? 'cache' : 'anthropic',
        input: JSON.stringify({ jobId, candidateId }),
        inputTokens: meta.inputTokens,
        outputTokens: meta.outputTokens,
        outputSummary: meta.text?.slice(0, 200),
        latencyMs: meta.latencyMs,
        entityType: 'match_score',
        entityId: null,
        cached: meta.cached,
        userId,
        status: meta.mocked ? 'mocked' : 'success',
      });
    }

    // Audit-event: manual recruiter-aanvragen tellen voor het compliance
    // dashboard. We schrijven via een dedicated transactie (geen
    // piggyback op de hoofd-tx — die is al gecommit).
    try {
      await withTenant(tenantId, async (client) => {
        await logAudit(
          client,
          tenantId,
          {
            action: AuditActions.MATCH_EXPLANATION_GENERATED,
            entityType: 'match_score',
            entityId: null,
            after: {
              job_id: jobId,
              candidate_id: candidateId,
              cached: explanationMeta?.cached ?? false,
              model: explanationMeta?.model ?? null,
            },
            userId,
          },
          auditCtxFromReq(req)
        );
      });
    } catch (auditErr) {
      logger.warn('[matchingController] audit-log voor match_explanation faalde', {
        error: (auditErr as Error).message,
      });
    }
  } catch (err) {
    // Failure-pad: log een ai_events-rij met status='failed' zodat we
    // zichtbaarheid hebben op AI-uitval per tenant.
    if (tenantId) {
      void logAIEvent(tenantId, {
        feature: 'match_explanation',
        model: 'claude-haiku-4-5',
        provider: 'anthropic',
        input: JSON.stringify({ jobId, candidateId }),
        latencyMs: 0,
        entityType: 'match_score',
        entityId: null,
        userId,
        status: 'failed',
        error: ((err as Error).message ?? 'unknown').slice(0, 1000),
      });
    }
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sprint Q3.3 — Similar-hires explainer endpoints (Agent ZZ)
//
// GET /api/matching/candidates/:candidateId/similar-hires?job_id=&limit=
// GET /api/matching/jobs/:jobId/similar-hires?limit=
//
// Beide retourneren `SimilarHireDetail[]` met candidate-info, job-titel,
// hire-datum, cosine-to-query en top-5 gedeelde skills. In-memory gecached
// (1 uur, zie similarHires.service).
// ─────────────────────────────────────────────────────────────────────────────

const similarHiresQuerySchema = z.object({
  job_id: z
    .string()
    .uuid({ message: 'Ongeldig job_id (verwacht UUID)' })
    .optional(),
  limit: z
    .preprocess(
      (v) => (typeof v === 'string' && v.length > 0 ? Number.parseInt(v, 10) : v),
      z.number().int().min(1).max(25).optional()
    )
    .optional(),
});

export async function getSimilarHiresForCandidateHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const candidateId = uuidSchema.parse(req.params.candidateId);
    const { job_id: jobId, limit } = similarHiresQuerySchema.parse(req.query);

    const data = await similarHiresService.getSimilarHiresForCandidate(
      req.user!.tenantId,
      candidateId,
      { jobId, limit }
    );

    res.json({
      data,
      meta: {
        scope: 'candidate',
        candidate_id: candidateId,
        job_id: jobId ?? null,
        count: data.length,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getSimilarHiresForJobHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const jobId = uuidSchema.parse(req.params.jobId);
    const { limit } = similarHiresQuerySchema.parse(req.query);

    const data = await similarHiresService.getSimilarHiresForJob(
      req.user!.tenantId,
      jobId,
      limit
    );

    res.json({
      data,
      meta: {
        scope: 'job',
        job_id: jobId,
        count: data.length,
      },
    });
  } catch (err) {
    next(err);
  }
}
