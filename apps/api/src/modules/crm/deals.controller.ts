import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as dealsService from './deals.service';

const stageEnum = z.enum(['prospect', 'offerte', 'onderhandeling', 'gewonnen', 'verloren']);

const listQuerySchema = z.object({
  stage: stageEnum.optional(),
  organization_id: z.string().uuid().optional(),
  recruiter_id: z.string().uuid().optional(),
  job_id: z.string().uuid().optional(),
});

const createDealSchema = z.object({
  organization_id: z.string().uuid().optional().nullable(),
  job_id: z.string().uuid().optional().nullable(),
  recruiter_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(200),
  stage: stageEnum.optional(),
  value_eur: z.number().int().min(0).optional().nullable(),
  expected_close_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const updateDealSchema = z.object({
  organization_id: z.string().uuid().optional().nullable(),
  job_id: z.string().uuid().optional().nullable(),
  recruiter_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(200).optional(),
  stage: stageEnum.optional(),
  value_eur: z.number().int().min(0).optional().nullable(),
  expected_close_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const moveStageSchema = z.object({
  stage: stageEnum,
});

export async function listDeals(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filter = listQuerySchema.parse(req.query);
    const result = await dealsService.listDeals(req.user!.tenantId, filter);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function createDeal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createDealSchema.parse(req.body);
    const deal = await dealsService.createDeal(req.user!.tenantId, req.user!.userId, data);
    res.status(201).json(deal);
  } catch (err) {
    next(err);
  }
}

export async function getDeal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const deal = await dealsService.getDeal(req.user!.tenantId, req.params.id);
    res.json(deal);
  } catch (err) {
    next(err);
  }
}

export async function updateDeal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = updateDealSchema.parse(req.body);
    const deal = await dealsService.updateDeal(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      data
    );
    res.json(deal);
  } catch (err) {
    next(err);
  }
}

export async function deleteDeal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await dealsService.deleteDeal(req.user!.tenantId, req.params.id);
    res.json({ message: 'Deal verwijderd' });
  } catch (err) {
    next(err);
  }
}

export async function moveDealStage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { stage } = moveStageSchema.parse(req.body);
    const deal = await dealsService.moveDealStage(req.user!.tenantId, req.params.id, stage);
    res.json(deal);
  } catch (err) {
    next(err);
  }
}

export async function getDealsPipeline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const board = await dealsService.getDealsPipeline(req.user!.tenantId);
    res.json({ data: board });
  } catch (err) {
    next(err);
  }
}
