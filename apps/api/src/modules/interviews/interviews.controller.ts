/**
 * Interview controllers — HTTP-laag voor interviews, kits en availability.
 *
 * Gebruikt zod voor request-body validatie zodat invalid payloads
 * automatisch een 400 VALIDATION_ERROR teruggeven via errorHandler.
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as interviews from './interviews.service';
import * as kits from './interviewKits.service';
import * as availability from './availability.service';
import { auditCtxFromReq } from '../../lib/audit';
import { getAgreementMatrix } from '../scorecards/scorecards.service';

// ────────────────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────────────────

const meetingProviderSchema = z.enum([
  'google_meet',
  'teams',
  'zoom',
  'in_person',
  'phone',
]);

const scheduleInterviewSchema = z.object({
  application_id: z.string().uuid(),
  scheduled_start: z.string().min(1),
  scheduled_end: z.string().min(1),
  interviewer_user_ids: z.array(z.string().uuid()).min(1),
  observer_user_ids: z.array(z.string().uuid()).optional(),
  meeting_provider: meetingProviderSchema.optional(),
  location: z.string().max(500).optional(),
  meeting_url: z.string().url().max(2000).optional(),
  interview_kit_id: z.string().uuid().optional(),
  notes: z.string().max(20000).optional(),
  stage_id: z.string().uuid().nullable().optional(),
});

const listInterviewsQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  candidate_id: z.string().uuid().optional(),
  interviewer_id: z.string().uuid().optional(),
  status: z
    .enum(['scheduled', 'completed', 'cancelled', 'no_show', 'rescheduled'])
    .optional(),
});

const patchInterviewSchema = z
  .object({
    scheduled_start: z.string().optional(),
    scheduled_end: z.string().optional(),
    cancel_reason: z.string().max(2000).optional(),
    status: z
      .enum(['scheduled', 'completed', 'cancelled', 'no_show', 'rescheduled'])
      .optional(),
    attendance: z
      .object({
        participant_id: z.string().uuid(),
        attended: z.boolean(),
      })
      .optional(),
  })
  .refine(
    (v) =>
      v.scheduled_start ||
      v.scheduled_end ||
      v.cancel_reason ||
      v.status ||
      v.attendance,
    { message: 'Geef ten minste één veld op om te updaten' }
  );

const slotsBodySchema = z.object({
  interviewer_ids: z.array(z.string().uuid()).min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  duration_minutes: z.number().int().min(5).max(480),
  timezone: z.string().optional(),
  step_minutes: z.number().int().min(5).max(120).optional(),
});

const recurringHoursSchema = z.object({
  recurring_hours: z.array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      start: z.string().min(1),
      end: z.string().min(1),
      timezone: z.string().optional(),
    })
  ),
});

const overrideSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  blocked: z.boolean(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  reason: z.string().max(500).optional(),
  timezone: z.string().optional(),
});

const questionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  category: z.enum(['behavioral', 'technical', 'culture', 'experience']),
  suggested_followups: z.array(z.string()).optional(),
  evaluation_criteria: z.string().optional(),
  expected_duration_minutes: z.number().int().min(1).max(180).optional(),
});

const createKitSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  job_id: z.string().uuid().nullable().optional(),
  questions: z.array(questionSchema),
  scorecard_template_id: z.string().uuid().nullable().optional(),
  estimated_duration_minutes: z.number().int().min(5).max(480).optional(),
  is_default: z.boolean().optional(),
});

const updateKitSchema = createKitSchema.partial();

// ────────────────────────────────────────────────────────────────────────────
// Interviews
// ────────────────────────────────────────────────────────────────────────────

export async function listInterviews(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = listInterviewsQuerySchema.parse(req.query);
    const list = await interviews.listInterviews(req.user!.tenantId, {
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      candidate_id: q.candidate_id,
      interviewer_id: q.interviewer_id,
      status: q.status,
    });
    res.json({ data: list });
  } catch (err) {
    next(err);
  }
}

export async function createInterview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = scheduleInterviewSchema.parse(req.body);
    const iv = await interviews.scheduleInterview(
      req.user!.tenantId,
      req.user!.userId,
      body,
      auditCtxFromReq(req)
    );
    res.status(201).json(iv);
  } catch (err) {
    next(err);
  }
}

export async function getInterview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const iv = await interviews.getInterview(req.user!.tenantId, req.params.id);
    res.json(iv);
  } catch (err) {
    next(err);
  }
}

export async function patchInterview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = patchInterviewSchema.parse(req.body);
    const ctx = auditCtxFromReq(req);

    if (body.scheduled_start && body.scheduled_end) {
      const iv = await interviews.rescheduleInterview(
        req.user!.tenantId,
        req.params.id,
        body.scheduled_start,
        body.scheduled_end,
        req.user!.userId,
        ctx
      );
      res.json(iv);
      return;
    }
    if (body.cancel_reason || body.status === 'cancelled') {
      await interviews.cancelInterview(
        req.user!.tenantId,
        req.params.id,
        body.cancel_reason ?? 'Geannuleerd',
        req.user!.userId,
        ctx
      );
      res.json({ message: 'Interview geannuleerd' });
      return;
    }
    if (body.attendance) {
      await interviews.markAttendance(
        req.user!.tenantId,
        req.params.id,
        body.attendance.participant_id,
        body.attendance.attended,
        req.user!.userId,
        ctx
      );
      res.json({ message: 'Attendance bijgewerkt' });
      return;
    }
    res.status(400).json({ error: { code: 'NO_OP', message: 'Niets om te wijzigen', details: {} } });
  } catch (err) {
    next(err);
  }
}

export async function deleteInterview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await interviews.cancelInterview(
      req.user!.tenantId,
      req.params.id,
      'Verwijderd door gebruiker',
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json({ message: 'Interview geannuleerd' });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Availability
// ────────────────────────────────────────────────────────────────────────────

export async function getSlots(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = slotsBodySchema.parse(req.body);
    const slots = await availability.getAvailableSlots(req.user!.tenantId, body.interviewer_ids, {
      from: new Date(body.from),
      to: new Date(body.to),
      durationMinutes: body.duration_minutes,
      timezone: body.timezone,
      stepMinutes: body.step_minutes,
    });
    res.json({ data: slots });
  } catch (err) {
    next(err);
  }
}

export async function getUserAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const list = await availability.getAvailability(req.user!.tenantId, req.params.userId);
    res.json({ data: list });
  } catch (err) {
    next(err);
  }
}

export async function putRecurringHours(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = recurringHoursSchema.parse(req.body);
    await availability.setRecurringHours(
      req.user!.tenantId,
      req.params.userId,
      body.recurring_hours,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json({ message: 'Werkuren bijgewerkt' });
  } catch (err) {
    next(err);
  }
}

export async function postOverride(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = overrideSchema.parse(req.body);
    await availability.setDateOverride(
      req.user!.tenantId,
      req.params.userId,
      body,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json({ message: 'Override bijgewerkt' });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Interview Kits
// ────────────────────────────────────────────────────────────────────────────

export async function listKits(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const jobId = typeof req.query.job_id === 'string' ? req.query.job_id : undefined;
    const list = await kits.listInterviewKits(req.user!.tenantId, jobId);
    res.json({ data: list });
  } catch (err) {
    next(err);
  }
}

export async function getKit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const kit = await kits.getInterviewKit(req.user!.tenantId, req.params.id);
    res.json(kit);
  } catch (err) {
    next(err);
  }
}

export async function createKit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = createKitSchema.parse(req.body);
    const kit = await kits.createInterviewKit(
      req.user!.tenantId,
      req.user!.userId,
      body,
      auditCtxFromReq(req)
    );
    res.status(201).json(kit);
  } catch (err) {
    next(err);
  }
}

export async function patchKit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = updateKitSchema.parse(req.body);
    const kit = await kits.updateInterviewKit(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      body,
      auditCtxFromReq(req)
    );
    res.json(kit);
  } catch (err) {
    next(err);
  }
}

export async function deleteKit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await kits.deleteInterviewKit(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json({ message: 'Interview kit verwijderd' });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Agreement matrix (mounted op /api/applications/:id/agreement-matrix)
// ────────────────────────────────────────────────────────────────────────────

export async function getAgreementMatrixForApp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const matrix = await getAgreementMatrix(req.user!.tenantId, req.params.id);
    res.json(matrix);
  } catch (err) {
    next(err);
  }
}
