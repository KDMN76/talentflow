/**
 * whatsapp.service tests — Sprint Q4.6 (Agent ZZZ).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

vi.mock('../../src/lib/aiEvents', () => ({
  logAIEvent: vi.fn(async () => undefined),
}));
vi.mock('../../src/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/audit')>(
    '../../src/lib/audit'
  );
  return { ...actual, logAudit: vi.fn(async () => undefined) };
});

import {
  connectIntegration,
  disconnectIntegration,
  getIntegration,
  healthCheck,
} from '../../src/modules/whatsapp/whatsapp.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('connectIntegration', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('rejects non-E.164 phone number', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      connectIntegration(
        TENANT_ID,
        { phone_number: '0612345678', api_key: 'aaaaaaaa' },
        { userId: USER_ID }
      )
    ).rejects.toThrow(/E\.164/);
  });

  it('rejects too-short api_key', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      connectIntegration(
        TENANT_ID,
        { phone_number: '+31612345678', api_key: 'short' },
        { userId: USER_ID }
      )
    ).rejects.toThrow(/api_key/);
  });

  it('persists encrypted credentials + health-check success', async () => {
    const inserted = {
      id: 'i-1',
      tenant_id: TENANT_ID,
      provider: '360dialog',
      status: 'disconnected',
      phone_number: '+31612345678',
      display_name: null,
      api_key_encrypted: Buffer.from('enc'),
      waba_id: null,
      webhook_secret_encrypted: Buffer.from('enc2'),
      quality_rating: 'unknown',
      messaging_limit: null,
      connected_by: USER_ID,
      connected_at: new Date().toISOString(),
      last_health_check_at: null,
      last_error: null,
      metadata: {},
      created_at: new Date().toISOString(),
    };
    const updated = { ...inserted, status: 'connected', quality_rating: 'green', messaging_limit: 'tier_10k' };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/INSERT\s+INTO\s+whatsapp_integrations/i.test(sql)) {
          return { rows: [inserted], rowCount: 1 };
        }
        if (/UPDATE\s+whatsapp_integrations/i.test(sql)) {
          return { rows: [updated], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const result = await connectIntegration(
      TENANT_ID,
      { phone_number: '+31612345678', api_key: 'aaaaaaaa' },
      { userId: USER_ID }
    );
    expect(result.status).toBe('connected');
    expect(result.quality_rating).toBe('green');
    // Encrypted fields should NOT leak via public type.
    expect((result as Record<string, unknown>).api_key_encrypted).toBeUndefined();
    expect((result as Record<string, unknown>).webhook_secret_encrypted).toBeUndefined();
  });
});

describe('disconnectIntegration', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('throws 404 when no integration', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    await expect(
      disconnectIntegration(TENANT_ID, { userId: USER_ID })
    ).rejects.toThrow(/Geen WhatsApp/);
  });

  it('clears encrypted blobs on disconnect', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/UPDATE\s+whatsapp_integrations/i.test(sql)) {
          expect(sql).toMatch(/api_key_encrypted\s*=\s*NULL/i);
          expect(sql).toMatch(/webhook_secret_encrypted\s*=\s*NULL/i);
          return { rows: [{ id: 'i-1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await disconnectIntegration(TENANT_ID, { userId: USER_ID });
  });
});

describe('getIntegration', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns null when no row', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    expect(await getIntegration(TENANT_ID)).toBeNull();
  });

  it('strips encrypted columns from the returned object', async () => {
    const row = {
      id: 'i-1',
      tenant_id: TENANT_ID,
      provider: '360dialog',
      status: 'connected',
      phone_number: '+31612345678',
      display_name: null,
      api_key_encrypted: Buffer.from('secret'),
      waba_id: null,
      webhook_secret_encrypted: Buffer.from('secret2'),
      quality_rating: 'green',
      messaging_limit: 'tier_10k',
      connected_by: USER_ID,
      connected_at: new Date().toISOString(),
      last_health_check_at: null,
      last_error: null,
      metadata: {},
      created_at: new Date().toISOString(),
    };
    const client = mockClient({ whatsapp_integrations: [row] });
    teardown = installPoolMock(client);
    const result = await getIntegration(TENANT_ID);
    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).api_key_encrypted).toBeUndefined();
    expect((result as Record<string, unknown>).webhook_secret_encrypted).toBeUndefined();
  });
});

describe('healthCheck', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('flips status to connected + records quality_rating', async () => {
    const integrationRow = {
      id: 'i-1',
      tenant_id: TENANT_ID,
      api_key_encrypted: (await import('../../src/lib/encryption')).encrypt('test-key'),
      webhook_secret_encrypted: null,
      phone_number: '+31612345678',
      waba_id: null,
      provider: '360dialog',
      status: 'connected',
      quality_rating: 'unknown',
      messaging_limit: null,
      display_name: null,
      connected_by: USER_ID,
      connected_at: new Date().toISOString(),
      last_health_check_at: null,
      last_error: null,
      metadata: {},
      created_at: new Date().toISOString(),
    };
    const updated = { ...integrationRow, status: 'connected', quality_rating: 'green', messaging_limit: 'tier_10k' };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+whatsapp_integrations/i.test(sql)) {
          return { rows: [integrationRow], rowCount: 1 };
        }
        if (/UPDATE\s+whatsapp_integrations/i.test(sql)) {
          return { rows: [updated], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const result = await healthCheck(TENANT_ID);
    expect(result.status).toBe('connected');
    expect(result.quality_rating).toBe('green');
  });
});
