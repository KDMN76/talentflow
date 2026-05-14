/**
 * Frontend-local job-detail types.
 *
 * These mirror the contracts that Agent S is producing on the API side:
 *   GET /api/jobs/:id/team
 *   GET /api/jobs/:id/notes
 *   GET /api/jobs/:id/attachments
 *   GET /api/jobs/:id/health
 *   GET /api/jobs/:id/funnel
 *   GET /api/jobs/:id/comparable
 *   GET /api/jobs/:id/sourcing
 *   GET /api/jobs/:id/bias-check
 *
 * They will eventually be promoted to `@talentflow/shared` so both the API
 * and web app import from the same source. Until then this local copy keeps
 * the UI strictly typed and lets the mock-fallback hooks return well-shaped
 * values.
 */

// ─── Team ───────────────────────────────────────────────────────────────────

export type JobTeamRole =
  | "owner"
  | "recruiter"
  | "hiring_manager"
  | "interviewer"
  | "observer";

export interface JobTeamMember {
  id: string;
  job_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  role: JobTeamRole | string;
  added_at: string;
}

// ─── Notes ──────────────────────────────────────────────────────────────────

export interface JobNote {
  id: string;
  job_id: string;
  author_id: string;
  author_name: string;
  body: string;
  /** User ids of @-mentioned teammates. */
  mentions: string[];
  created_at: string;
}

// ─── Attachments ────────────────────────────────────────────────────────────

export interface JobAttachment {
  id: string;
  job_id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number;
  storage_url: string;
  uploaded_by_id: string;
  uploaded_by_name: string;
  created_at: string;
}

// ─── Health breakdown ───────────────────────────────────────────────────────

export interface JobHealthSubScore {
  /** Internal key — used to look up the right Dutch label client-side. */
  key: "velocity" | "drop_off" | "recency" | string;
  label: string;
  /** 0..100 — already normalised so the bar can render directly. */
  score: number;
  description: string;
}

export interface JobHealthBreakdown {
  job_id: string;
  /** 0..100 overall. */
  score: number;
  components: JobHealthSubScore[];
  /** ISO date — server-predicted close date for this job. */
  predicted_close_date: string | null;
  /** Number of days the job has been in `open` status. */
  days_open: number;
  computed_at: string;
}

// ─── Funnel ─────────────────────────────────────────────────────────────────

export interface JobFunnelStage {
  stage_id: string;
  /** Stage name (Dutch in seeded data). */
  name: string;
  /** Position (1-based). */
  position: number;
  /** Active applications currently in this stage. */
  count: number;
  /**
   * Conversion rate from this stage to the next (0..100), computed by the
   * backend. `null` for the final stage.
   */
  conversion_to_next_pct: number | null;
}

export interface JobFunnelResponse {
  job_id: string;
  stages: JobFunnelStage[];
  /** Sum of `count` across all stages. */
  total: number;
  /** Number of applications with status='hired'. */
  hired: number;
  /** Number of applications with status='rejected'. */
  dropped: number;
  computed_at: string;
}

// ─── Comparable jobs ────────────────────────────────────────────────────────

export interface ComparableJob {
  id: string;
  title: string;
  client: string | null;
  similarity_score: number; // 0..100
  filled: boolean;
  days_to_fill: number | null;
  total_candidates: number;
  closed_at: string | null;
}

// ─── Sourcing ROI ───────────────────────────────────────────────────────────

export interface JobSourcingItem {
  source: string;
  candidates: number;
  hires: number;
  /** Percent — hires / candidates * 100. */
  conversion_pct: number;
  /** Cost-per-hire in cents (EUR). 0 in mock-mode. */
  cost_per_hire_cents: number;
}

// ─── Bias check ─────────────────────────────────────────────────────────────

export type BiasFlagType =
  | "gender_coded"
  | "age_coded"
  | "vague_requirement"
  | "exclusive_language"
  | "salary_undisclosed"
  | "jargon"
  | string;

export interface BiasFlag {
  type: BiasFlagType;
  label: string;
  /** The exact substring (or paraphrase) from the JD that triggered the flag. */
  excerpt: string;
  /** Recruiter-facing suggestion for replacement. */
  suggestion: string;
  severity: "low" | "medium" | "high";
}

export interface BiasCheckResult {
  job_id: string;
  /** 0..100 — overall language clarity. */
  clarity_score: number;
  /** 0..100 — inclusivity score (higher is better). */
  inclusivity_score: number;
  flags: BiasFlag[];
  ai_disclosure: string;
  computed_at: string;
}

// ─── Manatal-parity job extras (optional fields on Job) ─────────────────────

export interface JobManatalFields {
  job_reference?: string | null;
  client?: string | null;
  client_logo_url?: string | null;
  headcount?: number | null;
  experience_level?:
    | "intern"
    | "junior"
    | "medior"
    | "senior"
    | "lead"
    | "director"
    | string
    | null;
  contract_type?:
    | "fulltime"
    | "parttime"
    | "contract"
    | "freelance"
    | "internship"
    | string
    | null;
  contract_details?: string | null;
  open_date?: string | null;
  close_date?: string | null;
  industry?: string | null;
  remote_type?: "onsite" | "hybrid" | "remote" | string | null;
  office_address?: string | null;
  package_details?: string | null;
  currency?: string | null;
  salary_frequency?:
    | "hourly"
    | "monthly"
    | "yearly"
    | string
    | null;
  owner_id?: string | null;
  owner_name?: string | null;
}
