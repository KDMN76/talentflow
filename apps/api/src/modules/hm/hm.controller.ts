import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as hmService from './hm.service';

const reviewSchema = z.object({
  decision: z.enum(['approve', 'reject', 'later']),
  notes: z.string().max(5000).optional(),
});

export async function getDashboard(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await hmService.getMyDashboard(req.user!.tenantId, req.user!.userId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getMyJobs(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const jobs = await hmService.getMyJobs(req.user!.tenantId, req.user!.userId);
    res.json({ data: jobs });
  } catch (err) {
    next(err);
  }
}

export async function getPendingReviews(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const reviews = await hmService.getPendingReviews(
      req.user!.tenantId,
      req.user!.userId
    );
    res.json({ data: reviews });
  } catch (err) {
    next(err);
  }
}

export async function getStats(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const stats = await hmService.getStats(req.user!.tenantId, req.user!.userId);
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

export async function getScorecardDeadlines(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const deadlines = await hmService.getScorecardDeadlines(
      req.user!.tenantId,
      req.user!.userId
    );
    res.json({ data: deadlines });
  } catch (err) {
    next(err);
  }
}

export async function getApplicationDetails(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const details = await hmService.getApplicationDetails(
      req.user!.tenantId,
      req.user!.userId,
      req.params.id
    );
    res.json(details);
  } catch (err) {
    next(err);
  }
}

export async function review(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = reviewSchema.parse(req.body);
    const updated = await hmService.reviewApplication(
      req.user!.tenantId,
      req.user!.userId,
      req.params.id,
      body.decision,
      body.notes
    );
    res.json(updated);
  } catch (err) {
    next(err);
  }
}
