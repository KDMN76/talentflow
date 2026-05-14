/**
 * Shared types voor Sprint Q1.2 — ATS-completering.
 *
 * Spiegelt het schema uit migratie 009_ats_completion.sql + de service-input
 * shapes uit:
 *   - apps/api/src/modules/saved-searches
 *   - apps/api/src/modules/jobs/jobTemplates.service
 *   - apps/api/src/modules/custom-fields
 *   - apps/api/src/modules/scorecards
 *   - apps/api/src/modules/candidates/dedupe.service
 *   - apps/api/src/modules/candidates/bulkImport.service
 */

// ────────────────────────────────────────────────────────────────────────────
// Saved searches
// ────────────────────────────────────────────────────────────────────────────

export type SavedSearchEntity = 'candidates' | 'jobs';

export interface SavedSearch {
  id: string;
  tenant_id: string;
  user_id: string;
  name: string;
  query_text: string;
  filters: Record<string, unknown>;
  entity_type: SavedSearchEntity;
  created_at: string;
  updated_at: string;
}

export interface CreateSavedSearchInput {
  name: string;
  query_text: string;
  filters?: Record<string, unknown>;
  entity_type: SavedSearchEntity;
}

// ────────────────────────────────────────────────────────────────────────────
// Job templates
// ────────────────────────────────────────────────────────────────────────────

export interface JobTemplate {
  id: string;
  tenant_id: string | null;
  name: string;
  description: string | null;
  job_data: Record<string, unknown>;
  is_system: boolean;
  created_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateJobTemplateInput {
  name: string;
  description?: string;
  job_data: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────────────
// Custom fields
// ────────────────────────────────────────────────────────────────────────────

export type CustomFieldEntity = 'candidate' | 'job' | 'application';

export type CustomFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'dropdown'
  | 'multiselect'
  | 'boolean';

export interface CustomFieldDefinition {
  id: string;
  tenant_id: string;
  entity_type: CustomFieldEntity;
  key: string;
  label: string;
  field_type: CustomFieldType;
  /** Voor dropdown/multiselect: array van { value, label } pairs. */
  options: Array<{ value: string; label: string }>;
  required: boolean;
  position: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCustomFieldDefinitionInput {
  entity_type: CustomFieldEntity;
  key: string;
  label: string;
  field_type: CustomFieldType;
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  position?: number;
}

export type UpdateCustomFieldDefinitionInput = Partial<
  Omit<CreateCustomFieldDefinitionInput, 'entity_type' | 'key'>
>;

export interface CustomFieldValue {
  id: string;
  tenant_id: string;
  definition_id: string;
  entity_type: CustomFieldEntity;
  entity_id: string;
  value: unknown;
  created_at: string;
  updated_at: string;
}

export interface CustomFieldValidationError {
  key: string;
  message: string;
}

export interface CustomFieldValidationResult {
  valid: boolean;
  errors: CustomFieldValidationError[];
}

// ────────────────────────────────────────────────────────────────────────────
// Scorecards
// ────────────────────────────────────────────────────────────────────────────

export type ScorecardRecommendation =
  | 'strong_yes'
  | 'yes'
  | 'neutral'
  | 'no'
  | 'strong_no';

export interface ScorecardCriterionScore {
  criterion: string;
  score: number;
  comment?: string;
}

export interface Scorecard {
  id: string;
  tenant_id: string;
  application_id: string;
  stage_id: string | null;
  interviewer_id: string;
  overall_score: number | null;
  recommendation: ScorecardRecommendation | null;
  notes: string | null;
  criteria_scores: ScorecardCriterionScore[];
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScorecardCriterionDefinition {
  key: string;
  label: string;
  description?: string;
  weight?: number;
}

export interface ScorecardTemplate {
  id: string;
  tenant_id: string;
  name: string;
  criteria: ScorecardCriterionDefinition[];
  applies_to_job_id: string | null;
  applies_to_stage_id: string | null;
  is_default: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateScorecardInput {
  overall_score?: number;
  recommendation?: ScorecardRecommendation;
  notes?: string;
  criteria_scores?: ScorecardCriterionScore[];
  /** Wanneer gezet → submitted_at = now(); anders draft. */
  submit?: boolean;
}

export interface CreateScorecardTemplateInput {
  name: string;
  criteria: ScorecardCriterionDefinition[];
  applies_to_job_id?: string | null;
  applies_to_stage_id?: string | null;
  is_default?: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Bulk actions
// ────────────────────────────────────────────────────────────────────────────

export type BulkActionType =
  | 'archive'
  | 'add_tag'
  | 'remove_tag'
  | 'change_source';

export interface BulkActionInput {
  ids: string[];
  action: BulkActionType;
  payload?: Record<string, unknown>;
}

export interface BulkActionResult {
  affected: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Dedupe
// ────────────────────────────────────────────────────────────────────────────

export type DedupeMatchReason = 'email' | 'phone' | 'name+company';

export interface DedupeMatch {
  candidate_id: string;
  candidate_name: string;
  match_reason: DedupeMatchReason;
  /** 0 - 1 (1 = exact-email match). */
  confidence: number;
}

export interface MergeInput {
  primary_id: string;
  duplicate_ids: string[];
  field_choices: Record<string, 'primary' | 'duplicate'>;
}

export interface MergeResult {
  merged_into: string;
  merged_count: number;
}

// ────────────────────────────────────────────────────────────────────────────
// CSV import
// ────────────────────────────────────────────────────────────────────────────

export type CsvImportStatus =
  | 'pending'
  | 'parsing'
  | 'importing'
  | 'done'
  | 'failed';

export interface CsvImportError {
  row_idx: number;
  message: string;
}

export interface CsvImport {
  id: string;
  tenant_id: string;
  user_id: string;
  entity_type: 'candidate' | 'job';
  filename: string;
  total_rows: number;
  processed_rows: number;
  imported_count: number;
  skipped_count: number;
  error_count: number;
  status: CsvImportStatus;
  errors: CsvImportError[];
  mapping: Record<string, string>;
  storage_key: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface CsvImportPreview {
  total_rows: number;
  /** First 10 parsed rows as raw column→value records. */
  sample: Array<Record<string, string>>;
  detected_columns: string[];
  /** CSV column name → candidate field name (best-effort heuristic). */
  suggested_mapping: Record<string, string>;
  duplicates_predicted: number;
}
