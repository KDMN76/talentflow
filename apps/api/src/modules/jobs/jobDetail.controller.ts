import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../../middleware/errorHandler';
import * as jobDetailService from './jobDetail.service';
import * as jobHealthService from './jobHealth.service';
import * as jobBiasService from './jobBiasCheck.service';

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const teamMemberRoleSchema = z.enum(['recruiter', 'hiring_manager', 'observer']);

const addTeamMemberSchema = z.object({
  user_id: z.string().uuid(),
  role: teamMemberRoleSchema.optional(),
});

const createNoteSchema = z.object({
  body: z.string().min(1).max(10_000),
  mentions: z.array(z.string().uuid()).max(50).optional(),
});

const comparableQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

// ─────────────────────────────────────────────────────────────────────────────
// Team
// ─────────────────────────────────────────────────────────────────────────────

export async function listJobTeam(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await jobDetailService.listJobTeam(
      req.user!.tenantId,
      req.params.id
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function addJobTeamMember(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = addTeamMemberSchema.parse(req.body);
    const member = await jobDetailService.addJobTeamMember(
      req.user!.tenantId,
      req.params.id,
      parsed.user_id,
      parsed.role ?? 'recruiter'
    );
    res.status(201).json(member);
  } catch (err) {
    next(err);
  }
}

export async function removeJobTeamMember(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await jobDetailService.removeJobTeamMember(
      req.user!.tenantId,
      req.params.id,
      req.params.userId
    );
    res.json({ message: 'Teamlid verwijderd' });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Notes
// ─────────────────────────────────────────────────────────────────────────────

export async function listJobNotes(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await jobDetailService.listJobNotes(
      req.user!.tenantId,
      req.params.id
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function createJobNote(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = createNoteSchema.parse(req.body);
    const note = await jobDetailService.createJobNote(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      parsed.body,
      parsed.mentions ?? []
    );
    res.status(201).json(note);
  } catch (err) {
    next(err);
  }
}

export async function deleteJobNote(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await jobDetailService.deleteJobNote(
      req.user!.tenantId,
      req.params.noteId
    );
    res.json({ message: 'Notitie verwijderd' });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Attachments
// ─────────────────────────────────────────────────────────────────────────────

export async function listJobAttachments(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await jobDetailService.listJobAttachments(
      req.user!.tenantId,
      req.params.id
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function uploadJobAttachment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.file) {
      throw new AppError(400, 'NO_FILE', 'Geen bestand geüpload');
    }
    const attachment = await jobDetailService.uploadJobAttachment(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      req.file
    );
    res.status(201).json(attachment);
  } catch (err) {
    next(err);
  }
}

export async function deleteJobAttachment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await jobDetailService.deleteJobAttachment(
      req.user!.tenantId,
      req.params.attachmentId
    );
    res.json({ message: 'Bijlage verwijderd' });
  } catch (err) {
    next(err);
  }
}

export async function downloadJobAttachment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const url = await jobDetailService.getJobAttachmentUrl(
      req.user!.tenantId,
      req.params.attachmentId
    );
    res.redirect(302, url);
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Health / funnel / comparable / sourcing / bias
// ─────────────────────────────────────────────────────────────────────────────

export async function getJobHealth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await jobHealthService.getJobHealth(
      req.user!.tenantId,
      req.params.id
    );
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getJobFunnel(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await jobDetailService.getJobFunnel(
      req.user!.tenantId,
      req.params.id
    );
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getComparableJobs(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { limit } = comparableQuerySchema.parse(req.query);
    const data = await jobDetailService.getComparableJobs(
      req.user!.tenantId,
      req.params.id,
      limit
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function getJobSourcing(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await jobDetailService.getJobSourcing(
      req.user!.tenantId,
      req.params.id
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function getJobBiasCheck(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await jobBiasService.checkJobBias(
      req.user!.tenantId,
      req.params.id
    );
    res.json(data);
  } catch (err) {
    next(err);
  }
}
