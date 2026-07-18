import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { mockClient, installPoolMock, type MockClient } from './helpers/dbMock';

import {
  register,
  login,
  refreshAccessToken,
  logout,
  signRefreshJwt,
} from '../src/modules/auth/auth.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

// Helper — sha256 hex (mirrors how auth.service hashes refresh tokens)
function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

describe('auth.service — register', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    teardown?.();
  });

  it('creates tenant + owner user and returns access + refresh tokens', async () => {
    // De tenant-aanmaker moet 'owner' zijn, niet 'admin': de SYSTEM_ROLES
    // 'admin'-matrix sluit bewust users:admin uit (zie lib/permissions.ts),
    // dus alleen 'owner'/'super_admin' mogen custom-rollen/users beheren.
    // Zonder deze fix kon niemand ooit die routes bereiken.
    client = mockClient({
      __matcher: (sql) => {
        // 1) check slug uniqueness
        if (/SELECT id FROM tenants WHERE slug/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        // 2) insert tenant
        if (/INSERT INTO tenants/i.test(sql)) {
          return {
            rows: [
              { id: TENANT_ID, name: 'Acme', slug: 'acme' },
            ],
            rowCount: 1,
          };
        }
        // 3) insert user
        if (/INSERT INTO users/i.test(sql)) {
          return {
            rows: [
              {
                id: USER_ID,
                email: 'admin@acme.nl',
                name: 'Admin',
                role: 'owner',
                tenant_id: TENANT_ID,
              },
            ],
            rowCount: 1,
          };
        }
        // 4) insert refresh token
        if (/INSERT INTO refresh_tokens/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await register({
      tenantName: 'Acme',
      tenantSlug: 'acme',
      email: 'admin@acme.nl',
      password: 'supersecret',
      name: 'Admin',
    });

    // De hardcoded 'owner'-literal in de INSERT-query zelf (register() bevat
    // geen $-param voor role, dus die zit vast in het SQL-statement — we
    // verifiëren via de gemockte call dat de query 'owner' bevat, niet
    // 'admin').
    const insertUsersCall = (client.query as unknown as { mock: { calls: unknown[][] } }).mock
      .calls.find((c) => /INSERT INTO users/i.test(c[0] as string));
    expect(insertUsersCall?.[0]).toMatch(/'owner'/);

    expect(result.user).toEqual({
      id: USER_ID,
      email: 'admin@acme.nl',
      name: 'Admin',
      role: 'owner',
      tenantId: TENANT_ID,
    });
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();

    // Access token decodes correctly with the test secret
    const payload = jwt.verify(
      result.accessToken,
      process.env.JWT_SECRET!
    ) as Record<string, unknown>;
    expect(payload.userId).toBe(USER_ID);
    expect(payload.tenantId).toBe(TENANT_ID);
    expect(payload.role).toBe('owner');
  });

  it('throws 409 when the slug is already taken', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM tenants WHERE slug/i.test(sql)) {
          return { rows: [{ id: TENANT_ID }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      register({
        tenantName: 'Acme',
        tenantSlug: 'taken',
        email: 'a@b.nl',
        password: 'pw1234567',
        name: 'A',
      })
    ).rejects.toMatchObject({ code: 'SLUG_TAKEN' });
  });
});

describe('auth.service — login', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
  });

  it('returns tokens for correct credentials', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM tenants WHERE slug/i.test(sql)) {
          return { rows: [{ id: TENANT_ID }], rowCount: 1 };
        }
        if (/SELECT id, email, password_hash/i.test(sql)) {
          return {
            rows: [
              {
                id: USER_ID,
                email: 'admin@acme.nl',
                password_hash: 'bcrypt$pw1234567', // matches the bcrypt mock
                name: 'Admin',
                role: 'admin',
                tenant_id: TENANT_ID,
                is_active: true,
              },
            ],
            rowCount: 1,
          };
        }
        if (/DELETE FROM refresh_tokens/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/INSERT INTO refresh_tokens/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await login({
      email: 'admin@acme.nl',
      password: 'pw1234567',
      tenantSlug: 'acme',
    });

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.role).toBe('admin');
  });

  it('rejects invalid password with 401 INVALID_CREDENTIALS', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM tenants WHERE slug/i.test(sql)) {
          return { rows: [{ id: TENANT_ID }], rowCount: 1 };
        }
        if (/SELECT id, email, password_hash/i.test(sql)) {
          return {
            rows: [
              {
                id: USER_ID,
                email: 'admin@acme.nl',
                password_hash: 'bcrypt$correctpw',
                name: 'Admin',
                role: 'admin',
                tenant_id: TENANT_ID,
                is_active: true,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      login({ email: 'admin@acme.nl', password: 'wrong', tenantSlug: 'acme' })
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('rejects unknown tenant slug with 401', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(
      login({ email: 'a@b.nl', password: 'pw', tenantSlug: 'nope' })
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('rejects inactive accounts with 403 ACCOUNT_DISABLED', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM tenants WHERE slug/i.test(sql)) {
          return { rows: [{ id: TENANT_ID }], rowCount: 1 };
        }
        if (/SELECT id, email, password_hash/i.test(sql)) {
          return {
            rows: [
              {
                id: USER_ID,
                email: 'admin@acme.nl',
                password_hash: 'bcrypt$pw',
                name: 'Admin',
                role: 'admin',
                tenant_id: TENANT_ID,
                is_active: false,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      login({ email: 'admin@acme.nl', password: 'pw', tenantSlug: 'acme' })
    ).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });
  });
});

describe('auth.service — refreshAccessToken', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
  });

  it('issues a new access token AND rotates the refresh token', async () => {
    const raw = 'a-valid-refresh-token';
    const expectedHash = sha256(raw);
    let rotatedOld = false;
    let insertedNew = false;
    client = mockClient({
      __matcher: (sql, params) => {
        if (/FROM refresh_tokens rt/i.test(sql)) {
          // Verify the service hashed the token correctly before lookup.
          expect(params[0]).toBe(expectedHash);
          return {
            rows: [
              {
                id: 'rt-1',
                user_id: USER_ID,
                tenant_id: TENANT_ID,
                expires_at: new Date(Date.now() + 86400 * 1000),
                rotated_at: null,
                email: 'admin@acme.nl',
                role: 'admin',
                is_active: true,
              },
            ],
            rowCount: 1,
          };
        }
        // Rotatie-markering (Fase 0.5): UPDATE ... WHERE rotated_at IS NULL.
        if (/UPDATE refresh_tokens/i.test(sql) && /rotated_at IS NULL/i.test(sql)) {
          rotatedOld = true;
          return { rows: [{ id: 'rt-1' }], rowCount: 1 };
        }
        if (/INSERT INTO refresh_tokens/i.test(sql)) {
          insertedNew = true;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const { accessToken, refreshToken } = await refreshAccessToken(raw);
    expect(accessToken).toBeTruthy();
    // Rotatie: er komt een NIEUWE refresh-token terug, anders dan de oude.
    expect(refreshToken).toBeTruthy();
    expect(refreshToken).not.toBe(raw);
    expect(rotatedOld).toBe(true);
    expect(insertedNew).toBe(true);
    const payload = jwt.verify(
      accessToken,
      process.env.JWT_SECRET!
    ) as Record<string, unknown>;
    expect(payload.userId).toBe(USER_ID);
  });

  it('detects reuse of a rotated token and revokes all sessions', async () => {
    let revokedAll = false;
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM refresh_tokens rt/i.test(sql)) {
          return {
            rows: [
              {
                id: 'rt-used',
                user_id: USER_ID,
                tenant_id: TENANT_ID,
                expires_at: new Date(Date.now() + 86400 * 1000),
                rotated_at: new Date(Date.now() - 60_000), // al ingewisseld
                email: 'admin@acme.nl',
                role: 'admin',
                is_active: true,
              },
            ],
            rowCount: 1,
          };
        }
        if (/DELETE FROM refresh_tokens WHERE user_id/i.test(sql)) {
          revokedAll = true;
          return { rows: [], rowCount: 3 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(refreshAccessToken('stolen-and-replayed')).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_REUSED',
    });
    expect(revokedAll).toBe(true);
  });

  it('rejects unknown refresh tokens', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(refreshAccessToken('garbage')).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
  });

  it('rejects and deletes expired refresh tokens', async () => {
    let deleted = false;
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM refresh_tokens rt/i.test(sql)) {
          return {
            rows: [
              {
                id: 'rt-old',
                user_id: USER_ID,
                tenant_id: TENANT_ID,
                expires_at: new Date(Date.now() - 1000),
                email: 'a@b.nl',
                role: 'admin',
                is_active: true,
              },
            ],
            rowCount: 1,
          };
        }
        if (/DELETE FROM refresh_tokens/i.test(sql)) {
          deleted = true;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(refreshAccessToken('expired')).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_EXPIRED',
    });
    expect(deleted).toBe(true);
  });
});

describe('auth.service — logout + signRefreshJwt', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
  });

  it('logout deletes the matching refresh-token row', async () => {
    let deleteHash: string | undefined;
    client = mockClient({
      __matcher: (sql, params) => {
        if (/DELETE FROM refresh_tokens/i.test(sql)) {
          deleteHash = params[0] as string;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await logout('my-refresh-token');
    expect(deleteHash).toBe(sha256('my-refresh-token'));
  });

  it('signRefreshJwt produces a verifiable JWT with the embedded token', () => {
    const signed = signRefreshJwt('inner-token');
    const decoded = jwt.verify(
      signed,
      process.env.JWT_REFRESH_SECRET!
    ) as Record<string, unknown>;
    expect(decoded.token).toBe('inner-token');
  });
});
