/**
 * Report Builder — config schema + whitelisted dimensions/metrics.
 *
 * Sprint Q3.5 (Agent EEE).
 *
 * Belangrijkste contract: ALLEEN de dimension- en metric-keys die hier
 * gehardcoded staan zijn aanvaardbaar in een ReportBlock. De aggregator
 * interpreteert die keys via de DIMENSION_REGISTRY / METRIC_REGISTRY (in
 * `aggregator.ts`) en bouwt parameterised SQL — er gaat NOOIT user-input
 * direct naar SQL.
 */

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

export type ReportEntity =
  | 'candidates'
  | 'jobs'
  | 'applications'
  | 'interviews'
  | 'communications'
  | 'recruiters';

export interface ReportDimension {
  key: string;
  entity: ReportEntity;
  label: string;
}

export interface ReportMetric {
  key: string;
  entity: ReportEntity;
  label: string;
  unit?: string;
}

export type FilterOperator =
  | 'equals'
  | 'in'
  | 'between'
  | 'gt'
  | 'lt'
  | 'contains';

export interface ReportFilter {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

export type ReportBlock =
  | {
      type: 'kpi';
      metric: ReportMetric;
      filters?: ReportFilter[];
      comparison?: 'previous_period' | 'previous_year' | null;
    }
  | {
      type: 'table';
      rows: ReportDimension[];
      cols?: ReportDimension[];
      metric: ReportMetric;
      filters?: ReportFilter[];
      sort?: { key: string; direction: 'asc' | 'desc' };
      limit?: number;
    }
  | {
      type: 'bar' | 'line';
      x: ReportDimension;
      series: ReportMetric[];
      filters?: ReportFilter[];
      group_by?: ReportDimension;
    }
  | {
      type: 'funnel';
      entity: 'applications';
      stages: string[];
      filters?: ReportFilter[];
    }
  | {
      type: 'pie';
      metric: ReportMetric;
      group_by: ReportDimension;
      filters?: ReportFilter[];
      limit?: number;
    };

export type ReportDateRange =
  | { type: 'last_n_days'; days: number }
  | { type: 'this_quarter' | 'last_quarter' | 'this_year' | 'last_year' }
  | { type: 'custom'; from: string; to: string };

export interface ReportBlockEntry {
  id: string;
  title?: string;
  description?: string;
  size: 'sm' | 'md' | 'lg';
  block: ReportBlock;
}

export interface ReportConfig {
  date_range: ReportDateRange;
  blocks: ReportBlockEntry[];
  filters_global?: ReportFilter[];
}

// ────────────────────────────────────────────────────────────────────────────
// Aggregator result-shape (shared tussen Agent EEE aggregator + Agent GGG
// exporters). Eén discriminated union op block-type zodat exporters per
// blok-shape kunnen renderen zonder casts.
// ────────────────────────────────────────────────────────────────────────────

export interface KpiAggregateResult {
  block_id: string;
  block_type: 'kpi';
  title?: string;
  metric_label: string;
  metric_unit?: string;
  value: number | null;
  comparison_value?: number | null;
  comparison_delta_pct?: number | null;
}

export interface TableAggregateResult {
  block_id: string;
  block_type: 'table';
  title?: string;
  /**
   * Header-labels in render-volgorde. Eerste N labels = row-dimensions,
   * daarna optioneel cols, en als laatste de metric-kolom.
   */
  headers: string[];
  rows: ReadonlyArray<ReadonlyArray<string | number | null>>;
}

export interface ChartSeriesPoint {
  x: string | number;
  values: Record<string, number | null>;
}

export interface ChartAggregateResult {
  block_id: string;
  block_type: 'bar' | 'line';
  title?: string;
  x_label: string;
  series_labels: string[];
  /** Per X-waarde één punt met value-per-series. */
  points: ChartSeriesPoint[];
}

export interface FunnelStageRow {
  stage: string;
  count: number;
  conversion_pct: number | null;
}

export interface FunnelAggregateResult {
  block_id: string;
  block_type: 'funnel';
  title?: string;
  stages: FunnelStageRow[];
}

export interface PieAggregateResult {
  block_id: string;
  block_type: 'pie';
  title?: string;
  metric_label: string;
  slices: Array<{ label: string; value: number; pct: number | null }>;
}

export type AggregateResult =
  | KpiAggregateResult
  | TableAggregateResult
  | ChartAggregateResult
  | FunnelAggregateResult
  | PieAggregateResult;

// ────────────────────────────────────────────────────────────────────────────
// Whitelisted dimensions
// ────────────────────────────────────────────────────────────────────────────

export const AVAILABLE_DIMENSIONS: readonly ReportDimension[] = [
  { key: 'recruiter', entity: 'recruiters', label: 'Recruiter' },
  { key: 'source', entity: 'candidates', label: 'Bron' },
  { key: 'stage', entity: 'applications', label: 'Pipeline-stap' },
  { key: 'job_title', entity: 'jobs', label: 'Vacature' },
  { key: 'department', entity: 'jobs', label: 'Afdeling' },
  { key: 'location', entity: 'jobs', label: 'Locatie' },
  { key: 'date_day', entity: 'applications', label: 'Dag' },
  { key: 'date_week', entity: 'applications', label: 'Week' },
  { key: 'date_month', entity: 'applications', label: 'Maand' },
  { key: 'date_quarter', entity: 'applications', label: 'Kwartaal' },
  { key: 'candidate_country', entity: 'candidates', label: 'Land kandidaat' },
] as const;

// ────────────────────────────────────────────────────────────────────────────
// Whitelisted metrics
// ────────────────────────────────────────────────────────────────────────────

export const AVAILABLE_METRICS: readonly ReportMetric[] = [
  { key: 'count', entity: 'candidates', label: 'Aantal' },
  { key: 'application_count', entity: 'applications', label: 'Aantal sollicitaties' },
  { key: 'hire_count', entity: 'applications', label: 'Aantal hires' },
  { key: 'reject_count', entity: 'applications', label: 'Aantal afwijzingen' },
  { key: 'conversion', entity: 'applications', label: 'Conversie', unit: '%' },
  { key: 'time_to_hire', entity: 'jobs', label: 'Time-to-hire', unit: 'days' },
  { key: 'time_in_stage', entity: 'applications', label: 'Tijd in stage', unit: 'days' },
  { key: 'avg_ai_score', entity: 'candidates', label: 'Gem. AI-score' },
  { key: 'avg_salary', entity: 'jobs', label: 'Gem. salaris', unit: 'EUR' },
  { key: 'source_roi', entity: 'candidates', label: 'Source ROI', unit: '%' },
] as const;

// Lookup-sets — gebruikt voor O(1) whitelisting in validate + aggregator.
export const DIMENSION_KEYS = new Set(AVAILABLE_DIMENSIONS.map((d) => d.key));
export const METRIC_KEYS = new Set(AVAILABLE_METRICS.map((m) => m.key));

// Veilige filter-velden per entity. Filters mogen alleen op deze velden.
// Voor compliance leggen we expliciet vast welke velden filterable zijn —
// dat sluit toegang tot bv. password_hash of resume_text uit.
export const FILTERABLE_FIELDS: Record<ReportEntity, ReadonlySet<string>> = {
  candidates: new Set([
    'source',
    'gender',
    'address_country',
    'tags',
    'created_at',
    'industry',
    'years_of_experience',
  ]),
  jobs: new Set([
    'status',
    'department',
    'location',
    'recruiter_id',
    'employment_type',
    'created_at',
  ]),
  applications: new Set([
    'status',
    'stage_id',
    'job_id',
    'candidate_id',
    'applied_at',
    'updated_at',
  ]),
  interviews: new Set([
    'status',
    'meeting_provider',
    'scheduled_start',
    'scheduled_end',
  ]),
  communications: new Set(['channel', 'direction', 'status', 'sent_at']),
  recruiters: new Set(['role', 'is_active']),
};

const VALID_OPERATORS = new Set<FilterOperator>([
  'equals',
  'in',
  'between',
  'gt',
  'lt',
  'contains',
]);

const VALID_BLOCK_TYPES = new Set([
  'kpi',
  'table',
  'bar',
  'line',
  'funnel',
  'pie',
]);

// ────────────────────────────────────────────────────────────────────────────
// validateReportConfig
// ────────────────────────────────────────────────────────────────────────────

export interface ValidateResult {
  valid: boolean;
  errors?: string[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateDimension(d: unknown, errors: string[], path: string): void {
  if (!isObject(d)) {
    errors.push(`${path}: dimension moet een object zijn`);
    return;
  }
  if (typeof d.key !== 'string' || !DIMENSION_KEYS.has(d.key)) {
    errors.push(`${path}.key: onbekende dimension "${String(d.key)}"`);
  }
}

function validateMetric(m: unknown, errors: string[], path: string): void {
  if (!isObject(m)) {
    errors.push(`${path}: metric moet een object zijn`);
    return;
  }
  if (typeof m.key !== 'string' || !METRIC_KEYS.has(m.key)) {
    errors.push(`${path}.key: onbekende metric "${String(m.key)}"`);
  }
}

function validateFilters(
  filters: unknown,
  errors: string[],
  path: string
): void {
  if (filters === undefined) return;
  if (!Array.isArray(filters)) {
    errors.push(`${path}: filters moet een array zijn`);
    return;
  }
  filters.forEach((f, i) => {
    const p = `${path}[${i}]`;
    if (!isObject(f)) {
      errors.push(`${p}: filter moet een object zijn`);
      return;
    }
    if (typeof f.field !== 'string' || f.field.length === 0) {
      errors.push(`${p}.field: vereist (string)`);
    }
    if (typeof f.operator !== 'string' || !VALID_OPERATORS.has(f.operator as FilterOperator)) {
      errors.push(`${p}.operator: ongeldige operator "${String(f.operator)}"`);
    }
    if (!('value' in f)) {
      errors.push(`${p}.value: vereist`);
    }
    if (f.operator === 'between' && !Array.isArray(f.value)) {
      errors.push(`${p}.value: between vereist een array van 2 waarden`);
    }
    if (f.operator === 'in' && !Array.isArray(f.value)) {
      errors.push(`${p}.value: in vereist een array`);
    }
  });
}

function validateBlock(block: unknown, errors: string[], path: string): void {
  if (!isObject(block)) {
    errors.push(`${path}: block moet een object zijn`);
    return;
  }
  const type = block.type;
  if (typeof type !== 'string' || !VALID_BLOCK_TYPES.has(type)) {
    errors.push(`${path}.type: ongeldig type "${String(type)}"`);
    return;
  }

  switch (type) {
    case 'kpi':
      validateMetric(block.metric, errors, `${path}.metric`);
      validateFilters(block.filters, errors, `${path}.filters`);
      if (
        block.comparison !== undefined &&
        block.comparison !== null &&
        block.comparison !== 'previous_period' &&
        block.comparison !== 'previous_year'
      ) {
        errors.push(`${path}.comparison: ongeldige waarde`);
      }
      break;

    case 'table':
      if (!Array.isArray(block.rows) || block.rows.length === 0) {
        errors.push(`${path}.rows: vereist (niet-leeg array)`);
      } else {
        block.rows.forEach((r, i) =>
          validateDimension(r, errors, `${path}.rows[${i}]`)
        );
      }
      if (block.cols !== undefined && Array.isArray(block.cols)) {
        block.cols.forEach((c, i) =>
          validateDimension(c, errors, `${path}.cols[${i}]`)
        );
      }
      validateMetric(block.metric, errors, `${path}.metric`);
      validateFilters(block.filters, errors, `${path}.filters`);
      if (block.limit !== undefined && (typeof block.limit !== 'number' || block.limit <= 0)) {
        errors.push(`${path}.limit: positief getal vereist`);
      }
      break;

    case 'bar':
    case 'line':
      validateDimension(block.x, errors, `${path}.x`);
      if (!Array.isArray(block.series) || block.series.length === 0) {
        errors.push(`${path}.series: vereist (niet-leeg array)`);
      } else {
        block.series.forEach((s, i) =>
          validateMetric(s, errors, `${path}.series[${i}]`)
        );
      }
      if (block.group_by !== undefined) {
        validateDimension(block.group_by, errors, `${path}.group_by`);
      }
      validateFilters(block.filters, errors, `${path}.filters`);
      break;

    case 'funnel':
      if (block.entity !== 'applications') {
        errors.push(`${path}.entity: funnel ondersteunt alleen 'applications'`);
      }
      if (!Array.isArray(block.stages) || block.stages.length < 2) {
        errors.push(`${path}.stages: minimaal 2 stages vereist`);
      } else if (!block.stages.every((s) => typeof s === 'string' && s.length > 0)) {
        errors.push(`${path}.stages: alleen niet-lege strings`);
      }
      validateFilters(block.filters, errors, `${path}.filters`);
      break;

    case 'pie':
      validateMetric(block.metric, errors, `${path}.metric`);
      validateDimension(block.group_by, errors, `${path}.group_by`);
      validateFilters(block.filters, errors, `${path}.filters`);
      if (block.limit !== undefined && (typeof block.limit !== 'number' || block.limit <= 0)) {
        errors.push(`${path}.limit: positief getal vereist`);
      }
      break;
  }
}

function validateDateRange(dr: unknown, errors: string[]): void {
  if (!isObject(dr)) {
    errors.push('date_range: vereist (object)');
    return;
  }
  switch (dr.type) {
    case 'last_n_days':
      if (typeof dr.days !== 'number' || dr.days <= 0 || dr.days > 3650) {
        errors.push('date_range.days: 1..3650 vereist');
      }
      break;
    case 'this_quarter':
    case 'last_quarter':
    case 'this_year':
    case 'last_year':
      break;
    case 'custom':
      if (typeof dr.from !== 'string' || isNaN(Date.parse(dr.from))) {
        errors.push('date_range.from: geldige ISO-datum vereist');
      }
      if (typeof dr.to !== 'string' || isNaN(Date.parse(dr.to))) {
        errors.push('date_range.to: geldige ISO-datum vereist');
      }
      break;
    default:
      errors.push(`date_range.type: onbekend "${String(dr.type)}"`);
  }
}

export function validateReportConfig(config: unknown): ValidateResult {
  const errors: string[] = [];

  if (!isObject(config)) {
    return { valid: false, errors: ['config: object vereist'] };
  }

  validateDateRange(config.date_range, errors);

  // Lege blocks-array is toegestaan: de UI maakt eerst een leeg (draft)
  // rapport aan en voegt daarna blocks toe in de builder. Een run op een
  // leeg rapport levert simpelweg nul resultaten op.
  if (!Array.isArray(config.blocks)) {
    errors.push('blocks: array vereist');
  } else if (config.blocks.length > 50) {
    errors.push('blocks: maximaal 50 blocks per rapport');
  } else {
    const seenIds = new Set<string>();
    config.blocks.forEach((b: unknown, i: number) => {
      const path = `blocks[${i}]`;
      if (!isObject(b)) {
        errors.push(`${path}: object vereist`);
        return;
      }
      if (typeof b.id !== 'string' || b.id.length === 0) {
        errors.push(`${path}.id: niet-lege string vereist`);
      } else if (seenIds.has(b.id)) {
        errors.push(`${path}.id: duplicate "${b.id}"`);
      } else {
        seenIds.add(b.id);
      }
      if (b.size !== 'sm' && b.size !== 'md' && b.size !== 'lg') {
        errors.push(`${path}.size: 'sm'|'md'|'lg' vereist`);
      }
      validateBlock(b.block, errors, `${path}.block`);
    });
  }

  validateFilters(config.filters_global, errors, 'filters_global');

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ────────────────────────────────────────────────────────────────────────────
// Date-range resolver (gebruikt door aggregator + service)
// ────────────────────────────────────────────────────────────────────────────

export function resolveDateRange(
  dr: ReportDateRange,
  now: Date = new Date()
): { from: Date; to: Date } {
  const startOfDay = (d: Date): Date =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const endOfDay = (d: Date): Date =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  switch (dr.type) {
    case 'last_n_days': {
      const to = endOfDay(now);
      const from = startOfDay(new Date(now.getTime() - dr.days * 86400000));
      return { from, to };
    }
    case 'this_quarter': {
      const q = Math.floor(now.getMonth() / 3);
      return {
        from: new Date(now.getFullYear(), q * 3, 1),
        to: endOfDay(now),
      };
    }
    case 'last_quarter': {
      const q = Math.floor(now.getMonth() / 3);
      const lastQStart = new Date(now.getFullYear(), (q - 1) * 3, 1);
      const lastQEnd = new Date(now.getFullYear(), q * 3, 0, 23, 59, 59, 999);
      return { from: lastQStart, to: lastQEnd };
    }
    case 'this_year':
      return { from: new Date(now.getFullYear(), 0, 1), to: endOfDay(now) };
    case 'last_year':
      return {
        from: new Date(now.getFullYear() - 1, 0, 1),
        to: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999),
      };
    case 'custom':
      return { from: new Date(dr.from), to: new Date(dr.to) };
  }
}
