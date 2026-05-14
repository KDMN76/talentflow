/**
 * Sprint Q4.6 — WhatsApp Business API types.
 *
 * Backend contract (Agent ZZZ):
 *   GET    /api/whatsapp/integration
 *   POST   /api/whatsapp/integration/connect body { phone_number, api_key, waba_id, display_name? }
 *   DELETE /api/whatsapp/integration
 *   POST   /api/whatsapp/integration/health-check
 *   GET    /api/whatsapp/templates           ?status&cursor
 *   POST   /api/whatsapp/templates
 *   PATCH  /api/whatsapp/templates/:id
 *   DELETE /api/whatsapp/templates/:id
 *   POST   /api/whatsapp/templates/:id/submit
 *   POST   /api/whatsapp/templates/:id/sync
 *   GET    /api/whatsapp/messages            ?candidate_id&direction&status&cursor
 *   POST   /api/whatsapp/messages            body { candidate_id, kind, body?, template_id?, variables?, media_url?, media_type? }
 *   GET    /api/whatsapp/conversations       ?candidate_id
 *   GET    /api/whatsapp/consents            ?status&cursor
 *   GET    /api/whatsapp/consents/:candidate_id
 *   POST   /api/whatsapp/consents/invite     body { candidate_id, phone_number }
 *   POST   /api/whatsapp/consents/:candidate_id/withdraw  body { reason }
 */

export type WhatsAppIntegrationStatus =
  | "connected"
  | "disconnected"
  | "suspended"
  | "error";

export type WhatsAppTemplateStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "paused"
  | "disabled";

export type WhatsAppMessageStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "received";

export type WhatsAppMessageType =
  | "text"
  | "template"
  | "image"
  | "video"
  | "document"
  | "audio"
  | "location"
  | "reaction"
  | "interactive";

export type ConsentStatus = "pending" | "granted" | "withdrawn" | "blocked";

export interface WhatsAppIntegration {
  id: string;
  status: WhatsAppIntegrationStatus;
  phone_number: string;
  display_name: string | null;
  waba_id: string | null;
  quality_rating: "green" | "yellow" | "red" | "unknown";
  messaging_limit: string | null;
  connected_at: string | null;
  last_health_check_at: string | null;
  last_error: string | null;
}

export interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  category: "marketing" | "utility" | "authentication";
  status: WhatsAppTemplateStatus;
  header: { type: string; text?: string; media_url?: string } | null;
  body: string;
  footer: string | null;
  buttons: { type: string; text: string; url?: string }[];
  example_variables: string[];
  rejection_reason: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppMessage {
  id: string;
  candidate_id: string;
  candidate_name?: string;
  conversation_id: string | null;
  direction: "inbound" | "outbound";
  message_type: WhatsAppMessageType;
  template_id: string | null;
  body_text: string | null;
  media_url: string | null;
  media_mime: string | null;
  status: WhatsAppMessageStatus;
  external_id: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface WhatsAppConversation {
  id: string;
  candidate_id: string;
  candidate_name?: string;
  /** ISO timestamp of the latest inbound message. Used to compute the 24h session window. */
  last_inbound_at: string | null;
  last_message_at: string | null;
  /** Whether the 24h customer-service window is still open. */
  session_open: boolean;
  /** ISO timestamp when the 24h window expires (null if no window open). */
  session_expires_at: string | null;
  message_count: number;
}

export interface WhatsAppConsent {
  id: string;
  candidate_id: string;
  candidate_name?: string;
  phone_number: string;
  status: ConsentStatus;
  opt_in_source: string | null;
  granted_at: string | null;
  withdrawn_at: string | null;
  withdrawal_reason: string | null;
}
