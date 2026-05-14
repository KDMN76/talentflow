/**
 * Omni-channel inbox HTTP routes — Sprint Q4.6 (Agent AAAA).
 *
 * Mount path: `/api/inbox`. All routes require JWT + tenant context.
 * Zod-validated. Audit handled at service layer (mutation paths log audit
 * via withTenant transactions).
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { auditCtxFromReq, logAudit } from '../../lib/audit';
import { withTenant } from '../../db/pool';
import * as inbox from './inbox.service';

const router = Router();
router.use(requireAuth, tenantMiddleware);

const listQuerySchema = z.object({
  unread: z.coerce.boolean().optional(),
  channel: z.string().min(1).max(64).optional(),
  assignee_user_id: z.string().uuid().optional(),
  pinned: z.coerce.boolean().optional(),
  archived: z.coerce.boolean().optional(),
  q: z.string().max(256).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const timelineQuerySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const assignBody = z.object({
  user_id: z.string().uuid().nullable(),
});

const labelBody = z.object({
  label: z.string().min(1).max(64),
});

// ───────────────────────────────────────────────────────────────────────────
// GET /threads — list paginated
// ───────────────────────────────────────────────────────────────────────────

router.get('/threads', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = listQuerySchema.parse(req.query);
    const result = await inbox.listThreads(req.user!.tenantId, q);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// GET /threads/:id
// ───────────────────────────────────────────────────────────────────────────

router.get('/threads/:id', async (req, res, next) => {
  try {
    const thread = await inbox.getThread(req.user!.tenantId, req.params.id);
    res.json({ data: thread });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// GET /threads/:id/timeline
// ───────────────────────────────────────────────────────────────────────────

router.get('/threads/:id/timeline', async (req, res, next) => {
  try {
    const q = timelineQuerySchema.parse(req.query);
    const result = await inbox.getThreadTimeline(
      req.user!.tenantId,
      req.params.id,
      q
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /threads/:id/read
// ───────────────────────────────────────────────────────────────────────────

router.post('/threads/:id/read', async (req, res, next) => {
  try {
    const row = await inbox.markThreadRead(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId
    );
    await withTenant(req.user!.tenantId, async (client) => {
      await logAudit(
        client,
        req.user!.tenantId,
        {
          action: 'thread_read',
          entityType: 'inbox_thread',
          entityId: req.params.id,
          userId: req.user!.userId,
        },
        auditCtxFromReq(req)
      );
    });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /threads/:id/assign
// ───────────────────────────────────────────────────────────────────────────

router.post('/threads/:id/assign', async (req, res, next) => {
  try {
    const body = assignBody.parse(req.body);
    const row = await inbox.assignThread(
      req.user!.tenantId,
      req.params.id,
      body.user_id
    );
    await withTenant(req.user!.tenantId, async (client) => {
      await logAudit(
        client,
        req.user!.tenantId,
        {
          action: 'thread_assigned',
          entityType: 'inbox_thread',
          entityId: req.params.id,
          userId: req.user!.userId,
          after: { assignee_user_id: body.user_id },
        },
        auditCtxFromReq(req)
      );
    });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// pin / unpin
// ───────────────────────────────────────────────────────────────────────────

router.post('/threads/:id/pin', async (req, res, next) => {
  try {
    const row = await inbox.setPinned(req.user!.tenantId, req.params.id, true);
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.post('/threads/:id/unpin', async (req, res, next) => {
  try {
    const row = await inbox.setPinned(req.user!.tenantId, req.params.id, false);
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// archive / unarchive
// ───────────────────────────────────────────────────────────────────────────

router.post('/threads/:id/archive', async (req, res, next) => {
  try {
    const row = await inbox.setArchived(req.user!.tenantId, req.params.id, true);
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.post('/threads/:id/unarchive', async (req, res, next) => {
  try {
    const row = await inbox.setArchived(req.user!.tenantId, req.params.id, false);
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// labels
// ───────────────────────────────────────────────────────────────────────────

router.post('/threads/:id/labels', async (req, res, next) => {
  try {
    const body = labelBody.parse(req.body);
    const row = await inbox.addLabel(req.user!.tenantId, req.params.id, body.label);
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.delete('/threads/:id/labels/:label', async (req, res, next) => {
  try {
    const row = await inbox.removeLabel(
      req.user!.tenantId,
      req.params.id,
      req.params.label
    );
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

export default router;
