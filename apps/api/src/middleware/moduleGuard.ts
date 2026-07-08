/**
 * Module-guard middleware — per-tenant module-zichtbaarheid (migration 050).
 *
 * Gemount in index.ts VÓÓR de module-routers:
 *
 *   app.use('/api/contracts', requireModule('recruit_to_cash'), contractsRouter);
 *
 * Omdat requireAuth per-router draait (en dus nog niet gelopen heeft),
 * decodeert deze middleware de Bearer-JWT zelf — hetzelfde patroon als
 * enforce2faPolicy in middleware/auth.ts. Requests zonder (geldige) JWT
 * worden doorgelaten; de route-eigen auth wijst die verderop zelf af.
 * Publieke webhook-/token-routes worden bewust NIET geguard: inbound
 * webhooks (Twilio/Meta) hebben geen tenant-context vóór parsing en mogen
 * niet mid-flight 403'en.
 *
 * Gedrag:
 *   - module staat aan          → next()
 *   - module staat uit          → 403 MODULE_DISABLED met NL-melding
 *   - onbekende module-key      → next() (fail-open: nieuwe keys default aan)
 *   - flags-lookup faalt (DB)   → next() (soft-fail, zelfde afweging als
 *     ipAllowlist: een kapot flags-pad mag de app niet down brengen)
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from './auth';
import { logger } from './errorHandler';
import {
  getModuleFlags,
  isModuleKey,
  type ModuleKey,
} from '../modules/tenants/moduleFlags.service';

function resolveTenantId(req: Request): string | null {
  // Al geauthenticeerd (bv. via requireApiKey op een eerder gemounte route).
  if (req.user?.tenantId) return req.user.tenantId;

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const decoded = jwt.verify(authHeader.slice(7), secret) as JwtPayload & {
      aud?: string;
    };
    if (decoded.aud === 'tflw:partial-2fa') return null;
    return decoded.tenantId ?? null;
  } catch {
    return null;
  }
}

/**
 * Middleware-factory: blokkeert requests wanneer de opgegeven module voor de
 * tenant van de aanvrager uit staat. Stuurt direct een 403 (geen AppError —
 * zelfde overweging als requirePermission: throw in async pad wordt een 500).
 */
export function requireModule(moduleKey: ModuleKey | string) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      // Onbekende key → fail-open (nieuwe module-keys zijn default aan).
      if (!isModuleKey(moduleKey)) return next();

      const tenantId = resolveTenantId(req);
      // Geen tenant-context → doorlaten; de route-eigen auth handelt het af.
      if (!tenantId) return next();

      const flags = await getModuleFlags(tenantId);
      if (flags[moduleKey]) return next();

      res.status(403).json({
        error: {
          code: 'MODULE_DISABLED',
          message:
            'Deze module is uitgeschakeld voor jouw organisatie. Een beheerder kan de module aanzetten via Instellingen → Modules.',
          details: { module: moduleKey },
        },
      });
    } catch (err) {
      // Soft-fail: flags horen requests nooit hard te laten crashen.
      logger.error('[moduleGuard] flags-lookup mislukt — request doorgelaten', {
        module: moduleKey,
        error: (err as Error).message,
      });
      next();
    }
  };
}
