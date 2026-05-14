/**
 * OpenAPI registry — Sprint Q4.1 (Pillar 3: Extensibility, Agent KKK).
 *
 * Centrale registry waar elke route zich registreert via `registry.registerPath`.
 * Wordt aan het einde gegenereerd tot een OpenAPI 3.1-document via
 * `OpenApiGeneratorV31`.
 *
 * Belangrijke noot over de zod-extensie: `extendZodWithOpenApi(z)` MOET
 * geïmporteerd zijn voordat enig schema `.openapi()` aanroept. Daarom doen
 * we het hier op module-load. Alle route-spec-files (`./routes/*`) importeren
 * indirect via deze module en krijgen zo de extensie automatisch mee.
 *
 * Pillar 3 staat: API standaard open op alle plannen, geen feature-gating.
 * De `/api-docs/openapi.json`-endpoint moet daarom publiek bereikbaar zijn.
 */

import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Eenmalige extensie — voegt `.openapi()` toe aan elk zod-schema.
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// ─── Security schemes ──────────────────────────────────────────────────────
// JWT bearer voor reguliere recruiter-sessies.
registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description:
    'Recruiter / user session JWT verkregen via POST /api/auth/login.',
});

// API-key voor third-party integraties (`Authorization: ApiKey <key>` of
// `X-API-Key`-header — de TalentFlow API-key middleware accepteert beide).
registry.registerComponent('securitySchemes', 'apiKey', {
  type: 'apiKey',
  in: 'header',
  name: 'X-API-Key',
  description:
    'Tenant-scoped API key. Aan te maken via /api/api-keys. Open op alle plannen.',
});

/**
 * Genereert een vers OpenAPI 3.1 document op basis van alles wat tot nu toe
 * via `registry.registerPath` / `registry.register` geregistreerd is.
 *
 * Caller is verantwoordelijk voor caching — zie `./index.ts` waar het
 * resultaat in een module-level cache wordt gehouden.
 */
export function generateOpenApiSpec(): object {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'TalentFlow API',
      version: '1.0.0',
      description: [
        'Recruitment SaaS API. **Open API standaard op alle plannen — geen feature gating.**',
        '',
        '## Authenticatie',
        '- `bearerAuth` (JWT): voor recruiter/user sessies (login → `accessToken`).',
        '- `apiKey` (X-API-Key): voor server-to-server / third-party integraties.',
        '',
        '## Multi-tenancy',
        'Alle endpoints zijn impliciet tenant-scoped via JWT-claim of API-key.',
        '`tenant_id` mag NOOIT in de URL of body voorkomen — Row-Level Security',
        'doet de isolatie automatisch.',
        '',
        '## Rate limiting',
        'Standaard 1000 requests / 15 min per IP+API-key. Bij overschrijding',
        'krijg je `429 Too Many Requests` met een `Retry-After`-header.',
      ].join('\n'),
      contact: {
        name: 'TalentFlow Support',
        email: 'support@talentflow.app',
        url: 'https://talentflow.app/support',
      },
      license: { name: 'Proprietary', url: 'https://talentflow.app/legal/api-terms' },
    },
    servers: [
      { url: 'https://api.talentflow.app', description: 'Production' },
      { url: 'https://staging-api.talentflow.app', description: 'Staging' },
      { url: 'http://localhost:4000', description: 'Local development' },
    ],
    tags: [
      { name: 'Authentication', description: 'Login, JWT refresh, password reset, API keys' },
      { name: 'Tenants', description: 'Tenant CRUD + branding' },
      { name: 'Users', description: 'User management binnen een tenant' },
      { name: 'Candidates', description: 'Candidate CRUD, skills, resumes, timeline' },
      { name: 'Jobs', description: 'Job CRUD + pipeline, JD-generator, attachments' },
      { name: 'Pipeline', description: 'Applications + stage transitions' },
      { name: 'Communications', description: 'Inbox, e-mail, WhatsApp, SMS, bulk-campaigns' },
      { name: 'AI Matching', description: 'Cosine + Talent Fit + AI explanations + reactivation' },
      { name: 'Compliance', description: 'GDPR, audit-trail, DSAR, retention, pay-equity, DEI' },
      { name: 'Webhooks', description: 'Event subscriptions + delivery logs' },
      { name: 'Reports', description: 'Custom Report Builder + export (PDF/Excel/CSV) + schedules' },
      { name: 'Skills', description: 'ESCO taxonomy + skill-profile + gap analysis' },
      { name: 'Interviews', description: 'Scheduling, kits, recordings, agreement matrix' },
      { name: 'Analytics', description: 'Funnel, KPI, sourcing-effectiveness' },
      { name: 'Dashboard', description: 'Recruiter dashboard widgets' },
      { name: 'Workflows', description: 'Triggered automations' },
      { name: 'CRM', description: 'Companies, contacts, deals (agency mode)' },
      { name: 'Career Pages', description: 'Public job-board / career-page rendering' },
      { name: 'Hiring Manager', description: 'HM-portaal: candidate review + scorecards' },
      { name: 'Job Boards', description: 'Multi-poster integraties' },
      { name: 'Contracts', description: 'Plaatsings-contracten (temp/contract/perm/freelance) — Sprint Q4.4' },
      { name: 'Timesheets', description: 'Per-week urenregistratie + approval-flow + public portal — Sprint Q4.4' },
      { name: 'Email Templates', description: 'Reusable mergevariable-aware templates' },
      { name: 'Integrations', description: 'Mailbox (Gmail/Outlook), calendar, ATS imports' },
      { name: 'Portal', description: 'White-label klantportaal voor agencies' },
      { name: 'Saved Searches', description: 'Persisted candidate search filters' },
      { name: 'Custom Fields', description: 'Tenant-defined extra fields op kandidaat/job' },
      { name: 'Scorecards', description: 'Interview scorecards + agreement matrix' },
      { name: 'Notifications', description: 'Push + e-mail notification preferences' },
      { name: 'Exports', description: 'CSV / Excel exports met audit-log' },
      { name: 'API Keys', description: 'Tenant-scoped API keys voor third-party gebruik' },
      { name: 'Public', description: 'Onbeschermde endpoints (career-page render, embed-reports, OpenAPI docs)' },
      { name: 'Billing', description: 'Facturen genereren, issuen, betalen, void; PDF + accounting-sync' },
      { name: 'Accounting', description: 'Exact Online / Twinfield / SnelStart koppelingen' },
      { name: 'Commissions', description: 'Recruiter-commissieregels, assignments en records' },
      { name: 'Forecasting', description: 'Revenue-forecast + margin-rapportage per client/recruiter' },
      { name: 'Sourcing Agent', description: 'Autonome boolean-search agent + briefs + findings + WORM action-log — Sprint Q4.5' },
      { name: 'Outreach', description: 'AI-drafted LinkedIn/email outreach, quotas, replies + classifications, passive monitoring signals — Sprint Q4.5' },
      { name: 'Nurture', description: 'Multi-channel nurture sequences, steps en candidate enrollments — Sprint Q4.5' },
      { name: 'Inbox', description: 'Omni-channel unified inbox: email + WhatsApp + voice + LinkedIn outreach in één per-kandidaat timeline — Sprint Q4.6' },
      { name: 'Voice', description: 'Twilio voice/VoIP integratie: outbound calls, recordings, Whisper transcripties — Sprint Q4.6' },
      { name: 'WhatsApp', description: 'WhatsApp Business templates, messaging, consent en webhook — Sprint Q4.6' },
    ],
    externalDocs: {
      description: 'Volledige documentatie + tutorials',
      url: 'https://docs.talentflow.app',
    },
  } as Parameters<OpenApiGeneratorV31['generateDocument']>[0]);
}
