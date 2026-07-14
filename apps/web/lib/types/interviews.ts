/**
 * Frontend-local interview types — Sprint Q3.4 (AI Interview Suite).
 *
 * Mirrors the backend contracts owned by Agents BBB + CCC:
 *
 *   GET    /api/interviews                 ?from&to&candidate_id&interviewer_id&status
 *   POST   /api/interviews                  body: ScheduleInterviewInput
 *   GET    /api/interviews/:id              → Interview met participants + kit
 *   PATCH  /api/interviews/:id
 *   DELETE /api/interviews/:id
 *   POST   /api/interviews/availability/slots         body: { interviewer_ids, from, to, duration_minutes, timezone? }
 *   GET    /api/interviews/availability/:userId
 *   PUT    /api/interviews/availability/:userId       body: { recurring_hours[] }
 *   POST   /api/interviews/availability/:userId/override
 *
 *   GET    /api/interview-kits                        ?job_id=
 *   POST   /api/interview-kits
 *   GET    /api/interview-kits/:id
 *   PATCH  /api/interview-kits/:id
 *   DELETE /api/interview-kits/:id
 *
 *   POST   /api/interviews/:id/recordings              multipart 'audio' + consent
 *   GET    /api/interviews/:id/recordings
 *   GET    /api/interviews/recordings/:recId/transcript
 *
 *   GET    /api/applications/:id/agreement-matrix      → AgreementMatrix
 *
 * These will eventually be promoted to `@talentflow/shared`.
 */

// ─── Interview ──────────────────────────────────────────────────────────────

export type InterviewStatus =
  | "scheduled"
  | "completed"
  | "cancelled"
  | "no_show"
  | "rescheduled";

export type InterviewLocationType =
  | "google_meet"
  | "teams"
  | "zoom"
  | "in_person"
  | "phone";

export type InterviewParticipantRole =
  | "interviewer"
  | "candidate"
  | "observer"
  | "hiring_manager";

/** Backend `interview_participants.participant_type` (GET /interviews/:id). */
export type InterviewParticipantType = "candidate" | "interviewer" | "observer";

export interface InterviewParticipant {
  id: string;
  /** Backend: null for the candidate row (candidate_id is set instead). */
  user_id?: string | null;
  // ── Backend shape (GET /interviews/:id → participants[]) ──
  participant_type?: InterviewParticipantType;
  candidate_id?: string | null;
  email?: string;
  attended?: boolean | null;
  attendance_logged_at?: string | null;
  // ── Legacy/mock fields (kept for mockData compatibility) ──
  user_name?: string;
  user_email?: string;
  role?: InterviewParticipantRole;
  /** Whether the participant has accepted (for ICS / calendar status). */
  rsvp?: "pending" | "accepted" | "declined" | null;
}

export interface Interview {
  id: string;
  tenant_id: string;
  application_id: string;
  /** Joined from candidates — may be null when the candidate was removed. */
  candidate_name: string | null;
  /** Joined from jobs — may be null. */
  job_title: string | null;
  /** ISO datetime of the start. */
  scheduled_start: string;
  /** ISO datetime of the end. */
  scheduled_end: string;
  duration_minutes: number;
  status: InterviewStatus;
  /** Computed by the backend (meeting_provider or "in_person"). */
  location_type: InterviewLocationType | null;
  participants: InterviewParticipant[];
  /** Free-form recruiter notes added during scheduling. */
  notes: string | null;
  created_at: string;
  updated_at: string;

  // ── Backend shape (GET /interviews/:id) ──
  stage_id?: string | null;
  meeting_provider?: InterviewLocationType | null;
  /** Auto-generated or manually entered meeting link. */
  meeting_url?: string | null;
  /** Free-text location/address (in-person) or phone number. */
  location?: string | null;
  interview_kit_id?: string | null;
  /** Nested kit summary returned by GET /interviews/:id. */
  kit?: { id: string; name: string } | null;
  created_by?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;

  // ── Legacy/mock fields (kept for mockData compatibility) ──
  candidate_id?: string;
  job_id?: string;
  timezone?: string;
  location_url?: string | null;
  location_address?: string | null;
  kit_id?: string | null;
  kit_name?: string | null;
  has_recording?: boolean;
  scorecard_count?: number;
  created_by_id?: string;
  created_by_name?: string;
}

/** Mirrors the backend `scheduleInterviewSchema` exactly (POST /interviews). */
export interface ScheduleInterviewInput {
  application_id: string;
  scheduled_start: string;
  scheduled_end: string;
  interviewer_user_ids: string[];
  observer_user_ids?: string[];
  meeting_provider?: InterviewLocationType;
  location?: string;
  meeting_url?: string;
  interview_kit_id?: string;
  notes?: string;
  stage_id?: string | null;
}

export interface InterviewFilters {
  from?: string;
  to?: string;
  candidate_id?: string;
  interviewer_id?: string;
  status?: InterviewStatus | "all";
}

// ─── Availability ───────────────────────────────────────────────────────────

export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface RecurringHours {
  /** ISO weekday — `monday`..`sunday`. */
  weekday: Weekday;
  /** "HH:MM" 24-hour. */
  start: string;
  /** "HH:MM" 24-hour, exclusive. */
  end: string;
}

export interface AvailabilityOverride {
  /** ISO date `YYYY-MM-DD` — start of the period (van). */
  date: string;
  /** ISO date `YYYY-MM-DD` — inclusive end of the period (t/m). Equals `date` for a single day. */
  date_end?: string;
  /** When false, the entire period is blocked. */
  available: boolean;
  reason?: string | null;
  /** Optional alternative hours that replace the recurring weekly schedule. */
  hours?: Array<{ start: string; end: string }>;
}

export interface UserAvailability {
  user_id: string;
  user_name: string;
  timezone: string;
  recurring_hours: RecurringHours[];
  overrides: AvailabilityOverride[];
}

export interface AvailableSlot {
  /** ISO datetime of the slot start. */
  start: string;
  /** ISO datetime of the slot end. */
  end: string;
  duration_minutes: number;
  /** Subset of the requested interviewer ids that are free for this slot. */
  available_interviewer_ids: string[];
}

export interface AvailableSlotsRequest {
  interviewer_ids: string[];
  /** ISO date or datetime. */
  from: string;
  to: string;
  duration_minutes: 30 | 45 | 60 | 90;
  timezone?: string;
}

// ─── Interview kits ─────────────────────────────────────────────────────────

export type InterviewQuestionCategory =
  | "behavioral"
  | "technical"
  | "culture"
  | "experience"
  | "scenario";

export interface InterviewQuestion {
  id: string;
  text: string;
  category: InterviewQuestionCategory;
  suggested_followups: string[];
  evaluation_criteria: string | null;
  /** Suggested duration in minutes — drives the agenda generator. */
  expected_duration_minutes: number;
  position: number;
}

export interface InterviewKit {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  /** When set the kit is auto-suggested in the scheduler for this job. */
  job_id: string | null;
  job_title?: string | null;
  scorecard_template_id: string | null;
  scorecard_template_name?: string | null;
  questions: InterviewQuestion[];
  created_at: string;
  updated_at: string;
}

export interface CreateInterviewKitInput {
  name: string;
  description?: string | null;
  job_id?: string | null;
  scorecard_template_id?: string | null;
  questions: Array<Omit<InterviewQuestion, "id" | "position"> & { id?: string }>;
}

// ─── Recordings & transcripts ───────────────────────────────────────────────

export type TranscriptStatus =
  | "pending"
  | "processing"
  | "done"
  | "failed"
  | "skipped";

export type AIRecommendation =
  | "strong_yes"
  | "yes"
  | "neutral"
  | "no"
  | "strong_no";

export interface TranscriptUtterance {
  /** Speaker label assigned by the diarization step ("Interviewer", "Candidate"…). */
  speaker: string;
  /** Optional user_id resolved from voice fingerprinting. */
  speaker_user_id?: string | null;
  /** Seconds from the start of the recording. */
  start_seconds: number;
  end_seconds: number;
  text: string;
}

export interface InterviewTranscript {
  /** Transcription status (audio → text). */
  status: TranscriptStatus;
  /** Detected language (ISO 639-1). */
  language?: string | null;
  // ── Backend shape (GET /interviews/recordings/:id/transcript) ──
  /** Combined plain-text transcript when `status === "done"`. */
  text?: string | null;
  /** AI-generated summary (1-2 paragraphs). */
  summary?: string | null;
  strengths?: string[] | null;
  concerns?: string[] | null;
  recommendation?: AIRecommendation | null;
  /** AI-summary pipeline status (separate from transcription). */
  ai_status?: TranscriptStatus | null;
  // ── Legacy/mock fields (kept for mockData compatibility) ──
  recording_id?: string;
  full_text?: string | null;
  utterances?: TranscriptUtterance[];
  ai_summary?: string | null;
  ai_strengths?: string[];
  ai_concerns?: string[];
  ai_recommendation?: AIRecommendation | null;
  finished_at?: string | null;
}

export interface InterviewRecording {
  id: string;
  interview_id: string;
  filename: string;
  size_bytes: number | null;
  duration_seconds: number | null;
  /** Always true — backend rejects uploads without this flag. */
  consent_given: boolean;
  // ── Backend shape (GET /interviews/:id/recordings) ──
  mime_type?: string | null;
  transcript_language?: string | null;
  transcription_status?: TranscriptStatus;
  consent_at?: string | null;
  uploaded_by?: string | null;
  uploaded_at?: string;
  // ── Legacy/mock fields (kept for mockData compatibility) ──
  storage_url?: string;
  consent_given_at?: string;
  consent_given_by_id?: string;
  uploaded_by_id?: string;
  uploaded_by_name?: string;
  transcript_status?: TranscriptStatus;
  created_at?: string;
}

export interface UploadRecordingInput {
  file: File;
  consent_given: boolean;
}

// ─── Agreement matrix ───────────────────────────────────────────────────────

export type ConsensusLevel = "strong" | "moderate" | "low";

export interface AgreementMatrixCell {
  /** Score on the 1..5 scale, or null when the interviewer hasn't filled it in. */
  score: number | null;
  /** Marked true when this cell deviates ≥2 points from the row average. */
  outlier: boolean;
}

export interface AgreementMatrixRow {
  criterion_key: string;
  criterion_label: string;
  /** Cells in the same order as `interviewers`. */
  cells: AgreementMatrixCell[];
  /** Average across the filled-in cells. */
  average: number;
  /** Max - min over the filled-in cells. */
  range: number;
  consensus: ConsensusLevel;
}

export interface AgreementMatrixInterviewer {
  user_id: string;
  user_name: string;
  /** Mean score this interviewer gave across all criteria. */
  mean: number;
  /** Standard deviation of scores from the row averages — flags consistent over/under-scorers. */
  std_dev: number;
  /** True when at least one of this interviewer's cells is an outlier. */
  is_outlier: boolean;
  scorecard_id?: string | null;
}

export interface AgreementMatrix {
  application_id: string;
  candidate_id: string;
  candidate_name: string;
  job_id: string;
  job_title: string;
  interviewers: AgreementMatrixInterviewer[];
  rows: AgreementMatrixRow[];
  /** Largest range across all rows — used by the UI to highlight the most divisive criterion. */
  highest_range_criterion: string | null;
  /** Aggregate consensus across the entire scorecard. */
  overall_consensus: ConsensusLevel;
}
