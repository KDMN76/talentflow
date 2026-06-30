import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as dashboardService from './dashboard.service';

export async function getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stats = await dashboardService.getDashboardStats(req.user!.tenantId);
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

const activityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export async function getActivity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit } = activityQuerySchema.parse(req.query);
    const result = await dashboardService.listActivities(req.user!.tenantId, { page, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function exportActivity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await dashboardService.exportActivities(req.user!.tenantId);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}
