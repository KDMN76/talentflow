/**
 * CSV-export Express handlers — Sprint Q1.2.
 *
 * Iedere handler:
 *   1. Parseert query-parameters via een entity-specifiek zod-schema.
 *      We gebruiken `passthrough()` zodat extra filters die de UI nu of
 *      later meegeeft niet zomaar 400 worden — de service kiest zelf wat
 *      relevant is.
 *   2. Geeft de gehydrateerde filters door aan `exportData`.
 *   3. Schrijft de buffer als HTTP-response met de juiste headers.
 *
 * Alle endpoints zitten achter `requireAuth + tenantMiddleware` (zie router).
 * RLS doet de tenant-isolatie tijdens de query, dus er hoeft hier niets
 * extra's gevalideerd te worden — `req.user!.tenantId` komt uit de JWT.
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { auditCtxFromReq } from '../../lib/audit';
import { exportData, type ExportEntity } from './exports.service';

// ─────────────────────────────────────────────────────────────────────────────
// Query schemas — defensief; onbekende keys worden door passthrough doorgelaten
// zodat we backwards-compatible blijven met UI-filters die we hier nog niet
// expliciet kennen.
// ─────────────────────────────────────────────────────────────────────────────

const formatSchema = z.enum(['csv', 'xlsx']).default('csv');
const columnsSchema = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((c) => c.trim()).filter(Boolean) : undefined));

const candidateExportQuerySchema = z
  .object({
    search: z.string().optional(),
    skills: z.string().optional(),
    tags: z.string().optional(),
    source: z.string().optional(),
    format: formatSchema,
    columns: columnsSchema,
  })
  .passthrough();

const jobExportQuerySchema = z
  .object({
    status: z.string().optional(),
    recruiter_id: z.string().uuid().optional(),
    format: formatSchema,
    columns: columnsSchema,
  })
  .passthrough();

const applicationExportQuerySchema = z
  .object({
    job_id: z.string().uuid().optional(),
    status: z.string().optional(),
    format: formatSchema,
    columns: columnsSchema,
  })
  .passthrough();

const communicationsExportQuerySchema = z
  .object({
    candidate_id: z.string().uuid().optional(),
    channel: z.enum(['email', 'whatsapp', 'sms']).optional(),
    format: formatSchema,
    columns: columnsSchema,
  })
  .passthrough();

const workflowsExportQuerySchema = z
  .object({
    format: formatSchema,
    columns: columnsSchema,
  })
  .passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Generic dispatcher — DRY zodat iedere handler dezelfde response-shape doet.
// ─────────────────────────────────────────────────────────────────────────────

async function handleExport(
  req: Request,
  res: Response,
  entity: ExportEntity,
  filters: Record<string, unknown>,
  format: 'csv' | 'xlsx',
  columns: string[] | undefined
): Promise<void> {
  const result = await exportData(
    req.user!.tenantId,
    {
      entity,
      filters,
      format,
      columns,
      userId: req.user?.userId ?? null,
    },
    auditCtxFromReq(req)
  );

  res.setHeader('Content-Type', result.content_type);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${result.filename}"`
  );
  // Voorkom dat browser/proxy het bestand cached — exports zijn altijd
  // verse data + bevatten persoonsgegevens.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  // Custom header zodat de UI een toast kan tonen ("X rijen geëxporteerd").
  res.setHeader('X-Export-Row-Count', String(result.row_count));
  res.status(200).send(result.buffer);
}

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

export async function exportCandidatesHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = candidateExportQuerySchema.parse(req.query);
    const { format, columns, ...filters } = parsed;
    await handleExport(req, res, 'candidates', filters, format, columns);
  } catch (err) {
    next(err);
  }
}

export async function exportJobsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = jobExportQuerySchema.parse(req.query);
    const { format, columns, ...filters } = parsed;
    await handleExport(req, res, 'jobs', filters, format, columns);
  } catch (err) {
    next(err);
  }
}

export async function exportApplicationsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = applicationExportQuerySchema.parse(req.query);
    const { format, columns, ...filters } = parsed;
    await handleExport(req, res, 'applications', filters, format, columns);
  } catch (err) {
    next(err);
  }
}

export async function exportCommunicationsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = communicationsExportQuerySchema.parse(req.query);
    const { format, columns, ...filters } = parsed;
    await handleExport(req, res, 'communications', filters, format, columns);
  } catch (err) {
    next(err);
  }
}

export async function exportWorkflowsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = workflowsExportQuerySchema.parse(req.query);
    const { format, columns } = parsed;
    await handleExport(req, res, 'workflows', {}, format, columns);
  } catch (err) {
    next(err);
  }
}
