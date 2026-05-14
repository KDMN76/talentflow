/**
 * Timesheets HTTP routes — Sprint Q4.4 (Agent TTT).
 *
 * Mount path: `/api/timesheets` (zie src/index.ts).
 *
 * Alle routes vereisen JWT (`requireAuth`) + tenant-context (`tenantMiddleware`).
 * Zod-gevalideerd; audit via service-laag.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { auditCtxFromReq } from '../../lib/audit';
import { AppError } from '../../middleware/errorHandler';
import * as service from './timesheets.service';

const router = Router();
router.use(requireAuth, tenantMiddleware);

// ───────────────────────────────────────────────────────────────────────────
// Schemas
// ───────────────────────────────────────────────────────────────────────────

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum moet ISO-formaat YYYY-MM-DD zijn');

const statusEnum = z.enum([
  'draft',
  'submitted',
  'approved',
  'rejected',
  'disputed',
]);

const listQuery = z.object({
  contract_id: z.string().uuid().optional(),
  status: statusEnum.optional(),
  week_start: dateString.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const createBody = z.object({
  contract_id: z.string().uuid(),
  week_start: dateString,
  candidate_id: z.string().uuid().nullable().optional(),
});

const entryBody = z.object({
  date: dateString,
  hours: z.number().min(0).max(24),
  overtime_hours: z.number().min(0).max(24).optional(),
  break_minutes: z.number().int().min(0).max(24 * 60).optional(),
  description: z.string().max(1000).nullable().optional(),
  project_code: z.string().max(120).nullable().optional(),
});

const reasonBody = z.object({ reason: z.string().min(1).max(1000) });

const summaryQuery = z.object({
  contract_id: z.string().uuid(),
  period_start: dateString,
  period_end: dateString,
});

// ───────────────────────────────────────────────────────────────────────────
// Routes
// ───────────────────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const q = listQuery.parse(req.query);
    const result = await service.listTimesheets(req.user!.tenantId, {
      contractId: q.contract_id,
      status: q.status,
      weekStart: q.week_start,
      cursor: q.cursor,
      limit: q.limit,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = createBody.parse(req.body);
    const ts = await service.getOrCreateTimesheet(
      req.user!.tenantId,
      body.contract_id,
      body.week_start,
      body.candidate_id ?? null
    );
    res.status(201).json({ data: ts });
  } catch (err) {
    next(err);
  }
});

router.get('/summary', async (req, res, next) => {
  try {
    const q = summaryQuery.parse(req.query);
    const summary = await service.summarizeApprovedHoursForBilling(
      req.user!.tenantId,
      q.contract_id,
      q.period_start,
      q.period_end
    );
    res.json({ data: summary });
  } catch (err) {
    next(err);
  }
});

router.get('/approver-queue', async (req, res, next) => {
  try {
    const role = req.user!.role;
    if (role !== 'recruiter' && role !== 'admin' && role !== 'client') {
      throw new AppError(403, 'FORBIDDEN', 'Onvoldoende rechten');
    }
    const data = await service.listForApprover(
      req.user!.tenantId,
      req.user!.userId
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const ts = await service.getTimesheet(req.user!.tenantId, req.params.id);
    res.json({ data: ts });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/audit', async (req, res, next) => {
  try {
    const data = await service.getTimesheetAudit(
      req.user!.tenantId,
      req.params.id
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/entries', async (req, res, next) => {
  try {
    const body = entryBody.parse(req.body);
    const result = await service.addOrUpdateEntry(
      req.user!.tenantId,
      req.params.id,
      body,
      { userId: req.user!.userId, role: req.user!.role }
    );
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/entries/:entryId', async (req, res, next) => {
  try {
    const body = entryBody.parse(req.body);
    const result = await service.addOrUpdateEntry(
      req.user!.tenantId,
      req.params.id,
      body,
      { userId: req.user!.userId, role: req.user!.role }
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/entries/:entryId', async (req, res, next) => {
  try {
    const result = await service.deleteEntry(
      req.user!.tenantId,
      req.params.id,
      req.params.entryId,
      { userId: req.user!.userId, role: req.user!.role }
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/submit', async (req, res, next) => {
  try {
    const ts = await service.submitTimesheet(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      { userId: req.user!.userId, auditCtx: auditCtxFromReq(req) }
    );
    res.json({ data: ts });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/approve', async (req, res, next) => {
  try {
    const role = req.user!.role;
    if (role === 'candidate') {
      throw new AppError(
        403,
        'APPROVER_FORBIDDEN',
        'Kandidaat mag eigen timesheets niet approven'
      );
    }
    const ts = await service.approveTimesheet(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      role,
      { auditCtx: auditCtxFromReq(req) }
    );
    res.json({ data: ts });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reject', async (req, res, next) => {
  try {
    const body = reasonBody.parse(req.body);
    const ts = await service.rejectTimesheet(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      body.reason,
      { auditCtx: auditCtxFromReq(req), approverRole: req.user!.role }
    );
    res.json({ data: ts });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/dispute', async (req, res, next) => {
  try {
    const body = reasonBody.parse(req.body);
    const ts = await service.disputeTimesheet(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      body.reason,
      { auditCtx: auditCtxFromReq(req), disputerRole: req.user!.role }
    );
    res.json({ data: ts });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Portal-token issuance (recruiter creates a token to email to candidate)
// ───────────────────────────────────────────────────────────────────────────

const issueTokenBody = z.object({
  contract_id: z.string().uuid(),
  candidate_id: z.string().uuid(),
  ttl_days: z.number().int().min(1).max(365).optional(),
});

router.post('/portal-tokens', async (req, res, next) => {
  try {
    const role = req.user!.role;
    if (role === 'candidate') {
      throw new AppError(403, 'FORBIDDEN', 'Onvoldoende rechten');
    }
    const body = issueTokenBody.parse(req.body);
    const result = await service.createPortalToken(
      req.user!.tenantId,
      body.contract_id,
      body.candidate_id,
      { ttlDays: body.ttl_days, createdBy: req.user!.userId }
    );
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

router.delete('/portal-tokens/:id', async (req, res, next) => {
  try {
    await service.revokePortalToken(req.user!.tenantId, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
