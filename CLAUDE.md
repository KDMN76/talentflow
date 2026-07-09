# TalentFlow — CLAUDE.md

## Wat is dit project?

TalentFlow is een recruitment SaaS-platform gebouwd om Manatal te vervangen én te overtreffen.
Het stagebedrijf (ITProposal) betaalde ≈€620/maand voor Manatal (echte factuur GORR5CHG-0006:
16 seats × $39 + $50 add-on, zie docs/TCO_ROI.md). TalentFlow elimineert die kosten en wordt
zelf een commercieel product voor recruitmentbureaus en interne HR-teams.

**Positionering:** "Manatal-prijs. Ashby-analytics. Vincere-bureaufeatures. Één platform."

## Doelgroep

- **A) Recruitmentbureaus** (3–50 recruiters): agency-CRM, white-label klantportaal, plaatsingsbeheer
- **B) Interne HR-teams** (MKB tot mid-market): ATS, career page, onboarding, analytics

## Tech Stack

| Laag        | Technologie                                      |
|-------------|--------------------------------------------------|
| Backend     | Node.js + Express (apps/api)                     |
| Frontend    | Next.js 14 + React (apps/web)                    |
| Database    | PostgreSQL met Row-Level Security (multi-tenant) |
| Cache       | Redis                                            |
| Queue       | BullMQ (async jobs: e-mail, AI, job boards)      |
| File storage| MinIO (S3-compatibel, op Hetzner VPS)            |
| AI          | Claude API (Anthropic) + OpenAI als fallback     |
| Deploy      | Hetzner VPS (91.98.232.104) + Docker + Nginx     |

## Project Structuur

```
talentflow/
├── apps/
│   ├── api/          → Node.js/Express REST API (port 4000)
│   │   └── src/
│   │       ├── modules/   → Feature modules (auth, candidates, jobs, etc.)
│   │       ├── middleware/ → auth, tenant, ratelimit
│   │       ├── queue/     → BullMQ workers
│   │       └── db/        → PostgreSQL pool + migrations
│   └── web/          → Next.js app (port 3000)
│       └── app/
│           ├── (auth)/         → Login, register
│           ├── (dashboard)/    → Recruiter UI (beschermd)
│           └── careers/[slug]/ → Publieke career pages (SSR)
├── packages/
│   ├── shared/       → Gedeelde TypeScript types
│   └── ui/           → Gedeelde React componenten
└── docs/
    ├── implementatieplan.md           → Volledig technisch implementatieplan
    └── Manatal_Strategische_Analyse.docx → SWOT, As-Is, To-Be analyse
```

## Multi-Tenancy

- Shared PostgreSQL schema + `tenant_id` op elke tabel
- Row-Level Security (RLS): elke query is automatisch geïsoleerd per tenant
- `tenant_id` wordt via JWT claim doorgegeven aan elke API-request
- Nooit `tenant_id` in de URL — altijd via JWT

## Faseringsplan

| Fase | Inhoud                                          | Duur       |
|------|-------------------------------------------------|------------|
| 1    | MVP: kandidaten, vacatures, pipeline, parser    | 3–4 mnd    |
| 2    | Communicatie (WhatsApp/SMS/e-mail), analytics, API | 2–3 mnd |
| 3    | CRM, white-label portaal, career pages, HM app  | 3–4 mnd    |
| 4    | AI matching, interview intelligence, compliance | 2–3 mnd    |
| 5    | Temp/contract back-office, agentic AI           | 4–6 mnd    |

Zie [docs/implementatieplan.md](docs/implementatieplan.md) voor het volledige plan.

## Kernprincipes (differentiatie vs. Manatal)

1. **API standaard open** op alle plannen — geen feature-gating
2. **Omni-channel communicatie** — WhatsApp + SMS + e-mail + VoIP ingebouwd
3. **Analytics op CHRO-niveau** — recruiter KPIs, funnel, ROI standaard
4. **AI die meertalig werkt** — NL, EN, DE, FR (Manatal faalt bij niet-Engels)
5. **White-label klantportaal** standaard inbegrepen, geen add-on
6. **EU-native compliance** — GDPR dashboard + AI Act transparantie

## Taal

Alle gebruikersinterface en communicatie in het **Nederlands**.
Code, variabelen en commentaar in het **Engels**.

## Werkstandaard

Zie CLAUDE.md in de parent directory — Boil the Ocean standaard geldt ook hier.

## IDE

Kaan gebruikt **Google Antigravity** (binary: `antigravity` op PATH).

- **Geen** `code`/`vim`/`notepad` aanroepen (VSCode/andere launchers — verkeerde IDE).
- **Wel** `antigravity <abs-pad>` mag, mits Kaan expliciet vraagt om iets te "openen".
- Default-gedrag: in rapporten alleen het absolute file-path noemen — Kaan opent zelf via filetree of `Ctrl+P` quick-open.
