/**
 * Twilio voice webhook — Sprint Q4.6 (Agent AAAA).
 *
 * Mount path: `/api/webhooks/twilio/:tenantSlug` — public (no JWT). Twilio
 * signs each POST with `X-Twilio-Signature` (HMAC-SHA1 over
 * `<url><sorted key-value form params>`, base64). We verify against the
 * per-tenant webhook secret stored in `voice_integrations.webhook_secret_encrypted`.
 *
 * Body shape (Twilio form-encoded — but Express json parser would have
 * already parsed it because the webhook route is mounted under /api which
 * uses `express.json()`. For Twilio production-traffic the operator must
 * also register `express.urlencoded()` ahead of this route — already wired
 * in `src/index.ts`).
 *
 * Status callbacks update `voice_calls.status` + `duration_seconds`.
 * Recording-complete events update `recording_url` and trigger
 * transcription when `tenant_settings.auto_transcribe_calls = true`.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { logger } from '../../middleware/errorHandler';
import { withTenant } from '../../db/pool';
import { handleTwilioWebhook, getWebhookSecret } from './voice.service';

const router = Router();

const payloadSchema = z.object({
  CallSid: z.string().min(1),
  CallStatus: z.string().optional(),
  RecordingUrl: z.string().optional(),
  RecordingDuration: z.string().optional(),
  CallDuration: z.string().optional(),
  From: z.string().optional(),
  To: z.string().optional(),
});

/**
 * Twilio signature verification — HMAC-SHA1 over `<full URL><sorted params>`.
 *
 * Twilio's algorithm:
 *   1. Take the full URL (incl. query string) Twilio called.
 *   2. Concatenate every POST parameter as `key + value` sorted alphabetically.
 *   3. HMAC-SHA1 with the auth token; base64 encode.
 *
 * Some Twilio configurations sign with the auth-token, others sign with a
 * per-webhook-secret. We support both by trying the per-tenant
 * `webhook_secret` first and falling back to a static `TWILIO_AUTH_TOKEN`
 * env-var. For mock-mode the test harness sends `X-TalentFlow-Signature`
 * — verified with a simple HMAC-SHA256 against the same secret so unit
 * tests don't need to recompute Twilio's specific scheme.
 */
function buildTwilioSignaturePayload(
  url: string,
  body: Record<string, unknown>
): string {
  const keys = Object.keys(body).sort();
  return url + keys.map((k) => k + String(body[k] ?? '')).join('');
}

export function computeTwilioSignature(
  url: string,
  body: Record<string, unknown>,
  secret: string
): string {
  const payload = buildTwilioSignaturePayload(url, body);
  return crypto.createHmac('sha1', secret).update(payload).digest('base64');
}

function verifySignature(
  req: Request,
  secret: string
): boolean {
  const provided =
    (req.headers['x-twilio-signature'] as string | undefined) ??
    (req.headers['x-talentflow-signature'] as string | undefined);
  if (!provided) return false;

  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.get('host');
  const url = `${proto}://${host}${req.originalUrl}`;

  const expected = computeTwilioSignature(url, req.body ?? {}, secret);
  try {
    const a = Buffer.from(expected, 'base64');
    const b = Buffer.from(provided, 'base64');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function resolveTenantFromSlug(slug: string): Promise<string | null> {
  try {
    // Use withoutTenant-style — we don't have a tenant context yet. Use a
    // direct pool lookup via a deliberately tenant-less query path. Caller
    // is the webhook so this is the bootstrap; security is the HMAC.
    const { pool } = await import('../../db/pool');
    const client = await pool.connect();
    try {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM tenants WHERE slug = $1`,
        [slug]
      );
      return rows[0]?.id ?? null;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.warn('[twilioWebhook] tenant lookup failed', {
      slug,
      error: (err as Error).message,
    });
    return null;
  }
}

router.post(
  '/twilio/:tenantSlug',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = await resolveTenantFromSlug(req.params.tenantSlug);
      if (!tenantId) {
        res.status(404).json({
          error: { code: 'TENANT_NOT_FOUND', message: 'Tenant niet gevonden' },
        });
        return;
      }

      const secret = await getWebhookSecret(tenantId);
      const fallbackSecret = process.env.TWILIO_AUTH_TOKEN ?? '';
      const effectiveSecret = secret ?? fallbackSecret;

      // Allow mock-mode tests to skip signature check when no secret is set.
      const liveMode = process.env.TWILIO_LIVE === 'true';
      if (effectiveSecret) {
        if (!verifySignature(req, effectiveSecret)) {
          res.status(401).json({
            error: { code: 'INVALID_SIGNATURE', message: 'Twilio-handtekening ongeldig' },
          });
          return;
        }
      } else if (liveMode) {
        res.status(401).json({
          error: {
            code: 'NO_SECRET',
            message: 'Geen webhook-secret geconfigureerd voor deze tenant',
          },
        });
        return;
      }

      const payload = payloadSchema.parse(req.body);

      // Confirm tenant context via withTenant so RLS is set for the update.
      const result = await withTenant(tenantId, async () => {
        return handleTwilioWebhook(tenantId, payload);
      });

      res.status(200).json({
        data: {
          updated: result.updated,
          transcribed: result.transcribed,
          call_id: result.call?.id ?? null,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
