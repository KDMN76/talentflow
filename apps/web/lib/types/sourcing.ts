/**
 * Sprint Q4.5 — Type contracts for the agentic AI sourcing module.
 *
 * Frontend mirrors the shapes returned by Agent WWW's REST endpoints under
 * `/api/sourcing/...`. Treated verbatim per the sprint brief.
 */

export type AgentRunStatus =
  | "queued"
  | "running"
  | "review_required"
  | "completed"
  | "failed"
  | "cancelled";
export type AgentRunTrigger =
  | "manual"
  | "scheduled"
  | "reactivation"
  | "expansion";
export type FindingStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "contacted"
  | "dismissed";

export interface AgentBrief {
  id: string;
  job_id: string;
  brief_text: string;
  must_have: string[];
  nice_to_have: string[];
  exclusions: string[];
  target_count: number;
  search_locations: string[];
  language_preferences: string[];
  active: boolean;
  created_at: string;
}

export interface AgentRun {
  id: string;
  brief_id: string;
  status: AgentRunStatus;
  trigger: AgentRunTrigger;
  started_at: string | null;
  finished_at: string | null;
  candidates_found: number;
  candidates_approved: number;
  candidates_rejected: number;
  expansion_iteration: number;
  current_query: Record<string, unknown> | null;
  reasoning_log: { ts: string; step: string; reason: string }[];
  error_message: string | null;
  created_at: string;
}

export interface AgentFinding {
  id: string;
  run_id: string;
  brief_id: string;
  candidate_id: string | null;
  external_source: string;
  external_url: string | null;
  external_id: string | null;
  full_name: string;
  current_title: string | null;
  current_company: string | null;
  location: string | null;
  headline: string | null;
  summary: string | null;
  skills: string[];
  languages: string[];
  match_score: number;
  match_reasoning: string;
  status: FindingStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
}

export interface AgentAction {
  id: string;
  run_id: string;
  finding_id: string | null;
  action: string;
  payload: Record<string, unknown>;
  reasoning: string;
  ai_model: string | null;
  cost_usd: number | null;
  requires_approval: boolean;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}
