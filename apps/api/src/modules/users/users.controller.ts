import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as usersService from './users.service';

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(['admin', 'recruiter', 'hiring_manager', 'viewer']),
});

// Valideer het :id-pad-param expliciet vóór de query — een niet-UUID zou anders
// als Postgres 22P02 doorslaan. ZodError → 400 via de centrale error-handler.
const idSchema = z.string().uuid();

const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(['admin', 'recruiter', 'hiring_manager', 'viewer']).optional(),
  avatar_url: z.string().url().optional().nullable(),
});

const updateMeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatar_url: z.string().url().optional().nullable(),
  password: z.string().min(8).optional(),
  // Alleen relevant wanneer `password` wordt gezet: het huidige wachtwoord wordt
  // dan geverifieerd voor de wijziging (zie users.service.updateMe). Optioneel
  // zodat andere self-updates (naam, taal, avatar) ongewijzigd blijven werken.
  current_password: z.string().optional(),
  // UI-taalvoorkeur: BCP-47-achtig ('nl', 'en', 'en-GB'). Bewust geen enum van
  // ondersteunde talen — welke talen de UI aanbiedt is een frontend-concern
  // (@talentflow/i18n); de API slaat alleen een geldige locale-string op.
  // `null` = voorkeur wissen → erf de tenant-default.
  language: z
    .string()
    .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/, 'Ongeldige taalcode')
    .optional()
    .nullable(),
});

export async function listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const result = await usersService.listUsers(req.user!.tenantId, page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function inviteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = inviteSchema.parse(req.body);
    const user = await usersService.inviteUser(
      req.user!.tenantId,
      req.user!.email,
      data
    );
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = idSchema.parse(req.params.id);
    const data = updateUserSchema.parse(req.body);
    const user = await usersService.updateUser(
      req.user!.tenantId,
      id,
      req.user!.userId,
      req.user!.role,
      data
    );
    res.json(user);
  } catch (err) {
    next(err);
  }
}

export async function deactivateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = idSchema.parse(req.params.id);
    await usersService.deactivateUser(req.user!.tenantId, id, req.user!.userId);
    res.json({ message: 'Gebruiker gedeactiveerd' });
  } catch (err) {
    next(err);
  }
}

export async function getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await usersService.getMe(req.user!.tenantId, req.user!.userId);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

export async function updateMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = updateMeSchema.parse(req.body);
    const user = await usersService.updateMe(req.user!.tenantId, req.user!.userId, data);
    res.json(user);
  } catch (err) {
    next(err);
  }
}
