/**
 * Mailbox-service tests — Sprint Q3.1.
 *
 * Mocks:
 *   - getMailProvider → fake provider (no network).
 *   - redis (queues.ts) → in-memory map for state-token storage.
 *   - withTenant DB calls → mocked via dbMock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

// ─── Provider mock ──────────────────────────────────────────────────────────

const fakeProvider = {
  getAuthUrl: vi.fn((state: string) => `https://provider.example/authorize?state=${state}`),
  exchangeCode: vi.fn(async (code: string) => ({
    access_token: `access-${code}`,
    refresh_token: `refresh-${code}`,
    expires_in: 3600,
    scope: 'mail.read mail.send',
    account_email: 'user@example.com',
    account_name: 'User Example',
  })),
  refreshAccessToken: vi.fn(async (rt: string) => ({
    access_token: `new-access-${rt}`,
    refresh_token: `new-refresh-${rt}`,
    expires_in: 3600,
    scope: 'mail.read mail.send',
  })),
  getProfile: vi.fn(async () => ({ email: 'user@example.com', name: 'User Example' })),
  sendEmail: vi.fn(async () => ({ messageId: 'msg-1', threadId: 'thr-1' })),
  listMessagesSince: vi.fn(async () => ({ messages: [] })),
  getMessage: vi.fn(),
};

vi.mock('../../src/lib/providers', () => ({
  getMailProvider: vi.fn(() => fakeProvider),
  isProviderMockMode: vi.fn(() => false),
}));

// ─── Redis mock (override the bullmq-mocked queues.redis) ──────────────────

const fakeRedisStore = new Map<string, string>();
vi.mock('../../src/queue/queues', () => ({
  redis: {
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      fakeRedisStore.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => fakeRedisStore.get(key) ?? null),
    del: vi.fn(async (key: string) => {
      fakeRedisStore.delete(key);
      return 1;
    }),
  },
  emailSenderQueue: { add: vi.fn(async () => ({ id: 'mock-job' })) },
  workflowEventsQueue: { add: vi.fn(async () => ({ id: 'mock-job' })) },
  inboxSyncQueue: { add: vi.fn(async () => ({ id: 'mock-job' })) },
  bulkMailQueue: { add: vi.fn(async () => ({ id: 'mock-job' })) },
}));

import {
  startOAuth,
  completeOAuth,
  listIntegrations,
  disconnectIntegration,
} from '../../src/modules/integrations/mailbox.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const INTEGRATION_ID = '33333333-3333-3333-3333-333333333333';

describe('mailbox.service.startOAuth', () => {
  beforeEach(() => {
    fakeRedisStore.clear();
    vi.clearAllMocks();
  });

  it('genereert state, slaat op in Redis en retourneert provider-URL', async () => {
    const { url, state } = await startOAuth(TENANT_ID, USER_ID, 'gmail');
    expect(state).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(url).toContain(state);
    expect(fakeRedisStore.get(`oauth:state:${state}`)).toBeTruthy();
    const stored = JSON.parse(fakeRedisStore.get(`oauth:state:${state}`)!);
    expect(stored).toEqual({ tenantId: TENANT_ID, userId: USER_ID, provider: 'gmail' });
  });
});

describe('mailbox.service.completeOAuth', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => {
    fakeRedisStore.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    teardown?.();
  });

  it('happy path: ruilt code in, upsert integratie, audit-log', async () => {
    // Pre-seed Redis state
    const state = 'state-uuid';
    fakeRedisStore.set(
      `oauth:state:${state}`,
      JSON.stringify({ tenantId: TENANT_ID, userId: USER_ID, provider: 'gmail' })
    );

    const insertedRow = {
      id: INTEGRATION_ID,
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      provider: 'gmail',
      account_email: 'user@example.com',
      account_name: 'User Example',
      scope: 'mail.read mail.send',
      access_token: 'access-the-code',
      refresh_token: 'refresh-the-code',
      token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      history_id: null,
      sync_error: null,
      last_sync_at: null,
      active: true,
      created_at: new Date().toISOString(),
    };
    let upsertSql = '';
    let auditSql = '';
    client = mockClient({
      __matcher: (sql) => {
        if (/INSERT INTO mailbox_integrations/i.test(sql)) {
          upsertSql = sql;
          return { rows: [insertedRow], rowCount: 1 };
        }
        if (/INSERT INTO audit_events/i.test(sql)) {
          auditSql = sql;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await completeOAuth('the-code', state);
    expect(result.id).toBe(INTEGRATION_ID);
    expect(result.account_email).toBe('user@example.com');
    expect(result.active).toBe(true);
    // Tokens mogen NIET in het public record lekken.
    expect(result).not.toHaveProperty('access_token');
    // Provider exchange werd aangeroepen met juiste code.
    expect(fakeProvider.exchangeCode).toHaveBeenCalledWith('the-code');
    // ON CONFLICT clause aanwezig (idempotent reconnect)
    expect(upsertSql).toMatch(/ON CONFLICT/i);
    expect(auditSql).toMatch(/audit_events/i);
    // State is uit Redis verwijderd.
    expect(fakeRedisStore.has(`oauth:state:${state}`)).toBe(false);
  });

  it('faalt met INVALID_STATE als state niet in Redis is', async () => {
    await expect(completeOAuth('the-code', 'unknown-state')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('faalt met NO_REFRESH_TOKEN als provider geen refresh_token meegeeft', async () => {
    const state = 'state-uuid';
    fakeRedisStore.set(
      `oauth:state:${state}`,
      JSON.stringify({ tenantId: TENANT_ID, userId: USER_ID, provider: 'gmail' })
    );
    fakeProvider.exchangeCode.mockResolvedValueOnce({
      access_token: 'access',
      refresh_token: undefined,
      expires_in: 3600,
      scope: 'mail.read',
      account_email: 'user@example.com',
    });

    await expect(completeOAuth('the-code', state)).rejects.toMatchObject({
      code: 'NO_REFRESH_TOKEN',
    });
  });
});

describe('mailbox.service.listIntegrations', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

  it('returns rows zonder secret-velden', async () => {
    const row = {
      id: INTEGRATION_ID,
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      provider: 'gmail',
      account_email: 'a@b.c',
      account_name: 'A',
      scope: 'mail.read',
      last_sync_at: null,
      active: true,
      created_at: new Date().toISOString(),
    };
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM mailbox_integrations/i.test(sql)) {
          return { rows: [row], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const list = await listIntegrations(TENANT_ID);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ account_email: 'a@b.c', active: true });
    expect(list[0]).not.toHaveProperty('access_token');
    expect(list[0]).not.toHaveProperty('refresh_token');
  });

  it('filtert op user_id wanneer meegegeven', async () => {
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    client = mockClient({
      __matcher: (sql, params) => {
        if (/FROM mailbox_integrations/i.test(sql)) {
          capturedSql = sql;
          capturedParams = params;
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await listIntegrations(TENANT_ID, USER_ID);
    expect(capturedSql).toMatch(/AND user_id = \$2/);
    expect(capturedParams).toEqual([TENANT_ID, USER_ID]);
  });
});

describe('mailbox.service.disconnectIntegration', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

  it('soft-disconnect: UPDATE active=FALSE en audit-log', async () => {
    let updateSql = '';
    client = mockClient({
      __matcher: (sql) => {
        if (/UPDATE mailbox_integrations/i.test(sql) && /active = FALSE/i.test(sql)) {
          updateSql = sql;
          return {
            rows: [{ id: INTEGRATION_ID, account_email: 'a@b.c', provider: 'gmail' }],
            rowCount: 1,
          };
        }
        if (/audit_events/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      disconnectIntegration(TENANT_ID, USER_ID, INTEGRATION_ID)
    ).resolves.toBeUndefined();
    expect(updateSql).toMatch(/UPDATE mailbox_integrations/);
  });

  it('throwt 404 als integratie niet bestaat', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(
      disconnectIntegration(TENANT_ID, USER_ID, INTEGRATION_ID)
    ).rejects.toMatchObject({ code: 'INTEGRATION_NOT_FOUND' });
  });
});
