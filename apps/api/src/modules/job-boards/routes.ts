/**
 * Job-board HTTP routes — Sprint Q4.3 (Agent QQQ).
 *
 * Mount path: `/api/job-boards` (zie src/index.ts).
 *
 * Alle routes vereisen JWT (`requireAuth`) + tenant-context (`tenantMiddleware`).
 * Validatie via zod. Audit-events worden door de service-laag geschreven.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { auditCtxFromReq } from '../../lib/audit';
import * as service from './service';
import {
  getAutoPostSettings,
  updateAutoPostSettings,
} from './autoPost.service';

const router = Router();
router.use(requireAuth, tenantMiddleware);

// ── /auto-post-settings ──────────────────────────────────────────────────
// Tenant opt-in: automatisch posten bij publiceren (default UIT) + de
// standaard-boards waarnaar geplaatst wordt.
router.get(
  '/auto-post-settings',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await getAutoPostSettings(req.user!.tenantId);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

const autoPostSettingsSchema = z.object({
  enabled: z.boolean(),
  boards: z.array(z.string().min(1)).max(20).default([]),
});

router.put(
  '/auto-post-settings',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = autoPostSettingsSchema.parse(req.body);
      const data = await updateAutoPostSettings(req.user!.tenantId, body);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

// ── /catalog ─────────────────────────────────────────────────────────────
router.get(
  '/catalog',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.listCatalog(req.user!.tenantId);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

// ── /integrations ────────────────────────────────────────────────────────
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

const connectBodySchema = z.object({
  credentials: z.record(z.unknown()),
  display_name: z.string().min(1).max(120).optional(),
  settings: z.record(z.unknown()).optional(),
});

router.post(
  '/integrations/:boardId/connect',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = connectBodySchema.parse(req.body);
      const integration = await service.connectIntegration(
        req.user!.tenantId,
        req.params.boardId,
        body.credentials,
        {
          displayName: body.display_name,
          settings: body.settings,
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
  '/integrations/:boardId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await service.disconnectIntegration(
        req.user!.tenantId,
        req.params.boardId,
        {
          userId: req.user!.userId,
          auditCtx: auditCtxFromReq(req),
        }
      );
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

// ── /postings ────────────────────────────────────────────────────────────
const listPostingsQuery = z.object({
  job_id: z.string().uuid().optional(),
  status: z
    .enum(['queued', 'posted', 'rejected', 'expired', 'retracted', 'failed'])
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

router.get(
  '/postings',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = listPostingsQuery.parse(req.query);
      const result = await service.listPostings(req.user!.tenantId, {
        jobId: q.job_id,
        status: q.status,
        cursor: q.cursor,
        limit: q.limit,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/postings/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.getPosting(
        req.user!.tenantId,
        req.params.id
      );
      if (!result) {
        res.status(404).json({
          error: {
            code: 'POSTING_NOT_FOUND',
            message: 'Vacatureplaatsing niet gevonden',
            details: {},
          },
        });
        return;
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

const createPostingsSchema = z.object({
  job_id: z.string().uuid(),
  board_ids: z.array(z.string().min(1)).min(1).max(20),
});

router.post(
  '/postings',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createPostingsSchema.parse(req.body);
      const auditCtx = auditCtxFromReq(req);
      const created = [];
      for (const boardId of body.board_ids) {
        const posting = await service.enqueuePosting(
          req.user!.tenantId,
          body.job_id,
          boardId,
          { userId: req.user!.userId, auditCtx }
        );
        created.push(posting);
      }
      res.status(201).json({ data: created });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/postings/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await service.retractPosting(req.user!.tenantId, req.params.id, {
        userId: req.user!.userId,
        auditCtx: auditCtxFromReq(req),
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

// ── /cost-per-hire ───────────────────────────────────────────────────────
const costPerHireQuery = z.object({
  job_id: z.string().uuid().optional(),
});

router.get(
  '/cost-per-hire',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = costPerHireQuery.parse(req.query);
      const data = await service.getCostPerHire(
        req.user!.tenantId,
        q.job_id
      );
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
