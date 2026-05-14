# TalentFlow — Masterplan voor BIM-Stage

**Stagiair:** Kaan
**Stagebedrijf:** IT Proposal (recruitmentbureau, ~5.540 kandidaten in Manatal)
**Datum:** 5 mei 2026
**Stack:** Next.js 14 (web) + Express (api) + PostgreSQL met RLS + Redis + BullMQ

---

## 1. Strategische uitgangspunten

### Why this project (zakelijk)
IT Proposal betaalt **€1.000/maand** voor Manatal en is **tevreden** over het product. De aanleiding is dus geen ontevredenheid — het is **kostenbesparing**. Het bedrijf wil hetzelfde werkresultaat tegen lagere TCO.

### Stage-deliverables (BIM)
1. **Werkend product** end-to-end (geen mock-shell)
2. **Feature-pariteit-bewijs** vs. Manatal — voor stagebegeleider
3. **As-is / to-be** procesvergelijking
4. **SWOT-analyse**
5. **TCO/ROI-onderbouwing** met break-even
6. **Documentatie/scriptie**

### Scope-besluiten (vastgelegd)
| Onderwerp | Besluit |
|---|---|
| 📧 E-mail | ✅ Hoogste prioriteit (Gmail/Outlook OAuth + Resend) |
| 📱 SMS via Twilio | ❌ Niet bouwen — kost geld per bericht |
| 💬 WhatsApp Business | 🟡 Geparkeerd |
| 🤖 AI provider | Claude API (Anthropic) als primair, OpenAI als fallback |
| 🌐 Hosting | Hetzner VPS bestaande infra (zelfde als KDMN) |
| 💳 Stripe billing | Niet voor stage — pas bij commerciële uitrol |

---

## 2. Huidige state (audit van 2026-05-05)

### ✅ Werkend
- 12 backend module-routers met Zod-validatie + service layer
- PostgreSQL pool + migration `001_init.sql` met RLS-policies (klaar, nog niet gedraaid op productie-DB)
- JWT-auth met bcrypt + refresh tokens
- `requireAuth` + `tenantMiddleware`
- BullMQ workers: resumeParser (PDF/DOCX → keyword skills), workflow
- Docker compose (postgres 16 + redis 7)
- 16 frontend modules met UI (kandidaten, jobs, pipeline, CRM, communications, career pages, job boards, hiring manager, analytics, workflows, instellingen, klantportalen, publiek portal)

### ❌ Mock/stub
- `emailSender` worker → logs only (geen Resend/Gmail)
- `communications` worker → SMS/WhatsApp/email stubs
- Geen OpenAI/Claude integratie (parser doet alleen keyword match)
- Frontend valt terug op mock-token bij API-fail (security risk)
- 0 tests, geen CI/CD

### 🐛 11 bekende bugs uit smoke-test (zie smoke-test rapport)

---

## 3. Manatal-pariteit: gap-tabel (P0 = verplicht)

### Datamodel-uitbreidingen (P0)
| Field | Status | Reden |
|---|---|---|
| `candidate_reference` (alfanum. ID) | ❌ | Manatal-stijl ID voor herkenbaarheid |
| `first_name` / `last_name` apart | ❌ | Manatal heeft het, fixt UU-avatar bug |
| `gdpr_consent` + `gdpr_consent_date` | ❌ | Wettelijk NL |
| `email_consent` (apart) | ❌ | Manatal heeft beide |
| `skills` met `score 1-10` | 🟡 | Parser haalt naam, geen score |
| `notice_period`, `current_salary`, `expected_salary` | ❌ | Standaard recruiter-velden |
| `nationalities[]`, `languages[]` | ❌ | Multi-arrays |
| `source` (Applied via Career Page, LinkedIn, etc.) | ❌ | Verplicht voor Source-of-Hire KPI |

### Pipeline-stages (P0 — bureau-pipeline)
Default vervangen door:
```
New Candidates → Interested → Shortlisted → Client Submission
→ Client Interview → Offered → Hired → Started → Probation passed
```

### AI features (P1)
- AI match score % per kandidaat per job (zichtbaar op pipeline-card)
- AI Recommendations tab
- AI Job Description generator
- Semantische search via pgvector embeddings

### Modules toe te voegen (P2)
- Matches (AI matching dashboard)
- Activities (agenda + taken)
- Sourcing Hub (job board workflow)
- Placements (post-hire — Manatal heeft Started + Probation als aparte stage in pipeline)

---

## 4. Roadmap — verticale slices

**Filosofie:** elke slice levert end-to-end werkende functionaliteit op (geen lagen). Pas wanneer Slice N volledig draait beginnen we Slice N+1.

### Slice 1 — Productie-fundament (1–2 weken)
**Doel:** Backend echt live + frontend gekoppeld + 1 module compleet werkend.

| Sub-taak | Bestanden |
|---|---|
| docker-compose up + DB migrate | `docker-compose.yml`, `apps/api/migrations/001_init.sql` |
| Datamodel-update: candidate_reference, first/last name, gdpr, email_consent, salary fields, languages, nationalities, source | nieuwe migration `002_manatal_parity.sql` |
| Frontend mock-fallback verwijderen uit auth | `apps/web/lib/auth.ts` |
| Echte login flow tegen API | `apps/web/app/(auth)/login/page.tsx` |
| Echte kandidaten-CRUD via API (geen mock) | `apps/web/hooks/useCandidates.ts` |
| Bureau-pipeline als default | `apps/api/src/modules/pipeline/` |
| Bug-fixes #1, #2, #3 (UU-avatar, sidebar portal-links, workflow modal) | diverse |

**Acceptatiecriterium:** Login → kandidaat aanmaken → kandidaat verschijnt in lijst, alles tegen echte DB. Sluit browser, open opnieuw, kandidaat is er nog.

### Slice 2 — CV upload + AI parsing (1–2 weken)
**Doel:** Kandidaat upload CV → backend parsert → AI extracteert skills met score 1-10 → samenvatting.

| Sub-taak | Bestanden |
|---|---|
| Cloudflare R2 (of MinIO lokaal) S3-compatible upload | nieuwe service `apps/api/src/services/storage.ts` |
| File upload endpoint | `apps/api/src/modules/candidates/candidates.router.ts` |
| Resume parser worker uitbreiden met Claude API | `apps/api/src/queue/workers/resumeParser.worker.ts` |
| AI skills extractie met score 1-10 | nieuwe service `apps/api/src/services/ai.ts` |
| AI 3-regel samenvatting per kandidaat | idem |
| Multi-CV support per kandidaat | datamodel + frontend |
| Frontend: upload UI + skill-balkjes met score | `apps/web/app/(dashboard)/candidates/[id]/` |

**Acceptatiecriterium:** Upload PDF → binnen 30 sec verschijnen skills met scores + AI-summary in profiel.

### Slice 3 — Email + Workflow (2–3 weken)
**Doel:** E-mail werkt 2-way + workflows triggeren e-mails.

| Sub-taak | Bestanden |
|---|---|
| Resend integratie (transactional) | `apps/api/src/services/email.ts` |
| Gmail OAuth (2-way sync) | `apps/api/src/modules/integrations/gmail.ts` |
| Outlook OAuth (2-way sync) | idem |
| Email templates met merge-fields | nieuwe module |
| Inbox UI: kandidaat-thread tonen | `apps/web/app/(dashboard)/communications/` |
| Workflow engine: triggers + conditions + actions | `apps/api/src/queue/workers/workflow.worker.ts` |
| Workflow-driven email bij stage-change | engine + email service |
| Bulk e-mail met GDPR consent check | nieuwe endpoint |

**Acceptatiecriterium:** Stuur testmail vanuit kandidaat-profiel; reactie verschijnt in dezelfde thread. Workflow "When moved to Interested → send template X" werkt.

### Slice 4 — AI Matching + Recommendations (1–2 weken)
**Doel:** Per kandidaat een match% per openstaande vacature (zoals Manatal in de pipeline-card toont).

| Sub-taak | Bestanden |
|---|---|
| `pgvector` extensie aanzetten + migration | `apps/api/migrations/003_pgvector.sql` |
| Embeddings genereren bij job-create + candidate-create | nieuwe worker |
| Match score berekening (cosine similarity) | service |
| AI Recommendations endpoint per job | `apps/api/src/modules/matches/` |
| Match% tonen op pipeline-card | `apps/web/components/pipeline/KanbanCard.tsx` |
| AI Recommendations tab op job + kandidaat | nieuwe routes |
| Talent Reactivation: nightly cron (matcht actieve jobs aan archief) | nieuwe worker |

**Acceptatiecriterium:** Open een job → zie automatisch ranked kandidaten met match% + uitleg.

### Slice 5 — Career Page + Sourcing (2 weken)
**Doel:** Sollicitanten kunnen direct via career page binnenkomen + integratie met top NL job boards.

| Sub-taak | Bestanden |
|---|---|
| Career page templating (3 templates voor MVP) | `apps/web/app/careers/[slug]/` |
| Custom domain via Nginx | infra |
| Multi-language (NL/EN als minimum) | `next-intl` |
| Sollicitatie → kandidaat-creatie + Source="Career Page" | bestaand maar moet echt werken |
| LinkedIn job posting (XML feed) | nieuwe service |
| Indeed job posting (XML feed) | nieuwe service |
| Nationale Vacaturebank (NL) integratie | nieuwe service |
| Source-tracking automatisch | datamodel + workflow |

**Acceptatiecriterium:** Plaats een vacature → publiceer naar 3 job boards → solliciteer via career page → kandidaat verschijnt met juiste source.

### Slice 6 — BIM-deliverables (parallel uitvoerbaar)
**Doel:** Documentatie voor stagebegeleider.

| Document | Vorm |
|---|---|
| As-is procesbeschrijving | Markdown + flowchart |
| To-be procesbeschrijving | Markdown + flowchart |
| SWOT-analyse | Markdown tabel + visualisatie |
| TCO/ROI-berekening | Excel + Markdown |
| Feature-pariteit matrix Manatal vs. TalentFlow | Markdown tabel (al in `docs/Manatal_Feature_Pariteit.md`) |
| Architectuur-document | Markdown + diagram |
| Risk-register | Markdown |
| Eindscriptie outline | Markdown |

---

## 5. Succescriteria voor de stage

### Voor stagebegeleider (BIM)
- [ ] Werkend systeem demonstreerbaar end-to-end
- [ ] As-is/to-be procesvergelijking
- [ ] SWOT volledig
- [ ] TCO-berekening met break-even
- [ ] Architectuur-document
- [ ] Risk-register
- [ ] Reflectie op het bouwproces

### Voor stagebedrijf (operationeel)
- [ ] Pariteit op P0-features (kandidaten, jobs, pipeline, career page, e-mail, GDPR)
- [ ] Migratiepad: kandidaten/jobs uit Manatal importeren via CSV-export
- [ ] Geen functionele regressie t.o.v. huidige Manatal-werkstroom
- [ ] Documentatie voor recruiters

---

## 6. TCO / ROI (eerste schatting)

### Manatal kosten (huidig)
- €1.000 / maand × 12 = **€12.000 / jaar**

### TalentFlow kosten (eigen hosting Hetzner)
- VPS (gedeeld met KDMN, geen extra kosten) ≈ €0
- Anthropic API (geschat 10k kandidaten × 0,01€) = **€100/maand** = €1.200/jaar
- Resend (transactional) gratis tot 3.000 mails, daarna €18/maand = €216/jaar
- Domein + SSL = €25/jaar
- **Totaal: ~€1.450 / jaar**

### Besparing
- **€10.550 / jaar** = ~€880/maand besparing
- Break-even ontwikkeluren: bij €60/uur intern × 175 uur = nominal break-even na ~1 jaar

### Eenmalige kosten
- Ontwikkeluren stage (Kaan): ~6 maanden × niet meegerekend (stage-context)

---

## 7. Risico's & mitigatie

| Risico | Kans | Impact | Mitigatie |
|---|---|---|---|
| AI-API kosten escaleren | Middel | Hoog | Caching + per-tenant limieten, fallback naar OpenAI |
| Datamigratie van Manatal blokkeert | Middel | Hoog | CSV-export-script bouwen + dry-run op subset |
| Bus-factor 1 (alleen Kaan) | Hoog | Hoog | Documentatie als first-class deliverable, geen tribal knowledge |
| GDPR fout bij data-export | Laag | Hoog | Compliance-by-design, audit log standaard aan |
| Eigen hosting onbetrouwbaar | Laag | Middel | Daily backups + uptime monitoring (Better Uptime gratis tier) |

---

## 8. Volgende stappen (deze week)

1. **Slice 1 starten** — multi-agent dispatch (zie volgende sectie)
2. Begin tegelijk met **as-is procesbeschrijving** (BIM-deliverable, kost weinig tijd)
3. **CSV-export uit Manatal** vragen aan IT Proposal voor migration-test in Slice 1.5

---

**Bijbehorende documenten:**
- [`Manatal_Feature_Pariteit.md`](Manatal_Feature_Pariteit.md) — feature-by-feature analyse
- [`Manatal_Live_Tour.md`](Manatal_Live_Tour.md) — field-mapping uit live tour
- [`implementatieplan.md`](implementatieplan.md) — origineel technisch plan
- [`Manatal_Strategische_Analyse.docx`](Manatal_Strategische_Analyse.docx) — eerdere SWOT-analyse
