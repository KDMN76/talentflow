# TalentFlow Roadmap

Centraal document voor alles wat NIET in de huidige sprint zit.
Niets hieruit wordt opgepakt zonder expliciete promotie door Kaan.

**Regels:**
- Nieuwe items default op P2. Alleen Kaan promoot naar P0/P1.
- Items in ROADMAP worden niet opgepakt zonder expliciete promotie door Kaan.
- Aan het eind van elke sprint: 15 min review door Kaan.
- Claude Code voegt toe, herorganiseert niet zonder vragen.

---

## Sectie 1: Bugs & Gaps

### Docker monorepo-setup documenteren
- **Priority**: P3
- **Status**: Open
- **Source**: Claude Code
- **Date added**: 2026-05-17
- **Context**: De huidige `apps/api/Dockerfile`, `apps/web/Dockerfile` en `infra/docker-compose.prod.yml` hebben impliciete kennis die in Sub-fase 2A pas uit verrassingen bleek: build-context is monorepo-root (niet `apps/*`), npm-workspaces hoist `node_modules` op root waardoor per-app `node_modules` niet bestaan, Next.js standalone-tracer vindt geen deps zonder een fysieke `cp -r` kopie naar `apps/web/node_modules`, en `npm prune --workspaces` MUST op de monorepo-root draaien anders faalt-ie op registry-lookup van workspace-protocol deps. Vier verrassingen, vier iteratieve fixes voor ze allemaal werkten.
- **Notes**: Documenteer in nieuwe `docs/docker.md` zodat toekomstige Dockerfile/compose-wijzigingen niet opnieuw door deze valkuilen heen moeten. Sectie-suggesties: (1) waarom monorepo-root context, (2) waarom hoisted node_modules en hoe daarmee om te gaan in builder/runtime stages, (3) standalone-tracer behavior + `outputFileTracingRoot`, (4) `npm prune` op root vs workspace-subdir.

### Vacature-detail pagina crasht — `TypeError: Cannot read properties of undefined (reading 'map')`
- **Priority**: P1
- **Status**: In Progress
- **Source**: Claude Code
- **Date added**: 2026-05-16
- **Context**: Klik vanaf vacaturelijst op job-detail-link → witte pagina, "Application error: a client-side exception has occurred". Geverifieerd 2026-05-17 dat root cause is dat `useJobHealth` frontend-type een veld `health.components: []` verwacht dat backend `/jobs/:id/health` niet retourneert (response heeft `health_score`/`velocity_score`/etc). `JobOverzichtTab.tsx:256` doet `health.components.map(...)` → crash. Wordt opgelost door Fase 2B/2C — gedeelde Zod-schemas dwingen response-shape af en typecheck vangt mismatch direct.
- **Notes**: Pad `/jobs/[id]`. Werk-around vandaag: niet door-klikken naar detail. Permanente fix komt uit `@talentflow/contracts/job`.

### POST `/api/jobs` via UI faalt met HTTP 400, identieke payload via curl werkt
- **Priority**: P1
- **Status**: In Progress
- **Source**: Claude Code
- **Date added**: 2026-05-16
- **Context**: Form op `/jobs/new` toont toast "Vacature kon niet worden aangemaakt". Geverifieerd 2026-05-17 dat oorzaak in `JobForm.tsx:106-107` zit — `salary_min: data.salary_min ? Number(...) : null` stuurt `null` waar backend Zod `.optional()` alleen `undefined` accepteert. Plus `requirements: [...]` veld dat niet in `jobBodySchema` staat (silent gedropt). Wordt opgelost door Fase 2C — form gebruikt dan `JobCreateInputSchema` direct als react-hook-form resolver.
- **Notes**: Tot fix: nieuwe jobs alleen via API mogelijk.

### Backend `GET /jobs` SELECT bevat geen `description` (+ 12 andere kolommen)
- **Priority**: P1
- **Status**: In Progress
- **Source**: Audit
- **Date added**: 2026-05-16
- **Context**: `listJobs` SELECT laat 13 van 34 DB-kolommen vallen. Frontend `Job` (mockData) verwacht `description: string` required → runtime undefined op alle list-rijen. Wordt opgelost door Fase 2B — `JobListItemSchema` dwingt response-shape af, SELECT moet matchen.
- **Notes**: Volledige lijst missende kolommen in `JOB_CONTRACT_AUDIT.md` §4. Andere kolommen die mist: `contract_details`, `office_address`, `package_details`, `required_skills`, `nice_to_have_skills`, `tenant_id`, `deleted_at`, `embedding*`, `pay_transparency_required`, `salary_band_disclosed`, `compensation_criteria`.

### PWA-manifest deprecated meta + missende icon
- **Priority**: P2
- **Status**: Open
- **Source**: Claude Code
- **Date added**: 2026-05-16
- **Context**: Console warning + 404 bij elke page load. `<meta name="apple-mobile-web-app-capable">` is deprecated; ook `icons/icon-192.png` ontbreekt waardoor browser PWA-manifest niet kan parsen.
- **Notes**: Fix: vervang meta-tag door `<meta name="mobile-web-app-capable">`, plaats correcte icon-files in `apps/web/public/icons/`.

### Express rate-limit waarschuwing over `trust proxy` op elke request
- **Priority**: P2
- **Status**: Open
- **Source**: Claude Code
- **Date added**: 2026-05-16
- **Context**: `ValidationError: The 'X-Forwarded-For' header is set but the Express 'trust proxy' setting is false` — gespamd in API logs. Rate-limit telt nu IP-adressen verkeerd omdat Nginx ervoor zit en `req.ip` loopback is.
- **Notes**: Fix: `app.set('trust proxy', 1)` direct na `const app = express()` in `apps/api/src/index.ts`.

### pg `client.query()` deprecation warning
- **Priority**: P2
- **Status**: Open
- **Source**: Claude Code
- **Date added**: 2026-05-16
- **Context**: `DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0`. Ergens in een service wordt `client.query()` niet awaited terwijl een vorige nog loopt. Vermoedelijk in `withTenant()` helper of een specifieke worker.
- **Notes**: Fix: `node --trace-deprecation` op de container om de exacte plek te vinden, dan `await` correct toepassen.

### `clients` tabel bestaat niet in database
- **Priority**: P2
- **Status**: Open
- **Source**: Audit
- **Date added**: 2026-05-17
- **Context**: Frontend `JobManatalFields` heeft `client?: string`, `client_logo_url?: string` — alsof er klant-bedrijven aan jobs gekoppeld kunnen worden. Maar er bestaat geen `clients` of `crm_organizations` tabel; jobs hebben geen `client_id` foreign key. In Fase 2C verwijderen we de fantoom-velden uit de TS-typing; "klant per vacature" als feature komt apart (zie Features Backlog → Clients/CRM module).
- **Notes**: Past in volledige CRM-module met clients + contacts + deals. Niet alleen kolom-toevoeging.

### Enum-mismatches tussen frontend overlay en DB CHECK-constraints
- **Priority**: P2
- **Status**: In Progress
- **Source**: Audit
- **Date added**: 2026-05-17
- **Context**: `JobManatalFields` definieert enums met fantoom-waarden die DB CHECK-constraints zouden weigeren: `experience_level` heeft `intern`/`director` (DB: alleen `junior`/`medior`/`senior`/`lead`); `contract_type` heeft `freelance`/`internship` (DB: `temp`); `salary_frequency` heeft `yearly` (DB: `annual`). PATCH met die waarden zou 500 geven. Wordt in Fase 2C geharmoniseerd — we kiezen **de DB-CHECK-set als waarheid** (geen DB-wijzigingen in Fase 2). Frontend dropt `intern`/`director`/`freelance`/`internship`/`yearly`.
- **Notes**: Tweede verwarring: `employment_type` (eigen Zod-enum incl. `freelance`/`internship`, geen DB CHECK) vs `contract_type` (DB CHECK met `temp`) — twee kolommen, overlappende betekenis. In Fase 2C documenteren welk veld waarvoor staat; geen DB-rename in dit traject.

### Fantoom-velden in frontend type die geen DB-grond hebben (en waar ze gebruikt worden)
- **Priority**: P2
- **Status**: In Progress
- **Source**: Audit
- **Date added**: 2026-05-17
- **Context**: In Fase 2C verwijderen we vier velden uit `JobManatalFields` die nergens in de DB bestaan. Documentatie voor toekomstige reïntroductie:
  - `client?: string` — gebruikt in `JobDetailHeader.tsx:201` als display-label (fallback naar `department`).
  - `client_logo_url?: string` — niet gebruikt; alleen in type-definitie aanwezig.
  - `owner_id?: string` — niet gebruikt; alleen type-definitie.
  - `owner_name?: string` — gebruikt in `JobDetailHeader.tsx:205` (fallback naar `recruiter_name`).
- **Notes**: Bij toekomstige CRM/Clients-module: `client*` velden komen via JOIN op `crm_organizations`. `owner_*` zou alias kunnen worden voor `recruiter_*` of een aparte "account owner" concept worden — bespreken met Kaan voordat het terug komt.

### Backend `paginationSchema.status` is plain `string`, niet enum
- **Priority**: P2
- **Status**: Open
- **Source**: Audit
- **Date added**: 2026-05-17
- **Context**: `apps/api/src/modules/jobs/jobs.controller.ts` `paginationSchema` heeft `status: z.string().optional()`. Frontend kan willekeurige strings sturen die direct naar SQL `WHERE j.status = $` gaan. Geen exploit-risico (geparameteriseerde query), wel: tikfouten als `'opn'` geven silent 0 resultaten zonder validation-fout. Niet binnen Fase 2 scope omdat het over de query-string Zod gaat, niet over de Job-entiteit Zod.
- **Notes**: Fix later: vervang door `z.enum(['draft','open','filled','closed','archived']).optional()`.

### `useJob(id)` return type heeft `stages: unknown[]`
- **Priority**: P2
- **Status**: In Progress
- **Source**: Audit
- **Date added**: 2026-05-17
- **Context**: `apps/web/hooks/useJobs.ts` typt de detail-response als `Job & { stages: unknown[] }`. Geen type-safety op de meest-getoonde nested data. Wordt opgelost door Fase 2C — `JobDetailSchema` extend met `PipelineStageSchema[]` geeft type-veilige stages.
- **Notes**: Onderdeel van `@talentflow/contracts/job`.

---

## Sectie 2: Features Backlog

### Clients/CRM module (ontbrekende `clients` tabel + UI)
- **Priority**: P2
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: Vacatures zouden gekoppeld moeten kunnen worden aan klant-bedrijven (voor bureau-recruiters het meest relevant). Vereist DB-migratie (`clients`/`crm_organizations`/`crm_contacts`/`crm_deals` tabellen), backend module + UI. Zonder dit blijft `JobDetailHeader.client` veld leeg en is bureau-workflow incompleet.

### Demo-tenant voor prospects
- **Priority**: P2
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: Een vooraf gevulde, alleen-lezen tenant met realistische test-data zodat prospects het systeem kunnen bekijken zonder te registreren of echte data te zien.

### Multi-tenant white-label (logo per tenant, accent kleur per tenant, custom subdomein)
- **Priority**: P2
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: Per tenant configureerbare branding (logo, accentkleur, mogelijk custom subdomein zoals `recruitment.kdmn.nl`). Backend tabel `tenant_branding` bestaat al; UI/wiring nog niet operationeel.

### DESIGN.md uitrol over bestaande pagina's
- **Priority**: P2
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: Per `LAUNCH_PLAN.md`: bestaande werkende pagina's worden NIET geherstijld tot na go-live. Daarna systematisch DESIGN.md toepassen — forest accent #0F7A3C, Inter Variable met cv01/ss03, borders boven shadows, 13/500 workhorse text.

### AI-features (kandidaat-matching, outreach generation, reactivatie)
- **Priority**: P2
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: pgvector + embeddings backend infrastructure bestaat (kolom `embedding vector(1536)` op `jobs` en `candidates`, HNSW-index). Matching service, AI outreach, talent-reactivation cron-job — frontend-UI mist of toont mock-data. Per LAUNCH_PLAN.md: alleen bouwen als recruiter erom vraagt.

### Integraties (Gmail/Outlook, Calendar, jobboards)
- **Priority**: P2
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: Email-sync via OAuth (recruiter koppelt eigen mailbox; verzonden mail komt vanuit zijn naam), Google/Outlook Calendar voor interview-planning, jobboard-postings (LinkedIn, Indeed, Indeed, NL-vacaturebank).

### 2FA / SSO
- **Priority**: P2
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: TOTP-based 2FA per user (backend infrastructure deels aanwezig: `user_2fa_secrets`, `tenant_2fa_policy` tabellen). SAML/OIDC SSO voor enterprise klanten. Per LAUNCH_PLAN.md Sprint 0: niet nu.

### Audit logs
- **Priority**: P2
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: `audit_events` tabel bestaat en wordt geschreven door diverse services. UI om audit-trail te bekijken (filters op gebruiker/actie/datum, export, compliance-rapportage) ontbreekt.

### Career pages per tenant
- **Priority**: P2
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: Tenants kunnen eigen career-page bouwen met vacatures vanuit hun pipeline. Backend `career_pages` + `career_page_application_forms` tabellen bestaan; UI-builder en publieke render-laag nog niet werkend.

### Klantportaal voor shortlist-feedback
- **Priority**: P2
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: Token-based gast-portaal waar de klant van een bureau de shortlist kan zien en feedback geven. `guest_portal_links` + `guest_portal_feedback` tabellen bestaan; flow + UI nog niet operationeel.

### Analytics module (echte data ipv mock)
- **Priority**: P2
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: `/analytics` page render-laag gebruikt nu echte hooks (mock-fallbacks zijn verwijderd 2026-05-15), maar de meeste pagina's tonen "Kon niet laden" omdat backend-endpoints ontbreken. Compleet analytics-systeem: pipeline-stats, time-to-hire, source-of-hire, recruiter-performance, DEI-funnel.

### Reports module fix
- **Priority**: P2
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: Reports-page bestaat in sidebar maar werkt niet — toont fout-state of leeg. Drag-drop report-builder, scheduled exports, embed-links.

### Hiring Manager Review module (vervang mock data met echte flow)
- **Priority**: P2
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: `/hm` (Hiring Manager) heeft een PWA swipe-UI maar draait op mock-data sinds de fallback-fix van 2026-05-15. Echte HM-flow: HM krijgt notificatie, opent op mobiel, swipet door shortlist, geeft score + feedback. Web Push backend bestaat deels.

### Invite-only flow netjes bouwen (registratie staat nu hardcoded dicht)
- **Priority**: P2
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: 2026-05-15 hotfix zette publieke registratie dicht via env-var `DISABLE_PUBLIC_REGISTRATION`. Permanent: admin nodigt user uit per email met magic-link (verloopt na 7 dagen), user kiest wachtwoord, koppelt aan bestaande tenant. Per LAUNCH_PLAN.md Sprint 0 expliciet binnen scope, maar nog niet uitgevoerd.

### Wachtwoord-reset flow afmaken
- **Priority**: P2
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: "Vergeten?"-link op login-page bestaat maar de end-to-end flow (email met reset-link, token-validatie, nieuw wachtwoord, audit-log) is niet compleet. Vereist Resend email-template + endpoint + UI-pagina's. Per LAUNCH_PLAN.md Sprint 0 binnen scope.

### Rate-limit op /login
- **Priority**: P2
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: Per LAUNCH_PLAN.md Sprint 0: max 5 pogingen per IP per 15 min op `/api/auth/login`. Express-rate-limit is geïnstalleerd maar niet specifiek op de login-route geconfigureerd (en de trust-proxy waarschuwing — zie Bugs §5 — moet gefixt zijn zodat het accuraat per echte IP telt).

---

## Sectie 3: Ideeën & Onderzoek

### SaaS-verkoop aan tweede klant (proces, pricing, contract)
- **Priority**: P3
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: Onderzoek naar onboarding-proces, pricing-tiers, verwerkersovereenkomst-template, betaling (Stripe?), service-level afspraken voor de tweede klant na IT Proposal.

### Doorverkopen TalentFlow aan enterprise klanten (lange termijn)
- **Priority**: P3
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: Strategie voor enterprise-pad: SLA-tier, dedicated tenant-DB, enterprise SSO, white-glove onboarding, custom-domain SSL, professional-services. Voorvereisten op product en organisatie.

### AI Act compliance module
- **Priority**: P3
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: EU AI Act categoriseert recruitment-AI als hoog-risico. Vereiste documentatie per AI-feature: model-card, bias-assessment, human-oversight log, opt-out per tenant. Backend `ai_events` tabel bestaat als log-foundation.

### Pay transparency module (EU-wetgeving)
- **Priority**: P3
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: EU Pay Transparency Directive 2023/970 (geldig 2026): salarisbandbreedte verplicht bij elke vacature, transparante criteria, audit-rapportage. Backend voorbereidingen aanwezig: `pay_transparency_required` + `salary_band_disclosed` (generated) + `compensation_criteria` kolommen op `jobs`, `tenant_pay_settings` tabel. UI-handhaving deels aanwezig in JobForm.

### GDPR data-export per kandidaat
- **Priority**: P3
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: AVG art. 15 — recht op inzage. Kandidaat krijgt token-link via email, kan eigen volledige dossier downloaden (CV's, communications, application-historie, AI-scores). Backend `candidate_self_tokens` + `dsar_requests` tabellen bestaan. Self-service portal `/profile/[token]` deels aanwezig.

### GDPR data-delete per kandidaat
- **Priority**: P3
- **Status**: Open
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: AVG art. 17 — recht op verwijdering. Kandidaat vraagt verwijdering aan via self-service of DSAR-flow, recruiter krijgt approval-melding, na akkoord wordt PII geanonimiseerd of fysiek verwijderd (afhankelijk van retentie-policy). Audit-event blijft staan zonder PII.
