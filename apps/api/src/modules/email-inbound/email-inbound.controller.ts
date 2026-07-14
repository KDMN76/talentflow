import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import * as emailInboundService from './email-inbound.service';
import { logger } from '../../middleware/errorHandler';

/**
 * Verifieert een Resend webhook-handtekening met HMAC-SHA256.
 * Wanneer er geen `RESEND_WEBHOOK_SECRET` is geconfigureerd, slaan we de
 * verificatie over (development convenience). In production hoort deze
 * env var altijd gezet te zijn.
 */
function verifySignature(req: Request): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('[email-inbound] RESEND_WEBHOOK_SECRET ontbreekt in production');
      return false;
    }
    logger.warn('[email-inbound] geen RESEND_WEBHOOK_SECRET — signature-check overgeslagen');
    return true;
  }

  const provided =
    (req.headers['resend-signature'] as string | undefined) ??
    (req.headers['svix-signature'] as string | undefined) ??
    (req.headers['x-resend-signature'] as string | undefined);

  if (!provided) {
    logger.warn('[email-inbound] geen signature-header aanwezig');
    return false;
  }

  // HMAC over de RAW request-body (exact wat Resend/Svix tekende). De
  // express.json()-verify-callback zet req.rawBody; val alleen terug op een
  // her-geserialiseerde body voor oude callers zonder raw-body.
  const raw =
    (req as unknown as { rawBody?: Buffer }).rawBody ??
    JSON.stringify(req.body ?? {});
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');

  // Vergelijk in constant time. Provided kan in `t=...,v1=...` formaat zitten
  // (Svix-stijl) — pak de eerste hex-waarde uit de header.
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
    if (candidateBuf.length === expectedBuf.length &&
        crypto.timingSafeEqual(candidateBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

export async function handleInboundEmail(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!verifySignature(req)) {
      res.status(401).json({
        error: { code: 'INVALID_SIGNATURE', message: 'Webhook-handtekening ongeldig', details: {} },
      });
      return;
    }

    const result = await emailInboundService.handleInboundEmail(req.body);
    // Webhooks moeten altijd 2xx returnen zodra verwerking is gestart;
    // anders blijft Resend het bericht opnieuw aanbieden.
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
