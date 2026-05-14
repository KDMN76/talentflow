/**
 * Webhook deliveries service — Sprint Q4.1 (Agent LLL).
 *
 * Test scope:
 *   - backoffMs returneert de spec'ed waarden (1m / 5m / 30m / 2h / 6h).
 *   - retryDelivery zet status terug naar pending + enqueueт de queue.
 *   - listDeliveries/getDeliveryDetails respecteren filters en 404'en netjes.
 *   - deliverWebhook (success path) → status='succeeded', failure_count=0.
 *   - deliverWebhook (failure path attempt < MAX) → status=pending + retry job.
 *   - deliverWebhook (failure path attempt = MAX) → status=dead + audit-event.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

vi.mock('../../src/queue/queues', () => ({
  webhookDeliveriesQueue: {
    add: vi.fn(async () => ({ id: 'mock-job' })),
  },
}));

import {
  RETRY_BACKOFF_MS,
  MAX_ATTEMPTS,
  backoffMs,
  retryDelivery,
  listDeliveries,
  getDeliveryDetails,
  deliverWebhook,
} from '../../src/modules/webhooks/deliveries.service';
import { webhookDeliveriesQueue } from '../../src/queue/queues';
import { AppError } from '../../src/middleware/errorHandler';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const DELIVERY_ID = '22222222-2222-2222-2222-222222222222';
const SUB_ID = '33333333-3333-3333-3333-333333333333';

describe('backoffMs', () => {
  it('volgt de spec: 0 / 1m / 5m / 30m / 2h', () => {
    expect(backoffMs(1)).toBe(0);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(5 * 60_000);
    expect(backoffMs(4)).toBe(30 * 60_000);
    expect(backoffMs(5)).toBe(2 * 60 * 60_000);
  });

  it('MAX_ATTEMPTS is 5', () => {
    expect(MAX_ATTEMPTS).toBe(5);
  });

  it('RETRY_BACKOFF_MS keys = 1..5', () => {
    expect(Object.keys(RETRY_BACKOFF_MS).sort()).toEqual(['1', '2', '3', '4', '5']);
  });
});

// ──────────────────────────────────────────────────────────────────────────

describe('retryDelivery', () => {
  let teardown: (() => void) | null = null;
  afterEach(() => {
    if (teardown) teardown();
    teardown = null;
    vi.clearAllMocks();
  });

  it('zet status terug naar pending en enqueueт', async () => {
    let updateCount = 0;
    const client = mockClient({
      __matcher: (sql) => {
        if (/UPDATE webhook_deliveries/i.test(sql)) {
          updateCount++;
          return { rows: [{ id: DELIVERY_ID }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await retryDelivery(TENANT_ID, DELIVERY_ID);
    expect(result.delivery_id).toBe(DELIVERY_ID);
    expect(updateCount).toBe(1);
    expect((webhookDeliveriesQueue.add as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('throwt 404 als delivery niet bestaat', async () => {
    const client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(retryDelivery(TENANT_ID, DELIVERY_ID)).rejects.toBeInstanceOf(AppError);
  });
});

// ──────────────────────────────────────────────────────────────────────────

describe('listDeliveries', () => {
  let teardown: (() => void) | null = null;
  afterEach(() => {
    if (teardown) teardown();
    teardown = null;
  });

  it('returnt rows uit DB', async () => {
    const sample = [
      {
        id: 'd1',
        subscription_id: SUB_ID,
        event_type: 'candidate.created',
        event_id: null,
        status: 'succeeded',
        attempt: 1,
        response_status: 200,
        duration_ms: 120,
        error_message: null,
        created_at: '2026-05-01T00:00:00Z',
        delivered_at: '2026-05-01T00:00:01Z',
        next_retry_at: null,
      },
    ];
    const client = mockClient({ webhook_deliveries: sample });
    teardown = installPoolMock(client);

    const rows = await listDeliveries(TENANT_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('succeeded');
  });

  it('returnt lege lijst bij DB-failure', async () => {
    const client = mockClient({
      __matcher: () => {
        throw new Error('connection lost');
      },
    });
    teardown = installPoolMock(client);

    const rows = await listDeliveries(TENANT_ID);
    expect(rows).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────

describe('getDeliveryDetails', () => {
  let teardown: (() => void) | null = null;
  afterEach(() => {
    if (teardown) teardown();
    teardown = null;
  });

  it('returnt detail-row', async () => {
    const client = mockClient({
      webhook_deliveries: [
        {
          id: DELIVERY_ID,
          subscription_id: SUB_ID,
          event_type: 'job.created',
          event_id: null,
          status: 'succeeded',
          attempt: 1,
          response_status: 200,
          duration_ms: 100,
          error_message: null,
          created_at: '2026-05-01T00:00:00Z',
          delivered_at: '2026-05-01T00:00:01Z',
          next_retry_at: null,
          payload: { x: 1 },
          request_url: 'https://a/',
          request_headers: {},
          request_body: '{}',
          response_headers: {},
          response_body: 'OK',
        },
      ],
    });
    teardown = installPoolMock(client);

    const row = await getDeliveryDetails(TENANT_ID, DELIVERY_ID);
    expect(row.id).toBe(DELIVERY_ID);
    expect(row.payload).toEqual({ x: 1 });
  });

  it('throwt 404 als niet gevonden', async () => {
    const client = mockClient({ webhook_deliveries: [] });
    teardown = installPoolMock(client);

    await expect(getDeliveryDetails(TENANT_ID, DELIVERY_ID)).rejects.toBeInstanceOf(AppError);
  });
});

// ──────────────────────────────────────────────────────────────────────────

describe('deliverWebhook', () => {
  let teardown: (() => void) | null = null;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (teardown) teardown();
    teardown = null;
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  function makeClient(opts: {
    initialAttempt: number;
    onUpdateDelivery?: (sql: string, params: unknown[]) => void;
  }) {
    const captured: { sql: string; params: unknown[] }[] = [];
    const client = mockClient({
      __matcher: (sql, params) => {
        captured.push({ sql, params });

        // fetchDeliveryMeta query
        if (/FROM webhook_deliveries d[\s\S]*JOIN webhook_subscriptions/i.test(sql)) {
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                subscription_id: SUB_ID,
                attempt: opts.initialAttempt,
                payload: { hi: 'there' },
                event_type: 'candidate.created',
                url: 'https://receiver.example.com/hook',
                secret: 'topsecret',
              },
            ],
            rowCount: 1,
          };
        }
        // INSERT (retry-row)
        if (/INSERT INTO webhook_deliveries/i.test(sql)) {
          return { rows: [{ id: 'retry-id' }], rowCount: 1 };
        }
        // UPDATE delivering / final state
        if (/UPDATE webhook_deliveries/i.test(sql)) {
          if (opts.onUpdateDelivery) opts.onUpdateDelivery(sql, params);
          return { rows: [{ id: DELIVERY_ID }], rowCount: 1 };
        }
        // UPDATE webhook_subscriptions
        if (/UPDATE webhook_subscriptions/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        // INSERT audit_events
        if (/INSERT INTO audit_events/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    return { client, captured };
  }

  it('success-path: 200 OK → status=succeeded + failure_count reset', async () => {
    let finalStatus: string | null = null;
    const { client } = makeClient({
      initialAttempt: 1,
      onUpdateDelivery: (sql, _params) => {
        if (/SET status = 'succeeded'/.test(sql)) {
          finalStatus = 'succeeded';
        }
      },
    });
    teardown = installPoolMock(client);

    globalThis.fetch = vi.fn(async () => ({
      status: 200,
      headers: new Map([['content-type', 'text/plain']]) as unknown as Headers,
      text: async () => 'OK',
    })) as unknown as typeof fetch;

    await deliverWebhook(DELIVERY_ID);

    expect(finalStatus).toBe('succeeded');
    // Geen retry-job omdat success.
    const adds = (webhookDeliveriesQueue.add as ReturnType<typeof vi.fn>).mock.calls;
    expect(adds).toHaveLength(0);
  });

  it('failure attempt 1 → status=pending + retry geënqueued', async () => {
    let saw: { sql: string; params: unknown[] } | null = null;
    const { client } = makeClient({
      initialAttempt: 1,
      onUpdateDelivery: (sql, params) => {
        if (/SET status = \$2/.test(sql) || /status = \$2/.test(sql)) {
          saw = { sql, params };
        }
      },
    });
    teardown = installPoolMock(client);

    globalThis.fetch = vi.fn(async () => ({
      status: 500,
      headers: new Map([['content-type', 'text/plain']]) as unknown as Headers,
      text: async () => 'kapot',
    })) as unknown as typeof fetch;

    await deliverWebhook(DELIVERY_ID);

    expect(saw).not.toBeNull();
    // 2e param is de status string. Bij failure attempt 1 = 'pending'.
    expect(saw!.params[1]).toBe('pending');
    // Retry-job geënqueued.
    const adds = (webhookDeliveriesQueue.add as ReturnType<typeof vi.fn>).mock.calls;
    expect(adds.length).toBeGreaterThanOrEqual(1);
  });

  it('failure op attempt = MAX_ATTEMPTS → status=dead, geen retry', async () => {
    let saw: { sql: string; params: unknown[] } | null = null;
    let auditInserted = false;
    const { client } = makeClient({
      initialAttempt: MAX_ATTEMPTS,
      onUpdateDelivery: (sql, params) => {
        if (/SET status = \$2/.test(sql)) {
          saw = { sql, params };
        }
      },
    });
    // Audit event tracking
    const origConnect = client.query;
    client.query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/INSERT INTO audit_events/i.test(sql)) {
        auditInserted = true;
        return { rows: [], rowCount: 0 };
      }
      return origConnect(sql, params);
    }) as typeof origConnect;
    teardown = installPoolMock(client);

    globalThis.fetch = vi.fn(async () => ({
      status: 500,
      headers: new Map() as unknown as Headers,
      text: async () => 'fail',
    })) as unknown as typeof fetch;

    await deliverWebhook(DELIVERY_ID);

    expect(saw!.params[1]).toBe('dead');
    expect(auditInserted).toBe(true);
    // Geen extra retry geënqueued.
    expect((webhookDeliveriesQueue.add as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('netwerk-error wordt vastgelegd in error_message', async () => {
    let errMsg: unknown = null;
    const { client } = makeClient({
      initialAttempt: 1,
      onUpdateDelivery: (_sql, params) => {
        // error_message is param 9 (0-indexed)
        if (params.length >= 10 && typeof params[8] === 'string') {
          errMsg = params[8];
        }
      },
    });
    teardown = installPoolMock(client);

    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await deliverWebhook(DELIVERY_ID);
    expect(String(errMsg)).toContain('ECONNREFUSED');
  });

  it('drop wanneer delivery niet bestaat', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/FROM webhook_deliveries d/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(deliverWebhook(DELIVERY_ID)).resolves.not.toThrow();
  });
});
