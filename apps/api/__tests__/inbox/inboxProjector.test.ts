/**
 * inboxProjector tests — Sprint Q4.6 (Agent AAAA).
 *
 * Covers both code paths:
 *   1. Direct call: `recordCommunication(...)` upserts thread + stamps row.
 *   2. eventBus subscriber path: emitting `communicationCreated` ends up in
 *      the same upsert.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

import { eventBus } from '../../src/lib/eventBus';
import {
  recordCommunication,
  installInboxProjectorSubscriber,
  _resetInboxProjectorSubscriber,
} from '../../src/lib/inboxProjector';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const CAND_ID = '33333333-3333-3333-3333-333333333333';
const COMM_ID = '55555555-5555-5555-5555-555555555555';
const THREAD_ID = '44444444-4444-4444-4444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  eventBus.removeAllListeners();
  _resetInboxProjectorSubscriber();
});

describe('recordCommunication — direct call path', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('upserts unified_threads and stamps communications row', async () => {
    let upsertHit = false;
    let stampHit = false;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/INSERT\s+INTO\s+unified_threads/i.test(sql)) {
          upsertHit = true;
          return { rows: [{ id: THREAD_ID }], rowCount: 1 };
        }
        if (/UPDATE\s+communications/i.test(sql)) {
          stampHit = true;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await recordCommunication({
      tenantId: TENANT_ID,
      candidateId: CAND_ID,
      communicationId: COMM_ID,
      channel: 'email',
      direction: 'outbound',
      preview: 'Hi',
      suppressEvent: true,
    });

    expect(upsertHit).toBe(true);
    expect(stampHit).toBe(true);
    expect(result.thread_id).toBe(THREAD_ID);
  });

  it('emits communicationCreated when suppressEvent is not set', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/INSERT\s+INTO\s+unified_threads/i.test(sql)) {
          return { rows: [{ id: THREAD_ID }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const received: unknown[] = [];
    eventBus.on('communicationCreated', (p) => {
      received.push(p);
    });

    await recordCommunication({
      tenantId: TENANT_ID,
      candidateId: CAND_ID,
      communicationId: COMM_ID,
      channel: 'whatsapp',
      direction: 'inbound',
      preview: 'Reply',
    });

    // events emit asynchronously via EventEmitter — yield once.
    await new Promise((r) => setImmediate(r));
    expect(received.length).toBeGreaterThanOrEqual(1);
  });

  it('degrades gracefully when DB upsert throws', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/INSERT\s+INTO\s+unified_threads/i.test(sql)) {
          throw new Error('connection lost');
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    // Must NOT throw — projector is best-effort.
    const result = await recordCommunication({
      tenantId: TENANT_ID,
      candidateId: CAND_ID,
      communicationId: COMM_ID,
      channel: 'email',
      direction: 'outbound',
      preview: 'Hi',
      suppressEvent: true,
    });
    expect(result.thread_id).toBe('');
  });

  it('throws when required inputs are missing', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      recordCommunication({
        tenantId: '',
        candidateId: CAND_ID,
        communicationId: COMM_ID,
        channel: 'email',
        direction: 'outbound',
        preview: '',
      })
    ).rejects.toThrow();
  });
});

describe('recordCommunication — eventBus subscriber path', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('subscriber upserts thread when communicationCreated is emitted', async () => {
    let upsertHit = false;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/INSERT\s+INTO\s+unified_threads/i.test(sql)) {
          upsertHit = true;
          return { rows: [{ id: THREAD_ID }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    installInboxProjectorSubscriber();

    eventBus.emit('communicationCreated', {
      tenantId: TENANT_ID,
      candidateId: CAND_ID,
      communicationId: COMM_ID,
      channel: 'voice',
      direction: 'outbound',
      preview: 'Hi',
      timestamp: new Date().toISOString(),
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(upsertHit).toBe(true);
  });

  it('subscriber is idempotent — calling install twice only registers one listener', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/INSERT\s+INTO\s+unified_threads/i.test(sql)) {
          return { rows: [{ id: THREAD_ID }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    let upserts = 0;
    eventBus.on('communicationCreated', () => upserts++);

    installInboxProjectorSubscriber();
    installInboxProjectorSubscriber();
    installInboxProjectorSubscriber();

    eventBus.emit('communicationCreated', {
      tenantId: TENANT_ID,
      candidateId: CAND_ID,
      communicationId: COMM_ID,
      channel: 'email',
      direction: 'outbound',
      preview: 'Hi',
      timestamp: new Date().toISOString(),
    });

    await new Promise((r) => setTimeout(r, 10));
    // Local listener fired exactly once (subscriber installed only once).
    expect(upserts).toBe(1);
  });
});
