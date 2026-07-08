# TalentFlow — Compleet Projectoverzicht

**Datum:** 2026-06-17 · **Versie:** 2 (volledige module-inventaris + complete backlog)
**Bronnen:** code-doorlichting van alle 44 API-modules + 88 schermen (6 parallelle
review-agents), browser-audit (61 routes), ROADMAP.md, docs/Masterplan_Stage.md,
docs/Masterplan_2027.md, docs/Manatal_Feature_Pariteit.md,
docs/IT_Proposal_Cutover_Plan.md, docs/TCO_ROI.md.

---

## 1. Wat is TalentFlow

Multi-tenant recruitment-SaaS (ATS + CRM + back-office) van KDMN Projecten.
Drie sporen: (1) BIM-stage-opdracht met Manatal als benchmark, (2) pilot bij
IT Proposal BV (9 recruiters; eerste recruiter werkt al live), (3) commercieel
SaaS-product voor NL/BE-bureaus van 3-50 recruiters.

**Businesscase (docs/TCO_ROI.md):** Manatal €22.320 / 3 jaar (werkelijke
factuur ≈€620/mnd) vs. TalentFlow €3.393 operationeel (−85%). Incl. extern
onderhoud: netto-besparing €7.527, ROI 2,2×, break-even dag 1 na go-live.

---

## 2. Omgevingen

| Omgeving | Waar | Stand |
|---|---|---|
| **Productie** | https://talentflow.kdmn.nl (Hetzner VPS, Docker-stack achter Nginx) | Draait op `main` — **zónder** onderstaande fixes; recruiter ziet o.a. nog de reports-crash |
| **Dev** | `c:\dev\talentflow` + Neon + Upstash | Alles werkend incl. fixes + NL/EN |
| **GitHub** | KDMN76/talentflow (private) | `main` + 2 deploy-klare branches |

**Klaar voor deploy:** `fix/sectie-1-opruiming` (11 crash-fixes incl. Reports,
deploy-tooling) en `feat/i18n-foundation` (NL/EN + taalvoorkeur; vereist
migratie 033 op de VPS).

---

## 3. Omvang in cijfers

| Metric | Waarde |
|---|---|
| Schermen (web-routes) | 88 |
| API-modules | 44 |
| API-operaties | 309 (250 paden, 42 tags, OpenAPI) |
| Database | ~120 tabellen, 33 idempotente migraties, RLS multi-tenant |
| Background-workers (BullMQ) | 35 |
| Tests | 1.519 (api) + 15 (web), groen |
| Talen | NL + EN (297 sleutels/taal, pariteit-bewaakt); nieuwe taal = 1 map |
| Gedeelde packages | @talentflow/contracts (Zod), @talentflow/i18n (catalogs) |

---

## 4. Wat is er in totaal gebouwd — volledige module-inventaris

Legenda status: ✅ werkend end-to-end · 🤖 werkend, maar AI/mail draait in
mock-mode (API-keys leeg) · 🟡 deels · 🔴 backend ontbreekt.
Demo: 🎬 nu presenteerbaar · 🌱 presenteerbaar mét seed-data · 🚫 nog niet tonen.

### 4.1 Kern-ATS (8 modules)

| Module | Wat het kan | Status | Demo |
|---|---|---|---|
| **Jobs** (35 endpoints) | Volledige vacature-CRUD met Manatal-pariteit-velden · AI JD-generator (1-5 varianten, NL/EN/DE/FR, tone/length) · job-templates · team/notities/attachments (25MB) per vacature · funnel, health-score, comparable jobs, bias-detectie · pay-transparency-handhaving (EU 2023/970) blokkeert publicatie zonder salarisband · dupliceren incl. stages. Schermen: /jobs, /jobs/new, /jobs/[id] (7 tabs), /jobs/jd-drafts, AI-generator | 🤖 | 🎬 |
| **Candidates** (17) | Kandidaat-CRUD (volledig profiel incl. GDPR-consent) · multi-CV-upload (5×10MB) + parsing · skills + ESCO-sync · bulk-acties (archive/tag/source/stage, 500 per request) · activity-timeline · deduplicatie · zoeken/filteren | 🤖 | 🎬 |
| **Pipeline** (8) | Kanban met drag&drop + optimistic updates · stage-CRUD (kleur/positie) · application-lifecycle (active→rejected/withdrawn/hired) · idempotente stage-templates · volledige audit-trail | ✅ | 🎬 |
| **Dashboard** (1) | KPI's (open vacatures, kandidaten/mnd, sollicitaties/wk, hires/mnd) · activity-feed (laatste 20) · top-5 vacatures · reactivation-alerts-widget | ✅ | 🎬 |
| **Interviews** (15) | Plannen met conflict-detectie · deelnemers/rollen/aanwezigheid · Google Meet/Teams/Zoom/telefoon/op-locatie · interview-kits · beschikbaarheid (week-rooster + datum-overrides) · vrije-slots-berekening · reminders via queue | ✅ | 🎬 |
| **Scorecards** (7) | Templates met gewogen criteria · upsert per (sollicitatie, stage, interviewer) · aanbevelingsschaal strong_yes→strong_no · draft vs. ingediend | ✅ | 🌱 |
| **Skills** (8) | ESCO-taxonomie-zoeken · skill-profielen kandidaat/vacature · gap-analyse (strong/good/partial/weak fit) · LLM-geassisteerde ESCO-mapping · trending skills + vraag/aanbod-statistieken | 🤖 | 🎬 |
| **Saved Searches** (5) | Opgeslagen Boolean-zoekopdrachten per gebruiker (kandidaten/vacatures) met syntax-validatie | ✅ | 🌱 |

### 4.2 Bureau & financiën (7 modules)

| Module | Wat het kan | Status | Demo |
|---|---|---|---|
| **Contracts** (9) | Plaatsingscontracten (temp/detachering/vast/freelance) · status-machine draft→active→renewed/ended/terminated · verlengen/beëindigen met audit · verloop-reminders (30/14/7 dgn) · tarieven + marge + CAO-velden | ✅ | 🎬 |
| **Timesheets** (16) | Week-urenstaten met goedkeuringsflow (draft→submitted→approved/rejected/disputed) · dag-entries incl. overuren · approver-queue · **publiek portaal**: kandidaat vult uren via token-link zonder login (rate-limited) | ✅ | 🎬 |
| **Billing/Invoices** (9) | Facturen uit goedgekeurde uren (week/maand/flat) · concurrency-safe sequentiële nummering · PDF naar S3/MinIO · BTW configureerbaar · draft→sent→paid/void · sync naar boekhouding + triggert commissies | ✅ | 🎬 |
| **Commissions** (9) | 5 provisie-modellen (flat, % fee, % marge, tiered, recurring) · toewijzing recruiter↔contract↔schema · records per factuur met approve/pay/dispute | ✅ | 🎬 |
| **Accounting** (5) | Koppelingen Exact Online / Twinfield / SnelStart · OAuth of API-key (versleuteld) · factuur-push met external-id-tracking | ✅ | 🎬 |
| **Forecasting** (3) | Omzet-forecast 1-24 mnd (verwacht + pipeline-kans per CRM-stage) · marge-analyse per klant/recruiter · nachtelijkse snapshots + handmatige recompute | ✅ | 🎬 |
| **Exports** (5) | CSV/XLSX van kandidaten/vacatures/sollicitaties/communicatie/workflows · kolom-selectie · filters · audit-gelogd | ✅ | 🎬 |

### 4.3 Communicatie & outreach (9 modules)

| Module | Wat het kan | Status | Demo |
|---|---|---|---|
| **Communications** (7) | Multi-channel verzenden (e-mail/WhatsApp/SMS) per kandidaat · bulk-campagnes tot 5.000 ontvangers met GDPR-consent-check · rate-limiting 1 mail/s | 🤖 | 🌱 |
| **E-mail-templates** (5) | CRUD met HTML+plain-text · automatische merge-variabele-extractie ({{var}}) · gebruikt door bulk + outreach | ✅ | 🎬 |
| **E-mail-inbound** (1) | Resend-webhook → plus-addressing (reply+tenant+thread@) → thread in unified inbox | 🤖 | 🚫 |
| **Inbox** (13) | Omni-channel unified inbox (Slack-stijl, 3 panelen) · threads met filters/labels/pin/archief/toewijzing · samengevoegde tijdlijn (mail+voice+outreach) · unread-counts | ✅ | 🌱 |
| **Outreach** (15) | AI-drafting (Claude) met personalisatie op signalen · approval-workflow · quota per recruiter/kanaal · reply-classificatie (interested/not_now/…) · append-only na verzending (DB-trigger) | 🤖 | 🌱 |
| **Nurture** (12) | Multi-step sequences (kanaal, delay, AI-personalisatie, stop-on-reply) · enrollment-statusmachine · automatische volgende-stap-planning | 🤖 | 🌱 |
| **WhatsApp** (15) | 360dialog-integratie · template-beheer incl. media + status-sync · consent-tracking (GDPR) met opt-in-tokens · health-check | 🤖 | 🌱 |
| **Voice** (8) | Twilio-koppeling · outbound calls + status/opname · Whisper-transcriptie · notities · calls in unified inbox | 🤖 | 🌱 |
| **Notifications** (11) | PWA-push (VAPID) · voorkeuren per event-type · quiet-hours · delivery-log. **Gat:** /api/notifications/devices ontbreekt; delivery-flow half | 🟡 | 🚫 |

### 4.4 AI & matching (3 modules)

| Module | Wat het kan | Status | Demo |
|---|---|---|---|
| **Matching** (13) | Vector-search (pgvector, 1536-dim, cosine) · Talent-Fit-model (logistische regressie op eigen hires; 60/40-combinatie) · AI-uitleg per match (7 dgn cache, EU AI Act-disclaimer) · "similar hires"-badge · nachtelijke reactivation-alerts met acknowledge/dismiss | ✅* | 🎬 |
| **Sourcing Agent** (18) | Brief → Claude-agent zoekt kandidaten (multi-iteratie boolean-loop) · findings-inbox met bulk-approve/reject · multi-source (LinkedIn + eigen ATS) · agent-memory · WORM-audit incl. token-kosten. **Gat:** UI roept /api/sourcing/findings + /actions aan die ontbreken | 🤖/🔴 | 🌱 |
| **Hiring Manager** (5) | Swipe-deck (links=afwijzen, rechts=goedkeuren, omhoog=later; 5s undo) · inline scorecards · HM-dashboard. **Gat:** UI roept /api/hm/stats aan, backend heeft /api/hm/dashboard (pad-mismatch) · /api/hm/reviews/pending geeft 500 | 🟡 | 🌱 |

*Matching: AI-úítleg in mock; de matching/ranking zelf werkt.

### 4.5 Compliance & security (6 modules)

| Module | Wat het kan | Status | Demo |
|---|---|---|---|
| **Compliance** (26) | Retentie-policies met automatische actie (archiveer/anonimiseer/verwijder) · DSAR-flow (inzage/export/correctie/verwijdering) · **self-service-portaal** voor kandidaten (token, 7 dgn) · onomkeerbare anonimisatie incl. CV-verwijdering · audit-trail met filters + CSV/JSON-export · DEI-funnel- en pay-equity-rapportages · AI-events-logging. **Gat:** /audit-events/actions-endpoint ontbreekt (filter-dropdown leeg) | ✅ | 🎬 |
| **Auth** (12) | Tenant-registratie + login (JWT 15min + httpOnly refresh 7d) · rate-limiting · wachtwoord-reset-flow (mail in mock) · registratie-toggle via env. **Gebouwd maar niet ontsloten:** 2FA TOTP (QR + backup-codes), SSO/SAML (Okta/Azure), SCIM, IP-allowlist, password-policy — tabellen + services bestaan, admin-endpoints (/auth/2fa/status, /admin/security*, /admin/sso/scim) ontbreken in de router | 🟡 | 🎬 |
| **Roles** (13) | System-rollen + custom-role-builder met permission-matrix (resource × actie) · inheritance · meerdere rollen per user incl. expiry · delete-protectie | ✅ | 🎬 |
| **Users** (7) | Gebruikersbeheer + invite-flow (tijdelijk wachtwoord, mail in mock) · profiel · **taalvoorkeur per gebruiker** (user→tenant→browser→NL) · deactivatie incl. token-invalidatie | ✅ | 🎬 |
| **Tenants** (7) | Tenant-instellingen · white-label-branding (logo + 3 kleuren) · default-taal per tenant | ✅ | 🎬 |
| **Monitoring** (1) | Nachtelijke passieve-signalen-scan (baanwissel, open-to-work, funding…) → automatische reactivatie-drafts ter goedkeuring. Live LinkedIn-data = toekomstige vendor-licentie | 🤖 | 🌱 |

### 4.6 Platform & integraties (11 modules)

| Module | Wat het kan | Status | Demo |
|---|---|---|---|
| **API-keys** (9) | Keys met scopes, rotatie, IP-allowlist, rate-limit per key, vervaldatum · usage-statistieken (24h/7d, errors, per endpoint) · API-playground | ✅ | 🎬 |
| **Webhooks** (19) | Subscriptions met event-filtering + handtekening-secrets · delivery-logs · retry met exponential backoff · test-tool · event-catalogus | ✅ | 🎬 |
| **Workflows** (7) | Trigger→condities→acties (send_email, add_tag, move_to_stage, webhook…) · run-logs · atomaire uitvoering. **Gat:** visuele builder-UI ontbreekt nog (lijst werkt) | 🟡 | 🌱 |
| **Integrations/Mailbox** (4) | Gmail/Outlook OAuth-koppeling per recruiter · auto token-refresh · sync-state · meerdere mailboxen per user · verzenden vanuit eigen mailbox | ✅ | 🎬 |
| **Job-boards** (9) | Connector-registry (Stepstone, Jobs.nl, Werkzoeken…) · multi-board posting via queue + status-polling · intrekken · cost-per-hire-analytics | ✅ | 🎬 |
| **Custom fields** (5) | EAV-engine: eigen velden (text/number/date/dropdown/multiselect/boolean) op kandidaat/vacature/sollicitatie, per tenant | ✅ | 🎬 |
| **Career pages** (7) | Publieke vacaturepagina per tenant (SSR, zonder login) · online solliciteren incl. custom fields · branding (logo/kleur/font) · templates · bezoek-/sollicitatie-tellers · custom domain (CNAME) · taal per pagina | ✅ | 🎬 |
| **Portal (klantportaal)** (6) | Token-links per vacature voor externe klanten · granulaire permissies (CV's, AI-scores, contactinfo, approve/reject, comments) · branding-overrides + custom domain · feedback-flow · view-tracking | ✅ | 🎬 |
| **CRM** (17) | UI voor organisaties/contacten/deals + Kanban-dealboard. **KRITIEK GAT: de tabellen (organizations/contacts/deals) bestaan niet in de database** — API geeft netjes 503 "CRM_NOT_PROVISIONED"/lege lijsten | 🔴 | 🚫 |
| **Reports** (18) | Multi-block rapport-builder (metrics/filters/breakdowns) · templates (recruiter/manager/CHRO/DEI…) · 1h-cache · export PDF/Excel/CSV · publieke embed-tokens · scheduling voorbereid (executor ontbreekt) | ✅ | 🎬 |
| **Analytics** (6) | Overview-KPI's · recruitment-funnel met conversies · recruiter-performance · bron-analyse · time-to-hire-trend · cost-per-hire-dashboard | ✅ | 🌱 |

---

## 5. Wat kun je NU presenteren (demo-gids)

**Direct demo-baar (na deploy van de 2 branches):**
de complete recruiter-flow — dashboard → vacatures (incl. AI-JD-generator-flow)
→ kandidaten + CV-upload → kanban-pipeline → interviews + kits → scorecards →
back-office (contracten → uren → factuur → commissie) → rapporten → analytics →
instellingen (branding, rollen, custom fields, API-keys, webhooks) → career page
(publiek) → klantportaal-link → compliance/GDPR-dashboard → **taalwissel NL/EN**.

**Sterker mét seed-data (vooraf vullen):** pipeline met kandidaten, inbox,
outreach/nurture, scorecards, analytics-grafieken, sourcing-agent-findings.

**Nog niet laten zien:** CRM (geen database-tabellen), notificatie-instellingen,
hiring-manager-app (tot de 2 endpoint-fixes), e-mail-inbound. AI-features wél
tonen maar benoemen dat ze in demo-modus draaien tot de API-keys aanstaan.

---

## 6. Recent opgeleverd (juni 2026 — wacht op deploy)

- **11 witte-pagina-crashes** opgelost en browser-geverifieerd (o.a. Reports —
  de melding van de recruiter), JobHealth-contract, trust proxy, NaN-guards.
- **Deploy-tooling**: infra/deploy.sh (altijd --env-file), fail-safe
  healthchecks, prune-script, docs/docker.md.
- **Meertaligheid NL/EN**: packages/i18n (mobiel-klaar), taalwissel + voorkeur
  per gebruiker/tenant (migratie 033), kern-flow vertaald, pariteit-bewaking.
- Bijvangst: migrate-runner-fix, dev-rate-limiters in-memory (Upstash-quota).

---

## 7. Wat moeten we nog bouwen — complete backlog

### 7.1 Direct (dagen) — voor een soepele recruiter-pilot
1. **Deploy** beide branches + migratie 033 (runbook: docs/docker.md).
2. **Demo-/seed-data** voor pipeline, inbox, analytics.
3. **Snelle endpoint-fixes** (uit audit + inventaris):
   - /api/hm/stats → bestaat als /api/hm/dashboard (pad-mismatch, frontend-fix);
   - /api/hm/reviews/pending → 500 (query-bug);
   - /api/sourcing/findings + /actions, /api/compliance/audit-events/actions,
     /api/notifications/devices, /api/auth/2fa/status, /api/admin/security*,
     /api/admin/sso/scim → routes ontsluiten (services bestaan grotendeels al).
4. **Funnel-endpoint** compleet (hired/dropped/total + veldnamen) — ROADMAP.
5. **Wensen van de recruiter** verwerken (sessie ITProposal) — krijgt voorrang
   boven alles hieronder.

### 7.2 ROADMAP Sectie 1 — nog openstaande bugs/gaps
*(de overige Sectie-1-items zijn op 2026-06-03/06 opgelost — zie resolutielog
in ROADMAP.md)*
- deploy.sh vangnet #2: `env_file:` per compose-service (op VPS valideren; P2).
- Funnel-endpoint hired/dropped/total (P2, zie 7.1.4).
- VPS-archiefcontainers prunen — script ligt klaar (infra/prune-vps.sh), draaien (P3).
- `clients`-tabel ontbreekt → onderdeel van CRM-module hieronder (P2).

### 7.3 ROADMAP Sectie 2 — Features Backlog (alle items)
| Feature | Kern | Status/afhankelijkheid |
|---|---|---|
| **Clients/CRM-module** | DB-migratie (organizations/contacts/deals) + services; UI bestaat al volledig | Grootste quick-win: alleen backend |
| **Demo-tenant voor prospects** | Read-only tenant met realistische data | Ook nuttig voor de pilot-demo |
| **Multi-tenant white-label** | Branding werkt; custom subdomein per tenant nog niet | |
| **DESIGN.md-uitrol** | Herstijlen (forest #0F7A3C, Inter, borders>shadows) — ná go-live | DESIGN.md moet nog geschreven |
| **AI-features activeren** | Keys zetten (Anthropic/OpenAI) + UI-polish matching/outreach/reactivatie | Infra staat er; alleen bouwen als recruiter erom vraagt |
| **Integraties** | Gmail/Outlook-sync verdiepen (2-way), Calendar, jobboard-posting live | Mailbox-OAuth bestaat al |
| **2FA / SSO afronden** | Backend bestaat; admin-endpoints ontsluiten + UI-data (zie 7.1.3) | |
| **Audit-logs-UI** | Trail bestaat; /actions-endpoint + verfijning | Zie 7.1.3 |
| **Career pages verdiepen** | Builder-UX + publieke render-verbeteringen | Basis werkt al |
| **Klantportaal verdiepen** | Flow werkt; UX + notificaties | |
| **Analytics: echte data overal** | Mock-fallbacks vervangen; datum-filters toevoegen | |
| **Reports-module verdiepen** | Crash is gefixt; scheduled exports (executor), drag-drop-builder | |
| **HM-module: echte flow** | Endpoint-fixes (7.1.3) + Web Push afronden | |
| **Invite-only registratie** | Magic-link-invite (7 dgn) i.p.v. open registratie + env-toggle | |
| **Wachtwoord-reset afmaken** | Flow bestaat; Resend-template + e2e-test zodra mail live | |
| ~~Rate-limit op /login~~ | ✅ Gedaan (authRateLimit, env-tunebaar) | af |

### 7.4 ROADMAP Sectie 3 — Ideeën & onderzoek
- SaaS-verkoop 2e klant: onboarding-proces, pricing-tiers, verwerkersovereenkomst, Stripe.
- Enterprise-pad: SLA-tier, dedicated DB, white-glove, custom-domain-SSL.
- EU AI Act-module: model-cards, bias-assessments, human-oversight-log (ai_events-tabel bestaat).
- Pay-transparency-module verdiepen (basis-handhaving werkt al).
- GDPR-export per kandidaat (AVG art. 15) — self-service-basis bestaat.
- GDPR-delete per kandidaat (AVG art. 17) — anonimisatie-engine bestaat.

### 7.5 Meertaligheid — fase 2
Overige ~75 schermen migreren per namespace (NL-fallback vangt op) · zod-
validatieteksten · datum-locales buiten de kern · tenant-default-taal in de UI
· daarna: FR/DE/ES = catalogs vertalen, nul code.

### 7.6 Stage-traject — Manatal-pariteit & cutover
Pariteit-checklist: 64 tests (27 critical / 24 major / 13 minor); go-live bij
0 critical + ≤10 major rood. Grootste pariteit-gaten:
**Boolean-search-backend** (UI + parser bestaan) · **CSV-bulk-import e2e** ·
**Gmail/Outlook 2-way sync** · GDPR-dashboard-verdieping · workflows-builder-UI.
Cutover IT Proposal (docs/IT_Proposal_Cutover_Plan.md): 8-weken-plan met
shadow-run, migratie 5.540 kandidaten + 24 jobs, hypercare; go/no-go o.a.
lijst <3s en recruiter-score ≥7/9.

### 7.7 Masterplan 2027 (docs/Masterplan_2027.md)
- **Q1** Core-ATS af: CSV-import, Boolean search, duplicate-merge, custom
  fields verdiepen, scorecards-flow, bulk-acties, export.
- **Q2** Collaboration + compliance: klantportaal-white-label, career-builder
  (6 templates), CV-anonimisering, GDPR-dashboard, HM-PWA.
- **Q3** Automation + intelligence: native 2-way mail, JD-generator volwaardig,
  Talent Reactivation, Talent-Fit-model, Interview Suite, report-builder,
  Skills Graph + ESCO.
- **Q4** Extensibility: OpenAPI publiek, SSO/SAML/SCIM af, jobboards live,
  temp/contract-verdieping, agentic sourcing, WhatsApp/omni-channel af.

### 7.8 Mobiele app (besloten richting)
React Native-app voor recruiters; deelt de i18n-catalogs (packages/i18n) en
de API. Nog in te plannen.

---

## 8. Risico's & technische schulden

| Item | Impact | Actie |
|---|---|---|
| Productie zonder de fixes | Recruiter ziet crashes | Deploy (7.1.1) |
| Sentry-DSN leeg | Geen error-monitoring | Key bij deploy |
| AI/mail-keys leeg (mock) | AI/mail inert | Keys zodra gewenst |
| OAuth-tokens mailbox plaintext | Security-schuld | pgcrypto-encryptie (roadmap) |
| Backup-script niet als cron | Geen automatische backups | infra/backup.sh inplannen |
| CI faalt (mist pg/redis-services) | Geen groene pipeline | Services in Actions |
| Upstash dev-quota op | Dev-queues gedegradeerd | Reset/nieuwe dev-Redis |
| OneDrive-repo-kopie (stale) | Verwarring/AVG | Verwijderen na akkoord Kaan |

---

## 9. Verwijzingen

ROADMAP.md (levende backlog) · docs/Masterplan_Stage.md · docs/Masterplan_2027.md
· docs/Manatal_Feature_Pariteit.md · docs/Pariteit_Checklist.md
· docs/IT_Proposal_Cutover_Plan.md · docs/Hypercare_Plan.md · docs/TCO_ROI.md
· docs/docker.md (deploy-runbook) · infra/deploy.sh · packages/i18n · packages/contracts
