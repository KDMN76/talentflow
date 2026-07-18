/**
 * WhatsApp authenticated routes — Sprint Q4.6 (Agent ZZZ).
 *
 * Mount path: `/api/whatsapp`. All routes require JWT + tenant context. Zod
 * validation. Audit handled in the service layer.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { requirePermission } from '../../middleware/permissions';
import { auditCtxFromReq } from '../../lib/audit';
import * as wa from './whatsapp.service';
import * as templates from './templates.service';
import * as messaging from './messaging.service';
import * as consent from './consent.service';
import * as dialog360 from './connector/dialog360';

const router = Router();
router.use(requireAuth, tenantMiddleware);

// Verzenden/wijzigen vereist `communications:write` — read-only rollen
// (viewer) konden eerst zonder check integraties (her)koppelen, templates
// beheren, berichten versturen en consent intrekken (viewer-gap, zelfde
// patroon als communications.router.ts). Read-routes blijven ongeguard zodat
// viewer-rollen WhatsApp-data nog kunnen inzien.

// ───────────────────────────────────────────────────────────────────────────
// Schemas
// ───────────────────────────────────────────────────────────────────────────

const integrationConnectBody = z.object({
  phone_number: z.string().min(5).max(20).regex(/^\+\d+$/, 'E.164 phone number required'),
  api_key: z.string().min(8),
  waba_id: z.string().optional().nullable(),
  display_name: z.string().optional().nullable(),
  webhook_secret: z.string().optional().nullable(),
});

const templateStatusEnum = z.enum([
  'draft',
  'submitted',
  'approved',
  'rejected',
  'paused',
  'disabled',
]);

const templateHeaderSchema = z
  .object({
    type: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT']),
    text: z.string().optional(),
    media_url: z.string().url().optional(),
  })
  .nullable()
  .optional();

const createTemplateBody = z.object({
  name: z.string().min(1).max(80),
  language: z.string().min(2).max(10),
  category: z.enum(['marketing', 'utility', 'authentication']),
  header: templateHeaderSchema,
  body: z.string().min(1).max(4000),
  footer: z.string().max(500).optional().nullable(),
  buttons: z.array(z.record(z.unknown())).optional(),
  example_variables: z.array(z.unknown()).optional(),
});

const updateTemplateBody = z.object({
  header: templateHeaderSchema,
  body: z.string().max(4000).optional(),
  footer: z.string().max(500).optional().nullable(),
  buttons: z.array(z.record(z.unknown())).optional(),
  example_variables: z.array(z.unknown()).optional(),
  category: z.enum(['marketing', 'utility', 'authentication']).optional(),
});

const listTemplatesQuery = z.object({
  status: templateStatusEnum.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const sendMessageBody = z.object({
  candidate_id: z.string().uuid(),
  kind: z.enum(['text', 'template', 'media']),
  body: z.string().optional(),
  template_id: z.string().uuid().optional(),
  variables: z.array(z.unknown()).optional(),
  media_url: z.string().url().optional(),
  media_type: z.enum(['image', 'video', 'document', 'audio']).optional(),
  caption: z.string().optional(),
  reply_to_id: z.string().uuid().optional(),
});

const listMessagesQuery = z.object({
  candidate_id: z.string().uuid().optional(),
  direction: z.enum(['outbound', 'inbound']).optional(),
  status: z.enum(['queued', 'sent', 'delivered', 'read', 'failed', 'received']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const consentInviteBody = z.object({
  candidate_id: z.string().uuid(),
  phone_number: z.string().min(5).max(20).regex(/^\+\d+$/),
});

const consentWithdrawBody = z.object({
  reason: z.string().min(1).max(500),
});

const listConsentsQuery = z.object({
  status: z.enum(['pending', 'granted', 'withdrawn', 'blocked']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// ───────────────────────────────────────────────────────────────────────────
// Integration
// ───────────────────────────────────────────────────────────────────────────

router.get('/integration', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const integration = await wa.getIntegration(req.user!.tenantId);
    // service_active: kan WhatsApp in deze omgeving echt gebruikt worden?
    // In productie zonder live 360dialog-config is dit false — de UI toont
    // dan een eerlijke "WhatsApp is niet geactiveerd"-staat.
    res.json({ data: integration, service_active: dialog360.isServiceActive() });
  } catch (err) {
    next(err);
  }
});

router.post('/integration/connect', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    const body = integrationConnectBody.parse(req.body);
    const integration = await wa.connectIntegration(
      req.user!.tenantId,
      {
        phone_number: body.phone_number,
        api_key: body.api_key,
        waba_id: body.waba_id ?? null,
        display_name: body.display_name ?? null,
        webhook_secret: body.webhook_secret ?? null,
      },
      { userId: req.user!.userId, auditCtx: auditCtxFromReq(req) }
    );
    res.status(201).json({ data: integration });
  } catch (err) {
    next(err);
  }
});

router.delete('/integration', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    await wa.disconnectIntegration(req.user!.tenantId, {
      userId: req.user!.userId,
      auditCtx: auditCtxFromReq(req),
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post('/integration/health-check', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    const integration = await wa.healthCheck(req.user!.tenantId, {
      userId: req.user!.userId,
      auditCtx: auditCtxFromReq(req),
    });
    res.json({ data: integration });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Templates
// ───────────────────────────────────────────────────────────────────────────

router.get('/templates', async (req, res, next) => {
  try {
    const q = listTemplatesQuery.parse(req.query);
    const result = await templates.listTemplates(req.user!.tenantId, q);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/templates', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    const body = createTemplateBody.parse(req.body);
    const row = await templates.createTemplate(req.user!.tenantId, body, {
      userId: req.user!.userId,
      auditCtx: auditCtxFromReq(req),
    });
    res.status(201).json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.patch('/templates/:id', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const body = updateTemplateBody.parse(req.body);
    const row = await templates.updateTemplate(req.user!.tenantId, id, body, {
      userId: req.user!.userId,
      auditCtx: auditCtxFromReq(req),
    });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.delete('/templates/:id', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    await templates.deleteTemplate(req.user!.tenantId, id, {
      userId: req.user!.userId,
      auditCtx: auditCtxFromReq(req),
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post('/templates/:id/submit', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const row = await templates.submitTemplate(req.user!.tenantId, id, {
      userId: req.user!.userId,
      auditCtx: auditCtxFromReq(req),
    });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.post('/templates/:id/sync', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const row = await templates.syncTemplateStatus(req.user!.tenantId, id, {
      userId: req.user!.userId,
      auditCtx: auditCtxFromReq(req),
    });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Messages
// ───────────────────────────────────────────────────────────────────────────

router.get('/messages', async (req, res, next) => {
  try {
    const q = listMessagesQuery.parse(req.query);
    const result = await messaging.listMessages(req.user!.tenantId, q);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/messages/:id', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const row = await messaging.getMessage(req.user!.tenantId, id);
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.post('/messages', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    const body = sendMessageBody.parse(req.body);
    const row = await messaging.sendMessage(
      req.user!.tenantId,
      body.candidate_id,
      {
        kind: body.kind,
        body: body.body,
        templateId: body.template_id,
        variables: body.variables,
        mediaUrl: body.media_url,
        mediaType: body.media_type,
        caption: body.caption,
        replyToId: body.reply_to_id,
      },
      { userId: req.user!.userId, auditCtx: auditCtxFromReq(req) }
    );
    res.status(202).json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.get('/conversations', async (req, res, next) => {
  try {
    const candidateId = req.query.candidate_id
      ? z.string().uuid().parse(req.query.candidate_id)
      : undefined;
    const result = await messaging.listConversations(req.user!.tenantId, {
      candidate_id: candidateId,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Consents
// ───────────────────────────────────────────────────────────────────────────

router.get('/consents', async (req, res, next) => {
  try {
    const q = listConsentsQuery.parse(req.query);
    const result = await consent.listConsents(req.user!.tenantId, q);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/consents/:candidate_id', async (req, res, next) => {
  try {
    const candidateId = z.string().uuid().parse(req.params.candidate_id);
    const row = await consent.getConsent(req.user!.tenantId, candidateId);
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

router.post('/consents/invite', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    const body = consentInviteBody.parse(req.body);
    const result = await consent.issueOptInInvite(
      req.user!.tenantId,
      body.candidate_id,
      body.phone_number,
      { userId: req.user!.userId, auditCtx: auditCtxFromReq(req) }
    );
    res.status(201).json({
      data: { token_url: result.token_url, expires_at: result.expires_at },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/consents/:candidate_id/withdraw', requirePermission('communications', 'write'), async (req, res, next) => {
  try {
    const candidateId = z.string().uuid().parse(req.params.candidate_id);
    const body = consentWithdrawBody.parse(req.body);
    const row = await consent.withdrawConsent(req.user!.tenantId, candidateId, body.reason, {
      userId: req.user!.userId,
      auditCtx: auditCtxFromReq(req),
    });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

export default router;
