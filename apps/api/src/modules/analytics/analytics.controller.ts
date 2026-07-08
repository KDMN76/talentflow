import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as analyticsService from './analytics.service';

// Gedeelde query-filters voor alle analytiek-endpoints (periode + recruiter).
const filterSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  recruiter_id: z.string().uuid().optional(),
});

function parseFilters(req: Request): analyticsService.AnalyticsFilters {
  const q = filterSchema.parse(req.query);
  return {
    from: q.from ?? null,
    to: q.to ?? null,
    recruiterId: q.recruiter_id ?? null,
  };
}

export async function getOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await analyticsService.getOverview(req.user!.tenantId, parseFilters(req));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getFunnel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await analyticsService.getFunnel(req.user!.tenantId, parseFilters(req));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getRecruiterStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await analyticsService.getRecruiterStats(req.user!.tenantId, parseFilters(req));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getSourceBreakdown(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await analyticsService.getSourceBreakdown(req.user!.tenantId, parseFilters(req));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getTimeToHireTrend(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await analyticsService.getTimeToHireTrend(req.user!.tenantId, parseFilters(req));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getApplicationsTrend(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await analyticsService.getApplicationsTrend(req.user!.tenantId, parseFilters(req));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ─── AI & Bias — Sprint Q4.6 ─────────────────────────────────────────────────

export async function getAdverseImpact(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await analyticsService.getAdverseImpact(req.user!.tenantId, parseFilters(req));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getAiUsageTrend(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await analyticsService.getAiUsageTrend(req.user!.tenantId, parseFilters(req));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getMatchScoreDistribution(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await analyticsService.getMatchScoreDistribution(req.user!.tenantId, parseFilters(req));
    res.json(result);
  } catch (err) {
    next(err);
  }
}
