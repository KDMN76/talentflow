import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as careerPagesService from './career-pages.service';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const slugSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Ongeldige slug — gebruik alleen kleine letters, cijfers en streepjes');

const configSchema = z.object({
  logo_url: z.string().url().optional(),
  primary_color: z.string().max(20).optional(),
  header_text: z.string().max(500).optional(),
  intro_text: z.string().max(2000).optional(),
  font_family: z.string().max(100).optional(),
  language: z.string().max(10).optional(),
}).catchall(z.unknown());

const createSchema = z.object({
  slug: slugSchema,
  template: z.string().min(1).max(50).default('modern'),
  config: configSchema.optional().default({}),
  language: z.string().max(10).optional(),
});

const updateSchema = z.object({
  slug: slugSchema.optional(),
  config: configSchema.optional(),
  active: z.boolean().optional(),
  template: z.string().min(1).max(50).optional(),
  language: z.string().max(10).optional(),
});

const applicationSchema = z.object({
  candidate: z.object({
    name: z.string().min(1).max(200),
    email: z.string().email('Ongeldig e-mailadres'),
    phone: z.string().max(50).optional(),
    skills: z.array(z.string()).optional(),
  }),
  job_id: z.string().uuid('job_id moet een geldige UUID zijn'),
  motivation: z.string().max(5000).optional(),
  custom_fields: z.record(z.unknown()).optional(),
});

// ─── Admin Handlers ───────────────────────────────────────────────────────────

export async function list(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const pages = await careerPagesService.listCareerPages(req.user!.tenantId);
    res.json({ data: pages });
  } catch (err) {
    next(err);
  }
}

export async function get(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const page = await careerPagesService.getCareerPage(
      req.user!.tenantId,
      req.params.id
    );
    res.json(page);
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
    const page = await careerPagesService.createCareerPage(
      req.user!.tenantId,
      req.user!.userId,
      data
    );
    res.status(201).json(page);
  } catch (err) {
    next(err);
  }
}

export async function update(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = updateSchema.parse(req.body);
    const page = await careerPagesService.updateCareerPage(
      req.user!.tenantId,
      req.params.id,
      data
    );
    res.json(page);
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
    await careerPagesService.deleteCareerPage(
      req.user!.tenantId,
      req.params.id
    );
    res.json({ message: 'Career page verwijderd' });
  } catch (err) {
    next(err);
  }
}

// ─── Public Handlers ──────────────────────────────────────────────────────────

export async function getPublic(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const page = await careerPagesService.getPublicCareerPage(req.params.slug);
    res.json(page);
  } catch (err) {
    next(err);
  }
}

export async function submitApplication(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = applicationSchema.parse(req.body);
    const result = await careerPagesService.submitApplication(
      req.params.slug,
      data
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}
