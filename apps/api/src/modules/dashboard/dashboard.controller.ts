import { Request, Response, NextFunction } from 'express';
import * as dashboardService from './dashboard.service';

export async function getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stats = await dashboardService.getDashboardStats(req.user!.tenantId);
    res.json(stats);
  } catch (err) {
    next(err);
  }
}
