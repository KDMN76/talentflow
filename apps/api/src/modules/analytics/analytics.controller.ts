import { Request, Response, NextFunction } from 'express';
import * as analyticsService from './analytics.service';

export async function getOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await analyticsService.getOverview(req.user!.tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getFunnel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await analyticsService.getFunnel(req.user!.tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getRecruiterStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await analyticsService.getRecruiterStats(req.user!.tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getSourceBreakdown(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await analyticsService.getSourceBreakdown(req.user!.tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getTimeToHireTrend(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await analyticsService.getTimeToHireTrend(req.user!.tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getApplicationsTrend(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await analyticsService.getApplicationsTrend(req.user!.tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
