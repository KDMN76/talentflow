/**
 * Voice/VoIP HTTP routes — Sprint Q4.6 (Agent AAAA).
 *
 * Mount path: `/api/voice`. All routes require JWT + tenant.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { auditCtxFromReq, logAudit } from '../../lib/audit';
import { withTenant } from '../../db/pool';
import * as voice from './voice.service';

const router = Router();
router.use(requireAuth, tenantMiddleware);

const connectBody = z.object({
  account_sid: z.string().min(5).max(64),
  auth_token: z.string().min(8).max(256),
  phone_number: z
    .string()
    .min(4)
    .max(32)
    .regex(/^[+0-9\s\-()]+$/, 'Ongeldig telefoonnummer'),
});

const listCallsQuery = z.object({
  candidate_id: z.string().uuid().optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
  status: z
    .enum([
      'queued',
      'ringing',
      'in_progress',
      'completed',
      'busy',
      'no_answer',
      'failed',
      'canceled',
      'voicemail',
    ])
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const initiateBody = z.object({
  candidate_id: z.string().uuid(),
  to_number: z.string().optional(),
});

const notesBody = z.object({
  notes: z.string().min(1).max(10_000),
});

router.get('/integration', async (req, res, next) => {
  try {
    const data = await voice.getIntegration(req.user!.tenantId);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.post('/integration/connect', async (req, res, next) => {
  try {
    const body = connectBody.parse(req.body);
    const result = await voice.connectIntegration(
      req.user!.tenantId,
      body,
      req.user!.userId
    );
    await withTenant(req.user!.tenantId, async (client) => {
      await logAudit(
        client,
        req.user!.tenantId,
        {
          action: 'voice_integration_connected',
          entityType: 'voice_integration',
          entityId: result.id,
          userId: req.user!.userId,
          after: { account_sid: result.account_sid, phone_number: result.phone_number },
        },
        auditCtxFromReq(req)
      );
    });
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

router.delete('/integration', async (req, res, next) => {
  try {
    const result = await voice.disconnectIntegration(req.user!.tenantId);
    await withTenant(req.user!.tenantId, async (client) => {
      await logAudit(
        client,
        req.user!.tenantId,
        {
          action: 'voice_integration_disconnected',
          entityType: 'voice_integration',
          entityId: result.id,
          userId: req.user!.userId,
        },
        auditCtxFromReq(req)
      );
    });
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

router.get('/calls', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = listCallsQuery.parse(req.query);
    const result = await voice.listCalls(req.user!.tenantId, q);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/calls/:id', async (req, res, next) => {
  try {
    const call = await voice.getCall(req.user!.tenantId, req.params.id);
    res.json({ data: call });
  } catch (err) {
    next(err);
  }
});

router.post('/calls', async (req, res, next) => {
  try {
    const body = initiateBody.parse(req.body);
    const call = await voice.initiateOutboundCall(req.user!.tenantId, {
      candidateId: body.candidate_id,
      recruiterId: req.user!.userId,
      toNumber: body.to_number,
    });
    await withTenant(req.user!.tenantId, async (client) => {
      await logAudit(
        client,
        req.user!.tenantId,
        {
          action: 'voice_call_initiated',
          entityType: 'voice_call',
          entityId: call.id,
          userId: req.user!.userId,
          after: { candidate_id: call.candidate_id, to_number: call.to_number },
        },
        auditCtxFromReq(req)
      );
    });
    res.status(201).json({ data: call });
  } catch (err) {
    next(err);
  }
});

router.post('/calls/:id/end', async (req, res, next) => {
  try {
    const call = await voice.endCall(req.user!.tenantId, req.params.id);
    res.json({ data: call });
  } catch (err) {
    next(err);
  }
});

router.post('/calls/:id/notes', async (req, res, next) => {
  try {
    const body = notesBody.parse(req.body);
    const call = await voice.recordCallNotes(
      req.user!.tenantId,
      req.params.id,
      body.notes,
      req.user!.userId
    );
    res.json({ data: call });
  } catch (err) {
    next(err);
  }
});

router.post('/calls/:id/transcribe', async (req, res, next) => {
  try {
    const call = await voice.requestTranscription(req.user!.tenantId, req.params.id);
    res.json({ data: call });
  } catch (err) {
    next(err);
  }
});

export default router;
