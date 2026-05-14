/**
 * Pay-transparency middleware — Sprint Q3.6 (Agent III).
 *
 * EU Pay Transparency Directive 2023/970 (in werking 2026) verplicht
 * werkgevers de salarisbandbreedte voor elke openstaande vacature
 * publiek te maken. Dit middleware enforced dat aan de API-rand:
 *
 *   - POST   /api/jobs           (create)         → check op publish
 *   - PATCH  /api/jobs/:id       (status update)  → check op publish
 *
 * Een vacature wordt als "gepubliceerd" beschouwd zodra `status = 'open'`.
 * Drafts (`status = 'draft'`) zijn nog niet zichtbaar voor kandidaten en
 * mogen dus zonder volledig salaris-band aangemaakt worden — recruiters
 * kunnen later een band toevoegen voordat ze publishen.
 *
 * Wanneer geblokkeerd:
 *   1. Audit-event `pay_transparency.blocked` (NIET fataal — alleen
 *      compliance-trail; logger.swallow bij DB-fouten conform audit.ts).
 *   2. Response 422 met code `PAY_TRANSPARENCY_REQUIRED`, een explainer
 *      en een link naar de tenant-pay-settings pagina (frontend route).
 *
 * Tenant kan via `tenant_pay_settings.pay_transparency_enforced = FALSE`
 * de check uitschakelen (bv. internal-only positions). Default = TRUE
 * conform directive (auto-comply).
 */

import type { Request, Response, NextFunction } from 'express';
import { withTenant } from '../db/pool';
import { logAudit, auditCtxFromReq } from '../lib/audit';
import { AuditActions } from '../lib/auditActions';
import { logger } from './errorHandler';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detecteer of dit een "publish"-mutatie is: ofwel POST met status='open',
 * ofwel PATCH die status overgeschreven naar 'open'. Andere status-waardes
 * (draft/closed/filled/archived) skippen de check.
 */
function isPublishMutation(req: Request): boolean {
  const body = (req.body ?? {}) as { status?: unknown };
  if (typeof body.status !== 'string') {
    // POST zonder expliciete status default naar 'draft' in de service —
    // niet blokkeren. Voor PATCH zonder status veranderen we niets.
    return false;
  }
  return body.status === 'open';
}

/**
 * Lees tenant pay-settings flag. Gebruikt withTenant zodat RLS gerespecteerd
 * blijft. Bij ontbrekende rij (zou niet mogen — migration 021 backfill-t,
 * maar nieuwe tenants kunnen de race-conditie verliezen) defaulten we naar
 * TRUE conform directive.
 */
async function isPayTransparencyEnforced(tenantId: string): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ pay_transparency_enforced: boolean }>(
      `SELECT pay_transparency_enforced
         FROM tenant_pay_settings
        WHERE tenant_id = $1`,
      [tenantId]
    );
    if (rows.length === 0) return true; // Auto-comply default
    return rows[0].pay_transparency_enforced === true;
  });
}

/**
 * Voor PATCH /:id moeten we — als alleen `status` in de body staat zonder
 * salary_min/max — de huidige rij uit DB lezen om te zien of de band al
 * gevuld is. Anders zou een gebruiker een job kunnen publishen die in DB
 * geen band heeft door de check via een PATCH-only-status te omzeilen.
 */
async function jobAlreadyHasBand(
  tenantId: string,
  jobId: string
): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      salary_min: number | null;
      salary_max: number | null;
    }>(
      `SELECT salary_min, salary_max
         FROM jobs
        WHERE id = $1 AND tenant_id = $2`,
      [jobId, tenantId]
    );
    if (rows.length === 0) return false;
    const r = rows[0];
    return r.salary_min !== null && r.salary_max !== null;
  });
}

/**
 * Bepaal of de combinatie (incoming body + DB-state) een gevulde band oplevert.
 * Voor POST: alleen body. Voor PATCH: body OR (DB-band als body de velden niet
 * meenemen).
 */
function bodyHasBand(req: Request): boolean {
  const body = (req.body ?? {}) as {
    salary_min?: number | null;
    salary_max?: number | null;
  };
  return (
    body.salary_min !== undefined &&
    body.salary_min !== null &&
    body.salary_max !== undefined &&
    body.salary_max !== null
  );
}

/**
 * Detecteer of de body de salary-velden expliciet op `null` zet — dan moeten
 * we ze als "gewist" behandelen en niet de DB-state vertrouwen.
 */
function bodyClearsBand(req: Request): boolean {
  const body = (req.body ?? {}) as {
    salary_min?: number | null;
    salary_max?: number | null;
  };
  return body.salary_min === null || body.salary_max === null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Express middleware. Mount op POST /jobs en PATCH /jobs/:id na requireAuth +
 * tenantMiddleware. Skip-cases:
 *   - Geen status='open' in body → niet blokkeren.
 *   - Tenant heeft pay_transparency_enforced = FALSE → niet blokkeren.
 *   - Body bevat een complete salary-band → niet blokkeren.
 *   - PATCH zonder salary-veranderingen, maar DB-rij heeft al een band → niet blokkeren.
 */
export async function enforcePayTransparency(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      // Authenticatie zou eerder al moeten falen — defensief next.
      next();
      return;
    }
    if (!isPublishMutation(req)) {
      next();
      return;
    }

    const tenantId = req.user.tenantId;
    const enforced = await isPayTransparencyEnforced(tenantId);
    if (!enforced) {
      next();
      return;
    }

    // Als body de band wist (expliciet null), dan blokkeren we direct —
    // zelfs als DB-state een band had.
    if (bodyClearsBand(req)) {
      await emitBlockAudit(req, tenantId);
      respondBlocked(res);
      return;
    }

    if (bodyHasBand(req)) {
      next();
      return;
    }

    // PATCH zonder explicite band: check DB-state. POST zonder band: blokkeren.
    if (req.method === 'PATCH' && req.params.id) {
      const dbHasBand = await jobAlreadyHasBand(tenantId, req.params.id);
      if (dbHasBand) {
        next();
        return;
      }
    }

    await emitBlockAudit(req, tenantId);
    respondBlocked(res);
  } catch (err) {
    // Bij DB-fouten (bv. tenant_pay_settings tabel ontbreekt op een db die
    // migrations achter loopt) niet 500-en op middleware-pad. Log + open
    // door — caller-validatie vangt de meeste fouten alsnog. Ops-Sentry
    // krijgt de stacktrace via errorHandler in een latere call.
    logger.warn('[pay-transparency] middleware soft-fail', {
      error: (err as Error).message,
    });
    next();
  }
}

function respondBlocked(res: Response): void {
  res.status(422).json({
    error: {
      code: 'PAY_TRANSPARENCY_REQUIRED',
      message:
        'Salarisbandbreedte (salary_min en salary_max) is verplicht voordat de vacature gepubliceerd kan worden. (EU Pay Transparency Directive 2023/970)',
      details: {
        explainer_url: '/docs/pay-transparency',
        settings_url: '/dashboard/settings/compliance/pay-transparency',
        directive: 'EU 2023/970',
      },
    },
  });
}

async function emitBlockAudit(req: Request, tenantId: string): Promise<void> {
  try {
    await withTenant(tenantId, async (client) => {
      await logAudit(
        client,
        tenantId,
        {
          action: AuditActions.PAY_TRANSPARENCY_BLOCKED,
          entityType: 'job',
          entityId:
            typeof req.params?.id === 'string' ? req.params.id : null,
          after: {
            method: req.method,
            path: req.originalUrl,
            attempted_status: 'open',
            user_id: req.user?.userId ?? null,
          },
          userId: req.user?.userId ?? null,
        },
        auditCtxFromReq(req)
      );
    });
  } catch (err) {
    // Audit failure mag de blokkade niet voorkomen — de respons is toch al
    // 422. Alleen loggen.
    logger.warn('[pay-transparency] audit emit failed', {
      error: (err as Error).message,
    });
  }
}

// Export voor unit tests
export const _internal = {
  isPublishMutation,
  isPayTransparencyEnforced,
  jobAlreadyHasBand,
  bodyHasBand,
  bodyClearsBand,
};
