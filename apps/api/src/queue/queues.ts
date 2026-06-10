import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const redis = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redis.on('error', (err) => {
  // Log but don't crash — Redis is used for queues and rate limiting
  // which are non-critical for basic functionality
  console.error('[Redis] Connection error:', err.message);
});

const queueConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

queueConnection.on('error', (err) => {
  // Zelfde principe als hierboven: een Redis-storing (bv. Upstash-quota vol)
  // mag queues degraderen, maar NIET het hele API-proces neerhalen. Zonder
  // deze handler is een 'error'-event op een EventEmitter fataal in Node.
  console.error('[Redis:queues] Connection error:', err.message);
});

export const resumeParserQueue = new Queue('resume-parser', {
  connection: queueConnection,
  defaultJobOptions: {
    // AI-parsing is duur — beperk retries tot 2 (1 initial + 1 retry).
    attempts: 2,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export const emailSenderQueue = new Queue('email-sender', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export const workflowEventsQueue = new Queue('workflow-events', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

/**
 * Embeddings queue — Slice 4 (AI matching).
 *
 * Job-types: `embed-candidate`, `embed-job`. Worker leest entiteit, bouwt de
 * embedding-tekst, vraagt OpenAI text-embedding-3-small en schrijft de
 * 1536-dim vector + embedding_updated_at terug. RLS-veilig via withTenant.
 */
export const embeddingsQueue = new Queue('embeddings', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

/**
 * CSV import queue — Sprint Q1.2.
 *
 * Job-types: `import-candidates`. Worker leest CSV uit storage, batch-inserts
 * 100 rijen tegelijk, update csv_imports.processed_rows, dedupliceert op email.
 * Limit attempts to 1: bij failure willen we de partial state behouden zodat
 * de gebruiker errors kan inspecteren — niet stilletjes opnieuw proberen.
 */
export const csvImportQueue = new Queue('csv-import', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

/**
 * Push notifications queue — Sprint Q2.4.
 *
 * Job-types: per-user push events. Worker checkt preferences, list active
 * subs, stuurt via web-push. Bij quiet-hours scheduled de worker de job
 * door tot het einde van het quiet-venster (delay).
 *
 * 3 retries voor netwerk-glitches; expired-subs worden niet retried (worker
 * verwijdert ze direct).
 */
export const pushNotificationsQueue = new Queue('push-notifications', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1500 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});

/**
 * Notification reminders queue — Sprint Q2.4.
 *
 * Repeatable cron: hourly + daily-digest. Job dispatcht enqueue-events
 * naar pushNotificationsQueue voor relevante users.
 */
export const notificationRemindersQueue = new Queue('notification-reminders', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 50,
    removeOnFail: 50,
  },
});

/**
 * Inbox-sync queue — Sprint Q3.1.
 *
 * Repeatable cron `*\/5 * * * *` — leest mailbox_integrations met active=TRUE
 * en haalt nieuwe messages op via Gmail historyId / Outlook deltaLink.
 *
 * Per provider:
 *   - Gmail: 250 quota-units/sec/user → veilig.
 *   - Outlook: 10k req / 10min → veilig (per user 1 cycle = ~3 req).
 *
 * 5-min cadence is conservatief; recruiters verwachten geen <1min latency
 * voor mail-replies. Voor near-realtime kan later push-notifications
 * (Gmail watch, Outlook subscription) gebruikt worden.
 */
export const inboxSyncQueue = new Queue('inbox-sync', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

/**
 * Bulk-mail queue — Sprint Q3.1.
 *
 * Aparte queue voor bulk-campagne emails om de transactional emailSenderQueue
 * niet te verstoppen. Rate-limit per worker = 1 job/sec/integration via
 * BullMQ delay (geconfigureerd in bulkCampaign.service.ts).
 *
 * Globale concurrency hier laag (5) zodat we per-provider quotas niet halen.
 */
export const bulkMailQueue = new Queue('bulk-mail', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 200,
    removeOnFail: 1000,
  },
});

/**
 * Talent reactivation queue — Sprint Q3.2.
 *
 * Repeatable cron `0 2 * * *` (02:00 nightly) — scant per tenant met active
 * jobs welke archived/rejected kandidaten alsnog hoog matchen via pgvector
 * cosine-similarity. Schrijft alerts naar `talent_reactivation_alerts` en
 * stuurt 1 samenvatting-email per recruiter per nacht.
 *
 * attempts=1: bij failure willen we niet opnieuw proberen — dezelfde nacht
 * draaien levert dubbele e-mails op, en de volgende nacht corrigeert de
 * UNIQUE-constraint vanzelf.
 */
export const talentReactivationQueue = new Queue('talent-reactivation', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 50,
    removeOnFail: 50,
  },
});

/**
 * Talent-Fit trainer queue — Sprint Q3.3.
 *
 * Repeatable cron `0 4 * * 0` (zondag 04:00 wekelijks) — trains per active
 * tenant een logistic-regression op applications-history. Pure JS, in-process
 * (geen Python/native deps). Tenants zonder voldoende data (<20 hires of
 * <20 rejects) worden geskipt en gaudit-logged.
 *
 * attempts=1: trainer is deterministisch + idempotent (deactiveert eerdere
 * active model in dezelfde tx). Bij failure log + Sentry — geen retry storm.
 */
export const talentFitTrainerQueue = new Queue('talent-fit-trainer', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 20,
    removeOnFail: 50,
  },
});

/**
 * Interview reminders queue — Sprint Q3.4 (AI Interview Suite).
 *
 * Bij scheduleInterview enqueuen we 2 delayed jobs (24u en 1u voor
 * `scheduled_start`) die per participant een reminder-email sturen via de
 * bestaande emailSenderQueue. Bij cancel/reschedule wordt de bestaande
 * job-set obsolete: de worker controleert vóór elke send of het interview
 * nog steeds `scheduled` is.
 *
 * attempts=2: één retry voor netwerkglitches, geen retry-storms wanneer
 * een mail-provider rejected — Sentry vangt dat permanent op.
 */
export const interviewRemindersQueue = new Queue('interview-reminders', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

/**
 * Interview-transcription queue — Sprint Q3.4 (Agent CCC).
 *
 * Job-types: `transcribe-recording`. Worker downloadt audio uit storage,
 * stuurt naar Whisper, schrijft transcript_text + transcription_status='done'
 * en enqueueт vervolgens een `interview-ai-summary` job zodat Claude een
 * samenvatting + sterktes/zorgen genereert.
 *
 * 2 retries: Whisper-API kan transient 5xx geven; bij 4xx (oversize, onleesbaar)
 * willen we niet eindeloos retryen — workers detecteren die zelf en markeren
 * als 'failed' zonder re-throw.
 */
export const interviewTranscriptionQueue = new Queue('interview-transcription', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

/**
 * Interview AI-summary queue — Sprint Q3.4 (Agent CCC).
 *
 * Job-types: `summarize-interview`. Worker leest transcript_text + interview-
 * context en vraagt Claude een gestructureerde samenvatting (summary,
 * strengths, concerns, recommendation).
 */
export const interviewAiSummaryQueue = new Queue('interview-ai-summary', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

/**
 * Calendar-sync queue — Sprint Q3.4 (Agent CCC).
 *
 * Repeatable cron (default elke 10 min) — voor elke linked
 * `interview_calendar_events`-row checkt de worker of het remote event nog
 * bestaat / van tijd is veranderd, en update de lokale interview-state
 * accordingly. attempts=1: cron draait toch elke 10 min opnieuw.
 */
export const interviewCalendarSyncQueue = new Queue('interview-calendar-sync', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

/**
 * Report-schedule queue — Sprint Q3.5 (Agent GGG).
 *
 * Repeatable cron `0 * * * *` (elk uur op het hele uur) — scant alle reports
 * met schedule IS NOT NULL en draait degenen die NU due zijn in hun
 * tenant-timezone. Per due rapport: aggregator → exporter → email-worker
 * (resend) met attachment.
 *
 * attempts=1: cron retry-en heeft geen zin (volgende uur draait toch). Bij
 * fatale error per rapport vangen we lokaal en loggen — andere rapporten
 * mogen niet falen vanwege één bad config.
 */
export const reportScheduleQueue = new Queue('report-schedule', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

/**
 * Skills-snapshot queue — Sprint Q3.6 (Agent HHH).
 *
 * Repeatable cron `0 1 * * 1` (maandag 01:00 UTC) — per tenant aggregaat
 * candidate_count/job_demand/hire_count per ESCO-skill voor de afgelopen week
 * en INSERT in skills_trending_snapshots.
 *
 * attempts=1: cron draait volgende week opnieuw. Idempotent via UNIQUE
 * (tenant, esco_skill, week_starting) + ON CONFLICT DO UPDATE in de worker.
 */
export const skillsSnapshotQueue = new Queue('skills-snapshot', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 20,
    removeOnFail: 50,
  },
});

/**
 * Skills-refresh queue — Sprint Q3.6 (Agent HHH).
 *
 * On-demand: na een candidate/job CREATE/UPDATE kan caller een lichte refresh
 * enqueuen die `syncCandidateSkillsToEsco` of `syncJobSkillsToEsco` draait.
 */
export const skillsRefreshQueue = new Queue('skills-refresh', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

/**
 * Pay-equity + DEI funnel snapshot queue — Sprint Q3.6 (Agent III).
 *
 * Repeatable cron `0 5 1 *\/3 *` (1ste van elk kwartaal 05:00 UTC). Per tick
 * scant de worker alle tenants, genereert per tenant `pay_equity_snapshots`
 * + `dei_funnel_snapshots` over het afgelopen kwartaal en e-mailt de
 * admin-users een notificatie.
 *
 * attempts=1: cron herhaalt zich elk kwartaal. Een gemiste run geeft een
 * gat in de history-data — maar dubbele runs zouden dubbele snapshots
 * creëren (geen UNIQUE-constraint omdat dezelfde periode opnieuw berekend
 * mag worden). Per-tenant try/catch isoleert failures.
 */
export const payEquityDeiQueue = new Queue('pay-equity-dei', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 20,
    removeOnFail: 50,
  },
});

/**
 * Job-board POST queue — Sprint Q4.3 (Agent QQQ).
 *
 * Producers (service.ts → enqueuePosting) leggen een job met
 * `{ tenantId, postingId, boardId }` neer. Worker
 * (jobBoardPost.worker.ts) laadt de posting + integration, normaliseert de
 * job, en delegeert naar de connector.post(). Bij failure → status='failed'
 * + throw zodat BullMQ exponential backoff toepast.
 */
export const jobBoardPostQueue = new Queue('job-board-post', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 200,
    removeOnFail: 1000,
  },
});

/**
 * Job-board POLL queue — Sprint Q4.3 (Agent QQQ).
 *
 * Periodieke scheduler enqueuet één job per actieve posting (zie
 * jobBoardPoll.worker.ts). Per-job: connector.pollStatus() → update
 * `applicants_count` + status-event bij wijziging. Geen retries — als de
 * volgende cron-tick verschijnt, lopen we de posting alsnog langs.
 */
export const jobBoardPollQueue = new Queue('job-board-poll', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 200,
    removeOnFail: 200,
  },
});

/**
 * Contract-expiry queue — Sprint Q4.4 (Agent TTT).
 *
 * Repeatable cron `0 6 * * *` (06:00 UTC nightly). Per tick:
 *   1. Flip `active` contracts past `end_date` → `ended`.
 *   2. Re-schedule notification queue voor alle actieve contracts.
 *   3. Pick today's `contract_notification_queue` rows en delegate naar
 *      `email-sender` voor candidate + client + recruiter.
 *
 * attempts=1: bij failure draait de cron de volgende dag opnieuw. Idempotent
 * via UNIQUE-constraint op (tenant, contract, notification_type) en sent_at-
 * check vóór het versturen.
 */
export const contractExpiryQueue = new Queue('contract-expiry', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 30,
    removeOnFail: 100,
  },
});

/**
 * Outreach LinkedIn worker queue — Sprint Q4.5 (Agent XXX).
 *
 * Per outreach_messages-row met channel='linkedin_inmail' of
 * 'linkedin_connection' wordt één job geënqueued op approveMessage. De worker
 * (outreachLinkedIn.worker.ts) doet een mock LinkedIn-call (95% success rate)
 * tenzij `LINKEDIN_OUTREACH_LIVE === 'true'` — dan TODO(real-api) implementatie.
 *
 * 3 attempts met exponential backoff want LinkedIn-API geeft soms 429 onder
 * load. Status-update naar `sent`/`failed` gaat via outreach.service.sendMessage
 * zodat quota-checks en audit-logging consistent blijven.
 */
export const outreachLinkedInQueue = new Queue('outreach-linkedin', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});

/**
 * Outreach email-nurture queue — Sprint Q4.5 (Agent XXX).
 *
 * Aparte queue van bulk-mail (Q3.1) en transactional email-sender (Slice 3)
 * zodat outreach-volume niet de happy-path emails verstopt. De worker
 * (outreachEmailNurture.worker.ts) wrapt de bestaande emailSenderQueue met een
 * outreach_messages-correlation-id zodat sender de external_id terug kan
 * schrijven via UPDATE outreach_messages.
 */
export const outreachEmailNurtureQueue = new Queue('outreach-email-nurture', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});

/**
 * Nurture-advance queue — Sprint Q4.5 (Agent XXX).
 *
 * Repeatable cron `*\/5 * * * *` — elke 5 min scant de worker per tenant
 * `nurture_enrollments` met `status='active' AND next_send_at <= now()`. Voor
 * elke match drafts hij de volgende stap via outreach.service en plant 'm in.
 *
 * attempts=1: cron draait toch elke 5 min opnieuw. Idempotent door
 * `current_step_order` lookahead — een gemiste run produceert geen dubbele
 * messages omdat de service-laag de step-row checkt voor het inserten.
 */
export const nurtureAdvanceQueue = new Queue('nurture-advance', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

/**
 * Passive monitoring queue — Sprint Q4.5 (Agent XXX).
 *
 * Repeatable cron `0 3 * * *` (03:00 nightly) — per tenant scan kandidaten
 * voor job-change/title-change signalen. Mock-mode tenzij
 * `LINKEDIN_MONITOR_LIVE === 'true'` (legally restricted in EU; documented).
 *
 * Bij job_change + consent + recently active → drafted reactivation outreach
 * (status `pending_approval` zodat recruiter altijd 'm reviewed).
 */
export const passiveMonitorQueue = new Queue('passive-monitor', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 30,
    removeOnFail: 100,
  },
});

/**
 * Reply classification queue — Sprint Q4.5 (Agent XXX).
 *
 * Per inbound `outreach_messages` row enqueued. Worker calls Claude (or mock
 * heuristic) and inserts a `reply_classifications` row, then triggers
 * applyNextAction. attempts=2 — Claude transient errors retry-bar.
 */
export const replyClassificationQueue = new Queue('reply-classification', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

/**
 * Webhook deliveries queue — Sprint Q4.1 (Agent LLL).
 *
 * Per outgoing webhook delivery wordt één job geënqueued. De worker (zie
 * webhookDelivery.worker.ts) doet HTTP POST met HMAC-signature, 10s timeout,
 * en marked de delivery-row als succeeded/failed/dead.
 *
 * Retry-policy via deliveries.service zelf (custom backoff: 1m, 5m, 30m, 2h,
 * 6h, max 5 attempts → dead). We laten BullMQ NIET zelf retryen — anders
 * lopen onze attempt-counters in de DB uit de pas met BullMQ's eigen counter.
 * attempts=1: één keer poging, daarna laat de worker zelf een nieuwe job
 * inplannen (`queue.add(..., { delay })`) als hij wil retryen.
 */
export const webhookDeliveriesQueue = new Queue('webhook-deliveries', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});

/**
 * Sourcing-agent queue — Sprint Q4.5 (Agent WWW).
 *
 * Job-types:
 *   - `sourcing-agent-run` { tenantId, runId } → worker runt `runSearchAgent`
 *     tegen de gekoppelde brief. Bij succes wordt de run op `review_required`
 *     gezet zodat de recruiter de findings kan inspecteren.
 *   - `sourcing-agent-stale-sweep` (repeatable cron, default elke 15 min)
 *     auto-closet runs die langer dan `tenant_settings.sourcing_auto_close_days`
 *     in `review_required` blijven hangen.
 *
 * attempts=2: één retry voor transient Anthropic / source-API failures. Bij
 * tweede failure markeert de worker de run zelf als `failed` met een
 * error_message — geen retry-storm.
 */
export const sourcingAgentQueue = new Queue('sourcing-agent', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

/**
 * WhatsApp outbound queue — Sprint Q4.6 (Agent ZZZ).
 *
 * Per outbound `whatsapp_messages` row a job `{ tenantId, whatsappMessageId }`
 * is queued. The worker (whatsappOut.worker.ts) calls
 * `messaging.service.dispatchOutboundSend` which decrypts the API key, posts
 * to 360dialog, and updates the row + paired communications row.
 *
 * 3 attempts with exponential backoff — 360dialog occasionally returns 429
 * under quality-rating throttles.
 */
export const whatsappOutQueue = new Queue('whatsapp-out', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});

/**
 * WhatsApp health-check queue — Sprint Q4.6 (Agent ZZZ).
 *
 * Repeatable cron `0 5 * * *` (05:00 UTC daily) — per active integration the
 * worker re-fetches account info from 360dialog and updates quality_rating
 * + messaging_limit. Surfaces quality drops so recruiters notice before
 * Meta downgrades them.
 */
export const whatsappHealthCheckQueue = new Queue('whatsapp-health-check', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 30,
    removeOnFail: 100,
  },
});

/**
 * Voice call transcription queue — Sprint Q4.6 (Agent AAAA).
 *
 * Triggered by the Twilio recording-complete webhook (or directly via
 * POST /api/voice/calls/:id/transcribe). Worker downloads the recording,
 * calls Whisper, persists `transcription_text` + `transcription_status='done'`.
 *
 * 2 attempts: Whisper occasionally returns transient 5xx. attempts=2 keeps
 * the retry budget tight; permanent failures get audit-logged as `failed`.
 */
export const voiceCallTranscribeQueue = new Queue('voice-call-transcribe', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

/**
 * Inbox projector queue — Sprint Q4.6 (Agent AAAA).
 *
 * Optional async fan-out: channel-writers that don't want to block on the
 * `unified_threads` upsert can `enqueueInboxProjection({...})` and the
 * worker (inboxProjector.worker.ts) will replay the event back through
 * `lib/inboxProjector.recordCommunication`. The synchronous eventBus path
 * is the primary route — this queue exists for back-pressure-safe handoff.
 */
export const inboxProjectorQueue = new Queue('inbox-projector', {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});
