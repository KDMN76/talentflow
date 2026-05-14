/**
 * IP-allowlist middleware — Sprint Q4.2 (Agent OOO).
 *
 * Doel: weiger requests met een IP buiten de tenant-geconfigureerde
 * allowlist. Werkt met CIDR-ranges (IPv4 én IPv6). Wordt na auth-middleware
 * gemount zodat we de tenant-ID uit de JWT kennen — pre-auth routes
 * (/api/auth/*) worden geskipped, anders kun je niet inloggen om je IP toe te
 * voegen.
 *
 * Edge cases:
 *   - X-Forwarded-For: respecteren we als de Express-app `trust proxy` aan
 *     heeft staan; Express vult dan `req.ip` correct. Als niet, fallback
 *     naar handmatig parsen van de header (left-most IP — origin client).
 *   - IPv6: IPv4-mapped IPv6 (`::ffff:1.2.3.4`) wordt naar IPv4 ge-unmapd
 *     voordat we vergelijken — anders matched een v4-CIDR de v6-vertaling
 *     niet.
 *   - Loopback: in development worden 127.0.0.1 / ::1 genegeerd door de
 *     middleware (alleen wanneer NODE_ENV != 'production'). In productie
 *     gewoon meedoen — anders is loopback een bypass.
 *   - DB-fout: soft-fail (next() ipv 500). Een kapot security_settings-pad
 *     mag niet de hele app down brengen — we loggen de fout en laten door.
 *     Dit is een bewuste trade-off: availability > strict enforcement bij
 *     infra-issues.
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { withTenant } from '../db/pool';
import { logAudit, auditCtxFromReq } from '../lib/audit';
import { logger } from './errorHandler';
import type { JwtPayload } from './auth';

// ─────────────────────────────────────────────────────────────────────────────
// IP utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bepaal de origin-client IP. Geef voorrang aan Express' `req.ip` (dat
 * trust-proxy-aware is). Fallback: parse X-Forwarded-For zelf, dan socket.
 */
export function getClientIp(req: Request): string | null {
  // Express vult req.ip op basis van app.set('trust proxy', …). Als niet
  // gezet, valt het terug op socket.remoteAddress.
  const reqIp = (req.ip ?? '').trim();
  if (reqIp) return normaliseIp(reqIp);

  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]?.trim();
    if (first) return normaliseIp(first);
  }

  const remote = req.socket?.remoteAddress;
  return remote ? normaliseIp(remote) : null;
}

/**
 * Strip IPv4-mapped IPv6 prefix (::ffff:1.2.3.4 → 1.2.3.4). Lower-case
 * IPv6-letters voor consistente vergelijking.
 */
export function normaliseIp(ip: string): string {
  const v4Mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  if (v4Mapped) return v4Mapped[1];
  return ip.toLowerCase();
}

function isIpv4(ip: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return null;
  }
  // >>> 0 om unsigned 32-bit te garanderen
  return (
    (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0)
  );
}

function ipv6ToBigInt(ip: string): bigint | null {
  // Volledige IPv6 expand. We accepteren ook compressie met ::.
  const parts = ip.split('::');
  if (parts.length > 2) return null;
  let head: string[] = [];
  let tail: string[] = [];
  if (parts.length === 2) {
    head = parts[0] ? parts[0].split(':') : [];
    tail = parts[1] ? parts[1].split(':') : [];
  } else {
    head = parts[0].split(':');
  }
  const missing = 8 - (head.length + tail.length);
  if (missing < 0) return null;
  const groups = [...head, ...new Array<string>(missing).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  let out = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    out = (out << 16n) | BigInt(parseInt(g, 16));
  }
  return out;
}

/**
 * Match een IP tegen een CIDR-range. Ondersteunt IPv4 (`10.0.0.0/8`),
 * IPv6 (`2001:db8::/32`) én exacte IPs zonder mask (`1.2.3.4`).
 *
 * Returnt FALSE bij parse-fouten — een ongeldige CIDR mag nooit per
 * ongeluk matchen.
 */
export function ipInCidr(ip: string, cidr: string): boolean {
  if (!ip || !cidr) return false;
  const normalisedIp = normaliseIp(ip);
  const trimmedCidr = cidr.trim();

  // Geen mask = exact-match
  if (!trimmedCidr.includes('/')) {
    return normalisedIp === normaliseIp(trimmedCidr);
  }

  const [base, maskStr] = trimmedCidr.split('/');
  const mask = parseInt(maskStr, 10);
  if (Number.isNaN(mask) || mask < 0) return false;

  // IPv4
  if (isIpv4(base) && isIpv4(normalisedIp)) {
    if (mask > 32) return false;
    const ipInt = ipv4ToInt(normalisedIp);
    const baseInt = ipv4ToInt(base);
    if (ipInt == null || baseInt == null) return false;
    if (mask === 0) return true;
    const maskBits = (0xffffffff << (32 - mask)) >>> 0;
    return (ipInt & maskBits) === (baseInt & maskBits);
  }

  // IPv6
  if (!isIpv4(base) && !isIpv4(normalisedIp)) {
    if (mask > 128) return false;
    const ipBig = ipv6ToBigInt(normalisedIp);
    const baseBig = ipv6ToBigInt(base);
    if (ipBig == null || baseBig == null) return false;
    if (mask === 0) return true;
    const shift = BigInt(128 - mask);
    const maskBig = ((1n << 128n) - 1n) ^ ((1n << shift) - 1n);
    return (ipBig & maskBig) === (baseBig & maskBig);
  }

  // IPv4-vs-IPv6 mismatch
  return false;
}

/**
 * Match een IP tegen een lijst CIDR-ranges. ANY-match geldt.
 */
export function ipInAllowlist(ip: string, cidrs: string[]): boolean {
  for (const cidr of cidrs) {
    if (ipInCidr(ip, cidr)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pad-prefixes die we ALTIJD doorlaten — anders kunnen tenants zichzelf
 * uitsluiten als ze hun IP-config kapot maken. Login + health zijn nodig
 * voor recovery.
 */
const ALLOWLIST_BYPASS_PREFIXES = [
  '/api/auth/',
  '/api/self-service/',
  '/health',
  '/api-docs',
];

function pathBypassed(path: string): boolean {
  for (const p of ALLOWLIST_BYPASS_PREFIXES) {
    if (path === p.replace(/\/$/, '') || path.startsWith(p)) return true;
  }
  return false;
}

/**
 * Probeer tenant_id uit het JWT te halen zonder de auth-middleware-flow te
 * kapen. We verifieren NIET strict — dat doet `requireAuth` later. Hier
 * willen we alleen de tenant-context om de juiste allowlist op te halen.
 *
 * Returnt null als geen / ongeldig token. Een ongeldig token wordt door de
 * normale auth-middleware afgehandeld (401), niet hier.
 */
function tenantIdFromAuth(req: Request): string | null {
  if (req.user?.tenantId) return req.user.tenantId;
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const payload = jwt.verify(token, secret) as JwtPayload;
    return payload.tenantId ?? null;
  } catch {
    return null;
  }
}

export async function enforceIpAllowlist(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Skip pre-auth & recovery paths
    if (pathBypassed(req.path)) return next();

    const tenantId = tenantIdFromAuth(req);
    if (!tenantId) return next(); // pre-auth — kan zonder allowlist

    // Lazy-load settings; geen rij = geen enforcement (default-disabled).
    const settings = await withTenant(tenantId, async (client) => {
      const { rows } = await client.query<{
        ip_allowlist: string[];
        ip_allowlist_enforced: boolean;
      }>(
        `SELECT ip_allowlist, ip_allowlist_enforced
           FROM tenant_security_settings
          WHERE tenant_id = $1 LIMIT 1`,
        [tenantId]
      );
      return rows[0] ?? null;
    });

    if (!settings || !settings.ip_allowlist_enforced) return next();
    if (!settings.ip_allowlist || settings.ip_allowlist.length === 0) {
      // Enforced=true maar lege lijst betekent: niemand mag binnen — dat is
      // bijna zeker een config-fout. We geven dan een duidelijke error ipv
      // stilletjes door te laten.
      return ipDeniedResponse(req, res, tenantId, 'EMPTY_ALLOWLIST');
    }

    const clientIp = getClientIp(req);
    if (!clientIp) {
      // Onbekende IP — kunnen we niet matchen, dus weiger.
      return ipDeniedResponse(req, res, tenantId, 'UNKNOWN_IP');
    }

    if (ipInAllowlist(clientIp, settings.ip_allowlist)) return next();

    return ipDeniedResponse(req, res, tenantId, 'IP_NOT_ALLOWED', clientIp);
  } catch (err) {
    // Soft-fail: log + door. Anders blokkeert een DB-issue de hele app.
    logger.error('[ipAllowlist] enforcement failed (soft-fail)', {
      error: (err as Error).message,
      path: req.path,
    });
    return next();
  }
}

async function ipDeniedResponse(
  req: Request,
  res: Response,
  tenantId: string,
  reason: 'IP_NOT_ALLOWED' | 'UNKNOWN_IP' | 'EMPTY_ALLOWLIST',
  clientIp: string | null = null
): Promise<void> {
  // Schrijf audit-event — security-team wil weten wie geweerd wordt.
  try {
    await withTenant(tenantId, async (client) => {
      await logAudit(
        client,
        tenantId,
        {
          action: 'security.ip_blocked',
          entityType: 'security',
          entityId: null,
          after: {
            reason,
            client_ip: clientIp ?? getClientIp(req),
            path: req.path,
            method: req.method,
            user_id: req.user?.userId ?? null,
          },
          userId: req.user?.userId ?? null,
        },
        auditCtxFromReq(req)
      );
    });
  } catch {
    /* swallow — de request weigeren is belangrijker dan de audit */
  }

  res.status(403).json({
    error: {
      code: 'IP_NOT_ALLOWED',
      message: 'Toegang geweigerd vanaf dit IP-adres',
      details: { reason },
    },
  });
}
