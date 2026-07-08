/**
 * Pay-transparency middleware — Sprint Q3.6 (Agent III), uitgebreid in de
 * Pay-Transparency-afronding (migration 044).
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
 * mogen dus zonder volledige salarisband aangemaakt worden — recruiters
 * kunnen later een band toevoegen voordat ze publishen.
 *
 * De volledige band bestaat uit DRIE velden (art. 5: kandidaten moeten de
 * bandbreedte én de periode kunnen interpreteren):
 *   1. salary_min
 *   2. salary_max
 *   3. salary_frequency (monthly/annual/hourly; DB-default 'monthly' geldt
 *      alleen bij POST zonder expliciet veld)
 *
 * Wanneer geblokkeerd:
 *   1. Audit-event `pay_transparency.blocked` (NIET fataal — alleen
 *      compliance-trail; logger.swallow bij DB-fouten conform audit.ts).
 *   2. Response 422 met code `PAY_TRANSPARENCY_REQUIRED`, een NL-melding
 *      die opsomt welke velden ontbreken (details.missing) en een link
 *      naar de tenant-pay-settings pagina (frontend route).
 *
 * Tenant kan via `tenant_pay_settings.pay_transparency_enforced = FALSE`
 * de check uitschakelen (bv. internal-only positions). Default = TRUE
 * conform directive (auto-comply).
 */

import type { Request, Response, NextFunction } from 'express';
import { withTenant } from '../db/pool';
import { logAudit, auditCtxFromReq } from '../lib/audit';
import { AuditActions } from '../lib/auditActions';
import {
  buildPayTransparencyError,
  computeMissingFields,
  type PayTransparencyMissingField,
} from '../modules/compliance/payTransparency.service';
import { logger } from './errorHandler';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface BandBody {
  salary_min?: number | null;
  salary_max?: number | null;
  salary_frequency?: string | null;
}

/**
 * Detecteer of dit een "publish"-mutatie is: ofwel POST met status='open',
 * ofwel PATCH die status overschrijft naar 'open'. Andere status-waardes
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
 * Voor PATCH /:id moeten we — voor elk band-veld dat NIET in de body staat —
 * de huidige rij uit DB lezen. Anders zou een gebruiker een job kunnen
 * publishen die in DB geen band heeft door een status-only PATCH.
 */
async function readBandFromDb(
  tenantId: string,
  jobId: string
): Promise<BandBody | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      salary_min: number | null;
      salary_max: number | null;
      salary_frequency: string | null;
    }>(
      `SELECT salary_min, salary_max, salary_frequency
         FROM jobs
        WHERE id = $1 AND tenant_id = $2`,
      [jobId, tenantId]
    );
    if (rows.length === 0) return null;
    return rows[0];
  });
}

/**
 * Bepaal de effectieve waarde per band-veld door body + fallback (DB-state
 * bij PATCH, DB-default bij POST) te combineren:
 *
 *   - Veld aanwezig in body (ook expliciet `null`) → body wint.
 *   - Veld afwezig in body:
 *       * PATCH → huidige DB-waarde.
 *       * POST  → salary_frequency krijgt de DB-default 'monthly'
 *         (007_job_detail_expansion.sql); salary_min/max hebben geen
 *         default en zijn dan dus ontbrekend.
 */
function resolveEffectiveBand(
  body: BandBody,
  fallback: BandBody | null,
  isPost: boolean
): { salary_min: number | null; salary_max: number | null; salary_frequency: string | null } {
  const pick = <K extends keyof BandBody>(key: K): BandBody[K] | null => {
    if (key in body) return body[key] ?? null;
    if (fallback && key in fallback) return fallback[key] ?? null;
    if (isPost && key === 'salary_frequency') {
      // DB-default vult 'monthly' in wanneer de kolom niet in de INSERT zit.
      return 'monthly' as BandBody[K];
    }
    return null;
  };

  return {
    salary_min: (pick('salary_min') as number | null) ?? null,
    salary_max: (pick('salary_max') as number | null) ?? null,
    salary_frequency: (pick('salary_frequency') as string | null) ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Express middleware. Mount op POST /jobs en PATCH /jobs/:id na requireAuth +
 * tenantMiddleware. Skip-cases:
 *   - Geen status='open' in body → niet blokkeren.
 *   - Tenant heeft pay_transparency_enforced = FALSE → niet blokkeren.
 *   - Effectieve band (body ∪ DB-state) is compleet → niet blokkeren.
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

    const body = (req.body ?? {}) as BandBody;

    // Alleen DB lezen als er velden ontbreken in de body én dit een PATCH
    // op een bestaande job is.
    let fallback: BandBody | null = null;
    const bodyCoversAll =
      'salary_min' in body && 'salary_max' in body && 'salary_frequency' in body;
    if (!bodyCoversAll && req.method === 'PATCH' && req.params.id) {
      fallback = await readBandFromDb(tenantId, req.params.id);
    }

    const effective = resolveEffectiveBand(
      body,
      fallback,
      req.method !== 'PATCH'
    );
    const missing = computeMissingFields(effective);
    if (missing.length === 0) {
      next();
      return;
    }

    await emitBlockAudit(req, tenantId, missing);
    respondBlocked(res, missing);
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

function respondBlocked(
  res: Response,
  missing: PayTransparencyMissingField[]
): void {
  const err = buildPayTransparencyError(missing);
  res.status(422).json({
    error: {
      code: err.code,
      message: err.message,
      details: err.details,
    },
  });
}

async function emitBlockAudit(
  req: Request,
  tenantId: string,
  missing: PayTransparencyMissingField[]
): Promise<void> {
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
            missing,
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
  readBandFromDb,
  resolveEffectiveBand,
};
