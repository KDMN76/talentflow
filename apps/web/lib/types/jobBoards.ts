// Sprint Q4.3 — Job-board distribution.
// Types are the canonical contract between web and api/job-boards/* routes.

export type JobBoardRegion = "global" | "nl" | "de" | "eu";
export type JobBoardAuthType = "oauth2" | "api_key" | "xml_feed" | "none";
export type JobBoardIntegrationStatus = "connected" | "disconnected" | "error";
export type JobPostingStatus =
  | "queued"
  | "posted"
  | "rejected"
  | "expired"
  | "retracted"
  | "failed";

export interface JobBoardCatalogEntry {
  id: string;
  display_name: string;
  region: JobBoardRegion;
  auth_type: JobBoardAuthType;
}

export interface JobBoardIntegration {
  id: string;
  board_id: string;
  display_name: string;
  status: JobBoardIntegrationStatus;
  connected_at: string | null;
  last_polled_at: string | null;
  last_error: string | null;
  settings: Record<string, unknown>;
}

export interface JobPosting {
  id: string;
  job_id: string;
  job_title?: string;
  board_id: string;
  status: JobPostingStatus;
  external_id: string | null;
  external_url: string | null;
  cost_amount: number | null;
  cost_currency: string | null;
  applicants_count: number;
  posted_at: string | null;
  expires_at: string | null;
  retracted_at: string | null;
  last_polled_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface PostingStatusEvent {
  id: string;
  event: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface CostPerHireRow {
  board_id: string;
  postings: number;
  hires: number;
  total_cost: number;
  currency: string;
  cost_per_hire: number | null;
}
