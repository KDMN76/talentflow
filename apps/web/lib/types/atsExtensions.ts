/**
 * Sprint Q1.2 ATS-extension types — frontend contract for Saved Searches,
 * Bulk Import, Dedupe, Job Templates, Custom Fields and Scorecards.
 *
 * Mirrors the contracts published by Agent Y in
 * `packages/shared/src/types/ats-extensions.ts` so the web app can compile
 * even before the shared package is published. Once the shared file lands,
 * these types are intended to be replaced by `import { ... } from "@talentflow/shared"`.
 */

// ─── Saved searches ─────────────────────────────────────────────────────────

export type SavedSearchEntityType =
  | "candidates"
  | "jobs"
  | "applications";

export interface SavedSearch {
  id: string;
  tenant_id: string;
  user_id: string;
  entity_type: SavedSearchEntityType;
  name: string;
  /** Boolean-search query string (e.g. `react AND typescript NOT junior`). */
  query: string;
  /** Optional structured filter snapshot for the UI. */
  filters?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSavedSearchInput {
  entity_type: SavedSearchEntityType;
  name: string;
  query: string;
  filters?: Record<string, unknown> | null;
}

// ─── Bulk import ────────────────────────────────────────────────────────────

export type ImportStatus =
  | "uploaded"
  | "previewed"
  | "processing"
  | "done"
  | "failed";

export interface ImportPreviewRow {
  /** 1-indexed row number from the source file. */
  row: number;
  values: Record<string, string>;
  /** Optional dedupe candidate suggestion (matched on email). */
  duplicate_of?: string | null;
}

export interface ImportPreviewResponse {
  import_id: string;
  /** Detected CSV headers in their original order. */
  headers: string[];
  /** Up to 10 sample rows. */
  rows: ImportPreviewRow[];
  total_rows: number;
  /** Suggested mapping `csv-header → candidate-field`. */
  suggested_mapping: Record<string, string>;
  duplicate_count: number;
}

export interface StartImportInput {
  import_id: string;
  /** Final mapping: `{ csv_header: candidate_field }`. Empty value = skip column. */
  mapping: Record<string, string>;
}

export interface ImportStatusResponse {
  id: string;
  status: ImportStatus;
  total_rows: number;
  processed_rows: number;
  imported_count: number;
  skipped_count: number;
  error_count: number;
  /** URL to download the error CSV when finished. */
  error_csv_url?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
}

// ─── Dedupe / merge ─────────────────────────────────────────────────────────

export type DedupeReason = "email" | "phone" | "name_email" | "fuzzy_name";

export interface DedupeMatch {
  candidate_id: string;
  matched_candidate_id: string;
  reason: DedupeReason;
  /** 0..1 confidence — typically email matches are 1.0. */
  score: number;
  matched_name: string;
  matched_email: string | null;
}

export interface MergeFieldChoice {
  field: string;
  /** "primary" keeps the value of the surviving record, "duplicate" copies it from the other. */
  source: "primary" | "duplicate";
}

export interface MergeInput {
  primary_id: string;
  duplicate_id: string;
  /** Per-field decision overrides; un-conflicted fields default to "primary". */
  choices: MergeFieldChoice[];
}

// ─── Job templates ──────────────────────────────────────────────────────────

export interface JobTemplate {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  /** Snapshotted job fields (title, department, description, requirements …). */
  job_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateJobTemplateInput {
  name: string;
  description?: string | null;
  job_data: Record<string, unknown>;
}

// ─── Custom fields ──────────────────────────────────────────────────────────

export type CustomFieldEntityType = "candidate" | "job" | "application";

export type CustomFieldType =
  | "text"
  | "number"
  | "date"
  | "dropdown"
  | "multiselect"
  | "boolean";

export interface CustomFieldDefinition {
  id: string;
  tenant_id?: string;
  entity_type?: CustomFieldEntityType;
  /** Storage key — snake_case identifier; immutable post-creation. */
  key: string;
  /** Human-readable label shown in forms. */
  label: string;
  field_type: CustomFieldType;
  /** Required for dropdown/multiselect. */
  options?: string[];
  required?: boolean;
  /** Display order — lower numbers render first. */
  position: number;
  deleted_at?: string | null;
}

export interface CreateCustomFieldInput {
  entity_type: CustomFieldEntityType;
  key: string;
  label: string;
  field_type: CustomFieldType;
  options?: string[];
  required?: boolean;
  position?: number;
}

export type CustomFieldValue = string | number | boolean | string[] | null;

// ─── Scorecards ─────────────────────────────────────────────────────────────

export type ScorecardRecommendation =
  | "strong_yes"
  | "yes"
  | "neutral"
  | "no"
  | "strong_no";

export interface ScorecardCriterion {
  key: string;
  label: string;
  description?: string | null;
  /** 1..5 — undefined when not yet rated. */
  score: number | null;
}

export interface Scorecard {
  id: string;
  tenant_id: string;
  application_id: string;
  template_id: string | null;
  /** Author. */
  user_id: string;
  user_name: string;
  /** ISO interview date or creation date. */
  interview_date: string;
  criteria: ScorecardCriterion[];
  /** 1..5 weighted average of all criteria. */
  overall_score: number;
  recommendation: ScorecardRecommendation;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScorecardInput {
  template_id?: string | null;
  criteria: Array<{ key: string; label: string; score: number | null }>;
  overall_score: number;
  recommendation: ScorecardRecommendation;
  notes?: string | null;
}

export interface ScorecardTemplate {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  /** When set, the template is automatically suggested for a specific stage. */
  job_id?: string | null;
  stage_id?: string | null;
  criteria: Array<{
    key: string;
    label: string;
    description?: string | null;
  }>;
  created_at: string;
}

// ─── Bulk actions ───────────────────────────────────────────────────────────

export type BulkActionType =
  | "archive"
  | "add_tag"
  | "remove_tag"
  | "change_source"
  | "move_to_stage";

export interface BulkActionInput {
  ids: string[];
  action: BulkActionType;
  payload?: Record<string, unknown>;
}

export interface BulkActionResult {
  affected: number;
  failed: number;
  errors?: Array<{ id: string; message: string }>;
}
