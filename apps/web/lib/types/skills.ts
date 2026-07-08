/**
 * Skills Graph + Pay Transparency + DEI types (Q3.6).
 *
 * These shapes mirror the backend contracts from agents HHH (skills) and III
 * (compliance / pay transparency) so the frontend can target them directly
 * with safe optional-chaining and graceful mock-data fallback.
 */

// ─── ESCO skill catalogue ────────────────────────────────────────────────────

export type EscoCategory =
  | "technical"
  | "soft"
  | "language"
  | "certification"
  | "domain"
  | "tool";

export interface EscoSkill {
  id: string;
  esco_uri: string;
  preferred_label: string;
  alt_labels: string[];
  description: string | null;
  category: EscoCategory;
  /** Number of candidates in the tenant that match this skill. */
  candidate_count?: number;
}

// ─── Candidate / job skill profile ───────────────────────────────────────────

export type SkillSource =
  | "ai_extracted"
  | "manual"
  | "esco_match"
  | "embedding_match";

export interface ProfileSkill {
  id: string;
  esco_id: string | null;
  esco_uri: string | null;
  preferred_label: string;
  category: EscoCategory;
  proficiency: number; // 1-10
  source: SkillSource;
  /** 0..1 — embedding similarity. 1.0 means exact match. */
  confidence: number;
}

export interface CandidateSkillProfile {
  candidate_id: string;
  skills: ProfileSkill[];
  last_synced_at: string | null;
}

export type JobSkillRequirementLevel = "required" | "nice_to_have";

export interface JobSkillRequirement extends ProfileSkill {
  requirement: JobSkillRequirementLevel;
  min_proficiency: number;
}

export interface JobSkillProfile {
  job_id: string;
  skills: JobSkillRequirement[];
  last_synced_at: string | null;
}

// ─── Skills-gap analysis ─────────────────────────────────────────────────────

export type SkillsGapRecommendation =
  | "strong_fit"
  | "good_fit"
  | "partial_fit"
  | "weak_fit";

export interface SkillsGapMatch {
  esco_id: string;
  preferred_label: string;
  category: EscoCategory;
  required_proficiency: number;
  candidate_proficiency: number | null;
  /** True when candidate has the skill at or above required proficiency. */
  has_match: boolean;
}

export interface SkillsGapAnalysis {
  job_id: string;
  candidate_id: string;
  /** 0..100 — overall match score across all required skills. */
  match_percentage: number;
  recommendation: SkillsGapRecommendation;
  required: SkillsGapMatch[];
  nice_to_have: SkillsGapMatch[];
  /** Skills the candidate has that are not on the requirement list. */
  bonus_skills: ProfileSkill[];
  computed_at: string;
}

// ─── Trending + demand/supply ────────────────────────────────────────────────

export interface TrendingSkillPoint {
  week_start: string;
  demand: number;
  supply: number;
}

export interface TrendingSkill {
  esco_id: string;
  preferred_label: string;
  category: EscoCategory;
  /** % growth in demand over the analysis window. */
  growth_pct: number;
  current_demand: number;
  current_supply: number;
  series: TrendingSkillPoint[];
}

export interface DemandSupplyBucket {
  category: EscoCategory;
  demand: number;
  supply: number;
  /** demand - supply; positive = shortage. */
  gap: number;
}

export interface DemandSupplyResponse {
  per_category: DemandSupplyBucket[];
  computed_at: string;
}

// ─── Pay Transparency settings ───────────────────────────────────────────────

export type SalaryFrequency = "monthly" | "annual" | "hourly";

/**
 * 1-op-1 met de API-shape van GET/PATCH /compliance/pay-settings
 * (apps/api payTransparency.service.ts). De eerdere frontend-benamingen
 * (enforce_salary_range e.d.) bestonden nooit backend-side — de settings-
 * pagina schreef daardoor no-op-patches.
 */
export interface TenantPaySettings {
  tenant_id: string;
  pay_transparency_enforced: boolean;
  prohibit_current_salary_questions: boolean;
  reporting_threshold: number;
  default_currency: string;
  default_salary_frequency: SalaryFrequency;
  benchmark_data_consent: boolean;
  updated_at: string;
  created_at: string;
}

// ─── Pay Transparency rapport (EU 2023/970 art. 5) ───────────────────────────

export type PayTransparencyMissingField =
  | "salary_min"
  | "salary_max"
  | "salary_frequency";

export interface PayTransparencyActionItem {
  id: string;
  title: string;
  job_reference: string | null;
  created_at: string;
  pay_transparency_required: boolean;
  missing: PayTransparencyMissingField[];
}

export interface PayTransparencyReport {
  generated_at: string;
  enforced: boolean;
  default_salary_frequency: SalaryFrequency;
  totals: {
    open: number;
    open_with_band: number;
    open_without_band: number;
    open_without_frequency: number;
    draft: number;
    draft_with_band: number;
    /** % open vacatures met volledige salarisband; 100 bij 0 open vacatures. */
    pct_open_with_band: number;
  };
  action_list: PayTransparencyActionItem[];
}

// ─── Pay Equity report ───────────────────────────────────────────────────────

export interface PayBucket {
  group_label: string;
  /** Number of employees / records in the group. May be 0 when k-anonymity hides. */
  count: number;
  median_salary: number | null;
  /** True when the group is below k-anonymity threshold (default k=5). */
  suppressed: boolean;
}

export interface PayEquityReport {
  tenant_id: string;
  from: string;
  to: string;
  job_category: string | null;
  total_records: number;
  /** Overall raw pay-gap percentage (women vs men, 0..100). */
  pay_gap_pct: number;
  /** Adjusted pay-gap, controlling for role/seniority. */
  adjusted_pay_gap_pct: number;
  by_gender: PayBucket[];
  by_age_bracket: PayBucket[];
  by_nationality: PayBucket[];
  k_anonymity_threshold: number;
  computed_at: string;
}

export interface PayEquitySnapshot {
  id: string;
  from: string;
  to: string;
  pay_gap_pct: number;
  computed_at: string;
}

// ─── DEI funnel ──────────────────────────────────────────────────────────────

export interface DeiStageBreakdown {
  gender: { label: string; count: number; pct: number; suppressed: boolean }[];
  age_bracket: { label: string; count: number; pct: number; suppressed: boolean }[];
  nationality: { label: string; count: number; pct: number; suppressed: boolean }[];
}

export type DeiBiasLevel = "low" | "medium" | "high";

export interface DeiFunnelStage {
  stage_id: string;
  stage_name: string;
  total: number;
  /** % of total that progressed from the previous stage. */
  conversion_pct: number | null;
  bias_score: number;
  bias_level: DeiBiasLevel;
  breakdown: DeiStageBreakdown;
}

export interface DeiAlert {
  stage_id: string;
  stage_name: string;
  message: string;
  severity: "info" | "warning" | "critical";
}

export interface DEIFunnelReport {
  tenant_id: string;
  from: string;
  to: string;
  stages: DeiFunnelStage[];
  alerts: DeiAlert[];
  k_anonymity_threshold: number;
  computed_at: string;
}

export interface DEIFunnelSnapshot {
  id: string;
  from: string;
  to: string;
  total_alerts: number;
  computed_at: string;
}
