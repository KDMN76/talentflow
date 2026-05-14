/**
 * Lightweight in-process event bus for cross-module hooks.
 *
 * Sprint Q4.5 — created by Agent XXX to subscribe to Agent WWW's
 * `findingApproved` event without hard-coupling the modules. WWW emits via
 * `eventBus.emit('findingApproved', payload)` from its runs.service when a
 * recruiter approves an `agent_findings` row. XXX subscribes from
 * `outreach.service.subscribeToSourcingEvents()` and auto-enrolls the
 * candidate into `tenant_settings.default_sourcing_sequence_id` if set.
 *
 * Design notes:
 *   - Plain Node `EventEmitter` — no Redis pubsub needed because both modules
 *     run in the same Node process (api + workers share a binary).
 *   - All listeners are sync-or-async; we wrap async errors so an exception in
 *     one subscriber never breaks another. Errors are logged + Sentry-captured.
 *   - Listeners are typed via the `EventMap` interface; new event types should
 *     be added there to keep emitters and subscribers in sync.
 */

import { EventEmitter } from 'events';
import { logger } from '../middleware/errorHandler';
import { Sentry } from './sentry';

export interface FindingApprovedPayload {
  tenantId: string;
  findingId: string;
  candidateId: string;
  briefId?: string | null;
  approvedBy?: string | null;
}

export interface OutreachMessageSentPayload {
  tenantId: string;
  messageId: string;
  candidateId: string;
  channel: string;
  externalId: string | null;
}

export interface ReplyReceivedPayload {
  tenantId: string;
  messageId: string;
  candidateId: string;
  parentMessageId: string;
}

/**
 * Sprint Q4.6 — Agent AAAA (omni-channel inbox).
 *
 * Emitted by `lib/inboxProjector.ts.recordCommunication(...)` AND by any
 * channel-writer that already has a `communications` row (email worker after
 * INSERT, WhatsApp writer after INSERT, voice service after INSERT). The
 * inbox projector subscribes here so cross-channel `unified_threads` updates
 * happen even when the writer didn't explicitly call the helper.
 */
export interface CommunicationCreatedPayload {
  tenantId: string;
  candidateId: string;
  communicationId: string;
  channel: string;
  direction: 'inbound' | 'outbound';
  preview: string;
  timestamp: string;
}

/**
 * Sprint Q4.6 — Agent ZZZ (WhatsApp Business).
 *
 * Emitted by `whatsapp/messaging.service.recordIncomingMessage` after an
 * inbound WhatsApp message is persisted. Subscribers may auto-resolve the
 * `pending_approval` opt-in keyword, surface notifications, or react to
 * candidate replies.
 */
export interface WhatsAppMessageReceivedPayload {
  tenantId: string;
  messageId: string;
  candidateId: string | null;
  phoneNumber: string;
  body: string | null;
  externalId: string | null;
}

/**
 * Emitted when a candidate withdraws WhatsApp consent (via STOP keyword
 * inbound, or recruiter-initiated). `nurture` subscribes to auto-pause any
 * active enrollments for that candidate.
 */
export interface WhatsAppConsentWithdrawnPayload {
  tenantId: string;
  candidateId: string;
  reason: string;
}

/**
 * Emitted when a candidate grants WhatsApp consent via any of: reply
 * keyword, public landing-page accept, or imported flag.
 */
export interface WhatsAppConsentGrantedPayload {
  tenantId: string;
  candidateId: string;
  phoneNumber: string;
  source: 'career_page' | 'recruiter_invite' | 'reply' | 'imported';
}

export interface EventMap {
  findingApproved: FindingApprovedPayload;
  outreachMessageSent: OutreachMessageSentPayload;
  replyReceived: ReplyReceivedPayload;
  communicationCreated: CommunicationCreatedPayload;
  whatsappMessageReceived: WhatsAppMessageReceivedPayload;
  whatsappConsentWithdrawn: WhatsAppConsentWithdrawnPayload;
  whatsappConsentGranted: WhatsAppConsentGrantedPayload;
}

type EventName = keyof EventMap;

class TypedEventBus {
  private inner = new EventEmitter();

  constructor() {
    // Avoid noisy MaxListenersExceeded warnings; we may have multiple
    // subscribers across modules in a single process.
    this.inner.setMaxListeners(50);
  }

  on<K extends EventName>(
    event: K,
    listener: (payload: EventMap[K]) => void | Promise<void>
  ): void {
    this.inner.on(event, async (payload: EventMap[K]) => {
      try {
        await listener(payload);
      } catch (err) {
        logger.error('[eventBus] subscriber threw', {
          event,
          error: (err as Error).message,
        });
        try {
          Sentry.captureException(err, { tags: { subsystem: 'eventBus', event } });
        } catch {
          /* swallow */
        }
      }
    });
  }

  off<K extends EventName>(
    event: K,
    listener: (payload: EventMap[K]) => void | Promise<void>
  ): void {
    this.inner.off(event, listener);
  }

  emit<K extends EventName>(event: K, payload: EventMap[K]): void {
    // Fire-and-forget: subscribers run on the next tick of the event loop.
    // Caller does not await — use `subscribeToFindingApproved` if you need
    // synchronous guarantees (you don't — these are best-effort hooks).
    this.inner.emit(event, payload);
  }

  /** Test helper — clear all listeners between specs. */
  removeAllListeners(): void {
    this.inner.removeAllListeners();
  }
}

export const eventBus = new TypedEventBus();
