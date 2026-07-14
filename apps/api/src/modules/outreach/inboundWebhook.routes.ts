/**
 * Outreach reply webhook — Sprint Q4.5 (Agent XXX).
 *
 * Mount path: `/api/webhooks/outreach/replies`. Public (no JWT). HMAC-SHA256
 * verified per-tenant via `OUTREACH_REPLY_WEBHOOK_SECRET`. Mirrors the
 * Resend-webhook pattern (see modules/email-inbound/email-inbound.controller).
 *
 * Body shape (generic vendor):
 *   {
 *     tenant_id: uuid,
 *     channel: "email" | "linkedin_inmail" | "linkedin_connection",
 *     external_thread_id: string,
 *     candidate_external_id?: string,
 *     reply_text: string,
 *     sent_at?: ISO8601
 *   }
 *
 * If `external_thread_id` matches an outbound `outreach_messages` row the
 * reply is linked to it; otherwise we surface a 404 so the vendor can retry
 * once the original message has been sent.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { logger } from '../../middleware/errorHandler';
import { recordReply } from './outreach.service';

const router = Router();

const bodySchema = z.object({
  tenant_id: z.string().uuid(),
  channel: z.enum([
    'linkedin_inmail',
    'linkedin_connection',
    'email',
    'sms',
    'whatsapp',
  ]),
  external_thread_id: z.string().min(1),
  candidate_external_id: z.string().optional(),
  reply_text: z.string().min(1),
  sent_at: z.string().datetime().optional(),
});

function verifySignature(req: Request): boolean {
  const secret = process.env.OUTREACH_REPLY_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('[outreachWebhook] secret not configured in production');
      return false;
    }
    logger.warn('[outreachWebhook] no secret configured — signature check skipped');
    return true;
  }

  const provided =
    (req.headers['x-outreach-signature'] as string | undefined) ??
    (req.headers['x-talentflow-signature'] as string | undefined);
  if (!provided) return false;

  // HMAC over de RAW request-body (exact wat de afzender tekende). De
  // express.json()-verify-callback zet req.rawBody; val alleen terug op een
  // her-geserialiseerde body voor oude callers zonder raw-body.
  const raw =
    (req as unknown as { rawBody?: Buffer }).rawBody ??
    JSON.stringify(req.body ?? {});
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const candidates = provided.split(',').map((s) => s.split('=').pop() ?? '');
  const expectedBuf = Buffer.from(expected, 'hex');

  for (const candidate of candidates) {
    if (!candidate) continue;
    let candidateBuf: Buffer;
    try {
      candidateBuf = Buffer.from(candidate, 'hex');
    } catch {
      continue;
    }
    if (
      candidateBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(candidateBuf, expectedBuf)
    ) {
      return true;
    }
  }
  return false;
}

router.post(
  '/outreach/replies',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!verifySignature(req)) {
        res.status(401).json({
          error: {
            code: 'INVALID_SIGNATURE',
            message: 'Webhook-handtekening ongeldig',
          },
        });
        return;
      }

      const parsed = bodySchema.parse(req.body);

      const reply = await recordReply(parsed.tenant_id, {
        channel: parsed.channel,
        externalThreadId: parsed.external_thread_id,
        body_text: parsed.reply_text,
        received_at: parsed.sent_at ?? null,
      });

      res.status(200).json({ data: { id: reply.id, status: 'recorded' } });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
