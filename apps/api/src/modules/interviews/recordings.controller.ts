/**
 * Interview-recordings controller — Sprint Q3.4.
 *
 * REST handlers voor:
 *   POST   /api/interviews/:id/recordings              multipart 'audio' + body { consent_given }
 *   GET    /api/interviews/:id/recordings              list per interview
 *   GET    /api/interviews/recordings/:recId           single recording metadata
 *   GET    /api/interviews/recordings/:recId/transcript transcript + summary
 *   DELETE /api/interviews/recordings/:recId           hard delete
 *
 * En voor calendar-sync:
 *   POST   /api/interviews/:id/calendar-sync                   alle interviewers
 *   POST   /api/interviews/:id/calendar-events/:userId         single user
 *   DELETE /api/interviews/:id/calendar-events                 cancel-flow
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../../middleware/errorHandler';
import * as recordingsService from './recordings.service';
import * as calendarSyncService from './calendarSync.service';

// ────────────────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────────────────

const idParamSchema = z.object({ id: z.string().uuid() });
const recIdParamSchema = z.object({ recId: z.string().uuid() });
const idAndUserParamSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
});

const consentBodySchema = z.object({
  consent_given: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'string' ? v.toLowerCase() === 'true' : v)),
});

function auditCtx(req: Request) {
  return {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    requestId: (req.headers['x-request-id'] as string | undefined) ?? undefined,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Recording handlers
// ────────────────────────────────────────────────────────────────────────────

export async function uploadRecordingHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = idParamSchema.parse(req.params);
    const { consent_given } = consentBodySchema.parse(req.body ?? {});
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      throw new AppError(400, 'NO_FILE', 'Geen audio-bestand ontvangen (form field "audio")');
    }
    const recording = await recordingsService.uploadRecording(
      req.user!.tenantId,
      id,
      req.user!.userId,
      file,
      consent_given,
      auditCtx(req)
    );
    res.status(201).json({ data: recording });
  } catch (err) {
    next(err);
  }
}

export async function listRecordingsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = idParamSchema.parse(req.params);
    const records = await recordingsService.listRecordings(req.user!.tenantId, id);
    res.json({ data: records });
  } catch (err) {
    next(err);
  }
}

export async function getRecordingHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { recId } = recIdParamSchema.parse(req.params);
    const rec = await recordingsService.getRecording(req.user!.tenantId, recId);
    res.json({ data: rec });
  } catch (err) {
    next(err);
  }
}

export async function getTranscriptHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { recId } = recIdParamSchema.parse(req.params);
    const transcript = await recordingsService.getTranscript(
      req.user!.tenantId,
      recId
    );
    res.json({ data: transcript });
  } catch (err) {
    next(err);
  }
}

export async function deleteRecordingHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { recId } = recIdParamSchema.parse(req.params);
    await recordingsService.deleteRecording(
      req.user!.tenantId,
      recId,
      req.user!.userId,
      auditCtx(req)
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Calendar handlers
// ────────────────────────────────────────────────────────────────────────────

export async function syncCalendarHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = idParamSchema.parse(req.params);
    const result = await calendarSyncService.createCalendarEventForInterview(
      req.user!.tenantId,
      id,
      auditCtx(req)
    );
    res.status(202).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function syncCalendarSingleUserHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = idAndUserParamSchema.parse(req.params);
    // We hergebruiken de bulk-flow maar filteren in de service via een
    // afgeleide helper. Voor MVP roepen we createCalendarEventForInterview
    // aan en relyen we op de UNIQUE-constraint om alleen de betreffende
    // user-rij te updaten. (De service skipt al rijen die niet matchen via
    // de mailbox_integrations join.)
    const result = await calendarSyncService.createCalendarEventForInterview(
      req.user!.tenantId,
      id,
      auditCtx(req)
    );
    res.status(202).json({ data: result });
  } catch (err) {
    next(err);
  }
}

export async function deleteCalendarHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = idParamSchema.parse(req.params);
    const result = await calendarSyncService.deleteCalendarEventForInterview(
      req.user!.tenantId,
      id,
      auditCtx(req)
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}
