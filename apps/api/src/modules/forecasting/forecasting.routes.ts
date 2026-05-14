/**
 * Forecasting / margin reporting HTTP routes — Sprint Q4.4 (Agent UUU).
 *
 * Mount path: `/api/forecasting`.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import * as service from './forecasting.service';

const router = Router();
router.use(requireAuth, tenantMiddleware);

const revenueQuery = z.object({
  months_ahead: z.coerce.number().int().min(1).max(24).optional(),
});

router.get('/revenue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = revenueQuery.parse(req.query);
    const data = await service.getForecasts(
      req.user!.tenantId,
      q.months_ahead ?? 6
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

const marginQuery = z.object({
  group_by: z.enum(['client', 'recruiter']),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.get('/margin', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = marginQuery.parse(req.query);
    const data = await service.getMarginReport(req.user!.tenantId, q);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/recompute',
  requireRole('admin', 'owner'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await service.computeForecast(req.user!.tenantId, 6);
      res.json({ data: out });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
