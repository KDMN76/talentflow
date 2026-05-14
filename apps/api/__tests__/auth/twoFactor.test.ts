import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { authenticator } from 'otplib';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

// Synchroniseer otplib config met onze totp.ts (window=1 is in lib gezet bij import).
import '../../src/lib/totp';

import {
  generateTotpSecret,
  verifyTotpAndEnable,
  verifyTotpCode,
  verifyBackupCode,
  disable2fa,
  regenerateBackupCodes,
  is2faEnabled,
  setTenant2faPolicy,
  getTenant2faPolicy,
  require2faForUser,
} from '../../src/modules/auth/twoFactor.service';
import {
  generateBackupCodes,
  verifyTotp,
  generateSecret,
  buildOtpauthUri,
  normalizeBackupCode,
} from '../../src/lib/totp';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

describe('totp lib — primitives', () => {
  it('generates a base32 secret and otpauth URI', () => {
    const s = generateSecret();
    expect(s.length).toBeGreaterThan(0);
    const uri = buildOtpauthUri(s, 'foo@bar.nl');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('issuer=TalentFlow');
  });

  it('verifyTotp accepts authentic code, rejects garbage', () => {
    const s = generateSecret();
    const code = authenticator.generate(s);
    expect(verifyTotp(s, code)).toBe(true);
    expect(verifyTotp(s, '000000')).toBe(false);
    expect(verifyTotp(s, 'abc')).toBe(false);
    // strips spaces / dashes
    expect(verifyTotp(s, `${code.slice(0, 3)} ${code.slice(3)}`)).toBe(true);
  });

  it('generateBackupCodes returns 10 unique codes in XXXX-XXXX format', () => {
    const codes = generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    for (const c of codes) {
      expect(c).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    }
    expect(new Set(codes).size).toBe(10);
  });

  it('normalizeBackupCode strips dashes and uppercases', () => {
    expect(normalizeBackupCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizeBackupCode(' ABCD EFGH ')).toBe('ABCDEFGH');
  });
});

describe('twoFactor.service — generateTotpSecret', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => teardown?.());
  beforeEach(() => vi.clearAllMocks());

  it('genereert secret, QR-data-url en 10 backup-codes; UPSERT en audit', async () => {
    let inserted: { secret?: string; codes?: string[] } = {};
    client = mockClient({
      __matcher: (sql, params) => {
        if (/SELECT id, tenant_id, email, role FROM users/i.test(sql)) {
          return {
            rows: [{ id: USER_ID, tenant_id: TENANT_ID, email: 'a@b.nl', role: 'admin' }],
            rowCount: 1,
          };
        }
        if (/INSERT INTO user_2fa_secrets/i.test(sql)) {
          inserted = {
            secret: params[2] as string,
            codes: params[3] as string[],
          };
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const r = await generateTotpSecret(USER_ID, TENANT_ID);

    expect(r.secret).toBeTruthy();
    expect(r.qr_code_data_url).toMatch(/^data:image\/png;base64,/);
    expect(r.backup_codes).toHaveLength(10);
    expect(inserted.secret).toBe(r.secret);
    // Hashes saved, not plaintext
    expect(inserted.codes!.every((h) => h.startsWith('bcrypt$'))).toBe(true);
  });

  it('weigert wanneer user-tenant niet matcht (cross-tenant guard)', async () => {
    client = mockClient({
      __matcher: () => ({
        rows: [{ id: USER_ID, tenant_id: 'other', email: 'a@b.nl', role: 'admin' }],
        rowCount: 1,
      }),
    });
    teardown = installPoolMock(client);

    await expect(generateTotpSecret(USER_ID, TENANT_ID)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('twoFactor.service — verifyTotpAndEnable', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('schakelt 2FA aan bij geldige code', async () => {
    const secret = generateSecret();
    const code = authenticator.generate(secret);
    let updated = false;

    const client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id, tenant_id, email, role FROM users/i.test(sql)) {
          return {
            rows: [{ id: USER_ID, tenant_id: TENANT_ID, email: 'a@b.nl', role: 'admin' }],
            rowCount: 1,
          };
        }
        if (/SELECT user_id, tenant_id, secret/i.test(sql)) {
          return {
            rows: [
              {
                user_id: USER_ID,
                tenant_id: TENANT_ID,
                secret,
                enabled: false,
                backup_codes: [],
                enabled_at: null,
                last_used_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        if (/UPDATE user_2fa_secrets\s+SET enabled = TRUE/i.test(sql)) {
          updated = true;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const ok = await verifyTotpAndEnable(USER_ID, code);
    expect(ok).toBe(true);
    expect(updated).toBe(true);
  });

  it('weigert ongeldige code met 401', async () => {
    const secret = generateSecret();
    const client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id, tenant_id, email, role FROM users/i.test(sql)) {
          return {
            rows: [{ id: USER_ID, tenant_id: TENANT_ID, email: 'a@b.nl', role: 'admin' }],
            rowCount: 1,
          };
        }
        if (/SELECT user_id, tenant_id, secret/i.test(sql)) {
          return {
            rows: [
              {
                user_id: USER_ID,
                tenant_id: TENANT_ID,
                secret,
                enabled: false,
                backup_codes: [],
                enabled_at: null,
                last_used_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(verifyTotpAndEnable(USER_ID, '000000')).rejects.toMatchObject({
      code: 'INVALID_2FA_CODE',
    });
  });
});

describe('twoFactor.service — verifyTotpCode + is2faEnabled', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('verifyTotpCode: false wanneer 2FA niet enabled', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id, tenant_id, email, role FROM users/i.test(sql)) {
          return {
            rows: [{ id: USER_ID, tenant_id: TENANT_ID, email: 'a@b.nl', role: 'admin' }],
            rowCount: 1,
          };
        }
        if (/SELECT user_id, tenant_id, secret/i.test(sql)) {
          return {
            rows: [
              {
                user_id: USER_ID,
                tenant_id: TENANT_ID,
                secret: 'X',
                enabled: false,
                backup_codes: [],
                enabled_at: null,
                last_used_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    expect(await verifyTotpCode(USER_ID, '123456')).toBe(false);
  });

  it('is2faEnabled: true wanneer enabled-flag gezet', async () => {
    const client = mockClient({
      __matcher: () => ({ rows: [{ enabled: true }], rowCount: 1 }),
    });
    teardown = installPoolMock(client);
    expect(await is2faEnabled(USER_ID)).toBe(true);
  });
});

describe('twoFactor.service — verifyBackupCode (single use)', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('strip de gebruikte hash uit de array bij match', async () => {
    // bcrypt-mock in setup hashed `pw` → 'bcrypt$pw'. Compare matcht
    // hash === `bcrypt$${pw}`. We zetten de hash zo:
    const goodCode = 'AAAA-BBBB';
    const normalized = normalizeBackupCode(goodCode);
    const goodHash = `bcrypt$${normalized}`;
    const otherHash = `bcrypt$DIFFERENT`;

    let updatedCodes: string[] | undefined;
    const client = mockClient({
      __matcher: (sql, params) => {
        if (/SELECT id, tenant_id, email, role FROM users/i.test(sql)) {
          return {
            rows: [{ id: USER_ID, tenant_id: TENANT_ID, email: 'a@b.nl', role: 'admin' }],
            rowCount: 1,
          };
        }
        if (/SELECT user_id, tenant_id, secret/i.test(sql)) {
          return {
            rows: [
              {
                user_id: USER_ID,
                tenant_id: TENANT_ID,
                secret: 'X',
                enabled: true,
                backup_codes: [otherHash, goodHash],
                enabled_at: null,
                last_used_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        if (/UPDATE user_2fa_secrets SET backup_codes/i.test(sql)) {
          updatedCodes = params[0] as string[];
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const ok = await verifyBackupCode(USER_ID, goodCode);
    expect(ok).toBe(true);
    expect(updatedCodes).toEqual([otherHash]);
  });

  it('false bij geen match', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id, tenant_id, email, role FROM users/i.test(sql)) {
          return {
            rows: [{ id: USER_ID, tenant_id: TENANT_ID, email: 'a@b.nl', role: 'admin' }],
            rowCount: 1,
          };
        }
        if (/SELECT user_id, tenant_id, secret/i.test(sql)) {
          return {
            rows: [
              {
                user_id: USER_ID,
                tenant_id: TENANT_ID,
                secret: 'X',
                enabled: true,
                backup_codes: ['bcrypt$NOMATCH'],
                enabled_at: null,
                last_used_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    expect(await verifyBackupCode(USER_ID, 'XXXX-YYYY')).toBe(false);
  });
});

describe('twoFactor.service — disable2fa + regenerateBackupCodes', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('disable2fa wist de row na geldige TOTP', async () => {
    const secret = generateSecret();
    const code = authenticator.generate(secret);
    let deleted = false;
    const client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id, tenant_id, email, role FROM users/i.test(sql)) {
          return {
            rows: [{ id: USER_ID, tenant_id: TENANT_ID, email: 'a@b.nl', role: 'admin' }],
            rowCount: 1,
          };
        }
        if (/SELECT user_id, tenant_id, secret/i.test(sql)) {
          return {
            rows: [
              {
                user_id: USER_ID,
                tenant_id: TENANT_ID,
                secret,
                enabled: true,
                backup_codes: [],
                enabled_at: new Date(),
                last_used_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        if (/DELETE FROM user_2fa_secrets/i.test(sql)) {
          deleted = true;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await disable2fa(USER_ID, code);
    expect(deleted).toBe(true);
  });

  it('regenerateBackupCodes vereist TOTP en geeft 10 nieuwe codes', async () => {
    const secret = generateSecret();
    const code = authenticator.generate(secret);

    const client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id, tenant_id, email, role FROM users/i.test(sql)) {
          return {
            rows: [{ id: USER_ID, tenant_id: TENANT_ID, email: 'a@b.nl', role: 'admin' }],
            rowCount: 1,
          };
        }
        if (/SELECT user_id, tenant_id, secret/i.test(sql)) {
          return {
            rows: [
              {
                user_id: USER_ID,
                tenant_id: TENANT_ID,
                secret,
                enabled: true,
                backup_codes: [],
                enabled_at: new Date(),
                last_used_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const newCodes = await regenerateBackupCodes(USER_ID, code);
    expect(newCodes).toHaveLength(10);
  });
});

describe('twoFactor.service — tenant policy', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('setTenant2faPolicy upsert + audit', async () => {
    let upserted = false;
    const client = mockClient({
      __matcher: (sql) => {
        if (/INSERT INTO tenant_2fa_policy/i.test(sql)) {
          upserted = true;
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                required_for_roles: ['admin'],
                required_for_all: false,
                grace_period_days: 14,
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await setTenant2faPolicy(TENANT_ID, USER_ID, {
      required_for_roles: ['admin'],
      grace_period_days: 14,
    });
    expect(upserted).toBe(true);
    expect(result.required_for_roles).toEqual(['admin']);
  });

  it('require2faForUser: required wanneer policy + role match + grace verlopen', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/SELECT tenant_id, required_for_roles/i.test(sql)) {
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                required_for_roles: ['admin'],
                required_for_all: false,
                grace_period_days: 1,
                // policy was created 30 days ago — grace is over
                created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                updated_at: new Date(),
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT enabled FROM user_2fa_secrets/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const decision = await require2faForUser(TENANT_ID, USER_ID, 'admin');
    expect(decision.required).toBe(true);
    expect(decision.in_grace).toBe(false);
  });

  it('require2faForUser: in_grace wanneer policy nog jong', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/SELECT tenant_id, required_for_roles/i.test(sql)) {
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                required_for_roles: ['admin'],
                required_for_all: false,
                grace_period_days: 7,
                created_at: new Date(), // net aangemaakt
                updated_at: new Date(),
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT enabled FROM user_2fa_secrets/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const decision = await require2faForUser(TENANT_ID, USER_ID, 'admin');
    expect(decision.required).toBe(false);
    expect(decision.in_grace).toBe(true);
  });

  it('require2faForUser: not required wanneer policy ontbreekt', async () => {
    const client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    const decision = await require2faForUser(TENANT_ID, USER_ID, 'admin');
    expect(decision.required).toBe(false);
  });

  it('getTenant2faPolicy: null wanneer geen policy', async () => {
    const client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    expect(await getTenant2faPolicy(TENANT_ID)).toBeNull();
  });
});
