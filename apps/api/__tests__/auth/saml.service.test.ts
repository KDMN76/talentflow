import { describe, it, expect, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

// Mock passport-saml zodat we niet daadwerkelijk een SAML-Strategy hoeven
// op te bouwen voor unit-tests.
vi.mock('passport-saml', () => ({
  default: {
    Strategy: class MockSamlStrategy {
      constructor(_opts: unknown, _verify: unknown) {}
    },
    SAML: class MockSAML {},
  },
}));

import {
  setSamlConfig,
  getSamlConfigForTenant,
  disableSso,
  generateSamlMetadata,
  mapSamlProfile,
  handleSamlCallback,
  rotateScimToken,
  authenticateScimToken,
  type SamlConfig,
} from '../../src/modules/auth/saml.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

const SAMPLE_CERT =
  '-----BEGIN CERTIFICATE-----\nMIIBIjANBgkqhkiG9w0BAQEF\n-----END CERTIFICATE-----';

describe('saml.service — config CRUD', () => {
  let client: MockClient;
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('setSamlConfig upsert + audit', async () => {
    let inserted = false;
    client = mockClient({
      __matcher: (sql) => {
        if (/INSERT INTO tenant_sso_config/i.test(sql)) {
          inserted = true;
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                provider: 'okta',
                enabled: true,
                entry_point: 'https://acme.okta.com/sso',
                issuer: 'tflw-sp',
                idp_cert: SAMPLE_CERT,
                scim_enabled: false,
                scim_token_hash: null,
                auto_create_users: true,
                default_role: 'recruiter',
                attribute_mapping: {},
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const cfg = await setSamlConfig(TENANT_ID, USER_ID, {
      provider: 'okta',
      enabled: true,
      entry_point: 'https://acme.okta.com/sso',
      issuer: 'tflw-sp',
      idp_cert: SAMPLE_CERT,
    });

    expect(inserted).toBe(true);
    expect(cfg.provider).toBe('okta');
    expect(cfg.enabled).toBe(true);
  });

  it('getSamlConfigForTenant returns null when geen complete config', async () => {
    client = mockClient({
      __matcher: () => ({
        rows: [
          {
            tenant_id: TENANT_ID,
            provider: null,
            enabled: false,
            entry_point: null,
            issuer: null,
            idp_cert: null,
            scim_enabled: false,
            scim_token_hash: null,
            auto_create_users: true,
            default_role: 'recruiter',
            attribute_mapping: {},
          },
        ],
        rowCount: 1,
      }),
    });
    teardown = installPoolMock(client);
    expect(await getSamlConfigForTenant(TENANT_ID)).toBeNull();
  });

  it('disableSso zet enabled=FALSE en logt audit', async () => {
    let disabled = false;
    client = mockClient({
      __matcher: (sql) => {
        if (/UPDATE tenant_sso_config SET enabled = FALSE/i.test(sql)) {
          disabled = true;
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await disableSso(TENANT_ID, USER_ID);
    expect(disabled).toBe(true);
  });

  it('generateSamlMetadata returneert XML met SP-info', async () => {
    client = mockClient({
      __matcher: () => ({
        rows: [
          {
            tenant_id: TENANT_ID,
            provider: 'okta',
            enabled: true,
            entry_point: 'https://acme.okta.com/sso',
            issuer: 'tflw-sp',
            idp_cert: SAMPLE_CERT,
            scim_enabled: false,
            scim_token_hash: null,
            auto_create_users: true,
            default_role: 'recruiter',
            attribute_mapping: {},
          },
        ],
        rowCount: 1,
      }),
    });
    teardown = installPoolMock(client);

    const xml = await generateSamlMetadata(TENANT_ID);
    expect(xml).toContain('<md:EntityDescriptor');
    expect(xml).toContain('entityID="tflw-sp"');
    expect(xml).toContain(`/api/sso/${TENANT_ID}/acs`);
  });
});

describe('saml.service — mapSamlProfile', () => {
  const baseCfg: SamlConfig = {
    tenantId: TENANT_ID,
    provider: 'okta',
    enabled: true,
    entryPoint: 'https://x',
    issuer: 'tflw',
    idpCert: SAMPLE_CERT,
    attributeMapping: {},
    autoCreateUsers: true,
    defaultRole: 'recruiter',
  };

  it('Okta: mapt email + name', () => {
    const m = mapSamlProfile(
      { email: 'JANE@ACME.NL', displayName: 'Jane', nameID: 'jane@acme.nl' },
      baseCfg
    );
    expect(m.email).toBe('jane@acme.nl');
    expect(m.name).toBe('Jane');
  });

  it('Azure AD: gebruikt schemas.xmlsoap claims', () => {
    const m = mapSamlProfile(
      {
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress': 'jan@acme.nl',
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name': 'Jan',
        nameID: 'persistent-id-xyz',
      },
      { ...baseCfg, provider: 'azure_ad' }
    );
    expect(m.email).toBe('jan@acme.nl');
    expect(m.name).toBe('Jan');
    expect(m.externalId).toBe('persistent-id-xyz');
  });

  it('valt terug op nameID wanneer geen email-attribuut', () => {
    const m = mapSamlProfile({ nameID: 'fallback@x.nl' }, baseCfg);
    expect(m.email).toBe('fallback@x.nl');
  });

  it('throwt SAML_NO_EMAIL wanneer niets matcht', () => {
    expect(() => mapSamlProfile({} as Record<string, unknown>, baseCfg)).toThrow();
  });

  it('attribute_mapping override neemt voorrang', () => {
    const m = mapSamlProfile(
      { customMail: 'cm@x.nl', displayName: 'CM' },
      { ...baseCfg, attributeMapping: { email: 'customMail' } }
    );
    expect(m.email).toBe('cm@x.nl');
  });
});

describe('saml.service — handleSamlCallback', () => {
  let client: MockClient;
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('looks up bestaande user, issuet JWT + refresh', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT tenant_id, provider, enabled/i.test(sql)) {
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                provider: 'okta',
                enabled: true,
                entry_point: 'https://x',
                issuer: 'tflw',
                idp_cert: SAMPLE_CERT,
                scim_enabled: false,
                scim_token_hash: null,
                auto_create_users: true,
                default_role: 'recruiter',
                attribute_mapping: {},
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT id, email, name, role, tenant_id, is_active, deleted_at/i.test(sql)) {
          return {
            rows: [
              {
                id: USER_ID,
                email: 'jane@acme.nl',
                name: 'Jane',
                role: 'recruiter',
                tenant_id: TENANT_ID,
                is_active: true,
                deleted_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT INTO refresh_tokens/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await handleSamlCallback(TENANT_ID, {
      email: 'jane@acme.nl',
      displayName: 'Jane',
      nameID: 'jane@acme.nl',
    });

    expect(result.user.email).toBe('jane@acme.nl');
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    const payload = jwt.verify(result.accessToken, process.env.JWT_SECRET!) as { userId: string };
    expect(payload.userId).toBe(USER_ID);
  });

  it('auto-provisioned wanneer user niet bestaat + auto_create_users=true', async () => {
    let inserted = false;
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT tenant_id, provider, enabled/i.test(sql)) {
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                provider: 'okta',
                enabled: true,
                entry_point: 'https://x',
                issuer: 'tflw',
                idp_cert: SAMPLE_CERT,
                scim_enabled: false,
                scim_token_hash: null,
                auto_create_users: true,
                default_role: 'recruiter',
                attribute_mapping: {},
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT id, email, name, role, tenant_id, is_active, deleted_at\s+FROM users\s+WHERE/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/INSERT INTO users/i.test(sql)) {
          inserted = true;
          return {
            rows: [
              {
                id: USER_ID,
                email: 'newuser@acme.nl',
                name: 'New User',
                role: 'recruiter',
                tenant_id: TENANT_ID,
                is_active: true,
                deleted_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT INTO refresh_tokens/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const r = await handleSamlCallback(TENANT_ID, {
      email: 'newuser@acme.nl',
      displayName: 'New User',
      nameID: 'newuser@acme.nl',
    });
    expect(inserted).toBe(true);
    expect(r.user.role).toBe('recruiter');
  });

  it('weigert wanneer auto_create_users=false en user niet bestaat', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT tenant_id, provider, enabled/i.test(sql)) {
          return {
            rows: [
              {
                tenant_id: TENANT_ID,
                provider: 'okta',
                enabled: true,
                entry_point: 'https://x',
                issuer: 'tflw',
                idp_cert: SAMPLE_CERT,
                scim_enabled: false,
                scim_token_hash: null,
                auto_create_users: false,
                default_role: 'recruiter',
                attribute_mapping: {},
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT id, email, name, role, tenant_id, is_active, deleted_at\s+FROM users/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      handleSamlCallback(TENANT_ID, { email: 'x@y.nl', displayName: 'X' })
    ).rejects.toMatchObject({ code: 'SSO_USER_NOT_PROVISIONED' });
  });
});

describe('saml.service — SCIM token management', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('rotateScimToken returnt plain-text + persistert hash', async () => {
    let storedHash: string | undefined;
    const client = mockClient({
      __matcher: (sql, params) => {
        if (/INSERT INTO tenant_sso_config/i.test(sql)) {
          storedHash = params[1] as string;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const r = await rotateScimToken(TENANT_ID, USER_ID);
    expect(r.token).toMatch(/^tflw_scim_/);
    expect(storedHash).toBeTruthy();
    expect(storedHash).not.toBe(r.token);
  });

  it('authenticateScimToken: null wanneer prefix ontbreekt', async () => {
    teardown = () => {};
    expect(await authenticateScimToken('not-a-tflw-token')).toBeNull();
  });

  it('authenticateScimToken: matcht hash en returneert tenant_id', async () => {
    const tokenPlain = 'tflw_scim_abcdef';
    // bcrypt-mock: hash === `bcrypt$${pw}` voor compare-truthy
    const client = mockClient({
      __matcher: () => ({
        rows: [{ tenant_id: TENANT_ID, scim_token_hash: `bcrypt$${tokenPlain}` }],
        rowCount: 1,
      }),
    });
    teardown = installPoolMock(client);

    const r = await authenticateScimToken(tokenPlain);
    expect(r?.tenantId).toBe(TENANT_ID);
  });
});
