/**
 * Nurture HTTP routes — Sprint Q4.5 (Agent XXX).
 *
 * Mount path: `/api/nurture`. JWT + tenant required.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/permissions';
import { auditCtxFromReq } from '../../lib/audit';
import * as nurture from './nurture.service';

const router = Router();
router.use(requireAuth, tenantMiddleware);

const channelEnum = z.enum([
  'linkedin_inmail',
  'linkedin_connection',
  'email',
  'sms',
  'whatsapp',
]);
const enrollmentStatusEnum = z.enum([
  'pending_approval',
  'active',
  'paused',
  'stopped',
  'completed',
  'replied',
]);

const createSequenceBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateSequenceBody = createSequenceBody.partial().extend({
  active: z.boolean().optional(),
});

const addStepBody = z.object({
  channel: channelEnum,
  delay_days: z.number().int().min(0).max(365),
  ai_personalize: z.boolean().optional(),
  template_subject: z.string().max(200).nullable().optional(),
  template_body: z.string().max(20_000).nullable().optional(),
  stop_on_reply: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const reorderBody = z.object({
  ordered_ids: z.array(z.string().uuid()).min(1),
});

const enrollBody = z.object({
  candidate_id: z.string().uuid(),
  sequence_id: z.string().uuid(),
  finding_id: z.string().uuid().nullable().optional(),
  require_approval: z.boolean().optional(),
  signals: z.record(z.unknown()).optional(),
});

const listSequencesQuery = z.object({
  active: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const listEnrollmentsQuery = z.object({
  candidate_id: z.string().uuid().optional(),
  sequence_id: z.string().uuid().optional(),
  status: enrollmentStatusEnum.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const stopEnrollmentBody = z.object({
  reason: z.string().min(1).max(500),
});

// ───────────────────────────────────────────────────────────────────────────
// Sequences
// ───────────────────────────────────────────────────────────────────────────
// RBAC: alle mutaties vereisen communications:write; GET-routes blijven open
// voor elke authenticated tenant-rol.

router.get('/sequences', async (req, res, next) => {
  try {
    const q = listSequencesQuery.parse(req.query);
    const result = await nurture.listSequences(req.user!.tenantId, q);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/sequences', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    const body = createSequenceBody.parse(req.body);
    const row = await nurture.createSequence(req.user!.tenantId, body, {
      userId: req.user!.userId,
      auditCtx: auditCtxFromReq(req),
    });
    res.status(201).json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.get('/sequences/:id', async (req, res, next) => {
  try {
    const data = await nurture.getSequenceWithSteps(
      req.user!.tenantId,
      req.params.id
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.patch('/sequences/:id', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    const body = updateSequenceBody.parse(req.body);
    const row = await nurture.updateSequence(
      req.user!.tenantId,
      req.params.id,
      body,
      { userId: req.user!.userId, auditCtx: auditCtxFromReq(req) }
    );
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.post('/sequences/:id/archive', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    const row = await nurture.archiveSequence(req.user!.tenantId, req.params.id, {
      userId: req.user!.userId,
      auditCtx: auditCtxFromReq(req),
    });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Steps
// ───────────────────────────────────────────────────────────────────────────

router.post('/sequences/:id/steps', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    const body = addStepBody.parse(req.body);
    const row = await nurture.addStep(req.user!.tenantId, req.params.id, body, {
      userId: req.user!.userId,
      auditCtx: auditCtxFromReq(req),
    });
    res.status(201).json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.patch('/sequences/:id/steps/:stepId', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    const body = addStepBody.partial().parse(req.body);
    const row = await nurture.updateStep(
      req.user!.tenantId,
      req.params.id,
      req.params.stepId,
      body,
      { userId: req.user!.userId, auditCtx: auditCtxFromReq(req) }
    );
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.post('/sequences/:id/steps/reorder', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    const body = reorderBody.parse(req.body);
    const rows = await nurture.reorderSteps(
      req.user!.tenantId,
      req.params.id,
      body.ordered_ids,
      { userId: req.user!.userId, auditCtx: auditCtxFromReq(req) }
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.delete('/sequences/:id/steps/:stepId', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    await nurture.removeStep(
      req.user!.tenantId,
      req.params.id,
      req.params.stepId,
      { userId: req.user!.userId, auditCtx: auditCtxFromReq(req) }
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Enrollments
// ───────────────────────────────────────────────────────────────────────────

router.get('/enrollments', async (req, res, next) => {
  try {
    const q = listEnrollmentsQuery.parse(req.query);
    const result = await nurture.listEnrollments(req.user!.tenantId, q);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/enrollments', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    const body = enrollBody.parse(req.body);
    const row = await nurture.enrollCandidate(req.user!.tenantId, {
      candidateId: body.candidate_id,
      sequenceId: body.sequence_id,
      findingId: body.finding_id ?? null,
      requireApproval: body.require_approval,
      signals: body.signals as nurture.EnrollCandidateInput['signals'],
      userId: req.user!.userId,
      auditCtx: auditCtxFromReq(req),
    });
    res.status(201).json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.get('/enrollments/:id', async (req, res, next) => {
  try {
    const row = await nurture.getEnrollment(req.user!.tenantId, req.params.id);
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.post('/enrollments/:id/pause', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    const row = await nurture.pauseEnrollment(req.user!.tenantId, req.params.id, {
      userId: req.user!.userId,
      auditCtx: auditCtxFromReq(req),
    });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.post('/enrollments/:id/resume', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    const row = await nurture.resumeEnrollment(req.user!.tenantId, req.params.id, {
      userId: req.user!.userId,
      auditCtx: auditCtxFromReq(req),
    });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.post('/enrollments/:id/stop', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    const body = stopEnrollmentBody.parse(req.body);
    const row = await nurture.stopEnrollment(
      req.user!.tenantId,
      req.params.id,
      body.reason,
      { userId: req.user!.userId, auditCtx: auditCtxFromReq(req) }
    );
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

export default router;
