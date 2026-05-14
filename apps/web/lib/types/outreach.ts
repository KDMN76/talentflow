/**
 * Sprint Q4.5 — Type contracts for outreach + nurture modules.
 *
 * Mirrors Agent XXX backend contracts under `/api/outreach/...` and
 * `/api/nurture/...`.
 */

export type OutreachChannel =
  | "linkedin_inmail"
  | "linkedin_connection"
  | "email"
  | "sms"
  | "whatsapp";
export type OutreachStatus =
  | "drafted"
  | "pending_approval"
  | "approved"
  | "sending"
  | "sent"
  | "failed"
  | "rejected_by_recruiter";
export type ReplyCategory =
  | "interested"
  | "not_now"
  | "not_interested"
  | "out_of_office"
  | "unsubscribe"
  | "spam"
  | "question"
  | "unknown";
export type SignalType =
  | "job_change"
  | "title_change"
  | "company_growth"
  | "funding_round"
  | "linkedin_post"
  | "open_to_work_flag";

export interface OutreachMessage {
  id: string;
  enrollment_id: string | null;
  step_id: string | null;
  candidate_id: string;
  candidate_name?: string;
  channel: OutreachChannel;
  direction: "outbound" | "inbound";
  status: OutreachStatus;
  subject: string | null;
  body_text: string;
  personalization_signals: Record<string, string>;
  scheduled_for: string | null;
  sent_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  reply_message_id: string | null;
  error_message: string | null;
  created_at: string;
}

export interface ReplyClassification {
  id: string;
  message_id: string;
  category: ReplyCategory;
  sentiment: "positive" | "neutral" | "negative" | "mixed";
  next_action:
    | "schedule_call"
    | "send_followup"
    | "pause_sequence"
    | "remove_from_outreach"
    | "manual_review";
  reasoning: string;
  confidence: number;
  classified_at: string;
}

export interface CandidateSignal {
  id: string;
  candidate_id: string;
  candidate_name?: string;
  signal_type: SignalType;
  detected_at: string;
  source: string;
  before_value: string | null;
  after_value: string | null;
  reviewed: boolean;
  triggered_action: string | null;
}

export interface NurtureSequence {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  total_steps: number;
  created_at: string;
}

export interface NurtureStep {
  id: string;
  sequence_id: string;
  step_order: number;
  channel: OutreachChannel;
  delay_days: number;
  ai_personalize: boolean;
  template_subject: string | null;
  template_body: string | null;
  stop_on_reply: boolean;
}

export interface NurtureEnrollment {
  id: string;
  candidate_id: string;
  candidate_name?: string;
  finding_id: string | null;
  sequence_id: string;
  sequence_name?: string;
  status:
    | "pending_approval"
    | "active"
    | "paused"
    | "stopped"
    | "completed"
    | "replied";
  current_step_order: number;
  next_send_at: string | null;
  enrolled_at: string;
  stopped_at: string | null;
  stopped_reason: string | null;
}

export interface OutreachQuota {
  recruiter_id: string;
  recruiter_name?: string;
  channel: OutreachChannel;
  daily_limit: number;
  weekly_limit: number;
  current_day_count: number;
  current_week_count: number;
}
