import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as emailTemplatesService from './email-templates.service';
import { AppError } from '../../middleware/errorHandler';

const listQuerySchema = z.object({
  category: z.string().min(1).max(50).optional(),
});

export async function listEmailTemplates(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { category } = listQuerySchema.parse(req.query);
    const data = await emailTemplatesService.listEmailTemplates(req.user!.tenantId, category);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function getEmailTemplate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    if (!id) throw new AppError(400, 'MISSING_ID', 'id is verplicht');
    const tpl = await emailTemplatesService.getEmailTemplate(req.user!.tenantId, id);
    res.json(tpl);
  } catch (err) {
    next(err);
  }
}

export async function createEmailTemplate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = emailTemplatesService.createEmailTemplateSchema.parse(req.body);
    const tpl = await emailTemplatesService.createEmailTemplate(
      req.user!.tenantId,
      req.user!.userId,
      data
    );
    res.status(201).json(tpl);
  } catch (err) {
    next(err);
  }
}

export async function updateEmailTemplate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    if (!id) throw new AppError(400, 'MISSING_ID', 'id is verplicht');
    const patch = emailTemplatesService.updateEmailTemplateSchema.parse(req.body);
    const tpl = await emailTemplatesService.updateEmailTemplate(
      req.user!.tenantId,
      id,
      req.user!.userId,
      patch
    );
    res.json(tpl);
  } catch (err) {
    next(err);
  }
}

export async function deleteEmailTemplate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    if (!id) throw new AppError(400, 'MISSING_ID', 'id is verplicht');
    await emailTemplatesService.deleteEmailTemplate(req.user!.tenantId, id);
    res.json({ message: 'E-mailtemplate verwijderd' });
  } catch (err) {
    next(err);
  }
}
