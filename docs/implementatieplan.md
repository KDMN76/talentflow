# Recruitment SaaS Platform — Volledig Implementatieplan
**Datum:** April 2026  
**Stack:** Node.js + Next.js + PostgreSQL  
**Doel:** Manatal volledig vervangen + overtreffen als commercieel SaaS-product

---

## Context

Het bedrijf betaalt ≈€620/maand voor Manatal (werkelijke factuur $674/mnd: 16 seats × $39 + $50 add-on, zie TCO_ROI.md; destijds geschat op €1.000/mnd). Manatal heeft structurele zwaktes:
geen API op lagere plannen, slechte rapportage, geen WhatsApp/SMS, performance-
degradatie bij schaal, beperkte career page builder, AI die slecht werkt voor
niet-Engelse CV's. De markt mist een platform dat Manatal-prijs combineert met
Ashby-analytics, Vincere-bureaufunctionaliteit en moderne omni-channel communicatie.

**Doelgroep:** (A) Recruitmentbureaus 3–50 recruiters, (B) Interne HR-teams MKB/mid-market  
**Positionering:** "Manatal-prijs. Ashby-analytics. Vincere-bureaufeatures. Één platform."

---

## Architectuuroverzicht

```
┌─────────────────────────────────────────────────────────┐
│                    INTERNET / CDN                       │
└──────────────┬──────────────────────┬───────────────────┘
               │                      │
    ┌──────────▼──────────┐  ┌────────▼────────┐
    │   Next.js App       │  │  Career Pages   │
    │   (recruiter UI)    │  │  (SSR, public)  │
    │   Port 3000         │  │  Eigen domein   │
    └──────────┬──────────┘  └────────┬────────┘
               │                      │
    ┌──────────▼──────────────────────▼───────┐
    │          Node.js REST API                │
    │          Express + Fastify (Port 4000)  │
    │          JWT Auth + Tenant Middleware   │
    └────┬────────┬───────┬────────┬──────────┘
         │        │       │        │
    ┌────▼──┐ ┌───▼──┐ ┌──▼───┐ ┌─▼──────┐
    │Postgre│ │Redis │ │BullMQ│ │S3/     │
    │SQL    │ │Cache │ │Queue │ │MinIO   │
    │(RLS)  │ │      │ │Jobs  │ │Files   │
    └───────┘ └──────┘ └──────┘ └────────┘
```

**Deployment:** Hetzner VPS (91.98.232.104) + Docker Compose + Nginx reverse proxy  
**Bestaande infra hergebruiken:** zelfde VPS als kdmn-planning, zelfde PostgreSQL instance

---

## Multi-Tenancy Strategie

**Aanpak:** Shared schema + `tenant_id` op elke tabel + PostgreSQL Row-Level Security (RLS)

- Elke organisatie is een `tenant` met uniek UUID
- Elke API-request heeft `tenant_id` via JWT claim
- PostgreSQL RLS policy: `USING (tenant_id = current_setting('app.tenant_id')::uuid)`
- Volledig data-isolatie zonder schema-complexiteit
- Eenvoudig te schalen, simpelste aanpak voor klein team

```sql
-- Elke tabel:
CREATE TABLE candidates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  ...
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON candidates
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

---

## Database Schema — Kernentiteiten

```
tenants            (id, name, slug, plan, settings, created_at)
users              (id, tenant_id, email, role, name, avatar)
organizations      (id, tenant_id, name, type[client|dept], settings)
jobs               (id, tenant_id, org_id, title, description, status, pipeline_template_id)
pipeline_stages    (id, tenant_id, job_id, name, position, color)
candidates         (id, tenant_id, name, email, phone, resume_url, ai_score, skills[])
applications       (id, tenant_id, job_id, candidate_id, stage_id, status, applied_at)
activities         (id, tenant_id, entity_type, entity_id, user_id, action, payload)
communications     (id, tenant_id, candidate_id, channel, direction, body, sent_at)
scorecards         (id, tenant_id, application_id, user_id, score, notes)
crm_contacts       (id, tenant_id, org_id, name, email, phone, linkedin_url)
crm_deals          (id, tenant_id, org_id, job_id, stage, value, recruiter_id)
career_pages       (id, tenant_id, subdomain, custom_domain, config_json, active)
guest_portal_links (id, tenant_id, job_id, token, permissions_json, expires_at)
reports            (id, tenant_id, type, config_json, created_by)
workflows          (id, tenant_id, trigger, conditions_json, actions_json, active)
api_keys           (id, tenant_id, name, key_hash, permissions[], last_used_at)
```

---

## Project Structuur

```
recruitment-platform/
├── apps/
│   ├── web/                    # Next.js app (recruiter dashboard)
│   │   ├── app/               # App Router
│   │   │   ├── (auth)/        # Login, register, forgot-password
│   │   │   ├── (dashboard)/   # Beschermde recruiter UI
│   │   │   │   ├── jobs/
│   │   │   │   ├── candidates/
│   │   │   │   ├── pipeline/
│   │   │   │   ├── crm/
│   │   │   │   ├── analytics/
│   │   │   │   ├── settings/
│   │   │   │   └── career-pages/
│   │   │   └── careers/       # Publieke career pages (SSR)
│   │   │       └── [slug]/    # Tenant-specifieke career page
│   │   ├── components/
│   │   ├── lib/               # API client, auth helpers
│   │   └── middleware.ts      # Auth middleware + tenant routing
│   │
│   └── api/                   # Node.js/Express API
│       ├── src/
│       │   ├── modules/       # Feature modules (zie hieronder)
│       │   │   ├── auth/
│       │   │   ├── tenants/
│       │   │   ├── users/
│       │   │   ├── jobs/
│       │   │   ├── candidates/
│       │   │   ├── pipeline/
│       │   │   ├── applications/
│       │   │   ├── communications/
│       │   │   ├── crm/
│       │   │   ├── career-pages/
│       │   │   ├── analytics/
│       │   │   ├── ai/
│       │   │   ├── workflows/
│       │   │   ├── guest-portal/
│       │   │   └── jobboards/
│       │   ├── middleware/    # auth, tenant, ratelimit, logging
│       │   ├── queue/         # BullMQ workers
│       │   ├── db/            # PostgreSQL pool + migrations
│       │   └── index.ts       # Entry point
│       └── migrations/        # SQL migration files
│
├── packages/
│   ├── shared/                # Gedeelde types (TypeScript)
│   └── ui/                    # Gedeelde UI components
│
├── docker-compose.yml
├── docker-compose.prod.yml
└── nginx.conf
```

---

## Fase 1 — Fundament & MVP (3–4 maanden)

**Doel:** Werkend systeem dat Manatal vervangt voor eigen gebruik.

### 1.1 Infrastructuur & Auth

**Bestanden:**
- `apps/api/src/modules/auth/` — JWT + refresh tokens
- `apps/api/src/middleware/tenant.ts` — tenant_id uit JWT → PostgreSQL setting
- `apps/api/src/db/pool.ts` — PostgreSQL connection pool met RLS
- `apps/api/migrations/001_init.sql` — basis schema

**Taken:**
- [ ] Docker Compose opzetten: api + web + postgres + redis + nginx
- [ ] PostgreSQL schema aanmaken met RLS policies
- [ ] JWT authenticatie (access token 15min + refresh token 7 dagen)
- [ ] Tenant middleware: elke request → `SET app.tenant_id = '...'`
- [ ] Registration flow + email-verificatie
- [ ] Rollen: `super_admin`, `admin`, `recruiter`, `hiring_manager`, `viewer`
- [ ] Password reset flow
- [ ] Invitation systeem (nieuwe gebruikers uitnodigen)

**API Endpoints:**
```
POST /auth/register        -- nieuwe tenant + admin user aanmaken
POST /auth/login           -- JWT verkrijgen
POST /auth/refresh         -- access token vernieuwen
POST /auth/logout          -- refresh token invalideren
POST /auth/forgot-password
POST /auth/reset-password
POST /auth/invite          -- gebruiker uitnodigen
```

### 1.2 Kandidatenbeheer

**Bestanden:** `apps/api/src/modules/candidates/`

**Taken:**
- [ ] Kandidaat CRUD (aanmaken, lezen, bijwerken, archiveren)
- [ ] Bulk import via CSV (max 1.000 per keer, async via queue)
- [ ] CV-upload naar Cloudflare R2 (S3-compatibel, PDF, DOCX, max 10MB)
- [ ] Resume parser: `multer` upload → `pdf-parse` / `mammoth` → structured JSON → kandidaatprofiel
- [ ] Zoekfunctie: PostgreSQL full-text search (`tsvector`) + filters
- [ ] Boolean search: eigen parser die `AND/OR/NOT "exact phrase"` vertaalt naar PostgreSQL queries
- [ ] Filters opslaan per gebruiker (saved searches)
- [ ] Tags systeem op kandidaten
- [ ] Duplicaat-detectie op e-mailadres (merge-dialog ipv stil overslaan zoals Manatal)
- [ ] Skills extractie uit CV via LLM (OpenAI/Claude API call)
- [ ] Kandidaat-tijdlijn (alle activiteiten chronologisch)

**API Endpoints:**
```
GET    /candidates               -- lijst + zoeken + filteren
POST   /candidates               -- aanmaken
GET    /candidates/:id           -- profiel ophalen
PATCH  /candidates/:id           -- bijwerken
DELETE /candidates/:id           -- archiveren (soft delete)
POST   /candidates/import        -- bulk CSV import (async)
POST   /candidates/:id/resume    -- CV uploaden
GET    /candidates/:id/timeline  -- activiteiten
POST   /candidates/search        -- geavanceerde Boolean search
```

### 1.3 Vacaturebeheer

**Bestanden:** `apps/api/src/modules/jobs/`

**Taken:**
- [ ] Vacature CRUD (titel, beschrijving, afdeling, locatie, salaris, status)
- [ ] Vacature statussen: `draft` → `open` → `filled` → `closed` → `archived`
- [ ] Vacature koppelen aan organisatie/afdeling/klant
- [ ] Pipeline template per vacature (aanpasbare stadia)
- [ ] Vacature dupliceren (nieuw formulier pre-gevuld)
- [ ] Vacature toewijzen aan recruiter(s)
- [ ] Salarisveld met bandbreedte (Pay Transparency Directive 2026 ready)
- [ ] Vacature-templates opslaan

**API Endpoints:**
```
GET    /jobs              -- lijst
POST   /jobs              -- aanmaken
GET    /jobs/:id          -- detail
PATCH  /jobs/:id          -- bijwerken
DELETE /jobs/:id          -- archiveren
POST   /jobs/:id/duplicate
GET    /jobs/:id/stats    -- sollicitanten per fase, time-to-fill
```

### 1.4 Pipeline / Kanban

**Bestanden:** `apps/api/src/modules/pipeline/`

**Taken:**
- [ ] Pipeline stadia per vacature aanpasbaar (naam, kleur, positie)
- [ ] Kandidaat verplaatsen tussen stadia (drag-and-drop → PATCH endpoint)
- [ ] Bulk-actie: meerdere kandidaten tegelijk verplaatsen
- [ ] Scorecard invullen per kandidaat per stap
- [ ] Fase-specifieke e-mail templates (automatisch versturen bij verplaatsing)
- [ ] Automatisch archiveren gearchiveerde kandidaten bij jobsluiting FIX: opt-in per job ipv automatisch (Manatal-bug oplossen)
- [ ] Kanban-view + lijst-view
- [ ] Filtering op fase, recruiter, datum, score

**Frontend (Next.js):**
- Kanban board met `@dnd-kit/core` voor drag-and-drop
- Real-time updates via Server-Sent Events (SSE) of WebSocket

### 1.5 Gebruikersbeheer & Instellingen

**Taken:**
- [ ] Tenant instellingen (naam, logo, timezone, taal)
- [ ] Gebruikers uitnodigen, rollen toewijzen
- [ ] Gebruiker deactiveren (niet verwijderen — audit trail bewaren)
- [ ] Activiteitenlogboek voor admins (wie deed wat wanneer)
- [ ] Aangepaste velden aanmaken (kandidaten, vacatures, organisaties)
- [ ] E-mail templates beheren
- [ ] Pipeline stage templates (herbruikbare pipeline-setups)

### 1.6 Basisrapportage

**Taken:**
- [ ] Dashboard: open vacatures, kandidaten in pipeline, vandaag geplande interviews
- [ ] Time-to-hire per vacature
- [ ] Bron-analyse (via welk kanaal komen kandidaten binnen)
- [ ] Funnel-rapport: conversieratio per fase
- [ ] Exporteren naar CSV/Excel

---

## Fase 2 — Communicatie, Analytics & Open API (2–3 maanden)

**Doel:** De 3 grootste zwaktes van Manatal elimineren.

### 2.1 Omni-Channel Communicatie

**Bestanden:** `apps/api/src/modules/communications/`

**Taken:**
- [ ] **E-mail integratie:**
  - Gmail OAuth2 (`googleapis` npm package)
  - Outlook OAuth2 (`@microsoft/microsoft-graph-client`)
  - Gedeelde inbox per recruiter, getoond in kandidaatprofiel
  - Reply-tracking: inkomende replies automatisch koppelen aan kandidaat via thread-id
  - Bulk e-mail campagnes met GDPR-consent check vóór verzending
  - E-mail templates met merge-variabelen (`{{naam}}`, `{{vacature}}`, etc.)
  - 5.000 credits/maand standaard (vs. Manatal's 1.000)

- [ ] **WhatsApp Business API:**
  - Integratie via Twilio WhatsApp API of 360dialog (goedkoper voor EU)
  - Template messages voor approved business messaging
  - Inkomende WhatsApp-berichten tonen in kandidaatprofiel
  - GDPR opt-in flow voor WhatsApp communicatie

- [ ] **SMS:**
  - Twilio SMS API
  - Bulk SMS met merge-variabelen
  - Delivery status tracking

- [ ] **Communicatie-inbox:**
  - Unified inbox: alle kanalen in één tijdlijn per kandidaat
  - Antwoorden vanuit de kandidaatpagina (kanaal kiezen)
  - Ongelezen badges en notificaties

**Queue jobs (BullMQ):**
- `send-email` — via Gmail/Outlook API
- `send-whatsapp` — via Twilio/360dialog
- `send-sms` — via Twilio
- `sync-inbox` — periodiek e-mail ophalen
- `process-webhook` — inkomende berichten verwerken

### 2.2 Geavanceerde Analytics

**Bestanden:** `apps/api/src/modules/analytics/`

**Aanpak:** Materialized views in PostgreSQL voor performance + API endpoints  
**Frontend:** Recharts library in Next.js (geen externe BI tool nodig)

**Dashboards:**

**Recruiter Dashboard:**
- [ ] Persoonlijke pipeline-status: open vacatures, kandidaten in behandeling
- [ ] Mijn activiteiten vandaag/week
- [ ] Time-to-hire voor mijn vacatures
- [ ] Conversieratio per fase

**Manager/Admin Dashboard:**
- [ ] Team-overzicht: prestaties per recruiter
- [ ] Actieve vacatures + bezettingsgraad
- [ ] Source-effectiviteit (welk kanaal levert beste hires)
- [ ] Gemiddelde time-to-hire over tijd
- [ ] Offer acceptance rate

**CHRO Dashboard:**
- [ ] Totale hiring velocity (hires per maand/kwartaal)
- [ ] Cost-per-hire (handmatig invoer budget)
- [ ] DEI-funnel: anonieme demografische rapportage (optioneel)
- [ ] Recruitment ROI
- [ ] Vergelijking vs. vorige periode

**Custom Report Builder:**
- [ ] Drag-and-drop rapportblokken (tabel, grafiek, KPI-kaart)
- [ ] Opslaan als template
- [ ] Automatisch mailen naar stakeholders (wekelijks/maandelijks)

### 2.3 Open API — Standaard op Alle Plannen

**Bestanden:** `apps/api/src/modules/api-keys/`

**Taken:**
- [ ] API key aanmaken/beheren per tenant (granulaire permissions)
- [ ] REST API volledig gedocumenteerd (OpenAPI 3.0 spec + Swagger UI)
- [ ] Rate limiting: 1.000 requests/uur standaard, 10.000 Enterprise
- [ ] Webhooks: events triggeren naar externe URLs (kandidaat aangemeld, status gewijzigd, etc.)
- [ ] API playground in de UI
- [ ] Webhook event log (debuggen)

**Webhook events:**
```
candidate.created / candidate.updated / candidate.stage_changed
job.created / job.filled / job.closed
application.created / application.rejected
interview.scheduled
offer.sent / offer.accepted / offer.rejected
```

### 2.4 Workflow Automation Engine

**Bestanden:** `apps/api/src/modules/workflows/`

**Aanpak:** Trigger → Condition(s) → Action(s) — if/then logica  
**Beschikbaar op alle plannen** (vs. Manatal pas op Enterprise)

**Triggers:**
- Kandidaat verplaatst naar fase X
- Kandidaat aangemeld
- Vacature aangemaakt/gesloten
- Interview gepland
- X dagen geen activiteit
- Scorecard ingevuld

**Conditions:**
- Score > / < drempelwaarde
- Tag aanwezig/afwezig
- Bron = [LinkedIn / Indeed / ...]
- Functietitel bevat [...]

**Actions:**
- E-mail sturen (template kiezen)
- WhatsApp sturen
- Tag toevoegen/verwijderen
- Kandidaat verplaatsen naar fase
- Taak aanmaken voor recruiter
- Webhook triggeren

**Implementatie:** workflows worden opgeslagen als JSON in `workflows` tabel,  
BullMQ-worker evalueert triggers bij elke relevante event.

---

## Fase 3 — CRM, Portalen & Career Pages (3–4 maanden)

### 3.1 Recruitment CRM

**Bestanden:** `apps/api/src/modules/crm/`

**Taken:**
- [ ] Organisatie/klant beheer (naam, sector, contactpersonen, notities)
- [ ] Sales pipeline voor bureaus (prospect → offerte → actief → gesloten)
- [ ] Contact management per organisatie
- [ ] Deals koppelen aan vacatures
- [ ] Omzettracking per klant + per recruiter
- [ ] E-mail communicatie met klanten (zelfde inbox-component als kandidaat)
- [ ] Contact Discovery: geïntegreerd met Hunter.io of Apollo.io API (geverifieerde e-mails)
- [ ] LinkedIn Chrome extensie (bedrijfsprofiel importeren)
- [ ] Activiteitenlog per klant
- [ ] Klant-specifieke rapportage

### 3.2 White-Label Klantportaal

**Bestanden:** `apps/api/src/modules/guest-portal/`  
**Frontend:** Aparte Next.js route `/portal/[token]`

**Taken:**
- [ ] Portaal link genereren per vacature (uniek token, instelbare geldigheid)
- [ ] Klant ziet: kandidaten in pipeline, hun CV, AI-score, notities
- [ ] Klant kan: accept / reject / doorsturen / commentaar toevoegen
- [ ] Granulaire permissies: wat mag de klant zien/doen
- [ ] **Volledig white-label:** eigen logo, kleur, domein — STANDAARD inbegrepen (Manatal rekent dit apart)
- [ ] Custom domein koppelen via CNAME (bijv. `hiring.klant.nl`)
- [ ] Notificaties naar klant bij nieuwe kandidaat in portaal
- [ ] Portaal activiteitenlog (wat heeft klant bekeken/gedaan)
- [ ] Portaal werkt zonder account (alleen via token-link)

### 3.3 Career Page Builder

**Bestanden:** `apps/api/src/modules/career-pages/`  
**Frontend:** SSR via Next.js `/careers/[slug]/` routes

**Taken:**
- [ ] 20+ professionele templates (responsive, modern design)
- [ ] Volledig aanpasbaar: logo, kleuren, fonts, header-afbeelding
- [ ] Custom domein (CNAME → onze infra)
- [ ] Meertalig: NL, EN, DE, FR, ES (i18n per page)
- [ ] Vacaturelijst automatisch gesynchroniseerd met openstaande jobs
- [ ] Per-vacature aanpasbaar sollicitatieformulier
  - Verplichte/optionele velden
  - Dropdowns, open vragen, bestandsupload, video-antwoord
- [ ] **Conversationele chatbot** op career page (eenvoudige FAQ + kwalificatie)
  - OpenAI API: chatbot beantwoordt vragen over het bedrijf/vacature
  - Kwalificeert kandidaten voor ze het formulier invullen
- [ ] Google Analytics 4 + Tag Manager integratie
- [ ] Direct ATS-koppeling: sollicitatie → kandidaatprofiel automatisch aangemaakt
- [ ] SEO-optimalisatie: meta tags, structured data (JobPosting schema.org)
- [ ] Live preview in de builder

### 3.4 Hiring Manager Module & Mobile App

**Frontend:** Progressive Web App (PWA) via Next.js — geen native app nodig voor MVP

**Taken:**
- [ ] Hiring manager rol: beperkte toegang (alleen vacatures waarbij ze betrokken zijn)
- [ ] Swipe-UI voor kandidaatbeoordeling op mobiel (accept/reject/later)
- [ ] Push-notificaties via Web Push API (geen app store vereist)
- [ ] Interview-feedback invullen via mobiel (scorecard)
- [ ] Goedkeur-flows: hiring manager goedkeurt/afwijst kandidaat met één tap
- [ ] Hiring manager ziet: CV samenvatting (AI gegenereerd), score, vorige notities
- [ ] Herinneringen: "Je hebt 3 kandidaten die wachten op jouw feedback"

### 3.5 Job Board Integraties

**Bestanden:** `apps/api/src/modules/jobboards/`  
**Aanpak:** Top-20 directe integraties + Broadbean/Multipost als aggregator voor de rest

**Directe integraties (top-20, >80% van het volume):**
- [ ] LinkedIn Job Posting API
- [ ] Indeed Employer API
- [ ] Glassdoor (via XML feed)
- [ ] Monster
- [ ] Nationale Vacaturebank (NL)
- [ ] Jobbird (NL)
- [ ] Werkzoeken.nl (NL)
- [ ] Jobs.nl (NL)
- [ ] SEEK (Australië/Azië)
- [ ] StepStone (DE/EU)
- [ ] Xing (DACH)
- [ ] Totaljobs (UK)
- [ ] CV-Library (UK)
- [ ] Jobsite (UK)
- [ ] Jobrapido (EU)
- [ ] Adzuna (meerdere landen)

**Via Broadbean/Multipost aggregator:** resterende 2.000+ boards  
**Publicatiestatus:** real-time polling → geen 24-48 uur vertraging (Manatal-bug fix)

---

## Fase 4 — AI Suite & Compliance (2–3 maanden)

### 4.1 AI Matching Engine

**Bestanden:** `apps/api/src/modules/ai/`  
**LLM:** Claude API (Anthropic) als primaire provider, OpenAI als fallback

**Taken:**
- [ ] **Vacature-analyse:** LLM extraheert must-haves, nice-to-haves, skills uit vacaturetekst
- [ ] **CV-analyse:** LLM extraheert skills, ervaring, opleidingen in gestructureerd JSON
- [ ] **Match Score (0–100):** cosine similarity op embedding vectors (OpenAI text-embedding-3-small of Claude embeddings)
  - Opgeslagen in PostgreSQL `pgvector` extensie
  - Voordeel over Manatal: werkt voor ALLE talen (meertalige embeddings)
- [ ] **AI Score toelichting:** per kandidaat uitleg waarom score X (transparantie EU AI Act)
- [ ] **Talent Fit Model:** na 50+ hires per tenant → fine-tuned matching op basis van historische hires
  - Welke kandidaten zijn succesvol aangenomen? → versterk die features in matching
- [ ] **Talent Reactivation:** nachtelijkse job die actieve vacatures matcht aan gearchiveerde kandidaten
  - Alert: "3 kandidaten uit database matchen deze nieuwe vacature"
- [ ] **AI CV Samenvatting:** 3-regel samenvatting van elke kandidaat (i.p.v. CV doorlezen)
- [ ] **AI Vacaturetekst Generator:** prompt → vacaturetekst + bias-checker
  - Bias-checker: markeert gendered language, exclusieve criteria, etc.

**Vectoropslag:**
```sql
CREATE EXTENSION vector;
ALTER TABLE candidates ADD COLUMN embedding vector(1536);
ALTER TABLE jobs ADD COLUMN embedding vector(1536);
-- Similarity search:
SELECT id, 1 - (embedding <=> $1) AS score
FROM candidates
ORDER BY embedding <=> $1
LIMIT 20;
```

### 4.2 Interview Intelligence

**Taken:**
- [ ] **AI Interview Scheduling:** kandidaat kiest zelf tijdslot via link (Calendly-stijl, ingebouwd)
  - Kalender synchroniseren via Google Calendar / Outlook API
  - Beschikbaarheid van meerdere interviewers combineren
- [ ] **Gestructureerde Interview Kits:** per vacature vaste vragenlijsten
  - Scorecards per interviewer op identieke criteria
- [ ] **AI Interview Transcriptie** (via Whisper API):
  - Video/audio upload na interview → automatische transcriptie
  - AI-samenvatting: sterke punten, aandachtspunten, aanbeveling
- [ ] **AI Interview Companion** (optioneel, opt-in):
  - Browser-extensie of overlay die tijdens live interview suggesties geeft

### 4.3 EU Compliance Suite

**Taken:**
- [ ] **GDPR Dashboard:**
  - Per kandidaat: toestemmingsstatus, datumtoestemming gegeven, kanaal
  - Bulk consent request (verzoek om toestemming sturen)
  - Data retention policy: auto-archiveren/anonimiseren na X maanden
  - Kandidaatportaal: kandidaat kan eigen data inzien/corrigeren/verwijderen
- [ ] **EU AI Act Compliance:**
  - Bij elke AI-beslissing: transparantie-label "Deze score is gegenereerd door AI"
  - Human override: elke AI-score is editeerbaar door recruiter
  - Audit log: welke AI-beslissingen zijn genomen, wanneer, op basis van welk model
  - Model documentation: welke AI-modellen worden gebruikt (model card in instellingen)
- [ ] **Pay Transparency Directive 2026:**
  - Salarisbandbreedte verplicht veld bij vacature (configureerbaar als vereist)
  - Rapportage: gemiddeld salaris per geslacht/achtergrond (DEI-optie)
- [ ] **CCPA / PDPA:**
  - Amerikaanse en Aziatische compliance flags op hetzelfde GDPR-dashboard

### 4.4 Skills Graph

**Taken:**
- [ ] Skills taxonomie opbouwen (ESCO European Skills taxonomy API)
- [ ] Elke kandidaat: skills array geëxtraheerd uit CV (via AI)
- [ ] Elke vacature: required skills + nice-to-have skills
- [ ] Skills-gap analyse per kandidaat vs. vacature
- [ ] Skills trending: welke skills komen steeds meer voor in de markt (eigen data)
- [ ] Search op skills: "zoek alle kandidaten die Python EN machine learning hebben"

---

## Fase 5 — Back-Office & Agentic AI (4–6 maanden)

### 5.1 Temp/Contract Back-Office

**Doelgroep:** Bureaus met temp/uitzend activiteiten (Vincere-markt)

**Taken:**
- [ ] Tijdschriften (timesheets): kandidaat vult uren in, klant keurt goed
- [ ] Facturering: automatisch factuur genereren op basis van goedgekeurde uren
- [ ] Facturatie-export naar boekhoudpakket (Exact, Twinfield, SnelStart)
- [ ] Commissieberekening per recruiter per plaatsing
- [ ] Revenue forecasting: verwachte omzet op basis van lopende contracten
- [ ] Contractbeheer: start/einddatum, verlengingsnotificaties
- [ ] Wet Toelating Terbeschikkingstelling Arbeidskrachten (WTZA) compliance NL

### 5.2 Agentic AI Sourcing

**Aanpak:** AI-agent die zelfstandig kandidaten zoekt en eerste contact legt

**Taken:**
- [ ] **Autonome Boolean Search Agent:**
  - Recruiter geeft opdracht: "Zoek senior React developers Amsterdam, 5+ jaar, beschikbaar in 3 maanden"
  - Agent zoekt in eigen database + vraagt recruiter toestemming voor externe outreach
- [ ] **LinkedIn Outreach Automation** (via LinkedIn API of browser-extensie):
  - AI schrijft gepersonaliseerde InMail per kandidaat
  - Recruiter keurt goed → agent verstuurt
- [ ] **Multi-channel nurture sequences:**
  - Dag 1: LinkedIn InMail
  - Dag 4: e-mail follow-up (als geen respons)
  - Dag 10: tweede follow-up
  - Volledig gepersonaliseerd per kandidaat
- [ ] **Passieve kandidaat monitoring:**
  - Stel alert in: "Informeer me als [naam kandidaat] van baan wisselt of LinkedIn-profiel bijwerkt"
  - Dagelijkse scan → notificatie bij trigger

### 5.3 Enterprise Features

**Taken:**
- [ ] **SSO/SAML:** integratie met Okta, Azure AD, Google Workspace
- [ ] **Geavanceerde permissie-structuur:** custom rollen aanmaken, per module permissies instellen
- [ ] **Audit trail:** onveranderlijk logboek van alle acties (WORM-principe)
- [ ] **Dedicated tenant database** optie (schema-isolatie voor grootste klanten)
- [ ] **SLA dashboard:** uptime monitoring zichtbaar voor Enterprise klanten
- [ ] **Prioritaire support:** dedicated Slack channel per Enterprise klant

---

## API Design Principes

```
Base URL: https://api.{platform}.nl/v1/

Authenticatie:    Authorization: Bearer {jwt}
Tenant ID:        Automatisch uit JWT — nooit in URL
Pagination:       ?page=1&per_page=50 (default 50, max 200)
Filtering:        ?status=open&recruiter_id=uuid
Sorting:          ?sort=created_at&order=desc
Errors:           { error: { code: "CANDIDATE_NOT_FOUND", message: "...", details: {} } }
Rate limiting:    X-RateLimit-Limit, X-RateLimit-Remaining headers

Versioning:       /v1/ — breaking changes krijgen nieuwe versie
```

---

## Billing & Plannen

**Implementatie:** Stripe Subscriptions + Stripe Webhooks

**Plannen:**
| Plan     | Prijs     | Gebruikers | Kandidaten | AI Credits/m |
|----------|-----------|------------|------------|--------------|
| Starter  | €15/u/m   | Onbeperkt  | 25.000     | 500          |
| Growth   | €29/u/m   | Onbeperkt  | Onbeperkt  | 2.000        |
| Agency   | €45/u/m   | Onbeperkt  | Onbeperkt  | 5.000        |
| Enterprise | Op aanvraag | Onbeperkt | Onbeperkt | Onbeperkt  |

**API op alle plannen** — geen feature-gating (directe differentiatie vs. Manatal)

**Stripe taken:**
- [ ] Stripe Customer aanmaken bij tenant registratie
- [ ] Subscription aanmaken + webhook verwerken (payment_failed, subscription_canceled)
- [ ] Plan downgrade/upgrade flow
- [ ] AI credits bijhouden en afboeken (Redis counter)
- [ ] Facturen beschikbaar in de UI (via Stripe Billing Portal)

---

## Deployment & DevOps

### Gratis Cloud Stack (geen Hetzner VPS, los van KDMN)

```
┌─────────────────────────────────────────────────────────────┐
│  SERVICE          PLATFORM        GRATIS TIER               │
├─────────────────────────────────────────────────────────────┤
│  Frontend         Vercel          Onbeperkt (Next.js native)│
│  API (Node.js)    Railway         $5 credit/maand           │
│  Worker (BullMQ)  Railway         Zelfde project            │
│  PostgreSQL       Neon            0.5GB, pgvector inbegrepen│
│  Redis            Upstash         10k commands/dag, 256MB   │
│  File storage     Cloudflare R2   10GB, 10M reads/maand     │
│  E-mail verzenden Resend          3.000 emails/maand        │
│  Error tracking   Sentry          5k errors/maand           │
│  Uptime monitor   Better Uptime   10 monitors gratis        │
└─────────────────────────────────────────────────────────────┘
```

**Voordelen van deze stack:**
- Volledig gratis voor development + vroege productie
- Geen creditcard vereist bij aanmelden (Railway, Neon, Upstash)
- Los van KDMN infrastructuur — eigen accounts
- Neon ondersteunt `pgvector` out-of-the-box (nodig voor AI-matching fase 4)
- Vercel + Next.js = zero-config deploy (elke git push = live)
- Alle services schalen automatisch mee als het product groeit

### Accounts aanmaken (volgorde)

```
1. GitHub          → git repository aanmaken (talentflow)
2. Vercel          → koppelen aan GitHub repo (frontend auto-deploy)
3. Neon            → PostgreSQL database aanmaken
4. Upstash         → Redis instantie aanmaken
5. Railway         → Node.js API + worker deployen
6. Cloudflare      → R2 bucket aanmaken (file storage)
7. Resend          → account aanmaken, domein verifiëren
8. Sentry          → project aanmaken voor error tracking
```

### Environment variabelen (Railway + Vercel)

```env
# Database
DATABASE_URL=postgresql://...neon.tech/talentflow

# Redis
REDIS_URL=rediss://...upstash.io:6380

# Auth
JWT_SECRET=<random 64 chars>
JWT_REFRESH_SECRET=<random 64 chars>

# File storage (Cloudflare R2)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=talentflow-files

# E-mail
RESEND_API_KEY=re_...

# AI
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...  (fallback)

# App
NEXT_PUBLIC_API_URL=https://api.talentflow.app
NODE_ENV=production
```

### CI/CD via GitHub Actions

```yaml
# Vercel: automatisch bij push naar main (zero config)
# Railway: automatisch bij push naar main (Dockerfile of nixpacks)
# Neon: migraties draaien als Railway deploy-hook
```

**Workflow:**
```
git push → GitHub Actions → tests → Railway deployt API → Vercel deployt web
                                  → Neon migraties draaien automatisch
```

### Wanneer upgraden van gratis tier?

| Trigger                        | Upgrade naar                          | Kosten       |
|-------------------------------|---------------------------------------|--------------|
| >0.5GB database                | Neon Launch ($19/maand)               | €18/maand    |
| API >$5 Railway credit         | Railway Starter ($5/maand + gebruik)  | ~€10-20/mnd  |
| >3k emails/maand               | Resend Pro ($20/maand)                | €18/maand    |
| Eigen domein career pages      | Vercel Pro ($20/maand) of eigen nginx | €18/maand    |

**Totale kosten bij eerste betalende klant: ~€50-70/maand**
(vs. Manatal ≈€620/maand — break-even al bij 1 klant)

### Monitoring
- Sentry voor error tracking (gratis tier, 5k errors/maand)
- Better Uptime voor externe ping-monitoring
- Neon dashboard voor database metrics
- Railway built-in logs voor API/worker

---

## Technische Keuzes & Packages

### API (Node.js)
```json
{
  "express": "^4",
  "pg": "^8",
  "redis": "^4",
  "bullmq": "^5",
  "jsonwebtoken": "^9",
  "bcrypt": "^5",
  "multer": "^1",
  "pdf-parse": "^1",
  "mammoth": "^1",
  "openai": "^4",
  "@anthropic-ai/sdk": "^0.24",
  "stripe": "^14",
  "twilio": "^5",
  "googleapis": "^140",
  "@microsoft/microsoft-graph-client": "^3",
  "zod": "^3",
  "winston": "^3"
}
```

### Web (Next.js)
```json
{
  "next": "^14",
  "react": "^18",
  "@tanstack/react-query": "^5",
  "@dnd-kit/core": "^6",
  "recharts": "^2",
  "react-hook-form": "^7",
  "zod": "^3",
  "@radix-ui/react-*": "latest",
  "tailwindcss": "^3",
  "next-intl": "^3",
  "next-pwa": "^5"
}
```

---

## Verificatie per Fase

### Fase 1 klaar als:
- [ ] Recruiter kan inloggen, kandidaten aanmaken, CV uploaden
- [ ] Kandidaat wordt geparsed en skills geëxtraheerd
- [ ] Vacature aanmaken en kandidaten door pipeline slepen
- [ ] Boolean search geeft relevante resultaten
- [ ] Basisrapportage toont time-to-hire en funneldata
- [ ] Tweede user (hiring manager) kan inloggen met beperkte rechten
- [ ] Alles draait op Hetzner VPS via Docker

### Fase 2 klaar als:
- [ ] E-mail versturen en ontvangen vanuit kandidaatprofiel (Gmail OAuth)
- [ ] WhatsApp bericht versturen en ontvangen
- [ ] Analytics dashboard toont recruiter KPIs en CHRO-metrics
- [ ] API key aanmaken en REST API gebruiken via Swagger UI
- [ ] Workflow automation: automatisch e-mail bij fase-overgang

### Fase 3 klaar als:
- [ ] Career page live op eigen subdomein met werkend sollicitatieformulier
- [ ] Sollicitatie van career page → kandidaat in ATS (automatisch)
- [ ] Klantportaal deelbaar via link, klant kan kandidaten beoordelen
- [ ] Portaal volledig white-label (eigen logo + kleur)
- [ ] Hiring manager kan op mobiel kandidaten beoordelen (swipe-UI)

### Fase 4 klaar als:
- [ ] AI match score berekend voor elke kandidaat per vacature
- [ ] Score werkt voor NL, EN, DE CV's (meertalig)
- [ ] Talent Reactivation alerts worden verstuurd
- [ ] GDPR dashboard toont consent-status per kandidaat
- [ ] EU AI Act: elke AI-score heeft transparantielabel + override-knop

### Fase 5 klaar als:
- [ ] Timesheets invullen, goedkeuren en factuur genereren
- [ ] Agentic sourcing: agent voert zelfstandig LinkedIn-zoekopdracht uit
- [ ] SSO/SAML werkt met Azure AD
