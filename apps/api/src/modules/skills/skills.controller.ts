/**
 * Skills controllers — Sprint Q3.6 (Agent HHH).
 *
 * Drie routers worden in skills.router.ts geëxporteerd:
 *   - skillsRouter        → /api/skills/*
 *   - candidatesSkillsRouter → /api/candidates/:id/skill-profile + /sync-esco
 *   - jobsSkillsRouter    → /api/jobs/:id/skill-profile + /sync-esco + /candidates/:cid/skills-gap
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as skillsService from './skills.service';
import * as trendingService from './trending.service';
import { auditCtxFromReq } from '../../lib/audit';

// ────────────────────────────────────────────────────────────────────────────
// ESCO search: GET /api/skills/esco
// ────────────────────────────────────────────────────────────────────────────

const escoSearchQuery = z.object({
  q: z.string().max(120).optional(),
  category: z.string().max(120).optional(),
  skill_type: z
    .enum(['skill', 'knowledge', 'language', 'transversal'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export async function searchEsco(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const q = escoSearchQuery.parse(req.query);
    const data = await skillsService.searchEscoSkills(q);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Candidate skill profile + sync
// ────────────────────────────────────────────────────────────────────────────

export async function getCandidateProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const profile = await skillsService.getCandidateSkillProfile(
      req.user!.tenantId,
      req.params.id
    );
    res.json(profile);
  } catch (err) {
    next(err);
  }
}

export async function syncCandidateEsco(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await skillsService.syncCandidateSkillsToEsco(
      req.user!.tenantId,
      req.params.id
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// PATCH /api/candidates/:id/skill-profile — vervangt het skill-profiel met de
// door de editor aangeleverde lijst. Zod valideert de shape; extra velden uit
// de frontend (id, esco_uri, category) worden stilzwijgend gestript.
export const updateCandidateProfileBody = z.object({
  skills: z
    .array(
      z.object({
        esco_id: z.string().min(1),
        preferred_label: z.string().min(1).max(500),
        proficiency: z.number().int().min(1).max(10),
        confidence: z.number().min(0).max(1),
        source: z
          .enum(['ai_extracted', 'manual', 'esco_match', 'embedding_match'])
          .optional(),
      })
    )
    .max(500),
});

export async function updateCandidateProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = updateCandidateProfileBody.parse(req.body);
    const profile = await skillsService.updateCandidateSkillProfile(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      body.skills,
      auditCtxFromReq(req)
    );
    res.json(profile);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Job skill profile + sync + skills-gap
// ────────────────────────────────────────────────────────────────────────────

export async function getJobProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const profile = await skillsService.getJobSkillProfile(
      req.user!.tenantId,
      req.params.id
    );
    res.json(profile);
  } catch (err) {
    next(err);
  }
}

export async function syncJobEsco(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await skillsService.syncJobSkillsToEsco(
      req.user!.tenantId,
      req.params.id
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getSkillsGap(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await skillsService.analyzeSkillsGap(
      req.user!.tenantId,
      req.params.id,        // job id
      req.params.cid        // candidate id
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Trending + demand-supply
// ────────────────────────────────────────────────────────────────────────────

const trendingQuery = z.object({
  category: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export async function getTrending(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const q = trendingQuery.parse(req.query);
    const data = await trendingService.getTrendingSkills(req.user!.tenantId, q);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function getDemandSupply(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await trendingService.getSkillDemandSupply(
      req.user!.tenantId
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}
