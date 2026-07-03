/**
 * Tests voor de wachtwoord-reset-flow (forgotPassword + resetPassword).
 *
 * Dekt de beveiligingseisen:
 *  - enumeratie-neutraliteit: forgotPassword resolvet altijd identiek,
 *    ongeacht of tenant/user bestaat of actief is;
 *  - token gehashed opgeslagen: alleen sha256(raw) raakt de DB, de raw
 *    token zit enkel in de gemailde reset-link;
 *  - expiry: verlopen tokens worden geweigerd (RESET_TOKEN_EXPIRED);
 *  - single-use: gebruikte tokens worden geweigerd (RESET_TOKEN_USED),
 *    ook in de race tussen lookup en consume;
 *  - sessie-invalidatie: alle refresh-tokens van de user worden verwijderd.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import crypto from 'crypto';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

import { forgotPassword, resetPassword } from '../../src/modules/auth/auth.service';
import { emailSenderQueue } from '../../src/queue/queues';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const TOKEN_ID = '33333333-3333-3333-3333-333333333333';

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

const emailAdd = emailSenderQueue.add as unknown as Mock;

describe('auth.service — forgotPassword', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    teardown?.();
  });

  it('resolves silently for an unknown tenant slug (no token, no email)', async () => {
    let insertedToken = false;
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM tenants WHERE slug/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/INSERT INTO password_reset_tokens/i.test(sql)) {
          insertedToken = true;
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      forgotPassword('someone@acme.nl', 'unknown-workspace')
    ).resolves.toBeUndefined();
    expect(insertedToken).toBe(false);
    expect(emailAdd).not.toHaveBeenCalled();
  });

  it('resolves silently for an unknown email (no token, no email)', async () => {
    let insertedToken = false;
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM tenants WHERE slug/i.test(sql)) {
          return { rows: [{ id: TENANT_ID }], rowCount: 1 };
        }
        if (/FROM users/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/INSERT INTO password_reset_tokens/i.test(sql)) {
          insertedToken = true;
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      forgotPassword('nobody@acme.nl', 'acme')
    ).resolves.toBeUndefined();
    expect(insertedToken).toBe(false);
    expect(emailAdd).not.toHaveBeenCalled();
  });

  it('resolves silently for an inactive user (invite-flow is the right path)', async () => {
    let insertedToken = false;
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM tenants WHERE slug/i.test(sql)) {
          return { rows: [{ id: TENANT_ID }], rowCount: 1 };
        }
        if (/FROM users/i.test(sql)) {
          return {
            rows: [
              {
                id: USER_ID,
                email: 'invited@acme.nl',
                name: 'Invited',
                tenant_id: TENANT_ID,
                is_active: false,
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT INTO password_reset_tokens/i.test(sql)) {
          insertedToken = true;
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      forgotPassword('invited@acme.nl', 'acme')
    ).resolves.toBeUndefined();
    expect(insertedToken).toBe(false);
    expect(emailAdd).not.toHaveBeenCalled();
  });

  it('stores ONLY the sha256 hash, invalidates older tokens and mails the raw token link', async () => {
    let storedHash: string | undefined;
    let storedExpiry: Date | undefined;
    let invalidatedOld = false;
    client = mockClient({
      __matcher: (sql, params) => {
        if (/SELECT id FROM tenants WHERE slug/i.test(sql)) {
          return { rows: [{ id: TENANT_ID }], rowCount: 1 };
        }
        if (/FROM users/i.test(sql) && /SELECT/i.test(sql)) {
          return {
            rows: [
              {
                id: USER_ID,
                email: 'user@acme.nl',
                name: 'User',
                tenant_id: TENANT_ID,
                is_active: true,
              },
            ],
            rowCount: 1,
          };
        }
        if (/UPDATE password_reset_tokens SET used_at/i.test(sql)) {
          invalidatedOld = true;
          return { rows: [], rowCount: 1 };
        }
        if (/INSERT INTO password_reset_tokens/i.test(sql)) {
          storedHash = params[2] as string;
          storedExpiry = params[3] as Date;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await forgotPassword('User@Acme.nl', 'acme');

    // E-mail geënqueued via het bestaande pad, met de reset-link erin.
    expect(emailAdd).toHaveBeenCalledTimes(1);
    const [jobName, jobData] = emailAdd.mock.calls[0] as [
      string,
      { to: string; subject: string; body: string },
    ];
    expect(jobName).toBe('forgot-password');
    expect(jobData.to).toBe('user@acme.nl');
    const linkMatch = /\/reset-password\?token=([A-Za-z0-9_-]+)/.exec(
      jobData.body
    );
    expect(linkMatch).not.toBeNull();
    const rawToken = linkMatch![1];
    // Random 32 bytes → 43 tekens base64url.
    expect(rawToken.length).toBeGreaterThanOrEqual(43);

    // Alleen de hash in de DB; nooit de raw token.
    expect(storedHash).toBe(sha256(rawToken));
    expect(storedHash).not.toBe(rawToken);

    // Oudere openstaande tokens geïnvalideerd (één werkende link tegelijk).
    expect(invalidatedOld).toBe(true);

    // Expiry ~1 uur (marge van 5s voor test-runtime).
    expect(storedExpiry).toBeInstanceOf(Date);
    const ttlMs = storedExpiry!.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(60 * 60 * 1000 - 5000);
    expect(ttlMs).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});

describe('auth.service — resetPassword', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    teardown?.();
  });

  function validTokenRow(overrides: Record<string, unknown> = {}) {
    return {
      token_id: TOKEN_ID,
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      expires_at: new Date(Date.now() + 30 * 60 * 1000),
      used_at: null,
      email: 'user@acme.nl',
      is_active: true,
      ...overrides,
    };
  }

  it('sets the new password, consumes the token, revokes all sessions and audits', async () => {
    const raw = crypto.randomBytes(32).toString('base64url');
    let lookupHash: string | undefined;
    let consumedToken = false;
    let newPasswordHash: string | undefined;
    let revokedSessions = false;
    let auditAction: string | undefined;
    client = mockClient({
      __matcher: (sql, params) => {
        if (/FROM password_reset_tokens prt/i.test(sql)) {
          lookupHash = params[0] as string;
          return { rows: [validTokenRow()], rowCount: 1 };
        }
        if (/UPDATE password_reset_tokens/i.test(sql) && /used_at IS NULL/i.test(sql)) {
          consumedToken = true;
          return { rows: [], rowCount: 1 };
        }
        if (/UPDATE users/i.test(sql)) {
          newPasswordHash = params[0] as string;
          return { rows: [], rowCount: 1 };
        }
        if (/DELETE FROM refresh_tokens WHERE user_id/i.test(sql)) {
          revokedSessions = true;
          return { rows: [], rowCount: 2 };
        }
        if (/INSERT INTO audit_events/i.test(sql)) {
          auditAction = params[2] as string;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(resetPassword(raw, 'nieuwWachtwoord1')).resolves.toBeUndefined();

    // Lookup op de sha256-hash, nooit op de raw token.
    expect(lookupHash).toBe(sha256(raw));
    expect(consumedToken).toBe(true);
    // Zelfde hashing als acceptInvite (bcrypt-mock uit setup.ts).
    expect(newPasswordHash).toBe('bcrypt$nieuwWachtwoord1');
    expect(revokedSessions).toBe(true);
    expect(auditAction).toBe('user.password_changed');
  });

  it('rejects an unknown token with 404 INVALID_RESET_TOKEN', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(resetPassword('garbage-token-abcdef', 'pw12345678')).rejects.toMatchObject({
      statusCode: 404,
      code: 'INVALID_RESET_TOKEN',
    });
  });

  it('rejects an already-used token with 409 RESET_TOKEN_USED (single-use)', async () => {
    let updatedPassword = false;
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM password_reset_tokens prt/i.test(sql)) {
          return {
            rows: [validTokenRow({ used_at: new Date(Date.now() - 60_000) })],
            rowCount: 1,
          };
        }
        if (/UPDATE users/i.test(sql)) {
          updatedPassword = true;
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(resetPassword('some-used-token-abcdef', 'pw12345678')).rejects.toMatchObject({
      statusCode: 409,
      code: 'RESET_TOKEN_USED',
    });
    expect(updatedPassword).toBe(false);
  });

  it('rejects an expired token with 410 RESET_TOKEN_EXPIRED', async () => {
    let updatedPassword = false;
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM password_reset_tokens prt/i.test(sql)) {
          return {
            rows: [validTokenRow({ expires_at: new Date(Date.now() - 1000) })],
            rowCount: 1,
          };
        }
        if (/UPDATE users/i.test(sql)) {
          updatedPassword = true;
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(resetPassword('some-expired-token-abc', 'pw12345678')).rejects.toMatchObject({
      statusCode: 410,
      code: 'RESET_TOKEN_EXPIRED',
    });
    expect(updatedPassword).toBe(false);
  });

  it('rejects when the account was disabled after the token was issued', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM password_reset_tokens prt/i.test(sql)) {
          return { rows: [validTokenRow({ is_active: false })], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(resetPassword('token-for-disabled-user', 'pw12345678')).rejects.toMatchObject({
      statusCode: 403,
      code: 'ACCOUNT_DISABLED',
    });
  });

  it('treats a lost consume-race as RESET_TOKEN_USED and does not touch the password', async () => {
    let updatedPassword = false;
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM password_reset_tokens prt/i.test(sql)) {
          return { rows: [validTokenRow()], rowCount: 1 };
        }
        if (/UPDATE password_reset_tokens/i.test(sql) && /used_at IS NULL/i.test(sql)) {
          // Race verloren: parallelle reset was ons voor.
          return { rows: [], rowCount: 0 };
        }
        if (/UPDATE users/i.test(sql)) {
          updatedPassword = true;
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(resetPassword('raced-token-abcdefgh', 'pw12345678')).rejects.toMatchObject({
      statusCode: 409,
      code: 'RESET_TOKEN_USED',
    });
    expect(updatedPassword).toBe(false);
  });
});
