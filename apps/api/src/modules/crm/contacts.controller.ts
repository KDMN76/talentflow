import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as contactsService from './contacts.service';

const listQuerySchema = z.object({
  organization_id: z.string().uuid().optional(),
});

const createContactSchema = z.object({
  organization_id: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(200),
  email: z.string().email().optional().or(z.literal('')).transform(v => v || undefined).nullable(),
  phone: z.string().max(50).optional().nullable(),
  role: z.string().max(150).optional().nullable(),
  linkedin_url: z.string().max(500).optional().nullable(),
  notes: z.string().optional().nullable(),
});

const updateContactSchema = z.object({
  organization_id: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional().or(z.literal('')).transform(v => v || undefined).nullable(),
  phone: z.string().max(50).optional().nullable(),
  role: z.string().max(150).optional().nullable(),
  linkedin_url: z.string().max(500).optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function listContacts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { organization_id } = listQuerySchema.parse(req.query);
    const result = await contactsService.listContacts(req.user!.tenantId, organization_id);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function createContact(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createContactSchema.parse(req.body);
    const contact = await contactsService.createContact(
      req.user!.tenantId,
      req.user!.userId,
      data
    );
    res.status(201).json(contact);
  } catch (err) {
    next(err);
  }
}

export async function getContact(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const contact = await contactsService.getContact(req.user!.tenantId, req.params.id);
    res.json(contact);
  } catch (err) {
    next(err);
  }
}

export async function updateContact(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = updateContactSchema.parse(req.body);
    const contact = await contactsService.updateContact(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      data
    );
    res.json(contact);
  } catch (err) {
    next(err);
  }
}

export async function deleteContact(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await contactsService.deleteContact(req.user!.tenantId, req.params.id);
    res.json({ message: 'Contactpersoon verwijderd' });
  } catch (err) {
    next(err);
  }
}
