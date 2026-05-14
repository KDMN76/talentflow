/**
 * Frontend-local types for the Talent Reactivation feature (Sprint Q3.2).
 *
 * Mirrors backend contracts owned by Agent VV:
 *   GET   /api/matching/reactivation-alerts            ?job_id=&acknowledged=
 *   POST  /api/matching/reactivation-alerts/:id/acknowledge
 *   POST  /api/matching/reactivation-alerts/:id/dismiss
 *   GET   /api/matching/reactivation-alerts/stats      → { unacknowledged, this_week }
 *
 * "Reactivation" alerts surface candidates who already exist in the recruiter's
 * database and now match a freshly opened or updated job — so the recruiter
 * can re-engage them instead of sourcing from scratch.
 */

export type ReactivationReasonType =
  /** Candidate previously rejected for a similar role but now seems a stronger fit. */
  | "rejected_similar_role"
  /** Candidate's profile updated (new skill / experience) that newly matches. */
  | "profile_updated"
  /** Long-dormant candidate (>6mo inactive) with strong match score. */
  | "dormant_strong_match"
  /** Candidate lost out narrowly on a previous round. */
  | "near_miss_previous_round"
  /** Generic "high score, never contacted" fallback. */
  | "high_score_uncontacted";

export interface ReactivationReason {
  type: ReactivationReasonType;
  /** Recruiter-facing Dutch label. */
  label: string;
  /** Optional 1-line context, e.g. "Afgewezen voor Senior FE op 4 mrt 2024". */
  detail?: string;
}

export type ReactivationAlertStatus =
  | "new"
  | "acknowledged"
  | "dismissed";

export interface TalentReactivationAlert {
  id: string;
  tenant_id: string;
  job_id: string;
  job_title: string;
  candidate_id: string;
  candidate_name: string;
  candidate_email: string | null;
  candidate_position: string | null;
  /** 0..1 raw score (consistent with JobMatch.score). */
  score: number;
  /** 0..100 — recruiter-facing percentage. */
  match_percent: number;
  /** Reason(s) the matching engine surfaced this candidate again. */
  reasons: ReactivationReason[];
  /** Snippet of AI-generated explanation for the match. */
  ai_explanation: string | null;
  status: ReactivationAlertStatus;
  /** Recruiter who acknowledged/dismissed (null while status='new'). */
  acted_by_id: string | null;
  acted_by_name: string | null;
  acted_at: string | null;
  created_at: string;
}

export interface ReactivationStats {
  /** Open / unacted alerts the recruiter still needs to review. */
  unacknowledged: number;
  /** All alerts (any status) that surfaced this calendar week. */
  this_week: number;
}

export interface ReactivationFilters {
  job_id?: string;
  /** "all" | "new" | "acknowledged" | "dismissed". */
  status?: ReactivationAlertStatus | "all";
  /** Optional inclusive lower bound on `match_percent`. */
  min_score?: number;
  /** Optional inclusive upper bound on `match_percent`. */
  max_score?: number;
}
