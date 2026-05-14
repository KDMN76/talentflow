/**
 * Job-detail (Slice 4.5) shared types.
 *
 * Mirrors the contracts exposed by:
 *  - apps/api/src/modules/jobs/jobs.service.ts          (extended Job columns)
 *  - apps/api/src/modules/jobs/jobDetail.service.ts     (team / notes / attachments / funnel / comparable / sourcing)
 *  - apps/api/src/modules/jobs/jobHealth.service.ts     (health-scores)
 *  - apps/api/src/modules/jobs/jobBiasCheck.service.ts  (JD bias-check)
 *
 * All scores are integers in `[0,100]` unless documented otherwise.
 */

// ────────────────────────────────────────────────────────────────────────────
// Enums / unions (mirror migration 007 CHECKs)
// ────────────────────────────────────────────────────────────────────────────
//
// NOTE: JobExperienceLevel, JobContractType, JobRemoteType and
// JobSalaryFrequency are declared in `./job.ts` and re-used here via import
// to avoid duplicate-export errors at the barrel.

import type {
  JobExperienceLevel,
  JobContractType,
  JobRemoteType,
  JobSalaryFrequency,
} from './job';

export type JobTeamMemberRole = 'recruiter' | 'hiring_manager' | 'observer';

// ────────────────────────────────────────────────────────────────────────────
// Job (extended) — Manatal-pariteit columns merged onto the base Job interface.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extension of `Job` (see ./job.ts) with the Manatal-pariteit fields added
 * by migration 007. Returned by GET /jobs/:id and embedded in list rows that
 * project the new columns.
 *
 * NOTE: kept as a standalone interface (instead of merging straight into
 * `Job`) so callers that only need the legacy shape can keep using `Job`,
 * while the detail page can use this richer type explicitly.
 */
export interface JobDetailExtended {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  department: string | null;
  location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  employment_type: string;
  status: string;
  recruiter_id: string | null;
  recruiter_name?: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;

  // Slice 4.5 — Manatal-pariteit
  job_reference: string | null;
  headcount: number | null;
  experience_level: JobExperienceLevel | null;
  contract_type: JobContractType | null;
  contract_details: string | null;
  open_date: string | null;
  close_date: string | null;
  industry: string | null;
  remote_type: JobRemoteType | null;
  office_address: string | null;
  package_details: string | null;
  currency: string | null;
  salary_frequency: JobSalaryFrequency | null;
  required_skills: string[] | null;
  nice_to_have_skills: string[] | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Team
// ────────────────────────────────────────────────────────────────────────────

export interface JobTeamMember {
  id: string;
  job_id: string;
  user_id: string;
  role: JobTeamMemberRole;
  added_at: string;

  /** Hydrated by GET /jobs/:id/team. */
  user_name?: string | null;
  user_email?: string | null;
  user_avatar_url?: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Notes
// ────────────────────────────────────────────────────────────────────────────

export interface JobNote {
  id: string;
  job_id: string;
  user_id: string | null;
  body: string;
  /** user_ids that were @-mentioned in `body`. */
  mentions: string[];
  created_at: string;
  updated_at: string;

  /** Hydrated by GET /jobs/:id/notes. */
  user_name?: string | null;
  user_email?: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Attachments
// ────────────────────────────────────────────────────────────────────────────

export interface JobAttachment {
  id: string;
  job_id: string;
  uploaded_by: string | null;
  filename: string;
  /** Internal storage key — not exposed to the browser; use the download endpoint. */
  storage_key: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;

  /** Hydrated by GET /jobs/:id/attachments. */
  uploaded_by_name?: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Health
// ────────────────────────────────────────────────────────────────────────────

export interface JobHealthBreakdown {
  /** Weighted aggregate, 0-100. */
  health_score: number;
  days_open: number;
  candidates_total: number;
  candidates_in_funnel: number;
  /** Velocity sub-score, 0-100. */
  velocity_score: number;
  /** Drop-off sub-score, 0-100 (higher = less drop-off). */
  drop_off_score: number;
  /** Recency sub-score, 0-100. */
  recency_score: number;
  /** ISO date or null when not extrapolable. */
  predicted_close_date: string | null;
  /** ISO timestamp the snapshot was computed. */
  computed_at: string;
  /** Weights used by the aggregator — surfaced for UI tooltips. */
  weights: { velocity: number; drop_off: number; recency: number };
}

// ────────────────────────────────────────────────────────────────────────────
// Funnel
// ────────────────────────────────────────────────────────────────────────────

export interface JobFunnelStage {
  stage_id: string;
  stage_name: string;
  position: number;
  count: number;
  /** % of candidates that made it from the previous stage. `null` for stage 1. */
  conversion_rate_from_previous: number | null;
}

export interface JobFunnelResponse {
  stages: JobFunnelStage[];
}

// ────────────────────────────────────────────────────────────────────────────
// Comparable jobs
// ────────────────────────────────────────────────────────────────────────────

export interface ComparableJob {
  job_id: string;
  title: string;
  status: string;
  candidates_total: number;
  /** Days from open_date (or created_at) to filled_at; null when not yet filled. */
  days_to_fill: number | null;
  /** Jaccard index over required_skills, 0-1 (NUMERIC in DB). */
  similarity_score: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Sourcing
// ────────────────────────────────────────────────────────────────────────────

export interface JobSourcingItem {
  source: string;
  count: number;
  /** % of `count` that ended in status='hired'. 0 when count=0. */
  conversion_to_hire: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Bias-check
// ────────────────────────────────────────────────────────────────────────────

export type BiasFlagType =
  | 'gendered_language'
  | 'age_indicator'
  | 'unrealistic_requirement'
  | 'exclusionary'
  | 'jargon';

export interface BiasFlag {
  type: BiasFlagType;
  /** The flagged phrase as it appears in the JD. */
  text: string;
  /** Dutch suggestion for replacement / improvement. */
  suggestion: string;
}

export interface BiasCheckResult {
  bias_flags: BiasFlag[];
  /** 0-100, higher = clearer. */
  clarity_score: number;
  /** 0-100, higher = more inclusive. */
  inclusivity_score: number;
  /** ISO timestamp the check was computed. */
  computed_at: string;
  /** True when served from cache (same JD-hash within row). */
  cached: boolean;
}
