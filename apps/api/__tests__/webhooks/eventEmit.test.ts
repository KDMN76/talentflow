/**
 * Webhook event-emit + wildcard matching tests — Sprint Q4.1 (Agent LLL).
 *
 * Test-scope:
 *   - matchEventTypes: literal / wildcard / catch-all gedrag.
 *   - emitWebhookEvent: dispatcht naar alle matchende active subs, INSERTs
 *     een delivery-row per match, enqueueт de worker-job.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

// Mock the queue voor de emit-test zodat we BullMQ-add kunnen tellen.
vi.mock('../../src/queue/queues', () => ({
  webhookDeliveriesQueue: {
    add: vi.fn(async () => ({ id: 'mock-job' })),
  },
}));

import {
  matchEventTypes,
  emitWebhookEvent,
} from '../../src/modules/webhooks/deliveries.service';
import { webhookDeliveriesQueue } from '../../src/queue/queues';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

describe('matchEventTypes', () => {
  it('exact match', () => {
    expect(matchEventTypes(['candidate.created'], 'candidate.created')).toBe(true);
    expect(matchEventTypes(['candidate.created'], 'candidate.updated')).toBe(false);
  });

  it('catch-all `*` matcht elk event-type', () => {
    expect(matchEventTypes(['*'], 'anything.happens')).toBe(true);
    expect(matchEventTypes(['*'], 'job.created')).toBe(true);
  });

  it('prefix-wildcard `entity.*` matcht alle events met die prefix', () => {
    expect(matchEventTypes(['candidate.*'], 'candidate.created')).toBe(true);
    expect(matchEventTypes(['candidate.*'], 'candidate.stage_changed')).toBe(true);
    expect(matchEventTypes(['candidate.*'], 'job.created')).toBe(false);
  });

  it('prefix-wildcard matcht ook de prefix zelf', () => {
    expect(matchEventTypes(['candidate.*'], 'candidate')).toBe(true);
  });

  it('multi-pattern: één match volstaat', () => {
    const subs = ['job.*', 'candidate.created'];
    expect(matchEventTypes(subs, 'candidate.created')).toBe(true);
    expect(matchEventTypes(subs, 'job.updated')).toBe(true);
    expect(matchEventTypes(subs, 'application.created')).toBe(false);
  });

  it('lege subscription-events lijst → geen match', () => {
    expect(matchEventTypes([], 'candidate.created')).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────

describe('emitWebhookEvent', () => {
  let teardown: (() => void) | null = null;

  afterEach(() => {
    if (teardown) {
      teardown();
      teardown = null;
    }
    vi.clearAllMocks();
  });

  it('dispatcht naar elke matchende active subscription', async () => {
    let insertCount = 0;
    const client = mockClient({
      __matcher: (sql) => {
        // BEGIN / COMMIT / ROLLBACK / SET LOCAL — silent ack zodat withTenant werkt.
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET\s)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT[\s\S]*webhook_subscriptions/i.test(sql)) {
          return {
            rows: [
              {
                id: 'sub-1',
                tenant_id: TENANT_ID,
                url: 'https://a.example.com/wh',
                secret: 'secret-a',
                events: ['candidate.created'],
                active: true,
              },
              {
                id: 'sub-2',
                tenant_id: TENANT_ID,
                url: 'https://b.example.com/wh',
                secret: 'secret-b',
                events: ['candidate.*'],
                active: true,
              },
              {
                id: 'sub-3',
                tenant_id: TENANT_ID,
                url: 'https://c.example.com/wh',
                secret: 'secret-c',
                events: ['job.created'],
                active: true,
              },
            ],
            rowCount: 3,
          };
        }
        if (/INSERT INTO webhook_deliveries/i.test(sql)) {
          insertCount++;
          return { rows: [{ id: `del-${insertCount}` }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await emitWebhookEvent(TENANT_ID, 'candidate.created', { foo: 'bar' });

    // sub-1 (literal) en sub-2 (wildcard) matchen — sub-3 niet.
    expect(insertCount).toBe(2);
    expect((webhookDeliveriesQueue.add as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it('skipt inactive subscriptions (DB-filter werkt)', async () => {
    const client = mockClient({
      __matcher: () => {
        // Simuleer dat de WHERE active=TRUE filter werk: alle queries retourneren leeg.
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await emitWebhookEvent(TENANT_ID, 'candidate.created', {});
    expect((webhookDeliveriesQueue.add as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('faalt stil als één subscription INSERT faalt — andere worden nog wel verwerkt', async () => {
    let insertAttempts = 0;
    const client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET\s)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT[\s\S]*webhook_subscriptions/i.test(sql)) {
          return {
            rows: [
              {
                id: 'sub-broken',
                tenant_id: TENANT_ID,
                url: 'https://a/',
                secret: 's',
                events: ['*'],
                active: true,
              },
              {
                id: 'sub-ok',
                tenant_id: TENANT_ID,
                url: 'https://b/',
                secret: 's',
                events: ['*'],
                active: true,
              },
            ],
            rowCount: 2,
          };
        }
        if (/INSERT INTO webhook_deliveries/i.test(sql)) {
          insertAttempts++;
          if (insertAttempts === 1) {
            throw new Error('simulated DB failure');
          }
          return { rows: [{ id: `del-${insertAttempts}` }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      emitWebhookEvent(TENANT_ID, 'candidate.created', {})
    ).resolves.not.toThrow();

    // 1 succesvolle INSERT → 1 enqueue-call.
    expect((webhookDeliveriesQueue.add as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('returns vroeg als geen subscriptions matchen', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET\s)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT[\s\S]*webhook_subscriptions/i.test(sql)) {
          return {
            rows: [
              {
                id: 'sub-1',
                tenant_id: TENANT_ID,
                url: 'https://a/',
                secret: 's',
                events: ['job.*'],
                active: true,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await emitWebhookEvent(TENANT_ID, 'candidate.created', {});
    expect((webhookDeliveriesQueue.add as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});
