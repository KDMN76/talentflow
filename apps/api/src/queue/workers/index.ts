/**
 * Worker entrypoint — used by the dedicated `api-worker` container in
 * `infra/docker-compose.prod.yml`.
 *
 * In production we run the API process and the BullMQ workers in *separate*
 * containers so the request path scales independently from background jobs.
 * The API container runs `node dist/index.js`; the worker container runs
 * `node dist/queue/workers/index.js` (this file).
 *
 * Coordination via two env-vars (Q1.2):
 *   - WORKER_PROCESS=1  → SET HIER, voor de worker-imports. Iedere worker
 *                          checkt dit en start dan ALTIJD, ook als
 *                          DISABLE_INLINE_WORKERS=true elders aan staat.
 *   - DISABLE_INLINE_WORKERS=true → set op de `api` service in
 *                          docker-compose.prod.yml. Iedere worker-file
 *                          checkt dit en skipt de Worker-constructie.
 *
 * Lokaal dev: beide vlaggen leeg → workers starten gewoon inline (default).
 *
 * SIGTERM / SIGINT worden netjes afgehandeld zodat docker-compose graceful
 * shutdowns BullMQ in-flight jobs kunnen laten afmaken (BullMQ workers
 * registreren hun eigen SIGTERM-listeners).
 */

// Set BEFORE worker-imports zodat de guards in de worker-files zien dat we
// in het worker-proces draaien.
process.env.WORKER_PROCESS = '1';

import './resumeParser.worker';
import './emailSender.worker';
import './communications.worker';
import './workflow.worker';
import './embeddings.worker';
import './csvImport.worker';
import './pushNotifications.worker';
import './notificationReminders.worker';
import './inboxSync.worker';
import './talentReactivation.worker';
import './talentFitTrainer.worker';
import './interviewTranscription.worker';
import './interviewAiSummary.worker';
import './interviewCalendarSync.worker';
import './reportSchedule.worker';
import './payEquityDei.worker';
import './webhookDelivery.worker';
import './invoiceOverdue.worker';
import './accountingSync.worker';
import './forecastSnapshot.worker';
import './sourcingAgent.worker';
import './outreachLinkedIn.worker';
import './outreachEmailNurture.worker';
import './passiveMonitor.worker';
import './replyClassification.worker';
import { logger } from '../../middleware/errorHandler';

logger.info('All workers started', {
  workers: [
    'resume-parser',
    'email-sender',
    'communications',
    'workflow',
    'embeddings',
    'csv-import',
    'push-notifications',
    'notification-reminders',
    'inbox-sync',
    'talent-reactivation',
    'talent-fit-trainer',
    'interview-transcription',
    'interview-ai-summary',
    'interview-calendar-sync',
    'report-schedule',
    'pay-equity-dei',
    'webhook-deliveries',
    'invoice-overdue',
    'accounting-sync',
    'forecast-snapshot',
    'sourcing-agent',
    'outreach-linkedin',
    'outreach-email-nurture',
    'passive-monitor',
    'reply-classification',
  ],
});

// Keep the process alive — BullMQ workers register their own listeners
// internally. We just need to stay up and let them run.
process.on('SIGTERM', () => {
  logger.info('Worker process received SIGTERM, shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Worker process received SIGINT, shutting down');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception in worker process', {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection in worker process', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});
