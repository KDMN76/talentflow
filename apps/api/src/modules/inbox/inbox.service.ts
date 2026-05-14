/**
 * Omni-channel inbox aggregation service — Sprint Q4.6 (Agent AAAA).
 *
 * Read-side projection over `unified_threads` and `communications` joined to
 * channel-specific tables (`voice_calls`, `outreach_messages`, future
 * `whatsapp_messages`). Channel-writers populate `communications` + call
 * `recordCommunication(...)` from `lib/inboxProjector.ts`; this service is
 * the read API used by the inbox routes.
 *
 * Coordination with ZZZ (WhatsApp): every WhatsApp writer MUST call
 *   await recordCommunication({ tenantId, candidateId, communicationId,
 *     channel: 'whatsapp', direction, preview, timestamp });
 * right after the `communications` INSERT — either inside the same
 * `withTenant` transaction (passing `client`) or as a follow-up call.
 *
 * The timeline endpoint merges:
 *   - communications rows (the canonical cross-channel ledger)
 *   - voice_calls rows (so call duration + recording + transcription land in
 *     the same timeline as the matching communications row)
 *   - outreach_messages rows (LinkedIn / nurture)
 *
 * Each normalized event has the shape:
 *   { id, channel, direction, timestamp, sender_name, preview, body,
 *     attachments[], metadata }
 */

import { withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';

export interface UnifiedThread {
  id: string;
  tenant_id: string;
  candidate_id: string;
  last_message_at: string | null;
  last_channel: string | null;
  last_message_preview: string | null;
  unread_count_for_assignee: number;
  assignee_user_id: string | null;
  pinned: boolean;
  archived_at: string | null;
  labels: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  candidate_name?: string | null;
}

export interface TimelineEvent {
  id: string;
  channel: string;
  direction: 'inbound' | 'outbound';
  timestamp: string;
  sender_name: string | null;
  preview: string;
  body: string | null;
  attachments: Array<{ url: string; type?: string; name?: string }>;
  metadata: Record<string, unknown>;
}

export interface ListThreadsOptions {
  unread?: boolean;
  channel?: string;
  assignee_user_id?: string;
  pinned?: boolean;
  archived?: boolean;
  q?: string;
  cursor?: string | null;
  limit?: number;
}

export interface ListThreadsResult {
  data: UnifiedThread[];
  next_cursor: string | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// ───────────────────────────────────────────────────────────────────────────
// ensureThread + recordChannelEvent (writer-side helpers re-exported)
// ───────────────────────────────────────────────────────────────────────────

export async function ensureThread(
  tenantId: string,
  candidateId: string
): Promise<UnifiedThread> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<UnifiedThread>(
      `INSERT INTO unified_threads (tenant_id, candidate_id)
       VALUES ($1, $2)
       ON CONFLICT (tenant_id, candidate_id) DO UPDATE
         SET updated_at = now()
       RETURNING *`,
      [tenantId, candidateId]
    );
    return rows[0];
  });
}

// ───────────────────────────────────────────────────────────────────────────
// listThreads — cursor pagination on (last_message_at DESC, id DESC)
// ───────────────────────────────────────────────────────────────────────────

interface ThreadCursor {
  last_message_at: string | null;
  id: string;
}

function encodeCursor(c: ThreadCursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(s: string | null | undefined): ThreadCursor | null {
  if (!s) return null;
  try {
    const json = Buffer.from(s, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed.id !== 'string') return null;
    return {
      id: parsed.id,
      last_message_at: parsed.last_message_at ?? null,
    };
  } catch {
    return null;
  }
}

export async function listThreads(
  tenantId: string,
  opts: ListThreadsOptions = {}
): Promise<ListThreadsResult> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const filters: string[] = ['t.tenant_id = $1'];
  const params: unknown[] = [tenantId];

  if (opts.unread === true) {
    filters.push(`t.unread_count_for_assignee > 0`);
  }
  if (opts.channel) {
    params.push(opts.channel);
    filters.push(`t.last_channel = $${params.length}`);
  }
  if (opts.assignee_user_id) {
    params.push(opts.assignee_user_id);
    filters.push(`t.assignee_user_id = $${params.length}`);
  }
  if (opts.pinned === true) {
    filters.push(`t.pinned = TRUE`);
  } else if (opts.pinned === false) {
    filters.push(`t.pinned = FALSE`);
  }
  if (opts.archived === true) {
    filters.push(`t.archived_at IS NOT NULL`);
  } else if (opts.archived === false) {
    filters.push(`t.archived_at IS NULL`);
  }
  if (opts.q && opts.q.trim().length > 0) {
    params.push(`%${opts.q.trim().toLowerCase()}%`);
    filters.push(`LOWER(COALESCE(t.last_message_preview, '')) LIKE $${params.length}`);
  }

  const cursor = decodeCursor(opts.cursor ?? null);
  if (cursor) {
    // (last_message_at, id) < (cursor.last_message_at, cursor.id) DESC
    // We emulate tuple-comparison so NULL last_message_at sorts last.
    params.push(cursor.last_message_at);
    params.push(cursor.id);
    const p1 = `$${params.length - 1}`;
    const p2 = `$${params.length}`;
    filters.push(
      `(t.last_message_at, t.id) < (COALESCE(${p1}::timestamptz, 'epoch'), ${p2}::uuid)`
    );
  }

  params.push(limit + 1);
  const limitParam = `$${params.length}`;

  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query<UnifiedThread>(
        `SELECT t.*, c.name AS candidate_name
           FROM unified_threads t
           LEFT JOIN candidates c ON c.id = t.candidate_id
          WHERE ${filters.join(' AND ')}
          ORDER BY t.last_message_at DESC NULLS LAST, t.id DESC
          LIMIT ${limitParam}`,
        params
      );

      let next_cursor: string | null = null;
      const data = rows;
      if (rows.length > limit) {
        const tail = rows[limit - 1];
        next_cursor = encodeCursor({
          last_message_at: tail.last_message_at,
          id: tail.id,
        });
        data.length = limit;
      }
      return { data, next_cursor };
    });
  } catch (err) {
    logger.warn('[inbox] listThreads failed — returning empty list', {
      tenantId,
      error: (err as Error).message,
    });
    return { data: [], next_cursor: null };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// getThread / getThreadTimeline — merged channel events
// ───────────────────────────────────────────────────────────────────────────

export async function getThread(
  tenantId: string,
  threadId: string
): Promise<UnifiedThread> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<UnifiedThread>(
      `SELECT t.*, c.name AS candidate_name
         FROM unified_threads t
         LEFT JOIN candidates c ON c.id = t.candidate_id
        WHERE t.id = $1 AND t.tenant_id = $2`,
      [threadId, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'THREAD_NOT_FOUND', 'Thread niet gevonden');
    }
    return rows[0];
  });
}

export interface TimelineOptions {
  before?: string;
  limit?: number;
}

export interface TimelineResult {
  data: TimelineEvent[];
  next_cursor: string | null;
}

interface RawCommRow {
  id: string;
  channel: string;
  direction: 'inbound' | 'outbound';
  sent_at: string | null;
  created_at: string;
  subject: string | null;
  body: string | null;
  preview: string | null;
  message_id: string | null;
  thread_id: string | null;
  metadata?: unknown;
}

interface RawVoiceRow {
  id: string;
  direction: 'inbound' | 'outbound';
  status: string;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  duration_seconds: number;
  recording_url: string | null;
  transcription_text: string | null;
  voicemail: boolean;
  notes: string | null;
  from_number: string | null;
  to_number: string | null;
  metadata: unknown;
}

interface RawOutreachRow {
  id: string;
  channel: string;
  direction: 'inbound' | 'outbound';
  status: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  sent_at: string | null;
  created_at: string;
  metadata: unknown;
}

function metaToObj(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const v = JSON.parse(value);
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  }
  return {};
}

export async function getThreadTimeline(
  tenantId: string,
  threadId: string,
  opts: TimelineOptions = {}
): Promise<TimelineResult> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const before = opts.before ?? null;

  return withTenant(tenantId, async (client) => {
    // 1) Resolve the thread → candidate_id.
    const { rows: threadRows } = await client.query<{ candidate_id: string }>(
      `SELECT candidate_id FROM unified_threads WHERE id = $1 AND tenant_id = $2`,
      [threadId, tenantId]
    );
    if (threadRows.length === 0) {
      throw new AppError(404, 'THREAD_NOT_FOUND', 'Thread niet gevonden');
    }
    const candidateId = threadRows[0].candidate_id;

    // 2) Pull communications rows.
    const commParams: unknown[] = [tenantId, candidateId];
    let commWhere = `tenant_id = $1 AND candidate_id = $2`;
    if (before) {
      commParams.push(before);
      commWhere += ` AND COALESCE(sent_at, created_at) < $${commParams.length}::timestamptz`;
    }
    commParams.push(limit);
    const { rows: commRows } = await client.query<RawCommRow>(
      `SELECT id, channel, direction, sent_at, created_at, subject, body,
              preview, message_id, thread_id
         FROM communications
        WHERE ${commWhere}
        ORDER BY COALESCE(sent_at, created_at) DESC
        LIMIT $${commParams.length}`,
      commParams
    );

    // 3) Pull voice_calls (in case the call hasn't been mirrored to
    //    communications yet — defensive).
    const voiceParams: unknown[] = [tenantId, candidateId];
    let voiceWhere = `tenant_id = $1 AND candidate_id = $2`;
    if (before) {
      voiceParams.push(before);
      voiceWhere += ` AND COALESCE(started_at, created_at) < $${voiceParams.length}::timestamptz`;
    }
    voiceParams.push(limit);
    const { rows: voiceRows } = await client.query<RawVoiceRow>(
      `SELECT id, direction, status, started_at, ended_at, created_at,
              duration_seconds, recording_url, transcription_text,
              voicemail, notes, from_number, to_number, metadata
         FROM voice_calls
        WHERE ${voiceWhere}
        ORDER BY COALESCE(started_at, created_at) DESC
        LIMIT $${voiceParams.length}`,
      voiceParams
    );

    // 4) Pull outreach_messages (LinkedIn / nurture cross-channel).
    const outreachParams: unknown[] = [tenantId, candidateId];
    let outreachWhere = `tenant_id = $1 AND candidate_id = $2`;
    if (before) {
      outreachParams.push(before);
      outreachWhere += ` AND COALESCE(sent_at, created_at) < $${outreachParams.length}::timestamptz`;
    }
    outreachParams.push(limit);
    let outreachRows: RawOutreachRow[] = [];
    try {
      const r = await client.query<RawOutreachRow>(
        `SELECT id, channel, direction, status, subject, body_text, body_html,
                sent_at, created_at, metadata
           FROM outreach_messages
          WHERE ${outreachWhere}
          ORDER BY COALESCE(sent_at, created_at) DESC
          LIMIT $${outreachParams.length}`,
        outreachParams
      );
      outreachRows = r.rows;
    } catch (err) {
      // outreach_messages may not exist in legacy schemas.
      logger.debug('[inbox] outreach_messages fetch skipped', {
        error: (err as Error).message,
      });
    }

    // 5) Normalize → TimelineEvent[].
    const events: TimelineEvent[] = [];

    for (const r of commRows) {
      const ts = r.sent_at ?? r.created_at;
      events.push({
        id: `comm:${r.id}`,
        channel: r.channel,
        direction: r.direction,
        timestamp: ts,
        sender_name: null,
        preview: r.preview ?? (r.body ?? '').slice(0, 200),
        body: r.body,
        attachments: [],
        metadata: { message_id: r.message_id, subject: r.subject },
      });
    }

    for (const r of voiceRows) {
      const ts = r.started_at ?? r.created_at;
      const attachments = r.recording_url
        ? [{ url: r.recording_url, type: 'audio/recording', name: 'recording' }]
        : [];
      const preview = r.transcription_text
        ? r.transcription_text.slice(0, 200)
        : r.voicemail
        ? `Voicemail (${r.duration_seconds}s)`
        : `Call ${r.status} (${r.duration_seconds}s)`;
      events.push({
        id: `voice:${r.id}`,
        channel: 'voice',
        direction: r.direction,
        timestamp: ts,
        sender_name: r.direction === 'inbound' ? r.from_number : r.to_number,
        preview,
        body: r.transcription_text ?? r.notes ?? null,
        attachments,
        metadata: {
          status: r.status,
          duration_seconds: r.duration_seconds,
          voicemail: r.voicemail,
          ...metaToObj(r.metadata),
        },
      });
    }

    for (const r of outreachRows) {
      const ts = r.sent_at ?? r.created_at;
      const body = r.body_text ?? (r.body_html ?? '');
      events.push({
        id: `outreach:${r.id}`,
        channel: r.channel,
        direction: r.direction,
        timestamp: ts,
        sender_name: null,
        preview: body.slice(0, 200),
        body,
        attachments: [],
        metadata: { subject: r.subject, status: r.status, ...metaToObj(r.metadata) },
      });
    }

    // 6) Dedupe — a voice_call AND a mirroring `communications` row both
    //    reference the same conversation. Prefer the voice event because
    //    it carries duration + recording. Match on metadata.call_id when
    //    possible (set by voice.service).
    const voiceCallIds = new Set(voiceRows.map((v) => v.id));
    const deduped = events.filter((e) => {
      if (e.channel !== 'voice' && (e.metadata as { call_id?: string }).call_id) {
        const cid = (e.metadata as { call_id?: string }).call_id!;
        if (voiceCallIds.has(cid)) return false;
      }
      return true;
    });

    deduped.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

    let next_cursor: string | null = null;
    if (deduped.length > limit) {
      next_cursor = deduped[limit - 1].timestamp;
      deduped.length = limit;
    }

    return { data: deduped, next_cursor };
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Mutations
// ───────────────────────────────────────────────────────────────────────────

export async function markThreadRead(
  tenantId: string,
  threadId: string,
  _userId: string
): Promise<UnifiedThread> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<UnifiedThread>(
      `UPDATE unified_threads
          SET unread_count_for_assignee = 0,
              updated_at = now()
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [threadId, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'THREAD_NOT_FOUND', 'Thread niet gevonden');
    }
    return rows[0];
  });
}

export async function assignThread(
  tenantId: string,
  threadId: string,
  userId: string | null
): Promise<UnifiedThread> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<UnifiedThread>(
      `UPDATE unified_threads
          SET assignee_user_id = $3, updated_at = now()
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [threadId, tenantId, userId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'THREAD_NOT_FOUND', 'Thread niet gevonden');
    }
    return rows[0];
  });
}

export async function setPinned(
  tenantId: string,
  threadId: string,
  pinned: boolean
): Promise<UnifiedThread> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<UnifiedThread>(
      `UPDATE unified_threads
          SET pinned = $3, updated_at = now()
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [threadId, tenantId, pinned]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'THREAD_NOT_FOUND', 'Thread niet gevonden');
    }
    return rows[0];
  });
}

export async function setArchived(
  tenantId: string,
  threadId: string,
  archived: boolean
): Promise<UnifiedThread> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<UnifiedThread>(
      `UPDATE unified_threads
          SET archived_at = CASE WHEN $3 THEN now() ELSE NULL END,
              updated_at = now()
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [threadId, tenantId, archived]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'THREAD_NOT_FOUND', 'Thread niet gevonden');
    }
    return rows[0];
  });
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().slice(0, 64);
}

export async function addLabel(
  tenantId: string,
  threadId: string,
  label: string
): Promise<UnifiedThread> {
  const normalized = normalizeLabel(label);
  if (!normalized) {
    throw new AppError(400, 'INVALID_LABEL', 'Label mag niet leeg zijn');
  }
  return withTenant(tenantId, async (client) => {
    const { rows: existing } = await client.query<UnifiedThread>(
      `SELECT * FROM unified_threads WHERE id = $1 AND tenant_id = $2`,
      [threadId, tenantId]
    );
    if (existing.length === 0) {
      throw new AppError(404, 'THREAD_NOT_FOUND', 'Thread niet gevonden');
    }
    const current = Array.isArray(existing[0].labels) ? existing[0].labels : [];
    if (current.includes(normalized)) return existing[0];
    const next = [...current, normalized];
    const { rows } = await client.query<UnifiedThread>(
      `UPDATE unified_threads
          SET labels = $3::jsonb, updated_at = now()
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [threadId, tenantId, JSON.stringify(next)]
    );
    return rows[0];
  });
}

export async function removeLabel(
  tenantId: string,
  threadId: string,
  label: string
): Promise<UnifiedThread> {
  const normalized = normalizeLabel(label);
  return withTenant(tenantId, async (client) => {
    const { rows: existing } = await client.query<UnifiedThread>(
      `SELECT * FROM unified_threads WHERE id = $1 AND tenant_id = $2`,
      [threadId, tenantId]
    );
    if (existing.length === 0) {
      throw new AppError(404, 'THREAD_NOT_FOUND', 'Thread niet gevonden');
    }
    const current = Array.isArray(existing[0].labels) ? existing[0].labels : [];
    const next = current.filter((l) => l !== normalized);
    const { rows } = await client.query<UnifiedThread>(
      `UPDATE unified_threads
          SET labels = $3::jsonb, updated_at = now()
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [threadId, tenantId, JSON.stringify(next)]
    );
    return rows[0];
  });
}

// Re-export the projector helper for convenience so route handlers
// don't need to import from two places.
export { recordCommunication } from '../../lib/inboxProjector';
