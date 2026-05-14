import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../middleware/errorHandler';

// ─── Job data shapes ─────────────────────────────────────────────────────────

export interface SendEmailJobData {
  tenantId: string;
  candidateId: string;
  communicationId: string;
  to: string;
  subject?: string;
  body: string;
}

export interface SendWhatsAppJobData {
  tenantId: string;
  candidateId: string;
  communicationId: string;
  to: string;
  body: string;
}

export interface SendSmsJobData {
  tenantId: string;
  candidateId: string;
  communicationId: string;
  to: string;
  body: string;
}

export type CommunicationsJobData =
  | SendEmailJobData
  | SendWhatsAppJobData
  | SendSmsJobData;

// ─── Job processor ───────────────────────────────────────────────────────────

async function processCommunicationsJob(job: Job<CommunicationsJobData>): Promise<unknown> {
  logger.info('[communications] Processing job', { jobId: job.id, jobName: job.name });

  switch (job.name) {
    case 'send-email': {
      const data = job.data as SendEmailJobData;
      logger.info('[communications] Sending email to...', {
        to: data.to,
        subject: data.subject,
        candidateId: data.candidateId,
        communicationId: data.communicationId,
        // TODO Phase 2: integrate with SMTP / Resend / SendGrid
        stub: true,
      });
      // Placeholder: simulate send latency
      await new Promise(resolve => setTimeout(resolve, 100));
      return { sent: false, stub: true, channel: 'email' };
    }

    case 'send-whatsapp': {
      const data = job.data as SendWhatsAppJobData;
      logger.info('[communications] Sending WhatsApp to...', {
        to: data.to,
        candidateId: data.candidateId,
        communicationId: data.communicationId,
        // TODO Phase 2: integrate with Twilio WhatsApp API
        stub: true,
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      return { sent: false, stub: true, channel: 'whatsapp' };
    }

    case 'send-sms': {
      const data = job.data as SendSmsJobData;
      logger.info('[communications] Sending SMS to...', {
        to: data.to,
        candidateId: data.candidateId,
        communicationId: data.communicationId,
        // TODO Phase 2: integrate with Twilio SMS / MessageBird
        stub: true,
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      return { sent: false, stub: true, channel: 'sms' };
    }

    default:
      logger.warn('[communications] Unknown job name — skipping', { jobName: job.name });
      return { skipped: true };
  }
}

// ─── Worker setup ─────────────────────────────────────────────────────────────

// DISABLE_INLINE_WORKERS guard — zie resumeParser.worker.ts voor details.
const isWorkerProcess = process.env.WORKER_PROCESS === '1';
const inlineDisabled = process.env.DISABLE_INLINE_WORKERS === 'true';
const shouldStartWorker = isWorkerProcess || !inlineDisabled;

let communicationsWorker: Worker<CommunicationsJobData> | null = null;

if (!shouldStartWorker) {
  logger.info(
    '[communications] inline worker disabled (DISABLE_INLINE_WORKERS=true)'
  );
} else {
  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  communicationsWorker = new Worker<CommunicationsJobData>(
    'communications',
    processCommunicationsJob,
    { connection }
  );

  communicationsWorker.on('completed', (job) => {
    logger.info('[communications] Job completed', { jobId: job.id, jobName: job.name });
  });

  communicationsWorker.on('failed', (job, err) => {
    logger.error('[communications] Job failed', {
      jobId: job?.id,
      jobName: job?.name,
      error: err.message,
    });
  });
}

export { communicationsWorker };
