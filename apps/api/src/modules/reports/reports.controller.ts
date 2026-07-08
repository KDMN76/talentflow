/**
 * Reports controller — HTTP-laag voor /api/reports.
 *
 * Sprint Q3.5 (Agent EEE).
 *
 * Zod-schemas valideren request-bodies. Diepere config-validatie (dimensions,
 * metrics, filter-keys) gebeurt in `validateReportConfig` binnen de service.
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as service from './reports.service';
import { auditCtxFromReq } from '../../lib/audit';
import {
  AVAILABLE_DIMENSIONS,
  AVAILABLE_METRICS,
} from '../../lib/reports/configSchema';
import { SYSTEM_TEMPLATES } from '../../lib/reports/templates';
import { AppError } from '../../middleware/errorHandler';

// ────────────────────────────────────────────────────────────────────────────
// Schemas (alleen oppervlakkig — diepere validatie in service-laag)
// ────────────────────────────────────────────────────────────────────────────

const templateKeyEnum = z.enum([
  'recruiter',
  'manager',
  'chro',
  'source_of_hire',
  'dei_funnel',
  'custom',
]);

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  config: z.unknown(),
  template_key: templateKeyEnum.optional(),
  is_template: z.boolean().optional(),
  is_shared: z.boolean().optional(),
  schedule: z.unknown().optional(),
});

const patchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    config: z.unknown().optional(),
    template_key: templateKeyEnum.optional(),
    is_shared: z.boolean().optional(),
    schedule: z.unknown().nullable().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.description !== undefined ||
      v.config !== undefined ||
      v.template_key !== undefined ||
      v.is_shared !== undefined ||
      v.schedule !== undefined,
    { message: 'Geef ten minste één veld op om te updaten' }
  );

const duplicateSchema = z.object({ new_name: z.string().min(1).max(200) });

const runSchema = z
  .object({
    parameters: z
      .object({
        date_range_override: z.unknown().optional(),
        no_cache: z.boolean().optional(),
      })
      .optional(),
  })
  .optional();

// ────────────────────────────────────────────────────────────────────────────
// Handlers — list / get / create / patch / delete / duplicate
// ────────────────────────────────────────────────────────────────────────────

export async function listReports(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const filters: service.ListReportsFilters = {};
    if (typeof req.query.template_key === 'string') {
      filters.template_key = req.query.template_key as service.TemplateKey;
    }
    if (typeof req.query.is_template === 'string') {
      filters.is_template = req.query.is_template === 'true';
    }
    if (typeof req.query.user_id === 'string') {
      filters.user_id = req.query.user_id;
    }
    const reports = await service.listReports(tenantId, filters);
    res.json({ reports });
  } catch (err) {
    next(err);
  }
}

export async function getReport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const report = await service.getReport(req.user!.tenantId, req.params.id);
    res.json({ report });
  } catch (err) {
    next(err);
  }
}

export async function createReport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = createSchema.parse(req.body);
    const report = await service.createReport(
      req.user!.tenantId,
      req.user!.userId,
      body as service.CreateReportInput,
      auditCtxFromReq(req)
    );
    res.status(201).json({ report });
  } catch (err) {
    next(err);
  }
}

export async function patchReport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = patchSchema.parse(req.body);
    const report = await service.updateReport(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      body as service.UpdateReportInput,
      auditCtxFromReq(req)
    );
    res.json({ report });
  } catch (err) {
    next(err);
  }
}

export async function deleteReport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await service.deleteReport(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function duplicateReport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = duplicateSchema.parse(req.body);
    const report = await service.duplicateReport(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      body.new_name,
      auditCtxFromReq(req)
    );
    res.status(201).json({ report });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Run + runs-history
// ────────────────────────────────────────────────────────────────────────────

export async function runReport(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = runSchema.parse(req.body ?? {});
    const result = await service.runReport(
      req.user!.tenantId,
      req.params.id,
      parsed?.parameters as service.RunReportParameters | undefined,
      'manual',
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listRuns(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const limit = req.query.limit ? Math.min(parseInt(String(req.query.limit), 10) || 50, 200) : 50;
    const runs = await service.listReportRuns(
      req.user!.tenantId,
      req.params.id,
      limit
    );
    res.json({ runs });
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Embed-tokens
// ────────────────────────────────────────────────────────────────────────────

function deriveBaseUrl(req: Request): string {
  // X-Forwarded-Proto / Host respecteren (Nginx); fallback op req.headers.host.
  const proto =
    (req.headers['x-forwarded-proto'] as string | undefined) ??
    (req.secure ? 'https' : 'http');
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host;
  if (!host) {
    return process.env.PUBLIC_BASE_URL ?? 'http://localhost:4000';
  }
  return `${proto}://${host}`;
}

const embedSchema = z
  .object({
    /** Geldigheid in dagen (1..365). null/omitted = geen expiry. */
    expires_in_days: z.number().int().min(1).max(365).nullable().optional(),
  })
  .optional();

export async function enableEmbed(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = embedSchema.parse(req.body ?? {});
    const result = await service.generateEmbedToken(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      deriveBaseUrl(req),
      auditCtxFromReq(req),
      body?.expires_in_days ?? null
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function disableEmbed(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await service.revokeEmbedToken(
      req.user!.tenantId,
      req.params.id,
      req.user!.userId,
      auditCtxFromReq(req)
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

/**
 * Public endpoint — geen auth. Lookup via embed-token, daarna runReport
 * met de tenant_id van de gevonden rapport-row. Audit-event wordt door
 * runReport zelf geschreven (triggeredBy='embed').
 */
export async function runEmbed(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.params.token;
    const { report, tenant_id } = await service.getReportFromEmbedToken(token);

    const runResult = await service.runReport(
      tenant_id,
      report.id,
      undefined,
      'embed',
      null,
      auditCtxFromReq(req)
    );

    res.json({
      report_meta: {
        id: report.id,
        name: report.name,
        description: report.description,
      },
      blocks: runResult.blocks,
      ran_at: runResult.ran_at,
    });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    // Verberg interne fouten — een embed-consumer hoort geen stacktrace te zien.
    next(new AppError(500, 'EMBED_RUN_FAILED', 'Rapport kon niet worden uitgevoerd'));
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Templates / dimensions / metrics — read-only constants
// ────────────────────────────────────────────────────────────────────────────

export function listTemplates(_req: Request, res: Response): void {
  res.json({ templates: SYSTEM_TEMPLATES });
}

export function listDimensions(_req: Request, res: Response): void {
  res.json({ dimensions: AVAILABLE_DIMENSIONS });
}

export function listMetrics(_req: Request, res: Response): void {
  res.json({ metrics: AVAILABLE_METRICS });
}
