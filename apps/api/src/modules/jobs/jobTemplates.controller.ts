import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as service from './jobTemplates.service';
import { auditCtxFromReq } from '../../lib/audit';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  job_data: z.record(z.unknown()).default({}),
});

const instantiateSchema = z.object({
  overrides: z.record(z.unknown()).optional(),
});

const duplicateSchema = z.object({
  overrides: z.record(z.unknown()).optional(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await service.listJobTemplates(req.user!.tenantId);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tmpl = await service.getJobTemplate(req.user!.tenantId, req.params.id);
    res.json(tmpl);
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createSchema.parse(req.body);
    const tmpl = await service.createJobTemplate(
      req.user!.tenantId,
      req.user!.userId,
      data.name,
      data.job_data,
      data.description ?? null,
      auditCtxFromReq(req)
    );
    res.status(201).json(tmpl);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.deleteJobTemplate(
      req.user!.tenantId,
      req.user!.userId,
      req.params.id,
      auditCtxFromReq(req)
    );
    res.json({ message: 'Job-template verwijderd' });
  } catch (err) {
    next(err);
  }
}

export async function instantiate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { overrides } = instantiateSchema.parse(req.body ?? {});
    const job = await service.instantiateFromTemplate(
      req.user!.tenantId,
      req.user!.userId,
      req.params.id,
      overrides ?? {},
      auditCtxFromReq(req)
    );
    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
}

/**
 * Wrapper for the new template-based duplicate path. The legacy
 * `jobsController.duplicateJob` (Slice 4.5) uses jobsService.duplicateJob.
 * This controller provides POST /jobs/:id/duplicate-via-template which is
 * what the new UI calls; legacy is kept for backwards compat.
 */
export async function duplicateViaTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { overrides } = duplicateSchema.parse(req.body ?? {});
    const job = await service.duplicateJob(
      req.user!.tenantId,
      req.user!.userId,
      req.params.id,
      overrides ?? {},
      auditCtxFromReq(req)
    );
    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
}
