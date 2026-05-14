import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as service from './savedSearches.service';
import { auditCtxFromReq } from '../../lib/audit';

const entitySchema = z.enum(['candidates', 'jobs']);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  query_text: z.string().min(1).max(4000),
  filters: z.record(z.unknown()).optional(),
  entity_type: entitySchema,
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  query_text: z.string().min(1).max(4000).optional(),
  filters: z.record(z.unknown()).optional(),
  entity_type: entitySchema.optional(),
});

const listSchema = z.object({
  entity_type: entitySchema.optional(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { entity_type } = listSchema.parse(req.query);
    const rows = await service.listSavedSearches(
      req.user!.tenantId,
      req.user!.userId,
      entity_type
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const row = await service.getSavedSearch(
      req.user!.tenantId,
      req.user!.userId,
      req.params.id
    );
    res.json(row);
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createSchema.parse(req.body);
    const row = await service.createSavedSearch(
      req.user!.tenantId,
      req.user!.userId,
      data,
      auditCtxFromReq(req)
    );
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = updateSchema.parse(req.body);
    const row = await service.updateSavedSearch(
      req.user!.tenantId,
      req.user!.userId,
      req.params.id,
      data
    );
    res.json(row);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.deleteSavedSearch(
      req.user!.tenantId,
      req.user!.userId,
      req.params.id,
      auditCtxFromReq(req)
    );
    res.json({ message: 'Opgeslagen zoekopdracht verwijderd' });
  } catch (err) {
    next(err);
  }
}
