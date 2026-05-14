# TalentFlow Masterplan 2027 — Een EU-native Recruitment Operating System

**Datum:** mei 2026
**Status-snapshot:** eind Slice 4.5 (job-detail Manatal-overtreffend live)
**Eindbeeld 2027:** een technisch en functioneel superieur recruitment-platform dat Manatal/Recruitee/Bullhorn in elke vergelijkings-dimensie overtreft. Commercieel komt **na** dit jaar — eerst het systeem af, daarna verkopen.

---

## 1. Doel en context

Dit plan dient twee doelen:

1. **Stage-deliverable** voor Kaans BIM-stage: aantoonbare technische diepgang + werkende oplevering aan IT Proposal als design partner #1 (gratis gebruik).
2. **Productfundament** voor latere commerciële uitrol onder KDMN — die scope zit **niet** in dit plan; we bouwen eerst het beste systeem.

Recruitmentsoftware in 2026/2027 valt of staat met drie eigenschappen die Manatal en Recruitee structureel onderwaarderen: **strikte tenant-isolatie, verklaarbare AI, en compliance-als-platformlaag**. Wij bouwen die drie als kerncompetenties — niet als features.

Drie harde principes sturen elke beslissing:
- **Tenant-isolatie is altijd expliciet** — geen query, cache of background-job zonder tenant-context.
- **Compliance is een platformlaag** — niet een sprint. Cross-cutting concern, ingebakken in elke release.
- **AI is uitlegbaar, controleerbaar en uitschakelbaar** — geen black-box. Recruitment-AI valt onder hoge-risico-verwachtingen van de EU AI Act.[1][2]

---

## 2. Productvisie — Recruitment Operating System (ROS)

TalentFlow is geen "ATS met AI eraan geplakt". Het is een **operating system voor recruitment**: zeven samenwerkende lagen die samen één coherent platform vormen. Elke laag heeft duidelijke grenzen en kan onafhankelijk evolueren — maar het geheel is meer dan de som.

```
┌──────────────────────────────────────────────────┐
│  Layer 7 — Extensibility                         │
│  OpenAPI · webhooks · SSO/SAML · custom roles    │
├──────────────────────────────────────────────────┤
│  Layer 6 — Intelligence                          │
│  AI matching · Talent Reactivation · summaries   │
│  bias-checker · skills graph · predictive scores │
├──────────────────────────────────────────────────┤
│  Layer 5 — Compliance                            │
│  Consent · retentie · DSAR · audit · AI logging  │
├──────────────────────────────────────────────────┤
│  Layer 4 — Automation                            │
│  Workflow engine · email · calendar · webhooks   │
├──────────────────────────────────────────────────┤
│  Layer 3 — Collaboration                         │
│  Klantportaal · career pages · hiring manager    │
├──────────────────────────────────────────────────┤
│  Layer 2 — Core ATS                              │
│  Candidates · jobs · applications · pipeline     │
├──────────────────────────────────────────────────┤
│  Layer 1 — Platform Foundation                   │
│  Multi-tenant · auth · audit · observability     │
└──────────────────────────────────────────────────┘
```

Volgorde van werken is van onderen naar boven. Eerst fundament, dan ATS-pariteit, dan samenwerking, dan automatisering, dan compliance, dan intelligence, dan extensibility. **Geen AI of mooie UI bovenop een instabiele basis.**

---

## 3. Status-audit eind 2026

| Layer | Klaar | Open | Status |
|---|---|---|---|
| **1 Foundation** | Multi-tenant RLS, JWT + refresh, roles, BullMQ, storage abstraction, 7 migraties | CI/CD, live deploy, tests, monitoring, multi-region | 🟡 ~50% |
| **2 Core ATS** | Candidates met 30+ Manatal-velden + reference IDs + GDPR consent, multi-CV, AI parsing met Claude, jobs met 16+ velden + filters + 6-tab detail, pipeline-templates met 9-staps bureau-stages, drag-drop kanban met conversies | CSV bulk import, boolean search + saved searches, dedupe-merge, job dupliceren, custom fields, scorecards-form, bulk-acties, CSV export | 🟢 ~80% |
| **3 Collaboration** | Module-skeletten voor portal/career-pages/HM, sidebar-routes | Werkend klantportaal met token + custom-domain CNAME, career-page builder met templates + form-builder, hiring-manager PWA + Web Push, conversational chatbot | 🔴 ~20% |
| **4 Automation** | Workflow engine met 7 action-types + trigger emit-points, Resend email + threading, email-templates met merge-vars, ComposeEmailModal, inbound webhook met HMAC | Gmail/Outlook OAuth 2-way sync, bulk email-campagnes met consent-check, calendar integraties, webhook event-log UI, AI vacaturetekst-generator | 🟡 ~50% |
| **5 Compliance** | GDPR consent-velden in schema, EU AI Act art. 13 disclosure overal, RLS, aiDisclosure constant | GDPR dashboard volledig (UI), consent-management UI per kandidaat, retention auto-archive cron, DSAR-flows (inzage/export/correctie/verwijdering), candidate self-service portal `/profile/[token]`, **CV anonimisering automatisch**, immutable WORM audit-trail | 🔴 ~25% |
| **6 Intelligence** | pgvector + multilingual embeddings (text-embedding-3-small), cosine matching, AI explanation 7-dag cache, AI CV-samenvatting, skills-extractie 1-10 score, bias-checker JD, comparable past jobs, source ROI, job health-score + predicted close-date | Talent Reactivation nightly cron, Talent Fit Model (fine-tuning op historische hires), AI Interview Scheduling, AI Interview Transcriptie (Whisper), gestructureerde Interview Kits, Skills Graph met ESCO, Custom Report Builder, AI vacaturetekst-generator | 🟡 ~55% |
| **7 Extensibility** | API-keys module skelet, webhooks module skelet | OpenAPI 3.0 spec auto-gen, Swagger UI, API playground, webhook event-log UI, SSO/SAML (Okta/Azure AD/Google), SCIM provisioning, custom rollen UI, dedicated tenant-DB optie, integratiehub, feature-flags | 🔴 ~10% |

**Totaal:** ~50% van de 7-laagse visie. Code-pad voor de gekoppelde features is gelegd; ontbrekend werk is 50% nieuw, 50% diepgang en hardening van bestaand werk.

---

## 4. Architectuurprincipes

Deze 6 principes zijn **geen aparte sectie maar een per-sprint Definition-of-Done-constraint**: elke sprint moet expliciet verifiëren dat ze niet zijn geschonden voordat de sprint dichtgaat.

| # | Principe | Verificatie per sprint |
|---|---|---|
| 1 | **Tenant-context altijd expliciet** | Alle nieuwe query's gebruiken `withTenant()` of bewust `withoutTenant()` met motivatie. Caches zijn tenant-keyed. Background jobs ontvangen `tenantId` in payload. |
| 2 | **Elke write is auditeerbaar** | Nieuwe service-functies schrijven naar `activities` of toekomstig `audit_events`. Geen schaduw-mutaties. |
| 3 | **AI-output is altijd uitlegbaar + override-baar** | Elke AI-feature heeft (a) disclosure-string, (b) human-override pad, (c) logging in `ai_events` (te bouwen in Q2). |
| 4 | **Compliance is een platformlaag** | Nieuwe modules hebben consent-check, retention-policy, audit-hook. Geen feature mag GDPR-gat introduceren. |
| 5 | **Observability is geen optie** | Nieuwe routes hebben Sentry-instrumentation, structured logging, en een health-check als ze stateful zijn. |
| 6 | **Tests zijn deel van "klaar"** | Service-laag ≥ 60% coverage door Q1 einde, 80% door Q2. E2E-tests voor kritieke flows. |

---

## 5. Compliance by design

Compliance is laag 5 — een **platformlaag**, geen sprint. Een nieuwe feature die compliance breekt mag niet shippen.

Het compliance-model bevat acht componenten die in Q2 als platformlaag worden opgeleverd en daarna door alle volgende features worden hergebruikt:

1. **Consent lifecycle** per kandidaat (capture, log, withdraw, prove).
2. **Retentie-beleid** per tenant — auto-archive/anonimiseren na X maanden.
3. **DSAR-flows** (Data Subject Access Requests): inzage, export, correctie, verwijdering — onder AVG art. 15-17.
4. **Audit trail** van elke mutatie — append-only, WORM (Write-Once-Read-Many).
5. **AI disclosure logging** — elke AI-inference krijgt log-entry met model, input-hash, output-hash, gebruiker.
6. **Human review** bij AI-ranking en AI-generated outputs — recruiter behoudt finale oordeel (EU AI Act art. 13).
7. **Role-based access** per module en per dossier — granulariteit op record-niveau.
8. **Candidate self-service portaal** — kandidaat kan eigen data inzien, corrigeren, verwijderen via token-link.

Bij audit moeten we **per kandidaat** kunnen tonen: consent-bewijs (datum, kanaal, IP), data-retentie-policy, exports verstuurd, AI-beslissingen genomen, mutatie-historie.

---

## 6. AI governance

Recruitment-AI valt onder de hoogste risico-categorie van de EU AI Act (Annex III).[1][2] Daarom geldt voor elke AI-feature in TalentFlow zes regels:

| # | Regel | Concrete invulling |
|---|---|---|
| 1 | **Elke ranking heeft een uitleg** | Match-score is gekoppeld aan `ai_explanation` met sterke punten + gaps. |
| 2 | **Elke generatieve output heeft review-optie** | Recruiter kan bewerken/verwerpen voordat verzonden wordt. |
| 3 | **Elke AI-inference wordt gelogd** | Tabel `ai_events` (te bouwen Q2): tenant, model, prompt-hash, output-hash, kosten, latency. |
| 4 | **Elke tenant kan AI-functies beperken of uitschakelen** | Settings-toggle per AI-feature met tenant-scope. |
| 5 | **Bias- en kwaliteitschecks zijn standaard** | JD bias-checker (al gebouwd), output bias-monitor in Q3. |
| 6 | **AI ondersteunt, beslist niet ongecontroleerd** | Geen auto-reject. Geen auto-hire. Recruiter is altijd in de loop. |

---

## 7. Security baseline

Vanaf release-1 verplichte security-eisen — geen "Enterprise add-on", maar standaard:

- 2FA via TOTP (verplichtbaar per tenant).
- Rate limiting per route (al gebouwd).
- RBAC met granulaire permissions per module.
- Tenant-aware autorisatie op elke route.
- Secrets via environment + Hetzner secrets store.
- Signed webhooks (HMAC-SHA256, al gebouwd voor Resend).
- Secure file storage met signed-URL TTL.
- Backup + restore-drill kwartaalmatig getest.
- Append-only audit trail.
- IP-allowlisting als optionele tenant-feature.

---

## 8. Data-model — kernentiteiten

Vroege model-discipline voorkomt half-overlappende modellen later. Onderstaande lijst is de **canonieke set entiteiten** van TalentFlow. Nieuwe features mogen geen alternatief model voor dezelfde domein-entiteit introduceren.

| Domein | Entiteiten |
|---|---|
| **Tenancy** | tenants, users, memberships, roles, permissions, tenant_settings |
| **Candidates** | candidates, candidate_skills, candidate_resumes, candidate_consents (Q2) |
| **Jobs** | jobs, pipeline_templates, pipeline_template_stages, pipeline_stages, applications |
| **Workflows** | workflows, workflow_runs, tasks |
| **Communications** | communications, email_threads, email_templates, ai_events (Q2) |
| **Collaboration** | crm_organizations, crm_contacts, crm_deals, portal_links, career_pages |
| **Job extras** | job_team_members, job_notes, job_attachments, job_health_snapshots, job_bias_checks |
| **AI Matching** | match_scores (cached + explanations) |
| **Compliance** | retention_policies, audit_events, dsar_requests (Q2) |
| **Files** | (storage abstractie — geen DB-tabel, maar via storage_key in candidate_resumes/job_attachments) |

---

## 9. Roadmap — 4 kwartalen × 7 lagen

Werkpakket per kwartaal. Elke sprint is **1-2 weken werk met 3 parallel-agents** volgens het in 2026 bewezen patroon. Geen commerciële sprints — die volgen na 2027.

### **Q1 2027 (jan-mrt) — Foundation + Core ATS afmaken**
**Lagen actief:** 1, 2.
**Doel:** stage-cutover. IT Proposal kan een volledige werkdag in TalentFlow draaien zonder terug te grijpen naar Manatal.

#### Sprint Q1.1 — Foundation hardening
- Vitest unit-tests voor service-laag (auth, candidates, jobs, matching) → 60% coverage
- Playwright E2E voor 5 hoofdflows (login, kandidaat aanmaken, CV uploaden, pipeline drag, email versturen)
- GitHub Actions CI: lint + typecheck + test + build per PR
- GitHub Actions CD: push-to-prod via SSH+PM2 deploy
- Sentry integratie (api + web)
- Better Uptime monitor op `/health`
- Docker Compose productie-config + Nginx + Caddy/Let's Encrypt SSL
- pgvector-image PostgreSQL container
- MinIO bucket setup voor file storage
- Daily `pg_dump` cron naar Cloudflare R2 met 30-dag retentie
- Tabellen `audit_events` + `ai_events` (te beginnen vanaf nul) als append-only

**Files:**
- `infra/docker-compose.prod.yml` (nieuw)
- `infra/nginx.conf`, `infra/Caddyfile` (nieuw)
- `.github/workflows/ci.yml`, `.github/workflows/deploy.yml` (nieuw)
- `apps/api/migrations/008_audit_and_ai_events.sql` (nieuw)
- `apps/api/src/lib/audit.ts` (nieuw)
- `apps/api/src/lib/sentry.ts` (nieuw)
- `apps/api/__tests__/` + `apps/web/__tests__/` (nieuw)

**DoD:** push naar `main` = live binnen 5 min. Errors in Sentry. Uptime-monitor live. Service-tests groen ≥60%. Architectuurprincipe-checks (alle 6) groen.

#### Sprint Q1.2 — ATS-completering
- CSV bulk import (max 1.000/keer, async via BullMQ) met preview-stap + duplicate-detectie
- Boolean search parser (`AND/OR/NOT "exact phrase"`) + saved searches per gebruiker
- Duplicate-detection op email/phone met merge-dialog (multi-record consolidatie)
- Job dupliceren + `job_templates` tabel voor herbruikbare blueprints
- Custom fields per tenant: settings + render-engine + zod-validation
- Scorecards per applicatie per stage (formulier + agreement-matrix-data)
- Bulk-acties op kandidaten (move-stage, add-tag, archive)
- CSV export op alle lijst-views

**Files:**
- `apps/api/migrations/009_ats_completion.sql` (saved_searches, job_templates, custom_fields, scorecards)
- `apps/api/src/modules/candidates/booleanSearch.ts` (nieuw — eigen parser)
- `apps/api/src/modules/candidates/bulkImport.service.ts` (nieuw)
- `apps/api/src/queue/workers/csvImport.worker.ts` (nieuw)
- `apps/web/components/candidates/BulkImportDialog.tsx` (nieuw)
- `apps/web/components/candidates/MergeCandidatesDialog.tsx` (nieuw)
- `apps/web/components/scorecards/Scorecard.tsx` (nieuw)

**DoD:** Manatal day-to-day tasks zijn 1-op-1 doable. Recruiter kan willekeurige werkdag in TalentFlow zonder Manatal te openen.

#### Sprint Q1.3 — Data-migratie + IT Proposal cutover-prep
- Manatal CSV-export → TalentFlow import-script (candidates + jobs + applications + notes)
- 5.540 IT Proposal kandidaten + 24 jobs migreren in staging-tenant
- 1-week shadow-run: IT Proposal recruiter werkt parallel in beide systemen
- Pariteit-checklist (50+ items) groen
- Rollback-plan + go/no-go-meeting
- Smoke-test runbook in `docs/SMOKE_RUNBOOK.md`

**Files:**
- `apps/api/scripts/manatal-import.ts` (nieuw)
- `docs/SMOKE_RUNBOOK.md` (nieuw)
- `docs/IT_Proposal_Cutover_Plan.md` (nieuw)

**DoD:** stage-begeleider kan grade vaststellen. IT Proposal cutover-datum vastgesteld.

---

### **Q2 2027 (apr-jun) — Collaboration + Compliance fundament**
**Lagen actief:** 3, 5.
**Doel:** echte samenwerking met klanten + bewijsbare compliance. Geen email-thread-recruitment meer.

#### Sprint Q2.1 — Klantportaal werkend + white-label
- `/portal/[token]` werkend (geen account, token-based)
- Granulaire permission-matrix per portal-link (zien/commentaren/accept/reject)
- Klant ziet shortlist + AI-scores + **geanonimiseerde** CV's (gekoppeld aan Q2.3)
- Notificatie-mails naar klant bij nieuwe kandidaat in shortlist
- Portal-activity-log per klant
- White-label config: logo + 2 kleuren + favicon — wordt op portal én outbound email toegepast
- **Custom-domain via CNAME**: klant zet `hiring.bedrijf.nl → portals.talentflow.app`. Detectie via Host-header.
- Wildcard SSL via Caddy on-demand TLS

**Files:**
- `apps/api/src/modules/portal/` (uitbreiden)
- `apps/api/src/middleware/customDomain.ts` (nieuw)
- `apps/web/app/portal/[token]/page.tsx` (uitbreiden)
- `infra/caddy-on-demand.json` (nieuw)

**DoD:** klant van IT Proposal logt in op `hiring.itproposal.com` zonder TalentFlow-branding.

#### Sprint Q2.2 — Career-page builder
- 6 templates (modern/klassiek/agency/tech/horeca/internationaal)
- Drag-drop editor (puck.js of lichtgewicht eigen-bouw): hero, features, jobs-list, form, footer
- Per-vacature customizable applicatieformulier (verplicht/optioneel, dropdown, file-upload, video-vraag)
- Custom-domain via dezelfde CNAME-flow als portal
- Meertalig: NL/EN/DE/FR via next-intl
- Auto-sync vacaturelijst met openstaande jobs
- Conversational chatbot via Claude (FAQ + kwalificatie) — opt-in per page
- Sollicitatie → BullMQ worker → maakt candidate aan met `source='career_page'`
- GA4 + Tag Manager + JobPosting structured data

**Files:**
- `apps/api/src/modules/career-pages/` (uitbreiden)
- `apps/web/app/(dashboard)/career-pages/[id]/builder/page.tsx` (nieuw)
- `apps/web/app/careers/[slug]/page.tsx` (herbouwen met builder-output)
- `apps/web/components/career-builder/` (nieuw — block-types)

**DoD:** career-page launched op custom-domain, sollicitant doet sollicitatie, kandidaat verschijnt in TalentFlow met bron-tracking.

#### Sprint Q2.3 — Compliance-platformlaag
- **CV anonimisering** regelgebaseerd: verberg naam, foto, telefoon, geboortedatum, nationaliteit, adres
- Per-klant configureerbaar via `portal_anonymization_rules` JSONB op `portal_links`
- Trigger: bij stage-overgang naar "Client Submission" → automatisch anonieme CV gegenereerd in PDF (via pdf-lib)
- GDPR-dashboard `/dashboard/gdpr`: per kandidaat consent-status + datum + kanaal
- Bulk consent-request flow (verstuur consent-mailing naar X kandidaten)
- Retention-policy auto-archiveer cron na 12/24/36 maanden (configureerbaar per tenant)
- Kandidaat-zelfportaal `/profile/[token]` (AVG art. 15-17): zien, exporteren, corrigeren, verwijderen
- DSAR-request UI voor recruiter (handmatige requests verwerken)
- WORM audit-trail: append-only `audit_events` tabel + UI met filters

**Files:**
- `apps/api/migrations/010_compliance_layer.sql` (consents, retention_policies, dsar_requests, audit_events extensies)
- `apps/api/src/lib/anonymization.ts` (nieuw — regel-engine)
- `apps/api/src/lib/pdfGenerator.ts` (nieuw — anonieme CV)
- `apps/api/src/queue/workers/retention.worker.ts` (nieuw — daily cron)
- `apps/web/app/(dashboard)/gdpr/page.tsx` (nieuw)
- `apps/web/app/profile/[token]/page.tsx` (nieuw — kandidaat-zelfportaal)

**DoD:** AVG-jurist kan greenlight geven. Audit kan tonen per kandidaat: consent, retentie, exports, AI-beslissingen, mutatiehistorie.

#### Sprint Q2.4 — Hiring Manager PWA + Web Push
- HM swipe-UI op mobiel (accept/reject/later) als PWA
- Web Push notifications via Web Push API (geen App Store)
- Push: nieuwe kandidaat ter beoordeling, scorecard-deadline, interview-herinnering
- Offline-first: kandidaat-data cached
- Inline scorecard-formulier op mobiel

**Files:**
- `apps/web/app/hm/page.tsx` (uitbreiden — swipe-UI)
- `apps/web/lib/pushSubscription.ts` (nieuw)
- `apps/web/public/sw.js` (nieuw — service worker)
- `apps/api/src/modules/notifications/webPush.service.ts` (nieuw)

**DoD:** hiring-manager beoordeelt 10 kandidaten op de bus naar werk.

---

### **Q3 2027 (jul-sep) — Automation depth + Intelligence**
**Lagen actief:** 4, 6.
**Doel:** AI-moats die concurrenten niet snel kopiëren. Gmail/Outlook-koppeling als 2-way sync.

#### Sprint Q3.1 — Gmail/Outlook OAuth + native mail-sync
- Gmail OAuth2 (`googleapis`) + Outlook OAuth2 (`@microsoft/microsoft-graph-client`)
- Recruiter koppelt eigen mailbox; verzonden mails verschijnen in TalentFlow (in plaats van alleen Resend-verzonden)
- Reply-tracking via thread-id matching
- Mail-templates met merge-vars werken op beide kanalen
- Bulk email-campagnes met **GDPR-consent check vooraf** (skip kandidaten zonder consent)
- 5.000 credits/maand standaard (vs Manatal's 1.000)

**Files:**
- `apps/api/src/modules/integrations/gmail.service.ts` (nieuw)
- `apps/api/src/modules/integrations/outlook.service.ts` (nieuw)
- `apps/api/src/queue/workers/inboxSync.worker.ts` (nieuw — periodiek mail ophalen)
- `apps/web/app/(dashboard)/settings/integrations/page.tsx` (nieuw)

**DoD:** recruiter koppelt eigen mailbox, stuurt mail uit TalentFlow, ziet replies binnenkomen.

#### Sprint Q3.2 — AI vacaturetekst-generator + Talent Reactivation
- **JD-generator**: prompt + role/level/skills → Claude → JD met bias-checker run
- Tone-of-voice opties (formal/casual/direct)
- A/B-variants generator: 3 versies van JD voor split-testen
- **Talent Reactivation nightly cron**: voor elke nieuwe/gewijzigde job → top-N matches uit gearchiveerde candidates via pgvector
- Alert: "5 oude kandidaten matchen je nieuwe vacature" → mail + dashboard-widget

**Files:**
- `apps/api/src/lib/jdGenerator.ts` (nieuw)
- `apps/api/src/queue/workers/talentReactivation.worker.ts` (nieuw)
- `apps/web/app/(dashboard)/jobs/new/ai-generator/page.tsx` (nieuw)

**DoD:** recruiter ontvangt elke ochtend "matches-uit-database" mail. Nieuwe vacature bouwen kost 30 sec ipv 30 min.

#### Sprint Q3.3 — Talent Fit Model
- Per tenant met 50+ historische hires: bouw classifier (XGBoost of fine-tune embedding-projection)
- Features: kandidaat-embedding, job-embedding, skills-overlap, source, tijd-in-stage-pattern
- Label: hired vs rejected vs offer-declined
- Bij match: combineer cosine-similarity + Talent-Fit-score (gewicht 0.6/0.4 default)
- Re-train cron weekelijks
- Verklaring: "Deze kandidaat lijkt op 4 eerdere succesvolle hires van jou" → toon top-3 referenties

**Files:**
- `apps/api/src/modules/matching/talentFit.service.ts` (nieuw)
- `apps/api/src/queue/workers/talentFitTrainer.worker.ts` (nieuw)
- `apps/api/migrations/011_talent_fit_models.sql` (nieuw — modellen-cache per tenant)

**DoD:** match-score van top-10 kandidaten heeft 20% hogere precision-bij-1 dan plain cosine na 50 hires.

#### Sprint Q3.4 — AI Interview Suite
- Interview Scheduling Calendly-stijl: kandidaat kiest slot uit recruiter-availability
- Google Calendar + Outlook Calendar 2-way sync
- Multi-interviewer beschikbaarheid combineren (intersect)
- Gestructureerde Interview Kits: vragenset per vacature, scorecard per interviewer
- Agreement matrix: laat zien waar interviewers het oneens zijn (Slice 4.5 placeholder invullen)
- AI Interview Transcriptie: video/audio upload → Whisper API → transcript + Claude-samenvatting
- Privacy-first: opt-in per interview, kandidaat geeft consent vooraf

**Files:**
- `apps/api/src/modules/interviews/` (nieuw module)
- `apps/api/src/lib/whisper.ts` (nieuw)
- `apps/web/app/(dashboard)/interviews/page.tsx` (nieuw)
- `apps/web/components/interviews/Scheduler.tsx` (nieuw)

**DoD:** interview vanaf scheduling tot scorecard tot AI-samenvatting in 1 flow zonder externe tools.

#### Sprint Q3.5 — Custom Report Builder
- Drag-drop builder: dimensies (job, recruiter, source, stage, periode) × metrics (count, conversion, time-to-hire, cost)
- Visualisatie: tabel, bar, line, funnel, KPI-card
- Templates: Recruiter / Manager / CHRO / Source-of-Hire / DEI-funnel
- Auto-mailen rapport (wekelijks/maandelijks) via workflow-engine
- Export naar PDF/Excel/CSV
- Embed-link voor read-only rapport-deel

**Files:**
- `apps/api/src/modules/reports/` (nieuw module)
- `apps/web/app/(dashboard)/reports/builder/page.tsx` (nieuw)
- `apps/web/components/reports/` (nieuw — block-types)

**DoD:** CHRO maakt zelf een dashboard zonder hulp.

#### Sprint Q3.6 — Skills Graph + ESCO + Pay Transparency
- ESCO-taxonomie import (EU skills standaard, ~13.000 skills)
- Per kandidaat: skills mappen naar ESCO-codes
- Skills-trending dashboard: wat wordt gevraagd in de markt
- Skills-gap analyse per kandidaat vs vacature
- **Pay Transparency Directive 2026**: salarisbandbreedte verplicht (configureerbaar als require)
- DEI-funnel rapportage (anoniem demographic): waar dropt diversity
- Pay-equity-report per role (gemiddeld salaris per geslacht/achtergrond)

**Files:**
- `apps/api/migrations/012_skills_graph.sql` (esco_skills, candidate_esco_mappings)
- `apps/api/scripts/import-esco.ts` (nieuw — eenmalige import)
- `apps/api/src/modules/skills/` (nieuw module)

**DoD:** skills-search werkt op ESCO-niveau (synoniemen), DEI-funnel toont demographic drop-off.

---

### **Q4 2027 (okt-dec) — Extensibility + niche-domination**
**Lagen actief:** 7 + adjacencies.
**Doel:** enterprise-onboarding mogelijk + bureau-features die geen concurrent heeft.

#### Sprint Q4.1 — OpenAPI + Swagger + webhook-event-log
- OpenAPI 3.0 spec auto-generated uit Express routes (zod-to-openapi)
- Swagger UI op `/api-docs`
- API playground op `/dashboard/api-explorer` met live-test
- Webhook event-log UI: laatste 100 deliveries per tenant met retry-knop
- Per-tenant API-keys met granulaire permissions per module
- Rate-limit-headers + usage-dashboard

**Files:**
- `apps/api/src/lib/openapi.ts` (nieuw)
- `apps/api/src/modules/webhooks/eventLog.service.ts` (nieuw)
- `apps/web/app/(dashboard)/api-explorer/page.tsx` (nieuw)
- `apps/web/app/(dashboard)/webhooks/log/page.tsx` (nieuw)

**DoD:** ontwikkelaar kan zonder hulp een eigen integratie bouwen tegen TalentFlow API.

#### Sprint Q4.2 — SSO/SAML + SCIM + custom roles + WORM audit
- SAML 2.0 SSO via passport-saml: Okta + Azure AD + Google Workspace + generic
- SCIM provisioning voor user-sync
- Custom rollen UI: tenant-admin maakt eigen rollen met granulaire permissions
- WORM audit-trail UI met filter + export (data-laag al klaar in Q1.1)
- IP-allowlisting per tenant
- 2FA via TOTP (verplichtbaar per tenant)

**Files:**
- `apps/api/src/modules/auth/saml.ts` (nieuw)
- `apps/api/src/modules/auth/scim.controller.ts` (nieuw)
- `apps/api/src/modules/roles/customRoles.service.ts` (nieuw)
- `apps/web/app/(dashboard)/settings/security/page.tsx` (uitbreiden)

**DoD:** klant met IT-security-eisen kan onboarden zonder concessies.

#### Sprint Q4.3 — Echte job-board integraties
- LinkedIn Job Posting API (OAuth + post + retract)
- Indeed Employer API
- Nationale Vacaturebank XML feed (NL)
- Jobbird API (NL) + StepStone API (DE/NL) + Werkzoeken.nl + Jobs.nl
- Real-time polling van plaatsing-status (geen 24-48u vertraging)
- Source-of-Hire automatisch ingevuld op binnenkomende kandidaten
- Cost-per-hire tracking (per posting kost)
- Broadbean/Multipost aggregator als optie voor de 2.000 overige boards

**Files:**
- `apps/api/src/modules/job-boards/integrations/linkedin.ts` (nieuw)
- `apps/api/src/modules/job-boards/integrations/indeed.ts` (nieuw)
- `apps/api/src/modules/job-boards/integrations/nl-vacaturebank.ts` (nieuw)
- ... per board een eigen file

**DoD:** recruiter publiceert vacature 1×, gaat naar 5+ boards, ziet kandidaten met bron-tracking binnen 5 min binnenkomen.

#### Sprint Q4.4 — Temp/contract back-office
- Timesheets-module: kandidaat vult uren in via portal, klant keurt goed
- Contract-management: start/einddatum, verlengingsnotificaties, WTZA-compliance NL
- Facturering automatisch op basis van goedgekeurde uren
- Boekhoudpakket-export: Exact Online + Twinfield + SnelStart connectors
- Commissieberekening per recruiter per plaatsing (configureerbare schemas)
- Revenue-forecasting: omzet uit lopende contracten + pipeline-deals
- Marge-rapportage per klant + per recruiter

**Files:**
- `apps/api/src/modules/timesheets/` (nieuw)
- `apps/api/src/modules/billing/invoicing.ts` (nieuw)
- `apps/api/src/lib/exact-online.ts`, `twinfield.ts`, `snelstart.ts` (nieuw)
- `apps/web/app/(dashboard)/timesheets/page.tsx` (nieuw)

**DoD:** uitzendbureau kan complete cycle (job → kandidaat → contract → uren → factuur → commissie) in TalentFlow.

#### Sprint Q4.5 — Agentic AI Sourcing
- Autonome boolean-search agent: recruiter geeft brief, agent zoekt + presenteert + vraagt approval voor outreach
- LinkedIn outreach automation: AI schrijft gepersonaliseerde InMail per kandidaat, recruiter goedkeurt → agent verstuurt
- Multi-channel nurture-sequences (dag 1 LinkedIn / dag 4 mail / dag 10 mail-2)
- Passieve kandidaat-monitoring: alert bij baanwissel via LinkedIn-scraper of Hunter.io
- Reply-management: AI categoriseert replies (geïnteresseerd / niet-nu / weg) en updated tags

**Files:**
- `apps/api/src/modules/sourcing-agent/` (nieuw module)
- `apps/api/src/lib/linkedinOutreach.ts` (nieuw)
- `apps/web/app/(dashboard)/sourcing-agent/page.tsx` (nieuw)

**DoD:** sourcing-agent draait 24/7, recruiter approves outreach, kandidaten landen in TalentFlow met source='agentic_outreach'.

#### Sprint Q4.6 — WhatsApp Business + omni-channel inbox
- WhatsApp Business API via 360dialog (EU-favoriet)
- Template messages voor approved business messaging
- Inkomende WhatsApp → unified inbox per kandidaat
- GDPR opt-in flow voor WhatsApp
- Voice/VoIP via Twilio (optioneel)
- Omni-channel inbox: alle kanalen in 1 timeline per kandidaat

**Files:**
- `apps/api/src/modules/communications/whatsapp.service.ts` (nieuw)
- `apps/api/src/queue/workers/whatsapp.worker.ts` (nieuw)
- `apps/web/app/(dashboard)/communications/page.tsx` (uitbreiden — alle kanalen)

**DoD:** recruiter werkt 1 dag zonder WhatsApp-app te openen — alles in TalentFlow.

---

## 10. Definition of Done per release

Elke release moet voldoen aan onderstaande **kwaliteitspoort** voordat hij dichtgaat. Geen feature-completeness ten koste van betrouwbaarheid.

| Eis | Verificatie |
|---|---|
| Geen tenant-data-leak | Cross-tenant test (probeer tenant-A data op te vragen vanuit tenant-B context — moet failen) |
| Audit-trail actief | Schrijf-actie genereert `audit_events` rij |
| Backups getest | Restore-drill maandelijks gedraaid + gedocumenteerd |
| Errors gemonitord | Sentry rate < 0.5% van requests |
| Alle kernflows smoke-testbaar | Playwright E2E groen |
| AI-output uitlegbaar waar toegepast | Disclosure-string + override-pad aanwezig |
| Compliance-dossiers actueel | Per kandidaat consent-bewijs ophalen mogelijk |
| Documentatie bijgewerkt | OpenAPI spec gegenereerd, README per module |
| Architectuurprincipes 1-6 groen | Sprint-DoD-checklist afgevinkt |

---

## 11. Gekwantificeerde differentiatie vs concurrenten

Doel: in elke vergelijkings-dimensie winnen of gelijk staan met Manatal/Recruitee/Bullhorn. Eind 2027 moet onderstaande tabel volledig groen zijn aan de TalentFlow-kant.

| Dimensie | Manatal | Recruitee | TalentFlow eind 2027 |
|---|---|---|---|
| API op alle plannen | ❌ Enterprise only | ❌ Enterprise only | ✅ standaard |
| White-label klantportaal | Add-on | Add-on | ✅ standaard |
| Custom Report Builder | Enterprise Plus | Pro+ | ✅ standaard |
| Multilingual AI (NL/DE/FR) | ❌ Engels-eerst | ❌ Engels-eerst | ✅ native |
| EU AI Act art. 13 disclosure | Bolted on Q2025 | Bolted on | ✅ ingebakken sinds dag 1 |
| Pay Transparency Directive 2026 | Optioneel | Optioneel | ✅ default-required |
| Talent Reactivation nightly | ❌ | ❌ | ✅ |
| Job health-score + predicted close | ❌ | ❌ | ✅ |
| Bias-checker JD ingebouwd | ❌ | ❌ | ✅ |
| Custom domain career-page + portal | Pro tier | Add-on | ✅ standaard |
| Time-to-publish job board | 24-48u | 24u | <5min realtime |
| Agentic LinkedIn outreach | ❌ | ❌ | ✅ |
| Temp/contract back-office | ❌ | ❌ | ✅ |
| Mobile PWA hiring-manager | ❌ | Beperkt | ✅ swipe-UI |
| Comparable past jobs (similarity) | ❌ | ❌ | ✅ |
| Source-ROI per kanaal | Beperkt | Beperkt | ✅ default |
| 6-tab job detail met health badge | 9 tabs zonder health | 5 tabs basic | ✅ sharper |
| CV anonimisering automatisch | Handmatig | ❌ | ✅ regel-engine |
| Skills Graph + ESCO mapping | ❌ | ❌ | ✅ |
| AI Interview Transcriptie | ❌ | Beperkt | ✅ |
| WORM audit-trail | ❌ | ❌ | ✅ |
| SSO/SAML + SCIM | Enterprise | Enterprise | ✅ standaard |
| OpenAPI spec + Swagger | Niet publiek | Beperkt | ✅ auto-generated |

**Differentiator-density doelstelling:** 23/23 dimensies winnen of gelijk. Eind Q4 2027.

---

## 12. Werkwijze — multi-agent dispatch pattern

Bewezen in 2026 (Slices 1-4.5). Continueren in 2027.

Per sprint:
1. **Plan-phase**: detail-prompts schrijven voor 3 parallel agents met scherpe non-overlapping file-domains.
2. **Parallel dispatch**: 3 agents starten tegelijk met eigen scope + shared contract.
3. **Wrap-up**: typechecks runnen, integratie-bugs fixen, smoke-test in browser via chrome-devtools MCP.
4. **Memory-update**: project-state-memory bijwerken na elke afgeronde sprint.
5. **DoD-check**: alle DoD-bullets + alle 6 architectuurprincipes groen voordat sprint dichtgaat.

Geschatte multiplier: **3 agents = ~3× snelheid** vs single-thread. Met deze pattern is **24 sprints in 2027 = ~48 weken werk = ~12 maanden** realistisch zonder hires.

---

## 13. Risico's + mitigatie

| Risico | Severity | Mitigatie |
|---|---|---|
| **Bus-factor 1** (Kaan = enige dev) | Critical | Q1: documentatie-discipline + multi-agent dispatch werkwijze gedocumenteerd. Code als single source of truth. Na 2027: hire #1 backend, #2 frontend (commercial scope). |
| **AI-cost-creep** | High | Mock-mode voor dev. Credit-counter in Redis (Q3). Switch-pad naar zelfgehoste embeddings (BGE-large) klaar als marges onder druk. |
| **EU AI Act-veranderingen** | Medium | `aiDisclosure.ts` is single-source-of-truth. AI-events log vanaf Q1.1. Compliance-officer review per major release. |
| **VPS single-point-of-failure** | High | Q1: dagelijkse R2-backups + restore-drill. Q3: secondary VPS in andere regio (Hetzner Falkenstein + Helsinki). Failover-runbook. |
| **Manatal AI-features (Q2025+ AI Interviewer + MCP server)** | Medium | Wij behouden voorsprong via pillar 6 predictive (Talent Reactivation, health-score, comparable jobs). Hun moves zijn reactief; wij blijven multilingual + EU-native voorlopen. |
| **LinkedIn API-restricties** | Medium-High | Q4.5: browser-extension fallback (zoals Loxo doet) als API-toegang gestopt. |
| **GDPR-boete bij datalek** | Critical | Q2.3: anonimisering + consent-management + retentie-cron + WORM audit — alles audit-bewijsbaar. Q1.1: Sentry + back-up + restore-drill. |
| **pgvector vendor-lock op Hetzner** | Low | pgvector is open-source. Migratie naar Neon/Supabase mogelijk binnen 1 dag indien nodig. |
| **Kandidaat-data-omvang groei** | Low-Medium | Q1.1: storage-abstractie naar S3/MinIO afgerond. Cold-storage tier-cron na 12 maanden inactiviteit. |

---

## 14. Open vragen voor 2027 Q1

Te beantwoorden bij Q1.1-kickoff:
- Welk hostingplan op Hetzner? CCX13 of CCX23 voor productie-DB performance bij 5.540+ kandidaten?
- Welke retentie-default? 12, 24 of 36 maanden? IT Proposal-keuze sturend voor template.
- Anonimiseer-engine: regel-based of AI-based? Q2 keuze (AI duurder maar slimmer; regel goedkoper en deterministisch).
- Skills Graph: ESCO importeren als hele snapshot of incrementeel via API?
- Mobile: PWA volstaat of straks toch native iOS/Android (Q4)?

---

## 15. Slotstructuur van het docs-document

Dit masterplan wordt na approval opgeslagen in `talentflow/docs/Masterplan_2027.md` met deze hoofdstukken:

1. Executive summary
2. Doel en context
3. Productvisie (7 lagen)
4. Architectuurprincipes
5. Compliance by design
6. AI governance
7. Security baseline
8. Data-model entiteiten
9. Status-audit eind 2026
10. Roadmap per kwartaal × laag
11. Definition of Done per release
12. Gekwantificeerde differentiatie vs concurrenten
13. Werkwijze (multi-agent dispatch)
14. Risico's + mitigatie
15. Open vragen + bronnen

---

## Bronnen

[1] AI recruitment compliance: what's allowed in 2026 (EU AI Act). https://www.aiactblog.nl/en/posts/ai-recruitment-selection-compliance
[2] What the EU AI Act Means for Staffing Businesses. https://artificialintelligenceact.eu/what-the-act-means-for-staffing-businesses/
[3] EU AI Act voor agentic recruitment. https://simplyrecruit.ai/nl/posts/eu-ai-act-agentic-recruitment
[4] The developer's guide to SaaS multi-tenant architecture (WorkOS). https://workos.com/blog/developers-guide-saas-multi-tenant-architecture
[5] Multi-Tenant Deployment 2026 Guide. https://qrvey.com/blog/multi-tenant-deployment/
[6] The Best GDPR Compliance Recruitment Software of 2026. https://www.mokahr.io/articles/en/the-best-gdpr-compliance-recruitment-software
[7] 10 Top ATS Features for 2026. https://recruitwithatlas.com/blog/top-ats-features/
[8] EU AI Act HR Software Compliance 2026 SME Guide. https://www.linkedin.com/pulse/eu-ai-act-hr-software-compliance-2026-sme-guide-dr-hernani-costa-oumze
