import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as organizationsService from './organizations.service';

const listQuerySchema = z.object({
  search: z.string().optional(),
  type: z.enum(['client', 'prospect', 'partner']).optional(),
});

const createOrganizationSchema = z.object({
  name: z.string().min(1).max(200),
  industry: z.string().max(200).optional().nullable(),
  website: z.string().max(500).optional().nullable(),
  notes: z.string().optional().nullable(),
  type: z.enum(['client', 'prospect', 'partner']).optional(),
});

const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  industry: z.string().max(200).optional().nullable(),
  website: z.string().max(500).optional().nullable(),
  notes: z.string().optional().nullable(),
  type: z.enum(['client', 'prospect', 'partner']).optional(),
});

export async function listOrganizations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filter = listQuerySchema.parse(req.query);
    const result = await organizationsService.listOrganizations(req.user!.tenantId, filter);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function createOrganization(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createOrganizationSchema.parse(req.body);
    const org = await organizationsService.createOrganization(
      req.user!.tenantId,
      req.user!.userId,
      data
    );
    res.status(201).json(org);
  } catch (err) {
    next(err);
  }
}

export async function getOrganization(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const org = await organizationsService.getOrganization(req.user!.tenantId, req.params.id);
    res.json(org);
  } catch (err) {
    next(err);
  }
}

export async function updateOrganization(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = updateOrganizationSchema.parse(req.body);
    const org = await organizationsService.updateOrganization(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      data
    );
    res.json(org);
  } catch (err) {
    next(err);
  }
}

export async function deleteOrganization(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await organizationsService.deleteOrganization(req.user!.tenantId, req.params.id);
    res.json({ message: 'Organisatie verwijderd' });
  } catch (err) {
    next(err);
  }
}
