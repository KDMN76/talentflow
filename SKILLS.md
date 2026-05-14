# TalentFlow — Skills & Werkwijze

Dit bestand beschrijft welke superpowers skills gebruikt worden bij dit project
en hoe we te werk gaan bij elke type taak.

## Verplichte Skills per Taaktype

### Nieuwe feature bouwen
1. `superpowers:brainstorming` — altijd eerst: design bespreken en goedkeuren
2. `superpowers:writing-plans` — implementatieplan schrijven
3. `superpowers:test-driven-development` — tests schrijven vóór implementatie
4. `superpowers:executing-plans` — plan uitvoeren met review checkpoints

### Bug fixen
1. `superpowers:systematic-debugging` — root cause eerst, dan oplossen
2. `superpowers:verification-before-completion` — verifieer voor je zegt dat het klaar is

### Code review
1. `superpowers:requesting-code-review` — na elke fase/milestone
2. `simplify` — code vereenvoudigen na implementatie

### Grote taken (meerdere onafhankelijke modules)
1. `superpowers:dispatching-parallel-agents` — parallelle agents voor onafhankelijke taken
2. `superpowers:subagent-driven-development` — agents per module

### Frontend / UI
1. `frontend-design:frontend-design` — voor alle UI-componenten
2. `ui-styling` — Tailwind + shadcn/ui componenten

---

## Tech Skills die Claude moet meenemen

### Backend (Node.js/Express)
- **Multi-tenancy:** elke query vereist `SET app.tenant_id` via PostgreSQL RLS
- **Authenticatie:** JWT access token (15 min) + refresh token (7 dagen) in httpOnly cookie
- **Queue jobs:** zware taken (e-mail, AI, job board posting) altijd via BullMQ — nooit synchroon
- **Validatie:** Zod schemas op alle API-inputs — vertrouw nooit ruwe request body
- **Foutafhandeling:** gestandaardiseerd `{ error: { code, message, details } }` formaat
- **Rate limiting:** via `express-rate-limit` + Redis store

### Frontend (Next.js)
- **App Router** — gebruik `app/` directory, niet `pages/`
- **Server Components** voor data-fetching waar mogelijk (minder JS naar client)
- **Client Components** alleen waar interactiviteit nodig is (drag-and-drop, forms)
- **React Query** (`@tanstack/react-query`) voor alle API-calls — geen fetch() direct
- **Formulieren:** `react-hook-form` + `zod` resolver — geen oncontrolled inputs
- **UI componenten:** `shadcn/ui` (Radix UI + Tailwind) — geen custom low-level components bouwen
- **Drag-and-drop:** `@dnd-kit/core` voor Kanban pipeline

### Database (PostgreSQL)
- **Migrations:** altijd idempotent schrijven (IF NOT EXISTS, ON CONFLICT DO NOTHING)
- **RLS:** elke nieuwe tabel krijgt direct een RLS policy — nooit vergeten
- **Indexes:** elke foreign key + elke kolom die gefilterd/gesorteerd wordt
- **pgvector:** voor AI embeddings (kandidaat-matching)
- **Soft delete:** `deleted_at TIMESTAMPTZ` — nooit hard deleten van kandidaten/vacatures

### AI Integraties
- **Claude API** als primaire provider (Anthropic SDK)
- **Prompt caching** inschakelen voor lange system prompts (kostenbesparing)
- **Streaming** voor lange AI-responses (CV-analyse, vacaturetekst genereren)
- **Fallback:** als Claude API faalt → OpenAI als backup
- **EU AI Act:** elke AI-beslissing moet transparantielabel krijgen + override mogelijk zijn

### Beveiliging (kritiek voor SaaS)
- SQL injection: altijd parameterized queries — nooit string interpolation
- XSS: Next.js escapet automatisch, maar oppassen bij `dangerouslySetInnerHTML`
- CSRF: SameSite=Strict cookies voor auth tokens
- File uploads: type-check + virus scan (ClamAV of SaaS equivalent)
- Secrets: nooit in code — altijd `.env` + Docker secrets
- GDPR: kandidaatdata nooit loggen in plaintext

---

## Module Volgorde (implementatiepriority)

```
Fase 1 (MVP):
  1. auth + tenant middleware
  2. kandidaten CRUD + resume parser
  3. vacatures CRUD
  4. pipeline / Kanban
  5. gebruikersbeheer + rollen
  6. basisrapportage

Fase 2 (Communicatie + Analytics):
  7. e-mail integratie (Gmail/Outlook OAuth)
  8. WhatsApp Business API
  9. SMS (Twilio)
  10. analytics dashboards
  11. open API + webhooks
  12. workflow automation engine

Fase 3 (Portalen + Sourcing):
  13. recruitment CRM
  14. white-label klantportaal
  15. career page builder
  16. job board integraties (top 20)
  17. hiring manager PWA

Fase 4 (AI + Compliance):
  18. AI matching engine (embeddings + pgvector)
  19. talent reactivation
  20. GDPR dashboard + AI Act compliance
  21. interview scheduling + scorecards

Fase 5 (Back-Office + Agentic):
  22. temp/contract timesheets + facturering
  23. agentic AI sourcing
  24. SSO/SAML
```

---

## Deployment Checklist (elke deploy)

- [ ] Database migraties draaien vóór app-deploy
- [ ] `.env` variabelen aanwezig op server
- [ ] Docker health checks groen
- [ ] Nginx config herlaad indien gewijzigd
- [ ] Sentry error tracking actief
- [ ] Smoke test: inloggen + kandidaat aanmaken + pipeline verplaatsen

---

## Handige Referenties

- Implementatieplan: [docs/implementatieplan.md](docs/implementatieplan.md)
- Strategische analyse: [docs/Manatal_Strategische_Analyse.docx](docs/Manatal_Strategische_Analyse.docx)
- KDMN platform infra: zie `../CLAUDE.md` (parent directory)
- VPS: Hetzner `91.98.232.104`
