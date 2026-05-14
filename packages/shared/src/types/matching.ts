/**
 * AI matching shared types — Slice 4.
 *
 * Mirrors the contracts exposed by:
 *  - `apps/api/src/modules/matching/matching.service.ts` (computed match scores)
 *  - `apps/api/src/modules/matching/matching.controller.ts` (lazy AI explanations)
 *
 * The `score` is a cosine similarity in `[0, 1]` derived from pgvector
 * embeddings of the job text and the candidate profile. `match_percent` is the
 * UI-friendly 0-100 rounding of `score * 100`.
 */

// ────────────────────────────────────────────────────────────────────────────
// Match rows (returned by getJobMatches / getCandidateMatches)
// ────────────────────────────────────────────────────────────────────────────

/**
 * One candidate-row in the "matches for this job" list. Mirror of the
 * `JobMatch` interface in `matching.service.ts`.
 *
 * Slice Q3.3 (Talent Fit Model) extends the original cosine-only contract with
 * a learned fit-score. When the tenant has an active Talent Fit model
 * (`has_active_model=true`), `combined_score` is the blended cosine + fit
 * value the UI ranks on. When the model is unavailable, `combined_score`
 * collapses to the cosine score and `fit_score` is `null`.
 */
export interface JobMatch {
  candidate_id: string;
  candidate_name: string;
  candidate_email: string | null;
  candidate_position: string | null;
  /**
   * @deprecated since Q3.3 — kept for backwards-compat with older API
   * responses. Prefer `cosine_score` (same value, clearer name) and
   * `combined_score` (the value the list is ranked on).
   */
  score?: number;
  /** Pure cosine similarity (job ↔ candidate embedding) in `[0, 1]`. */
  cosine_score: number;
  /**
   * Predicted hire-probability from the per-tenant Talent Fit model in
   * `[0, 1]`. `null` when no active model exists for the tenant or when the
   * candidate has insufficient feature coverage.
   */
  fit_score: number | null;
  /**
   * Blended ranking score in `[0, 1]`. When `has_active_model` is true this
   * is `α·fit_score + (1-α)·cosine_score`; otherwise it equals
   * `cosine_score`.
   */
  combined_score: number;
  /** Round(combined_score * 100) — recruiter-facing percentage. */
  match_percent: number;
  /**
   * Cached AI rationale (Dutch). `null` when never generated, or when the
   * cache row was invalidated.
   */
  ai_explanation: string | null;
  /**
   * Number of past hires (within the tenant) considered "similar" to this
   * candidate by the Talent Fit similarity-search. `0` when no matches are
   * found or no model is trained.
   */
  similar_hire_count: number;
  /**
   * `true` when the tenant has an active Talent Fit model that produced
   * `fit_score`. Drives UI affordances (dual-score badge, "Talent Fit Model
   * actief" header).
   */
  has_active_model: boolean;
  /** ISO-8601 timestamp the score was computed (cosine-distance). */
  computed_at: string;
}

/**
 * One job-row in the "matches for this candidate" list. Mirror of the
 * `CandidateMatch` interface in `matching.service.ts`.
 */
export interface CandidateMatch {
  job_id: string;
  job_title: string;
  job_status: string;
  /** Cosine similarity in [0, 1]. */
  score: number;
  match_percent: number;
  ai_explanation: string | null;
  computed_at: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Lazy AI explanation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Response shape for
 * `POST /api/matching/jobs/:jobId/candidates/:candidateId/explanation`.
 *
 * Explanations are cached in `match_scores.ai_explanation` for 7 days; a
 * subsequent request within the TTL returns the cached value with
 * `cached: true`. After the TTL expires, the next request re-generates.
 *
 * `ai_disclosure` is mandatory under EU AI Act art. 13 — every AI-generated
 * artifact surfaced to the recruiter must carry a transparency label.
 */
export interface MatchExplanationResponse {
  /** 2-3 line Dutch rationale produced by Claude (or the dev mock). */
  explanation: string;
  /** 2-4 strong matches expressed as skill names. */
  strengths: string[];
  /** 0-3 gaps the recruiter should verify before contacting. */
  gaps: string[];
  /** Cosine similarity in [0, 1]. Recomputed if the cache row is stale. */
  score: number;
  /** Round(score * 100). */
  match_percent: number;
  /**
   * `true` when the explanation was served from `match_scores.ai_explanation`
   * within the 7-day TTL; `false` when a fresh Claude call was made.
   */
  cached: boolean;
  /**
   * EU AI Act art. 13 transparency disclosure. Always present.
   * @see apps/api/src/lib/aiDisclosure.ts
   */
  ai_disclosure: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Talent Fit Model (Slice Q3.3)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Status payload of the active Talent Fit Model for the recruiting tenant.
 * Returned by `GET /api/matching/talent-fit/model`.
 *
 * The model is trained on historical (hired, rejected) outcomes per tenant.
 * When fewer than 20 hires *and* 20 rejects are available, no model exists
 * and `has_active_model` is `false`.
 */
export interface TalentFitModelInfo {
  /** Stable id of the latest model snapshot (uuid). `null` when none. */
  id: string | null;
  /** Total samples the model was trained on (hires + rejects). */
  trained_on: number;
  /** Number of positive samples used (hired candidates). */
  hires: number;
  /** Number of negative samples used (rejected candidates). */
  rejects: number;
  /**
   * Precision @ rank-1. Of the candidates the model ranks first per job, the
   * fraction that became hires in the held-out validation split. `[0, 1]`.
   */
  precision_at_1: number;
  /**
   * Recall @ rank-10. Of all eventual hires, the fraction that appeared in
   * the model's top-10 ranked candidates. `[0, 1]`.
   */
  recall_at_10: number;
  /** ROC-AUC on the held-out split. `[0, 1]`, 0.5 = random. */
  auc: number;
  /** ISO-8601 timestamp of the most recent training run. `null` when none. */
  trained_at: string | null;
  /**
   * Convenience flag: `id !== null && trained_on >= 40`. UI components use
   * this to gate Talent Fit affordances.
   */
  has_active_model: boolean;
  /**
   * Historical training-runs (most recent first) with their precision_at_1.
   * Used to render the line chart on the admin page. Empty array when the
   * tenant has never trained a model.
   */
  history?: TalentFitHistoryPoint[];
}

/**
 * One row in the model performance-over-time chart.
 */
export interface TalentFitHistoryPoint {
  trained_at: string;
  precision_at_1: number;
  recall_at_10: number;
  auc: number;
  trained_on: number;
}

/**
 * Per-pair Talent Fit prediction. Returned by
 * `GET /api/matching/talent-fit/predict?job_id&candidate_id`.
 *
 * Surfaced on hover/expand of the dual-score badge so the recruiter can drill
 * into *why* the model rates this candidate as it does.
 */
export interface TalentFitPrediction {
  fit_score: number;
  combined_score: number;
  cosine_score: number;
  /**
   * Top contributing features as `(name, weight)` pairs. Sorted by absolute
   * weight, descending. Names are i18n-keys mapped client-side.
   */
  features: TalentFitFeature[];
  similar_hires: SimilarHireDetail[];
}

export interface TalentFitFeature {
  name: string;
  /** Signed contribution to the fit-score. Negative = pushes against fit. */
  weight: number;
  /** Human-readable Dutch label, e.g. "Skill-overlap met eerdere hires". */
  label: string;
}

/**
 * One similar-past-hire row. Returned by
 * `GET /api/matching/candidates/:candidateId/similar-hires` and the
 * job-scoped variant.
 */
export interface SimilarHireDetail {
  candidate_id: string;
  candidate_name: string;
  candidate_position: string | null;
  job_id: string;
  job_title: string;
  /** ISO-8601 timestamp the candidate was marked as hired. */
  hired_at: string;
  /** Cosine similarity of the past hire vs. the query, `[0, 1]`. */
  cosine_to_query: number;
  /** Up to ~5 skill-names overlapping with the queried profile. */
  shared_skills: string[];
}
