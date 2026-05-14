/**
 * Reports service — CRUD + run + embed-tokens.
 *
 * Sprint Q3.5 (Agent EEE).
 *
 * Belangrijke onderdelen:
 *   - listReports / getReport / createReport / updateReport / deleteReport / duplicateReport
 *   - runReport: voert alle blocks parallel uit (Promise.all aggregateBlock)
 *     en cachet het resultaat 1h via report_runs (dezelfde input ⇒ recente
 *     succesvolle row hergebruiken).
 *   - generateEmbedToken / revokeEmbedToken: 32-byte hex token, UNIQUE in DB.
 *   - getReportFromEmbedToken: public lookup zonder tenant-context (gebruikt
 *     `withoutTenant`) — daarna wordt voor de runReport-call de tenant_id van
 *     de gevonden report-row gebruikt.
 *
 * Audit: alle write-paden (create/update/delete/duplicate/run/embed-toggle)
 * loggen via lib/audit.
 */

import { randomBytes, randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { withTenant, withoutTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import {
  validateReportConfig,
  resolveDateRange,
  type ReportConfig,
} from '../../lib/reports/configSchema';
import { aggregateBlock } from '../../lib/reports/aggregator';
import type { AggregateResult } from '../../lib/reports/configSchema';
import { SYSTEM_TEMPLATES, getTemplateByKey } from '../../lib/reports/templates';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type TemplateKey =
  | 'recruiter'
  | 'manager'
  | 'chro'
  | 'source_of_hire'
  | 'dei_funnel'
  | 'custom';

export interface Report {
  id: string;
  tenant_id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  config: ReportConfig;
  template_key: TemplateKey | null;
  is_template: boolean;
  is_shared: boolean;
  embed_token: string | null;
  embed_enabled: boolean;
  schedule: unknown | null;
  last_run_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListReportsFilters {
  template_key?: TemplateKey;
  is_template?: boolean;
  user_id?: string;
}

export interface CreateReportInput {
  name: string;
  description?: string;
  config: ReportConfig;
  template_key?: TemplateKey;
  is_template?: boolean;
  is_shared?: boolean;
  schedule?: unknown;
}

export interface UpdateReportInput {
  name?: string;
  description?: string;
  config?: ReportConfig;
  template_key?: TemplateKey;
  is_shared?: boolean;
  schedule?: unknown | null;
}

export interface RunReportResponse {
  blocks: AggregateResult[];
  ran_at: string;
  report_run_id: string;
  cache_hit: boolean;
}

// Cache TTL — 1h, zoals gespecificeerd in de sprint.
const CACHE_TTL_MS = 60 * 60 * 1000;

// ────────────────────────────────────────────────────────────────────────────
// Row helper
// ────────────────────────────────────────────────────────────────────────────

function rowToReport(row: Record<string, unknown>): Report {
  return {
    id: row.id as string,
    tenant_id: row.tenant_id as string,
    user_id: (row.user_id as string | null) ?? null,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    config: parseJson(row.config) as ReportConfig,
    template_key: (row.template_key as TemplateKey | null) ?? null,
    is_template: Boolean(row.is_template),
    is_shared: Boolean(row.is_shared),
    embed_token: (row.embed_token as string | null) ?? null,
    embed_enabled: Boolean(row.embed_enabled),
    schedule: parseJson(row.schedule),
    last_run_at: (row.last_run_at as string | null) ?? null,
    deleted_at: (row.deleted_at as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function parseJson(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

// ────────────────────────────────────────────────────────────────────────────
// CRUD
// ────────────────────────────────────────────────────────────────────────────

export async function listReports(
  tenantId: string,
  filters: ListReportsFilters = {}
): Promise<Report[]> {
  return withTenant(tenantId, async (client) => {
    const where: string[] = ['tenant_id = $1', 'deleted_at IS NULL'];
    const params: unknown[] = [tenantId];

    if (filters.template_key) {
      params.push(filters.template_key);
      where.push(`template_key = $${params.length}`);
    }
    if (filters.is_template !== undefined) {
      params.push(filters.is_template);
      where.push(`is_template = $${params.length}`);
    }
    if (filters.user_id) {
      params.push(filters.user_id);
      where.push(`(user_id = $${params.length} OR is_shared = true)`);
    }

    const { rows } = await client.query(
      `SELECT * FROM reports
       WHERE ${where.join(' AND ')}
       ORDER BY updated_at DESC
       LIMIT 500`,
      params
    );
    return rows.map(rowToReport);
  });
}

export async function getReport(
  tenantId: string,
  id: string
): Promise<Report> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM reports WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'REPORT_NOT_FOUND', 'Rapport niet gevonden');
    }
    return rowToReport(rows[0]);
  });
}

export async function createReport(
  tenantId: string,
  userId: string | null,
  data: CreateReportInput,
  ctx: AuditContext = {}
): Promise<Report> {
  const validation = validateReportConfig(data.config);
  if (!validation.valid) {
    throw new AppError(400, 'INVALID_REPORT_CONFIG', 'Ongeldige rapport-config', {
      errors: validation.errors ?? [],
    });
  }
  if (!data.name || data.name.trim().length === 0) {
    throw new AppError(400, 'REPORT_NAME_REQUIRED', 'Naam is verplicht');
  }

  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO reports
         (tenant_id, user_id, name, description, config, template_key,
          is_template, is_shared, schedule)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb)
       RETURNING *`,
      [
        tenantId,
        userId,
        data.name.trim(),
        data.description ?? null,
        JSON.stringify(data.config),
        data.template_key ?? 'custom',
        data.is_template ?? false,
        data.is_shared ?? false,
        data.schedule ? JSON.stringify(data.schedule) : null,
      ]
    );
    const report = rowToReport(rows[0]);
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.REPORT_CREATED,
        entityType: 'report',
        entityId: report.id,
        after: { name: report.name, template_key: report.template_key },
        userId,
      },
      ctx
    );
    return report;
  });
}

export async function updateReport(
  tenantId: string,
  id: string,
  userId: string | null,
  patch: UpdateReportInput,
  ctx: AuditContext = {}
): Promise<Report> {
  if (patch.config !== undefined) {
    const validation = validateReportConfig(patch.config);
    if (!validation.valid) {
      throw new AppError(400, 'INVALID_REPORT_CONFIG', 'Ongeldige rapport-config', {
        errors: validation.errors ?? [],
      });
    }
  }

  return withTenant(tenantId, async (client) => {
    const before = await fetchReportRow(client, tenantId, id);

    const sets: string[] = [];
    const params: unknown[] = [];
    let pi = 1;
    if (patch.name !== undefined) {
      sets.push(`name = $${pi++}`);
      params.push(patch.name.trim());
    }
    if (patch.description !== undefined) {
      sets.push(`description = $${pi++}`);
      params.push(patch.description);
    }
    if (patch.config !== undefined) {
      sets.push(`config = $${pi++}::jsonb`);
      params.push(JSON.stringify(patch.config));
    }
    if (patch.template_key !== undefined) {
      sets.push(`template_key = $${pi++}`);
      params.push(patch.template_key);
    }
    if (patch.is_shared !== undefined) {
      sets.push(`is_shared = $${pi++}`);
      params.push(patch.is_shared);
    }
    if (patch.schedule !== undefined) {
      sets.push(`schedule = $${pi++}::jsonb`);
      params.push(patch.schedule ? JSON.stringify(patch.schedule) : null);
    }

    if (sets.length === 0) {
      return rowToReport(before);
    }

    sets.push(`updated_at = now()`);
    params.push(id, tenantId);

    const { rows } = await client.query(
      `UPDATE reports SET ${sets.join(', ')}
       WHERE id = $${pi++} AND tenant_id = $${pi++} AND deleted_at IS NULL
       RETURNING *`,
      params
    );
    if (rows.length === 0) {
      throw new AppError(404, 'REPORT_NOT_FOUND', 'Rapport niet gevonden');
    }
    const after = rowToReport(rows[0]);
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.REPORT_UPDATED,
        entityType: 'report',
        entityId: id,
        before: { name: before.name },
        after: { name: after.name },
        userId,
      },
      ctx
    );
    return after;
  });
}

export async function deleteReport(
  tenantId: string,
  id: string,
  userId: string | null,
  ctx: AuditContext = {}
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    const before = await fetchReportRow(client, tenantId, id);
    await client.query(
      `UPDATE reports SET deleted_at = now(), updated_at = now()
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.REPORT_DELETED,
        entityType: 'report',
        entityId: id,
        before: { name: (before.name as string) ?? null },
        userId,
      },
      ctx
    );
  });
}

export async function duplicateReport(
  tenantId: string,
  id: string,
  userId: string | null,
  newName: string,
  ctx: AuditContext = {}
): Promise<Report> {
  const trimmed = (newName ?? '').trim();
  if (trimmed.length === 0) {
    throw new AppError(400, 'REPORT_NAME_REQUIRED', 'Naam is verplicht');
  }

  return withTenant(tenantId, async (client) => {
    const src = await fetchReportRow(client, tenantId, id);

    const { rows } = await client.query(
      `INSERT INTO reports
         (tenant_id, user_id, name, description, config, template_key,
          is_template, is_shared, schedule)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, false, false, $7::jsonb)
       RETURNING *`,
      [
        tenantId,
        userId,
        trimmed,
        src.description,
        typeof src.config === 'string' ? src.config : JSON.stringify(src.config),
        src.template_key ?? 'custom',
        typeof src.schedule === 'string'
          ? src.schedule
          : src.schedule
            ? JSON.stringify(src.schedule)
            : null,
      ]
    );
    const dup = rowToReport(rows[0]);
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.REPORT_DUPLICATED,
        entityType: 'report',
        entityId: dup.id,
        after: { source_id: id, name: dup.name },
        userId,
      },
      ctx
    );
    return dup;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Run
// ────────────────────────────────────────────────────────────────────────────

export interface RunReportParameters {
  date_range_override?: ReportConfig['date_range'];
  /** Bypass cache (forceer fresh run). */
  no_cache?: boolean;
}

async function fetchReportRow(
  client: PoolClient,
  tenantId: string,
  id: string
): Promise<Record<string, unknown>> {
  const { rows } = await client.query(
    `SELECT * FROM reports WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [id, tenantId]
  );
  if (rows.length === 0) {
    throw new AppError(404, 'REPORT_NOT_FOUND', 'Rapport niet gevonden');
  }
  return rows[0];
}

function paramsCacheKey(parameters: RunReportParameters | undefined): string {
  return JSON.stringify(parameters?.date_range_override ?? null);
}

export async function runReport(
  tenantId: string,
  reportId: string,
  parameters: RunReportParameters | undefined,
  triggeredBy: 'manual' | 'scheduled' | 'embed',
  userId: string | null,
  ctx: AuditContext = {}
): Promise<RunReportResponse> {
  const startedAt = Date.now();

  return withTenant(tenantId, async (client) => {
    const reportRow = await fetchReportRow(client, tenantId, reportId);
    const report = rowToReport(reportRow);

    // 1) Cache-check — recente succesvolle run met identieke parameters?
    if (!parameters?.no_cache) {
      const cacheKey = paramsCacheKey(parameters);
      const ttlSeconds = Math.floor(CACHE_TTL_MS / 1000);
      const { rows: cacheRows } = await client.query(
        `SELECT id, result_data, ran_at
         FROM report_runs
         WHERE tenant_id = $1
           AND report_id = $2
           AND status = 'success'
           AND result_data IS NOT NULL
           AND ran_at > now() - ($3 || ' seconds')::interval
           AND COALESCE(parameters::text, 'null') = $4
         ORDER BY ran_at DESC
         LIMIT 1`,
        [tenantId, reportId, ttlSeconds, cacheKey]
      );
      if (cacheRows.length > 0) {
        const cached = cacheRows[0];
        const cachedData = parseJson(cached.result_data) as { blocks: AggregateResult[] };
        return {
          blocks: cachedData.blocks ?? [],
          ran_at: cached.ran_at as string,
          report_run_id: cached.id as string,
          cache_hit: true,
        };
      }
    }

    // 2) Date-range bepalen — laat parameters override.
    const dr = parameters?.date_range_override ?? report.config.date_range;
    const dateRange = resolveDateRange(dr);
    const globalFilters = report.config.filters_global ?? [];

    // 3) Aggregate alle blocks parallel.
    let blocks: AggregateResult[] = [];
    let totalRows = 0;
    let runStatus: 'success' | 'failed' = 'success';
    let runError: string | null = null;

    try {
      const results = await Promise.all(
        report.config.blocks.map((be) =>
          aggregateBlock({
            tenantId,
            blockEntry: be,
            globalFilters,
            dateRange,
            client,
          })
        )
      );
      blocks = results.map((r) => r.result);
      totalRows = results.reduce((sum, r) => sum + r.meta.rows_scanned, 0);
    } catch (err) {
      runStatus = 'failed';
      runError = (err as Error).message ?? 'aggregation failed';
    }

    const durationMs = Date.now() - startedAt;
    const resultBuf =
      runStatus === 'success' ? Buffer.from(JSON.stringify({ blocks })) : null;
    const sizeKb = resultBuf ? Math.ceil(resultBuf.length / 1024) : 0;

    const runRowId = randomUUID();
    await client.query(
      `INSERT INTO report_runs
         (id, tenant_id, report_id, triggered_by, user_id,
          parameters, result_data, result_size_kb, duration_ms,
          status, error)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11)`,
      [
        runRowId,
        tenantId,
        reportId,
        triggeredBy,
        userId,
        JSON.stringify(parameters ?? null),
        runStatus === 'success' && resultBuf ? resultBuf.toString('utf-8') : null,
        sizeKb,
        durationMs,
        runStatus,
        runError,
      ]
    );

    if (runStatus === 'success') {
      await client.query(
        `UPDATE reports SET last_run_at = now() WHERE id = $1 AND tenant_id = $2`,
        [reportId, tenantId]
      );
    }

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.REPORT_RUN,
        entityType: 'report',
        entityId: reportId,
        after: {
          status: runStatus,
          duration_ms: durationMs,
          rows_scanned: totalRows,
          triggered_by: triggeredBy,
        },
        userId,
      },
      ctx
    );

    if (runStatus === 'failed') {
      throw new AppError(500, 'REPORT_RUN_FAILED', runError ?? 'Rapport-run mislukt');
    }

    return {
      blocks,
      ran_at: new Date().toISOString(),
      report_run_id: runRowId,
      cache_hit: false,
    };
  });
}

export async function listReportRuns(
  tenantId: string,
  reportId: string,
  limit = 50
): Promise<
  Array<{
    id: string;
    triggered_by: string;
    user_id: string | null;
    duration_ms: number | null;
    result_size_kb: number | null;
    status: 'success' | 'failed';
    error: string | null;
    ran_at: string;
  }>
> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, triggered_by, user_id, duration_ms, result_size_kb,
              status, error, ran_at
       FROM report_runs
       WHERE tenant_id = $1 AND report_id = $2
       ORDER BY ran_at DESC
       LIMIT $3`,
      [tenantId, reportId, Math.min(limit, 200)]
    );
    return rows.map((r) => ({
      id: r.id,
      triggered_by: r.triggered_by,
      user_id: r.user_id,
      duration_ms: r.duration_ms,
      result_size_kb: r.result_size_kb,
      status: r.status,
      error: r.error,
      ran_at: r.ran_at,
    }));
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Embed-tokens
// ────────────────────────────────────────────────────────────────────────────

function generateRandomToken(): string {
  // 32 bytes hex = 64 chars; cryptographisch random.
  return randomBytes(32).toString('hex');
}

export async function generateEmbedToken(
  tenantId: string,
  reportId: string,
  userId: string | null,
  baseUrl: string,
  ctx: AuditContext = {}
): Promise<{ token: string; url: string }> {
  return withTenant(tenantId, async (client) => {
    await fetchReportRow(client, tenantId, reportId);

    const token = generateRandomToken();
    await client.query(
      `UPDATE reports
       SET embed_token = $1, embed_enabled = true, updated_at = now()
       WHERE id = $2 AND tenant_id = $3`,
      [token, reportId, tenantId]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.REPORT_EMBED_ENABLED,
        entityType: 'report',
        entityId: reportId,
        userId,
      },
      ctx
    );
    const cleanBase = baseUrl.replace(/\/$/, '');
    return {
      token,
      url: `${cleanBase}/api/reports/embed/${token}/run`,
    };
  });
}

export async function revokeEmbedToken(
  tenantId: string,
  reportId: string,
  userId: string | null,
  ctx: AuditContext = {}
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    await fetchReportRow(client, tenantId, reportId);
    await client.query(
      `UPDATE reports
       SET embed_token = NULL, embed_enabled = false, updated_at = now()
       WHERE id = $1 AND tenant_id = $2`,
      [reportId, tenantId]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.REPORT_EMBED_DISABLED,
        entityType: 'report',
        entityId: reportId,
        userId,
      },
      ctx
    );
  });
}

/**
 * Public lookup van een report via embed-token. GEEN tenant-context — we
 * gebruiken withoutTenant zodat we de RLS bypassen voor déze ene query, en
 * krijgen de tenant_id van de report-row terug. Vervolgens gebruikt de
 * caller dat tenant_id om runReport(..., 'embed', ...) aan te roepen.
 *
 * Veiligheid:
 *   - 64-char hex-token (256 bits entropie) met UNIQUE-index — guessing is
 *     statistisch onmogelijk.
 *   - embed_enabled moet TRUE zijn, anders 404.
 *   - Reports met deleted_at gezet zijn niet vindbaar.
 *   - Eventuele rate-limit op token-lookup gebeurt op router-niveau (apiRateLimit).
 */
export async function getReportFromEmbedToken(
  token: string
): Promise<{ report: Report; tenant_id: string }> {
  if (!token || token.length < 32 || !/^[a-f0-9]+$/i.test(token)) {
    throw new AppError(404, 'EMBED_TOKEN_INVALID', 'Embed-token ongeldig');
  }
  return withoutTenant(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM reports
       WHERE embed_token = $1
         AND embed_enabled = true
         AND deleted_at IS NULL`,
      [token]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'EMBED_TOKEN_INVALID', 'Embed-token ongeldig');
    }
    const report = rowToReport(rows[0]);
    return { report, tenant_id: report.tenant_id };
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Templates
// ────────────────────────────────────────────────────────────────────────────

export function listSystemTemplates(): typeof SYSTEM_TEMPLATES {
  return SYSTEM_TEMPLATES;
}

export function getSystemTemplate(key: string): ReturnType<typeof getTemplateByKey> {
  return getTemplateByKey(key);
}
