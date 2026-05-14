/**
 * Interview transcription worker — Sprint Q3.4 (Agent CCC).
 *
 * Pipeline:
 *   1. Lees recording-row + verifieer consent.
 *   2. Markeer transcription_status='processing'.
 *   3. Download audio buffer via storage abstractie.
 *   4. Roep `transcribeAudio(buffer, { language: 'nl', prompt: <context> })`.
 *   5. UPDATE transcript_text + transcript_language + duration_seconds +
 *      transcription_status='done' + transcribed_at=now().
 *   6. Enqueue ai-summary job.
 *   7. Bij failure: status='failed', schrijf error.
 *
 * Logt elke call via `ai_events` (feature='whisper_transcription') voor
 * EU AI Act compliance.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { getStorage } from '../../lib/storage';
import { logger } from '../../middleware/errorHandler';
import { logAIEvent } from '../../lib/aiEvents';
import { transcribeAudio, WHISPER_MODEL } from '../../lib/whisper';
import {
  getRecordingForWorker,
  setTranscriptionStatus,
  applyTranscript,
  setAiStatus,
} from '../../modules/interviews/recordings.service';
import { interviewAiSummaryQueue } from '../queues';

interface InterviewTranscriptionJobData {
  recordingId: string;
  tenantId: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Stream → Buffer (zelfde patroon als resumeParser.worker.ts)
// ────────────────────────────────────────────────────────────────────────────

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk, 'utf8'));
    } else {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
  }
  return Buffer.concat(chunks);
}

// ────────────────────────────────────────────────────────────────────────────
// Job processor
// ────────────────────────────────────────────────────────────────────────────

async function processTranscriptionJob(
  job: Job<InterviewTranscriptionJobData>
): Promise<void> {
  const { recordingId, tenantId } = job.data ?? {};

  if (!recordingId || !tenantId) {
    logger.error('[interviewTranscription] invalide job-payload — drop', {
      jobId: job.id,
      data: job.data,
    });
    return;
  }

  logger.info('[interviewTranscription] start', {
    jobId: job.id,
    recordingId,
    tenantId,
  });

  // 1) Lees rij + consent-check.
  const rec = await getRecordingForWorker(tenantId, recordingId);
  if (!rec) {
    logger.warn('[interviewTranscription] recording niet gevonden — skip', {
      recordingId,
      tenantId,
    });
    return;
  }

  if (!rec.consent_given) {
    logger.warn(
      '[interviewTranscription] consent ontbreekt — markeer als skipped',
      { recordingId }
    );
    await setTranscriptionStatus(
      tenantId,
      recordingId,
      'skipped',
      'consent_given is FALSE — transcriptie geweigerd'
    );
    return;
  }

  if (rec.transcription_status === 'done') {
    logger.info('[interviewTranscription] al getranscribeerd — skip', {
      recordingId,
    });
    return;
  }

  // 2) Markeer 'processing' (eigen tx zodat het niet rollback bij failure).
  await setTranscriptionStatus(tenantId, recordingId, 'processing');

  const aiStartedAt = Date.now();
  try {
    // 3) Download audio.
    const stream = await getStorage().getStream(rec.storage_key);
    const audioBuffer = await streamToBuffer(stream);
    if (audioBuffer.length === 0) {
      throw new Error('Audio-bestand is leeg (0 bytes)');
    }

    // 4) Whisper-call.
    const result = await transcribeAudio(audioBuffer, {
      language: 'nl',
      filename: rec.filename,
      contentType: rec.mime_type ?? undefined,
    });

    // 5) Persist transcript.
    await applyTranscript(tenantId, recordingId, {
      text: result.text,
      language: result.language,
      durationSeconds: result.duration_seconds,
    });

    // 6) AI-events log (best-effort).
    void logAIEvent(tenantId, {
      feature: 'whisper_transcription',
      model: result.mocked ? `${WHISPER_MODEL}-mock` : WHISPER_MODEL,
      provider: 'openai',
      input: `audio:${rec.storage_key}:${audioBuffer.length}b`,
      latencyMs: result.latencyMs ?? Date.now() - aiStartedAt,
      outputSummary: result.text.slice(0, 200),
      entityType: 'interview_recording',
      entityId: recordingId,
      status: result.mocked ? 'mocked' : 'success',
    });

    // 7) Enqueueт AI-summary job.
    try {
      await interviewAiSummaryQueue.add('summarize-interview', {
        recordingId,
        tenantId,
      });
      // Mark ai_status='processing' alvast zodat de UI het kan tonen.
      await setAiStatus(tenantId, recordingId, 'processing');
    } catch (err) {
      logger.error('[interviewTranscription] failed to enqueue ai-summary', {
        recordingId,
        error: (err as Error).message,
      });
    }

    logger.info('[interviewTranscription] done', {
      jobId: job.id,
      recordingId,
      duration_seconds: result.duration_seconds,
      mocked: result.mocked === true,
      text_length: result.text.length,
    });
  } catch (err) {
    const message = (err as Error).message ?? 'onbekende fout';
    logger.error('[interviewTranscription] failed', {
      jobId: job.id,
      recordingId,
      error: message,
    });

    void logAIEvent(tenantId, {
      feature: 'whisper_transcription',
      model: WHISPER_MODEL,
      provider: 'openai',
      input: `audio:${rec.storage_key}:${rec.size_bytes ?? 0}b`,
      latencyMs: Date.now() - aiStartedAt,
      entityType: 'interview_recording',
      entityId: recordingId,
      status: 'failed',
      error: message.slice(0, 1000),
    });

    await setTranscriptionStatus(tenantId, recordingId, 'failed', message);

    // Bij client-side errors (oversize, lege buffer, unsupported format) niet
    // re-throwen — dan triggert BullMQ geen retries. Server/network errors
    // (5xx, ECONNRESET, etc.) WEL re-throwen.
    if (
      /lege audio|te groot|leeg \(0 bytes\)/i.test(message) ||
      /Whisper-limiet/i.test(message)
    ) {
      return;
    }
    throw err;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Worker setup (DISABLE_INLINE_WORKERS-pattern, identiek aan andere workers)
// ────────────────────────────────────────────────────────────────────────────

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let interviewTranscriptionWorker: Worker<InterviewTranscriptionJobData> | null =
  null;

if (!shouldStartWorker) {
  logger.info(
    '[interviewTranscription] inline worker disabled (DISABLE_INLINE_WORKERS=true)'
  );
} else {
  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  if (!process.env.OPENAI_API_KEY) {
    logger.warn(
      '[interviewTranscription] OPENAI_API_KEY ontbreekt — worker draait met hardcoded mock-transcript. ' +
        'Configureer de key vóór productie.'
    );
  }

  interviewTranscriptionWorker = new Worker<InterviewTranscriptionJobData>(
    'interview-transcription',
    processTranscriptionJob,
    { connection, concurrency: 2 }
  );

  interviewTranscriptionWorker.on('completed', (job) => {
    logger.info('[interviewTranscription] Job completed', { jobId: job.id });
  });

  interviewTranscriptionWorker.on('failed', (job, err) => {
    logger.error('[interviewTranscription] Job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });
}

export { interviewTranscriptionWorker };
