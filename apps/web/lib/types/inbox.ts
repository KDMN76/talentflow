/**
 * Sprint Q4.6 — Unified omni-channel inbox types.
 *
 * Backend contract (Agent AAAA):
 *   GET    /api/inbox/threads                ?unread&channel&assignee_user_id&pinned&archived&q&cursor
 *   GET    /api/inbox/threads/:id
 *   GET    /api/inbox/threads/:id/timeline   ?before&limit
 *   POST   /api/inbox/threads/:id/read
 *   POST   /api/inbox/threads/:id/assign     body { user_id }
 *   POST   /api/inbox/threads/:id/pin
 *   POST   /api/inbox/threads/:id/unpin
 *   POST   /api/inbox/threads/:id/archive
 *   POST   /api/inbox/threads/:id/unarchive
 *   POST   /api/inbox/threads/:id/labels     body { label }
 *   DELETE /api/inbox/threads/:id/labels/:label
 */

export type ChannelType =
  | "email"
  | "whatsapp"
  | "sms"
  | "voice"
  | "linkedin_inmail"
  | "linkedin_connection";

export type ThreadDirection = "inbound" | "outbound";

export interface UnifiedThread {
  id: string;
  candidate_id: string;
  candidate_name?: string;
  last_message_at: string;
  last_channel: ChannelType;
  last_message_preview: string;
  unread_count_for_assignee: number;
  assignee_user_id: string | null;
  assignee_name?: string;
  pinned: boolean;
  archived_at: string | null;
  labels: string[];
  created_at: string;
  updated_at: string;
}

export interface TimelineEvent {
  id: string;
  channel: ChannelType;
  direction: ThreadDirection;
  timestamp: string;
  sender_name: string;
  preview: string;
  body: string;
  attachments: { url: string; mime: string; name?: string }[];
  metadata: Record<string, unknown>;
}
