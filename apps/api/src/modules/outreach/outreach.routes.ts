/**
 * Outreach HTTP routes — Sprint Q4.5 (Agent XXX).
 *
 * Mount path: `/api/outreach`. All routes require JWT + tenant context. Zod
 * validation. Audit handled in the service layer.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { auditCtxFromReq } from '../../lib/audit';
import * as outreach from './outreach.service';
import * as classifier from './replyClassifier.service';
import * as monitoring from '../monitoring/passiveMonitor.service';

const router = Router();
router.use(requireAuth, tenantMiddleware);

// ───────────────────────────────────────────────────────────────────────────
// Schemas
// ───────────────────────────────────────────────────────────────────────────

const channelEnum = z.enum([
  'linkedin_inmail',
  'linkedin_connection',
  'email',
  'sms',
  'whatsapp',
]);
const directionEnum = z.enum(['outbound', 'inbound']);
const statusEnum = z.enum([
  'drafted',
  'pending_approval',
  'approved',
  'sending',
  'sent',
  'failed',
  'rejected_by_recruiter',
]);

const listMessagesQuery = z.object({
  status: statusEnum.optional(),
  candidate_id: z.string().uuid().optional(),
  direction: directionEnum.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const draftBody = z.object({
  candidate_id: z.string().uuid(),
  channel: channelEnum,
  step_id: z.string().uuid().nullable().optional(),
  enrollment_id: z.string().uuid().nullable().optional(),
  signals: z.record(z.unknown()).optional(),
  template_subject: z.string().nullable().optional(),
  template_body: z.string().nullable().optional(),
  ai_personalize: z.boolean().optional(),
  require_approval: z.boolean().optional(),
});

const rejectBody = z.object({
  reason: z.string().min(1).max(1000),
  pause_enrollment: z.boolean().optional(),
});

const quotaBody = z.object({
  daily_limit: z.number().int().min(0).max(10_000).optional(),
  weekly_limit: z.number().int().min(0).max(50_000).optional(),
});

const listRepliesQuery = z.object({
  category: z
    .enum([
      'interested',
      'not_now',
      'not_interested',
      'out_of_office',
      'unsubscribe',
      'spam',
      'question',
      'unknown',
    ])
    .optional(),
  unreviewed: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const listSignalsQuery = z.object({
  signal_type: z
    .enum([
      'job_change',
      'title_change',
      'company_growth',
      'funding_round',
      'linkedin_post',
      'open_to_work_flag',
    ])
    .optional(),
  unreviewed: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const draftReactivationBody = z.object({
  sequence_id: z.string().uuid(),
});

// ───────────────────────────────────────────────────────────────────────────
// Messages
// ───────────────────────────────────────────────────────────────────────────

router.get('/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = listMessagesQuery.parse(req.query);
    const result = await outreach.listMessages(req.user!.tenantId, q);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/messages/:id', async (req, res, next) => {
  try {
    const msg = await outreach.getMessage(req.user!.tenantId, req.params.id);
    res.json({ data: msg });
  } catch (err) {
    next(err);
  }
});

router.post('/messages/draft', async (req, res, next) => {
  try {
    const body = draftBody.parse(req.body);
    const result = await outreach.draftOutreachMessage(
      req.user!.tenantId,
      body.candidate_id,
      {
        channel: body.channel,
        step_id: body.step_id ?? null,
        enrollment_id: body.enrollment_id ?? null,
        template_subject: body.template_subject ?? null,
        template_body: body.template_body ?? null,
        ai_personalize: body.ai_personalize,
      },
      (body.signals ?? {}) as outreach.DraftSignals,
      {
        userId: req.user!.userId,
        auditCtx: auditCtxFromReq(req),
        requireApproval: body.require_approval,
      }
    );
    res.status(201).json({ data: result.message, mocked: result.mocked });
  } catch (err) {
    next(err);
  }
});

router.post('/messages/:id/approve', async (req, res, next) => {
  try {
    const row = await outreach.approveMessage(req.user!.tenantId, req.params.id, {
      userId: req.user!.userId,
      auditCtx: auditCtxFromReq(req),
    });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.post('/messages/:id/reject', async (req, res, next) => {
  try {
    const body = rejectBody.parse(req.body);
    const row = await outreach.rejectMessage(req.user!.tenantId, req.params.id, {
      userId: req.user!.userId,
      reason: body.reason,
      pauseEnrollment: body.pause_enrollment,
      auditCtx: auditCtxFromReq(req),
    });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.post('/messages/:id/regenerate', async (req, res, next) => {
  try {
    const result = await outreach.regenerateMessage(req.user!.tenantId, req.params.id, {
      userId: req.user!.userId,
      auditCtx: auditCtxFromReq(req),
    });
    res.json({ data: result.message, mocked: result.mocked });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Quotas
// ───────────────────────────────────────────────────────────────────────────

router.get('/quotas', async (req, res, next) => {
  try {
    const data = await outreach.listQuotas(req.user!.tenantId);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.patch('/quotas/:recruiterId/:channel', async (req, res, next) => {
  try {
    const recruiterId = z.string().uuid().parse(req.params.recruiterId);
    const channel = channelEnum.parse(req.params.channel);
    const body = quotaBody.parse(req.body);
    const row = await outreach.updateQuota(
      req.user!.tenantId,
      recruiterId,
      channel,
      body
    );
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Replies (classifications)
// ───────────────────────────────────────────────────────────────────────────

router.get('/replies', async (req, res, next) => {
  try {
    const q = listRepliesQuery.parse(req.query);
    const result = await classifier.listReplyClassifications(req.user!.tenantId, q);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Signals (passive monitoring)
// ───────────────────────────────────────────────────────────────────────────

router.get('/signals', async (req, res, next) => {
  try {
    const q = listSignalsQuery.parse(req.query);
    const result = await monitoring.listSignals(req.user!.tenantId, q);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/signals/:id/dismiss', async (req, res, next) => {
  try {
    const row = await monitoring.dismissSignal(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId
    );
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.post('/signals/:id/draft-reactivation', async (req, res, next) => {
  try {
    const body = draftReactivationBody.parse(req.body);
    const { enrollCandidate } = await import('../nurture/nurture.service');
    // Look up the signal to get the candidate id.
    const result = await monitoring.listSignals(req.user!.tenantId, { limit: 200 });
    const signal = result.data.find((s) => s.id === req.params.id);
    if (!signal) {
      res.status(404).json({
        error: { code: 'SIGNAL_NOT_FOUND', message: 'Signal niet gevonden' },
      });
      return;
    }
    const enrollment = await enrollCandidate(req.user!.tenantId, {
      candidateId: signal.candidate_id,
      sequenceId: body.sequence_id,
      requireApproval: true,
      userId: req.user!.userId,
      signals: { reactivation_reason: signal.after_value ?? '' },
      auditCtx: auditCtxFromReq(req),
    });
    res.status(201).json({ data: enrollment });
  } catch (err) {
    next(err);
  }
});

export default router;
