import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler';
import { withTenant, withAuthTx } from '../db/pool';

export interface JwtPayload {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedApiKey {
  id: string;
  tenantId: string;
  name: string;
  scopes: string[];
  rateLimitPerMinute: number;
  allowedIps: string[] | null;
  expiresAt: string | null;
}

// Extend Express Request to carry the authenticated user / api-key
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
      apiKey?: AuthenticatedApiKey;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authenticatie vereist');
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');

  try {
    const payload = jwt.verify(token, secret) as JwtPayload & { aud?: string };
    // Partial-tokens (uit 2FA-challenge) hebben aud="tflw:partial-2fa" en
    // mogen NOOIT geldig zijn voor een normale request — ze zijn alleen
    // voor /api/auth/2fa/verify bedoeld.
    if (payload.aud === 'tflw:partial-2fa') {
      throw new AppError(401, 'INVALID_TOKEN', 'Partial-token is geen volledig sessietoken');
    }
    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Token is verlopen');
    }
    throw new AppError(401, 'INVALID_TOKEN', 'Ongeldig token');
  }
}

/**
 * 2FA policy enforcement middleware — Sprint Q4.2 (Agent NNN).
 *
 * Globaal gemount in index.ts (vóór de routers). Omdat `requireAuth`
 * per-router draait en dus nog niet gelopen heeft, decodeert deze
 * middleware de Bearer-JWT zelf; requests zonder (geldige) JWT worden
 * doorgelaten — requireAuth wijst die verderop zelf af. Checkt of de
 * tenant een 2FA-policy heeft die verplicht is voor de huidige rol. Zo ja
 * en de user heeft 2FA niet aan staan én de grace-period is verlopen, dan
 * retourneren we 428 Precondition Required met een setup-link. Frontend
 * (lib/api.ts interceptor) redirect naar /settings/security/2fa.
 *
 * Whitelist: de 2fa-setup, status en login endpoints zelf moeten altijd
 * bereikbaar blijven, anders kan een geblokkeerde user nooit 2FA aanzetten.
 * De policy-lookup is gecached (30s TTL) in lib/twoFactorCache.ts.
 */
const TWO_FA_WHITELIST_PATHS = [
  '/api/auth/2fa/setup',
  '/api/auth/2fa/verify-setup',
  '/api/auth/2fa/verify',
  '/api/auth/2fa/status',
  '/api/auth/2fa/policy',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/users/me',
];

const TWO_FA_SETUP_URL = '/settings/security/2fa';

export async function enforce2faPolicy(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    let payload: JwtPayload | undefined = req.user;

    if (!payload) {
      // Globale mount: requireAuth heeft nog niet gelopen — decodeer de
      // Bearer-JWT zelf. Geen/ongeldige/partial token → doorlaten; de
      // route-eigen auth handelt dat af.
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) return next();
      const secret = process.env.JWT_SECRET;
      if (!secret) return next();
      try {
        const decoded = jwt.verify(authHeader.slice(7), secret) as JwtPayload & {
          aud?: string;
        };
        if (decoded.aud === 'tflw:partial-2fa') return next();
        payload = decoded;
      } catch {
        return next();
      }
    }

    const path = (req.originalUrl ?? req.url).split('?')[0]!;
    // Exact-match (of een echte sub-path onder `<whitelisted>/…`). Een kale
    // startsWith zou `/api/users/me<x>` doorlaten en zo de policy omzeilen.
    if (
      TWO_FA_WHITELIST_PATHS.some(
        (p) => path === p || path.startsWith(`${p}/`)
      )
    ) {
      return next();
    }

    const { require2faForUser } = await import(
      '../modules/auth/twoFactor.service'
    );
    const decision = await require2faForUser(
      payload.tenantId,
      payload.userId,
      payload.role
    );

    if (decision.required) {
      res.status(428).json({
        error: {
          code: '2FA_REQUIRED',
          message: 'Tenant policy vereist 2FA — setup voor je verder kunt',
          details: {
            setup_url: TWO_FA_SETUP_URL,
            grace_ended_at: decision.grace_ends_at,
          },
        },
      });
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles: string[]) {
  const middleware = (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authenticatie vereist');
    }
    if (!roles.includes(req.user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'Onvoldoende rechten');
    }
    next();
  };
  // Introspecteerbare naam voor de route-conventietest — die herkent guards
  // in de router-stack aan fn.name.
  Object.defineProperty(middleware, 'name', {
    value: `requireRole(${roles.join(',')})`,
  });
  return middleware;
}

// ────────────────────────────────────────────────────────────────────────────
// API-key authenticatie + scope-checks (Sprint Q4.1 — Agent MMM)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Lichte in-memory rate-limit per API-key. Voor productie zou dit een Redis
 * sliding-window worden — maar voor MVP voldoet dit en is het zonder
 * extra externe afhankelijkheden testbaar.
 */
const apiKeyRateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkApiKeyRateLimit(keyId: string, limit: number): boolean {
  const now = Date.now();
  const bucket = apiKeyRateBuckets.get(keyId);
  if (!bucket || bucket.resetAt < now) {
    apiKeyRateBuckets.set(keyId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

function clientIp(req: Request): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0]?.trim() ?? null;
  return req.socket.remoteAddress ?? null;
}

/**
 * Authenticeer requests via X-API-Key (of `Authorization: ApiKey <…>`).
 * Werkt zonder JWT — zet `req.apiKey` en `req.user` (synthetisch) voor
 * downstream tenant-middleware + RLS.
 */
export async function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const headerKey =
      (req.headers['x-api-key'] as string | undefined) ??
      (req.headers.authorization?.startsWith('ApiKey ')
        ? req.headers.authorization.slice(7)
        : undefined);

    if (!headerKey) {
      throw new AppError(401, 'API_KEY_REQUIRED', 'API-sleutel ontbreekt');
    }

    const keyHash = crypto.createHash('sha256').update(headerKey).digest('hex');

    // auth_context: lookup op key_hash zonder tenant-context (de hash is de
    // enige sleutel). De RLS-policy op api_keys staat deze READ toe als
    // auth_context 'on' is; schrijfacties (usage-log, last_used) lopen daarna
    // tenant-scoped via withTenant in logApiKeyUsage.
    const row = await withAuthTx(async (client) => {
      const { rows } = await client.query(
        `SELECT id, tenant_id, name, scopes, rate_limit_per_minute,
                allowed_ips, expires_at, revoked_at, deleted_at
           FROM api_keys
          WHERE key_hash = $1
          LIMIT 1`,
        [keyHash]
      );
      return rows[0] ?? null;
    }, { authContext: true });

    if (!row || row.deleted_at || row.revoked_at) {
      throw new AppError(401, 'INVALID_API_KEY', 'Ongeldige API-sleutel');
    }

    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      throw new AppError(401, 'API_KEY_EXPIRED', 'API-sleutel is verlopen');
    }

    if (row.allowed_ips && row.allowed_ips.length > 0) {
      const ip = clientIp(req);
      if (!ip || !row.allowed_ips.includes(ip)) {
        throw new AppError(403, 'IP_NOT_ALLOWED', 'IP niet toegestaan voor deze sleutel');
      }
    }

    if (!checkApiKeyRateLimit(row.id, row.rate_limit_per_minute ?? 100)) {
      res.setHeader('Retry-After', '60');
      throw new AppError(
        429,
        'API_KEY_RATE_LIMIT',
        `Te veel requests — limiet ${row.rate_limit_per_minute}/min`
      );
    }

    const apiKey: AuthenticatedApiKey = {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      scopes: row.scopes ?? [],
      rateLimitPerMinute: row.rate_limit_per_minute ?? 100,
      allowedIps: row.allowed_ips ?? null,
      expiresAt: row.expires_at ?? null,
    };

    req.apiKey = apiKey;
    // Synthetische user-context zodat tenantMiddleware & withTenant() werken.
    req.user = {
      userId: 'api-key',
      tenantId: apiKey.tenantId,
      email: 'api-key@talentflow',
      role: 'api',
    };

    // Async usage-log + last_used update (niet-blokkerend).
    void logApiKeyUsage(apiKey, req, 0, 0).catch(() => {});

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Vereist een specifieke scope op de geauthenticeerde API-key. Werkt alleen
 * na `requireApiKey`. JWT-gebaseerde routes (recruiter UI) hebben geen
 * scope-check nodig — die gebruiken `requireRole`.
 *
 * Speciale scope `*` betekent volledige toegang.
 */
export function requireApiScope(scope: string) {
  const middleware = (req: Request, _res: Response, next: NextFunction): void => {
    const apiKey = req.apiKey;
    if (!apiKey) {
      throw new AppError(401, 'API_KEY_REQUIRED', 'API-sleutel vereist');
    }
    if (!apiKey.scopes.includes(scope) && !apiKey.scopes.includes('*')) {
      throw new AppError(
        403,
        'INSUFFICIENT_SCOPE',
        `Sleutel mist scope '${scope}'`
      );
    }
    next();
  };
  Object.defineProperty(middleware, 'name', {
    value: `requireApiScope(${scope})`,
  });
  return middleware;
}

/**
 * Accepteer JWT óf API-key (met optionele scope). Handig voor endpoints die
 * zowel via UI (JWT) als via integratie (API-key) bereikbaar moeten zijn.
 */
export function requireAuthOrApiKey(scope?: string) {
  const middleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const hasApiKey =
      !!req.headers['x-api-key'] ||
      (typeof req.headers.authorization === 'string' &&
        req.headers.authorization.startsWith('ApiKey '));

    if (hasApiKey) {
      await new Promise<void>((resolve, reject) =>
        requireApiKey(req, res, (err?: unknown) => (err ? reject(err) : resolve()))
      );
      if (scope) requireApiScope(scope)(req, res, next);
      else next();
      return;
    }

    // Fallback naar JWT
    requireAuth(req, res, next);
  };
  Object.defineProperty(middleware, 'name', {
    value: `requireAuthOrApiKey(${scope ?? ''})`,
  });
  return middleware;
}

/**
 * Schrijft een usage-log entry. Tolerant: faalt nooit luid (DB-issues,
 * pre-migratie state, etc.). Update `last_used_at` + `usage_count`.
 */
export async function logApiKeyUsage(
  apiKey: AuthenticatedApiKey,
  req: Request,
  statusCode: number,
  durationMs: number,
  errorCode?: string | null
): Promise<void> {
  try {
    await withTenant(apiKey.tenantId, async (client) => {
      await client.query(
        `INSERT INTO api_key_usage_log
           (tenant_id, api_key_id, method, path, status_code,
            ip_address, user_agent, duration_ms, error_code)
         VALUES ($1, $2, $3, $4, $5, $6::inet, $7, $8, $9)`,
        [
          apiKey.tenantId,
          apiKey.id,
          req.method,
          (req.originalUrl ?? req.url).split('?')[0],
          statusCode,
          clientIp(req),
          req.headers['user-agent'] ?? null,
          durationMs,
          errorCode ?? null,
        ]
      );
      if (statusCode > 0) {
        await client.query(
          `UPDATE api_keys
              SET last_used_at = now(),
                  usage_count = usage_count + 1
            WHERE id = $1`,
          [apiKey.id]
        );
      }
    });
  } catch {
    // Swallow — usage-log is best-effort.
  }
}

/**
 * Express-middleware die na de response `logApiKeyUsage` aanroept met de
 * gerealiseerde status-code en duration. Mount na `requireApiKey`.
 */
export function logApiKeyUsageMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.apiKey) return next();
  const start = Date.now();
  res.on('finish', () => {
    const apiKey = req.apiKey;
    if (!apiKey) return;
    const errorCode =
      res.statusCode >= 400
        ? (res.getHeader('x-error-code') as string | undefined) ?? null
        : null;
    void logApiKeyUsage(apiKey, req, res.statusCode, Date.now() - start, errorCode);
  });
  next();
}
