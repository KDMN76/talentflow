/**
 * Interview-recordings service — Sprint Q3.4 (Agent CCC).
 *
 * Verantwoordelijk voor:
 *   1. Upload van audio-recordings (multer Express.Multer.File) naar de
 *      storage abstraction (`lib/storage.ts`) onder een tenant-scoped key.
 *   2. INSERT van een `interview_recordings`-rij met `transcription_status =
 *      'pending'`.
 *   3. Privacy-gate: zonder `consent_given === true` weigeren we de upload
 *      (interview-rules in TalentFlow vereisen explicit opt-in van de
 *      kandidaat — zie GDPR + AI Act compliance).
 *   4. Enqueueт een transcription-job op `interviewTranscriptionQueue`.
 *
 * RLS-veilig via `withTenant`. Geen tokens / secrets in deze module —
 * alleen storage-keys, file-metadata, en transcript-content.
 */

import { withTenant } from '../../db/pool';
import { getStorage } from '../../lib/storage';
import { AppError, logger } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { interviewTranscriptionQueue } from '../../queue/queues';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type TranscriptionStatus =
  | 'pending'
  | 'processing'
  | 'done'
  | 'failed'
  | 'skipped';

export type AiSummaryStatus = TranscriptionStatus;

export type AiRecommendation =
  | 'strong_yes'
  | 'yes'
  | 'neutral'
  | 'no'
  | 'strong_no';

export interface InterviewRecording {
  id: string;
  tenant_id: string;
  interview_id: string;
  filename: string;
  storage_key: string;
  mime_type: string | null;
  duration_seconds: number | null;
  size_bytes: number | null;
  transcript_text: string | null;
  transcript_language: string | null;
  transcription_status: TranscriptionStatus;
  transcription_error: string | null;
  ai_summary: string | null;
  ai_strengths: string[] | null;
  ai_concerns: string[] | null;
  ai_recommendation: AiRecommendation | null;
  ai_status: AiSummaryStatus | null;
  consent_given: boolean;
  consent_at: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  transcribed_at: string | null;
  ai_processed_at: string | null;
}

const FULL_COLUMNS = `
  id, tenant_id, interview_id, filename, storage_key, mime_type,
  duration_seconds, size_bytes,
  transcript_text, transcript_language, transcription_status, transcription_error,
  ai_summary, ai_strengths, ai_concerns, ai_recommendation, ai_status,
  consent_given, consent_at, uploaded_by, uploaded_at, transcribed_at, ai_processed_at
`;

// Allowed audio MIMEs voor MVP. Whisper accepteert mp3/mp4/mpeg/mpga/m4a/wav/webm.
// We staan ook 'application/octet-stream' toe omdat sommige browsers/recorders
// die fallback gebruiken — Whisper leidt het formaat af van de extension.
const ALLOWED_AUDIO_MIME = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/webm',
  'audio/ogg',
  'audio/oga',
  'audio/flac',
  'application/octet-stream',
]);

const MAX_RECORDING_BYTES = 200 * 1024 * 1024; // 200MB hard cap (storage), Whisper-limiet wordt later in worker afgevangen

function buildRecordingStorageKey(
  tenantId: string,
  interviewId: string,
  recordingId: string,
  filename: string
): string {
  const safe = filename
    .replace(/[\\/]+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
  return `tenants/${tenantId}/interviews/${interviewId}/recordings/${recordingId}__${safe}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Upload
// ────────────────────────────────────────────────────────────────────────────

/**
 * Upload een interview-recording. Vereist consent_given === true.
 *
 * Stappen:
 *   1. Valideer interview bestaat (RLS).
 *   2. Valideer mime-type + size.
 *   3. Genereer storage_key, schrijf file naar storage abstraction.
 *   4. INSERT row met status='pending'.
 *   5. Enqueueт transcription-job.
 *   6. Schrijf audit-log.
 */
export async function uploadRecording(
  tenantId: string,
  interviewId: string,
  userId: string,
  file: Express.Multer.File,
  consentGiven: boolean,
  ctx: AuditContext = {}
): Promise<InterviewRecording> {
  if (!file || !file.buffer) {
    throw new AppError(400, 'NO_FILE', 'Geen audio-bestand ontvangen');
  }
  if (!consentGiven) {
    throw new AppError(
      403,
      'CONSENT_REQUIRED',
      'Opname kan niet worden geüpload zonder expliciete toestemming van de kandidaat'
    );
  }
  if (file.size > MAX_RECORDING_BYTES) {
    throw new AppError(
      413,
      'FILE_TOO_LARGE',
      `Audio-bestand is te groot (max ${MAX_RECORDING_BYTES} bytes)`
    );
  }
  const mime = (file.mimetype ?? '').toLowerCase();
  if (mime && !ALLOWED_AUDIO_MIME.has(mime)) {
    throw new AppError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      `Audio-formaat niet ondersteund: ${file.mimetype}`
    );
  }

  const recording = await withTenant(tenantId, async (client) => {
    // 1) Interview bestaat?
    const { rows: ivRows } = await client.query<{ id: string }>(
      `SELECT id FROM interviews WHERE id = $1 AND tenant_id = $2`,
      [interviewId, tenantId]
    );
    if (ivRows.length === 0) {
      throw new AppError(404, 'INTERVIEW_NOT_FOUND', 'Interview niet gevonden');
    }

    // 2) Reserve een UUID + storage_key (genereer in DB zodat we 'm kunnen
    //    gebruiken in de storage_key voorafgaand aan INSERT).
    const { rows: idRows } = await client.query<{ new_id: string }>(
      `SELECT gen_random_uuid()::text AS new_id`
    );
    const recordingId = idRows[0]!.new_id;
    const storageKey = buildRecordingStorageKey(
      tenantId,
      interviewId,
      recordingId,
      file.originalname || 'recording.webm'
    );

    // 3) Schrijf naar storage NA DB-id-reserve, vóór INSERT (zodat we de
    //    upload kunnen rollback'en bij een DB-failure). De storage-put is
    //    idempotent: dezelfde key overschrijft.
    try {
      await getStorage().put(storageKey, file.buffer, mime || 'audio/webm');
    } catch (err) {
      logger.error('[recordings.service] storage.put failed', {
        storageKey,
        error: (err as Error).message,
      });
      throw new AppError(
        503,
        'STORAGE_UNAVAILABLE',
        'Audio-bestand kon niet worden opgeslagen'
      );
    }

    // 4) INSERT row met status='pending'.
    const { rows: insertedRows } = await client.query<InterviewRecording>(
      `INSERT INTO interview_recordings
         (id, tenant_id, interview_id, filename, storage_key, mime_type,
          size_bytes, transcription_status, ai_status,
          consent_given, consent_at, uploaded_by, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6,
               $7, 'pending', 'pending',
               TRUE, now(), $8, now())
       RETURNING ${FULL_COLUMNS}`,
      [
        recordingId,
        tenantId,
        interviewId,
        file.originalname || 'recording.webm',
        storageKey,
        mime || null,
        file.size,
        userId,
      ]
    );
    const row = insertedRows[0]!;

    // 5) Audit-log binnen dezelfde transactie zodat audit-row + recording-row
    //    samen committen of samen rollbacken.
    await logAudit(
      client,
      tenantId,
      {
        action: 'interview_recording.uploaded',
        entityType: 'interview_recording',
        entityId: recordingId,
        userId,
        after: {
          interview_id: interviewId,
          filename: row.filename,
          size_bytes: row.size_bytes,
          consent_given: true,
        },
      },
      ctx
    );

    return row;
  });

  // 6) Enqueueт transcription job ná COMMIT zodat de worker een verse rij
  //    leest. Failures hier zijn niet-fataal — de rij blijft in 'pending' en
  //    een latere re-trigger (via een endpoint) kan opnieuw enqueueen.
  try {
    await interviewTranscriptionQueue.add('transcribe-recording', {
      recordingId: recording.id,
      tenantId,
    });
  } catch (err) {
    logger.error('[recordings.service] failed to enqueue transcription job', {
      recordingId: recording.id,
      error: (err as Error).message,
    });
  }

  return recording;
}

// ────────────────────────────────────────────────────────────────────────────
// Read-only helpers
// ────────────────────────────────────────────────────────────────────────────

export async function listRecordings(
  tenantId: string,
  interviewId: string
): Promise<InterviewRecording[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<InterviewRecording>(
      `SELECT ${FULL_COLUMNS}
       FROM interview_recordings
       WHERE tenant_id = $1 AND interview_id = $2
       ORDER BY uploaded_at DESC`,
      [tenantId, interviewId]
    );
    return rows;
  });
}

export async function getRecording(
  tenantId: string,
  recordingId: string
): Promise<InterviewRecording> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<InterviewRecording>(
      `SELECT ${FULL_COLUMNS}
       FROM interview_recordings
       WHERE id = $1 AND tenant_id = $2`,
      [recordingId, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'RECORDING_NOT_FOUND', 'Opname niet gevonden');
    }
    return rows[0]!;
  });
}

export async function getTranscript(
  tenantId: string,
  recordingId: string
): Promise<{
  text: string | null;
  summary: string | null;
  strengths: string[] | null;
  concerns: string[] | null;
  recommendation: AiRecommendation | null;
  language: string | null;
  status: TranscriptionStatus;
  ai_status: AiSummaryStatus | null;
}> {
  const rec = await getRecording(tenantId, recordingId);
  return {
    text: rec.transcript_text,
    summary: rec.ai_summary,
    strengths: rec.ai_strengths,
    concerns: rec.ai_concerns,
    recommendation: rec.ai_recommendation,
    language: rec.transcript_language,
    status: rec.transcription_status,
    ai_status: rec.ai_status,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Delete (hard) — verwijdert storage-object én DB-row
// ────────────────────────────────────────────────────────────────────────────

export async function deleteRecording(
  tenantId: string,
  recordingId: string,
  userId: string,
  ctx: AuditContext = {}
): Promise<void> {
  const rec = await getRecording(tenantId, recordingId);

  // Verwijder storage eerst — als dat faalt, behoud de DB-row zodat we kunnen
  // re-tryen. Een orphaned storage-object is erger dan een orphaned DB-row.
  try {
    await getStorage().delete(rec.storage_key);
  } catch (err) {
    logger.warn('[recordings.service] storage.delete failed (continuing)', {
      recordingId,
      storageKey: rec.storage_key,
      error: (err as Error).message,
    });
  }

  await withTenant(tenantId, async (client) => {
    await client.query(
      `DELETE FROM interview_recordings WHERE id = $1 AND tenant_id = $2`,
      [recordingId, tenantId]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: 'interview_recording.deleted',
        entityType: 'interview_recording',
        entityId: recordingId,
        userId,
        before: {
          interview_id: rec.interview_id,
          filename: rec.filename,
        },
      },
      ctx
    );
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Worker support — internal updates by transcription/ai-summary workers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Cross-tenant lookup voor de transcription/ai-summary workers — zij krijgen
 * tenantId via de job-payload, maar willen de rij ook kunnen lezen vóór ze
 * `withTenant` openen. We blijven RLS-veilig zolang de worker uiteindelijk
 * via withTenant schrijft.
 */
export async function getRecordingForWorker(
  tenantId: string,
  recordingId: string
): Promise<InterviewRecording | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<InterviewRecording>(
      `SELECT ${FULL_COLUMNS}
       FROM interview_recordings
       WHERE id = $1 AND tenant_id = $2`,
      [recordingId, tenantId]
    );
    return rows[0] ?? null;
  });
}

export async function setTranscriptionStatus(
  tenantId: string,
  recordingId: string,
  status: TranscriptionStatus,
  error?: string
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `UPDATE interview_recordings
       SET transcription_status = $1,
           transcription_error  = $2
       WHERE id = $3 AND tenant_id = $4`,
      [status, error?.slice(0, 1000) ?? null, recordingId, tenantId]
    );
  });
}

export async function applyTranscript(
  tenantId: string,
  recordingId: string,
  payload: {
    text: string;
    language: string;
    durationSeconds: number;
  }
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `UPDATE interview_recordings
       SET transcript_text       = $1,
           transcript_language   = $2,
           duration_seconds      = COALESCE(duration_seconds, $3),
           transcription_status  = 'done',
           transcription_error   = NULL,
           transcribed_at        = now()
       WHERE id = $4 AND tenant_id = $5`,
      [
        payload.text,
        payload.language,
        payload.durationSeconds,
        recordingId,
        tenantId,
      ]
    );
  });
}

export async function applyAiSummary(
  tenantId: string,
  recordingId: string,
  payload: {
    summary: string;
    strengths: string[];
    concerns: string[];
    recommendation: AiRecommendation;
  }
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `UPDATE interview_recordings
       SET ai_summary        = $1,
           ai_strengths      = $2::text[],
           ai_concerns       = $3::text[],
           ai_recommendation = $4,
           ai_status         = 'done',
           ai_processed_at   = now()
       WHERE id = $5 AND tenant_id = $6`,
      [
        payload.summary,
        payload.strengths,
        payload.concerns,
        payload.recommendation,
        recordingId,
        tenantId,
      ]
    );
  });
}

export async function setAiStatus(
  tenantId: string,
  recordingId: string,
  status: AiSummaryStatus
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `UPDATE interview_recordings
       SET ai_status = $1
       WHERE id = $2 AND tenant_id = $3`,
      [status, recordingId, tenantId]
    );
  });
}
