# TalentFlow

TalentFlow is een recruitment SaaS-platform gebouwd als directe vervanging voor Manatal (werkelijke factuur ≈€620/maand, zie docs/TCO_ROI.md). Het biedt een volledig ATS (Applicant Tracking System) met Kanban-pipeline, kandidaatbeheer, vacaturebeheer en dashboardanalytics — klaar voor uitbreiding naar omni-channel communicatie, AI-matching en white-label klantportalen. Multi-tenant vanaf dag één via PostgreSQL Row-Level Security.

## Tech stack

| Laag          | Technologie                                             |
|---------------|---------------------------------------------------------|
| Backend API   | Node.js 20 + Express, TypeScript strict                 |
| Frontend      | Next.js 14 App Router, Tailwind CSS, shadcn/ui          |
| Database      | PostgreSQL 16 met Row-Level Security (multi-tenant)     |
| Cache / Queue | Redis 7 + BullMQ (async jobs: resume parser, e-mail)    |
| Auth          | JWT (access 15m) + httpOnly refresh token cookie (7d)   |
| File upload   | multer → lokale disk (Phase 2: MinIO / S3)              |
| Deploy        | Docker + docker-compose / Hetzner VPS + Nginx + PM2     |

## Lokaal starten

### Optie 1 — Docker Compose (aanbevolen)

```bash
# Start PostgreSQL, Redis, API en frontend in één keer
docker-compose up -d

# API:      http://localhost:4000
# Frontend: http://localhost:3000
# Health:   http://localhost:4000/health
```

Database-migraties draaien automatisch bij de eerste start van de API.

### Optie 2 — Handmatig (twee terminals)

**Vereisten:** Node.js 20+, PostgreSQL 16, Redis 7

```bash
# Terminal 1 — API
cd apps/api
cp .env.example .env
# Bewerk .env: vul DATABASE_URL en REDIS_URL in
npm install
npm run migrate   # eenmalig: schema aanmaken
npm run dev       # start op http://localhost:4000

# Terminal 2 — Frontend
cd apps/web
cp .env.local.example .env.local
# Bewerk .env.local indien nodig
npm install
npm run dev       # start op http://localhost:3000
```

## Environment variabelen

### Welk bestand hoort bij welke setup

| Bestand | Setup | In git? | Doel |
|---|---|---|---|
| `apps/api/.env.example` | — | ✅ committed | Template voor de API-config (kopieer naar `.env`). |
| `apps/api/.env` | lokale dev | ❌ gitignored | Echte API-secrets lokaal. |
| `apps/web/.env.local.example` | — | ✅ committed | Template voor de web-config. |
| `apps/web/.env.local` | lokale dev | ❌ gitignored | Lokale web-config. **Let op:** zet hier géén `NEXT_PUBLIC_USE_MOCK_DATA=true` — dat blokkeert de echte API-flow tijdens een smoke-test (een eerdere stale regel hier kostte een halve debug-sessie). Default = mock uit. |
| `.env.dev` (root) | lokale dev (docker) | ❌ gitignored | Compose-vars voor de dev-stack (`docker-compose.yml`). |
| `infra/.env.prod.example` | — | ✅ committed | Template voor productie (alle 20+ secrets). |
| `infra/.env.prod` | productie (VPS) | ❌ gitignored, `chmod 600` | Echte productie-secrets. Geladen via `./infra/deploy.sh` (zie [docs/docker.md](docs/docker.md)). |

> Productie deploy je **uitsluitend** via `./infra/deploy.sh` — die injecteert altijd `--env-file infra/.env.prod`. Rechtstreeks `docker compose` draaien zonder die flag bakt lege env-vars in en haalt productie onderuit. Zie [docs/docker.md](docs/docker.md).

### `apps/api/.env`

| Variabele            | Beschrijving                              | Voorbeeld                          |
|----------------------|-------------------------------------------|------------------------------------|
| `DATABASE_URL`       | PostgreSQL connection string              | `postgresql://user:pw@host/db`     |
| `REDIS_URL`          | Redis connection string                   | `redis://localhost:6379`           |
| `JWT_SECRET`         | Geheim voor access tokens (min. 64 chars) | `...willekeurige lange string...`  |
| `JWT_REFRESH_SECRET` | Geheim voor refresh tokens (min. 64 chars)| `...willekeurige lange string...`  |
| `PORT`               | Poort van de API (standaard: 4000)        | `4000`                             |
| `NODE_ENV`           | Omgeving                                  | `development` / `production`       |
| `CORS_ORIGIN`        | Toegestane frontend origin                | `http://localhost:3000`            |

### `apps/web/.env.local`

| Variabele                   | Beschrijving                                       | Voorbeeld                      |
|-----------------------------|----------------------------------------------------|-------------------------------|
| `NEXT_PUBLIC_API_URL`       | Backend API basis-URL                              | `http://localhost:4000/api`   |
| `NEXT_PUBLIC_USE_MOCK_DATA` | Gebruik mock data i.p.v. echte API (`true`/`false`)| `false`                       |

### Laadvolgorde (Next.js)

Next.js laadt env-bestanden in `apps/web/` in deze volgorde (hoogste prioriteit eerst):

1. `process.env` (shell/Docker-omgeving)
2. `.env.$(NODE_ENV).local` (bijv. `.env.development.local` — niet in gebruik in dit project)
3. `.env.local` (niet geladen bij `NODE_ENV=test`)
4. `.env.$(NODE_ENV)` (bijv. `.env.development` — niet in gebruik in dit project)
5. `.env`

Lokaal bestaat alleen `apps/web/.env.local`; in productie komen de waarden uit `infra/.env.prod`, geïnjecteerd door `./infra/deploy.sh` (docker compose `--env-file`).

> **`NEXT_PUBLIC_*` is build-time, niet runtime.** Deze variabelen worden bij `next build` in de client-bundle gebakken. Een wijziging in `.env.local` of `infra/.env.prod` heeft dus pas effect na een **rebuild** (lokaal: dev-server herstarten; productie: web-image opnieuw bouwen) — alleen een container-restart is niet genoeg.

## Faseringsplan

| Fase | Inhoud                                                        | Status        |
|------|---------------------------------------------------------------|---------------|
| 1    | MVP: kandidaten, vacatures, Kanban-pipeline, resume parser    | Gebouwd       |
| 2    | Communicatie (e-mail/WhatsApp/SMS), analytics, publieke API   | Gepland       |
| 3    | CRM, white-label klantportaal, career pages, HM-app           | Gepland       |
| 4    | AI matching, interview intelligence, GDPR dashboard           | Gepland       |
| 5    | Temp/contract back-office, agentic AI                         | Gepland       |

Zie [docs/implementatieplan.md](docs/implementatieplan.md) voor het volledige technische plan.

## API-overzicht (Phase 1)

```
POST   /api/auth/register          Registreer tenant + admin
POST   /api/auth/login             Inloggen (vereist tenantSlug)
POST   /api/auth/refresh           Vernieuw access token via cookie
POST   /api/auth/logout            Uitloggen

GET    /api/candidates             Lijst (zoek, filter skills/tags/source)
POST   /api/candidates             Nieuwe kandidaat
GET    /api/candidates/:id         Detail + sollicitaties
PATCH  /api/candidates/:id         Bijwerken
DELETE /api/candidates/:id         Soft delete
POST   /api/candidates/:id/resume  CV uploaden (PDF/DOCX, max 10MB)

GET    /api/jobs                   Lijst (filter status/recruiter)
POST   /api/jobs                   Nieuwe vacature (+ 5 standaard fasen)
GET    /api/jobs/:id               Detail + fasen
PATCH  /api/jobs/:id               Bijwerken
DELETE /api/jobs/:id               Soft delete
POST   /api/jobs/:id/duplicate     Klonen

GET    /api/pipeline/jobs/:id/stages         Fasen met aantallen
POST   /api/pipeline/applications            Kandidaat toevoegen aan pipeline
PATCH  /api/pipeline/applications/:id        Stage/status wijzigen
DELETE /api/pipeline/applications/:id        Verwijderen uit pipeline

GET    /api/dashboard/stats        Dashboard statistieken
GET    /health                     Health check
```
