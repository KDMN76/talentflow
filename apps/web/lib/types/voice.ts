/**
 * Sprint Q4.6 — Voice / Twilio types.
 *
 * Backend contract (Agent AAAA):
 *   GET    /api/voice/integration
 *   POST   /api/voice/integration/connect    body { account_sid, auth_token, phone_number }
 *   DELETE /api/voice/integration
 *   GET    /api/voice/calls                  ?candidate_id&direction&status&cursor
 *   GET    /api/voice/calls/:id
 *   POST   /api/voice/calls                  body { candidate_id }
 *   POST   /api/voice/calls/:id/end
 *   POST   /api/voice/calls/:id/notes        body { notes }
 *   POST   /api/voice/calls/:id/transcribe
 */

export type CallStatus =
  | "queued"
  | "ringing"
  | "in_progress"
  | "completed"
  | "busy"
  | "no_answer"
  | "failed"
  | "canceled"
  | "voicemail";

export interface VoiceIntegration {
  id: string;
  status: "connected" | "disconnected" | "error";
  phone_number: string | null;
  account_sid: string | null;
  connected_at: string | null;
  last_error: string | null;
}

export interface VoiceCall {
  id: string;
  candidate_id: string;
  candidate_name?: string;
  direction: "inbound" | "outbound";
  status: CallStatus;
  from_number: string;
  to_number: string;
  duration_seconds: number;
  recording_url: string | null;
  transcription_text: string | null;
  transcription_status: "pending" | "done" | "failed" | null;
  voicemail: boolean;
  notes: string | null;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  created_at: string;
}
