/**
 * Report Builder — aggregation engine.
 *
 * Sprint Q3.5 (Agent EEE).
 *
 * Hoofd-API: `aggregateBlock({ tenantId, blockEntry, globalFilters?, dateRange })`.
 *
 * Output-shape volgt het discriminated-union contract `AggregateResult` uit
 * `configSchema.ts`. Dat contract is gedeeld met Agent GGG (export-module),
 * zodat exporters (CSV/PDF/XLSX) per block_type kunnen renderen zonder casts.
 *
 * Veiligheid:
 *   - Dimension- en metric-keys zijn whitelisted in configSchema; deze module
 *     mapt ze naar gehardcodeerde SQL-fragmenten (DIMENSION_REGISTRY /
 *     METRIC_REGISTRY). Er gaat NOOIT user-input direct in een SQL-string.
 *   - Filter-velden worden gevalideerd tegen FILTERABLE_FIELDS per entity en
 *     gebruiken parameterized queries ($1, $2, ...). Onbekende velden worden
 *     stilletjes gedropt zodat een client geen 500 krijgt op legitieme typo's.
 *   - Tenant-isolatie komt van de expliciete `tenant_id = current_setting(
 *     'app.tenant_id')` die tenantPrefix() aan elke base-query toevoegt, plus
 *     `AND <alias>.tenant_id` op elke JOIN. NIET van RLS: de app draait in
 *     productie onder een owner-rol die RLS bypasst (zie db/pool.ts +
 *     docs/RLS_HARDENING.md). Een ontbrekend tenant-filter zou dus NIET door
 *     PostgreSQL worden opgevangen — elke SELECT/JOIN moet zelf scopen.
 *
 * Performance (geschat):
 *   - kpi: 1 query (of 2 bij comparison) — meestal <50ms.
 *   - table: 1 GROUP BY met cross-tab pivot in JS. Cardinaliteit beperkt door
 *     LIMIT (default 1000, max 10000).
 *   - bar/line: 1 GROUP BY met meerdere series-aggregations in dezelfde query.
 *   - funnel: 1 query met N COUNT(*) FILTER per stage.
 *   - pie: 1 GROUP BY ORDER BY value DESC.
 *
 * In de service-laag worden meerdere blocks parallel aggegeerd via
 * Promise.all (zie reports.service.ts → runReport).
 */

import type { PoolClient } from 'pg';
import { withTenant } from '../../db/pool';
import {
  AVAILABLE_DIMENSIONS,
  AVAILABLE_METRICS,
  DIMENSION_KEYS,
  METRIC_KEYS,
  FILTERABLE_FIELDS,
  type ReportBlock,
  type ReportBlockEntry,
  type ReportDimension,
  type ReportMetric,
  type ReportFilter,
  type ReportEntity,
  type FilterOperator,
  type AggregateResult,
  type KpiAggregateResult,
  type TableAggregateResult,
  type ChartAggregateResult,
  type FunnelAggregateResult,
  type PieAggregateResult,
} from './configSchema';

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

export interface AggregateInput {
  tenantId: string;
  /** Hele block-entry met id + title + (optionele) sub-block. */
  blockEntry: ReportBlockEntry;
  globalFilters?: ReportFilter[];
  dateRange: { from: Date; to: Date };
  /**
   * Optionele bestaande client — wanneer aanroepen vanuit een al actieve
   * `withTenant`-transactie. Als omitted opent aggregateBlock zelf een
   * nieuwe withTenant-transactie.
   */
  client?: PoolClient;
}

export interface AggregateMeta {
  rows_scanned: number;
  ms: number;
}

export interface AggregateBlockResponse {
  result: AggregateResult;
  meta: AggregateMeta;
}

// ────────────────────────────────────────────────────────────────────────────
// SQL fragmenten per dimension / metric — STRIKT gehardcodeerd.
// ────────────────────────────────────────────────────────────────────────────

interface DimensionEntry {
  select: string;
  alias: string;
  groupBy: string;
  joins?: string;
}

interface MetricEntry {
  select: (alias: string) => string;
  alias: string;
}

// Base FROM-clauses per entity.
const BASE_FROM: Record<ReportEntity, string> = {
  candidates: 'FROM candidates c',
  jobs: 'FROM jobs j',
  applications: 'FROM applications a',
  interviews: 'FROM interviews i',
  communications: 'FROM communications cm',
  recruiters: 'FROM users u',
};

const DIMENSION_REGISTRY: Record<string, DimensionEntry> = {
  recruiter: {
    select: "COALESCE(u.name, 'Onbekend')",
    alias: 'recruiter',
    groupBy: 'u.name',
    joins: 'LEFT JOIN users u ON u.id = j.recruiter_id AND u.tenant_id = j.tenant_id',
  },
  source: {
    select: "COALESCE(c.source, 'Onbekend')",
    alias: 'source',
    groupBy: 'c.source',
  },
  stage: {
    select: "COALESCE(ps.name, 'Onbekend')",
    alias: 'stage',
    groupBy: 'ps.name',
    joins: 'LEFT JOIN pipeline_stages ps ON ps.id = a.stage_id AND ps.tenant_id = a.tenant_id',
  },
  job_title: {
    select: "COALESCE(j.title, 'Onbekend')",
    alias: 'job_title',
    groupBy: 'j.title',
  },
  department: {
    select: "COALESCE(j.department, 'Onbekend')",
    alias: 'department',
    groupBy: 'j.department',
  },
  location: {
    select: "COALESCE(j.location, 'Onbekend')",
    alias: 'location',
    groupBy: 'j.location',
  },
  date_day: {
    select: "to_char(date_trunc('day', __DATE_COL__), 'YYYY-MM-DD')",
    alias: 'period',
    groupBy: "date_trunc('day', __DATE_COL__)",
  },
  date_week: {
    select: "to_char(date_trunc('week', __DATE_COL__), 'IYYY-\"W\"IW')",
    alias: 'period',
    groupBy: "date_trunc('week', __DATE_COL__)",
  },
  date_month: {
    select: "to_char(date_trunc('month', __DATE_COL__), 'YYYY-MM')",
    alias: 'period',
    groupBy: "date_trunc('month', __DATE_COL__)",
  },
  date_quarter: {
    select: "to_char(date_trunc('quarter', __DATE_COL__), 'YYYY-\"Q\"Q')",
    alias: 'period',
    groupBy: "date_trunc('quarter', __DATE_COL__)",
  },
  candidate_country: {
    select: "COALESCE(c.address_country, 'Onbekend')",
    alias: 'candidate_country',
    groupBy: 'c.address_country',
  },
};

const METRIC_REGISTRY: Record<string, MetricEntry> = {
  count: {
    select: (alias) => `COUNT(*)::int AS ${alias}`,
    alias: 'count',
  },
  application_count: {
    select: (alias) => `COUNT(DISTINCT a.id)::int AS ${alias}`,
    alias: 'application_count',
  },
  hire_count: {
    select: (alias) =>
      `COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'hired')::int AS ${alias}`,
    alias: 'hire_count',
  },
  reject_count: {
    select: (alias) =>
      `COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'rejected')::int AS ${alias}`,
    alias: 'reject_count',
  },
  conversion: {
    select: (alias) => `
      CASE WHEN COUNT(DISTINCT a.id) = 0 THEN 0
           ELSE ROUND(
             COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'hired')::numeric
             / COUNT(DISTINCT a.id) * 100, 2
           )
      END::float AS ${alias}`,
    alias: 'conversion',
  },
  time_to_hire: {
    select: (alias) => `
      COALESCE(
        AVG(EXTRACT(EPOCH FROM (j.filled_at - j.created_at)) / 86400)
          FILTER (WHERE j.filled_at IS NOT NULL),
        0
      )::float AS ${alias}`,
    alias: 'time_to_hire',
  },
  time_in_stage: {
    select: (alias) => `
      COALESCE(
        AVG(EXTRACT(EPOCH FROM (a.updated_at - a.applied_at)) / 86400),
        0
      )::float AS ${alias}`,
    alias: 'time_in_stage',
  },
  avg_ai_score: {
    select: (alias) => `COALESCE(AVG(c.ai_score), 0)::float AS ${alias}`,
    alias: 'avg_ai_score',
  },
  avg_salary: {
    select: (alias) =>
      `COALESCE(AVG((COALESCE(j.salary_min,0) + COALESCE(j.salary_max,0)) / NULLIF(((CASE WHEN j.salary_min IS NULL THEN 0 ELSE 1 END) + (CASE WHEN j.salary_max IS NULL THEN 0 ELSE 1 END))::int, 0)), 0)::float AS ${alias}`,
    alias: 'avg_salary',
  },
  source_roi: {
    select: (alias) => `
      CASE WHEN COUNT(DISTINCT c.id) = 0 THEN 0
           ELSE ROUND(
             COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'hired')::numeric
             / COUNT(DISTINCT c.id) * 100, 2
           )
      END::float AS ${alias}`,
    alias: 'source_roi',
  },
};

const METRIC_BASE_ENTITY: Record<string, ReportEntity> = {
  count: 'candidates',
  application_count: 'applications',
  hire_count: 'applications',
  reject_count: 'applications',
  conversion: 'applications',
  time_to_hire: 'jobs',
  time_in_stage: 'applications',
  avg_ai_score: 'candidates',
  avg_salary: 'jobs',
  source_roi: 'candidates',
};

const DEFAULT_DATE_COL: Record<ReportEntity, string> = {
  candidates: 'c.created_at',
  jobs: 'j.created_at',
  applications: 'a.applied_at',
  interviews: 'i.scheduled_start',
  communications: 'cm.sent_at',
  recruiters: 'u.created_at',
};

// Defense-in-depth: elke bridge-JOIN scopet óók op tenant_id. De base-tabel is
// al tenant-gefilterd (tenantPrefix), en de FK's zijn tenant-lokaal, maar omdat
// RLS in prod inactief is (owner-rol) mag geen JOIN puur op FK-integriteit
// leunen — een gecorrumpeerde/cross-tenant FK zou anders lekken.
const BRIDGES: Record<string, string> = {
  'candidates->applications':
    'LEFT JOIN applications a ON a.candidate_id = c.id AND a.tenant_id = c.tenant_id',
  'applications->candidates':
    'LEFT JOIN candidates c ON c.id = a.candidate_id AND c.tenant_id = a.tenant_id',
  'applications->jobs':
    'LEFT JOIN jobs j ON j.id = a.job_id AND j.tenant_id = a.tenant_id',
  'jobs->applications':
    'LEFT JOIN applications a ON a.job_id = j.id AND a.tenant_id = j.tenant_id',
  'candidates->jobs':
    'LEFT JOIN applications a ON a.candidate_id = c.id AND a.tenant_id = c.tenant_id LEFT JOIN jobs j ON j.id = a.job_id AND j.tenant_id = a.tenant_id',
};

// ────────────────────────────────────────────────────────────────────────────
// Filter-builder
// ────────────────────────────────────────────────────────────────────────────

interface CompiledFilter {
  sql: string;
  params: unknown[];
  nextOffset: number;
}

const ENTITY_PREFIX: Record<ReportEntity, string> = {
  candidates: 'c',
  jobs: 'j',
  applications: 'a',
  interviews: 'i',
  communications: 'cm',
  recruiters: 'u',
};

function findEntityForField(field: string): ReportEntity | null {
  for (const [entity, fields] of Object.entries(FILTERABLE_FIELDS) as Array<
    [ReportEntity, ReadonlySet<string>]
  >) {
    if (fields.has(field)) return entity;
  }
  return null;
}

function operatorToSql(
  op: FilterOperator,
  paramOffset: number,
  value: unknown
): { sqlOp: string; params: unknown[]; nextOffset: number } {
  switch (op) {
    case 'equals':
      return {
        sqlOp: `= $${paramOffset}`,
        params: [value],
        nextOffset: paramOffset + 1,
      };
    case 'gt':
      return {
        sqlOp: `> $${paramOffset}`,
        params: [value],
        nextOffset: paramOffset + 1,
      };
    case 'lt':
      return {
        sqlOp: `< $${paramOffset}`,
        params: [value],
        nextOffset: paramOffset + 1,
      };
    case 'contains':
      return {
        sqlOp: `ILIKE $${paramOffset}`,
        params: [`%${String(value)}%`],
        nextOffset: paramOffset + 1,
      };
    case 'in': {
      const arr = Array.isArray(value) ? value : [value];
      return {
        sqlOp: `= ANY($${paramOffset}::text[])`,
        params: [arr.map((v) => String(v))],
        nextOffset: paramOffset + 1,
      };
    }
    case 'between': {
      const [a, b] = (Array.isArray(value) ? value : [value, value]) as [
        unknown,
        unknown,
      ];
      return {
        sqlOp: `BETWEEN $${paramOffset} AND $${paramOffset + 1}`,
        params: [a, b],
        nextOffset: paramOffset + 2,
      };
    }
  }
}

function compileFilters(
  filters: ReportFilter[],
  paramOffset: number
): CompiledFilter {
  const fragments: string[] = [];
  const params: unknown[] = [];
  let offset = paramOffset;

  for (const f of filters) {
    const entity = findEntityForField(f.field);
    if (!entity) continue;
    const prefix = ENTITY_PREFIX[entity];
    const { sqlOp, params: ps, nextOffset } = operatorToSql(
      f.operator,
      offset,
      f.value
    );
    fragments.push(`${prefix}.${f.field} ${sqlOp}`);
    params.push(...ps);
    offset = nextOffset;
  }

  return { sql: fragments.join(' AND '), params, nextOffset: offset };
}

// ────────────────────────────────────────────────────────────────────────────
// Query-builder helpers
// ────────────────────────────────────────────────────────────────────────────

function dimensionEntry(d: ReportDimension): DimensionEntry {
  if (!DIMENSION_KEYS.has(d.key)) {
    throw new Error(`Unknown dimension: ${d.key}`);
  }
  return DIMENSION_REGISTRY[d.key];
}

function metricEntry(m: ReportMetric): MetricEntry {
  if (!METRIC_KEYS.has(m.key)) {
    throw new Error(`Unknown metric: ${m.key}`);
  }
  return METRIC_REGISTRY[m.key];
}

function dimensionLabel(d: ReportDimension): string {
  return AVAILABLE_DIMENSIONS.find((x) => x.key === d.key)?.label ?? d.label ?? d.key;
}

function metricLabel(m: ReportMetric): string {
  return AVAILABLE_METRICS.find((x) => x.key === m.key)?.label ?? m.label ?? m.key;
}

function metricUnit(m: ReportMetric): string | undefined {
  return AVAILABLE_METRICS.find((x) => x.key === m.key)?.unit ?? m.unit;
}

function buildJoinsFor(
  baseEntity: ReportEntity,
  dimensions: ReportDimension[]
): string {
  const joins: string[] = [];
  const seen = new Set<string>();

  for (const d of dimensions) {
    const dimEntity = AVAILABLE_DIMENSIONS.find((x) => x.key === d.key)?.entity;
    if (!dimEntity) continue;

    if (dimEntity !== baseEntity) {
      const bridgeKey = `${baseEntity}->${dimEntity}` as keyof typeof BRIDGES;
      if (BRIDGES[bridgeKey] && !seen.has(bridgeKey)) {
        joins.push(BRIDGES[bridgeKey]);
        seen.add(bridgeKey);
      }
    }
    const reg = DIMENSION_REGISTRY[d.key];
    if (reg.joins && !seen.has(`dim:${d.key}`)) {
      joins.push(reg.joins);
      seen.add(`dim:${d.key}`);
    }
  }
  return joins.join('\n');
}

function buildJoinsForMetric(
  baseEntity: ReportEntity,
  metricKey: string
): string {
  const needsApplications =
    metricKey === 'application_count' ||
    metricKey === 'hire_count' ||
    metricKey === 'reject_count' ||
    metricKey === 'conversion' ||
    metricKey === 'source_roi' ||
    metricKey === 'time_in_stage';

  if (needsApplications && baseEntity !== 'applications') {
    const bridgeKey = `${baseEntity}->applications` as keyof typeof BRIDGES;
    if (BRIDGES[bridgeKey]) return BRIDGES[bridgeKey];
  }
  return '';
}

function applyDateColumn(sql: string, baseEntity: ReportEntity): string {
  return sql.replace(/__DATE_COL__/g, DEFAULT_DATE_COL[baseEntity]);
}

function tenantPrefix(entity: ReportEntity): string {
  return `${ENTITY_PREFIX[entity]}.tenant_id = current_setting('app.tenant_id', true)::uuid`;
}

function deletedAtClause(entity: ReportEntity): string {
  if (entity === 'candidates' || entity === 'jobs') {
    return ` AND ${ENTITY_PREFIX[entity]}.deleted_at IS NULL`;
  }
  return '';
}

function dateClause(
  entity: ReportEntity,
  paramOffset: number
): { sql: string; nextOffset: number } {
  const col = DEFAULT_DATE_COL[entity];
  return {
    sql: `${col} >= $${paramOffset} AND ${col} <= $${paramOffset + 1}`,
    nextOffset: paramOffset + 2,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Per-block aggregators
// ────────────────────────────────────────────────────────────────────────────

interface RawAgg {
  rows_scanned: number;
}

async function aggregateKpi(
  client: PoolClient,
  blockEntry: ReportBlockEntry,
  block: Extract<ReportBlock, { type: 'kpi' }>,
  globalFilters: ReportFilter[],
  dateRange: { from: Date; to: Date }
): Promise<{ result: KpiAggregateResult } & RawAgg> {
  const baseEntity = METRIC_BASE_ENTITY[block.metric.key];
  const m = metricEntry(block.metric);
  const allFilters = [...globalFilters, ...(block.filters ?? [])];

  const runOne = async (
    from: Date,
    to: Date
  ): Promise<{ value: number; rows: number }> => {
    let paramIdx = 1;
    const params: unknown[] = [];
    const where: string[] = [tenantPrefix(baseEntity)];

    const dateExpr = dateClause(baseEntity, paramIdx);
    where.push(dateExpr.sql);
    params.push(from, to);
    paramIdx = dateExpr.nextOffset;

    if (allFilters.length > 0) {
      const f = compileFilters(allFilters, paramIdx);
      if (f.sql) {
        where.push(f.sql);
        params.push(...f.params);
        paramIdx = f.nextOffset;
      }
    }

    const joins = buildJoinsForMetric(baseEntity, block.metric.key);
    const deletedAt = deletedAtClause(baseEntity);

    const sql = `
      SELECT ${m.select('value')}
      ${BASE_FROM[baseEntity]}
      ${joins}
      WHERE ${where.join(' AND ')}${deletedAt}
    `;

    const { rows } = await client.query(sql, params);
    const raw = rows[0]?.value ?? 0;
    const num = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
    return { value: num, rows: rows.length };
  };

  const current = await runOne(dateRange.from, dateRange.to);

  let comparisonValue: number | null | undefined;
  let deltaPct: number | null | undefined;
  let scanned = current.rows;

  if (block.comparison) {
    const span = dateRange.to.getTime() - dateRange.from.getTime();
    let prevFrom: Date;
    let prevTo: Date;
    if (block.comparison === 'previous_period') {
      prevFrom = new Date(dateRange.from.getTime() - span);
      prevTo = new Date(dateRange.from.getTime() - 1);
    } else {
      prevFrom = new Date(
        dateRange.from.getFullYear() - 1,
        dateRange.from.getMonth(),
        dateRange.from.getDate()
      );
      prevTo = new Date(
        dateRange.to.getFullYear() - 1,
        dateRange.to.getMonth(),
        dateRange.to.getDate()
      );
    }
    const previous = await runOne(prevFrom, prevTo);
    comparisonValue = previous.value;
    deltaPct =
      previous.value === 0
        ? null
        : Math.round(((current.value - previous.value) / previous.value) * 1000) / 10;
    scanned += previous.rows;
  }

  const result: KpiAggregateResult = {
    block_id: blockEntry.id,
    block_type: 'kpi',
    title: blockEntry.title,
    metric_label: metricLabel(block.metric),
    metric_unit: metricUnit(block.metric),
    value: current.value,
    comparison_value: comparisonValue,
    comparison_delta_pct: deltaPct,
  };

  return { result, rows_scanned: scanned };
}

async function aggregateTable(
  client: PoolClient,
  blockEntry: ReportBlockEntry,
  block: Extract<ReportBlock, { type: 'table' }>,
  globalFilters: ReportFilter[],
  dateRange: { from: Date; to: Date }
): Promise<{ result: TableAggregateResult } & RawAgg> {
  const baseEntity = METRIC_BASE_ENTITY[block.metric.key];
  const m = metricEntry(block.metric);
  const allFilters = [...globalFilters, ...(block.filters ?? [])];
  const allDimensions = [...block.rows, ...(block.cols ?? [])];

  let paramIdx = 1;
  const params: unknown[] = [];
  const where: string[] = [tenantPrefix(baseEntity)];

  const dateExpr = dateClause(baseEntity, paramIdx);
  where.push(dateExpr.sql);
  params.push(dateRange.from, dateRange.to);
  paramIdx = dateExpr.nextOffset;

  if (allFilters.length > 0) {
    const f = compileFilters(allFilters, paramIdx);
    if (f.sql) {
      where.push(f.sql);
      params.push(...f.params);
      paramIdx = f.nextOffset;
    }
  }

  const dimSelects = allDimensions
    .map((d) => {
      const reg = dimensionEntry(d);
      const sel = applyDateColumn(reg.select, baseEntity);
      return `${sel} AS dim_${d.key}`;
    })
    .join(', ');

  const dimGroupBy = allDimensions
    .map((d) => applyDateColumn(dimensionEntry(d).groupBy, baseEntity))
    .join(', ');

  const joins = [
    buildJoinsFor(baseEntity, allDimensions),
    buildJoinsForMetric(baseEntity, block.metric.key),
  ]
    .filter(Boolean)
    .join('\n');
  const deletedAt = deletedAtClause(baseEntity);

  const sortKey = block.sort?.key ?? 'metric';
  const sortDir = block.sort?.direction === 'asc' ? 'ASC' : 'DESC';
  const sortSql = sortKey === 'metric' ? `metric ${sortDir}` : `1 ${sortDir}`;
  const limit = Math.min(Math.max(block.limit ?? 1000, 1), 10000);

  const sql = `
    SELECT ${dimSelects}, ${m.select('metric')}
    ${BASE_FROM[baseEntity]}
    ${joins}
    WHERE ${where.join(' AND ')}${deletedAt}
    GROUP BY ${dimGroupBy}
    ORDER BY ${sortSql}
    LIMIT ${limit}
  `;

  const { rows } = await client.query(sql, params);

  const rowDimKeys = block.rows.map((d) => `dim_${d.key}`);
  const colDimKeys = (block.cols ?? []).map((d) => `dim_${d.key}`);
  const rowDimLabels = block.rows.map(dimensionLabel);
  const colDimLabels = (block.cols ?? []).map(dimensionLabel);

  if (colDimKeys.length === 0) {
    // Geen pivot — flat table.
    const headers = [...rowDimLabels, metricLabel(block.metric)];
    const tableRows: Array<Array<string | number | null>> = rows.map((r) => {
      const row: Array<string | number | null> = rowDimKeys.map(
        (k) => (r[k] ?? null) as string | number | null
      );
      row.push(toNumberOrNull(r.metric));
      return row;
    });
    return {
      result: {
        block_id: blockEntry.id,
        block_type: 'table',
        title: blockEntry.title,
        headers,
        rows: tableRows,
      },
      rows_scanned: rows.length,
    };
  }

  // Cross-tab pivot.
  const pivot = new Map<string, Map<string, number | null>>();
  const colKeySet = new Set<string>();

  for (const r of rows) {
    const rowKeyStr = rowDimKeys.map((k) => String(r[k] ?? '')).join('|');
    const colKeyStr = colDimKeys.map((k) => String(r[k] ?? '')).join('|');
    colKeySet.add(colKeyStr);
    if (!pivot.has(rowKeyStr)) pivot.set(rowKeyStr, new Map());
    pivot.get(rowKeyStr)!.set(colKeyStr, toNumberOrNull(r.metric));
  }

  const colKeysSorted = Array.from(colKeySet).sort();
  const headers = [...rowDimLabels, ...colKeysSorted];

  // Reconstrueer row-keys als arrays
  const rowKeys = Array.from(pivot.keys());
  const tableRows: Array<Array<string | number | null>> = rowKeys.map((rk) => {
    const parts = rk.split('|');
    const out: Array<string | number | null> = parts;
    const cells = pivot.get(rk)!;
    for (const ck of colKeysSorted) {
      out.push(cells.get(ck) ?? null);
    }
    return out;
  });

  return {
    result: {
      block_id: blockEntry.id,
      block_type: 'table',
      title: blockEntry.title,
      headers,
      rows: tableRows,
    },
    rows_scanned: rows.length,
  };
}

async function aggregateChart(
  client: PoolClient,
  blockEntry: ReportBlockEntry,
  block: Extract<ReportBlock, { type: 'bar' | 'line' }>,
  globalFilters: ReportFilter[],
  dateRange: { from: Date; to: Date }
): Promise<{ result: ChartAggregateResult } & RawAgg> {
  const baseEntity = METRIC_BASE_ENTITY[block.series[0].key];
  const allFilters = [...globalFilters, ...(block.filters ?? [])];
  const allDimensions = [block.x, ...(block.group_by ? [block.group_by] : [])];

  let paramIdx = 1;
  const params: unknown[] = [];
  const where: string[] = [tenantPrefix(baseEntity)];

  const dateExpr = dateClause(baseEntity, paramIdx);
  where.push(dateExpr.sql);
  params.push(dateRange.from, dateRange.to);
  paramIdx = dateExpr.nextOffset;

  if (allFilters.length > 0) {
    const f = compileFilters(allFilters, paramIdx);
    if (f.sql) {
      where.push(f.sql);
      params.push(...f.params);
      paramIdx = f.nextOffset;
    }
  }

  const xReg = dimensionEntry(block.x);
  const xSelect = applyDateColumn(xReg.select, baseEntity);
  const xGroupBy = applyDateColumn(xReg.groupBy, baseEntity);

  const groupSelect = block.group_by
    ? `, ${applyDateColumn(dimensionEntry(block.group_by).select, baseEntity)} AS group_key`
    : '';
  const groupGroupBy = block.group_by
    ? `, ${applyDateColumn(dimensionEntry(block.group_by).groupBy, baseEntity)}`
    : '';

  const seriesSelects = block.series
    .map((s) => metricEntry(s).select(s.key))
    .join(', ');

  const joins = [
    buildJoinsFor(baseEntity, allDimensions),
    ...block.series.map((s) => buildJoinsForMetric(baseEntity, s.key)),
  ]
    .filter(Boolean)
    .join('\n');
  const deletedAt = deletedAtClause(baseEntity);

  const sql = `
    SELECT ${xSelect} AS x ${groupSelect}, ${seriesSelects}
    ${BASE_FROM[baseEntity]}
    ${joins}
    WHERE ${where.join(' AND ')}${deletedAt}
    GROUP BY ${xGroupBy}${groupGroupBy}
    ORDER BY ${xGroupBy}
    LIMIT 5000
  `;

  const { rows } = await client.query(sql, params);

  let points: Array<{ x: string | number; values: Record<string, number | null> }>;
  let seriesLabels: string[];

  if (block.group_by) {
    const map = new Map<string, { x: string; values: Record<string, number | null> }>();
    const groupKeys = new Set<string>();
    for (const r of rows) {
      const x = String(r.x);
      const gk = String(r.group_key ?? 'Onbekend');
      groupKeys.add(gk);
      if (!map.has(x)) map.set(x, { x, values: {} });
      map.get(x)!.values[gk] = toNumberOrNull(r[block.series[0].key]);
    }
    seriesLabels = Array.from(groupKeys).sort();
    // Vul ontbrekende cells met null
    for (const point of map.values()) {
      for (const gk of seriesLabels) {
        if (!(gk in point.values)) point.values[gk] = null;
      }
    }
    points = Array.from(map.values());
  } else {
    seriesLabels = block.series.map(metricLabel);
    points = rows.map((r) => {
      const values: Record<string, number | null> = {};
      block.series.forEach((s, i) => {
        values[seriesLabels[i]] = toNumberOrNull(r[s.key]);
      });
      return { x: String(r.x), values };
    });
  }

  return {
    result: {
      block_id: blockEntry.id,
      block_type: block.type,
      title: blockEntry.title,
      x_label: dimensionLabel(block.x),
      series_labels: seriesLabels,
      points,
    },
    rows_scanned: rows.length,
  };
}

async function aggregateFunnel(
  client: PoolClient,
  blockEntry: ReportBlockEntry,
  block: Extract<ReportBlock, { type: 'funnel' }>,
  globalFilters: ReportFilter[],
  dateRange: { from: Date; to: Date }
): Promise<{ result: FunnelAggregateResult } & RawAgg> {
  const baseEntity: ReportEntity = 'applications';
  const allFilters = [...globalFilters, ...(block.filters ?? [])];

  let paramIdx = 1;
  const params: unknown[] = [];
  const where: string[] = [tenantPrefix(baseEntity)];

  const dateExpr = dateClause(baseEntity, paramIdx);
  where.push(dateExpr.sql);
  params.push(dateRange.from, dateRange.to);
  paramIdx = dateExpr.nextOffset;

  if (allFilters.length > 0) {
    const f = compileFilters(allFilters, paramIdx);
    if (f.sql) {
      where.push(f.sql);
      params.push(...f.params);
      paramIdx = f.nextOffset;
    }
  }

  const stageFilters = block.stages
    .map((_, idx) => {
      const i = paramIdx + idx;
      return `COUNT(DISTINCT a.id) FILTER (WHERE ps.name = $${i})::int AS stage_${idx}`;
    })
    .join(', ');
  params.push(...block.stages);

  const sql = `
    SELECT ${stageFilters}
    FROM applications a
    LEFT JOIN pipeline_stages ps ON ps.id = a.stage_id
    WHERE ${where.join(' AND ')}
  `;

  const { rows } = await client.query(sql, params);
  const r = rows[0] ?? {};

  const rawCounts = block.stages.map((_, idx) => Number(r[`stage_${idx}`] ?? 0));
  const stages = buildFunnelStages(block.stages, rawCounts);
  const firstCount = stages[0]?.count ?? 0;

  return {
    result: {
      block_id: blockEntry.id,
      block_type: 'funnel',
      title: blockEntry.title,
      stages,
    },
    // Alle rijen zitten in stage 0 (= cumulatief 'bereikt de eerste stap of later').
    rows_scanned: firstCount,
  };
}

/**
 * Bouwt de funnel-stages uit de HUIDIGE bezettingscounts per stap.
 *
 * Waarom cumulatief: `rawCounts[idx]` is het aantal sollicitaties dat NU in
 * stap `idx` staat (elke sollicitatie in precies één stap). Dat is een
 * momentopname/verdeling, geen funnel — een latere stap kan meer huidige
 * bezetting hebben dan de eerste, waardoor `count / firstCount` boven 100%
 * uitkomt (het gerapporteerde 122%-bug).
 *
 * Een funnel toont "hoeveel hebben stap X bereikt". Zonder stage-transitie-
 * historie in de DB benaderen we dat forward-only: wie NU in een latere stap
 * (in de door de rapportauteur gekozen funnel-volgorde) staat, heeft de eerdere
 * stappen doorlopen. Dus reached[idx] = som van de huidige bezetting van stap
 * `idx` t/m de laatste stap. Die reeks is monotoon niet-stijgend, dus
 * conversion_pct (t.o.v. reached[0]) is altijd ≤ 100%.
 *
 * Sollicitaties in stappen die niet in de funnel staan (bv. Afgewezen) tellen
 * nergens mee — ze hebben de forward-pijplijn verlaten. Puur functioneel +
 * unit-testbaar zodat de ≤100%-garantie geborgd is.
 */
export function buildFunnelStages(
  stageNames: string[],
  rawCounts: number[]
): FunnelAggregateResult['stages'] {
  // Cumulatief van achter naar voren: reached[idx] = som(rawCounts[idx..einde]).
  const reached: number[] = new Array(stageNames.length).fill(0);
  let acc = 0;
  for (let idx = stageNames.length - 1; idx >= 0; idx--) {
    acc += Number.isFinite(rawCounts[idx]) ? rawCounts[idx] : 0;
    reached[idx] = acc;
  }
  const firstCount = reached[0] ?? 0;
  return stageNames.map((stage, idx) => {
    const count = reached[idx] ?? 0;
    const pct =
      firstCount === 0
        ? null
        : Math.round((count / firstCount) * 1000) / 10;
    return { stage, count, conversion_pct: pct };
  });
}

async function aggregatePie(
  client: PoolClient,
  blockEntry: ReportBlockEntry,
  block: Extract<ReportBlock, { type: 'pie' }>,
  globalFilters: ReportFilter[],
  dateRange: { from: Date; to: Date }
): Promise<{ result: PieAggregateResult } & RawAgg> {
  const baseEntity = METRIC_BASE_ENTITY[block.metric.key];
  const m = metricEntry(block.metric);
  const allFilters = [...globalFilters, ...(block.filters ?? [])];

  let paramIdx = 1;
  const params: unknown[] = [];
  const where: string[] = [tenantPrefix(baseEntity)];

  const dateExpr = dateClause(baseEntity, paramIdx);
  where.push(dateExpr.sql);
  params.push(dateRange.from, dateRange.to);
  paramIdx = dateExpr.nextOffset;

  if (allFilters.length > 0) {
    const f = compileFilters(allFilters, paramIdx);
    if (f.sql) {
      where.push(f.sql);
      params.push(...f.params);
      paramIdx = f.nextOffset;
    }
  }

  const dReg = dimensionEntry(block.group_by);
  const dSelect = applyDateColumn(dReg.select, baseEntity);
  const dGroupBy = applyDateColumn(dReg.groupBy, baseEntity);

  const joins = [
    buildJoinsFor(baseEntity, [block.group_by]),
    buildJoinsForMetric(baseEntity, block.metric.key),
  ]
    .filter(Boolean)
    .join('\n');
  const deletedAt = deletedAtClause(baseEntity);

  const limit = Math.min(Math.max(block.limit ?? 50, 1), 200);

  const sql = `
    SELECT ${dSelect} AS label, ${m.select('value')}
    ${BASE_FROM[baseEntity]}
    ${joins}
    WHERE ${where.join(' AND ')}${deletedAt}
    GROUP BY ${dGroupBy}
    ORDER BY value DESC
    LIMIT ${limit}
  `;

  const { rows } = await client.query(sql, params);
  const total = rows.reduce((sum, r) => sum + Number(r.value ?? 0), 0);
  const slices = rows.map((r) => {
    const value = Number(r.value ?? 0);
    const pct = total === 0 ? null : Math.round((value / total) * 1000) / 10;
    return { label: String(r.label ?? 'Onbekend'), value, pct };
  });

  return {
    result: {
      block_id: blockEntry.id,
      block_type: 'pie',
      title: blockEntry.title,
      metric_label: metricLabel(block.metric),
      slices,
    },
    rows_scanned: rows.length,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Public entry — aggregateBlock
// ────────────────────────────────────────────────────────────────────────────

export async function aggregateBlock(
  input: AggregateInput
): Promise<AggregateBlockResponse> {
  const start = Date.now();
  const block = input.blockEntry.block;

  const run = async (client: PoolClient): Promise<AggregateBlockResponse> => {
    const filters = input.globalFilters ?? [];
    let agg: { result: AggregateResult; rows_scanned: number };

    switch (block.type) {
      case 'kpi':
        agg = await aggregateKpi(
          client,
          input.blockEntry,
          block,
          filters,
          input.dateRange
        );
        break;
      case 'table':
        agg = await aggregateTable(
          client,
          input.blockEntry,
          block,
          filters,
          input.dateRange
        );
        break;
      case 'bar':
      case 'line':
        agg = await aggregateChart(
          client,
          input.blockEntry,
          block,
          filters,
          input.dateRange
        );
        break;
      case 'funnel':
        agg = await aggregateFunnel(
          client,
          input.blockEntry,
          block,
          filters,
          input.dateRange
        );
        break;
      case 'pie':
        agg = await aggregatePie(
          client,
          input.blockEntry,
          block,
          filters,
          input.dateRange
        );
        break;
    }

    return {
      result: agg.result,
      meta: { rows_scanned: agg.rows_scanned, ms: Date.now() - start },
    };
  };

  if (input.client) {
    return run(input.client);
  }
  return withTenant(input.tenantId, run);
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ────────────────────────────────────────────────────────────────────────────
// Re-exports voor caller-gemak
// ────────────────────────────────────────────────────────────────────────────

export {
  AVAILABLE_DIMENSIONS,
  AVAILABLE_METRICS,
  type ReportBlock,
  type ReportBlockEntry,
  type ReportFilter,
  type ReportDimension,
  type ReportMetric,
  type AggregateResult,
};
