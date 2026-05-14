/**
 * 360dialog inbound webhook — Sprint Q4.6 (Agent ZZZ).
 *
 * Mount path: `/api/webhooks/whatsapp/:tenantSlug`. Public (no JWT).
 *
 * HMAC verification:
 *   - 360dialog forwards Meta's webhook payloads with an `X-Hub-Signature-256`
 *     header. Secret is the tenant's `webhook_secret_encrypted` (decrypted at
 *     verification time).
 *   - In dev/test (no integration row): we accept the payload but log a warning.
 *
 * Idempotency:
 *   - Inbound messages are deduped by `(tenant_id, external_id)`.
 *   - Status callbacks are upserts so duplicate delivery receipts are no-ops.
 *
 * Cross-tenant isolation:
 *   - The slug → tenant_id lookup is the ONLY source of truth. Even if the
 *     payload contains a tenant-like value, we never trust it.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { withoutTenant } from '../../db/pool';
import { logger } from '../../middleware/errorHandler';
import { findTenantBySlug, loadWebhookSecret } from './whatsapp.service';
import { verifyWebhookSignature } from './connector/dialog360';
import { recordIncomingMessage, markStatusUpdate } from './messaging.service';

const router = Router();

interface ParsedRequest {
  rawBody: string;
  payload: Record<string, unknown> | null;
}

/**
 * The global `express.json()` parser runs BEFORE this router (see index.ts).
 * For HMAC verification we recompute the canonical JSON serialisation of the
 * parsed body — this matches the existing outreach-webhook pattern and is
 * deterministic because both producer (the dialog360 client) and consumer
 * use JSON. If a raw-body middleware is later added (req.rawBody), we'll
 * prefer it.
 */
function parseBody(req: Request): ParsedRequest {
  const rawBodyAttached = (req as Request & { rawBody?: string | Buffer }).rawBody;
  let rawBody: string;
  if (typeof rawBodyAttached === 'string') {
    rawBody = rawBodyAttached;
  } else if (Buffer.isBuffer(rawBodyAttached)) {
    rawBody = rawBodyAttached.toString('utf8');
  } else if (Buffer.isBuffer(req.body)) {
    rawBody = req.body.toString('utf8');
  } else if (typeof req.body === 'string') {
    rawBody = req.body;
  } else {
    rawBody = JSON.stringify(req.body ?? {});
  }
  let payload: Record<string, unknown> | null = null;
  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = null;
    }
  } else if (req.body && typeof req.body === 'object') {
    payload = req.body as Record<string, unknown>;
  }
  return { rawBody, payload };
}

async function resolveTenant(slug: string): Promise<{ id: string; slug: string } | null> {
  return withoutTenant(async (client) => findTenantBySlug(slug, client));
}

router.post(
  '/whatsapp/:tenantSlug',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const slug = req.params.tenantSlug;
      if (!slug || slug.length < 1) {
        res.status(400).json({ error: { code: 'BAD_SLUG', message: 'Tenant-slug ontbreekt' } });
        return;
      }

      const tenant = await resolveTenant(slug);
      if (!tenant) {
        res.status(404).json({ error: { code: 'TENANT_NOT_FOUND', message: 'Onbekende tenant-slug' } });
        return;
      }

      const { rawBody, payload } = parseBody(req);
      if (!payload) {
        res.status(400).json({ error: { code: 'INVALID_BODY', message: 'Body is geen geldige JSON' } });
        return;
      }

      // Signature verification.
      const providedSig =
        (req.headers['x-hub-signature-256'] as string | undefined) ??
        (req.headers['x-360dialog-signature'] as string | undefined);

      const secret = await loadWebhookSecret(tenant.id);
      if (!secret) {
        if (process.env.NODE_ENV === 'production') {
          logger.error('[whatsapp.webhook] no webhook secret configured for tenant', {
            tenantSlug: slug,
          });
          res.status(401).json({
            error: { code: 'NO_WEBHOOK_SECRET', message: 'Webhook secret niet geconfigureerd' },
          });
          return;
        }
        logger.warn('[whatsapp.webhook] no webhook secret — skipping verification (non-prod)', {
          tenantSlug: slug,
        });
      } else if (!verifyWebhookSignature(rawBody, providedSig, secret)) {
        res
          .status(401)
          .json({ error: { code: 'INVALID_SIGNATURE', message: 'Webhook-handtekening ongeldig' } });
        return;
      }

      // 360dialog/Meta webhook structure:
      //   payload.entry[].changes[].value.messages[]   — inbound user messages
      //   payload.entry[].changes[].value.statuses[]   — delivery status updates
      const summary = { messages: 0, statuses: 0, dupes: 0 };
      const entries = (payload.entry as Array<Record<string, unknown>> | undefined) ?? [];
      for (const entry of entries) {
        const changes = (entry.changes as Array<Record<string, unknown>> | undefined) ?? [];
        for (const change of changes) {
          const value = (change.value as Record<string, unknown> | undefined) ?? {};
          const messages =
            (value.messages as Array<Record<string, unknown>> | undefined) ?? [];
          for (const msg of messages) {
            const external_id = msg.id as string | undefined;
            const from_phone = (msg.from as string | undefined) ?? '';
            const type = (msg.type as string | undefined) ?? 'text';
            const text =
              type === 'text'
                ? ((msg.text as Record<string, unknown> | undefined)?.body as string | undefined) ?? null
                : null;
            const timestamp =
              typeof msg.timestamp === 'string' || typeof msg.timestamp === 'number'
                ? new Date(Number(msg.timestamp) * 1000).toISOString()
                : null;
            if (!external_id || !from_phone) continue;
            const phone = from_phone.startsWith('+') ? from_phone : `+${from_phone}`;
            const result = await recordIncomingMessage(tenant.id, {
              external_id,
              from_phone: phone,
              message_type: type,
              body_text: text,
              media_url: null,
              media_mime: null,
              conversation_id:
                (value as { metadata?: { conversation_id?: string } })?.metadata?.conversation_id ??
                null,
              timestamp,
            });
            if (result.isDuplicate) summary.dupes++;
            else summary.messages++;
          }

          const statuses =
            (value.statuses as Array<Record<string, unknown>> | undefined) ?? [];
          for (const st of statuses) {
            const external_id = st.id as string | undefined;
            const statusRaw = st.status as string | undefined;
            if (!external_id || !statusRaw) continue;
            const ts =
              typeof st.timestamp === 'string' || typeof st.timestamp === 'number'
                ? new Date(Number(st.timestamp) * 1000).toISOString()
                : null;
            if (statusRaw === 'delivered' || statusRaw === 'read' || statusRaw === 'failed') {
              await markStatusUpdate(
                tenant.id,
                external_id,
                statusRaw,
                statusRaw === 'delivered'
                  ? { deliveredAt: ts }
                  : statusRaw === 'read'
                    ? { readAt: ts }
                    : undefined,
                statusRaw === 'failed'
                  ? {
                      code: ((st.errors as Array<Record<string, unknown>> | undefined)?.[0]?.code as
                        | string
                        | undefined) ?? null,
                      message:
                        ((st.errors as Array<Record<string, unknown>> | undefined)?.[0]?.title as
                          | string
                          | undefined) ?? null,
                    }
                  : undefined
              );
              summary.statuses++;
            }
          }
        }
      }

      res.status(200).json({ data: summary });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
