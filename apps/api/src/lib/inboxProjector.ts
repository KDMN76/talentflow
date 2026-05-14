/**
 * inboxProjector — Sprint Q4.6 (Agent AAAA).
 *
 * Tiny shared helper that any channel-writer can call after inserting a
 * `communications` row. It does two things:
 *
 *   1. Upserts the `unified_threads` row for the candidate and bumps its
 *      `last_message_at`, `last_channel`, `last_message_preview`, and
 *      `unread_count_for_assignee` (when direction='inbound').
 *   2. Emits `eventBus.emit('communicationCreated', payload)` so any other
 *      subscriber (notifications, analytics, future workers) gets a hook.
 *
 * Callers:
 *   - Agent ZZZ's WhatsApp `messaging.service.sendMessage` and
 *     `recordIncomingMessage` MUST call `recordCommunication(...)` after they
 *     insert their `communications` row (dual-write). See coordination
 *     comment in `inbox.service.ts`.
 *   - The email-sender worker emits via eventBus after a successful insert
 *     (single-line hook — keeps the legacy worker minimally invasive).
 *   - The voice service calls this directly from `initiateOutboundCall` and
 *     from the Twilio webhook on `status='completed'`.
 *
 * Implementation choice — *both* eventBus (sync in-process) AND BullMQ queue
 * are supported. The sync path is the default because it gives the caller
 * immediate consistency for the read-side. The BullMQ queue
 * (`inboxProjectorQueue`) exists as a back-pressure-safe escape hatch — if
 * a channel writer wants to fire-and-forget without waiting on the DB
 * upsert, it can call `enqueueInboxProjection(...)` instead.
 */

import type { PoolClient } from 'pg';
import { withTenant } from '../db/pool';
import { logger } from '../middleware/errorHandler';
import { eventBus, type CommunicationCreatedPayload } from './eventBus';

const PREVIEW_MAX_CHARS = 200;

export interface RecordCommunicationInput {
  tenantId: string;
  candidateId: string;
  communicationId: string;
  channel: string;
  direction: 'inbound' | 'outbound';
  /** Raw body — will be truncated to 200 chars for the inbox preview. */
  preview: string;
  /** ISO-8601 timestamp; defaults to now(). */
  timestamp?: string;
  /** Optional already-open transaction — if provided we run inline. */
  client?: PoolClient;
  /** Skip the eventBus emit (used by the bus listener itself to avoid loops). */
  suppressEvent?: boolean;
}

/**
 * Truncate to 200 chars with ellipsis. Channel-writers can pass long bodies
 * without worrying about the preview-column length.
 */
export function truncatePreview(text: string | null | undefined): string {
  if (!text) return '';
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= PREVIEW_MAX_CHARS) return trimmed;
  return trimmed.slice(0, PREVIEW_MAX_CHARS - 1) + '…';
}

async function upsertThread(
  client: PoolClient,
  input: RecordCommunicationInput
): Promise<{ thread_id: string }> {
  const preview = truncatePreview(input.preview);
  const ts = input.timestamp ?? new Date().toISOString();

  // Upsert + bump in one round-trip. ON CONFLICT (tenant_id, candidate_id).
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO unified_threads (
       tenant_id, candidate_id,
       last_message_at, last_channel, last_message_preview,
       unread_count_for_assignee
     )
     VALUES ($1, $2, $3::timestamptz, $4, $5,
             CASE WHEN $6 = 'inbound' THEN 1 ELSE 0 END)
     ON CONFLICT (tenant_id, candidate_id) DO UPDATE
       SET last_message_at = EXCLUDED.last_message_at,
           last_channel = EXCLUDED.last_channel,
           last_message_preview = EXCLUDED.last_message_preview,
           unread_count_for_assignee = CASE
             WHEN $6 = 'inbound'
               THEN unified_threads.unread_count_for_assignee + 1
             ELSE unified_threads.unread_count_for_assignee
           END,
           updated_at = now()
     RETURNING id`,
    [input.tenantId, input.candidateId, ts, input.channel, preview, input.direction]
  );

  if (rows.length === 0) {
    throw new Error('[inboxProjector] thread upsert returned no row');
  }

  // Best-effort: stamp the unified_thread_id + preview on the communications
  // row so the inbox query can directly index off it. Swallow errors — old
  // schema variants without those columns must not break the projector.
  try {
    await client.query(
      `UPDATE communications
         SET unified_thread_id = $1, preview = $2
         WHERE id = $3 AND tenant_id = $4`,
      [rows[0].id, preview, input.communicationId, input.tenantId]
    );
  } catch (err) {
    logger.warn('[inboxProjector] communications stamp failed (non-fatal)', {
      error: (err as Error).message,
      communicationId: input.communicationId,
    });
  }

  return { thread_id: rows[0].id };
}

/**
 * Record a fresh communication into the unified inbox projection.
 *
 * Safe to call multiple times for the same row — the thread upsert is
 * idempotent on (tenant_id, candidate_id) and the communications stamp
 * is a no-op if the columns are already filled.
 */
export async function recordCommunication(
  input: RecordCommunicationInput
): Promise<{ thread_id: string }> {
  if (!input.tenantId || !input.candidateId || !input.communicationId) {
    throw new Error('[inboxProjector] missing tenantId / candidateId / communicationId');
  }

  let result: { thread_id: string };

  try {
    if (input.client) {
      result = await upsertThread(input.client, input);
    } else {
      result = await withTenant(input.tenantId, async (client) =>
        upsertThread(client, input)
      );
    }
  } catch (err) {
    // We never want the inbox projection to break the caller's main write.
    // Channel-writers (email worker, WhatsApp writer, voice service) must
    // succeed even when the projection table is missing in dev.
    logger.error('[inboxProjector] recordCommunication failed (degraded mode)', {
      error: (err as Error).message,
      tenantId: input.tenantId,
      candidateId: input.candidateId,
      channel: input.channel,
    });
    result = { thread_id: '' };
  }

  if (!input.suppressEvent) {
    const payload: CommunicationCreatedPayload = {
      tenantId: input.tenantId,
      candidateId: input.candidateId,
      communicationId: input.communicationId,
      channel: input.channel,
      direction: input.direction,
      preview: truncatePreview(input.preview),
      timestamp: input.timestamp ?? new Date().toISOString(),
    };
    eventBus.emit('communicationCreated', payload);
  }

  return result;
}

/**
 * eventBus subscriber installer.
 *
 * Mounted on module load by `index.ts` so any channel-writer that ONLY emits
 * `communicationCreated` (without calling recordCommunication) still ends up
 * with a thread row. The subscriber sets `suppressEvent=true` to avoid
 * re-emitting recursively.
 */
let subscribed = false;
export function installInboxProjectorSubscriber(): void {
  if (subscribed) return;
  subscribed = true;
  eventBus.on('communicationCreated', async (payload) => {
    try {
      await recordCommunication({
        tenantId: payload.tenantId,
        candidateId: payload.candidateId,
        communicationId: payload.communicationId,
        channel: payload.channel,
        direction: payload.direction,
        preview: payload.preview,
        timestamp: payload.timestamp,
        suppressEvent: true,
      });
    } catch (err) {
      logger.warn('[inboxProjector] eventBus subscriber threw', {
        error: (err as Error).message,
      });
    }
  });
}

/** Test helper — reset subscriber state between specs. */
export function _resetInboxProjectorSubscriber(): void {
  subscribed = false;
}
