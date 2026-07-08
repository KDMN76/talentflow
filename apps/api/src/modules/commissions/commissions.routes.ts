/**
 * Commissions HTTP routes — Sprint Q4.4 (Agent UUU).
 *
 * Mount path: `/api/commissions`.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/permissions';
import { auditCtxFromReq } from '../../lib/audit';
import * as service from './commissions.service';

const router = Router();
router.use(requireAuth, tenantMiddleware);

// Commissie-mutaties (schemes/assignments/approve/pay/dispute) vereisen
// `billing:write` — read-only rollen (viewer) konden hier eerst zonder
// check commissies goedkeuren/uitbetalen (viewer-gap gedicht).

// ── Schemes ───────────────────────────────────────────────────────────────
router.get(
  '/schemes',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.listSchemes(req.user!.tenantId);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

const createSchemeBody = z.object({
  name: z.string().min(1).max(120),
  type: z.enum([
    'flat',
    'percent_of_fee',
    'percent_of_margin',
    'tiered',
    'recurring_monthly',
  ]),
  config: z.record(z.unknown()),
  active: z.boolean().optional(),
  is_default: z.boolean().optional(),
});

router.post(
  '/schemes',
  requirePermission('billing', 'write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createSchemeBody.parse(req.body);
      const scheme = await service.createScheme(req.user!.tenantId, {
        ...body,
        userId: req.user!.userId,
        auditCtx: auditCtxFromReq(req),
      });
      res.status(201).json({ data: scheme });
    } catch (err) {
      next(err);
    }
  }
);

const updateSchemeBody = z.object({
  name: z.string().min(1).max(120).optional(),
  config: z.record(z.unknown()).optional(),
  active: z.boolean().optional(),
  is_default: z.boolean().optional(),
});

router.patch(
  '/schemes/:id',
  requirePermission('billing', 'write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = updateSchemeBody.parse(req.body);
      const scheme = await service.updateScheme(
        req.user!.tenantId,
        req.params.id,
        {
          ...body,
          userId: req.user!.userId,
          auditCtx: auditCtxFromReq(req),
        }
      );
      res.json({ data: scheme });
    } catch (err) {
      next(err);
    }
  }
);

// ── Assignments ───────────────────────────────────────────────────────────
const listAssignmentsQuery = z.object({
  contract_id: z.string().uuid().optional(),
  recruiter_id: z.string().uuid().optional(),
});

router.get(
  '/assignments',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = listAssignmentsQuery.parse(req.query);
      const data = await service.listAssignments(req.user!.tenantId, q);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

const createAssignmentBody = z.object({
  contract_id: z.string().uuid(),
  recruiter_id: z.string().uuid().nullable(),
  scheme_id: z.string().uuid(),
  share_percent: z.number().min(0).max(100).optional(),
  notes: z.string().max(500).nullable().optional(),
});

router.post(
  '/assignments',
  requirePermission('billing', 'write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createAssignmentBody.parse(req.body);
      const assignment = await service.assignToContract(req.user!.tenantId, {
        ...body,
        notes: body.notes ?? null,
        userId: req.user!.userId,
        auditCtx: auditCtxFromReq(req),
      });
      res.status(201).json({ data: assignment });
    } catch (err) {
      next(err);
    }
  }
);

// ── Records ───────────────────────────────────────────────────────────────
const listRecordsQuery = z.object({
  recruiter_id: z.string().uuid().optional(),
  contract_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'approved', 'paid', 'disputed']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

router.get('/records', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = listRecordsQuery.parse(req.query);
    const result = await service.listCommissions(req.user!.tenantId, q);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/records/:id/approve',
  requirePermission('billing', 'write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const record = await service.approveCommission(
        req.user!.tenantId,
        req.params.id,
        { userId: req.user!.userId, auditCtx: auditCtxFromReq(req) }
      );
      res.json({ data: record });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/records/:id/pay',
  requirePermission('billing', 'write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const record = await service.payCommission(
        req.user!.tenantId,
        req.params.id,
        { userId: req.user!.userId, auditCtx: auditCtxFromReq(req) }
      );
      res.json({ data: record });
    } catch (err) {
      next(err);
    }
  }
);

const disputeBody = z.object({ reason: z.string().min(2).max(500) });
router.post(
  '/records/:id/dispute',
  requirePermission('billing', 'write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = disputeBody.parse(req.body);
      const record = await service.disputeCommission(
        req.user!.tenantId,
        req.params.id,
        body.reason,
        { userId: req.user!.userId, auditCtx: auditCtxFromReq(req) }
      );
      res.json({ data: record });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
