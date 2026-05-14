/**
 * Accounting integrations HTTP routes — Sprint Q4.4 (Agent UUU).
 *
 * Mount path: `/api/accounting` (zie src/index.ts).
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { auditCtxFromReq } from '../../lib/audit';
import * as service from './accounting.service';

const router = Router();
router.use(requireAuth, tenantMiddleware);

router.get('/catalog', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await service.listCatalog(req.user!.tenantId);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.get(
  '/integrations',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.listIntegrations(req.user!.tenantId);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

const connectBody = z.object({
  credentials: z.record(z.unknown()),
  display_name: z.string().min(1).max(120).optional(),
  settings: z.record(z.unknown()).optional(),
  default_revenue_account: z.string().min(1).max(64).nullable().optional(),
  default_vat_code: z.string().min(1).max(32).nullable().optional(),
});

router.post(
  '/integrations/:provider/connect',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = connectBody.parse(req.body);
      const integration = await service.connectIntegration(
        req.user!.tenantId,
        req.params.provider,
        body.credentials,
        {
          displayName: body.display_name,
          settings: body.settings,
          defaultRevenueAccount: body.default_revenue_account ?? null,
          defaultVatCode: body.default_vat_code ?? null,
          userId: req.user!.userId,
          auditCtx: auditCtxFromReq(req),
        }
      );
      res.status(201).json({ data: integration });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/integrations/:provider',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await service.disconnectIntegration(
        req.user!.tenantId,
        req.params.provider,
        { userId: req.user!.userId, auditCtx: auditCtxFromReq(req) }
      );
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

export default router;
