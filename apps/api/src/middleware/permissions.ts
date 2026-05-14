/**
 * Permission middleware — Sprint Q4.2 (Agent OOO).
 *
 * Controleert of de geauthenticeerde user de gevraagde (resource, action)
 * heeft, op basis van:
 *
 *   1) Zijn primaire `users.role` (legacy single-role kolom).
 *   2) Alle (niet-verlopen) rij-en in `user_role_assignments`.
 *
 * Custom-rollen worden meegerekend inclusief `inherits_from`. De feitelijke
 * matrix-build gebeurt in `buildPermissionMatrixForUser` (lib/permissions.ts).
 *
 * Cache: per request memoizen we de matrix op `req` zodat meerdere
 * `requirePermission(...)`-middlewares op dezelfde route maar 1 DB-trip doen.
 *
 * Error-response: 403 met `error.code = INSUFFICIENT_PERMISSION` en de
 * vereiste resource/action — handig voor frontend om gerichte
 * "upgrade-je-rol"-prompt te tonen.
 */

import type { Request, Response, NextFunction } from 'express';
import {
  buildPermissionMatrixForUser,
  userHasPermission,
  type PermissionMatrix,
  type PermissionResource,
  type PermissionAction,
} from '../lib/permissions';

// Annoteer Request met cached matrix
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      _permissionMatrix?: PermissionMatrix;
    }
  }
}

async function getMatrix(req: Request): Promise<PermissionMatrix | null> {
  if (req._permissionMatrix) return req._permissionMatrix;
  if (!req.user) return null;
  const matrix = await buildPermissionMatrixForUser(
    req.user.tenantId,
    req.user.userId
  );
  req._permissionMatrix = matrix;
  return matrix;
}

/**
 * Middleware-factory. Returnt een middleware die de gevraagde permission
 * eist. Gooi GEEN AppError omdat die in de errorHandler een 500 zou worden
 * via `next(err)` — we sturen direct een 403.
 *
 * API-key requests (req.apiKey aanwezig) gaan ALLE permissions door — die
 * zijn al gefilterd via scopes in requireApiScope. Een API-key met scope
 * heeft impliciet alle UI-permissions binnen die scope; permission-check is
 * voor UI-users.
 */
export function requirePermission(
  resource: PermissionResource | string,
  action: PermissionAction | string
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authenticatie vereist', details: {} },
      });
      return;
    }

    // API-key bypass: als de request via X-API-Key kwam, vertrouwt het
    // systeem op scope-checks (requireApiScope). Geen UI-matrix nodig.
    if (req.apiKey) return next();

    try {
      const matrix = await getMatrix(req);
      if (!matrix) {
        res.status(401).json({
          error: { code: 'UNAUTHORIZED', message: 'Authenticatie vereist', details: {} },
        });
        return;
      }
      if (!userHasPermission([matrix], resource, action)) {
        res.status(403).json({
          error: {
            code: 'INSUFFICIENT_PERMISSION',
            message: `Onvoldoende rechten voor '${resource}:${action}'`,
            details: { required: { resource, action } },
          },
        });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Vereist één van meerdere (resource, action) combinaties. Handig wanneer
 * een endpoint óf admin-rechten óf eigen-record-rechten accepteert.
 */
export function requireAnyPermission(
  ...checks: Array<[string, string]>
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authenticatie vereist', details: {} },
      });
      return;
    }
    if (req.apiKey) return next();
    try {
      const matrix = await getMatrix(req);
      if (!matrix) {
        res.status(401).json({
          error: { code: 'UNAUTHORIZED', message: 'Authenticatie vereist', details: {} },
        });
        return;
      }
      const allowed = checks.some(([r, a]) =>
        userHasPermission([matrix], r, a)
      );
      if (!allowed) {
        res.status(403).json({
          error: {
            code: 'INSUFFICIENT_PERMISSION',
            message: 'Onvoldoende rechten voor deze actie',
            details: {
              required_any: checks.map(([resource, action]) => ({ resource, action })),
            },
          },
        });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Convenience: returnt de huidige user's permission-matrix. Gebruikt door
 * de /api/permissions endpoint om de frontend te bootstrappen.
 */
export async function getCurrentPermissionMatrix(
  req: Request
): Promise<PermissionMatrix | null> {
  return getMatrix(req);
}
