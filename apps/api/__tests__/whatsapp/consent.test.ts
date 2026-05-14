/**
 * whatsapp consent service tests — Sprint Q4.6 (Agent ZZZ).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

vi.mock('../../src/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/audit')>(
    '../../src/lib/audit'
  );
  return { ...actual, logAudit: vi.fn(async () => undefined) };
});

import {
  issueOptInInvite,
  grantConsentViaToken,
  withdrawConsent,
  detectOptInKeyword,
  detectStopKeyword,
  lookupTokenForPublic,
} from '../../src/modules/whatsapp/consent.service';
import { eventBus } from '../../src/lib/eventBus';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';

beforeEach(() => vi.clearAllMocks());

describe('keyword detectors', () => {
  it('detectOptInKeyword recognises JA / AKKOORD / YES', () => {
    expect(detectOptInKeyword('JA')).toBe(true);
    expect(detectOptInKeyword(' yes ')).toBe(true);
    expect(detectOptInKeyword('AKKOORD')).toBe(true);
    expect(detectOptInKeyword('nope')).toBe(false);
    expect(detectOptInKeyword(null)).toBe(false);
    expect(detectOptInKeyword('')).toBe(false);
  });

  it('detectStopKeyword recognises STOP / STOPPEN / UNSUBSCRIBE', () => {
    expect(detectStopKeyword('STOP')).toBe(true);
    expect(detectStopKeyword('stoppen')).toBe(true);
    expect(detectStopKeyword('unsubscribe')).toBe(true);
    expect(detectStopKeyword('hello')).toBe(false);
  });
});

describe('issueOptInInvite', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('rejects non-E.164 phone', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      issueOptInInvite(TENANT_ID, CAND_ID, '0612345678', { userId: USER_ID })
    ).rejects.toThrow(/E\.164/);
  });

  it('creates a token row and returns a public URL', async () => {
    let tokenHashCaptured: string | null = null;
    const client = mockClient({
      __matcher: async (sql, params) => {
        if (/INSERT\s+INTO\s+whatsapp_consents/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+whatsapp_optin_tokens/i.test(sql)) {
          tokenHashCaptured = params[3] as string;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const result = await issueOptInInvite(TENANT_ID, CAND_ID, '+31612345678', { userId: USER_ID });
    expect(result.token).toBeTruthy();
    expect(result.token_url).toContain(result.token);
    expect(tokenHashCaptured).not.toBeNull();
    // hash should not equal raw token (sha256-hex is 64 chars).
    expect(tokenHashCaptured).not.toBe(result.token);
    expect(tokenHashCaptured?.length).toBe(64);
  });
});

describe('grantConsentViaToken', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns 404 for unknown token', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    await expect(grantConsentViaToken('bogus-token-xxxx', '1.2.3.4', 'UA')).rejects.toMatchObject(
      { code: 'INVALID_TOKEN' }
    );
  });

  it('grants consent + records ip/user_agent', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    let consentInserted = false;
    let consumedToken = false;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/whatsapp_optin_tokens\s+t\s+LEFT\s+JOIN\s+candidates/i.test(sql)) {
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                candidate_id: CAND_ID,
                phone_number: '+31612345678',
                candidate_name: 'Alice',
                expires_at: future,
                consumed_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        if (/UPDATE\s+whatsapp_optin_tokens\s+SET\s+consumed_at/i.test(sql)) {
          consumedToken = true;
          return { rows: [], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+whatsapp_consents/i.test(sql)) {
          consentInserted = true;
          return {
            rows: [
              {
                id: 'c-1',
                tenant_id: TENANT_ID,
                candidate_id: CAND_ID,
                phone_number: '+31612345678',
                status: 'granted',
                opt_in_source: 'career_page',
                granted_at: new Date().toISOString(),
                ip_address: '1.2.3.4',
                user_agent: 'UA',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const row = await grantConsentViaToken('valid-token-xxxx', '1.2.3.4', 'UA');
    expect(row.status).toBe('granted');
    expect(row.ip_address).toBe('1.2.3.4');
    expect(row.user_agent).toBe('UA');
    expect(consumedToken).toBe(true);
    expect(consentInserted).toBe(true);
  });

  it('rejects expired token', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const client = mockClient({
      __matcher: async (sql) => {
        if (/whatsapp_optin_tokens\s+t\s+LEFT\s+JOIN/i.test(sql)) {
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                candidate_id: CAND_ID,
                phone_number: '+31612345678',
                candidate_name: null,
                expires_at: past,
                consumed_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(grantConsentViaToken('expired-token', null, null)).rejects.toMatchObject(
      { code: 'INVALID_TOKEN' }
    );
  });

  it('rejects already-consumed token', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/whatsapp_optin_tokens\s+t\s+LEFT\s+JOIN/i.test(sql)) {
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                candidate_id: CAND_ID,
                phone_number: '+31612345678',
                candidate_name: null,
                expires_at: new Date(Date.now() + 60_000).toISOString(),
                consumed_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(grantConsentViaToken('consumed-token', null, null)).rejects.toMatchObject(
      { code: 'INVALID_TOKEN' }
    );
  });
});

describe('withdrawConsent', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('emits whatsappConsentWithdrawn event', async () => {
    let emitted: unknown = null;
    eventBus.on('whatsappConsentWithdrawn', (e) => {
      emitted = e;
    });
    const client = mockClient({
      __matcher: async (sql) => {
        if (/UPDATE\s+whatsapp_consents/i.test(sql)) {
          return {
            rows: [
              {
                id: 'c-1',
                tenant_id: TENANT_ID,
                candidate_id: CAND_ID,
                phone_number: '+31612345678',
                status: 'withdrawn',
                withdrawn_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await withdrawConsent(TENANT_ID, CAND_ID, 'user requested');
    await new Promise((r) => setImmediate(r));
    expect(emitted).not.toBeNull();
    expect((emitted as { candidateId: string }).candidateId).toBe(CAND_ID);
  });
});

describe('lookupTokenForPublic', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns null for unknown token', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    expect(await lookupTokenForPublic('nope')).toBeNull();
  });
});
