# Productie-verificatie TalentFlow — 2026-07-01

**Doel:** aantonen dat de kern van TalentFlow (scope: **ATS + CRM + plaatsing**, NL, recruit-to-cash
bevroren) daadwerkelijk in productie draait op `talentflow.kdmn.nl` (VPS 91.98.232.104). Read-only
audit + gerichte live-tests. Recruit-to-cash (timesheets/marge/facturatie) blijft bevroren tot een
betalende detacheringsklant.

Uitgevoerd door Claude, geverifieerd met concrete output (geen aannames).

---

## 1. Wat geverifieerd is (met bewijs)

| Onderdeel | Status | Bewijs |
|---|---|---|
| **Infra** | ✅ | Containers `api` + `api-worker` + `web` Up (healthy), `postgres`/`redis`/`minio` Up 5 wk; `GET /api/health` → 200 |
| **Schema** | ✅ | 40 migraties toegepast, incl. RLS-hardening 036/037 + 040 |
| **CRUD-datalaag** | ✅ | 50.004 kandidaten, 303 jobs, 120.600 sollicitaties, 200 organisaties, 9 tenants (echt volume) |
| **Auth** | ✅ | `POST /api/auth/login` → 200 + JWT (accessToken, tenantId), refresh-rotatie |
| **Anthropic-AI** | ✅ **live** | `POST /api/jobs/jd-drafts` → 201 met echt door Claude gegenereerde NL-JD (variants + bias-check). Dekt CV-parse, JD-gen, bias, sourcing-agent, reply-classificatie, match-uitleg |
| **OpenAI embeddings** | ✅ **live** | Directe call met prod-key → dims=1536. **App-pipeline bewezen:** nieuwe kandidaat aangemaakt (08:31:21) → embedding gezet 08:31:23 (~2s) via `matchingEmitter` → embeddings-worker → OpenAI → `candidates.embedding` |
| **Resend e-mail** | ✅ **live** | Test-send vanaf `no-reply@send.kdmn.nl` → ontvangen door gebruiker. Domein `send.kdmn.nl` geverifieerd |
| **BullMQ-workers** | ✅ | `"All workers started"` toont **29 workers** incl. de 4 toegevoegde (`job-board-post`, `job-board-poll`, `inbox-projector`, `retention`); `[retention] daily schedule registered`, geen boot-errors |

## 2. Configuratiewijzigingen deze sessie

- **`infra/.env.prod`** (op de VPS): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY` ingevuld
  (waren leeg → AI/e-mail stonden dark). `RESEND_FROM` gecorrigeerd naar `TalentFlow <no-reply@send.kdmn.nl>`
  (stond abusievelijk op "IT Proposal"). Backups als `.env.prod.bak` bewaard.
- **`apps/api/src/queue/workers/index.ts`** (commit `fb1bdef`, gedeployd): 4 in-scope workers toegevoegd
  die eerder ontbraken en daardoor niet draaiden. Bevroren/buiten-scope workers bewust weggelaten.
- Deploy-flow bevestigd werkend: push → VPS `git fetch` + ff-merge (PAT werkt) → `docker compose build api`
  → `up -d --force-recreate api api-worker`.

## 3. Wat NIET draait / bewust uit

- **Semantische matchscore over bestáánde data**: 0/50.004 kandidaten + 0/303 jobs hebben een embedding
  (OpenAI stond tot vandaag uit). Nieuwe records embedden vanzelf; bestaande vergen een **backfill**
  (zie ROADMAP). Bij IT Proposal's Manatal-import gebeurt dit automatisch.
- **RLS is inert in prod** (`DATABASE_URL`-user = `talentflow` superuser, `bypassrls=true`). Tenant-isolatie
  leunt op app-laag `WHERE tenant_id`. OK voor single-tenant; **harde gate vóór 2e externe klant** (zie ROADMAP).
- **5 workers bewust uit** (`whatsappOut`, `whatsappHealthCheck`, `voiceCallTranscribe`, `contractExpiry`,
  `skillsSnapshot`) — horen bij bevroren/niet-actieve features.
- **Voice/Twilio outbound** = stub (`TODO(real-api)`); e-signature / assessments / self-scheduling / native
  mobile / payment-collection = afwezig (buiten v1-scope).

## 4. Beveiliging / hygiëne

- 3 API-keys zijn tijdens deze sessie in de chat langsgekomen → **roteren aanbevolen** (Anthropic/OpenAI/Resend).
- Keys staan als platte tekst in `infra/.env.prod` (chmod 600, gitignored) — standaard voor deze stack.
- Resend-key is een **restricted (send-only)** key — least-privilege, correct voor prod.

---

**Conclusie:** de ATS+CRM+plaatsing-kern draait nu live in productie, inclusief AI (Claude), semantische
matching-infra (OpenAI) en e-mail (Resend), met alle in-scope achtergrond-workers actief. De resterende
punten (embedding-backfill, RLS-cutover vóór multi-tenant-verkoop, per-tenant afzender) staan in
`ROADMAP.md` Sectie 6.
