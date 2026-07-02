import 'dotenv/config';

// ── Sentry MUST init before any other module that could throw, so that
// auto-instrumentation (http/express via OpenTelemetry) can wrap them.
// Sentry v8 dropped `Sentry.Handlers.requestHandler` — request context is
// captured automatically once Sentry.init runs early. Error handling is
// wired at the bottom of the middleware chain via `setupExpressErrorHandler`.
import { initSentry, Sentry } from './lib/sentry';
initSentry();

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { logger, errorHandler } from './middleware/errorHandler';
import { apiRateLimit } from './middleware/rateLimit';

import authRouter from './modules/auth/auth.router';
import tenantsRouter from './modules/tenants/tenants.router';
import usersRouter from './modules/users/users.router';
import candidatesRouter from './modules/candidates/candidates.router';
import jobsRouter from './modules/jobs/jobs.router';
import pipelineRouter from './modules/pipeline/pipeline.router';
import dashboardRouter from './modules/dashboard/dashboard.router';
import analyticsRouter from './modules/analytics/analytics.router';
import communicationsRouter from './modules/communications/communications.router';
import apiKeysRouter, { apiExplorerRouter } from './modules/api-keys/api-keys.router';
import webhooksRouter from './modules/webhooks/webhooks.router';
import workflowsRouter from './modules/workflows/workflows.router';
import crmRouter from './modules/crm';
import portalRouter from './modules/portal/portal.router';
import careerPagesRouter from './modules/career-pages/career-pages.router';
import hmRouter from './modules/hm/hm.router';
import jobBoardsRouter from './modules/job-boards/routes';
// Sprint Q4.3 (Job Boards — Agent RRR): public XML feed for Nationale
// Vacaturebank scraping. NO auth — UWV hits this anonymously.
import jobBoardsPublicFeedRouter from './modules/job-boards/publicFeedRoutes';
import emailTemplatesRouter from './modules/email-templates/email-templates.router';
import emailInboundRouter from './modules/email-inbound/email-inbound.router';
import matchingRouter from './modules/matching/matching.router';
import exportsRouter from './modules/exports/exports.router';
import savedSearchesRouter from './modules/saved-searches/savedSearches.router';
import customFieldsRouter from './modules/custom-fields/customFields.router';
import jobTemplatesRouter from './modules/jobs/jobTemplates.router';
import {
  applicationsScorecardsRouter,
  scorecardsRouter,
} from './modules/scorecards/scorecards.router';
import complianceRouter from './modules/compliance/compliance.router';
import candidatesComplianceRouter from './modules/compliance/candidates-compliance.router';
import selfServiceRouter from './modules/compliance/self-service.router';
import notificationsRouter from './modules/notifications/notifications.router';
import integrationsRouter from './modules/integrations/integrations.router';
import {
  interviewsRouter,
  interviewKitsRouter,
  applicationsAgreementMatrixRouter,
} from './modules/interviews/interviews.router';
import { interviewRecordingsRouter } from './modules/interviews/recordings.router';
import reportsRouter, { reportsPublicRouter } from './modules/reports/reports.router';
import {
  skillsRouter,
  candidatesSkillsRouter,
  jobsSkillsRouter,
} from './modules/skills/skills.router';
import {
  rolesRouter,
  adminRolesRouter,
  permissionsRouter,
} from './modules/roles/roles.router';
import { enforceIpAllowlist } from './middleware/ipAllowlist';

// ─── Sprint Q4.2 — SSO/SAML + SCIM (Agent NNN) ─────────────────────────────
import { ssoPublicRouter, ssoAdminRouter } from './modules/auth/sso.controller';
import scimRouter from './modules/auth/scim.controller';

// ─── Sprint Q4.4 — Temp/contract back-office (Agent TTT) ───────────────────
import contractsRouter from './modules/contracts/contracts.routes';
import timesheetsRouter from './modules/timesheets/timesheets.routes';
import publicTimesheetsRouter from './modules/timesheets/publicTimesheetRoutes';

// ─── Sprint Q4.4 — Billing/Accounting/Commissions/Forecasting (Agent UUU) ──
import invoicingRouter from './modules/billing/invoicing.routes';
import accountingRouter from './modules/accounting/accounting.routes';
import commissionsRouter from './modules/commissions/commissions.routes';
import forecastingRouter from './modules/forecasting/forecasting.routes';

// ─── Sprint Q4.5 — Agentic AI Sourcing (Agent WWW) ─────────────────────────
import sourcingRouter from './modules/sourcing/sourcing.routes';

// ─── Sprint Q4.5 — Outreach orchestration (Agent XXX) ──────────────────────
import outreachRouter from './modules/outreach/outreach.routes';
import outreachInboundWebhookRouter from './modules/outreach/inboundWebhook.routes';
import nurtureRouter from './modules/nurture/nurture.routes';

// ─── Sprint Q4.6 — Omni-channel inbox + voice/VoIP (Agent AAAA) ────────────
import inboxRouter from './modules/inbox/inbox.routes';
import voiceRouter from './modules/voice/voice.routes';
import twilioWebhookRouter from './modules/voice/twilioWebhookRoutes';

// ─── Sprint Q4.6 — WhatsApp Business (Agent ZZZ) ───────────────────────────
import whatsappRouter from './modules/whatsapp/whatsapp.routes';
import whatsappPublicConsentRouter from './modules/whatsapp/publicConsentRoutes';
import whatsappWebhookRouter from './modules/whatsapp/webhookRoutes';
import { installInboxProjectorSubscriber } from './lib/inboxProjector';
installInboxProjectorSubscriber();

// Start workers (non-blocking — they listen in the background)
import './queue/workers/resumeParser.worker';
import './queue/workers/emailSender.worker';
import './queue/workers/communications.worker';
import './queue/workers/workflow.worker';
import './queue/workers/embeddings.worker';
import './queue/workers/csvImport.worker';
import './queue/workers/retention.worker';
import './queue/workers/pushNotifications.worker';
import './queue/workers/notificationReminders.worker';
import './queue/workers/inboxSync.worker';
import './queue/workers/talentReactivation.worker';
import './queue/workers/talentFitTrainer.worker';
import './queue/workers/interviewTranscription.worker';
import './queue/workers/interviewAiSummary.worker';
import './queue/workers/interviewCalendarSync.worker';
import './queue/workers/reportSchedule.worker';
import './queue/workers/payEquityDei.worker';
import './queue/workers/skillsSnapshot.worker';
import './queue/workers/webhookDelivery.worker';
import './queue/workers/jobBoardPost.worker';
import './queue/workers/jobBoardPoll.worker';
import './queue/workers/contractExpiry.worker';
import './queue/workers/invoiceOverdue.worker';
import './queue/workers/accountingSync.worker';
import './queue/workers/forecastSnapshot.worker';
import './queue/workers/outreachLinkedIn.worker';
import './queue/workers/outreachEmailNurture.worker';
import './queue/workers/passiveMonitor.worker';
import './queue/workers/replyClassification.worker';
import './queue/workers/sourcingAgent.worker';
import './queue/workers/whatsappOut.worker';
import './queue/workers/whatsappHealthCheck.worker';
import './queue/workers/voiceCallTranscribe.worker';
import './queue/workers/inboxProjector.worker';

// Dev-vangrail: de 35 queue-workers maken eigen ioredis-connecties zonder
// error-handlers. Eén Redis-storing (bv. Upstash dev-quota vol) werd dan een
// fataal uncaught 'error'-event of unhandled rejection en haalde de hele API
// neer. In dev loggen we en blijven we draaien (queues degraderen); productie
// behoudt fail-fast zodat echte bugs daar niet stilletjes doorsudderen.
if (process.env.NODE_ENV !== 'production') {
  process.on('uncaughtException', (err) => {
    console.error('[dev-guard] uncaughtException (proces blijft draaien):', err.message);
  });
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error('[dev-guard] unhandledRejection (proces blijft draaien):', msg);
  });
}

const app = express();
const PORT = parseInt(process.env.PORT ?? '4000', 10);

// Achter de Nginx reverse-proxy op de VPS staat de echte client-IP in
// `X-Forwarded-For`. Zonder dit ziet Express elke request als loopback
// (127.0.0.1), telt express-rate-limit al het verkeer op één IP, en spamt
// het een `ValidationError: X-Forwarded-For ... trust proxy is false`.
// `1` = vertrouw precies één proxy-hop (de Nginx ervoor).
app.set('trust proxy', 1);

// ── Security ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  // Rate-limit-headers zichtbaar maken voor de browser-client (login-UX:
  // resterende pogingen + retry-countdown). Zonder exposedHeaders kan axios
  // deze cross-origin niet lezen.
  exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'],
}));

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Static uploads ───────────────────────────────────────────────────────────
app.use('/uploads', express.static('uploads'));

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use('/api', apiRateLimit);

// ── IP-allowlist (Sprint Q4.2 — Agent OOO) ───────────────────────────────────
// Per-tenant allowlist enforcement. Mount op /api zodat alleen API-requests
// gechecked worden (niet /health, niet /api-docs). De middleware skipped
// expliciet pre-auth paden (/api/auth/*) en doet soft-fail bij DB-issues
// zodat een kapot security_settings-pad niet de app down brengt.
app.use('/api', enforceIpAllowlist);

// ── Health check ─────────────────────────────────────────────────────────────
// Beide paden registreren — `/health` voor de Docker HEALTHCHECK (geen `/api`
// prefix nodig binnen de container) en `/api/health` voor publieke uptime-
// monitors die door de host-Nginx vhost komen (alleen `/api/*` is ge-routet).
//
// Sub-fase 2A (shared contracts proof-of-concept): we serializen het response-
// object EN valideren het tegen `HealthCheckSchema` uit `@talentflow/contracts`.
// Dit bewijst end-to-end dat één Zod-schema beide kanten van de wire dekt en
// vangt drift fail-fast in dev/test mode op (response-validatie is een opt-in
// via NODE_ENV !== 'production' zodat productie geen onnodige CPU-cycles
// gebruikt).
import { HealthCheckSchema, type HealthCheck } from '@talentflow/contracts';

const HEALTH_BOOT_TS = Date.now();
const healthHandler = (_req: express.Request, res: express.Response) => {
  const payload: HealthCheck = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - HEALTH_BOOT_TS) / 1000),
  };
  if (process.env.NODE_ENV !== 'production') {
    HealthCheckSchema.parse(payload); // dev-mode contract guard
  }
  res.json(payload);
};
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// One-shot startup log dat het shared schema überhaupt geladen is + werkt.
// Logged één keer bij boot — als de import of parse breekt, faalt de app
// meteen ipv pas bij de eerste request.
logger.info('[contracts] @talentflow/contracts geladen — HealthCheckSchema OK', {
  schemaKeys: Object.keys(HealthCheckSchema.shape),
});

// ── OpenAPI / Swagger UI ─────────────────────────────────────────────────────
// Pillar 3 (Sprint Q4.1): API standaard open op alle plannen — geen auth.
// Spec + UI + Postman-export zijn publiek bereikbaar zodat third-parties zonder
// account de API kunnen verkennen.
//
// Imports zijn lazy om circulariteit met /api/* routes te voorkomen — we
// importeren synchronous, maar de route-spec-files zijn pure data en doen
// geen runtime-zaken anders dan registreren bij de registry.
import {
  getOpenApiSpec,
  getPostmanCollection,
  swaggerMiddleware,
  swaggerHandler,
} from './lib/openapi';

app.get('/api-docs/openapi.json', (_req, res) => {
  res.json(getOpenApiSpec());
});
app.get('/api-docs/openapi.yaml', (_req, res) => {
  // Lichte YAML-emitter ontbreekt — JSON is canoniek. Geen yaml-dep om de
  // dependency-tree slank te houden.
  res
    .status(501)
    .json({
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'YAML export niet beschikbaar — gebruik /api-docs/openapi.json',
      },
    });
});
app.get('/api-docs/postman.json', (_req, res) => {
  res
    .setHeader(
      'Content-Disposition',
      'attachment; filename="talentflow-api.postman_collection.json"'
    )
    .json(getPostmanCollection());
});
// swagger-ui-express ships its own copy of @types/express-serve-static-core in
// the monorepo, dat strict-conflict geeft met onze eigen express types. De
// runtime-shape is identiek; we casten naar `any` voor de TS-check.
app.use(
  '/api-docs',
  ...(swaggerMiddleware as unknown as express.RequestHandler[]),
  swaggerHandler as unknown as express.RequestHandler
);

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/users', usersRouter);
app.use('/api/candidates', candidatesRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/communications', communicationsRouter);
app.use('/api/api-keys', apiKeysRouter);
app.use('/api/api-explorer', apiExplorerRouter);
// Public webhook endpoints — moeten VOOR de auth-protected webhooksRouter
// staan zodat requireAuth ze niet afwijst. Resend signature is HMAC-verified
// in de inbound-controller zelf.
app.use('/api/webhooks', emailInboundRouter);
// Sprint Q4.5 (Outreach reply webhook — Agent XXX): public, HMAC-signed.
app.use('/api/webhooks', outreachInboundWebhookRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/crm', crmRouter);
app.use('/api/portals', portalRouter);
app.use('/api/career-pages', careerPagesRouter);
app.use('/api/hm', hmRouter);
app.use('/api/job-boards', jobBoardsRouter);
// Public XML feeds (Vacaturebank). Mount BEFORE auth-gated routers so the
// scraper hits an anonymous endpoint. Path matches existing /api/public/*
// convention used by career-pages.
app.use('/api/public', jobBoardsPublicFeedRouter);

// ── Sprint Q4.4 (Temp/contract — Agent TTT) ─────────────────────────────────
// Public token-based timesheet portal — kandidaat vult uren in zonder login.
// Strict rate-limit in router zelf. Mount BEFORE de authenticated /api/timesheets.
app.use('/api/public/timesheets', publicTimesheetsRouter);
app.use('/api/email-templates', emailTemplatesRouter);
app.use('/api/matching', matchingRouter);
app.use('/api/exports', exportsRouter);

// ── Sprint Q1.2 (ATS-completering) ───────────────────────────────────────────
app.use('/api/saved-searches', savedSearchesRouter);
app.use('/api/custom-fields', customFieldsRouter);
app.use('/api/job-templates', jobTemplatesRouter);
app.use('/api/scorecards', scorecardsRouter);
app.use('/api/applications', applicationsScorecardsRouter);

// ── Sprint Q2.3 (Compliance platformlaag) ────────────────────────────────────
// Public — geen auth — kandidaat self-portal:
app.use('/api/self-service', selfServiceRouter);
// Authenticated:
app.use('/api/compliance', complianceRouter);
// Extra candidate-routes (anonymize / self-token / retention-exclude /
// anonymized resume download). Mount AFTER candidatesRouter zodat de
// reguliere /:id-routes niet worden geschaduwd.
app.use('/api/candidates', candidatesComplianceRouter);

// ── Sprint Q2.4 (Push notifications) ─────────────────────────────────────────
app.use('/api/notifications', notificationsRouter);

// ── Sprint Q3.1 (Mailbox integrations + bulk campaigns) ──────────────────────
app.use('/api/integrations', integrationsRouter);

// ── Sprint Q3.4 (AI Interview Suite) ─────────────────────────────────────────
// Recordings router VOOR interviewsRouter mounten zodat de speciale sub-routes
// /recordings/... + /:id/recordings + /:id/calendar-... voorrang hebben op
// de generieke /:id routes uit BBB's router.
app.use('/api/interviews', interviewRecordingsRouter);
app.use('/api/interviews', interviewsRouter);
app.use('/api/interview-kits', interviewKitsRouter);
// Mount alongside applicationsScorecardsRouter — Express selecteert de juiste
// route op pad-suffix (`/scorecards` vs. `/agreement-matrix`).
app.use('/api/applications', applicationsAgreementMatrixRouter);

// ── Sprint Q3.5 (Custom Report Builder — Agent EEE) ──────────────────────────
// Public embed-router MOET voor de auth-protected reportsRouter mounten zodat
// /embed/:token/run niet door requireAuth wordt geblokkeerd.
app.use('/api/reports', reportsPublicRouter);
app.use('/api/reports', reportsRouter);

// ── Sprint Q3.6 (Skills Graph + ESCO — Agent HHH) ────────────────────────────
// candidatesSkillsRouter en jobsSkillsRouter mounten OP /api/candidates en
// /api/jobs naast de bestaande routers. Express dispatcht op padsuffix
// (`/skill-profile`, `/sync-esco`, `/skills-gap`) zodat de generieke /:id
// routes uit candidates.router/jobs.router niet geschaduwd worden.
app.use('/api/skills', skillsRouter);
app.use('/api/candidates', candidatesSkillsRouter);
app.use('/api/jobs', jobsSkillsRouter);

// ── Sprint Q4.2 (Enterprise security — Agent OOO) ────────────────────────────
// Custom rollen + role-assignments + tenant security-settings + permissions.
app.use('/api/roles', rolesRouter);
app.use('/api/admin', adminRolesRouter);
app.use('/api/permissions', permissionsRouter);

// ── Sprint Q4.2 (Enterprise security — Agent NNN) ────────────────────────────
// SSO/SAML public endpoints (login redirect / ACS / metadata.xml / SLO).
app.use('/api/sso', ssoPublicRouter);
// SSO admin endpoints (config CRUD + SCIM-token rotate). Eigen auth in router.
app.use('/api/admin/sso', ssoAdminRouter);
// ── Sprint Q4.4 (Temp/contract back-office — Agent TTT) ────────────────────
// Plaatsings-contracten + per-week timesheets met approval-flow.
app.use('/api/contracts', contractsRouter);
app.use('/api/timesheets', timesheetsRouter);

// ── Sprint Q4.4 (Billing/Accounting/Commissions/Forecasting — Agent UUU) ───
// Facturatie, Exact/Twinfield/SnelStart, recruiter-commissies, forecast.
app.use('/api/invoices', invoicingRouter);
app.use('/api/accounting', accountingRouter);
app.use('/api/commissions', commissionsRouter);
app.use('/api/forecasting', forecastingRouter);

// ── Sprint Q4.5 (Agentic AI Sourcing — Agent WWW) ──────────────────────────
app.use('/api/sourcing', sourcingRouter);

// ── Sprint Q4.5 (Outreach orchestration — Agent XXX) ───────────────────────
// Outreach drafting, approval, send-orchestration, quotas, replies, signals.
// Inbound reply webhook is mounted earlier on /api/webhooks (public).
app.use('/api/outreach', outreachRouter);
app.use('/api/nurture', nurtureRouter);

// ── Sprint Q4.6 (Omni-channel inbox + voice — Agent AAAA) ──────────────────
// Twilio webhook is public (HMAC-verified) — mount BEFORE auth-gated /api.
app.use('/api/webhooks', twilioWebhookRouter);
app.use('/api/inbox', inboxRouter);
app.use('/api/voice', voiceRouter);

// ── Sprint Q4.6 (WhatsApp Business — Agent ZZZ) ────────────────────────────
// Public webhook + public opt-in routes BEFORE the authenticated router so
// they aren't gated by JWT.
app.use('/api/webhooks', whatsappWebhookRouter);
app.use('/api/public/whatsapp', whatsappPublicConsentRouter);
app.use('/api/whatsapp', whatsappRouter);

// SCIM 2.0 (RFC 7644). Auth via tenant SCIM bearer-token in router zelf —
// daarom buiten /api gemount zodat noch enforceIpAllowlist noch JWT-checks
// SCIM-traffic blokkeren. IdP-providers (Okta, Azure AD) verwachten
// `/scim/v2/...` als root-pad.
app.use('/scim/v2', scimRouter);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint niet gevonden',
      details: {},
    },
  });
});

// ── Sentry error handler — MUST be registered before our own errorHandler.
// Sentry v8 exposes `setupExpressErrorHandler(app)` which both registers the
// middleware in the right place and tags the captured event with request
// context. Safe to call when the SDK isn't initialised — it becomes a no-op.
Sentry.setupExpressErrorHandler(app);

// ── Global error handler ──────────────────────────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`TalentFlow API running on port ${PORT}`, {
    port: PORT,
    env: process.env.NODE_ENV ?? 'development',
  });
});

export default app;
