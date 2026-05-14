/**
 * Audit-event logging — append-only schrijf-trail voor compliance.
 *
 * Ontworpen om vanuit een bestaande `withTenant`-transactie aangeroepen te
 * worden: caller geeft de actieve `PoolClient` mee zodat de audit-INSERT
 * atomic samen met de hoofd-mutatie commit. Als de hoofd-transactie rolled
 * back, dan rollt de audit-row óók terug — we willen nooit een audit-row
 * voor een mutatie die uiteindelijk niet gepersisteerd is.
 *
 * Faal-modus: een fout in de audit-INSERT mag de hoofd-transactie NIET
 * laten falen. We catchen de error, sturen 'm naar Sentry (zodat ops
 * weet dat audit "lekt") en retourneren stil. Dit is een bewuste trade-off:
 * een bug in audit-logging mag geen recruiter blokkeren bij het opslaan
 * van een kandidaat. Operationele alarmen detecteren een kapot
 * audit-pad.
 */

import type { PoolClient } from 'pg';
import type { Request } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../middleware/errorHandler';
import { Sentry } from './sentry';

export interface AuditPayload {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  /** Override the default user-id from controller context (rare). */
  userId?: string | null;
}

export interface AuditContext {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

/**
 * Schrijf een audit-event binnen de huidige `withTenant`-transactie.
 *
 * @param client     PoolClient van de actieve tenant-transactie
 * @param tenantId   Tenant UUID (gevalideerd op caller-zijde via withTenant)
 * @param payload    Action + entiteit + before/after snapshots
 * @param ctx        IP/UA/request-id (uit `auditCtxFromReq` of leeg)
 */
export async function logAudit(
  client: PoolClient,
  tenantId: string,
  payload: AuditPayload,
  ctx: AuditContext = {}
): Promise<void> {
  try {
    await client.query(
      `INSERT INTO audit_events
         (tenant_id, user_id, action, entity_type, entity_id,
          before, after, ip_address, user_agent, request_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::inet, $9, $10)`,
      [
        tenantId,
        payload.userId ?? null,
        payload.action,
        payload.entityType,
        payload.entityId ?? null,
        payload.before === undefined ? null : JSON.stringify(payload.before),
        payload.after === undefined ? null : JSON.stringify(payload.after),
        ctx.ipAddress ?? null,
        ctx.userAgent ?? null,
        ctx.requestId ?? null,
      ]
    );
  } catch (err) {
    // We swallow — audit must NOT block the main write. Surface to Sentry
    // and the structured logger zodat ops zichtbaarheid heeft.
    logger.error('[audit] failed to insert audit_events row', {
      action: payload.action,
      entityType: payload.entityType,
      entityId: payload.entityId,
      error: (err as Error).message,
    });
    try {
      Sentry.captureException(err, {
        tags: {
          subsystem: 'audit',
          action: payload.action,
          entity_type: payload.entityType,
        },
      });
    } catch {
      /* if Sentry itself errors, give up — already logged */
    }
  }
}

/**
 * Build an `AuditContext` from an Express `Request`.
 *
 * `req.ip` resolves trustproxy-aware via Express; we fall back to socket
 * peer address for completeness. `request_id` defaults to a fresh UUID so
 * every audit row has a correlation key — useful when the same request
 * mutates multiple rows.
 */
export function auditCtxFromReq(req: Request): AuditContext {
  return {
    ipAddress: req.ip ?? req.socket?.remoteAddress ?? undefined,
    userAgent: req.get('user-agent') ?? undefined,
    requestId: req.get('x-request-id') ?? randomUUID(),
  };
}
