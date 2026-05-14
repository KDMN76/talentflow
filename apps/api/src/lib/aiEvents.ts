/**
 * AI-inference event logging — EU AI Act compliance.
 *
 * Elke AI-call (resume parser, match-explanation, embeddings, JD generator,
 * bias check) schrijft hier één rij. We slaan GEEN ruwe input op — alleen
 * een SHA-256 hash. Dat is voldoende om consistent dezelfde input te
 * detecteren (cache-hit ratio, herhaalde hits) zonder kandidaat-CV's
 * onbedoeld te dupliceren in een audit-tabel.
 *
 * Implementatie-notes:
 *   - We gebruiken een EIGEN withTenant-transactie i.p.v. piggybacken op
 *     de caller. Reden: als de AI-call slaagde maar logging faalt, willen
 *     we de AI-output niet weggooien. Een aparte tx isoleert dat falen.
 *   - Audit-fail mag NOOIT de caller laten falen — alleen Sentry + log.
 *   - `outputSummary` wordt op 200 chars getrunceerd (UI-vriendelijk).
 */

import { createHash } from 'crypto';
import { withTenant } from '../db/pool';
import { logger } from '../middleware/errorHandler';
import { Sentry } from './sentry';

export type AIFeature =
  | 'resume_parser'
  | 'match_explanation'
  | 'embedding'
  | 'jd_generator'
  | 'bias_check'
  | string;

export type AIProvider = 'anthropic' | 'openai' | string;

export type AIStatus = 'success' | 'failed' | 'mocked';

export interface AIEventPayload {
  feature: AIFeature;
  model: string;
  provider: AIProvider;
  /** Ruwe input (CV-tekst, prompt, etc.). Wordt SHA-256-gehasht voor opslag. */
  input: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Korte samenvatting van wat AI deed — getrunceerd op 200 chars in lib. */
  outputSummary?: string | null;
  latencyMs: number;
  costCents?: number | null;
  entityType?: string | null;
  entityId?: string | null;
  cached?: boolean;
  userId?: string | null;
  status?: AIStatus;
  error?: string | null;
}

const OUTPUT_SUMMARY_MAX = 200;

function hashInput(input: string): string {
  return createHash('sha256').update(input ?? '').digest('hex');
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (value.length <= max) return value;
  return value.slice(0, max);
}

/**
 * Log an AI inference event. Tenant-isolated via RLS through `withTenant`.
 *
 * Returnt void en throwt nooit — failures gaan naar Sentry + structured log.
 * Caller is dus altijd safe to ignore (`void logAIEvent(...)`).
 */
export async function logAIEvent(
  tenantId: string,
  payload: AIEventPayload
): Promise<void> {
  try {
    const inputHash = hashInput(payload.input);
    const summary = truncate(payload.outputSummary ?? null, OUTPUT_SUMMARY_MAX);
    const status: AIStatus = payload.status ?? 'success';

    await withTenant(tenantId, async (client) => {
      await client.query(
        `INSERT INTO ai_events
           (tenant_id, user_id, feature, model, provider,
            input_hash, input_tokens, output_tokens, output_summary,
            latency_ms, cost_cents, entity_type, entity_id,
            cached, status, error)
         VALUES ($1, $2, $3, $4, $5,
                 $6, $7, $8, $9,
                 $10, $11, $12, $13,
                 $14, $15, $16)`,
        [
          tenantId,
          payload.userId ?? null,
          payload.feature,
          payload.model,
          payload.provider,
          inputHash,
          payload.inputTokens ?? null,
          payload.outputTokens ?? null,
          summary,
          Math.max(0, Math.round(payload.latencyMs)),
          payload.costCents ?? null,
          payload.entityType ?? null,
          payload.entityId ?? null,
          payload.cached ?? false,
          status,
          payload.error ?? null,
        ]
      );
    });
  } catch (err) {
    logger.error('[aiEvents] failed to insert ai_events row', {
      feature: payload.feature,
      model: payload.model,
      provider: payload.provider,
      entityType: payload.entityType,
      entityId: payload.entityId,
      error: (err as Error).message,
    });
    try {
      Sentry.captureException(err, {
        tags: {
          subsystem: 'ai_events',
          feature: payload.feature,
          provider: payload.provider,
        },
      });
    } catch {
      /* swallow */
    }
  }
}
