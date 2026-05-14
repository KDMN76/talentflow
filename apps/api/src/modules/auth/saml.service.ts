/**
 * SAML/SSO service — Sprint Q4.2 (Agent NNN).
 *
 * Per-tenant SAML-config: TalentFlow is altijd de Service Provider (SP), de
 * tenant brengt z'n eigen IdP mee (Okta, Azure AD, Google Workspace, of een
 * generieke SAML 2.0 IdP). Strategy-objects worden per request uit de DB
 * opgebouwd — we cachen niet, omdat een config-update (cert-rotation) direct
 * effect moet hebben.
 *
 * Provider-quirks:
 *   - Azure AD: emit `nameid-format=persistent` en stuurt email als `mail`
 *     of `userPrincipalName`. attribute_mapping kan dit per tenant nuanceren.
 *   - Okta: standaard `unspecified` nameid; email zit op `email` of
 *     `Email` (case-variant — we matchen lowercase in mapAttribute).
 *   - Google Workspace: gebruikt ECP/SAML 2.0 met email als nameid.
 */

import passportSaml from 'passport-saml';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { PoolClient } from 'pg';
import { withTenant, withoutTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import type { JwtPayload } from '../../middleware/auth';

const { Strategy: SamlStrategy } = passportSaml;
type SamlStrategyType = InstanceType<typeof SamlStrategy>;

const REFRESH_TOKEN_TTL_DAYS = 7;
const ACCESS_TOKEN_TTL = '15m';

export type SamlProvider = 'okta' | 'azure_ad' | 'google_workspace' | 'generic_saml';

export interface SamlConfig {
  tenantId: string;
  provider: SamlProvider;
  enabled: boolean;
  entryPoint: string;
  issuer: string;
  idpCert: string;
  attributeMapping: Record<string, string>;
  autoCreateUsers: boolean;
  defaultRole: string;
}

export interface SsoUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
}

interface SsoConfigRow {
  tenant_id: string;
  provider: SamlProvider | null;
  enabled: boolean;
  entry_point: string | null;
  issuer: string | null;
  idp_cert: string | null;
  scim_enabled: boolean;
  scim_token_hash: string | null;
  auto_create_users: boolean;
  default_role: string;
  attribute_mapping: Record<string, string>;
}

function rowToConfig(row: SsoConfigRow): SamlConfig | null {
  if (!row.provider || !row.entry_point || !row.issuer || !row.idp_cert) {
    return null;
  }
  return {
    tenantId: row.tenant_id,
    provider: row.provider,
    enabled: row.enabled,
    entryPoint: row.entry_point,
    issuer: row.issuer,
    idpCert: row.idp_cert,
    attributeMapping: row.attribute_mapping ?? {},
    autoCreateUsers: row.auto_create_users,
    defaultRole: row.default_role,
  };
}

export async function getSamlConfigForTenant(
  tenantId: string
): Promise<SamlConfig | null> {
  return withTenant(tenantId, async (client: PoolClient) => {
    const { rows } = await client.query<SsoConfigRow>(
      `SELECT tenant_id, provider, enabled, entry_point, issuer, idp_cert,
              scim_enabled, scim_token_hash, auto_create_users, default_role,
              attribute_mapping
         FROM tenant_sso_config WHERE tenant_id = $1`,
      [tenantId]
    );
    if (!rows[0]) return null;
    return rowToConfig(rows[0]);
  });
}

export async function getRawSsoConfig(
  tenantId: string
): Promise<SsoConfigRow | null> {
  return withTenant(tenantId, async (client: PoolClient) => {
    const { rows } = await client.query<SsoConfigRow>(
      `SELECT tenant_id, provider, enabled, entry_point, issuer, idp_cert,
              scim_enabled, scim_token_hash, auto_create_users, default_role,
              attribute_mapping
         FROM tenant_sso_config WHERE tenant_id = $1`,
      [tenantId]
    );
    return rows[0] ?? null;
  });
}

export interface SetSamlConfigInput {
  provider: SamlProvider;
  enabled?: boolean;
  entry_point: string;
  issuer: string;
  idp_cert: string;
  attribute_mapping?: Record<string, string>;
  auto_create_users?: boolean;
  default_role?: string;
}

export async function setSamlConfig(
  tenantId: string,
  userId: string,
  input: SetSamlConfigInput,
  ctx: AuditContext = {}
): Promise<SamlConfig> {
  return withTenant(tenantId, async (client: PoolClient) => {
    const { rows } = await client.query<SsoConfigRow>(
      `INSERT INTO tenant_sso_config
         (tenant_id, provider, enabled, entry_point, issuer, idp_cert,
          attribute_mapping, auto_create_users, default_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       ON CONFLICT (tenant_id) DO UPDATE
         SET provider = EXCLUDED.provider,
             enabled = EXCLUDED.enabled,
             entry_point = EXCLUDED.entry_point,
             issuer = EXCLUDED.issuer,
             idp_cert = EXCLUDED.idp_cert,
             attribute_mapping = EXCLUDED.attribute_mapping,
             auto_create_users = EXCLUDED.auto_create_users,
             default_role = EXCLUDED.default_role
       RETURNING tenant_id, provider, enabled, entry_point, issuer, idp_cert,
                 scim_enabled, scim_token_hash, auto_create_users, default_role,
                 attribute_mapping`,
      [
        tenantId,
        input.provider,
        input.enabled ?? false,
        input.entry_point,
        input.issuer,
        input.idp_cert,
        JSON.stringify(input.attribute_mapping ?? {}),
        input.auto_create_users ?? true,
        input.default_role ?? 'recruiter',
      ]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.SSO_CONFIG_UPDATED,
        entityType: 'tenant',
        entityId: tenantId,
        userId,
        after: { provider: input.provider, enabled: input.enabled, entry_point: input.entry_point },
      },
      ctx
    );

    const cfg = rowToConfig(rows[0]!);
    if (!cfg) {
      throw new AppError(500, 'SSO_CONFIG_INVALID', 'SSO-config kon niet opgeslagen worden');
    }
    return cfg;
  });
}

export async function disableSso(
  tenantId: string,
  userId: string,
  ctx: AuditContext = {}
): Promise<void> {
  await withTenant(tenantId, async (client: PoolClient) => {
    await client.query(
      'UPDATE tenant_sso_config SET enabled = FALSE WHERE tenant_id = $1',
      [tenantId]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.SSO_CONFIG_DISABLED,
        entityType: 'tenant',
        entityId: tenantId,
        userId,
      },
      ctx
    );
  });
}

/**
 * SP-metadata XML voor IdP-import. We genereren handmatig — passport-saml's
 * `generateServiceProviderMetadata` vereist een Strategy-instance, maar
 * voor metadata hoeven we geen IdP-cert te kennen. Pure string template.
 */
export async function generateSamlMetadata(tenantId: string): Promise<string> {
  const cfg = await getSamlConfigForTenant(tenantId);
  if (!cfg) {
    throw new AppError(404, 'SSO_NOT_CONFIGURED', 'Geen SSO-config voor deze tenant');
  }
  const acsUrl = buildAcsUrl(tenantId);
  return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
                     entityID="${escapeXml(cfg.issuer)}">
  <md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"
                       AuthnRequestsSigned="false"
                       WantAssertionsSigned="true">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
                                 Location="${escapeXml(acsUrl)}"
                                 index="0"
                                 isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildAcsUrl(tenantId: string): string {
  const base = process.env.PUBLIC_API_URL ?? 'http://localhost:4000';
  return `${base}/api/sso/${tenantId}/acs`;
}

/**
 * Per-tenant Passport SAML strategy — gebouwd uit de DB-config. Caller
 * is verantwoordelijk voor het op één request scope houden van de
 * strategy (we cachen niet). De callback van passport-saml wordt door
 * de controller geleverd.
 */
export async function buildPassportStrategy(
  tenantId: string
): Promise<SamlStrategyType> {
  const cfg = await getSamlConfigForTenant(tenantId);
  if (!cfg) {
    throw new AppError(404, 'SSO_NOT_CONFIGURED', 'SSO niet ingesteld voor deze tenant');
  }
  if (!cfg.enabled) {
    throw new AppError(403, 'SSO_DISABLED', 'SSO is uitgeschakeld voor deze tenant');
  }

  return new SamlStrategy(
    {
      entryPoint: cfg.entryPoint,
      issuer: cfg.issuer,
      callbackUrl: buildAcsUrl(tenantId),
      cert: normalizeCert(cfg.idpCert),
      // Provider-specifieke nameid hints
      identifierFormat: providerNameIdFormat(cfg.provider),
      // Validate signature standaard aan; dat is wat we willen
      validateInResponseTo: false,
      disableRequestedAuthnContext: cfg.provider === 'azure_ad',
    },
    // De verify-callback wordt overschreven door handleSamlCallback —
    // hier is een no-op die het profile direct doorgeeft. Cast naar `any`
    // omdat passport-saml's overload-types een function-shape verwachten
    // die TS niet altijd correct uit `VerifyWithoutRequest` infereert.
    ((profile: unknown, done: (err: Error | null, user?: unknown) => void) =>
      done(null, profile ?? {})) as never
  );
}

function providerNameIdFormat(provider: SamlProvider): string {
  switch (provider) {
    case 'azure_ad':
      // Azure AD geeft standaard `persistent` — daarmee zit een ondoorzichtige
      // GUID in nameID. We map hier niet op; email komt via attribuut.
      return 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent';
    case 'google_workspace':
    case 'okta':
    case 'generic_saml':
    default:
      return 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';
  }
}

function normalizeCert(cert: string): string {
  // passport-saml accepteert PEM zonder begin/end markers — we strippen
  // die wanneer aanwezig en geven dan de naakte base64 terug. Tolerant
  // voor admins die de hele PEM-blob plakken.
  return cert
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Map IdP-attributen naar canonieke user-fields. Tenant-admin kan via
 * `attribute_mapping` een eigen mapping zetten; defaults dekken Okta,
 * Azure AD en Google Workspace.
 */
export interface MappedSamlProfile {
  email: string;
  name: string;
  externalId?: string;
  groups?: string[];
}

export function mapSamlProfile(
  profile: Record<string, unknown>,
  cfg: SamlConfig
): MappedSamlProfile {
  const map = {
    email:
      cfg.attributeMapping.email ??
      (cfg.provider === 'azure_ad' ? 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress' : 'email'),
    name:
      cfg.attributeMapping.name ??
      (cfg.provider === 'azure_ad' ? 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name' : 'displayName'),
    externalId: cfg.attributeMapping.externalId ?? 'nameID',
    groups: cfg.attributeMapping.groups ?? 'groups',
  };

  // Probeer in volgorde meerdere veldnamen, lowercase-tolerant.
  const lookupCandidates = (key: string): string[] => {
    const lk = key.toLowerCase();
    const candidates = [
      key,
      lk,
      key === 'email' ? 'mail' : '',
      key === 'email' ? 'userPrincipalName' : '',
      key === 'email' ? 'EmailAddress' : '',
      key === 'name' ? 'cn' : '',
      key === 'name' ? 'displayName' : '',
    ].filter(Boolean);
    return Array.from(new Set(candidates));
  };

  const findField = (target: string): string | undefined => {
    const direct = profile[target];
    if (typeof direct === 'string' && direct.length > 0) return direct;
    for (const c of lookupCandidates(target)) {
      const v = profile[c];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    return undefined;
  };

  const email =
    (typeof profile[map.email] === 'string' ? (profile[map.email] as string) : undefined) ??
    findField('email') ??
    (typeof profile.nameID === 'string' ? (profile.nameID as string) : undefined);

  if (!email) {
    throw new AppError(400, 'SAML_NO_EMAIL', 'IdP heeft geen email aangeleverd');
  }

  const name =
    (typeof profile[map.name] === 'string' ? (profile[map.name] as string) : undefined) ??
    findField('name') ??
    email.split('@')[0]!;

  const externalId =
    (typeof profile[map.externalId] === 'string' ? (profile[map.externalId] as string) : undefined) ??
    (typeof profile.nameID === 'string' ? (profile.nameID as string) : undefined);

  const rawGroups = profile[map.groups] ?? profile.groups;
  let groups: string[] | undefined;
  if (Array.isArray(rawGroups)) {
    groups = rawGroups.filter((g): g is string => typeof g === 'string');
  } else if (typeof rawGroups === 'string') {
    groups = [rawGroups];
  }

  return { email: email.toLowerCase(), name, externalId, groups };
}

function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not configured');
  return s;
}

function generateAccessToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: ACCESS_TOKEN_TTL });
}

/**
 * Vertaal een gevalideerde SAML-profile naar een TalentFlow-sessie:
 *   - Lookup user op email + tenant_id
 *   - Indien niet gevonden + `auto_create_users`: insert met default_role
 *   - Als de user inactief/deleted is → 403
 *   - Issue access + refresh token (zelfde flow als password-login)
 */
export async function handleSamlCallback(
  tenantId: string,
  profile: Record<string, unknown>,
  ctx: AuditContext = {}
): Promise<{
  user: SsoUser;
  accessToken: string;
  refreshToken: string;
}> {
  const cfg = await getSamlConfigForTenant(tenantId);
  if (!cfg || !cfg.enabled) {
    throw new AppError(403, 'SSO_DISABLED', 'SSO is uitgeschakeld');
  }

  const mapped = mapSamlProfile(profile, cfg);

  return withTenant(tenantId, async (client: PoolClient) => {
    const { rows: existing } = await client.query<{
      id: string;
      email: string;
      name: string;
      role: string;
      tenant_id: string;
      is_active: boolean;
      deleted_at: Date | null;
    }>(
      `SELECT id, email, name, role, tenant_id, is_active, deleted_at
         FROM users
        WHERE tenant_id = $1 AND email = $2
        LIMIT 1`,
      [tenantId, mapped.email]
    );

    let user = existing[0];

    if (!user) {
      if (!cfg.autoCreateUsers) {
        await logAudit(
          client,
          tenantId,
          {
            action: AuditActions.SSO_LOGIN_FAILED,
            entityType: 'user',
            entityId: null,
            after: { email: mapped.email, reason: 'auto_create_disabled' },
          },
          ctx
        );
        throw new AppError(403, 'SSO_USER_NOT_PROVISIONED',
          'Deze gebruiker is niet bekend en auto-provisioning staat uit');
      }
      const { rows: created } = await client.query<{
        id: string;
        email: string;
        name: string;
        role: string;
        tenant_id: string;
        is_active: boolean;
        deleted_at: Date | null;
      }>(
        `INSERT INTO users (tenant_id, email, name, role, sso_provider, scim_external_id, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6, '')
         RETURNING id, email, name, role, tenant_id, is_active, deleted_at`,
        [
          tenantId,
          mapped.email,
          mapped.name,
          cfg.defaultRole,
          cfg.provider,
          mapped.externalId ?? null,
        ]
      );
      user = created[0]!;
    }

    if (user.deleted_at || !user.is_active) {
      throw new AppError(403, 'ACCOUNT_DISABLED', 'Dit account is uitgeschakeld');
    }

    const refreshTokenRaw = crypto.randomBytes(64).toString('hex');
    const refreshHash = crypto.createHash('sha256').update(refreshTokenRaw).digest('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await client.query(
      `INSERT INTO refresh_tokens (user_id, tenant_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [user.id, tenantId, refreshHash, expiresAt]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.SSO_LOGIN,
        entityType: 'user',
        entityId: user.id,
        userId: user.id,
        after: { provider: cfg.provider, email: user.email },
      },
      ctx
    );

    const accessToken = generateAccessToken({
      userId: user.id,
      tenantId,
      email: user.email,
      role: user.role,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId,
      },
      accessToken,
      refreshToken: refreshTokenRaw,
    };
  });
}

// ────────────────────────────────────────────────────────────────────────────
// SCIM token management
// ────────────────────────────────────────────────────────────────────────────

import bcrypt from 'bcrypt';

/**
 * Genereer een nieuwe SCIM-bearer-token. Plaintext wordt EENMALIG aan de
 * caller getoond; de DB bewaart alleen een bcrypt-hash. Hiermee kan de
 * tenant-admin het token in z'n IdP-config (Okta SCIM 2.0, Azure AD
 * Provisioning, …) plakken.
 */
export async function rotateScimToken(
  tenantId: string,
  userId: string,
  ctx: AuditContext = {}
): Promise<{ token: string }> {
  const tokenPlain = `tflw_scim_${crypto.randomBytes(32).toString('hex')}`;
  const tokenHash = await bcrypt.hash(tokenPlain, 10);

  await withTenant(tenantId, async (client: PoolClient) => {
    await client.query(
      `INSERT INTO tenant_sso_config (tenant_id, scim_enabled, scim_token_hash)
       VALUES ($1, TRUE, $2)
       ON CONFLICT (tenant_id) DO UPDATE
         SET scim_enabled = TRUE,
             scim_token_hash = EXCLUDED.scim_token_hash`,
      [tenantId, tokenHash]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.SSO_CONFIG_UPDATED,
        entityType: 'tenant',
        entityId: tenantId,
        userId,
        after: { scim_token_rotated: true },
      },
      ctx
    );
  });

  return { token: tokenPlain };
}

/**
 * Valideer een binnenkomend SCIM-bearer-token tegen de hash. Sequential
 * scan over alle tenants is acceptabel: SCIM-traffic is laag-volume en
 * de bcrypt-compare is constant-time per row.
 *
 * Voor schaal naar 1000+ tenants kan een `scim_token_prefix` kolom worden
 * toegevoegd zodat we eerst op prefix kunnen pre-filteren — maar in MVP
 * is dit niet de bottleneck.
 */
export async function authenticateScimToken(
  bearerToken: string
): Promise<{ tenantId: string } | null> {
  if (!bearerToken || !bearerToken.startsWith('tflw_scim_')) return null;

  return withoutTenant(async (client: PoolClient) => {
    const { rows } = await client.query<{
      tenant_id: string;
      scim_token_hash: string;
    }>(
      `SELECT tenant_id, scim_token_hash
         FROM tenant_sso_config
        WHERE scim_enabled = TRUE AND scim_token_hash IS NOT NULL`
    );
    for (const row of rows) {
      if (await bcrypt.compare(bearerToken, row.scim_token_hash)) {
        return { tenantId: row.tenant_id };
      }
    }
    return null;
  });
}
