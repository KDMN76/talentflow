/**
 * Contracts HTTP routes — Sprint Q4.4 (Agent TTT).
 *
 * Mount path: `/api/contracts` (zie src/index.ts).
 *
 * Alle routes vereisen JWT (`requireAuth`) + tenant-context (`tenantMiddleware`).
 * Validatie via zod. Audit-events worden door de service-laag geschreven.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { auditCtxFromReq } from '../../lib/audit';
import * as service from './contracts.service';

const router = Router();
router.use(requireAuth, tenantMiddleware);

// ───────────────────────────────────────────────────────────────────────────
// Schemas
// ───────────────────────────────────────────────────────────────────────────

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum moet ISO-formaat YYYY-MM-DD zijn');

const contractTypeEnum = z.enum(['temp', 'contract', 'permanent', 'freelance']);
const contractStatusEnum = z.enum([
  'draft',
  'active',
  'ended',
  'terminated',
  'renewed',
]);

const createContractSchema = z.object({
  candidate_id: z.string().uuid(),
  application_id: z.string().uuid().nullable().optional(),
  client_organization_id: z.string().uuid().nullable().optional(),
  job_id: z.string().uuid().nullable().optional(),
  contract_type: contractTypeEnum.optional(),
  status: contractStatusEnum.optional(),
  start_date: dateString,
  end_date: dateString.nullable().optional(),
  weekly_hours: z.number().min(0).max(168).nullable().optional(),
  hourly_rate_candidate: z.number().nonnegative().nullable().optional(),
  hourly_rate_client: z.number().nonnegative().nullable().optional(),
  currency: z.string().min(3).max(3).optional(),
  cao: z.string().max(120).nullable().optional(),
  wtza_compliant: z.boolean().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  signed_at: z.string().datetime().nullable().optional(),
});

const updateContractSchema = createContractSchema.partial().extend({
  candidate_id: z.string().uuid().optional(),
  start_date: dateString.optional(),
});

const listQuerySchema = z.object({
  status: contractStatusEnum.optional(),
  candidate_id: z.string().uuid().optional(),
  job_id: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const extendBodySchema = z.object({
  new_end_date: dateString,
  reason: z.string().max(1000).nullable().optional(),
});

const terminateBodySchema = z.object({
  reason: z.string().min(1).max(1000),
  effective_date: dateString.nullable().optional(),
});

// ───────────────────────────────────────────────────────────────────────────
// Routes
// ───────────────────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const q = listQuerySchema.parse(req.query);
    const result = await service.listContracts(req.user!.tenantId, {
      status: q.status,
      candidateId: q.candidate_id,
      jobId: q.job_id,
      cursor: q.cursor,
      limit: q.limit,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createContractSchema.parse(req.body);
    const contract = await service.createContract(
      req.user!.tenantId,
      body,
      { userId: req.user!.userId, auditCtx: auditCtxFromReq(req) }
    );
    res.status(201).json({ data: contract });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const contract = await service.getContract(
      req.user!.tenantId,
      req.params.id
    );
    res.json({ data: contract });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const body = updateContractSchema.parse(req.body);
    const contract = await service.updateContract(
      req.user!.tenantId,
      req.params.id,
      body,
      { userId: req.user!.userId, auditCtx: auditCtxFromReq(req) }
    );
    res.json({ data: contract });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/extend', async (req, res, next) => {
  try {
    const body = extendBodySchema.parse(req.body);
    const result = await service.extendContract(
      req.user!.tenantId,
      req.params.id,
      body.new_end_date,
      body.reason ?? null,
      { userId: req.user!.userId, auditCtx: auditCtxFromReq(req) }
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/terminate', async (req, res, next) => {
  try {
    const body = terminateBodySchema.parse(req.body);
    const contract = await service.terminateContract(
      req.user!.tenantId,
      req.params.id,
      body.reason,
      {
        userId: req.user!.userId,
        auditCtx: auditCtxFromReq(req),
        effectiveDate: body.effective_date ?? null,
      }
    );
    res.json({ data: contract });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/notifications', async (req, res, next) => {
  try {
    const data = await service.listNotifications(
      req.user!.tenantId,
      req.params.id
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/notifications/schedule', async (req, res, next) => {
  try {
    await service.scheduleExpiryNotifications(
      req.user!.tenantId,
      req.params.id
    );
    const data = await service.listNotifications(
      req.user!.tenantId,
      req.params.id
    );
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

export default router;
