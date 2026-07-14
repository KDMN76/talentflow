/**
 * SSO/SAML routes — Sprint Q4.2 (Agent NNN).
 *
 * Public endpoints onder /api/sso/:tenantId/* (login, ACS, metadata).
 * Admin endpoints onder /api/admin/sso/* — JWT vereist + role=admin.
 *
 * We gebruiken passport-saml's `Strategy` direct (geen Passport-mw chain) en
 * roepen `_saml.validatePostResponseAsync` aan op het ACS-endpoint. Dat is
 * eenvoudiger dan een Passport-stack opzetten enkel voor SAML — we hebben
 * geen sessions nodig (we issuen JWT in-place).
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { SAML } from 'passport-saml';
import * as samlService from './saml.service';
import { requireAuth, requireRole } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import { auditCtxFromReq } from '../../lib/audit';

// Named import — passport-saml@3.x is puur CJS met named exports en geen default.

const REFRESH_COOKIE = 'refreshToken';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const, // SAML POST-redirects komen cross-site
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ensureValidTenantId(tenantId: string): void {
  if (!UUID_REGEX.test(tenantId)) {
    throw new AppError(400, 'INVALID_TENANT_ID', 'Ongeldig tenant-id');
  }
}

function buildAcsUrl(tenantId: string): string {
  const base = process.env.PUBLIC_API_URL ?? 'http://localhost:4000';
  return `${base}/api/sso/${tenantId}/acs`;
}

function buildMetadataUrl(tenantId: string): string {
  const base = process.env.PUBLIC_API_URL ?? 'http://localhost:4000';
  return `${base}/api/sso/${tenantId}/metadata.xml`;
}

function buildSamlClient(cfg: samlService.SamlConfig): InstanceType<typeof SAML> {
  return new SAML({
    entryPoint: cfg.entryPoint,
    issuer: cfg.issuer,
    callbackUrl: buildAcsUrl(cfg.tenantId),
    cert: cfg.idpCert
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s+/g, '')
      .trim(),
    identifierFormat:
      cfg.provider === 'azure_ad'
        ? 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent'
        : 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    validateInResponseTo: false,
    disableRequestedAuthnContext: cfg.provider === 'azure_ad',
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Public router — /api/sso/:tenantId/*
// ────────────────────────────────────────────────────────────────────────────

export const ssoPublicRouter = Router();

/**
 * GET /api/sso/:tenantId/login
 * Build a SAML AuthnRequest en redirect naar IdP entryPoint.
 */
ssoPublicRouter.get(
  '/:tenantId/login',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId } = req.params;
      ensureValidTenantId(tenantId!);
      const cfg = await samlService.getSamlConfigForTenant(tenantId!);
      if (!cfg || !cfg.enabled) {
        throw new AppError(404, 'SSO_NOT_CONFIGURED', 'SSO is niet beschikbaar voor deze tenant');
      }
      const saml = buildSamlClient(cfg);
      const authUrl = await saml.getAuthorizeUrlAsync('', '', {});
      res.redirect(authUrl);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/sso/:tenantId/acs
 * SAML AssertionConsumerService — IdP POST'st hier de SAMLResponse.
 * Validate + lookup user + issue JWT + redirect naar frontend met token.
 */
ssoPublicRouter.post(
  '/:tenantId/acs',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId } = req.params;
      ensureValidTenantId(tenantId!);
      const cfg = await samlService.getSamlConfigForTenant(tenantId!);
      if (!cfg) {
        throw new AppError(404, 'SSO_NOT_CONFIGURED', 'SSO niet ingesteld');
      }
      const samlResponseB64 = (req.body?.SAMLResponse ?? '') as string;
      if (!samlResponseB64) {
        throw new AppError(400, 'SAML_MISSING_RESPONSE', 'SAMLResponse ontbreekt');
      }

      const saml = buildSamlClient(cfg);
      const { profile } = await saml.validatePostResponseAsync({
        SAMLResponse: samlResponseB64,
      });
      if (!profile) {
        throw new AppError(401, 'SAML_INVALID_RESPONSE', 'Ongeldige SAML-response');
      }

      const result = await samlService.handleSamlCallback(
        tenantId!,
        profile as Record<string, unknown>,
        auditCtxFromReq(req)
      );

      res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);

      const frontend = process.env.FRONTEND_URL ?? 'http://localhost:3000';
      const redirectUrl = `${frontend}/auth/sso-callback?token=${encodeURIComponent(result.accessToken)}`;
      res.redirect(redirectUrl);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/sso/:tenantId/metadata.xml
 * SP-metadata XML — geef de IdP-admin om te importeren.
 */
ssoPublicRouter.get(
  '/:tenantId/metadata.xml',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId } = req.params;
      ensureValidTenantId(tenantId!);
      const xml = await samlService.generateSamlMetadata(tenantId!);
      res.setHeader('Content-Type', 'application/samlmetadata+xml');
      res.send(xml);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/sso/:tenantId/logout
 * Optionele Single Logout — best-effort: clear local refresh + redirect
 * naar IdP SLO-endpoint indien geconfigureerd. Voor MVP clearen we
 * alleen de cookie en sturen we de user terug naar /login.
 */
ssoPublicRouter.get(
  '/:tenantId/logout',
  (req: Request, res: Response) => {
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    const frontend = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    res.redirect(`${frontend}/login`);
  }
);

// ────────────────────────────────────────────────────────────────────────────
// Admin router — /api/admin/sso/* (JWT + role=admin)
// ────────────────────────────────────────────────────────────────────────────

export const ssoAdminRouter = Router();

ssoAdminRouter.use(requireAuth, requireRole('admin', 'owner'));

ssoAdminRouter.get(
  '/config',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user!.tenantId;
      const raw = await samlService.getRawSsoConfig(tenantId);
      if (!raw) {
        res.json({ configured: false });
        return;
      }
      res.json({
        configured: true,
        provider: raw.provider,
        enabled: raw.enabled,
        entry_point: raw.entry_point,
        issuer: raw.issuer,
        // Cert wordt niet teruggestuurd — alleen een fingerprint zou
        // hier passen, maar dat houden we voor een latere iteratie.
        idp_cert_set: !!raw.idp_cert,
        scim_enabled: raw.scim_enabled,
        auto_create_users: raw.auto_create_users,
        default_role: raw.default_role,
        attribute_mapping: raw.attribute_mapping,
        // SP-metadata: afgeleid van dezelfde bron als /api/sso/:tenantId/metadata.xml
        // (SP entityID = issuer; ACS = /acs; metadata = /metadata.xml) zodat de
        // admin-UI ze kan tonen/kopiëren + de download-knop kan renderen.
        sp_entity_id: raw.issuer,
        sp_acs_url: buildAcsUrl(tenantId),
        sp_metadata_url: buildMetadataUrl(tenantId),
      });
    } catch (err) {
      next(err);
    }
  }
);

const setConfigSchema = z.object({
  provider: z.enum(['okta', 'azure_ad', 'google_workspace', 'generic_saml']),
  enabled: z.boolean().optional(),
  entry_point: z.string().url(),
  issuer: z.string().min(1).max(255),
  idp_cert: z.string().min(20),
  attribute_mapping: z.record(z.string()).optional(),
  auto_create_users: z.boolean().optional(),
  default_role: z.string().optional(),
});

ssoAdminRouter.put(
  '/config',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = setConfigSchema.parse(req.body);
      const tenantId = req.user!.tenantId;
      const userId = req.user!.userId;
      const cfg = await samlService.setSamlConfig(tenantId, userId, input, auditCtxFromReq(req));
      res.json({
        provider: cfg.provider,
        enabled: cfg.enabled,
        entry_point: cfg.entryPoint,
        issuer: cfg.issuer,
        auto_create_users: cfg.autoCreateUsers,
        default_role: cfg.defaultRole,
        attribute_mapping: cfg.attributeMapping,
      });
    } catch (err) {
      next(err);
    }
  }
);

ssoAdminRouter.delete(
  '/config',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user!.tenantId;
      const userId = req.user!.userId;
      await samlService.disableSso(tenantId, userId, auditCtxFromReq(req));
      res.json({ disabled: true });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/admin/sso/test
 * Smoke-test: bouw de SAML-client op en verifieer dat de cert tenminste
 * parsebaar is. Op success retourneren we de auth-URL die we naar de
 * IdP zouden sturen — admin kan zelf op de link klikken om end-to-end te
 * testen.
 */
ssoAdminRouter.post(
  '/test',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user!.tenantId;
      const cfg = await samlService.getSamlConfigForTenant(tenantId);
      if (!cfg) {
        throw new AppError(404, 'SSO_NOT_CONFIGURED', 'Configureer SSO eerst');
      }
      const saml = buildSamlClient(cfg);
      const authUrl = await saml.getAuthorizeUrlAsync('', '', {});
      res.json({
        ok: true,
        provider: cfg.provider,
        auth_url: authUrl,
        message: 'SAML config is geldig — klik de auth_url om end-to-end te testen.',
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── SCIM-token management ───────────────────────────────────────────────────
// Frontend-contract: ScimToken / ScimTokenGenerated
// (apps/web/lib/types/security.ts + apps/web/hooks/useSecurity.ts).

function buildScimEndpointUrl(): string {
  const base = process.env.PUBLIC_API_URL ?? 'http://localhost:4000';
  return `${base}/scim/v2`;
}

/**
 * GET /api/admin/sso/scim
 * Status van de SCIM-koppeling. De token-prefix wordt niet gepersisteerd
 * (DB bewaart alleen een bcrypt-hash) — die is enkel zichtbaar in de
 * response van POST /scim/token.
 */
ssoAdminRouter.get(
  '/scim',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user!.tenantId;
      const info = await samlService.getScimTokenInfo(tenantId);
      res.json({
        // tenant_sso_config heeft tenant_id als PK — geen eigen surrogate-id.
        id: tenantId,
        tenant_id: tenantId,
        enabled: info.scim_enabled && info.has_token,
        endpoint_url: buildScimEndpointUrl(),
        token_prefix: null,
        last_used_at: info.last_used_at
          ? new Date(info.last_used_at).toISOString()
          : null,
        created_at: info.created_at
          ? new Date(info.created_at).toISOString()
          : null,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/admin/sso/scim/token
 * Genereer (of roteer) het SCIM-bearer-token. `full_token` wordt EENMALIG
 * getoond; daarna is alleen nog de hash in de DB aanwezig.
 */
ssoAdminRouter.post(
  '/scim/token',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user!.tenantId;
      const userId = req.user!.userId;
      const { token } = await samlService.rotateScimToken(
        tenantId,
        userId,
        auditCtxFromReq(req)
      );
      const info = await samlService.getScimTokenInfo(tenantId);
      res.json({
        id: tenantId,
        tenant_id: tenantId,
        enabled: true,
        endpoint_url: buildScimEndpointUrl(),
        // "tflw_scim_" + eerste 6 hex-chars — genoeg om 'm te herkennen.
        token_prefix: token.slice(0, 16),
        last_used_at: null,
        created_at: info.created_at
          ? new Date(info.created_at).toISOString()
          : new Date().toISOString(),
        full_token: token,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/admin/sso/scim/rotate-token
 * Roteer SCIM-bearer-token. Plain-text wordt EENMALIG getoond.
 */
ssoAdminRouter.post(
  '/scim/rotate-token',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user!.tenantId;
      const userId = req.user!.userId;
      const result = await samlService.rotateScimToken(tenantId, userId, auditCtxFromReq(req));
      res.json({
        token: result.token,
        warning: 'Bewaar dit token nu — het wordt niet opnieuw getoond.',
      });
    } catch (err) {
      next(err);
    }
  }
);
