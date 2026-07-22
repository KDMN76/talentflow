/**
 * Twilio voice/VoIP integration service — Sprint Q4.6 (Agent AAAA).
 *
 * Multi-tenant Twilio connector. Per-tenant integration row stores the
 * AccountSid + auth-token (encrypted via `lib/encryption.ts`) plus the
 * outbound phone-number. Calls are logged to `voice_calls` and mirrored to
 * `communications` so the omni-channel inbox sees them.
 *
 * Mock-mode:
 *   - `TWILIO_LIVE !== 'true'` OR no `auth_token` provided → synthetic
 *     AccountInfo for `connectIntegration`, synthetic call SIDs for
 *     `initiateOutboundCall`, deterministic transcripts for transcription.
 *   - With `TWILIO_LIVE=true` the real Twilio REST integration is not wired
 *     up yet: call placement throws 501 NOT_IMPLEMENTED (marked with
 *     `// TODO(real-api)`) instead of returning a fabricated success.
 */

import { randomUUID } from 'crypto';
import { withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import { encrypt, decrypt } from '../../lib/encryption';
import { mocksAllowed } from '../../lib/env';
import { recordCommunication, truncatePreview } from '../../lib/inboxProjector';
import { transcribeAudio } from '../../lib/whisper';
import { eventBus } from '../../lib/eventBus';

export type VoiceCallStatus =
  | 'queued'
  | 'ringing'
  | 'in_progress'
  | 'completed'
  | 'busy'
  | 'no_answer'
  | 'failed'
  | 'canceled'
  | 'voicemail';

export type CallDirection = 'inbound' | 'outbound';

export interface VoiceIntegration {
  id: string;
  tenant_id: string;
  provider: 'twilio';
  status: 'connected' | 'disconnected' | 'error';
  account_sid: string | null;
  phone_number: string | null;
  connected_by: string | null;
  connected_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface VoiceCall {
  id: string;
  tenant_id: string;
  integration_id: string | null;
  candidate_id: string | null;
  candidate_name: string | null;
  direction: CallDirection;
  status: VoiceCallStatus;
  from_number: string | null;
  to_number: string | null;
  external_sid: string | null;
  duration_seconds: number;
  recording_url: string | null;
  recording_duration_seconds: number | null;
  transcription_text: string | null;
  transcription_status: 'pending' | 'done' | 'failed' | null;
  voicemail: boolean;
  notes: string | null;
  initiated_by: string | null;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  communication_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

function isLive(): boolean {
  return process.env.TWILIO_LIVE === 'true';
}

/**
 * Kan Voice in deze omgeving echt gebruikt worden? Live óf een niet-productie
 * omgeving waar de mock-progressie (queued→ringing→completed) acceptabel is
 * voor lokale dev/tests. In productie zonder TWILIO_LIVE is Voice "niet
 * geactiveerd": write-paden weigeren met 503 in plaats van nep-gesprekken
 * te simuleren.
 */
export function isVoiceServiceActive(): boolean {
  return isLive() || mocksAllowed();
}

function assertVoiceActive(): void {
  if (!isVoiceServiceActive()) {
    throw new AppError(
      503,
      'VOICE_NOT_ENABLED',
      'Voice is niet geactiveerd in deze omgeving. Bellen via TalentFlow staat uit.'
    );
  }
}

function rowToIntegration(row: Record<string, unknown>): VoiceIntegration {
  return {
    id: row.id as string,
    tenant_id: row.tenant_id as string,
    provider: 'twilio',
    status: row.status as VoiceIntegration['status'],
    account_sid: (row.account_sid as string | null) ?? null,
    phone_number: (row.phone_number as string | null) ?? null,
    connected_by: (row.connected_by as string | null) ?? null,
    connected_at: (row.connected_at as string | null) ?? null,
    last_error: (row.last_error as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: row.created_at as string,
  };
}

function rowToCall(row: Record<string, unknown>): VoiceCall {
  const meta = row.metadata;
  return {
    id: row.id as string,
    tenant_id: row.tenant_id as string,
    integration_id: (row.integration_id as string | null) ?? null,
    candidate_id: (row.candidate_id as string | null) ?? null,
    candidate_name: (row.candidate_name as string | null) ?? null,
    direction: row.direction as CallDirection,
    status: row.status as VoiceCallStatus,
    from_number: (row.from_number as string | null) ?? null,
    to_number: (row.to_number as string | null) ?? null,
    external_sid: (row.external_sid as string | null) ?? null,
    duration_seconds: Number(row.duration_seconds ?? 0),
    recording_url: (row.recording_url as string | null) ?? null,
    recording_duration_seconds: (row.recording_duration_seconds as number | null) ?? null,
    transcription_text: (row.transcription_text as string | null) ?? null,
    transcription_status:
      (row.transcription_status as VoiceCall['transcription_status']) ?? null,
    voicemail: Boolean(row.voicemail),
    notes: (row.notes as string | null) ?? null,
    initiated_by: (row.initiated_by as string | null) ?? null,
    started_at: (row.started_at as string | null) ?? null,
    answered_at: (row.answered_at as string | null) ?? null,
    ended_at: (row.ended_at as string | null) ?? null,
    communication_id: (row.communication_id as string | null) ?? null,
    metadata: typeof meta === 'object' && meta !== null
      ? (meta as Record<string, unknown>)
      : {},
    created_at: row.created_at as string,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Integration management
// ───────────────────────────────────────────────────────────────────────────

export interface ConnectIntegrationInput {
  account_sid: string;
  auth_token: string;
  phone_number: string;
}

interface TwilioAccountInfo {
  sid: string;
  friendly_name: string;
  status: string;
}

async function fetchTwilioAccount(
  accountSid: string,
  authToken: string
): Promise<TwilioAccountInfo> {
  if (!isLive() || !authToken) {
    // Mock-mode: synthetic friendly_name.
    return {
      sid: accountSid,
      friendly_name: 'TalentFlow Mock Twilio Account',
      status: 'active',
    };
  }
  // TODO(real-api): hit https://api.twilio.com/2010-04-01/Accounts/{Sid}.json
  // with Basic auth (accountSid:authToken). Keeping the mock-shape for now so
  // the API contract is stable.
  return {
    sid: accountSid,
    friendly_name: 'Twilio Account',
    status: 'active',
  };
}

export async function connectIntegration(
  tenantId: string,
  input: ConnectIntegrationInput,
  userId: string
): Promise<VoiceIntegration> {
  // Bevroren feature-guard: in productie zou de mock elke willekeurige
  // SID/token als geldig Twilio-account "valideren".
  assertVoiceActive();

  if (!input.account_sid || !input.auth_token || !input.phone_number) {
    throw new AppError(
      400,
      'INVALID_INPUT',
      'account_sid, auth_token en phone_number zijn verplicht'
    );
  }

  let account: TwilioAccountInfo;
  try {
    account = await fetchTwilioAccount(input.account_sid, input.auth_token);
  } catch (err) {
    throw new AppError(
      400,
      'TWILIO_AUTH_FAILED',
      `Twilio authenticatie mislukt: ${(err as Error).message}`
    );
  }

  const tokenBlob = encrypt(input.auth_token);
  const webhookSecret = randomUUID().replace(/-/g, '');
  const webhookBlob = encrypt(webhookSecret);

  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Record<string, unknown>>(
      `INSERT INTO voice_integrations
         (tenant_id, provider, status, account_sid, auth_token_encrypted,
          phone_number, webhook_secret_encrypted, connected_by, connected_at,
          metadata)
       VALUES ($1, 'twilio', 'connected', $2, $3, $4, $5, $6, now(),
               jsonb_build_object('friendly_name', $7::text))
       ON CONFLICT (tenant_id) DO UPDATE
         SET status = 'connected',
             account_sid = EXCLUDED.account_sid,
             auth_token_encrypted = EXCLUDED.auth_token_encrypted,
             phone_number = EXCLUDED.phone_number,
             webhook_secret_encrypted = EXCLUDED.webhook_secret_encrypted,
             connected_by = EXCLUDED.connected_by,
             connected_at = EXCLUDED.connected_at,
             last_error = NULL,
             metadata = EXCLUDED.metadata
       RETURNING *`,
      [
        tenantId,
        input.account_sid,
        tokenBlob,
        input.phone_number,
        webhookBlob,
        userId,
        account.friendly_name,
      ]
    );
    return rowToIntegration(rows[0]);
  });
}

export async function disconnectIntegration(tenantId: string): Promise<VoiceIntegration> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Record<string, unknown>>(
      `UPDATE voice_integrations
          SET status = 'disconnected',
              auth_token_encrypted = NULL,
              webhook_secret_encrypted = NULL
        WHERE tenant_id = $1
        RETURNING *`,
      [tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'INTEGRATION_NOT_FOUND', 'Voice-integratie niet gevonden');
    }
    return rowToIntegration(rows[0]);
  });
}

export async function getIntegration(
  tenantId: string
): Promise<VoiceIntegration | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Record<string, unknown>>(
      `SELECT * FROM voice_integrations WHERE tenant_id = $1`,
      [tenantId]
    );
    if (rows.length === 0) return null;
    return rowToIntegration(rows[0]);
  });
}

interface IntegrationSecrets {
  integration_id: string;
  account_sid: string;
  auth_token: string | null;
  phone_number: string | null;
  webhook_secret: string | null;
}

async function loadSecrets(tenantId: string): Promise<IntegrationSecrets | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Record<string, unknown>>(
      `SELECT id, account_sid, auth_token_encrypted, phone_number,
              webhook_secret_encrypted, status
         FROM voice_integrations
        WHERE tenant_id = $1`,
      [tenantId]
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    let authToken: string | null = null;
    if (row.auth_token_encrypted) {
      try {
        authToken = decrypt(row.auth_token_encrypted as Buffer);
      } catch (err) {
        logger.warn('[voice] auth_token decrypt failed', {
          tenantId,
          error: (err as Error).message,
        });
      }
    }
    let webhookSecret: string | null = null;
    if (row.webhook_secret_encrypted) {
      try {
        webhookSecret = decrypt(row.webhook_secret_encrypted as Buffer);
      } catch (err) {
        logger.warn('[voice] webhook_secret decrypt failed', {
          tenantId,
          error: (err as Error).message,
        });
      }
    }
    return {
      integration_id: row.id as string,
      account_sid: row.account_sid as string,
      auth_token: authToken,
      phone_number: (row.phone_number as string | null) ?? null,
      webhook_secret: webhookSecret,
    };
  });
}

/** Public lookup for the Twilio webhook handler (HMAC verification). */
export async function getWebhookSecret(tenantId: string): Promise<string | null> {
  const secrets = await loadSecrets(tenantId);
  return secrets?.webhook_secret ?? null;
}

// ───────────────────────────────────────────────────────────────────────────
// Outbound calls
// ───────────────────────────────────────────────────────────────────────────

export interface InitiateOutboundCallInput {
  candidateId: string;
  recruiterId: string;
  toNumber?: string;
}

interface TwilioCallResponse {
  sid: string;
  status: 'queued' | 'ringing' | 'in_progress' | 'completed';
}

async function placeTwilioCall(
  _secrets: IntegrationSecrets,
  _toNumber: string
): Promise<TwilioCallResponse> {
  if (!isLive()) {
    // Mock-tak (niet-productie): synthetische SID, geen echte call.
    return {
      sid: `twilio-mock-${randomUUID().replace(/-/g, '').slice(0, 24)}`,
      status: 'queued',
    };
  }
  // TODO(real-api): POST to
  //   https://api.twilio.com/2010-04-01/Accounts/{Sid}/Calls.json
  // with body { From: secrets.phone_number, To: toNumber, Url: ... }
  // Tot die koppeling er is weigeren we expliciet in plaats van een verzonnen
  // 'twilio-real-...'-SID terug te geven alsof er echt gebeld is.
  throw new AppError(
    501,
    'NOT_IMPLEMENTED',
    'Twilio-integratie is nog niet gekoppeld — er is geen echte call geplaatst'
  );
}

async function fetchCandidatePhone(
  client: import('pg').PoolClient,
  tenantId: string,
  candidateId: string
): Promise<string | null> {
  const { rows } = await client.query<{ phone: string | null }>(
    `SELECT phone FROM candidates WHERE id = $1 AND tenant_id = $2`,
    [candidateId, tenantId]
  );
  return rows[0]?.phone ?? null;
}

export async function initiateOutboundCall(
  tenantId: string,
  input: InitiateOutboundCallInput
): Promise<VoiceCall> {
  // Bevroren feature-guard: in productie belde dit NIET echt — de mock
  // simuleerde queued→ringing→completed (42s) alsof er gebeld was.
  assertVoiceActive();

  const secrets = await loadSecrets(tenantId);
  if (!secrets) {
    throw new AppError(
      404,
      'INTEGRATION_NOT_FOUND',
      'Voice-integratie niet geconfigureerd voor deze tenant'
    );
  }

  return withTenant(tenantId, async (client) => {
    const toNumber =
      input.toNumber ??
      (await fetchCandidatePhone(client, tenantId, input.candidateId));
    if (!toNumber) {
      throw new AppError(
        400,
        'CANDIDATE_NO_PHONE',
        'Kandidaat heeft geen telefoonnummer'
      );
    }

    const twilio = await placeTwilioCall(secrets, toNumber);

    // 1) Insert voice_calls row.
    const { rows: callRows } = await client.query<Record<string, unknown>>(
      `INSERT INTO voice_calls
         (tenant_id, integration_id, candidate_id, direction, status,
          from_number, to_number, external_sid, initiated_by, started_at,
          metadata)
       VALUES ($1, $2, $3, 'outbound', $4, $5, $6, $7, $8, now(),
               jsonb_build_object('mock', $9::boolean))
       RETURNING *`,
      [
        tenantId,
        secrets.integration_id,
        input.candidateId,
        twilio.status,
        secrets.phone_number,
        toNumber,
        twilio.sid,
        input.recruiterId,
        !isLive(),
      ]
    );
    const call = rowToCall(callRows[0]);

    // 2) Mirror to `communications` so the inbox sees it. Status volgt de
    // echte Twilio-status ('queued') — de webhook werkt hem later bij; 'sent'
    // zou een nog niet plaatsgevonden gesprek als afgerond presenteren.
    const preview = `Outbound call → ${toNumber}`;
    const { rows: commRows } = await client.query<{ id: string }>(
      `INSERT INTO communications
         (tenant_id, candidate_id, channel, direction, subject, body, status,
          preview)
       VALUES ($1, $2, 'voice', 'outbound', $3, $4, $5, $6)
       RETURNING id`,
      [tenantId, input.candidateId, `Call ${twilio.sid}`, preview, twilio.status, preview]
    );
    const communicationId = commRows[0].id;

    // 3) Link call → communications row.
    await client.query(
      `UPDATE voice_calls
          SET communication_id = $1,
              metadata = COALESCE(metadata, '{}'::jsonb)
                       || jsonb_build_object('call_id', $2::text)
        WHERE id = $2 AND tenant_id = $3`,
      [communicationId, call.id, tenantId]
    );

    // 4) Project into unified_threads (in-transaction).
    await recordCommunication({
      tenantId,
      candidateId: input.candidateId,
      communicationId,
      channel: 'voice',
      direction: 'outbound',
      preview,
      timestamp: new Date().toISOString(),
      client,
      suppressEvent: true,
    });

    // 5) Kick off the mock progression loop async (next tick) for mock-mode.
    if (!isLive()) {
      queueMicrotask(() => mockProgressCall(tenantId, call.id).catch(() => undefined));
    }

    return { ...call, communication_id: communicationId };
  });
}

async function mockProgressCall(tenantId: string, callId: string): Promise<void> {
  for (const status of ['ringing', 'in_progress', 'completed'] as VoiceCallStatus[]) {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE voice_calls
            SET status = $1,
                answered_at = CASE WHEN $1 = 'in_progress' THEN now() ELSE answered_at END,
                ended_at = CASE WHEN $1 = 'completed' THEN now() ELSE ended_at END,
                duration_seconds = CASE WHEN $1 = 'completed' THEN 42 ELSE duration_seconds END
          WHERE id = $2 AND tenant_id = $3`,
        [status, callId, tenantId]
      );
    });
  }
}

export async function endCall(
  tenantId: string,
  callId: string
): Promise<VoiceCall> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Record<string, unknown>>(
      `UPDATE voice_calls
          SET status = CASE WHEN status IN ('completed','failed','canceled') THEN status
                            ELSE 'completed' END,
              ended_at = COALESCE(ended_at, now())
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [callId, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'CALL_NOT_FOUND', 'Call niet gevonden');
    }
    return rowToCall(rows[0]);
  });
}

export async function recordCallNotes(
  tenantId: string,
  callId: string,
  notes: string,
  _userId: string
): Promise<VoiceCall> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Record<string, unknown>>(
      `UPDATE voice_calls
          SET notes = COALESCE(notes, '') ||
                      CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE E'\n\n' END ||
                      $1
        WHERE id = $2 AND tenant_id = $3
        RETURNING *`,
      [notes, callId, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'CALL_NOT_FOUND', 'Call niet gevonden');
    }
    return rowToCall(rows[0]);
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Transcription
// ───────────────────────────────────────────────────────────────────────────

export async function requestTranscription(
  tenantId: string,
  callId: string
): Promise<VoiceCall> {
  // Guard: zonder actieve voice-service zou hier een mock-transcript worden
  // opgeslagen alsof er echt getranscribeerd is.
  assertVoiceActive();

  const call = await withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Record<string, unknown>>(
      `UPDATE voice_calls
          SET transcription_status = 'pending'
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [callId, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'CALL_NOT_FOUND', 'Call niet gevonden');
    }
    return rowToCall(rows[0]);
  });

  if (!call.recording_url) {
    if (isLive() || !mocksAllowed()) {
      // Productie/live-mode: zonder opname valt er niets te transcriberen.
      // Markeer als 'failed' met reden in plaats van een mock-transcript op
      // te slaan alsof er echt getranscribeerd is.
      return failTranscription(
        tenantId,
        callId,
        'Geen opname beschikbaar (recording_url ontbreekt) — transcriptie niet uitgevoerd'
      );
    }
    // Mock-fallback, alleen buiten productie (dev/test).
    return finalizeTranscription(tenantId, callId, 'Mock transcript — no recording.');
  }

  try {
    // For mock-mode (no OPENAI_API_KEY) `transcribeAudio` returns the canned
    // MOCK_TRANSCRIPT_NL. We feed a tiny stub buffer because the actual audio
    // would need to be downloaded from `recording_url` in production.
    const stubBuffer = Buffer.from('mock-audio');
    const result = await transcribeAudio(stubBuffer, {
      language: 'nl',
      filename: 'call.mp3',
      contentType: 'audio/mpeg',
    });
    return finalizeTranscription(tenantId, callId, result.text);
  } catch (err) {
    logger.error('[voice] transcription failed', {
      tenantId,
      callId,
      error: (err as Error).message,
    });
    return withTenant(tenantId, async (client) => {
      const { rows } = await client.query<Record<string, unknown>>(
        `UPDATE voice_calls
            SET transcription_status = 'failed'
          WHERE id = $1 AND tenant_id = $2
          RETURNING *`,
        [callId, tenantId]
      );
      return rowToCall(rows[0]);
    });
  }
}

/**
 * Markeer een transcriptie-aanvraag als mislukt, met de reden in metadata
 * zodat de UI/API kan tonen waarom er geen transcript is.
 */
async function failTranscription(
  tenantId: string,
  callId: string,
  reason: string
): Promise<VoiceCall> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Record<string, unknown>>(
      `UPDATE voice_calls
          SET transcription_status = 'failed',
              metadata = COALESCE(metadata, '{}'::jsonb)
                       || jsonb_build_object('transcription_error', $1::text)
        WHERE id = $2 AND tenant_id = $3
        RETURNING *`,
      [reason, callId, tenantId]
    );
    return rowToCall(rows[0]);
  });
}

async function finalizeTranscription(
  tenantId: string,
  callId: string,
  text: string
): Promise<VoiceCall> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Record<string, unknown>>(
      `UPDATE voice_calls
          SET transcription_text = $1, transcription_status = 'done'
        WHERE id = $2 AND tenant_id = $3
        RETURNING *`,
      [text, callId, tenantId]
    );
    const updated = rowToCall(rows[0]);
    // Update communications preview with the transcription excerpt.
    if (updated.communication_id) {
      await client.query(
        `UPDATE communications
            SET preview = $1
          WHERE id = $2 AND tenant_id = $3`,
        [truncatePreview(text), updated.communication_id, tenantId]
      );
    }
    return updated;
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Listing
// ───────────────────────────────────────────────────────────────────────────

export interface ListCallsOptions {
  candidate_id?: string;
  direction?: CallDirection;
  status?: VoiceCallStatus;
  cursor?: string | null;
  limit?: number;
}

export interface ListCallsResult {
  data: VoiceCall[];
  next_cursor: string | null;
}

export async function listCalls(
  tenantId: string,
  opts: ListCallsOptions = {}
): Promise<ListCallsResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const filters: string[] = ['vc.tenant_id = $1'];
  const params: unknown[] = [tenantId];

  if (opts.candidate_id) {
    params.push(opts.candidate_id);
    filters.push(`vc.candidate_id = $${params.length}`);
  }
  if (opts.direction) {
    params.push(opts.direction);
    filters.push(`vc.direction = $${params.length}`);
  }
  if (opts.status) {
    params.push(opts.status);
    filters.push(`vc.status = $${params.length}`);
  }
  if (opts.cursor) {
    params.push(opts.cursor);
    filters.push(`vc.created_at < $${params.length}::timestamptz`);
  }

  params.push(limit + 1);
  const limitParam = `$${params.length}`;

  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Record<string, unknown>>(
      `SELECT vc.*, c.name AS candidate_name
         FROM voice_calls vc
         LEFT JOIN candidates c ON c.id = vc.candidate_id AND c.tenant_id = vc.tenant_id
         WHERE ${filters.join(' AND ')}
         ORDER BY vc.created_at DESC
         LIMIT ${limitParam}`,
      params
    );
    const mapped = rows.map(rowToCall);
    let next_cursor: string | null = null;
    if (mapped.length > limit) {
      next_cursor = mapped[limit - 1].created_at;
      mapped.length = limit;
    }
    return { data: mapped, next_cursor };
  });
}

export async function getCall(tenantId: string, callId: string): Promise<VoiceCall> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Record<string, unknown>>(
      `SELECT vc.*, c.name AS candidate_name
         FROM voice_calls vc
         LEFT JOIN candidates c ON c.id = vc.candidate_id AND c.tenant_id = vc.tenant_id
         WHERE vc.id = $1 AND vc.tenant_id = $2`,
      [callId, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'CALL_NOT_FOUND', 'Call niet gevonden');
    }
    return rowToCall(rows[0]);
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Twilio webhook handler — invoked from twilioWebhookRoutes
// ───────────────────────────────────────────────────────────────────────────

export interface TwilioWebhookPayload {
  CallSid: string;
  CallStatus?: string;
  RecordingUrl?: string;
  RecordingDuration?: string;
  CallDuration?: string;
  From?: string;
  To?: string;
}

const STATUS_MAP: Record<string, VoiceCallStatus> = {
  queued: 'queued',
  ringing: 'ringing',
  'in-progress': 'in_progress',
  completed: 'completed',
  busy: 'busy',
  'no-answer': 'no_answer',
  failed: 'failed',
  canceled: 'canceled',
};

export async function handleTwilioWebhook(
  tenantId: string,
  payload: TwilioWebhookPayload
): Promise<{ updated: boolean; transcribed: boolean; call?: VoiceCall }> {
  if (!payload.CallSid) {
    throw new AppError(400, 'INVALID_WEBHOOK', 'CallSid ontbreekt');
  }

  const status = payload.CallStatus
    ? STATUS_MAP[payload.CallStatus] ?? null
    : null;
  const duration = payload.CallDuration ? parseInt(payload.CallDuration, 10) : null;
  const recordingDuration = payload.RecordingDuration
    ? parseInt(payload.RecordingDuration, 10)
    : null;

  const updated = await withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Record<string, unknown>>(
      `UPDATE voice_calls
          SET status = COALESCE($1, status),
              duration_seconds = COALESCE($2, duration_seconds),
              recording_url = COALESCE($3, recording_url),
              recording_duration_seconds = COALESCE($4, recording_duration_seconds),
              ended_at = CASE
                WHEN $1 IN ('completed','failed','canceled','no_answer','busy')
                  THEN COALESCE(ended_at, now())
                ELSE ended_at
              END
        WHERE external_sid = $5 AND tenant_id = $6
        RETURNING *`,
      [
        status,
        duration,
        payload.RecordingUrl ?? null,
        recordingDuration,
        payload.CallSid,
        tenantId,
      ]
    );
    return rows.length === 0 ? null : rowToCall(rows[0]);
  });

  if (!updated) {
    return { updated: false, transcribed: false };
  }

  let transcribed = false;
  if (payload.RecordingUrl) {
    // Check tenant settings for auto-transcribe (best-effort).
    const autoTranscribe = await fetchAutoTranscribe(tenantId);
    if (autoTranscribe) {
      try {
        await requestTranscription(tenantId, updated.id);
        transcribed = true;
      } catch (err) {
        logger.warn('[voice] auto-transcription failed', {
          tenantId,
          callId: updated.id,
          error: (err as Error).message,
        });
      }
    }
  }

  // Emit eventBus update so subscribers (inbox projector) refresh.
  if (updated.communication_id && updated.candidate_id) {
    eventBus.emit('communicationCreated', {
      tenantId,
      candidateId: updated.candidate_id,
      communicationId: updated.communication_id,
      channel: 'voice',
      direction: updated.direction,
      preview: truncatePreview(updated.transcription_text ?? `Call ${updated.status}`),
      timestamp: updated.ended_at ?? new Date().toISOString(),
    });
  }

  return { updated: true, transcribed, call: updated };
}

async function fetchAutoTranscribe(tenantId: string): Promise<boolean> {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query<{ auto_transcribe_calls: boolean | null }>(
        `SELECT auto_transcribe_calls FROM tenant_settings WHERE tenant_id = $1`,
        [tenantId]
      );
      return Boolean(rows[0]?.auto_transcribe_calls);
    });
  } catch {
    return false;
  }
}
