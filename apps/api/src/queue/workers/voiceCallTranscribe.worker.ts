/**
 * Voice call transcription worker — Sprint Q4.6 (Agent AAAA).
 *
 * Payload: `{ tenantId, callId }`. Calls `voice.service.requestTranscription`
 * which handles Whisper invocation + mock-mode fallback.
 *
 * 2 attempts: Whisper transient 5xx is retried once. attempts=2 keeps the
 * budget tight — permanent failures are stored as `transcription_status='failed'`.
 */

import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../middleware/errorHandler';
import { requestTranscription } from '../../modules/voice/voice.service';

interface JobData {
  tenantId: string;
  callId: string;
}

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

async function processJob(job: Job<JobData>): Promise<unknown> {
  const { tenantId, callId } = job.data;
  logger.info('[voiceCallTranscribe] processing', { jobId: job.id, callId });
  try {
    const call = await requestTranscription(tenantId, callId);
    return {
      callId: call.id,
      status: call.transcription_status,
      length: call.transcription_text?.length ?? 0,
    };
  } catch (err) {
    logger.error('[voiceCallTranscribe] failed', {
      callId,
      error: (err as Error).message,
    });
    throw err;
  }
}

const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let voiceCallTranscribeWorker: Worker<JobData> | null = null;

if (!shouldStartWorker) {
  logger.info('[voiceCallTranscribe] inline worker disabled');
} else {
  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  voiceCallTranscribeWorker = new Worker<JobData>(
    'voice-call-transcribe',
    processJob,
    { connection }
  );
}

export { voiceCallTranscribeWorker };
