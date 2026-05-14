import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';

/**
 * Tenant middleware — must run AFTER requireAuth.
 * Reads tenantId from the JWT payload (already attached by requireAuth)
 * and makes it available on req for services to call withTenant().
 *
 * The actual SET app.tenant_id is done inside withTenant() per-query
 * so each DB client gets the correct RLS context.
 */
export function tenantMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authenticatie vereist');
  }

  if (!req.user.tenantId) {
    throw new AppError(400, 'MISSING_TENANT', 'Tenant context ontbreekt');
  }

  next();
}
