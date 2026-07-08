/**
 * Report Builder — type definitions.
 *
 * Mirrors the REAL backend contract 1:1:
 *   apps/api/src/lib/reports/configSchema.ts   (config + AggregateResult)
 *   apps/api/src/modules/reports/reports.service.ts (Report, run, embed)
 *
 * Key shape facts (do NOT drift from these):
 *   - A saved config is { date_range, blocks: ReportBlockEntry[], filters_global? }.
 *   - Each entry wraps the actual block: { id, title?, size, block: ReportBlock }.
 *   - Metrics/dimensions are OBJECTS ({ key, entity, label }), not bare keys.
 *   - Run results discriminate on `block_type` (not `type`).
 */

// ─── Entities, dimensions & metrics (catalogue) ──────────────────────────────

export type ReportEntity =
  | "candidates"
  | "jobs"
  | "applications"
  | "interviews"
  | "communications"
  | "recruiters";

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

// Aliases used by hooks/components for the /dimensions and /metrics catalogue.
export type DimensionDef = ReportDimension;
export type MetricDef = ReportMetric;

// ─── Filters ─────────────────────────────────────────────────────────────────

export type FilterOperator =
  | "equals"
  | "in"
  | "between"
  | "gt"
  | "lt"
  | "contains";

export interface ReportFilter {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

// ─── Blocks (config-side) ────────────────────────────────────────────────────

export interface KpiBlock {
  type: "kpi";
  metric: ReportMetric;
  filters?: ReportFilter[];
  comparison?: "previous_period" | "previous_year" | null;
}

export interface TableBlock {
  type: "table";
  rows: ReportDimension[];
  cols?: ReportDimension[];
  metric: ReportMetric;
  filters?: ReportFilter[];
  sort?: { key: string; direction: "asc" | "desc" };
  limit?: number;
}

export interface ChartBlock {
  type: "bar" | "line";
  x: ReportDimension;
  series: ReportMetric[];
  filters?: ReportFilter[];
  group_by?: ReportDimension;
}

export interface FunnelBlock {
  type: "funnel";
  entity: "applications";
  stages: string[];
  filters?: ReportFilter[];
}

export interface PieBlock {
  type: "pie";
  metric: ReportMetric;
  group_by: ReportDimension;
  filters?: ReportFilter[];
  limit?: number;
}

export type ReportBlock =
  | KpiBlock
  | TableBlock
  | ChartBlock
  | FunnelBlock
  | PieBlock;

export type BlockType = ReportBlock["type"];

export type BlockSize = "sm" | "md" | "lg";

/** One canvas entry: id + presentational meta + the actual block. */
export interface ReportBlockEntry {
  id: string;
  title?: string;
  description?: string;
  size: BlockSize;
  block: ReportBlock;
}

// ─── Date range ──────────────────────────────────────────────────────────────

export type ReportDateRange =
  | { type: "last_n_days"; days: number }
  | { type: "this_quarter" | "last_quarter" | "this_year" | "last_year" }
  | { type: "custom"; from: string; to: string };

// ─── Report config + saved report ────────────────────────────────────────────

export interface ReportConfig {
  date_range: ReportDateRange;
  blocks: ReportBlockEntry[];
  filters_global?: ReportFilter[];
}

export type TemplateKey =
  | "recruiter"
  | "manager"
  | "chro"
  | "source_of_hire"
  | "dei_funnel"
  | "custom";

export interface Report {
  id: string;
  tenant_id?: string;
  user_id?: string | null;
  name: string;
  description?: string | null;
  config: ReportConfig;
  template_key?: TemplateKey | null;
  is_template?: boolean;
  is_shared?: boolean;
  embed_token?: string | null;
  embed_enabled?: boolean;
  embed_expires_at?: string | null;
  schedule?: unknown | null;
  last_run_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SystemTemplate {
  key: Exclude<TemplateKey, "custom">;
  name: string;
  description: string;
  config: ReportConfig;
}

// ─── Run results (per block) — discriminated on block_type ──────────────────

export interface KpiResult {
  block_id: string;
  block_type: "kpi";
  title?: string;
  metric_label: string;
  metric_unit?: string;
  value: number | null;
  comparison_value?: number | null;
  comparison_delta_pct?: number | null;
}

export interface TableResult {
  block_id: string;
  block_type: "table";
  title?: string;
  /** Header labels in render order (row-dims, cols, metric last). */
  headers: string[];
  rows: ReadonlyArray<ReadonlyArray<string | number | null>>;
}

export interface ChartSeriesPoint {
  x: string | number;
  values: Record<string, number | null>;
}

export interface ChartResult {
  block_id: string;
  block_type: "bar" | "line";
  title?: string;
  x_label: string;
  series_labels: string[];
  points: ChartSeriesPoint[];
}

export interface FunnelStageRow {
  stage: string;
  count: number;
  /** Percentage (0–100) relative to the FIRST stage; 100 for stage 1. */
  conversion_pct: number | null;
}

export interface FunnelResult {
  block_id: string;
  block_type: "funnel";
  title?: string;
  stages: FunnelStageRow[];
}

export interface PieResult {
  block_id: string;
  block_type: "pie";
  title?: string;
  metric_label: string;
  slices: Array<{ label: string; value: number; pct: number | null }>;
}

export type BlockResult =
  | KpiResult
  | TableResult
  | ChartResult
  | FunnelResult
  | PieResult;

// ─── API responses ───────────────────────────────────────────────────────────

export interface RunReportResponse {
  blocks: BlockResult[];
  ran_at: string;
  report_run_id: string;
  cache_hit: boolean;
}

export interface EmbedTokenResponse {
  token: string;
  /** Backend API run-URL — the web app builds its own /embed/reports/:token page URL. */
  url: string;
  expires_at: string | null;
}

/** Payload of the public GET /reports/embed/:token endpoint (unwrapped). */
export interface EmbedReportData {
  report: { id: string; name: string; description: string | null };
  config: ReportConfig;
  results: BlockResult[];
  ran_at: string;
}

// ─── Labels (NL UI) ──────────────────────────────────────────────────────────

export const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  kpi: "KPI",
  table: "Tabel",
  bar: "Staafdiagram",
  line: "Lijndiagram",
  funnel: "Funnel",
  pie: "Cirkeldiagram",
};

export const BLOCK_TYPE_DESCRIPTIONS: Record<BlockType, string> = {
  kpi: "Eén groot getal met vergelijking",
  table: "Tabel met rijen, kolommen, totaal",
  bar: "Staafdiagram met meerdere series",
  line: "Lijngrafiek voor trends",
  funnel: "Conversie tussen pipeline-fases",
  pie: "Verdeling per categorie",
};

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  recruiter: "Recruiter Dashboard",
  manager: "Manager Dashboard",
  chro: "CHRO Dashboard",
  source_of_hire: "Source of Hire",
  dei_funnel: "DEI Funnel",
  custom: "Eigen rapport",
};

/**
 * Filterable fields per entity — mirror of FILTERABLE_FIELDS in the backend
 * (apps/api/src/lib/reports/configSchema.ts). The backend silently drops
 * anything not on this list, so the UI only offers these.
 */
export const FILTER_FIELD_OPTIONS: Array<{
  value: string;
  label: string;
  entity: ReportEntity;
}> = [
  { value: "source", label: "Bron (kandidaat)", entity: "candidates" },
  { value: "gender", label: "Geslacht", entity: "candidates" },
  { value: "address_country", label: "Land (kandidaat)", entity: "candidates" },
  { value: "industry", label: "Branche", entity: "candidates" },
  {
    value: "years_of_experience",
    label: "Jaren ervaring",
    entity: "candidates",
  },
  { value: "status", label: "Status", entity: "jobs" },
  { value: "department", label: "Afdeling", entity: "jobs" },
  { value: "location", label: "Locatie", entity: "jobs" },
  { value: "employment_type", label: "Dienstverband", entity: "jobs" },
  { value: "stage_id", label: "Pipeline-stap (ID)", entity: "applications" },
  { value: "job_id", label: "Vacature (ID)", entity: "applications" },
];
