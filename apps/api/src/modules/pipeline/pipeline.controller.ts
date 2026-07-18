import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as pipelineService from './pipeline.service';
import { auditCtxFromReq } from '../../lib/audit';

const createStageSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  position: z.number().int().min(1).optional(),
});

const updateStageSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  position: z.number().int().min(1).optional(),
});

const addApplicationSchema = z.object({
  job_id: z.string().uuid(),
  candidate_id: z.string().uuid(),
  stage_id: z.string().uuid().optional(),
});

const updateApplicationSchema = z.object({
  stage_id: z.string().uuid().optional().nullable(),
  status: z.enum(['active', 'rejected', 'withdrawn', 'hired']).optional(),
});

export async function getStagesForJob(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stages = await pipelineService.getStagesForJob(req.user!.tenantId, req.params.jobId);
    res.json({ data: stages });
  } catch (err) {
    next(err);
  }
}

export async function createStage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createStageSchema.parse(req.body);
    const stage = await pipelineService.createStage(req.user!.tenantId, req.params.jobId, data);
    res.status(201).json(stage);
  } catch (err) {
    next(err);
  }
}

export async function updateStage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = updateStageSchema.parse(req.body);
    const stage = await pipelineService.updateStage(req.user!.tenantId, req.params.stageId, data);
    res.json(stage);
  } catch (err) {
    next(err);
  }
}

export async function deleteStage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await pipelineService.deleteStage(
      req.user!.tenantId,
      req.params.stageId,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json({ message: 'Pipelinefase verwijderd' });
  } catch (err) {
    next(err);
  }
}

export async function getApplicationsForJob(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await pipelineService.getApplicationsForJob(req.user!.tenantId, req.params.jobId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function addToPipeline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = addApplicationSchema.parse(req.body);
    const application = await pipelineService.addToPipeline(req.user!.tenantId, req.user!.userId, data);
    res.status(201).json(application);
  } catch (err) {
    next(err);
  }
}

export async function updateApplication(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = updateApplicationSchema.parse(req.body);
    const application = await pipelineService.updateApplication(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      data,
      auditCtxFromReq(req)
    );
    res.json(application);
  } catch (err) {
    next(err);
  }
}

export async function removeApplication(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await pipelineService.removeApplication(req.user!.tenantId, req.params.id, req.user!.userId);
    res.json({ message: 'Sollicitatie verwijderd uit pipeline' });
  } catch (err) {
    next(err);
  }
}
