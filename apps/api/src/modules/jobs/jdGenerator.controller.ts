/**
 * JD Generator controller — Sprint Q3.2.
 *
 * REST endpoints voor de AI vacaturetekst-generator:
 *   POST   /api/jobs/jd-drafts                    body: JdGeneratorInput
 *   GET    /api/jobs/jd-drafts                    query: ?status=&user_id=
 *   GET    /api/jobs/jd-drafts/:id
 *   POST   /api/jobs/jd-drafts/:id/select-variant body: { variant_id }
 *   POST   /api/jobs/jd-drafts/:id/regenerate     body: { variant_id }
 *   POST   /api/jobs/jd-drafts/:id/publish        body: { overrides? }
 *   DELETE /api/jobs/jd-drafts/:id
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { auditCtxFromReq } from '../../lib/audit';
import * as jdService from './jdGenerator.service';
import { jdGeneratorInputSchema } from './jdGenerator.service';

const uuidSchema = z.string().uuid({ message: 'Ongeldig id-formaat (UUID)' });

const variantIdSchema = z.object({
  variant_id: z.string().uuid({ message: 'variant_id moet UUID zijn' }),
});

const listFiltersSchema = z.object({
  status: z.enum(['draft', 'published', 'discarded']).optional(),
  user_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const publishOverridesSchema = z
  .object({
    // De wizard laat de recruiter titel + tekst van de gekozen variant
    // bijschaven vóór publicatie — zonder deze twee velden bounce't de
    // `.strict()`-check elke publish uit de UI met een Zod-400.
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(50000).optional(),
    status: z.enum(['draft', 'open', 'filled', 'closed', 'archived']).optional(),
    employment_type: z
      .enum(['fulltime', 'parttime', 'contract', 'freelance', 'internship'])
      .optional(),
    department: z.string().max(100).nullable().optional(),
    location: z.string().max(200).nullable().optional(),
    salary_min: z.number().int().min(0).nullable().optional(),
    salary_max: z.number().int().min(0).nullable().optional(),
    job_reference: z.string().min(1).max(50).nullable().optional(),
    recruiter_id: z.string().uuid().nullable().optional(),
    headcount: z.number().int().min(1).max(999).nullable().optional(),
    experience_level: z.enum(['junior', 'medior', 'senior', 'lead']).nullable().optional(),
    contract_type: z.enum(['fulltime', 'parttime', 'contract', 'temp']).nullable().optional(),
    contract_details: z.string().max(2000).nullable().optional(),
    open_date: z.string().nullable().optional(),
    close_date: z.string().nullable().optional(),
    industry: z.string().max(120).nullable().optional(),
    remote_type: z.enum(['onsite', 'hybrid', 'remote']).nullable().optional(),
    office_address: z.string().max(500).nullable().optional(),
    package_details: z.string().max(2000).nullable().optional(),
    currency: z.string().min(2).max(8).nullable().optional(),
    salary_frequency: z.enum(['monthly', 'annual', 'hourly']).nullable().optional(),
    required_skills: z.array(z.string().min(1).max(120)).max(50).nullable().optional(),
    nice_to_have_skills: z.array(z.string().min(1).max(120)).max(50).nullable().optional(),
    // Pay Transparency (EU 2023/970) — beloningscriteria + per-job opt-out.
    pay_transparency_required: z.boolean().nullable().optional(),
    compensation_criteria: z.string().max(2000).nullable().optional(),
    pipeline_template_id: z.string().uuid().optional(),
  })
  .strict();

const publishBodySchema = z.object({
  overrides: publishOverridesSchema.optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

export async function createDraft(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = jdGeneratorInputSchema.parse(req.body);
    const draft = await jdService.createJdDraft(
      req.user!.tenantId,
      req.user!.userId,
      input,
      auditCtxFromReq(req)
    );
    res.status(201).json(draft);
  } catch (err) {
    next(err);
  }
}

export async function listDrafts(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { status, user_id, limit } = listFiltersSchema.parse(req.query);
    const drafts = await jdService.listJdDrafts(req.user!.tenantId, {
      status,
      userId: user_id,
      limit,
    });
    res.json({ data: drafts, meta: { count: drafts.length } });
  } catch (err) {
    next(err);
  }
}

export async function getDraft(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = uuidSchema.parse(req.params.id);
    const draft = await jdService.getJdDraft(req.user!.tenantId, id);
    res.json(draft);
  } catch (err) {
    next(err);
  }
}

export async function selectVariant(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = uuidSchema.parse(req.params.id);
    const { variant_id } = variantIdSchema.parse(req.body);
    const draft = await jdService.selectVariant(
      req.user!.tenantId,
      id,
      variant_id,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json(draft);
  } catch (err) {
    next(err);
  }
}

export async function regenerateVariant(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = uuidSchema.parse(req.params.id);
    const { variant_id } = variantIdSchema.parse(req.body);
    const draft = await jdService.regenerateVariant(
      req.user!.tenantId,
      id,
      variant_id,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json(draft);
  } catch (err) {
    next(err);
  }
}

export async function publishDraft(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = uuidSchema.parse(req.params.id);
    const body = publishBodySchema.parse(req.body ?? {});
    const result = await jdService.publishJdDraft(
      req.user!.tenantId,
      id,
      req.user!.userId,
      (body.overrides ?? {}) as jdService.JobOverrides,
      auditCtxFromReq(req)
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function discardDraft(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = uuidSchema.parse(req.params.id);
    await jdService.discardJdDraft(
      req.user!.tenantId,
      id,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json({ message: 'JD-draft weggegooid' });
  } catch (err) {
    next(err);
  }
}
