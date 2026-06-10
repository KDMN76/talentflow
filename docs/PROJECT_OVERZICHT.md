# TalentFlow — Compleet Projectoverzicht

**Datum:** 2026-06-17 · **Status:** levend document, bijwerken bij elke milestone.
**Bronnen:** codebase-meting, site-audit (61 routes, browser-gedreven), ROADMAP.md,
docs/Masterplan_Stage.md, docs/Masterplan_2027.md, docs/Manatal_Feature_Pariteit.md,
docs/IT_Proposal_Cutover_Plan.md, docs/TCO_ROI.md.

---

## 1. Wat is TalentFlow

Multi-tenant recruitment-SaaS (ATS + CRM + back-office) van KDMN Projecten.
Drie sporen tegelijk:

1. **BIM-stage-opdracht** — benchmark is Manatal (€1.000/mnd); doel: aantoonbare
   feature-pariteit + drastisch lagere TCO.
2. **Pilot bij IT Proposal BV** (recruitmentbureau, 9 recruiters) — design partner,
   krijgt het gratis; eerste recruiter werkt al live op het systeem.
3. **Commercieel SaaS-product** — verkoop aan NL/BE-bureaus (3-50 recruiters),
   met meertaligheid, white-label en open API als differentiators.

**Businesscase (docs/TCO_ROI.md):** Manatal kost €36.000 over 3 jaar; TalentFlow
operationeel €3.393 (−91%). Incl. extern onderhoud: netto-besparing €21.207,
ROI 6,3×, break-even op dag 1 na go-live.

---

## 2. Omgevingen & huidige stand

| Omgeving | Waar | Stand |
|---|---|---|
| **Productie** | https://talentflow.kdmn.nl (Hetzner VPS 91.98.232.104, Docker: postgres+redis+minio+api+worker+web achter host-Nginx) | Draait op `main` — **zonder** de fixes/features hieronder; recruiter ziet o.a. nog de reports-crash |
| **Dev** | lokaal (`c:\dev\talentflow`) + Neon-Postgres + Upstash-Redis | Volledig werkend incl. alle fixes + NL/EN |
| **GitHub** | KDMN76/talentflow (private) | `main` + 2 branches klaar voor deploy |

**Branches die klaarstaan (nog deployen!):**
- `fix/sectie-1-opruiming` — 11 witte-pagina-crashes gefixt (o.a. **Reports**, de
  klacht van de recruiter), JobHealth-contract, trust proxy, deploy-tooling.
- `feat/i18n-foundation` (bovenop de fixes) — meertaligheid NL/EN, kern-flow
  vertaald, taalvoorkeur per gebruiker/tenant. **Vereist migratie 033 op de VPS.**

---

## 3. Omvang in cijfers

| Metric | Waarde |
|---|---|
| Schermen (web-routes) | 88 |
| API-modules | 44 |
| API-operaties (OpenAPI) | 309 over 250 paden, 42 tags |
| Database-tabellen | ~120 (33 idempotente migraties) |
| Background-workers (BullMQ) | 35 |
| Geautomatiseerde tests | 1.519 (api) + 15 (web), groen |
| Talen | NL + EN, 297 vertaalsleutels per taal, pariteit-bewaakt |
| Gedeelde packages | @talentflow/contracts (Zod-schemas), @talentflow/i18n (catalogs) |

---

## 4. Wat is gebouwd (per domein, eerlijke status)

Legenda: ✅ werkt end-to-end · 🟡 deels (UI klaar, backend mock/half) · 🔴 UI bestaat, backend ontbreekt

### Kern-ATS
| Onderdeel | Status | Toelichting |
|---|---|---|
| Vacatures (lijst/detail/formulier/dupliceren/templates) | ✅ | Incl. shared Zod-contracts, health-score, AI JD-generator-UI |
| Kandidaten (CRUD, CV-upload, skills) | ✅ | CV-parsing werkt (mock-AI in dev; echte key = aanzetten) |
| Pipeline / Kanban (drag & drop, stages per vacature) | ✅ | |
| Dashboard (KPI's, activiteit, top-vacatures) | ✅ | |
| Interviews (agenda, kits, scorecards-UI) | ✅/🟡 | Basis werkt; transcriptie/AI-samenvatting in mock-mode |
| Inbox / omni-channel | 🟡 | UI + threads-model; echte mail-sync vereist OAuth-koppeling |
| Zoeken (Boolean search) | 🔴 | UI-component bestaat; parser/backend gepland (Q1 2027) |
| CSV bulk-import + duplicate-merge | 🟡 | Dialogen bestaan; end-to-end flow afmaken |

### Bureau / back-office
| Onderdeel | Status |
|---|---|
| Contracten, timesheets, facturen, commissies | ✅ UI + API (na crash-fixes); echte data-flow met dunne dev-data nog te bewijzen |
| Forecasting (revenue/margin) | 🟡 endpoints bestaan, shapes net gefixt |

### Communicatie & outreach
| Onderdeel | Status |
|---|---|
| E-mail-templates, campagnes, outreach-sequences | ✅ UI + API |
| Resend-verzending | 🟡 werkt zodra API-key gezet (nu mock) |
| Gmail/Outlook 2-way sync | 🔴 stub — Masterplan Q3 2027 |
| WhatsApp Business / Voice (Twilio) | 🟡 schema + UI + workers; integratie-keys ontbreken |

### AI-laag
| Onderdeel | Status |
|---|---|
| CV-parsing, embeddings, matching (pgvector + HNSW) | 🟡 volledig gebouwd, draait in **mock-mode** (geen Anthropic/OpenAI-keys in prod) |
| JD-generator + bias-check | 🟡 idem |
| Talent Fit Model, reactivation-alerts | 🟡 backend + UI; mock-mode |
| Sourcing Agent | 🔴 `/api/sourcing/findings` + `/actions` ontbreken (404) |

### Compliance & security
| Onderdeel | Status |
|---|---|
| Multi-tenant RLS (PostgreSQL) | ✅ gevalideerd met cross-tenant-tests |
| GDPR/DSAR-export, self-service-portal | 🟡 backend + tokens bestaan; UI-flow afmaken |
| WORM audit-trail | 🟡 events worden geschreven; `/audit-events/actions` endpoint ontbreekt (UI spint) |
| Pay Transparency (EU 2023/970) | ✅ afdwinging in JobForm + tenant-settings |
| Rollen & rechten (RBAC + custom roles) | ✅ na permissions-matrix-fix |
| 2FA / SSO-SAML / SCIM / IP-allowlist | 🟡 tabellen + UI; `/auth/2fa/status`, `/admin/security*`, `/admin/sso/scim` ontbreken (404/403) |
| Hiring-Manager PWA | 🔴 `/hm/stats` 404, `/hm/reviews/pending` **500** |
| Notificatie-devices | 🔴 `/api/notifications/devices` 404 |

### Platform & developer-experience
| Onderdeel | Status |
|---|---|
| Open API + api-keys + API-explorer/playground | ✅ |
| Webhooks + workflows-engine | ✅ UI/API; workflow-acties verdiepen gepland |
| Job-board-connectors (Stepstone/Jobs.nl/Werkzoeken) | 🟡 connectors + tests bestaan; echte posting-integratie gepland (Q4 2027) |
| Career pages + klantportalen (guest-links) | 🟡 builder-UI + tabellen; publieke render/custom domain gepland |
| Skills graph | ✅ UI werkt |
| Analytics & reports | 🟡 reports-crash gefixt; deel endpoints levert echte data, deel mock — "echte data overal" gepland |
| **Meertaligheid (NL/EN)** | ✅ fundering + kern-flow; overige schermen vallen terug op NL |
| Deploy-tooling | ✅ infra/deploy.sh (altijd --env-file), fail-safe healthchecks, prune-script, docs/docker.md |

---

## 5. Recent opgeleverd (juni 2026, branches klaar voor deploy)

**Branch `fix/sectie-1-opruiming`:**
- 11 witte-pagina-crashes opgelost en in de browser geverifieerd: reports,
  communications, commissions, job-boards, analytics/back-office, pipeline-tab,
  job-detail (health), settings → accounting/integrations/roles/availability/sso.
  Gedeelde oorzaak: hooks gaven het response-wrapper-object terug i.p.v. de array.
- JobHealth in @talentflow/contracts (score + components), embedding-leak dicht,
  trust proxy, pg-deprecation weg (5 services), rate-limits env-tunebaar,
  analytics-NaN-guard, PWA-icons, @types/react-pin, deploy.sh + docs/docker.md.
- Volledige site-audit: 61 routes gecrawld; 0 crashes na fixes.

**Branch `feat/i18n-foundation`:**
- packages/i18n (gedeelde catalogs, mobiel-klaar), react-i18next, taal-switcher,
  cookie + Accept-Language, migratie 033 (`tenants.default_language`,
  `users.language`), resolutie user→tenant→browser→NL, Intl-datums.
- Vertaald NL+EN: login/registratie, navigatie/topbar, dashboard, vacatures
  (incl. filterbalk), kandidaten, pipeline, interviews. Pariteit-check als gate.
- Bijvangst: lokale migrate-runner gefixt; dev-rate-limiters in-memory
  (Upstash-quota crashte de dev-API).

---

## 6. Wat we nog gaan bouwen

### 6.1 Nu — vóór/rond de recruiter-pilot (dagen)
1. **Deployen** van beide branches naar productie (incl. migratie 033) — daarmee
   is de reports-klacht van de recruiter opgelost én is EN live.
2. **Demo-/seed-data** voor overtuigende schermen (kandidaten in de pipeline).
3. **P1 ontbrekende endpoints** (gevonden in de audit): hm/stats + hm/reviews
   (500!), hm/scorecards/deadlines, sourcing findings/actions,
   compliance/audit-events/actions, notifications/devices, auth/2fa/status,
   admin/security*, admin/sso/scim.
4. **Funnel-endpoint** compleet maken (hired/dropped/total + veldnamen) — zie
   ROADMAP; nu staat er een nette 0-fallback.
5. **Wensenlijst recruiter** verwerken (sessie met IT Proposal) — prioriteren
   bovenop deze lijst.

### 6.2 i18n — fase 2 (week-schaal)
- Overige ~75 schermen migreren per namespace (zelfde recept; NL-fallback
  vangt op tot het af is). Zod-validatieteksten; datum-locales buiten kern;
  tenant-default-taal instelbaar in de UI. Derde taal = map + vertaling.

### 6.3 Stage-traject — Manatal-pariteit & cutover (docs/Masterplan_Stage.md)
Pariteit-checklist: 64 tests (27 critical / 24 major / 13 minor); go-live-criterium
0 critical + ≤10 major rood. Grootste gaten richting cutover:
- Boolean search parser · CSV-bulk-import end-to-end · Gmail/Outlook 2-way
  e-mail · GDPR-dashboard + consent-UI · workflows volledig operationeel.
Cutover-plan IT Proposal (docs/IT_Proposal_Cutover_Plan.md): −4 t/m +4 weken,
shadow-run, migratie van 5.540 kandidaten + 24 jobs, hypercare met dagelijkse
standup. Go/no-go o.a.: lijst-performance <3s, recruiter-feedback ≥7/9.

### 6.4 Masterplan 2027 (docs/Masterplan_2027.md, per kwartaal)
- **Q1**: Core-ATS afmaken — CSV-import, Boolean search, duplicate-merge,
  custom fields, scorecards, bulk-acties, export.
- **Q2**: Collaboration + compliance — klantportaal white-label, career-page
  builder (6 templates), CV-anonimisering, GDPR-dashboard, HM-PWA.
- **Q3**: Automation + intelligence — native 2-way mail-sync, AI JD-generator
  volwaardig, Talent Reactivation, Talent Fit Model, Interview Suite,
  report-builder, Skills Graph + ESCO.
- **Q4**: Extensibility — OpenAPI/Swagger publiek, SSO/SAML/SCIM af,
  jobboard-integraties echt, temp/contract-back-office verdiepen, agentic
  sourcing, WhatsApp + omni-channel inbox af.

### 6.5 Mobiele app (besloten richting)
React Native-app voor recruiters; de i18n-architectuur (gedeelde catalogs in
packages/i18n) is hierop voorbereid. Nog niet gepland in een kwartaal.

### 6.6 Commercieel (ROADMAP Sectie 3)
Tweede klant (onboarding, pricing, verwerkersovereenkomst, Stripe), demo-tenant
voor prospects, enterprise-pad (SLA, dedicated DB, white-glove), AI Act-module,
GDPR-export/-delete self-service (AVG art. 15/17), DESIGN.md-uitrol na go-live.

---

## 7. Bekende risico's & technische schulden

| Item | Impact | Actie |
|---|---|---|
| Productie draait nog zonder de fixes | Recruiter ziet crashes (reports!) | Deployen (§6.1) |
| Sentry-DSN leeg in prod | Geen error-monitoring | Key zetten bij deploy |
| AI/e-mail-keys leeg (mock-mode) | AI/mail-features inert | Keys zetten zodra gewenst |
| Backup-script niet als cron | Geen automatische backups | infra/backup.sh inplannen |
| CI faalt op tests (mist services) | Geen groene pipeline | Postgres/Redis-services in Actions |
| Upstash dev-Redis-quota op | Dev-queues gedegradeerd | Reset afwachten of nieuwe dev-Redis |
| compose env_file-vangnet | Deploy-fout blijft mogelijk buiten deploy.sh | ROADMAP-item, op VPS valideren |
| OneDrive-kopie van repo (stale) | Verwarring/AVG | Verwijderkandidaat — beslissing Kaan |

---

## 8. Verwijzingen

- ROADMAP.md — levende backlog (bugs/features/ideeën, P-prioriteiten)
- docs/Masterplan_Stage.md · docs/Masterplan_2027.md — fasering
- docs/Manatal_Feature_Pariteit.md · docs/Pariteit_Checklist.md — benchmark
- docs/IT_Proposal_Cutover_Plan.md · docs/Hypercare_Plan.md — go-live
- docs/TCO_ROI.md — businesscase
- docs/docker.md — deploy-runbook · infra/deploy.sh — canonieke deploy
- packages/i18n/ — meertaligheid · packages/contracts/ — API-contracts
