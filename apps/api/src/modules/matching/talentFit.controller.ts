/**
 * Talent-Fit controller — Sprint Q3.3.
 *
 * Endpoints:
 *   POST /api/matching/talent-fit/train                   (admin)
 *   GET  /api/matching/talent-fit/model
 *   GET  /api/matching/talent-fit/predict?job_id=&candidate_id=
 *   GET  /api/matching/talent-fit/jobs/:jobId/ranked
 *
 * Alle endpoints achter requireAuth + tenantMiddleware (router-niveau).
 * Train staat ook achter requireRole('admin','owner').
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import { AppError } from '../../middleware/errorHandler';
import { AI_MATCH_DISCLOSURE_NL } from '../../lib/aiDisclosure';
import * as talentFitService from './talentFit.service';

const uuidSchema = z.string().uuid({ message: 'Ongeldig id-formaat (UUID)' });

const predictQuerySchema = z.object({
  job_id: z.string().uuid(),
  candidate_id: z.string().uuid(),
  use_cache: z
    .preprocess((v) => {
      if (v === undefined || v === null) return undefined;
      const s = String(v).toLowerCase();
      if (s === 'true' || s === '1') return true;
      if (s === 'false' || s === '0') return false;
      return v;
    }, z.boolean().optional())
    .optional(),
});

const rankedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/matching/talent-fit/train
// ─────────────────────────────────────────────────────────────────────────────

export async function trainHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.userId ?? null;
    const triggeredBy = userId ? `user:${userId}` : 'manual';
    const model = await talentFitService.trainTalentFitModel(tenantId, triggeredBy);
    res.json({
      data: {
        id: model.id,
        trained_on: model.trained_on,
        hires: model.hires,
        rejects: model.rejects,
        precision_at_1: model.precision_at_1,
        recall_at_10: model.recall_at_10,
        auc: model.auc,
        feature_names: model.feature_names,
        trained_at: model.trained_at,
        trained_by: model.trained_by,
        active: model.active,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/matching/talent-fit/model
// ─────────────────────────────────────────────────────────────────────────────

export async function getModelHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const active = await talentFitService.getActiveModel(tenantId);
    if (!active) {
      res.json({ data: null });
      return;
    }
    const r = active.row;
    res.json({
      data: {
        id: r.id,
        feature_names: r.feature_names,
        trained_on: r.trained_on,
        hires: r.hires,
        rejects: r.rejects,
        precision_at_1: r.precision_at_1,
        recall_at_10: r.recall_at_10,
        auc: r.auc,
        trained_at: r.trained_at,
        trained_by: r.trained_by,
        active: r.active,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/matching/talent-fit/predict?job_id=&candidate_id=
// ─────────────────────────────────────────────────────────────────────────────

export async function predictHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = predictQuerySchema.parse(req.query);
    const tenantId = req.user!.tenantId;
    const result = await talentFitService.predictForCandidateJob(
      tenantId,
      parsed.job_id,
      parsed.candidate_id,
      { use_cache: parsed.use_cache }
    );
    res.json({
      data: {
        fit_score: result.fit_score,
        combined_score: result.combined_score,
        cosine_score: result.cosine_sim,
        match_percent: Math.round(result.combined_score * 100),
        features: result.features,
        similar_hires: result.similar_hires,
        has_active_model: result.has_active_model,
        model_id: result.model_id,
      },
      ai_disclosure: AI_MATCH_DISCLOSURE_NL,
    });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/matching/talent-fit/jobs/:jobId/ranked
// ─────────────────────────────────────────────────────────────────────────────

export async function rankedHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const jobId = uuidSchema.parse(req.params.jobId);
    const { limit } = rankedQuerySchema.parse(req.query);
    const tenantId = req.user!.tenantId;
    const data = await talentFitService.getRankedCandidatesForJob(
      tenantId,
      jobId,
      limit ?? 20
    );
    res.json({
      data,
      meta: {
        count: data.length,
        limit: limit ?? 20,
        has_active_model: data[0]?.has_active_model ?? false,
      },
      ai_disclosure: AI_MATCH_DISCLOSURE_NL,
    });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(err);
  }
}
