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

// Gedeelde filter-velden voor list + export.
const activityFilterSchema = z.object({
  user_id: z.string().uuid().optional(),
  entity_type: z.string().max(50).optional(),
  action: z.string().max(100).optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const activityQuerySchema = activityFilterSchema.extend({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});

/** Mapt de query-filters naar de service-ActivityFilters shape. */
function toActivityFilters(q: z.infer<typeof activityFilterSchema>) {
  return {
    userId: q.user_id,
    entityType: q.entity_type,
    action: q.action,
    dateFrom: q.date_from,
    dateTo: q.date_to,
  };
}

export async function getActivity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = activityQuerySchema.parse(req.query);
    const result = await dashboardService.listActivities(req.user!.tenantId, {
      page: q.page,
      limit: q.limit,
      ...toActivityFilters(q),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function exportActivity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = activityFilterSchema.parse(req.query);
    const rows = await dashboardService.exportActivities(
      req.user!.tenantId,
      toActivityFilters(q)
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}
