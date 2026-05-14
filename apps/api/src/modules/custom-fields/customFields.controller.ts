import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as service from './customFields.service';
import { auditCtxFromReq } from '../../lib/audit';

const entitySchema = z.enum(['candidate', 'job', 'application']);
const fieldTypeSchema = z.enum([
  'text',
  'number',
  'date',
  'dropdown',
  'multiselect',
  'boolean',
]);

const optionSchema = z.object({
  value: z.string().min(1).max(120),
  label: z.string().min(1).max(200),
});

const createSchema = z.object({
  entity_type: entitySchema,
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  field_type: fieldTypeSchema,
  options: z.array(optionSchema).optional(),
  required: z.boolean().optional(),
  position: z.number().int().min(0).max(9999).optional(),
});

const updateSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  field_type: fieldTypeSchema.optional(),
  options: z.array(optionSchema).optional(),
  required: z.boolean().optional(),
  position: z.number().int().min(0).max(9999).optional(),
});

const listQuerySchema = z.object({
  entity_type: entitySchema.optional(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { entity_type } = listQuerySchema.parse(req.query);
    const rows = await service.listFields(req.user!.tenantId, entity_type);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const row = await service.getField(req.user!.tenantId, req.params.id);
    res.json(row);
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createSchema.parse(req.body);
    const row = await service.createField(
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
    const row = await service.updateField(
      req.user!.tenantId,
      req.user!.userId,
      req.params.id,
      data,
      auditCtxFromReq(req)
    );
    res.json(row);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.deleteField(
      req.user!.tenantId,
      req.user!.userId,
      req.params.id,
      auditCtxFromReq(req)
    );
    res.json({ message: 'Custom field verwijderd' });
  } catch (err) {
    next(err);
  }
}
