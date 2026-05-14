import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as service from './scorecards.service';
import { auditCtxFromReq } from '../../lib/audit';

const recommendationSchema = z.enum(['strong_yes', 'yes', 'neutral', 'no', 'strong_no']);

const criterionScoreSchema = z.object({
  criterion: z.string().min(1).max(200),
  score: z.number().min(0).max(10),
  comment: z.string().max(2000).optional(),
});

const createOrUpdateSchema = z.object({
  stage_id: z.string().uuid().optional().nullable(),
  overall_score: z.number().min(1).max(5).optional(),
  recommendation: recommendationSchema.optional(),
  notes: z.string().max(20000).optional(),
  criteria_scores: z.array(criterionScoreSchema).optional(),
  submit: z.boolean().optional(),
});

const criterionDefinitionSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  weight: z.number().min(0).max(100).optional(),
});

const createTemplateSchema = z.object({
  name: z.string().min(1).max(120),
  criteria: z.array(criterionDefinitionSchema).min(1),
  applies_to_job_id: z.string().uuid().nullable().optional(),
  applies_to_stage_id: z.string().uuid().nullable().optional(),
  is_default: z.boolean().optional(),
});

const listTemplatesQuerySchema = z.object({
  job_id: z.string().uuid().optional(),
  stage_id: z.string().uuid().optional(),
});

// ─── Application-level (mounted at /applications/:id/scorecards) ────────────

export async function listForApplication(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await service.listScorecardsForApplication(req.user!.tenantId, req.params.id);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

export async function createForApplication(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createOrUpdateSchema.parse(req.body);
    const card = await service.createOrUpdateScorecard(
      req.user!.tenantId,
      req.user!.userId,
      req.params.id,
      data.stage_id ?? null,
      {
        overall_score: data.overall_score,
        recommendation: data.recommendation,
        notes: data.notes,
        criteria_scores: data.criteria_scores,
        submit: data.submit,
      },
      auditCtxFromReq(req)
    );
    res.status(201).json(card);
  } catch (err) {
    next(err);
  }
}

// ─── Single scorecard (/scorecards/:id) ─────────────────────────────────────

export async function getOne(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const card = await service.getScorecard(req.user!.tenantId, req.params.id);
    res.json(card);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.deleteScorecard(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json({ message: 'Scorecard verwijderd' });
  } catch (err) {
    next(err);
  }
}

// ─── Templates (/scorecards/templates) ──────────────────────────────────────

export async function listTemplates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { job_id, stage_id } = listTemplatesQuerySchema.parse(req.query);
    const rows = await service.listTemplates(req.user!.tenantId, job_id, stage_id);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

export async function getTemplateOne(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tmpl = await service.getTemplate(req.user!.tenantId, req.params.id);
    res.json(tmpl);
  } catch (err) {
    next(err);
  }
}

export async function createTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createTemplateSchema.parse(req.body);
    const tmpl = await service.createTemplate(
      req.user!.tenantId,
      req.user!.userId,
      data,
      auditCtxFromReq(req)
    );
    res.status(201).json(tmpl);
  } catch (err) {
    next(err);
  }
}
