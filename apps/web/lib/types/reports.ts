/**
 * Report Builder — type definitions.
 *
 * Mirrors the contract delivered by Agent EEE (backend) for Sprint Q3.5.
 * Every block has a `type` discriminator + a typed `config` object.
 *
 * Block types: kpi | table | bar | line | funnel | pie
 */

// ─── Dimensions & metrics (catalogue) ────────────────────────────────────────

export type DimensionKey =
  | "stage"
  | "source"
  | "recruiter"
  | "department"
  | "job"
  | "location"
  | "month"
  | "week"
  | "day"
  | "rejection_reason"
  | "tag";

export type MetricKey =
  | "applications_count"
  | "candidates_count"
  | "hires_count"
  | "interviews_count"
  | "offers_count"
  | "rejections_count"
  | "avg_time_to_hire_days"
  | "avg_time_in_stage_days"
  | "conversion_rate"
  | "open_jobs_count";

export interface DimensionDef {
  key: DimensionKey;
  label: string;
  description?: string;
}

export interface MetricDef {
  key: MetricKey;
  label: string;
  unit?: "count" | "percentage" | "days";
  description?: string;
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "nin"
  | "contains";

export interface ReportFilter {
  field: string;
  operator: FilterOperator;
  value: string | number | string[] | number[] | null;
}

// ─── Block-type config shapes ────────────────────────────────────────────────

export interface KpiBlockConfig {
  metric: MetricKey;
  label?: string;
  comparison?: "previous_period" | "previous_year" | "none";
  filters?: ReportFilter[];
}

export interface TableBlockConfig {
  rows: DimensionKey[];
  cols?: DimensionKey[];
  metric: MetricKey;
  sort_by?: "metric_desc" | "metric_asc" | "label_asc";
  show_totals?: boolean;
  filters?: ReportFilter[];
}

export interface BarBlockConfig {
  x: DimensionKey;
  series: MetricKey[];
  group_by?: DimensionKey;
  stacked?: boolean;
  filters?: ReportFilter[];
}

export interface LineBlockConfig {
  x: DimensionKey;
  series: MetricKey[];
  group_by?: DimensionKey;
  filters?: ReportFilter[];
}

export interface FunnelBlockConfig {
  stages: string[]; // pipeline stage IDs (or names)
  metric?: MetricKey; // defaults to candidates_count
  filters?: ReportFilter[];
}

export interface PieBlockConfig {
  metric: MetricKey;
  group_by: DimensionKey;
  limit?: number;
  filters?: ReportFilter[];
}

export type BlockConfig =
  | KpiBlockConfig
  | TableBlockConfig
  | BarBlockConfig
  | LineBlockConfig
  | FunnelBlockConfig
  | PieBlockConfig;

export type BlockType = "kpi" | "table" | "bar" | "line" | "funnel" | "pie";

// ─── Block (config-side, not run-result) ─────────────────────────────────────

export interface ReportBlock<T extends BlockConfig = BlockConfig> {
  id: string;
  type: BlockType;
  title?: string;
  config: T;
}

// ─── Report config ───────────────────────────────────────────────────────────

export type DateRangePreset =
  | "last_7_days"
  | "last_30_days"
  | "this_quarter"
  | "this_year"
  | "custom";

export interface ReportDateRange {
  preset: DateRangePreset;
  /** ISO string; only used when preset = "custom". */
  from?: string;
  /** ISO string; only used when preset = "custom". */
  to?: string;
}

export interface ReportConfig {
  blocks: ReportBlock[];
  date_range: ReportDateRange;
  filters?: ReportFilter[]; // global filters applied to every block
}

// ─── Report (saved) ──────────────────────────────────────────────────────────

export type SystemTemplateKey =
  | "executive_summary"
  | "recruiter_performance"
  | "pipeline_health"
  | "diversity_inclusion"
  | "source_efficiency";

export interface Report {
  id: string;
  tenant_id?: string;
  name: string;
  description?: string;
  config: ReportConfig;
  template_key?: SystemTemplateKey | null;
  is_template?: boolean;
  is_shared?: boolean;
  embed_token?: string | null;
  embed_enabled?: boolean;
  last_run_at?: string | null;
  created_at: string;
  updated_at: string;
  created_by?: string;
  created_by_name?: string;
}

export interface SystemTemplate {
  key: SystemTemplateKey;
  name: string;
  description: string;
  config: ReportConfig;
}

// ─── Run result (per block) ──────────────────────────────────────────────────

export interface KpiResult {
  block_id: string;
  type: "kpi";
  value: number;
  label?: string;
  comparison_value?: number | null;
  change_percentage?: number | null;
  unit?: "count" | "percentage" | "days";
}

export interface TableResultRow {
  /** Row group dimension(s). */
  group: Record<string, string>;
  /** Column dimension → metric value. Empty key means "no col-grouping". */
  values: Record<string, number>;
  /** Optional row-total. */
  total?: number;
}

export interface TableResult {
  block_id: string;
  type: "table";
  columns: string[];
  rows: TableResultRow[];
  total?: Record<string, number>;
}

export interface BarLineResult {
  block_id: string;
  type: "bar" | "line";
  /** One row per x-axis value. */
  data: Array<Record<string, number | string>>;
  /** Series keys (each is a metric). */
  series: string[];
  /** x-axis dataKey. */
  x_key: string;
}

export interface FunnelResultStage {
  name: string;
  count: number;
  /** Conversion from previous stage (0–1). null for first stage. */
  conversion: number | null;
}

export interface FunnelResult {
  block_id: string;
  type: "funnel";
  stages: FunnelResultStage[];
  overall_conversion: number;
}

export interface PieSlice {
  name: string;
  value: number;
  percentage: number;
}

export interface PieResult {
  block_id: string;
  type: "pie";
  slices: PieSlice[];
  total: number;
}

export type BlockResult =
  | KpiResult
  | TableResult
  | BarLineResult
  | FunnelResult
  | PieResult;

export interface RunReportResponse {
  blocks: BlockResult[];
  ran_at: string;
}

export interface EmbedTokenResponse {
  token: string;
  url: string;
}

// ─── Catalogue ───────────────────────────────────────────────────────────────

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

export const TEMPLATE_LABELS: Record<SystemTemplateKey, string> = {
  executive_summary: "Executive samenvatting",
  recruiter_performance: "Recruiter prestaties",
  pipeline_health: "Pipeline gezondheid",
  diversity_inclusion: "Diversiteit & inclusie",
  source_efficiency: "Bron-efficiëntie",
};
