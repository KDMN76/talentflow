import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as portalService from './portal.service';
import { AppError } from '../../middleware/errorHandler';

// ─────────────────────────────────────────────────────────────────────────────
// Validation schemas
// ─────────────────────────────────────────────────────────────────────────────

const permissionsSchema = z
  .object({
    view: z.boolean().optional(),
    comment: z.boolean().optional(),
    approve: z.boolean().optional(),
    reject: z.boolean().optional(),
  })
  .optional();

const createSchema = z.object({
  job_id: z.string().uuid(),
  client_name: z.string().min(1).max(200).optional(),
  permissions: permissionsSchema,
  expires_at: z.string().datetime().optional(),
});

const submitFeedbackSchema = z.object({
  application_id: z.string().uuid(),
  action: z.enum(['approved', 'rejected', 'commented']),
  comment: z.string().max(2000).optional(),
  client_name: z.string().min(1).max(200).optional(),
});

const jobIdQuerySchema = z.object({
  job_id: z.string().uuid().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin handlers
// ─────────────────────────────────────────────────────────────────────────────

export async function listForTenant(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const links = await portalService.listPortalLinksForTenant(req.user!.tenantId);
    res.json({ data: links });
  } catch (err) {
    next(err);
  }
}

export async function listForJob(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Job id can come from a path param (/by-job/:jobId) or query (?job_id=)
    const jobIdFromParam = req.params.jobId;
    const { job_id: jobIdFromQuery } = jobIdQuerySchema.parse(req.query);
    const jobId = jobIdFromParam ?? jobIdFromQuery;

    if (!jobId) {
      throw new AppError(400, 'MISSING_JOB_ID', 'job_id is verplicht');
    }

    const links = await portalService.listPortalLinksForJob(req.user!.tenantId, jobId);
    res.json({ data: links });
  } catch (err) {
    next(err);
  }
}

export async function create(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = createSchema.parse(req.body);
    const link = await portalService.createPortalLink(
      req.user!.tenantId,
      req.user!.userId,
      data
    );
    res.status(201).json(link);
  } catch (err) {
    next(err);
  }
}

export async function remove(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await portalService.deletePortalLink(req.user!.tenantId, req.params.id);
    res.json({ message: 'Portal-link verwijderd' });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public (token-based) handlers
// ─────────────────────────────────────────────────────────────────────────────

export async function getAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.params.token;
    if (!token) {
      throw new AppError(400, 'MISSING_TOKEN', 'Token is verplicht');
    }
    const access = await portalService.getPortalAccess(token);
    res.json(access);
  } catch (err) {
    next(err);
  }
}

export async function submitFeedback(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.params.token;
    if (!token) {
      throw new AppError(400, 'MISSING_TOKEN', 'Token is verplicht');
    }
    const data = submitFeedbackSchema.parse(req.body);
    const feedback = await portalService.submitPortalFeedback(token, data);
    res.status(201).json(feedback);
  } catch (err) {
    next(err);
  }
}
