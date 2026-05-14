/**
 * Report exporter + scheduler controllers — Sprint Q3.5 (Agent GGG).
 *
 * Bevat alléén handlers die Agent GGG bouwt:
 *   - exportReportPdfHandler / exportReportExcelHandler / exportReportCsvHandler
 *   - setReportScheduleHandler / clearReportScheduleHandler
 *   - getReportEmbedHandler (public, token-validated)
 *
 * De CRUD-controllers (list/get/create/update/delete + run) worden door
 * Agent EEE gebouwd in `reports.controller.ts`. Door deze split kunnen we
 * parallel werken zonder merge-conflicten.
 *
 * Alle export-handlers volgen ditzelfde patroon:
 *   1. parse + validate query (date_from/date_to, optionele filters)
 *   2. roep `runReport(tenantId, reportId, dateRange)` aan (Agent EEE service)
 *   3. roep de juiste exporter aan met (name, config, blockResults)
 *   4. zet Content-Disposition + Content-Type + Cache-Control headers
 *   5. audit-log REPORT_EXPORTED
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { withTenant, withoutTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { auditCtxFromReq, logAudit } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import { reportToPdfBuffer } from '../../lib/reports/exporters/pdf';
import { reportToExcelBuffer } from '../../lib/reports/exporters/excel';
import { reportToCsvBuffer } from '../../lib/reports/exporters/csv';
import { getBrandingForTenant } from '../tenants/branding.service';
import {
  setReportSchedule,
  clearReportSchedule,
  validateSchedule,
  type ReportSchedule,
} from './schedules.service';
import * as reportsService from './reports.service';
import type {
  ReportConfig,
  AggregateResult,
  ReportDateRange,
} from '../../lib/reports/configSchema';

// ────────────────────────────────────────────────────────────────────────────
// Helpers — lookup + run via Agent EEE's reports.service
// ────────────────────────────────────────────────────────────────────────────

interface ReportMeta {
  id: string;
  name: string;
  description: string | null;
  config: ReportConfig;
}

/**
 * Pak naam + config (voor exporter-headers) via getReport. Service doet de
 * RLS-veilige lookup; gooit AppError(404) als niet bestaat / soft-deleted.
 */
async function loadReportMeta(tenantId: string, reportId: string): Promise<ReportMeta> {
  const r = await reportsService.getReport(tenantId, reportId);
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    config: r.config,
  };
}

/**
 * Voer het rapport uit via service.runReport (manuel triggered). De service
 * doet caching + audit + report_runs-bookkeeping zelf.
 */
async function runReportForExport(
  tenantId: string,
  reportId: string,
  userId: string | null,
  override?: ReportDateRange,
  ctx: ReturnType<typeof auditCtxFromReq> | {} = {}
): Promise<AggregateResult[]> {
  const result = await reportsService.runReport(
    tenantId,
    reportId,
    override ? { date_range_override: override } : undefined,
    'manual',
    userId,
    ctx as ReturnType<typeof auditCtxFromReq>
  );
  return result.blocks;
}

// ────────────────────────────────────────────────────────────────────────────
// Query parsing
// ────────────────────────────────────────────────────────────────────────────

const exportQuerySchema = z
  .object({
    date_from: z.string().optional(),
    date_to: z.string().optional(),
  })
  .passthrough();

function dateOverride(req: Request): ReportDateRange | undefined {
  const parsed = exportQuerySchema.parse(req.query);
  if (parsed.date_from && parsed.date_to) {
    // ISO date or full datetime — runReport's resolveDateRange accepts both.
    return { type: 'custom', from: parsed.date_from, to: parsed.date_to };
  }
  return undefined;
}

async function brandingFor(tenantId: string) {
  try {
    const b = await getBrandingForTenant(tenantId);
    if (!b) return null;
    return {
      primary_color: b.primary_color,
      accent_color: b.accent_color,
      brand_name: b.brand_name,
      logo_url: b.logo_url,
    };
  } catch {
    return null;
  }
}

async function auditExport(
  tenantId: string,
  reportId: string,
  userId: string | null,
  format: 'pdf' | 'excel' | 'csv',
  rowCount: number,
  ctx: ReturnType<typeof auditCtxFromReq>
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.REPORT_EXPORTED,
        entityType: 'report',
        entityId: reportId,
        after: { format, block_count: rowCount },
        userId,
      },
      ctx
    );
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Export handlers
// ────────────────────────────────────────────────────────────────────────────

function filenameFor(name: string, ext: 'pdf' | 'xlsx' | 'csv'): string {
  const safe = name.replace(/[^\w\-]+/g, '_').slice(0, 64) || 'report';
  const today = new Date().toISOString().slice(0, 10);
  return `${safe}-${today}.${ext}`;
}

export async function exportReportPdfHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const reportId = req.params.id;
    const report = await loadReportMeta(tenantId, reportId);
    const blocks = await runReportForExport(
      tenantId,
      reportId,
      req.user?.userId ?? null,
      dateOverride(req),
      auditCtxFromReq(req)
    );
    const branding = await brandingFor(tenantId);
    const buffer = await reportToPdfBuffer(report.name, report.config, blocks, {
      branding,
    });
    await auditExport(
      tenantId,
      reportId,
      req.user?.userId ?? null,
      'pdf',
      blocks.length,
      auditCtxFromReq(req)
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filenameFor(report.name, 'pdf')}"`
    );
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).send(buffer);
  } catch (err) {
    next(err);
  }
}

export async function exportReportExcelHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const reportId = req.params.id;
    const report = await loadReportMeta(tenantId, reportId);
    const blocks = await runReportForExport(
      tenantId,
      reportId,
      req.user?.userId ?? null,
      dateOverride(req),
      auditCtxFromReq(req)
    );
    const branding = await brandingFor(tenantId);
    const buffer = await reportToExcelBuffer(report.name, report.config, blocks, {
      branding,
    });
    await auditExport(
      tenantId,
      reportId,
      req.user?.userId ?? null,
      'excel',
      blocks.length,
      auditCtxFromReq(req)
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filenameFor(report.name, 'xlsx')}"`
    );
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).send(buffer);
  } catch (err) {
    next(err);
  }
}

export async function exportReportCsvHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const reportId = req.params.id;
    const report = await loadReportMeta(tenantId, reportId);
    const blocks = await runReportForExport(
      tenantId,
      reportId,
      req.user?.userId ?? null,
      dateOverride(req),
      auditCtxFromReq(req)
    );
    const buffer = reportToCsvBuffer(report.name, report.config, blocks);
    await auditExport(
      tenantId,
      reportId,
      req.user?.userId ?? null,
      'csv',
      blocks.length,
      auditCtxFromReq(req)
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filenameFor(report.name, 'csv')}"`
    );
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).send(buffer);
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Schedule handlers
// ────────────────────────────────────────────────────────────────────────────

export async function setReportScheduleHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const schedule: ReportSchedule = validateSchedule(req.body);
    await setReportSchedule(
      req.user!.tenantId,
      req.params.id,
      req.user?.userId ?? null,
      schedule,
      auditCtxFromReq(req)
    );
    res.status(200).json({ ok: true, schedule });
  } catch (err) {
    next(err);
  }
}

export async function clearReportScheduleHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await clearReportSchedule(
      req.user!.tenantId,
      req.params.id,
      req.user?.userId ?? null,
      auditCtxFromReq(req)
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Embed view (public, no auth — token-validated cross-tenant lookup).
// Het token wordt door Agent EEE gegenereerd bij `POST /api/reports/:id/embed`;
// hier doen we alleen de read-only fetch.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Public embed-view voor een rapport. Geen auth — token-validated.
 *
 * Verschil met Agent EEE's `runEmbed`:
 *   - returnt het rapport-data + config + results in één payload (read-only),
 *     bedoeld voor frontend embed-iframe of headless-consumer.
 *   - cache-Control public, 5 min — embed-views mogen door CDN gecachet
 *     worden zodat iedere refresh geen tenant-DB hit triggert.
 */
export async function getReportEmbedHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.params.token;
    if (typeof token !== 'string' || token.length < 16) {
      throw new AppError(400, 'INVALID_TOKEN', 'Token ontbreekt');
    }
    const { report, tenant_id } = await reportsService.getReportFromEmbedToken(token);
    const result = await reportsService.runReport(
      tenant_id,
      report.id,
      undefined,
      'embed',
      null,
      auditCtxFromReq(req)
    );

    // Audit (best-effort) dat de embed bekeken werd. runReport logt al een
    // REPORT_RUN-event; deze extra entry maakt embed-views in het audit-log
    // direct herkenbaar voor compliance.
    void withTenant(tenant_id, async (client) => {
      await logAudit(
        client,
        tenant_id,
        {
          action: AuditActions.REPORT_EMBED_VIEWED,
          entityType: 'report',
          entityId: report.id,
          after: { token_prefix: token.slice(0, 6) },
          userId: null,
        },
        auditCtxFromReq(req)
      );
    }).catch(() => {
      /* audit-fail mag de embed-view niet blokkeren */
    });

    res.setHeader('Cache-Control', 'public, max-age=300'); // 5min cache
    res.status(200).json({
      data: {
        report: {
          id: report.id,
          name: report.name,
          description: report.description,
        },
        config: report.config,
        results: result.blocks,
        ran_at: result.ran_at,
      },
    });
  } catch (err) {
    next(err);
  }
}
