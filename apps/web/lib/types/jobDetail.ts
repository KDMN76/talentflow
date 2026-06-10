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

import type { JobHealth, JobHealthComponent } from "@talentflow/contracts";

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

// Health-shape komt nu uit `@talentflow/contracts` (JobHealthSchema). De lokale
// aliassen blijven bestaan zodat bestaande imports niet hoeven te wijzigen.
// Eén bron van waarheid voorkomt de eerdere API/frontend-mismatch die de
// witte-pagina-crash op `/jobs/[id]` veroorzaakte.
export type JobHealthSubScore = JobHealthComponent;
export type JobHealthBreakdown = JobHealth;

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

// `JobManatalFields` is verwijderd: het was ongebruikte dode code met fantoom-
// velden (client/client_logo_url/owner_id/owner_name — geen DB-grond) en
// enum-waarden die de DB CHECK weigert (intern/director/freelance/internship/
// yearly). De canonieke job-shape komt nu uit `@talentflow/contracts` (JobRow/
// JobDetail). Klant-/owner-velden komen pas terug met de Clients/CRM-module
// (ROADMAP Sectie 2).
