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

### Notificatie-voorkeuren: frontend/backend-contract mismatch
- **Priority**: P2
- **Status**: Open
- **Source**: Claude (gevonden tijdens Fase-0 endpoint-wiring, 2026-06-11)
- **Context**: De pagina `settings/notifications` slaat voorkeuren niet op en
  laadt ze niet. Twee oorzaken: (1) frontend doet `PUT /notifications/preferences`
  maar de backend heeft alleen `PATCH /preferences` (per (channel,event_type)-rij)
  → 404 → "Opslaan mislukt". (2) frontend verwacht één geconsolideerd object
  (`{push_enabled, events{}, quiet_hours_start/end, timezone}`) terwijl `GET`
  `{data:[rijen]}` teruggeeft → laden valt stil terug op defaults.
- **Goed nieuws**: de event_type-vocabulaire matcht exact tussen frontend
  (`NotificationPreferences.events`) en backend (`src/lib/pushEvents.ts` + de
  reminder/push-workers): new_candidate_review, scorecard_deadline,
  interview_reminder, application_status_change, daily_digest.
- **Aanbevolen fix**: voeg `GET`/`PUT /notifications/preferences` toe die het
  geconsolideerde object ↔ de per-rij-tabel (`notification_preferences`) mappen.
  LET OP: de per-rij-tabel is de source-of-truth voor de delivery-worker
  (`getEffectivePreference(tenant,user,channel,event_type)`). Om de twee-niveau-UI
  (master `push_enabled` + per-event) correct te bewaren moet `push_enabled` als
  master-rij worden opgeslagen én moet `getEffectivePreference` master AND event
  controleren — dat raakt de delivery-pad-logica, dus met worker-tests afdekken.
  Geen quick wiring; echte feature-reconciliatie. Push is niet het primaire kanaal
  (e-mail wel), dus lagere urgentie.

### Custom-domain career-pages: publieke API-fetch is cross-origin (CORS)
- **Priority**: P2
- **Status**: Open
- **Source**: Claude (gevonden tijdens bouw white-label custom-domain serving, 2026-07-09)
- **Context**: De publieke career-page (`app/careers/[slug]/page.tsx`) is een
  client component die de data client-side ophaalt via de axios-instance
  (`lib/api.ts`, baseURL = `NEXT_PUBLIC_API_URL` = https://talentflow.kdmn.nl/api,
  `withCredentials: true`). Via een eigen domein (bv. werkenbij.klant.nl) is die
  fetch **cross-origin**: de browser-origin is het klantdomein, de API-origin is
  talentflow.kdmn.nl. De globale CORS-config (`index.ts`) staat alleen
  `CORS_ORIGIN` (= talentflow.kdmn.nl) toe → preflight/GET wordt geblokkeerd →
  de pagina toont de error-state op het custom domein. De **middleware-rewrite,
  het resolve-endpoint, de admin-koppeling/verificatie en de render zelf werken**;
  alleen de client-side datafetch faalt cross-origin.
- **Waarom niet meegefixt**: het openzetten van CORS voor de publieke
  career-/apply-endpoints is een security-relevante, cross-cutting keuze
  (origin-reflectie vs. wildcard, omgang met `withCredentials`/refresh-cookie).
  Buiten de afgesproken scope van de 4 build-items — expliciet ter beslissing.
- **Aanbevolen fix (ter keuze)**: (a) mount een tweede `cors()` alléén op de
  publieke career-routes (`/public/resolve-domain`, `/public/:slug`,
  `/public/:slug/apply`) die de origin reflecteert en **geen** credentials
  vereist (de publieke endpoints hebben geen auth-cookie nodig); en/of (b) op de
  career-page een dedicated fetch zonder `withCredentials`. Optie (a) is het
  meest generiek. Vereist een bewuste keuze van Kaan i.v.m. security-posture.

### Eigen mailserver: IMAP-ontvangst (inbox-sync) ontbreekt nog
- **Priority**: P2
- **Status**: Open
- **Source**: Claude (gevonden tijdens "eerlijke OAuth-staat + IMAP/SMTP-ontsluiting" op settings/integrations, 2026-07-10)
- **Context**: Op `settings/integrations` kan een tenant nu zijn eigen mailserver
  koppelen zónder OAuth. **Verzenden** werkt volledig via de bestaande per-tenant
  SMTP (`lib/tenantMailer.ts` + `tenant_email_settings`, migratie 042) en wordt
  vanuit de integraties-pagina ontsloten met een verwijzing naar
  `settings/email`. **Ontvangst/inbox-sync via IMAP bestaat nog niet**: de
  bestaande inbox-sync (`queue/workers/inboxSync.worker.ts` +
  `lib/providers/*`) leest alleen via de Gmail/Outlook OAuth-providers
  (`listMessagesSince`/`getMessage`). Een SMTP-only tenant kan dus wél mailen,
  maar replies van kandidaten worden niet automatisch ingelezen/gethread.
- **Waarom niet meegefixt**: volledige IMAP-inbox-sync (IMAP-client, folder-
  delta/UIDVALIDITY-cursors, MIME-parsing, thread-matching op Message-ID/
  In-Reply-To, encryptie van IMAP-credentials, SSRF-guard analoog aan SMTP,
  worker-scheduling) is een eigen feature ter grootte van de OAuth-providers —
  buiten de scope van deze taak.
- **Aanbevolen richting**: een `imapProvider` die de `MailProvider`-interface
  (deels) implementeert (minimaal `listMessagesSince`/`getMessage`), IMAP-config
  naast de SMTP-velden in `tenant_email_settings` (host/port/secure/user/pass
  encrypted, hergebruik `assertSafeSmtpTarget`-patroon), en aanhaken op de
  bestaande `inboxSync.worker.ts`-pipeline.

### ✅ Opgelost op 2026-06-03 (sessie "Sectie-1 opruiming")

Additieve log — de losse items hieronder zijn niet herschreven; deze sectie is
de waarheid over wat per 2026-06-03 dicht is. Geverifieerd met: contracts build,
api+web `tsc --noEmit` (beide clean), `vitest` (1519 api-tests + 15 web-tests
groen), en een volledige `next build`.

- **Vacature-detail pagina crasht (`health.components.map`)** → opgelost. Nieuw
  `JobHealthSchema` in `@talentflow/contracts`; backend levert nu `score` +
  `components[]` (mapper in `jobHealth.service.ts`), controller valideert met
  `assertResponse`, frontend (`useJobDetail.ts`) parset runtime → bij drift een
  nette "geen data" i.p.v. witte pagina.
- **Bug B: JobHealthSchema migreren naar contracts** → opgelost (zelfde fix).
- **Bug A: JobDetail-schema embedding-leak** → opgelost. `getJob` gebruikt nu
  een expliciete kolommenlijst (geen `j.*`); `embedding`/`embedding_updated_at`
  zitten niet meer in de response → geen `.strict()`-400 meer in dev/test.
  Designbeslissing: embedding (vector(1536)) hoort niet in de API-wire-shape.
- **POST /api/jobs 400 via UI**, **listJobs SELECT mist description**,
  **paginationSchema.status plain string**, **useJob stages `unknown[]`**,
  **enum-mismatches**, **fantoom-velden** → opgelost door de 2B/2C-migratie;
  geverifieerd in code. `JobManatalFields` (dode code) verwijderd; dode
  enum-copies in `JobOverzichtTab.tsx` op DB-CHECK-waarden gezet.
- **Express `trust proxy`** → `app.set('trust proxy', 1)` gezet. Lost logspam op
  én laat de login-rate-limit op het echte client-IP tellen.
- **pg `client.query()` deprecation** → opgelost. 5 plekken die parallelle
  queries op dezelfde client deden (`permissions.ts`, `candidates.service.ts`,
  `dsar.service.ts`, `selfService.service.ts`, `reports.service.ts`)
  geserialiseerd. `matching.service.ts` gebruikt aparte clients → was al ok.
- **PWA**: `icon-192.png` + `icon-512.png` gegenereerd uit `icon.svg` (manifest
  verwees naar beide; geen 404 meer). `sw.js`/`manifest.json` bestonden al;
  deprecated apple-meta was al weg.
- **Web-healthcheck false positive** → twee-probe-check (HTML + echte
  static-chunk) in `apps/web/Dockerfile` én compose.
- **Deploy-procedure** → `infra/deploy.sh` (forceert altijd `--env-file`) +
  luide warning in compose + env-docs in README.
- **Docker-/standalone-docs** → `docs/docker.md` (consolideert beide P3-docs).
- **React types-error `providers.tsx`** → opgelost. `@types/react` 18.x gepind
  als root-devDep (Radix-peers hesen 19 op) → web `tsc` volledig clean.
- **`.env.local` opruimen** → mock-regel was al weg; env-bestanden nu
  gedocumenteerd in README.

**Nog open na deze sessie:**
- **Archief-containers op VPS** → script geleverd (`infra/prune-vps.sh`), moet
  Kaan zelf op de VPS draaien (user-led, geen remote-exec door Claude).
- **deploy.sh vangnet #2 (`env_file:` per service)** → zie nieuw item onderaan
  deze sectie; niet lokaal te valideren (geen docker + geen `.env.prod` op dev).

### Sub-fase 2D: JobDetail-schema-volledigheid (Bug A)
- **Priority**: P1
- **Status**: Open
- **Source**: Sub-fase 2C Stap 5 smoke-test, 2026-05-18
- **Date added**: 2026-05-18
- **Context**: `jobs.service.ts:getJob` doet `SELECT j.*, u.name as recruiter_name` en retourneert `embedding` + `embedding_updated_at` velden. `JobDetailSchema` heeft deze bewust weggelaten met `.strict()`. Resultaat: validatie faalt in dev/test (HTTP 400 `unrecognized_keys: ['embedding','embedding_updated_at']`), ondanks dat productie het toevallig "werkend" oplijkt door no-op `assertResponse` onder `NODE_ENV=production`.
- **Fix-richting**: óf SELECT vervangen door expliciete kolommenlijst die `embedding*` excludeert, óf `JobDetailSchema` deze velden expliciet als `.optional()` toelaten. Beslissing op design-niveau: hoort embedding bij de wire-shape of niet? Bespreken voordat we fixen.

### Sub-fase 2D: JobHealthSchema migreren naar shared contracts (Bug B)
- **Priority**: P1
- **Status**: Open
- **Source**: JOB_CONTRACT_AUDIT.md item #1, bevestigd in 2C Stap 5 smoke-test
- **Date added**: 2026-05-18 (bevestigd; oorspronkelijk gevonden 2026-05-17)
- **Context**: `GET /jobs/:id/health` backend retourneert flat object met scores (`{health_score, velocity_score, days_open, ...}`). Frontend `useJobHealth` hook verwacht `{components: []}` shape. Dit is de oorspronkelijke vacature-detail crash uit het audit-document.
- **Fix-richting**: definieer `JobHealthSchema` in `packages/contracts`, fix backend response shape, frontend gebruikt shared schema.
- **Notes**: Dit is de eerstvolgende contract-migratie na Job zelf. Patroon hetzelfde als 2B/2C maar voor health/funnel/team-related endpoints.

### Lokale dev mist peer-dependencies die productie via `--legacy-peer-deps` resolved
- **Priority**: P2
- **Status**: Resolved (react-is toegevoegd als directe dep)
- **Source**: Claude Code (Sub-fase 2C Stap 5 smoke-test, 2026-05-18)
- **Context**: Recharts heeft `react-is` als peer-dep. Lokale `npm install` zonder `--legacy-peer-deps` installeerde hem alleen genest (16.13.1 via Sentry-chain), niet gehoist op top-level waar Next's webpack hem zoekt. Productie Docker-build resolveert het wel via `--legacy-peer-deps`. Resultaat lokaal: Next dev faalde met "Module not found: Can't resolve 'react-is'" op detail-pages die recharts laden via JobPerformanceTab.
- **Fix toegepast**: `react-is: "^18.3.1"` als directe dep in `apps/web/package.json`. Versie alignt met React 18.x.
- **Notes**: Audit op andere ontbrekende peer-deps tijdens deze sessie uitgevoerd via `npm ls` — alleen `react-is` was top-level afwezig in deze monorepo. Mocht in toekomst weer een soortgelijke peer-mismatch optreden bij nieuwe deps, herhaal het patroon: voeg expliciet als directe dep toe, niet vertrouwen op `--legacy-peer-deps` hoisting.

### Neon free tier scale-to-zero + pg-pool timeout
- **Priority**: P1
- **Status**: Open
- **Source**: Claude Code (Sub-fase 2C Stap 5 smoke-test)
- **Date added**: 2026-05-17
- **Context**: Neon free tier slaapt na ~5 min inactivity. Cold-start 3-15s. Huidige `pg-pool` `connectionTimeoutMillis` (~10s) is te kort. Eerste query na inactivity faalt met "Connection terminated due to connection timeout". Geverifieerd op 2026-05-17 tijdens login-flow: eerste POST 500 met die error, tweede POST direct erna 200 (Neon warm).
- **Fix-richting**: `apps/api/src/db/pool.ts` `connectionTimeoutMillis` naar 30s. Productie-impact: nul (Hetzner-Postgres slaapt niet, timeout-verhoging is no-op voor warme pools).
- **Notes**: Doen als eerste actie morgen voor 2C Stap 5 hervatting — anders wisselt elke smoke-test tussen "werkt" en "5xx" afhankelijk van of Neon warm of koud is, wat de testresultaten waardeloos maakt.

### Dev-environment .env.local bestand opruimen
- **Priority**: P2
- **Status**: Open
- **Source**: Claude Code (gevonden tijdens Sub-fase 2C smoke-test)
- **Date added**: 2026-05-17
- **Context**: `apps/web/.env.local` (datum 2026-05-11, uit eerdere mock-mode-sessie) bevatte `NEXT_PUBLIC_USE_MOCK_DATA=true`, wat de echte API-flow blokkeerde tijdens smoke-test. Regel is verwijderd. Maar het bestand zelf is niet gedocumenteerd in repo. Doen: documenteer in README welke .env-files horen bij welke setup, of verwijder `.env.local` volledig en gebruik `.env.development` als enige dev-config-bron.
- **Notes**: Andere variabelen in `.env.local` kunnen vergelijkbare verrassingen bevatten — review bij gelegenheid.

### React types error in apps/web/app/providers.tsx:31
- **Priority**: P3
- **Status**: Open
- **Source**: Claude Code
- **Date added**: 2026-05-17
- **Context**: `npx tsc --noEmit` op apps/web rapporteert: `Type 'React.ReactNode' is not assignable to type 'import("…@types/react").ReactNode'. Type 'bigint' is not assignable to type 'ReactNode'`. Pre-existing TypeScript-type error door dual React-versie resolution in monorepo, niet contract-gerelateerd, niet productie-blokkerend (Next build slaagt, runtime werkt). Geen impact op consumers.
- **Notes**: Fix-richting (later): align @types/react versie in monorepo (root + apps/web), of force-resolutie via npm `overrides`. Vermoedelijk hoist-conflict tussen `apps/web/node_modules/@types/react` en de hoisted root-versie. Scope-discipline: niet meegenomen tijdens Sub-fase 2C zoals besproken.

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

### Deploy-procedure documenteren met expliciet `--env-file infra/.env.prod`
- **Priority**: P1
- **Status**: Open
- **Source**: Claude Code (productie-deploy-fouten, 2026-05-21 — **tweemaal dezelfde dag**)
- **Date added**: 2026-05-21
- **Context**: Op 2026-05-21 ging dezelfde flag-omissie tweemaal mis tijdens één deploy-cyclus, met verschillende failure-modi:
  1. **Eerste keer** (`up -d` zonder `--env-file`): `docker compose -f infra/docker-compose.prod.yml up -d web` zag alle env-vars als "leeg" (warnings: `DATABASE_URL`, `JWT_SECRET`, `REDIS_PASSWORD`, etc.), interpreteerde dat als config-verandering, en **recreated alle dependency-containers** (postgres, redis, minio, api) met blanke env-vars. API direct in restart-loop met `Error: DATABASE_URL environment variable is required`. Web bleef in `Created` state. Recovery: zelfde commando met `--env-file infra/.env.prod` → ~8 min downtime extra.
  2. **Tweede keer** (`build web` zonder `--env-file`): `docker compose -f infra/docker-compose.prod.yml build web` kreeg `${NEXT_PUBLIC_API_URL}` als undefined → Docker build viel terug op Dockerfile-ARG-default `http://localhost:4000/api` → **Next.js bakte localhost in alle JS-bundles** (85 occurrences in static, 13 in server-bundles). Symptoom: site werkte, login werkte, dashboard faalde met 84 `ERR_CONNECTION_REFUSED` op `localhost:4000/api/*`. Recovery: rebuild met `--env-file infra/.env.prod` → resterende localhost-hits alleen nog in `.map` sourcemaps (niet uitgevoerd) + 1 dead-code fallback (`?? "..."` waar primaire waarde non-null is) → 0 runtime impact.

  Beide failure-modi root cause: **compose-substitutie van `${VAR}` met undefined wordt stilletjes lege string**, en niemand merkt het bij `build` (warnings worden onder verbose output verstopt) noch bij `up -d` (warnings staan tussen ~50 andere docker-status-lines).
- **Fix-richting (gestapeld, doe beide)**:
  1. **Maak `infra/deploy.sh` als enige aanroeppad** dat altijd `--env-file infra/.env.prod` includeert voor alle compose-subcommando's (`build`, `up`, `down`, `pull`, etc.). Voorkomt hele klasse van menselijke fouten — niemand hoeft de flag te onthouden. Voorbeeld-skelet:
     ```bash
     #!/usr/bin/env bash
     set -euo pipefail
     COMPOSE_FILE="$(dirname "$0")/docker-compose.prod.yml"
     ENV_FILE="$(dirname "$0")/.env.prod"
     exec docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
     ```
     Gebruik: `./infra/deploy.sh build web`, `./infra/deploy.sh up -d`, etc.
  2. **Compose YAML aanvullen**: voeg `env_file: ./.env.prod` toe aan elke service in `infra/docker-compose.prod.yml` als belt-and-braces. Voordeel: zelfs als iemand `deploy.sh` omzeilt en handmatig compose draait, worden runtime env-vars correct geladen. Nadeel: lost het **build-time** probleem (NEXT_PUBLIC_*) NIET op — `args:` blok in compose YAML heeft nog steeds `${VAR}` interpolation die `--env-file` nodig heeft. Dus #1 blijft de echte fix; #2 is extra vangnet voor runtime-vars.
- **Notes**: P1 omdat dit tweemaal op één dag misging en de tweede keer een symptoom (witte API-calls) had dat eindgebruikers direct hadden gemerkt — als de recruiter eind juni met dit type fout in productie kwam, was de demo waardeloos. **De originele 3 dagen-oude containers hadden label `com.docker.compose.project.environment_file=/opt/talentflow/infra/.env.prod`**, dus de originele deploy gebruikte óf optie 1 óf een handmatige flag — niemand documenteerde dat. Tot deploy.sh er is: **elke handmatige `docker compose` op de VPS MOET `--env-file infra/.env.prod` bevatten**, ook voor `build`. Documenteer dat tijdelijk in `infra/README.md` of bovenaan `docker-compose.prod.yml` als luide warning.

### Web-container healthcheck checkt geen static-assets
- **Priority**: P2
- **Status**: Open
- **Source**: Claude Code (productie-down diagnose, 2026-05-21)
- **Date added**: 2026-05-21
- **Context**: `apps/web/Dockerfile` HEALTHCHECK doet `wget -qO- http://localhost:3000/login`. Returnt HTTP 200 zolang server.js draait en HTML serveert, óók als alle client-bundles 404'en. Tijdens productie-incident 2026-05-18 t/m 2026-05-21: container 3 dagen `(healthy)` terwijl frontend witte pagina serveerde door ontbrekende `/app/.next/static/` (zie commit `fix(docker): web container serveert static assets op verwachte pad`). Healthcheck was false positive.
- **Fix-richting**: HEALTHCHECK uitbreiden naar twee checks: (1) `/login` HTTP 200, (2) `wget -qO- http://localhost:3000/_next/static/chunks/main-app-*.js` (of een vast manifest-bestand) ook 200. Zodat verkeerd-geserveerde bundels container `unhealthy` maken en compose `restart` of `--force-recreate` triggert.
- **Notes**: Verkeerde bundle-hash bij elke build → manifest-bestand kiezen dat altijd dezelfde naam heeft (bijv. `/_next/static/[buildId]/_buildManifest.js`, of `BUILD_ID` content-check). Alternatief: separate `/health` endpoint in Next.js dat zelf checkt of static-dir bestaat.

### Next.js standalone monorepo paden documenteren in docs/docker.md
- **Priority**: P3
- **Status**: Open
- **Source**: Claude Code (productie-down diagnose, 2026-05-21)
- **Date added**: 2026-05-21
- **Context**: Tijdens productie-incident bleek dat `apps/web/Dockerfile` runtime-stage static assets kopieerde naar `./apps/web/.next/static`, maar Next.js standalone's `server.js` op `/app/server.js` zocht ze op `/app/.next/static`. Mismatch tussen waar Next standalone-tracer in monorepo-modus de assets plaatst en waar de gegenereerde server.js ze verwacht. Fix: extra COPY naar `./.next/static`, beide paden behouden. Toekomstige Dockerfile-aanpassingen moeten deze invariant kennen.
- **Notes**: **Uitbreiding van bestaande P3 "Docker monorepo-setup documenteren"** (zie hierboven in deze sectie) — voeg sectie (5) toe: "static-asset paden in standalone-output, waarom `server.js` ze op een ander pad zoekt dan waar Next ze bouwt, waarom we beide paden COPYen". Samenvoegen of apart laten: aan jou.

### Archief-containers opruimen op VPS
- **Priority**: P3
- **Status**: Open
- **Source**: Claude Code (gevonden tijdens productie-diagnose, 2026-05-21)
- **Date added**: 2026-05-21
- **Context**: `docker ps -a` op `91.98.232.104` toont 7+ exited containers van oude buildpogingen die nooit zijn opgeruimd: `modest_shamir` (Exited 254, 4d), `agitated_hypatia` (Exited 1, 4d), `loving_johnson` (Exited 1, 6d), `great_pike` (Exited 1, 6d), `serene_leakey` (Exited 1, 6d), `relaxed_agnesi` (Exited 2, 6d), `gallant_mirzakhani` (Exited 1, 6d), `talentflow-minio-init` (Exited 0, 6d). Plus mogelijk dangling images (niet gemeten).
- **Fix-richting**: `docker container prune -f` om alle exited containers weg te halen, gevolgd door `docker image prune -f` voor dangling images. Geen impact op draaiende services.
- **Notes**: Inplannen als onderhoud-taak. Doe ook eens `df -h /var/lib/docker` vooraf om disk-besparing te kunnen rapporteren. Eventueel cron-job opzetten (weekly prune) — apart P3 item zodra dit eens is gedaan.

### PWA service worker + manifest ontbreken
- **Priority**: P3
- **Status**: Open
- **Source**: Browser-test 2026-05-21, na productie-fix
- **Date added**: 2026-05-21
- **Context**: Console toont 404 op `/sw.js` (service worker) en `/manifest.json`. PWA-features (offline gebruik, installeerbaar als app) werken niet. Niet kritiek voor desktop-gebruik door recruiter eind juni.
- **Fix-richting**: bepalen of we PWA echt willen (next-pwa setup) of de meta-tags weghalen om de console clean te maken.
- **Notes**: Gedeeltelijke overlap met bestaande P2-entry "PWA-manifest deprecated meta + missende icon" (zie hierboven in deze sectie) — die dekt `icons/icon-192.png` 404 + deprecated `apple-mobile-web-app-capable` meta. Deze nieuwe entry dekt `sw.js` + `manifest.json` 404. Samenvoegen of apart laten: aan jou.

### deploy.sh vangnet #2 — `env_file:` per service in compose
- **Priority**: P2
- **Status**: Open
- **Source**: Claude Code (sessie 2026-06-03)
- **Date added**: 2026-06-03
- **Context**: `infra/deploy.sh` (vangnet #1) is gebouwd en is de echte fix. Het tweede vangnet uit de oude P1-entry — `env_file: ./.env.prod` per service — is bewust NIET doorgevoerd omdat het niet veilig lokaal te valideren is (geen docker + geen `.env.prod` op de dev-machine, en een fout maakt op de eerstvolgende deploy alle runtime-env-vars leeg).
- **Fix-richting (valideren op VPS met `docker compose config`)**: voeg `env_file: [./.env.prod]` toe aan `api`, `api-worker`, `web`, én verwijder tegelijk de pure pass-through `${VAR}`-entries uit hun `environment:`-blokken. **Let op:** `environment:` overschrijft `env_file:`, dus laat je de `${VAR}`-entries staan dan maakt een vergeten `--env-file` ze leeg en winnen die lege waarden. Remapped vars (`SENTRY_DSN: ${SENTRY_DSN_API}`) en literals (`NODE_ENV`, `PORT`, `DISABLE_INLINE_WORKERS`, de `:-false` defaults) moeten expliciet in `environment:` blijven. Build-time `NEXT_PUBLIC_*` (in `args:`) lost dit NIET op — daarvoor blijft `deploy.sh` nodig.
- **Notes**: Volledige toelichting staat in `docs/docker.md` §6.

### Funnel-endpoint mist hired/dropped/total + stage-veldnamen wijken af
- **Priority**: P2
- **Status**: Open
- **Source**: Claude Code (browser-verificatie 2026-06-06)
- **Date added**: 2026-06-06
- **Context**: `GET /api/jobs/:id/funnel` (`jobDetail.service.ts:getJobFunnel`) retourneert alleen `{ stages }`, terwijl de frontend-`JobFunnelResponse` (apps/web/lib/types/jobDetail.ts) ook `job_id`, `total`, `hired`, `dropped`, `computed_at` verwacht. Bovendien levert elke stage `stage_name` + `conversion_rate_from_previous`, terwijl de frontend `name` + `conversion_to_next_pct` (andere richting!) verwacht. Gevolgen in de UI: header toonde "Aangenomen: NaN" (nu defensief op 0 gezet in `JobDetailHeader.tsx`), en de conversie-badges in de pipeline-tab blijven leeg (alle `conversion_to_next_pct` zijn undefined).
- **Fix-richting**: trek funnel in `@talentflow/contracts` (zoals JobHealth) en laat de backend de volledige shape leveren: `hired`/`dropped` via `COUNT(*) FILTER (WHERE status=...)`, `total` = som van stage-counts, stage-veld `name` (i.p.v. `stage_name`), en `conversion_to_next_pct` voor stage i = `count[i+1]/count[i]`. Frontend dropt dan de `?? 0`-workaround.
- **Notes**: De `?? 0` in `JobDetailHeader.tsx` is een tijdelijke pleister tegen NaN, geen echte fix — de getallen zijn pas correct als de backend ze levert.

### GDPR-consent-KPI: server-side aggregatie ontbreekt (steekproef i.p.v. echte telling)
- **Priority**: P2
- **Status**: Open
- **Source**: Claude Code (compliance-robuustheid, 2026-07-10)
- **Context**: De `/gdpr`-KPI's "Kandidaten met consent", de consent-gauge en
  "Anonieme records" worden client-side berekend over de **geladen pagina** van
  `GET /candidates` (page-size 20/50), niet over de hele tenant. De lijst-API
  levert bovendien géén `gdpr_consent_at` en heeft geen consent-filters. Fix
  toegepast: de KPI-teller "totaal" gebruikt nu het echte `meta.total`
  (50.001 op load-test i.p.v. 20), en "met consent" telt `gdpr_consent === true`
  binnen de steekproef, expliciet gelabeld als steekproef ("van N geladen · M
  totaal"). De granted/gauge/anoniem-cijfers blijven dus een **steekproef**.
- **Fix-richting**: backend-endpoint `GET /compliance/consent-stats` (of velden
  op een bestaand analytics-aggregaat) dat server-side telt: totaal, met geldige
  (niet-verlopen) consent, ingetrokken, verlopen, geanonimiseerd — met
  `gdpr_consent_at` in de berekening. Frontend dropt dan de steekproef-heuristiek.

### Pay-equity: gecorrigeerde (regressie-)gap wordt niet berekend
- **Priority**: P2
- **Status**: Open
- **Source**: Claude Code (compliance-robuustheid, 2026-07-10)
- **Context**: De pay-equity-KPI "Gecorrigeerd" toont nu de **ongecorrigeerde**
  gap als proxy, omdat `payEquity.service.ts` alleen `pay_gap_pct` levert (geen
  `adjusted_pay_gap_pct` gecontroleerd voor functie/senioriteit). De hint
  "Gecontroleerd voor functie & senioriteit" is daardoor nog niet waar.
- **Fix-richting**: backend berekent een regressie-gecorrigeerde gap (controle
  voor job-categorie + senioriteit) en levert `adjusted_pay_gap_pct` mee; de
  frontend-normalizer (`useCompliance.ts`) gebruikt dan de echte waarde i.p.v.
  de proxy.

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
- **Status**: ✅ Resolved (2026-06-23)
- **Source**: Kaan
- **Date added**: 2026-05-17
- **Context**: 2026-05-15 hotfix zette publieke registratie dicht via env-var `DISABLE_PUBLIC_REGISTRATION`. Permanent: admin nodigt user uit per email met magic-link (verloopt na 7 dagen), user kiest wachtwoord, koppelt aan bestaande tenant. Per LAUNCH_PLAN.md Sprint 0 expliciet binnen scope, maar nog niet uitgevoerd.
- **✅ Opgelost (2026-06-23)**: token-flow gebouwd — nieuwe tabel `user_invite_tokens` (migratie 038), `inviteUser` geeft een single-use gehashte invite-token i.p.v. een plaintext temp-wachtwoord, `acceptInvite` (auth.service) zet het wachtwoord ÉN `is_active=true`, nieuwe web-pagina `/accept-invite`. Re-invite voor nog-inactieve users toegestaan. LET OP: de mails versturen pas écht als `RESEND_API_KEY` in prod gevuld is (zie 6.2 / Sectie 5.1).

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

---

## Sectie 4: Stagebedrijf-feedback (2026-06-22)

Batch feedback van het stagebedrijf, vastgelegd door Claude Code. Elk item op **P2** (alleen
Kaan promoot). Type-tags: `[BUG]` / `[UX]` / `[FEATURE]`. **Bug-claims zijn nog niet
gereproduceerd.** Bestandsverwijzingen komen uit een read-only codebase-verkenning (2026-06-22)
zodat items meteen oppakbaar zijn. Kaan's eigen, expliciet terecht genoemde hoofdwens:
**menu declutter** (item 4.5).

### 4.1 — Career Page "Test Button #1" bug
- **Priority**: P2
- **Status**: Open — te reproduceren
- **Type**: [BUG]
- **Files**: `apps/web/app/(dashboard)/career-pages/[id]/builder/page.tsx`; knop vermoedelijk in `apps/web/components/career-builder/CanvasBlock.tsx` of `EditPanel.tsx`
- **Context**: Stagebedrijf meldt dat "Test Button #1" een bug heeft. Verkenning kon de exacte knop niet pinpointen. Nodig: welke knop, welk gedrag (klik=niks / fout / verkeerde target).
- **Cross-ref**: Sectie 2 "Career pages per tenant".

### 4.2 — CRM Deals bug
- **Priority**: P2
- **Status**: Open — te reproduceren
- **Type**: [BUG]
- **Files**: `apps/web/app/(dashboard)/crm/page.tsx` (`DealsTab` / `CreateDealDialog`), hook `apps/web/hooks/useCrm.ts` (`useDealsPipeline`)
- **Context**: "Controleer de deals." Concrete suspect: `CreateDealDialog` initialiseert `organizationId = organizations[0]?.id ?? ""`; zonder organisaties kan een deal met lege `organizationId` worden aangemaakt (geen guard/validatie). Reproduceren + bevestigen of dit de gemelde bug is.

### 4.3 — Kandidaat-filtersysteem bug
- **Priority**: P2
- **Status**: Open — te reproduceren
- **Type**: [BUG]
- **Files**: `apps/web/app/(dashboard)/candidates/page.tsx`
- **Context**: Source-filter is case/label-gevoelig; filterchips (o.a. "Behance") matchen mogelijk niet de echte `source`-waarden in de DB → silent 0 resultaten. Repro: welk filter, welk gedrag verwacht vs werkelijk.

### 4.4 — [UX] KPI-cards overal kleiner/dunner
- **Priority**: P2
- **Status**: Open
- **Type**: [UX]
- **Files**: GEEN gedeelde card — 3-4 varianten: `apps/web/components/dashboard/StatsCard.tsx` (text-3xl/p-6), inline `KpiCard` in `apps/web/app/(dashboard)/analytics/page.tsx` (text-2xl/p-4), inline `StatCard` in `apps/web/app/(dashboard)/contracts/page.tsx` (p-5), `apps/web/components/reports/blocks/KpiBlock.tsx` (text-4xl)
- **Context**: Feedback "KPI's overal kleiner en minder dik" komt 4× terug (Dashboard, Analytiek, CRM, Bureau). Aanpak: consolideer naar één compacte gedeelde stat-card en zet alle pagina's daarop — geen losse tweaks per pagina.
- **Cross-ref**: Sectie 2 "DESIGN.md uitrol over bestaande pagina's".

### 4.5 — [UX] Menu declutter (hoofdwens Kaan)
- **Priority**: P2
- **Status**: Open
- **Type**: [UX]
- **Files**: `apps/web/components/layout/Sidebar.tsx` (~24 top-level + ~30 nested items, 6 groepen)
- **Context**: Menu is te druk. Collapse-logica via `children` bestaat al. Aanpak: minder top-level items / secundaire items onder bestaande inklapbare groepen en default ingeklapt. Designkeuze (welke items secundair) → voorstel/akkoord van Kaan nodig vóór uitvoer.

### 4.6 — [UX] Achtergrond witter
- **Priority**: P2
- **Status**: Open
- **Type**: [UX]
- **Files**: `apps/web/app/(dashboard)/layout.tsx` (regel ~40)
- **Context**: 1-regel: `bg-zinc-50` → `bg-white` (of `bg-zinc-100` voor net niet helemaal puur wit).

### 4.7 — [UX] Klantportaal-link responsive maken
- **Priority**: P2
- **Status**: Open
- **Type**: [UX]
- **Files**: `apps/web/app/(dashboard)/portal-links/page.tsx`
- **Context**: Op het ene scherm netjes, op een ander veel te groot/onleesbaar. De link/card heeft geen max-width/clamp. Voeg responsive breedte-constraint toe zodat hij op elk scherm past.

### 4.8 — [FEATURE/UX] Dashboard export (PDF/Excel/CSV) + breadcrumb
- **Priority**: P2
- **Status**: Open
- **Type**: [FEATURE] (export) + [UX] (breadcrumb)
- **Files**: `apps/web/app/(dashboard)/dashboard/page.tsx`. Hergebruik: `eventsToCsv` in `apps/web/components/compliance/AuditTrailViewer.tsx` (CSV) + `downloadInvoicePdf` blob-patroon (`apps/web/app/(dashboard)/invoices/[id]/page.tsx`, PDF). Breadcrumb bestaat niet (alleen `apps/web/components/layout/PageHeader.tsx`).
- **Context**: Export naar PDF/Excel/CSV (belangrijk voor analytiek→rapport) + breadcrumb-navigatie. Export bestaat nog nergens generiek.
- **Cross-ref**: Sectie 2 "Reports module fix".

### 4.9 — [UX/FEATURE] Analytiek: filter + (tussen)zoekbalk + KPI kleiner
- **Priority**: P2
- **Status**: Open
- **Type**: [UX] + [FEATURE]
- **Files**: `apps/web/app/(dashboard)/analytics/page.tsx` (geen filter/zoek nu). Hergebruik `apps/web/components/jobs/JobsFilterBar.tsx` / `apps/web/components/reports/FilterBuilder.tsx`. KPI-grootte = item 4.4.
- **Context**: KPI's iets kleiner + een filter + een tussenzoekbalk toevoegen.
- **Cross-ref**: Sectie 2 "Analytics module (echte data ipv mock)".

### 4.10 — [UX] Skills: empty-state bij "Top trending skills"
- **Priority**: P2
- **Status**: Open
- **Type**: [UX]
- **Files**: `apps/web/app/(dashboard)/skills/page.tsx` (`TrendingTab`)
- **Context**: "Top trending skills" toont niets zonder uitleg. Empty-state is i18n-key-gebaseerd (`skills.trending.noTrending`) en lijkt leeg. Zet/herstel de tekst (bijv. "geen skills voor deze filter") zodat leeg ≠ kapot. ("Geen skills nog toegevoegd" elders is een correcte empty-state, geen bug.)

### 4.11 — [UX/FEATURE] Pipeline/Kandidaat: datum + client-filter
- **Priority**: P2
- **Status**: Open — deels al aanwezig
- **Type**: [UX] + [FEATURE]
- **Files**: `apps/web/components/pipeline/KanbanCard.tsx` (toont al `applied_at`, relatief), pipeline-pagina `apps/web/app/(dashboard)/jobs/[id]/pipeline/page.tsx`
- **Context**: Sollicitatiedatum wordt AL relatief getoond. Open: client-filter + overzicht ontbreken; mogelijk wil men absolute datum. Te bevestigen wat precies.

### 4.12 — [UX] AI Suite (Sourcing Agent) opschonen
- **Priority**: P2
- **Status**: Open — interpretatie te bevestigen
- **Type**: [UX]
- **Files**: `apps/web/app/(dashboard)/sourcing-agent/page.tsx`
- **Context**: Vacaturebank-verbindknop "op één lijn", maximaal aantal tonen tegen clutter, sub-zoekbalk in de pipeline. Bevestigen: exacte knop/scherm (welke is de "vacaturebank-verbindknop").

### 4.13 — [UX/FEATURE] CRM minimaliseren + overzicht per klant
- **Priority**: P2
- **Status**: Open
- **Type**: [UX] + [FEATURE]
- **Files**: `apps/web/app/(dashboard)/crm/page.tsx`
- **Context**: CRM minimaliseren/opschonen + nieuw overzicht per klant: hoeveel kandidaten per locatie geplaatst. "Placed per location" bestaat nog niet.
- **Cross-ref**: Sectie 2 "Clients/CRM module".

### 4.14 — [UX/FEATURE] Communicatie/kanalen: delete + flags + WhatsApp emoji
- **Priority**: P2
- **Status**: Open — interpretatie te bevestigen
- **Type**: [UX] + [FEATURE]
- **Files**: `apps/web/app/(dashboard)/inbox/page.tsx` (archive bestaat — geen delete; pin+labels ≈ flags). WhatsApp-composer in `apps/web/app/(dashboard)/candidates/[id]/page.tsx` (nu plain textarea, geen emoji).
- **Context**: ("Reactieve indeling" geïnterpreteerd als Communicatie/kanalen.) Mails kunnen verwijderen + flags; WhatsApp-bericht naar sollicitant: emoji-picker toevoegen.

### 4.15 — [UX] Taal-switch verbergen in Instellingen
- **Priority**: P2
- **Status**: Open
- **Type**: [UX]
- **Files**: `apps/web/components/i18n/LanguageSwitcher.tsx` (nu gerenderd in `apps/web/components/layout/Sidebar.tsx`, regel ~629) → naar `apps/web/app/(dashboard)/settings/page.tsx`
- **Context**: NL/EN-switch uit de sidebar halen en in de instellingen onderbrengen.

### 4.16 — [UX] "Nurture Sequence" hernoemen
- **Priority**: P2
- **Status**: Open — nieuwe naam te kiezen
- **Type**: [UX]
- **Files**: i18n-key `outreach.sequences.title` (gebruikt in `apps/web/app/(dashboard)/outreach/sequences/page.tsx`)
- **Context**: Heet al "Nurture Sequence" (niet "Nature"); naam wordt als moeilijk ervaren. Eenvoudiger naam kiezen en de i18n-string aanpassen.

### 4.17 — [FEATURE] Logboek / wie-deed-wat / inzicht bij verwijderen + backups
- **Priority**: P2
- **Status**: Open — infra bestaat grotendeels al
- **Type**: [FEATURE]
- **Files**: BESTAAT AL: `apps/api/src/lib/audit.ts` (WORM-audit), `apps/api/src/lib/auditActions.ts`, web `apps/web/app/(dashboard)/compliance/audit-events/page.tsx` (zoek/diff/CSV-export + per-kandidaat audit-link)
- **Context**: Logboek + activiteit-tracing ("wie deed wat", inzicht bij per ongeluk verwijderen) is grotendeels al gebouwd. Echte gaten: vindbaarheid (zit onder Compliance, niet als "Statistiek van gebruikers"), evt. een per-gebruiker-activiteitenview, en een backup/herstel-strategie voor ongelukkige verwijderingen.
- **Cross-ref**: Sectie 2 "Audit logs".

### 4.18 — [FEATURE] Systeem-hulp / uitleg overal
- **Priority**: P2
- **Status**: Open
- **Type**: [FEATURE]
- **Files**: `apps/web/components/ui/tooltip.tsx` (Radix-tooltip bestaat, wordt nauwelijks gebruikt)
- **Context**: Per onderdeel uitleg: wat is wat, wat kun je ermee, hoe doe je het. Bouw een help/tooltip-laag (en evt. help-overlay per scherm) bovenop de bestaande tooltip-primitive.

### Open interpretaties (te bevestigen door Kaan)
- "Reactieve indeling" = Communicatie/kanalen (item 4.14)?
- AI-Suite: welke knop is de "vacaturebank-verbindknop" en welk scherm precies (4.12)?
- Bedoeling "tussenzoekbalk" in Analytiek (4.9): secundaire filter/zoekbalk boven de resultaten?
- Nieuwe naam voor "Nurture Sequence" (4.16).
- Career-page "Test Button #1": exacte knop + verwacht gedrag (4.1).
- Kandidaat-filter: welk filter, welk gedrag (4.3).
- Pipeline: absolute datum gewenst en/of client-filter (4.11)?

---

## Sectie 5: Evaluatie-feedback Kaan (2026-06-23)

Feedback tijdens live doorklikken op het load-test-account. Default P2.

### 5.1 — [FEATURE] E-mailintegratie ook zonder Outlook/Gmail (eigen domein via DNS/SMTP)
- **Priority**: P2
- **Status**: Open
- **Type**: [FEATURE]
- **Context**: Naast OAuth-koppeling met Outlook/Gmail ook een optie voor klanten die geen van beide gebruiken: verzenden vanaf het eigen domein via DNS-records (SPF/DKIM/DMARC-verificatie) en/of eigen SMTP-credentials. Zo kan elk bureau e-mail vanuit zijn eigen domein versturen, ongeacht mailprovider.
- **Cross-ref**: Sectie 2 "Integraties (Gmail/Outlook, Calendar, jobboards)".

### 5.2 — [UX] CRM Deals: sub-zoekbalk + filters
- **Priority**: P2
- **Status**: Open
- **Type**: [UX]
- **Files**: `apps/web/app/(dashboard)/crm/page.tsx` (DealsTab)
- **Context**: Op het deals-kanban-bord een zoekbalk (deal-titel/organisatie) + filters (fase, recruiter, waarde) om snel te kunnen filteren.

### 5.3 — [UX] CRM Contacten: zoekbalk (naam / bedrijf / e-mail)
- **Priority**: P2
- **Status**: Open
- **Type**: [UX]
- **Files**: `apps/web/app/(dashboard)/crm/page.tsx` (ContactsTab)
- **Context**: De contactenlijst heeft nu alleen een organisatie-dropdown. Voeg een vrije zoekbalk toe die filtert op contactnaam, bedrijf én e-mailadres.

---

## Sectie 6: Go-live blokkers (2026-06-23)

Uit de multi-agent go-live-audit. De 🔴-blokkers zijn deze sessie gefixt (zie "Opgelost"); de rest is 🟡 (vóór betalende klant) en blijft Open op P2 tot Kaan promoot.

### 6.1 — [TASK] Load-test tenant verwijderen uit prod-DB (UITGESTELD)
- **Priority**: P2
- **Status**: Open — bewust uitgesteld (stagebedrijf logt nog in op dit account)
- **Type**: [TASK]
- **Context**: Tenant `10ad7e57-0000-4000-8000-000000000001` ('load-test', ~50k kandidaten + login `admin@load-test.kdmn.nl`) staat in de productie-DB. Verwijderen vlak vóór de échte go-live. Maak eerst een backup (`sudo /opt/talentflow/infra/backup.sh`), draai dan `apps/api/scripts/cleanup-load-test.sql` (data) + de full-removal SQL (users + tenant + refresh_tokens) met before/after row-counts. Roteer daarna de gepubliceerde `LoadTest!2026`-credential. Load-tests voortaan op een aparte wegwerp-DB.

### 6.2 — [TASK] Resterende go-live-items vóór eerste betalende klant (🟡)
- **Priority**: P2
- **Status**: Open
- **Type**: [TASK]
- **Context**: Nog te doen vóór monetisatie: billing/Stripe (geen betaalpad — cross-ref Sectie 3), wachtwoord-reset afmaken (stub → token-flow, cross-ref Sectie 2), rate-limit op `/auth/login`, `/health` echte DB+Redis-check i.p.v. liveness-only, externe uptime-monitor, en de mock-features die in prod succes faken (Sourcing Agent mock-kandidaten, Voice belt niet echt, job-board posten faket, Hiring-Manager swipe slikt schrijf-fouten in, WhatsApp template mock-approve).
- **Update 2026-06-29**: `ANTHROPIC_API_KEY` + `RESEND_API_KEY` geverifieerd in prod — **beide leeg**. Gevolg: AI-features geven 500 (CV-parsing e.d.), invite/reset-mails worden niet verzonden. Resend bewust uitgesteld (kdmn.nl-afzender = €20/mnd voor een 2e domein; gebruik de gratis kdmnprojecten.com bij activeren). De stale/kapotte CI `deploy.yml` is achterhaald — er is nu een werkend git-pull-deploypad via een SSH deploy-key (zie het infra-blok onderaan deze sectie).

### Opgelost deze sessie (2026-06-23) — 🔴 go-live-blokkers
- **Tenant-isolatie**: expliciete `tenant_id`-filters toegevoegd aan ~33 lekkende queries in `billing/invoicing`, `commissions`, `accounting` (incl. functionele bug in `pickPrimaryIntegration`), `forecasting`, `skills` en `pipeline.createStage` — cross-tenant lezen/schrijven van financiële + kandidaatdata gedicht (RLS blijft inert onder de owner-rol; non-owner-cutover blijft aparte L-taak in Sectie 2).
- **2FA-login lockout**: web verwerkt nu `requires_2fa`/`partial_token` + nieuwe `/2fa`-challenge-pagina.
- **Logout**: `Sidebar.handleLogout` roept nu `/auth/logout` + wist React-Query-cache → server-sessie wordt echt ingetrokken (fixt de "automatisch weer ingelogd"-bug).
- **Invite-flow**: migratie `038_user_invite_tokens.sql` + token-flow (`inviteUser` → `acceptInvite` zet wachtwoord + `is_active=true`) + `/accept-invite`-pagina; geen plaintext-wachtwoord meer; re-invite voor inactieve users toegestaan.
- **Sentry**: compose env-naam `SENTRY_DSN` → `SENTRY_DSN_API` (api + api-worker) zodat API-errors echt gereporteerd worden zodra de DSN gevuld is.

### Opgelost 2026-06-28/29 — infra, backups & deploy-pad
- **Offsite backups LIVE** ✅: nachtelijke Postgres-dump → Cloudflare R2 (`infra/backup.sh`) + wekelijkse `infra/restore-test.sh`, allebei **groen getest** (cron op de VPS: 03:00 backup, zondag 04:00 restore-test; 30-dagen retentie in R2). Optionele MinIO→R2-mirror voor geüploade CV's als scaffold toegevoegd (`BACKUP_MINIO_ENABLED`). Dekt deels 4.17 ("backup/herstel-strategie").
- **backup-scripts gefixt** ✅: lazen het hele compose-`.env` via bash `source` → brak op `RESEND_FROM` (spatie/`<>`); lezen nu alleen de benodigde vars veilig uit.
- **Deploy-pad gerepareerd** ✅: VPS-PAT was dood → SSH **deploy-key** opgezet, git-remote op SSH, `git pull` werkt weer en de VPS is in sync met GitHub. `npm run migrate` faalde in prod (geen `tsx` in de prod-image) → `migrate:prod` (= `node dist/db/migrate.js`) toegevoegd + `infra/DEPLOY_KDMN.md` bijgewerkt.
- **Nog open (Kaan's kant)**: ~~Sentry-DSN invullen~~ (✅ gedaan 2026-06-29, zie hieronder), Resend-key (zie 5.1/6.2), optioneel een faal-alert-webhook voor backups + Hetzner "Backups" aanzetten voor full-system DR.

### Opgelost 2026-06-29 — stagebedrijf-UX, career-pages & Sentry
- **Bugs**: 4.3 kandidaat-filter (chips uit echte data — dode "Behance" weg, "Career Fair"/"Website" erbij); 4.2 CRM-deals (bij 0 klanten nu duidelijke uitleg + verwijzing naar de Organisaties-tab i.p.v. een doodlopende uitgeschakelde knop).
- **Career-pages (4.1 + Sectie 2 "Career pages per tenant")**: builder-save gerepareerd — de ontbrekende backend-endpoints `/:id/blocks`, `/:id/publish`, `/:id/unpublish` toegevoegd (blocks in `config.blocks`) + de publieke get gaf de verkeerde vorm → nu `{career_page, jobs, company_name}`. "Opslaan niet gelukt" en de publieke-pagina-error zijn weg. Block-voor-block publiek renderen blijft een diepere uitbreiding (publieke pagina is template-gedreven).
- **Menu (4.5 — hoofdwens)**: zijbalk herbouwd — weinig dagelijkse items + inklapbare secties (standaard dicht), recruiter-woorden (Sourcing, Benaderen, Plaatsingen, Beoordelaars, Opvolgreeks, Berichten), technisch onder "Systeem". Persona/Taal/Uitloggen + Instellingen verhuisd naar een avatar-dropdown rechtsboven (4.15).
- **UX-polish**: 4.4 KPI-cards compacter (StatsCard); 4.6 achtergrond witter; 4.7 klantportaal-lijst nette max-breedte; 4.10 skills empty-state op de trending-tabel; 4.16 "Nurture sequences" → "Opvolgreeks". 5.2/5.3 CRM-zoekbalken bleken al gebouwd. Job-boards-catalogus: gelijke-hoogte kaarten + grid/lijst-schakelaar.
- **Sentry LIVE** ✅: DSN's (api + web, EU-datacenter) ingevuld + gedeployd, beide kanten actief, test-error bewezen. Plus: PG-foutcode `22P02` (verkeerd formaat, bv. een niet-UUID) geeft nu **400 i.p.v. 500** (globale error-handler) — minder Sentry-ruis + nettere API.
- **Nog open uit Sectie 4** (interpretatie/grotere features): 4.11 (pipeline absolute datum/client-filter), 4.12 (AI-Suite opschonen), 4.13 (CRM per-klant-overzicht), 4.14 (mail verwijderen + WhatsApp-emoji), 4.17/4.18 (logboek-vindbaarheid, help-laag), 4.8/4.9 (dashboard-export, analytiek-filter).

### Opgelost 2026-06-29 — i18n: 8 ontbrekende namespaces (rauwe keys)
- **Root cause**: 8 namespaces werden in de code via `useTranslation(...)` aangeroepen zonder dat het vertaalbestand ooit bestond (nooit in git, ook niet in de wave3-stash). Daardoor toonden die pagina's rauwe sleutels (`hub.catalog.title`, `board.notConnected`, …). Op de job-boards-pagina viel dit op (door Kaan gemeld).
- **Gefixt**: alle nl+en catalogs aangemaakt en geregistreerd in `packages/i18n/src/index.ts` (i18n-package typecheckt schoon; verificatiescript: elke statisch gebruikte key bestaat). Namespaces + key-aantallen: jobBoards 94, settingsCore 153, settingsSecurity 162, settingsAccess 96, settingsAdvanced 94, miscHome 86, miscDev 121, miscPortals 168.
- **Live nu** (commit ca3e7fa, gedeployd + bundle-geverifieerd): **job-boards** (incl. truncate op grid-kaarttitel zodat de status-badge niet meer over de banknaam valt) en **portal-links** — die gebruiken de namespaces al in HEAD.
- **Klaar maar nog dormant**: settingsCore/Security/Access/Advanced, miscHome, miscDev worden pas in HEAD aangeroepen zodra de **i18n-wave3-WIP** (stash `wip: i18n wave3`, heeft losse tsc-fouten in o.a. timesheets) wordt afgerond/gecommit. De vertalingen activeren dan zonder extra werk.
- **[UX] Hardcoded strings buiten i18n** (P2, geobserveerd door de namespace-agents, niet aangeraakt): `settings/branding` (Accent kleur, Merknaam, e-mail-footer, Live preview, Opslaan), `settings/talent-fit` (uitleg-blok, "Train opnieuw", "Validatie-metrics"), `settings/availability` ("Terug naar instellingen", regel 188), `workflows` (wizard-stappen, PageHeader, stats, TRIGGER/ACTION-labels). Deze tonen geen rauwe keys (gewoon hardcoded NL) maar zijn nog niet vertaalbaar.

### Opgelost 2026-06-29 — Sectie 4 stagebedrijf-features (8 stuks, commit 13ac55b, LIVE + geverifieerd)
- **4.8 Dashboard-export**: "Exporteren"-knop in de PageHeader → CSV met KPI-snapshot + top-vacatures. Nieuwe herbruikbare `apps/web/lib/downloadHelper.ts` (downloadBlob/toCsv/downloadCsv, UTF-8 BOM voor Excel). Breadcrumb bewust niet toegevoegd (dashboard = root). PDF bewust niet client-side (CSV is de waarde).
- **4.9 Analytiek**: zoekbalk op de Recruiters-tab (filtert rijen op naam) + `(?)`-hints op de 6 overzicht-KPI's. **Bewust niet**: datum/dimensie-filter op de overzicht-KPI's — die data is server-side voor-geaggregeerd, dus client-side filteren zou nep zijn. Een echt datum/recruiter/bron-filter vereist query-params op `/analytics/*` (backend) → **nieuw P2-item hieronder**.
- **4.11 Pipeline**: kandidaat-zoekbalk (naam/e-mail, client-side) + "Exacte datum"-toggle (relatief ↔ absoluut, met `title`-tooltip). **Bewust niet**: client/organisatie-filter — sollicitaties hebben **geen** koppeling naar een klant/organisatie in het datamodel (jobs hebben geen org-FK) → **nieuw P2-item hieronder**.
- **4.12 Sourcing (AI-Suite)**: findings-inbox kreeg een zoekbalk (naam/functie/bedrijf/skill) + cap van 6 kandidaten per brief met "Toon alle N (+x)"-toggle tegen clutter.
- **4.13 CRM**: plaatsingen-per-klant op de klantkaart (groene badge "N plaatsingen"), client-side berekend uit **gewonnen deals** (`stage='gewonnen'`). Per-locatie niet meegenomen: deals dragen geen locatie in de client-data.
- **4.14 Inbox + WhatsApp**: (a) thread **verwijderen** — soft-delete (migratie `039_inbox_thread_soft_delete.sql`: `deleted_at` + partial index; `deleteThread`-service + `DELETE /inbox/threads/:id` + audit-log `thread_deleted`; `listThreads` filtert `deleted_at IS NULL`). Migratie op prod toegepast vóór container-swap. (b) **emoji-picker** in de composer (16 emoji's, geen extra dependency; alleen waar vrije tekst mag).
- **4.17 Audit-vindbaarheid**: top-level "Activiteit" (icoon Activity) in de Systeem-sectie van het menu → `/compliance/audit-events` met één klik (was 3 klikken diep onder "AVG / Privacy › WORM-audit"; die nested link bleef staan).
- **4.18 Help/uitleg-laag**: herbruikbare `apps/web/components/ui/HelpHint.tsx` (`(?)` + Radix-tooltip, eigen TooltipProvider conform codebase-patroon), toegepast op de 4 dashboard-KPI's en de 6 analytiek-KPI's. Uitbreiden naar pipeline-/job-headers is een vervolg.
- **Verificatie**: web+api `tsc` schoon, lokale `next build` groen, gedeployd (build → migratie → up -d), login 200, nieuwe strings in de prod-bundle, API gezond zonder kolom-fouten.
- **WIP-let-op**: de i18n-wave3-werkkopie staat in **twee stashes** (`stash@{0}` feature-batch-base, `stash@{1}` originele wip). Alleen `inbox/page.tsx` overlapt met deze batch → bij `git stash pop` één merge-conflict te verwachten (behoud zowel de delete-knop als de i18n-migratie).

### Nieuwe P2-items uit deze batch (gevonden tijdens werk)
- **[FEATURE] Analytiek server-side filtering** — query-params (`date_from/to`, `recruiter_id`, `source`, `stage`) op `/analytics/*` + dynamische `WHERE` in de aggregaties, zodat datum/dimensie-filters op de overzicht-KPI's echt werken (nu alleen recruiter-rij-zoek client-side).
- **[FEATURE] Job ↔ klant/organisatie-koppeling** — `jobs.organization_id` (FK naar `organizations`) zodat de pipeline op klant gefilterd kan worden en plaatsingen per klant niet via CRM-deals hoeven (datamodel-uitbreiding + migratie + UI).
- **[UX] HelpHint uitrollen** — dezelfde tooltip op pipeline-fase-headers, job-detail (health/days/predicted) en chart-titels in analytiek.

### Opgelost 2026-06-30 — crash op kandidaat-detailpagina (witte pagina bij elke kandidaat)
- **Symptoom**: op een kandidaat klikken → "Er ging iets mis" (route-error). Twee gestapelde root causes (de eerste maskeerde de tweede):
  1. `useCommunications` gaf het backend-wrapper-object `{ data: [...] }` rauw door; de detailpagina deed `communications.map` → `TypeError: map is not a function`. Nu altijd de array uitpakken (zoals `useInbox` al deed). Fix: `apps/web/hooks/useCommunications.ts`.
  2. `/candidates/:id/skill-profile` levert de skills onder **`esco_skills`** (+ total_skills, skill_categories), maar `SkillProfileEditor` las `data.skills.length` → `undefined.length`. De frontend- en API-`CandidateSkillProfile`-types waren uit sync. Fix: `useCandidateSkillProfile` normaliseert `esco_skills → skills` (ProfileSkill[], tolerant) + de editor leest defensief. Files: `apps/web/hooks/useSkills.ts`, `apps/web/components/skills/SkillProfileEditor.tsx`.
- **Bijvangst**: `GET /candidates/:id/duplicates` gaf 404 (route bestond niet, alleen de service). Route + controller-handler gewired op `findDuplicatesForCandidate`. Files: `apps/api/src/modules/candidates/candidates.{controller,router}.ts`.
- **Verificatie**: web+api tsc schoon; gedeployd (commits 51bb280 + f6cc16d); live in de browser getest (Playwright, load-test tenant) — kandidaat-detail laadt nu met **0 console-errors**, zowel voor een lege kandidaat als één met skills.
- **[BUG] open vervolg** (P2): de **save-kant** van SkillProfileEditor (`useUpdateCandidateSkillProfile`) gebruikt mogelijk nog de oude `skills`-vorm i.p.v. `esco_skills`; opslaan van skill-wijzigingen kon niet end-to-end geverifieerd worden. Read/render is gefixt; write nalopen.

### Opgelost 2026-06-30 — pipeline-lijstweergave + job↔klant-koppeling (P2)
- **Pipeline-lijstweergave** (commit 845f748, LIVE): board/lijst-toggle op de per-vacature pipeline; lijst = tabel per sollicitant met de fase als dropdown (lijst-equivalent van slepen → zelfde move-mutatie), score + datum. Zoek + exacte-datum-toggle gelden voor beide weergaven. Geverifieerd op een vacature met 353 sollicitanten (0 errors).
- **Job ↔ klant/organisatie-koppeling** (commit 9143dc3, LIVE + geverifieerd): migratie `040_jobs_organization_id.sql` (`jobs.organization_id` FK → organizations + index); jobs.service kolom-whitelist + list/detail-queries geven `organization_id` (+ `organization_name` via LEFT JOIN); contracts JobRow/ListItem/Create uitgebreid; JobForm krijgt een klant-picker; pipeline-overzicht krijgt een klantfilter + toont de klantnaam. Live getest: klantfilter filtert correct (Org 1 → alleen Org-1-vacatures); create + update accepteren `organization_id` (PATCH 200). Dit ontgrendelt het eerdere P2-item "pipeline op klant filteren".
- **[UX] open vervolg** (P2): er is nog geen UI-affordance om de klant van een **bestaande** vacature te wijzigen (alleen bij aanmaken via JobForm; de API/update ondersteunt het wel — `useUpdateJob` + `organization_id`). Klein vervolg: een inline klant-Select op de job-detailpagina (JobDetailHeader). Plaatsingen-per-klant kan nu ook rechtstreeks uit jobs↔organizations i.p.v. CRM-deals (4.13 kan later daarop overstappen).

### Opgelost 2026-06-30 — dashboard recente activiteit inkorten + volledig logboek
- **Probleem (door Kaan gemeld)**: het "Recente activiteit"-blok op het dashboard liep heel lang door (toonde tot 20 items).
- **Gefixt** (commit 3953c07, LIVE + geverifieerd): dashboard toont nu max **6** items + een **"Alle activiteit"-link** → nieuwe pagina `/activity` (volledig logboek). Nieuw paginated endpoint `GET /dashboard/activity` (page/limit) + `useActivityLog`-hook + de `/activity`-pagina (zelfde feed uit de `activities`-tabel, 25/pagina, prev/next). Live getest: dashboard ≤6 + link; /activity toont 2006 gebeurtenissen over 81 pagina's, paginatie werkt, 0 console-errors.
- **Let op (naamgeving)**: er zijn nu twee "activiteit"-ingangen — `/activity` (vriendelijke feed: sollicitaties/plaatsingen/vacatures) en het Systeem-menu-item "Activiteit" → `/compliance/audit-events` (WORM-compliance-audit). Bewust gescheiden (andere databron); eventueel later in naamgeving verduidelijken.
- **Vervolg (commit c764de7, LIVE)**: "Alle activiteit"-link verplaatst naar de kaart-header rechtsboven (zoals Top jobs) + **CSV-export** op /activity (nieuw endpoint `GET /dashboard/activity/export`, volledige feed tot 10000 rijen).

### Opgelost 2026-06-30 — analytiek server-side filtering (periode + recruiter)
- **Gefixt** (commit 9f3ee82, LIVE + geverifieerd): alle `/analytics/*`-endpoints accepteren nu `?from=&to=&recruiter_id=` met dynamische WHERE. Een **filterbalk** (periode-presets: Deze maand / Laatste 3 / 6 maanden / Dit jaar / Alles + recruiter-keuze) staat boven de tabs en geldt voor overview, funnel, bronnen en de recruiter-tabel.
- **Correct ontwerp**: periode-cijfers (sollicitaties, aangenomen) volgen het bereik; **momentopname-KPI's** (open vacatures nu, actieve recruiters nu) blijven bewust "huidig". Per-metric default behouden (geen filter = huidig gedrag). Recruiter-scope via `jobs.recruiter_id`; kandidaat/bron-scope via `applications→jobs`. Trends houden hun eigen tijdvenster, volgen alleen de recruiter.
- **Geverifieerd**: periode-filter verandert de cijfers correct (sollicitaties 14549 deze maand → 120600 all-time), open vacatures blijft 209 (momentopname). Recruiter-filter scopt (recruiters-tabel → 1 rij). Filterbalk rendert live, 0 console-errors.

### Opgelost 2026-06-30 — HelpHint uitgerold + i18n-wave3-WIP afgerond
- **HelpHint** (commit 74cec2f, LIVE): `(?)`-tooltips toegevoegd op de analytics funnel- + bronnen-chart-titels, de job-detail Health/Open-sinds/Verwachte-afronding, en de pipeline-fase-teller (kandidaten in deze fase + sleep-uitleg). i18n nl+en.
- **i18n-wave3 afgerond** (commit 460e207, LIVE + geverifieerd): de geparkeerde WIP-stash teruggehaald en gedeployd → **32 pagina's** gemigreerd naar i18n, waarmee de 6 eerder dormante namespaces (settingsCore/Security/Access/Advanced, miscHome/Dev/Portals) nu **live actief** zijn. `inbox/page.tsx` werd schoon auto-gemerged (mijn delete-feature + miscInbox-migratie). Verificatie: web tsc schoon, lokale `next build` groen, een eigen key-coverage-script bevestigt dat **alle 41 gecheckte pagina's** hun keys in de juiste namespace hebben (geen rauwe keys); live op /settings rendert echte teksten (Settings/Security/Branding…), 0 console-errors.
- **[BUG] open follow-up** (P2): `timesheets/page.tsx` bewust teruggezet naar HEAD — die WIP-migratie was kapot (verkeerde namespace `miscInbox` i.p.v. een timesheets-namespace, `(t)=>`-shadow van de vertaal-`t`, ontbrekende `WEEKDAYS_NL`, `.label` op een `{cls}`-object). Pagina werkt (hardcoded NL); aparte nette migratie nodig.
- **Resterende stash** (`stash@{0}`: "wip: i18n wave3 + wave2-wiring"): bevat de originele WIP incl. 5 "wave2-wiring"-bestanden (candidates/[id], interviews/[id], job-boards, portal-links, skills — deels al gedeployd via ca3e7fa). Als vangnet bewaard; kan later worden nagelopen/gedropt.

---

## Sectie 5: Concurrentie-onderzoek & strategische positionering (2026-06-30)

> Status: **strategie-voorstel, nog niets gebouwd.** Alle items P2; Kaan promoot. Deze sectie
> legt vast wat 4 NL/EU-concurrenten beter doen, waar de marktgap ligt, en welke niche TalentFlow
> zou moeten winnen. Opdracht Kaan: "bouw iets niche en het beste in dat niche; solo te onderhouden;
> iets waar ik over jaren nog achter sta; en dat realistisch €1000s/maand oplevert. Niet alles
> erop en eraan." De **beslissing over de niche-richting (5.5/5.9) ligt bij Kaan** voordat er gebouwd wordt.

### 5.0 Methode & bronnen
Vijf web-grounded research-agents (juni 2026): Recruitee, Carerix, OTYS, RecruitNow + een marktbrede
gap-analyse. Bronnen: officiële sites, recruitmenttech.nl (RT25-benchmark), werf-en.nl, flexnieuws.nl,
G2/Capterra, EU AI Act-juridische bronnen, Rijksoverheid/KVK (Wet DBA). Daarna geverifieerd tegen de
TalentFlow-codebase (niet aangenomen). *(Perplexity-tool gaf 401/ongeldige key; agents draaiden op
WebSearch/WebFetch — dekking compleet, maar Perplexity-key fixen voor diepere review-sentiment-runs.)*

### 5.1 Wat de concurrenten beter doen
- **Recruitee (Tellent)** — corporate/in-house, SMB. **Beter dan wij:** UX/Kanban-polish (categorie-benchmark,
  "productief in dagen"); **CareersHub** no-code career-site + Google for Jobs-syndicatie + careers-analytics.
  Zwak: geen agency/uitzend, geen back-office, AI alleen assisterend. Prijs ~€301/mo+ (per job-slot, unlimited users).
- **Carerix (PIXID)** — agency/uitzend, BeNeLux-incumbent. **Beter dan wij:** front-to-back staffing-diepte +
  **AFAS/Exact-payroll-ecosysteem** (Solid Online-connector); relatie-CRM/marketing-automation; enterprise-referenties
  (Randstad/Adecco). Zwak: dated UI (deels opgefrist "Cx5Color"), AI laat + **add-on-tax** (theMatchBox/MrWork/Carv apart),
  opaak quote-only, 0 onafhankelijke reviews.
- **OTYS (Mysolution)** — alle segmenten, NL, ~25 jaar. **Beter dan wij:** matching-stack Actonomy + Textkernel
  (semantisch + CV-parsing); open REST-API/marketplace (200+); modulariteit over hele funnel. Zwak: implementatie-pijn,
  "te complex/traag", betaalde support, €2.750/user/jaar.
- **RecruitNow (Cockpit X)** — uitzend/flex, NL, snel groeiend. **Beter dan wij:** **Cockpit X agentic AI** (named agents
  Fenne = AI-recruiter die over WhatsApp screent, Sem = leads), usage-based geprijsd; WhatsApp-native (NPS +5, reactietijd -50%);
  10 releases/jaar. Zwak: **géén native back-office** (alles via AFAS Flex/Easyflex), prijs-kwaliteit 3.6/5, matching list-based.

NL-gebruikersbenchmark RT25 2026 (hoe hoger hoe beter): Recruition 4.41, ForceFlow 4.27, Byner 4.14, Ubeeo 3.93,
Carerix 3.88, OTYS 3.54, Recruitee 3.33. → de NL-markt is gefragmenteerd; veel kleine lokale winnaars = ruimte.

### 5.2 Wat TalentFlow al beter/uniek doet (geverifieerd in code)
- **All-in-one incl. native back-office**: contracts, timesheets, invoices, commissions + accounting-connectors
  (Exact Online, Twinfield, SnelStart). → verder dan RecruitNow (front-office only).
- **Agentic sourcing-agent** aanwezig (`sourcing/searchAgent.service.ts`) → voor op Recruitee/Carerix/OTYS (assisterend).
- **Omni-channel inbox + WhatsApp + voice/calls** → Carerix-niveau, beter dan Recruitee.
- **Compliance/AVG + EU AI Act-fundament**: `aiDisclosure.ts` (NL-transparantietekst), `aiEvents.ts` (logging),
  `matchExplanation.ts`, DEI-funnel, pay-equity, WhatsApp-consent → fundament dat alle 4 incumbenten missen.
- **NL job-board-connectors**: Indeed, LinkedIn, StepStone, Broadbean, Nationale Vacaturebank, Werkzoeken, Jobbird, Jobs.nl.
- **Moderne stack + transparante prijs mogelijk** (tegenover opaak/add-on-tax).

### 5.3 Echte gaps van TalentFlow (geverifieerd)
- **UX/looks** — clutter, dichte KPI's, te groot menu (zie ook Sectie 4 stagebedrijf-feedback). Grootste zichtbare gat.
- **Fasensysteem ondiep** — `cao` is een vrij tekstveld (max 120) + `wtza_compliant`-vlag; **geen** echte fase A/B/C-engine,
  géén ketenregeling, géén ABU/NBBU-automatiek.
- **Staffing-payroll-koppelingen ontbreken** — alleen boekhoud-connectors; **geen** AFAS (Flex), Nmbrs, Easyflex/HelloFlex.
- **Career-site/multiposting-polish** — builder bestaat, maar niet bewezen op CareersHub-niveau (Google for Jobs, careers-analytics).

### 5.4 De marktgap (kans)
De markt splitst hard in **corporate** (Greenhouse/Ashby/Recruitee) vs **agency/uitzend** (Carerix/OTYS/RecruitNow/Bullhorn);
een product dat beide wil zijn "wint geen van beide". Onbezette plek: **een AI-native, Nederlands-eerst recruitment-systeem
voor de bureau-kant, met agentic automatisering + self-serve analytics + AVG/AI-Act ingebouwd, tegen transparante all-in-prijs.**
Incumbenten zijn daar dated (Carerix/OTYS), missen back-office (RecruitNow) of zijn corporate/Engels (Recruitee/Ashby).

### 5.5 Niche-positionering — 3 opties met echte trade-offs
**Optie A — Moderne ATS+CRM voor kleine/boutique NL-bureaus (W&S + lichte detachering, 1-15 koppen).**
Best-in-niche op: UX/snelheid, AI-screening/matching, omnichannel (WhatsApp), transparante all-in-prijs, dag-1 onboarding.
Bewust NIET: eigen payroll/CAO/fase-engine (koppel i.p.v. bezit). Monetisatie: veel kleine bureaus × €200-400/mo
(10-20 klanten = €2-8k/mo). Solo-houdbaar: **ja** (geen compliance-tredmolen). Trade-off: je raakt de zware uitzenders
(die fase/payroll native eisen) niet — die blijven bij Carerix/Mysolution.

**Optie B — Verticale staffing-ATS voor techniek/installatie/bouw NL.**
Best-in-niche op: domein-workflows (monteurs, projecten, VCA/certificeringen, planning) + koppeling met het bestaande
KDMN-ecosysteem (planning/platform); **KDMN als eerste klant + warme referentie**. Bewust NIET: generiek alle-branches.
Monetisatie: kleinere TAM maar hoge betalingsbereidheid + warme leads via KDMN-netwerk. Solo-houdbaar: **ja**, domeinkennis = moat.
Trade-off: afhankelijk van één vertical; vereist domein-diepte; minder schaalbaar breed.

**Optie C — AI-recruiter-copiloot bovenop andermans ATS'en (agentic layer, geen volledige ATS).**
Best-in-niche op: agentic source→screen→plan→nudge als plug-in. Bewust NIET: zelf de hele ATS zijn.
Monetisatie: usage-based. Solo-houdbaar: **matig** (integratie-onderhoud per externe ATS). Trade-off: crowded
(Cockpit X + vele startups), afhankelijk van API's van derden, zwakke lock-in — botst met "iets waar ik achter sta".

### 5.6 Aanbeveling (founder-lens) + dubbele kritiek
**Aanbeveling: Optie A als kern, met Optie B als wig.** Lanceer als hét moderne, AI-native, NL-eerst ATS+CRM voor
**kleine recruitment-/staffingbureaus**, met een **techniek/bouw-staffing-wig** waarbij KDMN eerste klant + referentie is.
Koppel (niet bezit) payroll/CAO. Win op UX + AI + Nederlands + transparante prijs — precies waar incumbenten het zwakst zijn.
Reden: al jouw bestaande investeringen (back-office-lite, contracts/facturatie, NL job-boards, AI-agent, compliance-fundament)
wijzen al hierheen; je bent ~80% gebouwd op de meest verdedigbare, minst bediende kant; en het is solo te onderhouden
omdat je de payroll/CAO-wettredmolen bewust níet bezit.

- **Kritiek vanuit de klant (bureau-eigenaar):** "Waarom jou i.p.v. Carerix/RecruitNow?" → antwoord moet glashelder zijn:
  moderner, sneller, AI doet het saaie werk, alles inbegrepen, helft van de prijs, en je begrijpt mijn branche (techniek).
  Risico: als payroll via een externe koppeling moet, voelt dat als "tweede systeem" — de koppeling (AFAS/Easyflex) moet
  daarom écht naadloos zijn, anders verlies je van all-in-one Mysolution.
- **Kritiek vanuit de ontwikkelaar (jij, solo):** grootste risico is **scope-clutter** — TalentFlow heeft nu al ~45 modules;
  "het beste in een niche" betekent eerder **schrappen/verbergen** dan bijbouwen. Tweede risico: één payroll-koppeling goed
  onderhouden is al werk; beloof er niet drie tegelijk. Derde: KDMN-wig mag geen excuus worden om een generiek product
  half-techniek te maken — de vertical is marketing + 2-3 workflows, niet een fork.

### 5.7 Anti-scope — wat we voor deze niche bewust NIET bouwen
- Geen eigen **fasensysteem/CAO/payroll-engine** (juridische tredmolen; koppel naar AFAS Flex/Easyflex).
- Geen **VMS/MSP/enterprise**-functionaliteit.
- Geen **straddle** van corporate + agency tegelijk als hoofdproduct.
- Geen nieuwe modules "voor de volledigheid" — eerder de bestaande ~45 modules **dunnen/verbergen** tot een strakke kern.

### 5.8 Geprioriteerd plan (gemapt op de niche-aanbeveling)
*Inschattingen = uren-werk + complexity; nog niet gepland, wachten op niche-akkoord.*

**Fase 0 — Focus & ontstapelen (maakt het "niche en strak"):**
- Module-audit: kern-flow (vacature→source→screen→pipeline→plaatsing→factuur) zichtbaar; rest onder "geavanceerd"/uit. *(~12-16u, medium)*
- Sidebar-declutter + KPI-card-consolidatie + lichtere achtergrond (overlapt Sectie 4.4/4.5/4.6). *(~16-24u, medium)*

**Fase 1 — Looks & UX best-in-niche (de hele belofte vs dated incumbenten):**
- Kanban-pipeline polijsten tot Recruitee-niveau. *(~16u, medium)*
- Design-system-consistentie over kern-pagina's (DESIGN.md-uitrol, Sectie 2). *(~16-24u, medium)*

**Fase 2 — AI-native differentiator (2026-frontier, leun op sourcing-agent):**
- Agentic lus sluiten: screen→plan→nudge→stage-update met recruiter-goedkeuring. *(~40u, high)*
- WhatsApp conversational pre-screening (à la Fenne/Carerix Private AI). *(~24u, medium-high)*
- Auto-scheduling/agenda. *(~16u, medium)*

**Fase 3 — NL-bureau-fit zonder de tredmolen:**
- Eén naadloze payroll-koppeling (AFAS Flex óf Easyflex — kiezen, niet beide). *(~24-40u, high)*
- Wet DBA/ZZP-risicocheck bij intake (onopgeloste marktpijn = differentiator). *(~24u, medium-high)*
- Techniek/bouw-wig: VCA/certificering-veld + KDMN-referentie-workflow. *(~16u, medium)*

**Fase 4 — Differentiators tot verkooppunt maken (fundament bestaat):**
- EU AI Act productiseren: human-oversight-gates (blokkeer auto-reject), 6-mnd beslis-logging, kandidaat-AI-notificatie,
  bias/adverse-impact-dashboard (bouwt op `aiDisclosure.ts`/`deiFunnel`). *(~24-32u, medium)*
- Self-serve analytics polijsten (Ashby-grade; reports-builder bestaat). *(~16-24u, medium)*
- Transparante, gepubliceerde all-in-prijs als positionering (geen add-on-tax). *(strategie, geen bouw)*

### 5.9 Open beslissing voor Kaan (vóór er gebouwd wordt)
1. **Niche-richting bevestigen:** Optie A (kern) + B (techniek-wig) — akkoord, of andere keuze?
2. **Payroll-koppeling kiezen** (als Fase 3 doorgaat): AFAS Flex of Easyflex?
3. **Startfase** zodra akkoord: aanbevolen Fase 0 → 1 (snelste zichtbare winst, laagste risico).
4. **Pricing-model:** per-seat vs per-job-slot (Teamtailor/Recruitee doen per-slot — vriendelijker voor groeiende teams).

### 5.10 CORRECTIE — eerste klant/vertical = ITProposal BV (IT-detachering) (2026-07-01)
**Vervangt de "techniek/bouw"-aanname in 5.5 Optie B, 5.6 en 5.8 Fase 3.** Kaan's bevestiging:
de **eerste focus-klant + design partner #1 is ITProposal BV, een IT-detacheringsbedrijf** (tevens zijn
stagebedrijf). Voor hen wordt het eerste platform gebouwd; zij leveren feedback/real-world data/referentie.

Gevolg voor de positionering:
- De **vertical-wig is IT-detachering/secondment**, niet techniek/installatie/bouw. Domein-workflows:
  IT-consultants/freelancers vinden, **tech-stack/skills-matching**, **uren- en project-detachering**,
  **client-plaatsingen + marge/tarief-tracking** — niet monteurs/VCA/planning.
- KDMN blijft de eigenaar/leverancier, maar de **eerste referentieklant is ITProposal** (niet KDMN zelf).
- Manatal blijft de benchmark (ITProposal komt daar vandaan; ~€620/mo TCO-besparing is de drijfveer — echte factuur, zie docs/TCO_ROI.md).
- Kern-niche-aanbeveling (5.6) blijft staan: **moderne, AI-native, NL-eerst ATS+CRM voor kleine
  recruitment-/detacheringsbureaus**, met **IT-detachering als eerste wig** via ITProposal.
- Anti-scope (5.7) blijft: payroll/CAO koppelen, niet bezitten; geen VMS/enterprise; ontstapelen i.p.v. bijbouwen.

5.8 Fase 3 "Techniek/bouw-wig: VCA/certificering-veld" → **lees als** "IT-detachering-wig: tech-stack/skills-
matching + tarief/marge-veld + ITProposal-referentie-workflow". Overige fases (0/1/2/4) ongewijzigd.

---

## Sectie 6: Prod-verificatie follow-ups (2026-07-01)

> Gevonden tijdens de 3-daagse prod-verificatie (zie `docs/PROD_VERIFICATIE_2026-07-01.md`). Alle P2;
> Kaan promoot. De kern (ATS+CRM+plaatsing, AI, e-mail, workers) draait live geverifieerd — dit zijn de
> resterende punten.

- **[P2] Embedding-backfill** — 0/50.004 kandidaten + 0/303 jobs hebben een embedding (OpenAI stond tot
  2026-07-01 uit). Nieuwe records embedden vanzelf; bestaande niet → **semantische matchscore geeft nu niets
  over bestaande data**. Actie: een backfill-run over kandidaten/jobs (kost ~centen aan OpenAI-embeddings).
  Voor IT Proposal's cutover minder urgent (import embedt automatisch); wel nodig voor demo's op load-test-data.
- **[P2] RLS non-owner-cutover** — prod draait als `talentflow` superuser (`bypassrls=true`) → RLS-policies
  inert; isolatie leunt op app-laag `WHERE tenant_id`. **Harde gate vóór de eerste 2e externe klant.** Fix is
  gebouwd + dev-bewezen (`docs/RLS_HARDENING.md`); cutover naar `talentflow_app` (NOBYPASSRLS) is een
  Kaan-beslissing (irreversibel-ish → niet autonoom uitgevoerd).
- **[P2] Per-tenant e-mail-afzender** — `RESEND_FROM` is nu globaal `TalentFlow <no-reply@send.kdmn.nl>`.
  Voor SaaS moet elke tenant met de eigen naam (en evt. eigen geverifieerd domein) kunnen versturen, zodat
  IT Proposal's kandidaat/klant-mail "IT Proposal" toont i.p.v. "TalentFlow".
- **[P2] OpenAI-kostencap/monitoring** — vóór opschalen een provider-hard-cap + per-tenant metering op
  `ai_events` activeren (zie AI-kosten-notitie). Self-hosted embeddings (€0) is een latere schaaloptie
  (let op `vector(1536)`-migratie).
- **[P2] Sleutelrotatie** — Anthropic/OpenAI/Resend-keys kwamen in de chat langs → roteren.
- **[P2] ESLint ontbreekt** — geen `.eslintrc`/`eslint.config.*`; `npm run lint` kan niet draaien. Config toevoegen.
- **[P2] i18n-staart** — 16/79 dashboard-pagina's nog hardcoded NL (incl. `timesheets/page.tsx`, waarvan de
  eerdere migratie kapot was en is teruggedraaid).
- **[P2] `RESEND_REPLY_DOMAIN`** staat nog op `reply.talentflow.kdmn.nl` — uitlijnen op `send.kdmn.nl` zodra
  inbound e-mail (reply-threading) wordt aangezet (nu bewust uit).
- **[INFO] 5 workers bewust uit** (`whatsappOut`, `whatsappHealthCheck`, `voiceCallTranscribe`, `contractExpiry`,
  `skillsSnapshot`) — horen bij bevroren/niet-actieve features; aanzetten pas als die features live gaan.

### Follow-ups batch 2026-07-02 (stagebedrijf-feedbackronde 2)
- **[P2] CampaignBuilder.tsx heeft nog het raw-HTML-textarea-patroon** (`camp-body`) — zelfde vervanging door
  `RichTextEditor` als email-templates/ComposeEmailModal (die zijn gedaan).
- **[P2] Redis eviction-policy** — compose zet `allkeys-lru`; BullMQ wil `noeviction` (warning bij elke
  queue-connectie). Onder memory-druk kunnen queue-keys geëvict worden → jobs kwijt. Compose-wijziging + herstart.
- **[P2] `GET /jobs/:id/sourcing-suggestions` bestaat niet** (404) — de SourcingSuggestionsCard in de AI-Suite-tab
  toont daardoor altijd de lege staat. Endpoint bouwen of kaart verwijderen.
- **[P2] apiRateLimit-429 heeft nog lege `details`** — authRateLimit is gefixt (countdown); de generieke limiter nog niet.
- **[BESLISSING Kaan] Auto-post naar job boards bij publiceren** — nu handmatig (boards kiezen → posten). Automatisch
  posten naar een standaard-set bij "Publiceren" kan gebouwd worden; wachten op keuze.
- **[INFO] Demo-seed load-test-tenant** — `apps/api/scripts/seed-load-test-modules.sql` (idempotent, per-tabel-guards)
  vulde 2026-07-02 alle lege modules; embedding-backfill (300 jobs + 2.000 kandidaten) via one-off enqueue-script gedraaid.

---

## Sectie 7: Grote autonome bouwronde (2026-07-08) — OPGELEVERD

Opdracht Kaan: "pak alles op, ook alles wat in de roadmap staat; code-reviewer op veiligheid
+ onnodige code; kom pas terug als je klaar bent met het product." Uitgevoerd met een team
parallelle agents + drie code-reviewers. Twee productie-milestones gedeployed en live geverifieerd.

### Milestone 1 (commit `1462ed0`, live) — auth/e-mail/eerlijkheid/API-kern
- **Wachtwoord-reset** end-to-end (enumeratie-neutraal + timing-jitter, gehashte single-use tokens 1u,
  sessie-intrekking); `/forgot-password` + `/reset-password`. Migratie 041.
- **Notificatie-voorkeuren** GET/PUT geconsolideerd ↔ per-rij; `getEffectivePreference` checkt master AND event;
  quiet-hours gesynct over alle rijen. (Sluit Sectie 1 "Notificatie-voorkeuren contract-mismatch".)
- **Per-tenant e-mail**: afzendernaam + reply-to + eigen SMTP (nodemailer, AES-256-GCM at rest) + testmail;
  SSRF-guard op SMTP-host/poort. Migratie 042. (Sluit Sectie 5.1.)
- **Mock-eerlijkheid**: geen fake succes in prod — HM-swipe echte data, sourcing/job-boards/whatsapp/voice
  weigeren eerlijk (503/failed + NL-melding), gedeelde `mocksAllowed()`. (Sluit deel van 6.2.)
- **Bulk-campagnes** mergen `{{variabelen}}` nu echt per ontvanger. **API-fixes**: `/health/ready` (DB+Redis),
  sourcing-suggestions-endpoint (sluit follow-up), apiRateLimit-429-details (sluit follow-up), jobs.status enum,
  pool-timeout. **CampaignBuilder** → RichTextEditor (sluit follow-up).
- **Infra**: Redis `noeviction`+512mb (sluit follow-up), `env_file`-vangnet api/api-worker (sluit Sectie 1 deploy.sh#2 +
  docs/docker.md §6), uptime-monitor met mail-alert, dode `deploy.yml` verwijderd, disk-prune 104 GB.
- **Security onderweg**: publieke registratie stond live OPEN → gedicht (403).

### Milestone 2 (commits `010d31a`…`cfde129`, live) — compliance/security/white-label/portalen/modules
- **GDPR (AVG art. 15+17)**: export-dossier + delete/anonymisatie e2e, gehashte kort-levende download-tokens
  (dashboard + self-service). Migratie 046. (Sluit Sectie 3 "GDPR export" + "GDPR delete".)
- **2FA (TOTP)**: QR-setup, recovery-codes (single-use, gehasht), replay-protectie (atomair), tenant-policy
  "verplicht" + afdwing-flow. Migratie 047. (Sluit Sectie 2 "2FA/SSO" — TOTP-deel; SAML/OIDC blijft anti-scope.)
- **AI Act**: human-oversight-gate (auto-reject → pending_review + recruiter-approval), kandidaat-AI-samenvatting,
  "AI & Bias"-analytics (adverse-impact 4/5-regel, <30-suppressie), beslis-logging + 6-mnd-retentie. Migratie 043.
  (Sluit Sectie 3 "AI Act compliance module".)
- **Pay transparency (EU 2023/970)**: publiceer-gate (422 zonder salarisband, ook via jd-generator + job-templates),
  beloningscriteria op career-page + job-detail, admin-toggle, rapport. Migratie 044. (Sluit Sectie 3 "Pay transparency".)
- **White-label branding**: logo-upload (SVG-hardening: scrub + CSP-sandbox + nosniff), accentkleur via CSS-var met
  WCAG-contrastvalidatie, logo in sidebar, e-mail-footer. Migratie 045. (Sluit Sectie 2 "Multi-tenant white-label" —
  behalve custom subdomein, blijft infra-taak.)
- **Reports**: builder e2e (blokken/filters/run/CSV-export) + embed-token met expiry. Migratie 049.
  (Sluit Sectie 2 "Reports module fix".)
- **Klantportaal**: gast-shortlist zonder login (PII-vrij bewezen), feedback-loop, audit. Migratie 048.
  (Sluit Sectie 2 "Klantportaal voor shortlist-feedback".)
- **Module-flags**: per-tenant module-zichtbaarheid (moduleGuard + settings/modules), grandfather bestaande tenants.
  Migratie 050. **Viewer-rol schrijf-gaten gedicht** (jobs/crm/interviews/scorecards waren schrijfbaar). **Demo-tenant-script**
  (viewer-rol, random creds). (Sluit Sectie 2 "Demo-tenant" + strategie Fase 0 ontstapelen.)
- **Career-page** blok-voor-blok publiek renderen + **auto-post opt-in** bij publiceren (Kaan-beslissing: default UIT,
  nu bouwbaar/aan te zetten — sluit de [BESLISSING Kaan]-follow-up).
- **Leftovers**: skill-profile PATCH-endpoint (sluit 2026-06-30 open bug), klant-select op job-detail, OpenAPI HM, HM-tijdzone.
- **i18n-staart**: timesheets/pipeline/ai-generator/api-explorer/api-keys/jd-drafts/custom-fields/integrations/
  notifications/voice/whatsapp gemigreerd (11+ pagina's). **ESLint** opgezet (`npm run lint` exit 0, config web+api).
- **RLS non-owner cutover UITGEVOERD** (2026-07-08): prod draait onder `talentflow_app` (NOBYPASSRLS); DB-afgedwongen
  isolatie live, backup + probe + smoke groen. (Sluit Sectie 6.2 "RLS non-owner-cutover" — de harde gate vóór klant #2.)

### Kwaliteit
Drie code-reviewers (publieke token-endpoints, 2FA/migraties, contract-drift): **geen kritiek/hoog** in de nieuwe code;
alle nieuwe tenant-tabellen RLS ENABLE+FORCE+policy; 8 bevindingen gefixt (GDPR-token hashen, 2FA-race atomair,
`withTenant` in verify-controller, `enforce2faPolicy` exact-match, skill-profile-normalisatie, rol-toewijzing `role_key`,
portal-mock alleen non-prod). Testsuite bij oplevering: **1805 api + 25 web groen; api+web `tsc` schoon; i18n-pariteit**.

### Nog open na deze ronde (P2/P3, expliciet niet gedaan)
- **[P2] Custom subdomein per tenant** (career-page + white-label) — infra-werk (nginx-vhost + DNS + cert), o.a.
  `werkenbij.kdmnprojecten.com`. Schema-support (`career_pages.custom_domain`) bestaat; serveerpad niet.
- **[P2] Billing/Stripe** — plan in `docs/STRIPE_PLAN.md`; bouw wacht op Kaan's Stripe-account + keys.
- **[P2] Outlook/Gmail-OAuth mailbox-sync** — app-registraties nodig (Kaan).
- **[P2] i18n-restant** — enkele settings-pagina's (talent-fit, availability, custom-fields deels, workflows) nog hardcoded NL;
  `career-public`-SSR-renderer is levend (niet dood, reviewer-aanname klopte niet).
- **[P2] Reports-share plaintext-tokens** (portal/embed) — GDPR-token is gehasht; portal/embed-tokens nog plaintext (LOW).
- **[P3] Lint-warnings opruimen** (73 warnings, niet-blokkerend) + testfiles onder tsc-gate.
- **[✅ 2026-07-09] Manatal-cijfer in beschermde bestanden gecorrigeerd** — CLAUDE.md regel 6 + ROADMAP.md regel 890 stonden nog op "~€1.000/mo";
  na akkoord Kaan gecorrigeerd naar ≈€620/mo (echte factuur, docs/TCO_ROI.md). ~~Origineel item:~~
  de echte factuur is ≈€620/mo (zie `docs/TCO_ROI.md`). Mag ik die twee regels corrigeren?

---

## Sectie 8: Volledige systeem-audit — top-tot-teen (2026-07-13)

> Uitgevoerd op verzoek van Kaan: 6 read-only code-audits (per domein) + 1 live-UI-audit (Playwright op de draaiende app, 27 pagina's). Doel: alle bugs, inconsistenties en UI/UX-onnetheid vastleggen — NIET fixen. **162 bevindingen: 33 P1, 62 P2, 67 P3.**
> 
> **Prioriteitsnoot (ROADMAP-conventie):** de P1/P2/P3-labels hieronder zijn de *audit-inschatting* van ernst, niet automatisch de sprint-prioriteit. Formele promotie naar P0/P1 is aan Kaan. Enkele bevindingen zijn 'te verifiëren' (in de tekst gemarkeerd).

### Systemische patronen (fix één keer, dekt tientallen items)

1. **Envelope-drift (grootste patroon, ~30+ items).** React-Query-hooks lezen inconsistent `.items` / `.data` / de rauwe body, terwijl de API `{data}` / `{data,next_cursor}` / een kaal object teruggeeft (axios unwrapt niet automatisch). Gevolg: lijsten permanent leeg en detailpagina's crashen. Raakt inbox, communications/campagnes, contracten, facturen, timesheets, commissies, nurture, sourcing, outreach, interviews, email-templates. Aanbevolen: één gedeelde `unwrap()`-helper + hooks gelijktrekken.
2. **Nep-succes bij DB-fout (mock-fallback maskeert fouten).** Services retourneren verzonnen/mock-data of `{}` bij een niet-AppError i.p.v. een 5xx: career-pages (publieke career-page + apply + admin-CRUD), webhooks, workflows, communications. Een storing wordt als succes gepresenteerd; een publieke sollicitatie kan geruisloos verloren gaan.
3. **Nep-opslag op de settings-hub.** Wachtwoord wijzigen, gebruiker uitnodigen en bedrijfsgegevens opslaan zijn `setTimeout`-stubs met een succes-toast maar zonder API-call.
4. **Lijsten gecapt op 20 zonder paginering.** Kandidaten- én vacaturelijst tonen max 20 met een misleidende totaalteller (bv. '20 totaal' terwijl er 50.001 kandidaten / 209 vacatures zijn).
5. **Webhook-HMAC over geherserialiseerde JSON i.p.v. raw body.** WhatsApp (360dialog/Meta), Resend inbound e-mail en outreach inbound verifiëren de handtekening over `JSON.stringify(req.body)` → in productie (met secret) worden álle legitieme webhooks 401. WhatsApp STOP-consent werkt daardoor niet (AVG-risico).
6. **i18n-gaten.** Diverse pagina's/componenten hardcoded NL (kandidaat-detail, email-templates, custom-fields, workflows, facturen, career-pages create, inbox-verwijderen, CRM) + zichtbare rauwe keys (`topJobs.applicants`) + rauwe `snake_case` activity-codes + Engelse grafiek-legenda's in NL-UI.
7. **Ontbrekende UUID-validatie op `:id`** (hm, users, deels career-pages) → Postgres 22P02 → 500 i.p.v. nette 400/404.
8. **Commissie/facturatie overtime-factor 1.25 vs canonieke 1.5** — structureel afwijkende commissie- en factuurbedragen.
9. **Ontbrekende `tenant_id` op JOINs** (dashboard top-jobs, CRM deals→users, interviews availability, commissies) — defense-in-depth-gaten omdat de app onder de owner-rol draait (RLS inert).

### P1 — audit-inschatting (33 items)


**[/candidates]**
- (bug) **Kandidatenlijst gecapt op 20 + verkeerd totaal** — `/candidates — header 'X kandidaten totaal' + lijst` — Lijst laadt exact 20 kandidaten, header zegt '20 totaal' terwijl echt totaal 50.001 is; geen paginering/infinite-scroll. _Impact:_ Recruiter kan 99,96% van kandidaten niet bereiken via de lijst; teller misleidend. (Dubbel met candidates-code-audit.)

**[/jobs]**
- (bug) **Vacaturelijst gecapt op 20 + verkeerde teller** — `/jobs — teller '20 resultaten' + lijst` — 20 vacatures met '20 resultaten' terwijl dashboard 209 open vacatures meldt; geen paginering. _Impact:_ Overige honderden vacatures onbereikbaar; teller klopt niet.

**[billing]**
- (bug) **useInvoice() geeft {invoice,lines} door → factuurdetail crasht** — `apps/web/hooks/useBackOffice.ts:571` — GET /invoices/:id geeft {invoice,lines}; hook geeft wrapper → invoice.status undefined → pill.cls crasht. _Impact:_ Elke factuur-detailpagina crasht; versturen/betaald/void/sync/PDF onbereikbaar.

**[candidates]**
- (bug) **CSV bulk-import heeft geen backend-routes (404)** — `apps/api/src/modules/candidates/candidates.router.ts:57 / bulkImport.service.ts:220` — previewCsv/startCsvImport/getImportStatus zijn aan geen route gekoppeld; frontend POST't naar /candidates/import/preview|start + GET /candidates/imports/:id — geen bestaat. _Impact:_ 'CSV import'-knop faalt altijd met 404; volledige bulk-import is dood.
- (bug) **Kandidaat-merge endpoint bestaat niet (404) + shape-drift** — `apps/api/src/modules/candidates/dedupe.service.ts:173 / apps/web/hooks/useDedupe.ts:34` — mergeCandidates() bestaat + heeft tests maar is aan geen route gekoppeld; UI POST't naar /candidates/merge (niet geregistreerd) en stuurt {duplicate_id,choices} terwijl service {duplicate_ids[],field_choices} verwacht. _Impact:_ 'Samenvoegen'-knop levert altijd 404; merge-feature volledig niet-functioneel.
- (inconsistency) **Dedupe-match contract-drift: frontend leest verkeerde veldnamen** — `dedupe.service.ts:157 / candidates/[id]/page.tsx:345` — API geeft {candidate_id,candidate_name,match_reason,confidence}; frontend leest matched_candidate_id/matched_name/reason/score → undefined. _Impact:_ Duplicaten-banner toont 'lijkt op undefined, undefined'; MergeDialog krijgt undefined duplicate-id → laadt oneindig.

**[commissions]**
- (bug) **useCommissionSchemes() pakt {data} niet uit → Schemes-tab crasht op .map** — `apps/web/hooks/useBackOffice.ts:743` — GET /commissions/schemes geeft {data}; hook returnt wrapper → schemes.map op object → TypeError. _Impact:_ Tabblad Commissie-schemes crasht bij openen.
- (bug) **useCommissionAssignments() pakt {data} niet uit → Assignments-tab crasht op .map** — `apps/web/hooks/useBackOffice.ts:805` — GET /commissions/assignments geeft {data}; hook geeft wrapper → assignments.map crasht. _Impact:_ Assignments-tab + commissie-sectie op contractpagina crashen.

**[communications]**
- (inconsistency) **Bulk-campagne aanmaken: frontend-payload matcht backend-zod niet → altijd 400** — `apps/web/components/communications/CampaignBuilder.tsx:150-159` — Frontend postt {audience,provider,...}; backend vereist candidate_ids.min(1) + via enum. candidate_ids/via ontbreken → zod 400. _Impact:_ Elke campagne-aanmaak faalt (400); bulk-e-mail vanuit UI volledig kapot.
- (inconsistency) **Bulk-campagne lijst leest body als array maar API wrapt in {data}** — `apps/web/hooks/useBulkCampaigns.ts:26-31` — useBulkCampaigns returnt het hele body-object i.p.v. data → campaigns.length undefined. _Impact:_ Campagne-overzicht toont altijd lege staat.

**[compliance]**
- (security) **Self-service kandidaat-token wordt PLAINTEXT opgeslagen (alle andere token-tabellen hashen)** — `apps/api/src/modules/compliance/selfService.service.ts:152-157,199-203 (+ migratie 012 candidate_self_tokens.token TEXT UNIQUE)` — candidate_self_tokens.token bewaart de rauwe 32-byte token; INSERT slaat raw op en lookup doet WHERE token=$1 op raw. Alle andere secret-tokens (refresh/password_reset/user_invite/data_export/scim) bewaren alleen sha256/bcrypt-hash. Docstring beweert dat er gehasht wordt maar dat gebeurt niet. _Impact:_ DB-lek levert direct werkende self-service portaallinks op → toegang tot kandidaat-PII + consent wijzigen/verwijderverzoek/export zonder verdere auth. Token 7 dagen geldig, niet single-use.

**[contracts]**
- (bug) **useContract() geeft {data}-envelope door → detailpagina crasht** — `apps/web/hooks/useBackOffice.ts:100` — GET /contracts/:id geeft {data:contract}; hook returnt zonder .data → contract.status undefined → STATUS_PILL[undefined] crasht. _Impact:_ Elke contract-detailpagina witte pagina; verlengen/beëindigen/factuur onbereikbaar.
- (bug) **Nieuw-contract stuurt niet-UUID candidate_id/client_organization_id → altijd 400** — `apps/web/app/(dashboard)/contracts/new/page.tsx:69` — Submit stuurt cand-new-<ts>/org-new-<ts>; backend eist uuid(); canSubmit checkt candidateId niet → zod 400. _Impact:_ Contract aanmaken via formulier faalt structureel tenzij toevallig geldige UUID.

**[inbox]**
- (inconsistency) **Inbox thread-lijst leest .items maar API stuurt .data → lijst altijd leeg** — `apps/web/hooks/useInbox.ts:49-53` — useInboxThreads returnt data.items maar backend stuurt {data:[...],next_cursor}. data.items is undefined → threads altijd leeg. _Impact:_ Omni-channel inbox toont NOOIT threads; kernfeature onbruikbaar.
- (inconsistency) **Thread-timeline leest .items maar API stuurt .data → timeline altijd leeg** — `apps/web/hooks/useInbox.ts:79-83` — useThreadTimeline returnt data.items terwijl API {data:[...]} stuurt. _Impact:_ Gespreksgeschiedenis van een thread altijd leeg.

**[integrations]**
- (bug) **E-mailtemplate opslaan zonder plain-text faalt (body_text:null geweigerd door zod)** — `apps/web/app/(dashboard)/email-templates/page.tsx:176` — handleSave stuurt body_text:null; server-schema body_text:z.string().optional() weigert null → 400. Shared type staat string|null wél toe. _Impact:_ Template aanmaken/updaten zonder de als optioneel gelabelde plain-text faalt met 400.

**[interviews]**
- (bug) **Interview inplannen faalt altijd met 400 (payload-veldnamen + scheduled_end ontbreekt)** — `apps/web/components/interviews/SchedulerDialog.tsx:229` — Post {interviewer_ids,...} zonder scheduled_end; backend vereist scheduled_end + interviewer_user_ids → zod 400. _Impact:_ 'Nieuw interview inplannen' werkt nooit.
- (bug) **Interview-detailpagina crasht (participant.role undefined; backend levert participant_type)** — `apps/web/app/(dashboard)/interviews/[id]/page.tsx:381` — Rendert p.role.replace + p.user_name; SELECT * interview_participants levert participant_type/user_id/email → undefined.role.replace crasht. Details-tab default → crash bij openen. _Impact:_ Elke interview-detailpagina met deelnemers crasht; kit/opnames/scorecards onbereikbaar.
- (bug) **Interview verzetten faalt altijd met 400 NO_OP (scheduled_end ontbreekt)** — `apps/web/hooks/useInterviews.ts:84` — Reschedule PATCH't {scheduled_start,duration_minutes} zonder scheduled_end; controller neemt reschedule-tak alleen als beide gezet, anders 400 NO_OP; duration_minutes gestript. _Impact:_ Verzetten onmogelijk via UI.

**[nurture]**
- (bug) **Sequence-builder crasht (hook leest {sequence,steps}, API geeft {data:{...seq,steps}})** — `apps/web/hooks/useNurture.ts:66` — GET /nurture/sequences/:id geeft {data:{...seq,steps}}; hook returnt rauwe body → sequence/steps undefined → steps.length/sequence.name crasht. _Impact:_ Hele nurture sequence-builder crasht.
- (inconsistency) **Sequences- & enrollments-lijsten altijd leeg (data.items vs {data,next_cursor})** — `apps/web/hooks/useNurture.ts:48,221` — useSequences/useEnrollments returnen data.items; API geeft {data,next_cursor}. _Impact:_ Sequence-overzicht + reactivatie-sequencekiezer leeg; enrollment-stats 0.

**[outreach]**
- (inconsistency) **Berichten-lijsten altijd leeg (data.items vs {data,next_cursor})** — `apps/web/hooks/useOutreach.ts:61` — useOutreachMessages returnt data.items; API geeft {data,next_cursor}. _Impact:_ Pending/Sent/inbox permanent leeg — recruiter ziet geen berichten.
- (inconsistency) **Replies-tab altijd leeg + shape-mismatch (flat rows vs {classification,reply,original})** — `apps/web/hooks/useOutreach.ts:200` — useReplies verwacht {items:[{classification,reply,original}]}; API geeft {data:ClassificationRow[]} platte rijen → data.items undefined; zelfs na fix crasht row.classification.id. _Impact:_ Replies-tab + inbox tonen nooit geclassificeerde antwoorden.

**[reports]**
- (bug) **time_to_hire metric verwijst naar niet-bestaande kolom jobs.filled_at → rapport-run 500** — `apps/api/src/lib/reports/aggregator.ts:207` — METRIC_REGISTRY.time_to_hire gebruikt j.filled_at; die kolom bestaat in geen migratie (jobDetail.service.ts:565 bevestigt 'we don't have it'). Elke block met time_to_hire gooit 'column j.filled_at does not exist'. runReport → REPORT_RUN_FAILED (500). System-templates 'manager' + 'chro' shippen deze metric → falen out-of-the-box. _Impact:_ Rapporten met time_to_hire mislukken volledig (500); twee meegeleverde templates werken niet.

**[settings]**
- (bug) **Wachtwoord wijzigen op settings-hub is nep (setTimeout + succes-toast, geen API)** — `apps/web/app/(dashboard)/settings/page.tsx:299` — handleSavePassword doet enkel setTimeout(800), reset formulier, toont succes; roept nooit PATCH /users/me aan. _Impact:_ Gebruiker denkt wachtwoord gewijzigd terwijl oud wachtwoord geldig blijft — misleidende security-flow.
- (bug) **Gebruiker uitnodigen op settings-hub is nep (toont succes, nodigt niemand uit)** — `apps/web/app/(dashboard)/settings/page.tsx:310` — handleInvite toont 'inviteSent'-toast maar roept geen POST /users/invite aan; verzamelt alleen e-mail terwijl echte inviteUser name+role vereist. _Impact:_ Uitnodigen vanaf hoofd-settings doet niets; uitgenodigde krijgt nooit invite.

**[sourcing]**
- (bug) **Run-detail crasht (hook leest AgentRun rauw, API geeft {data:run,actions})** — `apps/web/hooks/useSourcing.ts:197` — GET /sourcing/runs/:id geeft {data:run,actions}; hook returnt rauw → run.status undefined → StatusIcon/pill crasht. _Impact:_ Run-detailpagina crasht; findings niet te bekijken.
- (bug) **Brief-detail crasht (hook rauw, API geeft {data:brief})** — `apps/web/hooks/useSourcing.ts:97` — GET /sourcing/briefs/:id geeft {data:brief}; brief.search_locations.join crasht op undefined. _Impact:_ Brief-detailpagina crasht; geen run te starten.
- (inconsistency) **Briefs- & runs-lijsten altijd leeg (data.items vs {data,nextCursor})** — `apps/web/hooks/useSourcing.ts:86,176` — useAgentBriefs/useAgentRuns returnen data.items; API geeft {data,nextCursor}. _Impact:_ Briefs/Runs-tab permanent leeg; hub-cards + stats werken niet.
- (bug) **Bulk-approve/reject stuurt {ids} terwijl backend {finding_ids} eist → 400** — `apps/web/hooks/useSourcing.ts:336,357` — Post {ids,note}/{ids,reason}; backend vereist finding_ids.min(1) → zod 400. _Impact:_ Bulk goedkeuren/afwijzen faalt altijd in findings-tab + run-detail.

**[timesheets]**
- (bug) **useTimesheets() leest data.items maar API geeft {data,next_cursor} → lijst altijd leeg** — `apps/web/hooks/useBackOffice.ts:240` — listTimesheets geeft {data,next_cursor}; hook leest data.items → undefined. useContracts/useInvoices doen wél data.data??items. _Impact:_ Timesheets-overzicht + tab altijd leeg; goedkeuren onmogelijk; KPI blijft 0.
- (bug) **Publiek kandidaat-urenportaal crasht (verkeerde shape + geen contract-object)** — `apps/web/hooks/useBackOffice.ts:483` — GET /public/timesheets/:token geeft {data:{contract_id,candidate_id,timesheet,...}}; hook geeft wrapper; type verwacht contract-object dat API nooit stuurt → contract.weekly_hours crasht. _Impact:_ Kandidaten-urenportaal crasht; kandidaten kunnen geen uren invullen/indienen.

**[whatsapp]**
- (missing-guard) **Webhook HMAC over geherserialiseerde JSON i.p.v. raw body → alle inbound 401 in prod** — `apps/api/src/modules/whatsapp/webhookRoutes.ts:55` — Globale express.json() draait vóór webhook-router; geen raw-body middleware; req.rawBody nooit gezet → HMAC over JSON.stringify(req.body) byte-ongelijk. Twee agents bevestigd. _Impact:_ WhatsApp inbound volledig kapot in prod (berichten/status/STOP geweigerd). STOP-consent werkt niet → GDPR-risico.

### P2 — audit-inschatting (62 items)


**[/api-explorer]**
- (bug) **API Playground laadt geen endpoints (OpenAPI-spec 404)** — `/api-explorer — /api-docs/openapi.json 404 (3x)` — Pagina laadt /api-docs/openapi.json → 404 → 'Geen endpoints gevonden'. _Impact:_ API Playground functioneel leeg/onbruikbaar; console-404's.

**[/candidates]**
- (bug) **Kaartjes dupliceren de eerste skill-tag** — `/candidates — skill-tags op kandidaatkaart` — 'Rust Rust TypeScript', 'Kubernetes Vue Vue', 'Java PHP PHP' — eerste tag dubbel; detailpagina toont skill één keer. _Impact:_ Oogt als databug; verkeerde indruk skillprofiel.

**[/candidates/<id>]**
- (visual) **Vacature-match-kaarten kappen tekst tot 'F...'/'St...'** — `kandidaat-detail → rechterkolom 'Vacature-matches'` — Match-kaarten te nauw: vacaturetitel afgekapt tot 'F...', 'Status: Open' tot 'St...'. _Impact:_ Gebruiker ziet niet welke vacature de match betreft zonder doorklikken.

**[/crm]**
- (visual) **Deals-kolomkoppen afgekapt en samengepropt** — `/crm → Deals — kanban-kolomkoppen` — 'Onderh...', 'Gewon...', 'Ve...'; laatste kop propt '(1)€ 7.036' zonder spatie. _Impact:_ Onduidelijk welke stage; oogt rommelig.

**[/dashboard]**
- (i18n) **Onvertaalde i18n-key 'topJobs.applicants' zichtbaar** — `/dashboard → widget 'Top vacatures'` — Elke rij toont letterlijke sleutel 'topJobs.applicants' i.p.v. aantal sollicitanten. _Impact:_ Zichtbare onvertaalde sleutel op hoofdpagina; oogt onaf.

**[/reports]**
- (visual) **Rapportkaart-titels en 3e actieknop afgekapt** — `/reports → 'Mijn rapporten' — kaarten` — Titels afgekapt ('Kandida...'), knop 'Dupliceren' geclipt tot 'Dup...' terwijl er rechts lege ruimte is; kaartbreedte onnodig krap. _Impact:_ Titels onleesbaar en actie deels afgeknipt.

**[/skills]**
- (bug) **'Demand-groei' lijngrafiek rendert leeg** — `/skills → Trending → 'Demand-groei over de laatste weken'` — Leeg plotvlak met legenda maar 0 line-series; tabel eronder heeft wél data en 'Vraag vs aanbod'-staaf rendert wél. _Impact:_ Belangrijkste visual op Skills toont geen data; oogt gebroken.

**[/workflows]**
- (bug) **Trigger-chip toont letterlijke placeholder 'X dagen'** — `/workflows — trigger-badge` — Chip toont 'X dagen geen activiteit' — X niet vervangen, terwijl beschrijving eronder wél '30 dagen' zegt. _Impact:_ Gebruiker ziet trigger-drempel niet; oogt onafgemaakt.

**[analytics]**
- (calc) **getRecruiterStats avg_time_to_hire_days opgeblazen door applications fan-out** — `apps/api/src/modules/analytics/analytics.service.ts:191` — AVG(close_date-created_at) over users⋈jobs⋈applications ZONDER DISTINCT → time-to-hire telt 1x per sollicitatie. Andere metrics gebruiken COUNT(DISTINCT). getOverview doet het correct in aparte jobs-only query. _Impact:_ Vertekend gemiddelde time-to-hire in Recruiters-tab; wijkt af van overzicht-KPI.
- (calc) **Dashboard conversionRate-KPI kan >100% en gebruikt verkeerde noemer** — `apps/web/app/(dashboard)/analytics/page.tsx:229` — conversionRate = laatste_stage/eerste_stage*100 op momentopname-bezetting → kan >100%; laatste stage op position is niet per se 'Aangenomen'. Zelfde bug-klasse als de gefixte report-funnel maar op het analytics-dashboard. _Impact:_ Toplijn-KPI toont onmogelijke percentages >100% of misleidende conversie.

**[auth]**
- (security) **SSO access-token (JWT) wordt in de redirect-URL query meegegeven** — `apps/api/src/modules/auth/sso.controller.ts:129-131` — ACS redirect naar /auth/sso-callback?token=<accessToken>. Refresh-token gaat correct als httpOnly-cookie maar het bearer access-token (15m) staat in de URL-query. _Impact:_ JWT lekt via browserhistorie, Referer-headers en proxy/access-logs; 15 min bruikbaar als sessie-credential.
- (inconsistency) **SSO-instellingen: provider-enum frontend != backend — Google/Generic niet opslaanbaar** — `apps/web/app/(dashboard)/settings/security/sso/page.tsx:54-59 vs apps/api/src/modules/auth/sso.controller.ts:211` — Frontend stuurt provider 'google'/'generic'; backend enum accepteert alleen okta/azure_ad/google_workspace/generic_saml → PUT faalt op zod (400). Bij hydrateren toont de Select niets voor bestaande google_workspace/generic_saml. _Impact:_ 2 van 4 aangeboden identity providers niet configureerbaar; opslaan geeft generieke 'Opslaan mislukt'.
- (inconsistency) **SSO-instellingen: default-rol veld-drift (default_role_id vs default_role) — selectie nooit opgeslagen** — `apps/web/app/(dashboard)/settings/security/sso/page.tsx:107,139 vs apps/api/.../sso.controller.ts:200-202,218` — Pagina PUT't default_role_id (rol-UUID); backend kent alleen default_role (rolnaam-string), strip't default_role_id. Default-rol hydrateert nooit en persisteert nooit. _Impact:_ Auto-provisioning bij SSO gebruikt altijd stil de hardcoded 'recruiter'; UI-keuze heeft geen effect.

**[billing]**
- (bug) **useCreateInvoice geeft {invoice,lines} → redirect naar /invoices/undefined** — `apps/web/hooks/useBackOffice.ts:587` — POST /invoices geeft {invoice,lines}; hook geeft wrapper → inv.id undefined → /invoices/undefined; toast invoice_number undefined. Factuur wordt wél aangemaakt. _Impact:_ Na genereren kapotte URL + verwarrende toast.

**[candidates]**
- (bug) **Kandidatenlijst gecapt op 20, geen paginatie** — `apps/web/app/(dashboard)/candidates/page.tsx:40 / useCandidates.ts:17` — useCandidates() haalt zonder page/limit → server-default 20. Geen paginatie/load-more; chips+filtering enkel over 20. Teller toont paginagrootte i.p.v. meta.total (useCandidateCount bestaat maar ongebruikt). _Impact:_ Bij >20 kandidaten (bv. 50k load-test) zijn de meeste onzichtbaar/niet filterbaar; totaal-label misleidend.
- (inconsistency) **current_position/current_company ontbreken in create/update zod-schema** — `candidates.schema.ts:75 / candidates.service.ts:55` — MUTABLE_CANDIDATE_COLUMNS + shared input + CSV + MergeDialog gebruiken current_position/company maar candidateFieldsSchema/updateCandidateSchema bevatten ze niet → zod strip't stil. _Impact:_ Functie/werkgever nooit via formulier/PATCH te zetten; alleen CSV kan ze vullen.
- (inconsistency) **Bulk-actie move_to_stage: schema/hook adverteren, service weigert (400)** — `candidates.controller.ts:56 / candidates.service.ts:1129` — bulkActionSchema + useBulkMoveToStage kennen 'move_to_stage' maar VALID_BULK_ACTIONS/switch niet → 400 INVALID_ACTION. Latent (toolbar zonder stages-prop → knop verborgen). _Impact:_ Zodra toolbar met stages wordt gebruikt geeft 'Verplaats naar fase' 400; half-afgemaakt over 3 lagen.
- (i18n) **Kandidaat-detailpagina + kern-componenten volledig hardcoded NL** — `apps/web/app/(dashboard)/candidates/[id]/page.tsx:159 (+ CandidateForm/MergeDialog/BulkActionsToolbar/MultiCVUpload)` — Hele detailpagina + genoemde componenten gebruiken geen t() maar hardcoded NL. _Impact:_ Bij EN blijven deze schermen Nederlands; geen pariteit met vertaalde lijst/pipeline.

**[career-pages]**
- (bug) **Publieke career-page valt bij DB-fout terug op FAKE vacatures** — `apps/api/src/modules/career-pages/career-pages.service.ts:520-526` — getPublicCareerPage vangt elke niet-AppError en retourneert buildMockCareerPage(slug) met verzonnen vacatures + random UUID's i.p.v. 404/foutpagina. _Impact:_ Publiek: tijdens DB-storing zien sollicitanten nep-vacatures; kan tot 'solliciteren' op niet-bestaande jobs leiden.
- (bug) **submitApplication doet bij DB-fout stil een mock-success (sollicitatie verdwijnt)** — `apps/api/src/modules/career-pages/career-pages.service.ts:902-912` — Bij niet-AppError returnt submitApplication {success:true, candidate_id:'mock-…'}. UI toont 'Bedankt voor je sollicitatie!' terwijl niets is opgeslagen. _Impact:_ Bij DB-probleem gaat een echte sollicitatie geruisloos verloren terwijl kandidaat succesbevestiging ziet.
- (bug) **Gekozen hoofdkleur bij aanmaken career page wordt stil weggegooid** — `apps/web/app/(dashboard)/career-pages/page.tsx:427-432 + career-pages.controller.ts:23-28` — Dialog stuurt primary_color top-level; backend verwacht kleur binnen config, strip't onbekende key → config={}. _Impact:_ Nieuwe career page start altijd met default-kleur; kleurenkiezer in create-flow heeft geen effect.

**[commissions]**
- (bug) **recurring_monthly slaat config.monthly_amount op, backend leest config.amount → commissie €0** — `apps/web/app/(dashboard)/commissions/page.tsx:545` — buildConfig schrijft {monthly_amount}; computeCommissionAmount leest cfg.amount. Sleutels matchen niet. _Impact:_ Elke recurring_monthly-regeling berekent commissie 0; recruiters krijgen niets terwijl UI bedrag toont.
- (inconsistency) **Marge-berekening gebruikt overtime-factor 1.25 i.p.v. canonieke 1.5** — `apps/api/src/modules/commissions/commissions.service.ts:526` — Kandidaatkosten met ot*1.25; canonieke billing-summary gebruikt 1.5 (of metadata.overtime_multiplier). _Impact:_ percent_of_margin-commissies structureel te hoog uitbetaald; metadata-override genegeerd.

**[communications]**
- (inconsistency) **BulkCampaign veld-contract drift (provider/counts/failures/name) → crash op failures.length** — `apps/web/lib/mockData.ts:3475-3499 + campaigns/page.tsx:372` — Frontend verwacht name/provider/eligible_count/failures[]; backend heeft via/total_*, geen name/failures/created_at. campaign.failures.length → TypeError op echt object. _Impact:_ Detail/overzicht tonen undefined + crashen op failures.length zodra envelope-bug verholpen is.
- (bug) **Inbound e-mail werkt unified_threads niet bij (geen recordCommunication)** — `apps/api/src/modules/email-inbound/email-inbound.service.ts:172-191` — handleInboundEmail roept recordCommunication (inboxProjector) niet aan terwijl outbound dat wél doet en inbox.service het als contract voorschrijft. _Impact:_ Inkomende replies verschijnen niet als ongelezen in de unified inbox, bumpen preview/teller niet.
- (bug) **Per-kandidaat e-mail-endpoint registreert 'sent' maar verstuurt niets** — `apps/api/src/modules/communications/communications.service.ts:169-201` — POST /communications/candidates/:id/email INSERT't status='sent' zonder queue/provider; echte verzending zit alleen in /send. DB-fout-fallback returnt ook 'sent' mock. _Impact:_ UI/threads melden 'verzonden' terwijl geen e-mail is afgeleverd — misleidende leverstatus.
- (bug) **Resend inbound-signature over her-geserialiseerde body i.p.v. raw body** — `apps/api/src/modules/email-inbound/email-inbound.controller.ts:33-34` — HMAC over JSON.stringify(req.body) i.p.v. raw body; Svix/Resend tekent raw. Met gezette RESEND_WEBHOOK_SECRET krijgen geldige webhooks 401. Exact Svix-schema te verifiëren. _Impact:_ In prod (secret gezet) worden legitieme inbound-mails afgewezen → inbound e-mail werkt niet.

**[contracts]**
- (bug) **useContractExtensions roept niet-bestaande route /contracts/:id/extensions aan (404)** — `apps/web/hooks/useBackOffice.ts:112` — Route bestaat niet (alleen /:id,/extend,/terminate,/notifications); extensions komen embedded via getContract maar pagina gebruikt losse hook. _Impact:_ Verlengingshistorie 404't → toont permanent 'geen verlengingen'.
- (bug) **useCreateContract geeft {data} → redirect naar /contracts/undefined** — `apps/web/hooks/useBackOffice.ts:140` — POST /contracts geeft {data:contract}; hook pakt .data niet uit → created.id undefined. _Impact:_ Na aanmaak navigatie naar niet-bestaand contract.

**[crm]**
- (missing-guard) **Contact aanmaken met null organization_id geeft 500 i.p.v. 4xx** — `apps/api/src/modules/crm/contacts.service.ts:96-110` — Schema staat organization_id nullable toe maar crm_contacts.organization_id is NOT NULL (migr 034). Null → 23502; alleen 42P01 afgevangen → 500. Zelfde bij updateContact. _Impact:_ API accepteert payload die DB weigert → 500 i.p.v. nette validatiefout.

**[dashboard]**
- (tenant-scope) **topJobs + recentActivity joins missen tenant-scope** — `apps/api/src/modules/dashboard/dashboard.service.ts:43,31` — LEFT JOIN applications a ON a.job_id=j.id mist AND a.tenant_id=$1; recentActivity users-join mist u.tenant_id. Onder owner-rol (RLS uit) moet elke JOIN zelf scopen. _Impact:_ Mogelijk cross-tenant meetelling/lek in 'top jobs by application count' op dashboard.

**[email-templates]**
- (inconsistency) **Single-template endpoints geven kaal object, hooks lezen data.data → undefined** — `apps/api/src/modules/email-templates/email-templates.controller.ts:33` — get/create/update geven kaal template; hooks lezen data.data → undefined (list geeft wél {data}). _Impact:_ useEmailTemplate(id) + mutation-resultaat undefined; fragiele drift.

**[integrations]**
- (inconsistency) **Stat 'Gesynct (24u)' permanent 0 (API levert emails_synced_24h niet) + scope/scopes-drift** — `apps/web/app/(dashboard)/settings/integrations/page.tsx:150` — stats.synced24h leest emails_synced_24h maar PUBLIC_COLUMNS bevat het niet; type verwacht scopes[] maar API geeft scope. _Impact:_ Tweede statuskaart altijd 0 (misleidend); verborgen contract-drift.

**[interviews]**
- (inconsistency) **Transcript-viewer toont nooit resultaat (envelope niet uitgepakt + veldnamen mismatch)** — `apps/web/hooks/useInterviewRecordings.ts:80` — useTranscript returnt hele body ({data:...}) → status undefined → altijd ProcessingState + poll 10s. Na fix: backend text/summary/strengths vs viewer ai_summary/utterances (bestaat niet → crash). _Impact:_ Voltooide transcriptie/AI-samenvatting nooit getoond; UI hangt op 'wordt verwerkt'.
- (inconsistency) **Interview-kit en vragen tonen nooit (kit_name/kit_id vs kit{}/interview_kit_id)** — `apps/web/app/(dashboard)/interviews/[id]/page.tsx:399` — Leest kit_name/kit_id; API levert interview_kit_id + genest kit:{id,name}. _Impact:_ Gekoppelde kit + vragenlijst nooit zichtbaar op detailpagina.
- (inconsistency) **Locatie/meeting-URL tonen nooit (location_url/location_address vs meeting_url/location)** — `apps/web/app/(dashboard)/interviews/[id]/page.tsx:339` — Leest location_url/location_address; API levert meeting_url + location. _Impact:_ Meeting-link en adres/telefoon nooit getoond aan interviewers.
- (bug) **Zoeken in interview-lijst kan crashen op null candidate_name/job_title** — `apps/web/app/(dashboard)/interviews/page.tsx:148` — Filter doet iv.candidate_name.toLowerCase() zonder null-guard; LEFT JOINs kunnen null geven. Te verifiëren of c.name null kan zijn. _Impact:_ Typen in zoekveld kan hele interviews-lijst laten crashen.
- (inconsistency) **Interviewer-filter permanent leeg (list-API levert geen participants)** — `apps/web/app/(dashboard)/interviews/page.tsx:123` — interviewerOptions/avatars uit iv.participants; listInterviews selecteert geen participants → undefined. _Impact:_ Interviewer-filter is dood; filteren op interviewer werkt niet.
- (tenant-scope) **Ontbrekende tenant-scoping op users-lookup in getConsolidatedAvailability** — `apps/api/src/modules/interviews/availability.service.ts:303` — SELECT name FROM users WHERE id=$1 mist AND tenant_id=$2; endpoint heeft geen membership-check op userId (RLS no-op onder owner-rol). _Impact:_ Cross-tenant lek van gebruikersnaam (PII) via availability-endpoint.

**[jobs]**
- (ux) **JobForm gooit 'Vereisten'-textarea bij submit volledig weg** — `apps/web/components/jobs/JobForm.tsx:178,349-360,143` — requirements_raw wordt in onSubmit gestript en nergens heen gestuurd (niet naar required_skills/description). handlePickTemplate leest jobData.requirements terwijl templates required_skills opslaan → prefill werkt ook niet. _Impact:_ Ingevoerde vereisten gaan verloren bij aanmaken; required_skills nooit via formulier gevuld (raakt comparable-jobs matching).
- (bug) **Custom-field-waarden in JobForm niet meegestuurd bij aanmaken** — `apps/web/components/jobs/JobForm.tsx:182-185,457-463` — CustomFieldsRenderer vult customValues maar onSubmit stuurt alleen createInput; customValues wordt nooit meegegeven; JobCreateInputSchema is .strict() zonder custom_fields. _Impact:_ Bij geconfigureerde job-custom-fields verdwijnen ingevulde waarden bij aanmaken (data-loss).
- (bug) **Comparable-jobs contract drift: match altijd ~0%, undefined velden** — `apps/web/hooks/useJobDetail.ts:253-261 + JobPerformanceTab.tsx:306-335` — API levert {job_id,title,candidates_total,days_to_fill,similarity_score(0..1)}; UI verwacht {id,client,filled,total_candidates}. Math.round(similarity_score) → 0%; c.id/c.client/c.total_candidates undefined. _Impact:_ Vergelijkbare-vacatures toont overal 0% match, 'undefined kandidaten', verkeerde badge, geen React key. Visueel kapot.
- (inconsistency) **Sourcing ROI: 'Hires'-kolom altijd 0 (hired_count niet in API-respons)** — `apps/api/src/modules/jobs/jobDetail.service.ts:640-647 + useJobDetail.ts:279` — getJobSourcing berekent hired_count maar mapt het weg; hook leest s.hired_count → undefined → 0. cost_per_hire_cents niet geleverd → '—'. _Impact:_ 'Hires: 0' met tegelijk niet-nul hire-conversie: misleidend/inconsistent.
- (tech-debt) **PATCH/POST /jobs lekt embedding-vector (RETURNING *) in respons** — `apps/api/src/modules/jobs/jobs.service.ts:457-462,264 + jobs.controller.ts:77` — updateJob/createJob/duplicateJob doen RETURNING * en de controller stuurt de rij ongefilterd; jobs heeft embedding vector(1536). getJob vermijdt dit juist met kolomlijst. _Impact:_ Elke job-update stuurt ~15-30KB embedding-data mee; payload-bloat + lek van intern matching-veld.
- (i18n) **Bias-flag labels tonen rauwe enum-strings (stale label-maps)** — `apps/web/hooks/useJobDetail.ts:299-307 + JobAISuiteTab.tsx:49-56` — API-enum age_indicator/unrealistic_requirement/exclusionary; flagLabels/FLAG_TYPE_COPY kennen alleen oude keys → val terug op rauwe snake_case. _Impact:_ JD-kwaliteitscheck toont 'age_indicator'/'unrealistic_requirement'/'exclusionary' i.p.v. NL-labels.

**[outreach]**
- (bug) **Inbound reply-webhook HMAC over geherserialiseerde JSON i.p.v. raw body** — `apps/api/src/modules/outreach/inboundWebhook.routes.ts:62` — JSON.stringify(req.body) vs vendor raw-bytes; geen raw-body middleware zichtbaar (te verifiëren). _Impact:_ Legitieme inbound replies 401; reply-tracking ontvangt niets.
- (bug) **Reply-classifier schrijft naar niet-bestaande tasks-kolommen** — `apps/api/src/modules/outreach/replyClassifier.service.ts:451` — INSERT INTO tasks (entity_type,entity_id,due_at,metadata) — tabel heeft die kolommen niet (wel candidate_id/job_id/due_date). INSERT faalt stil in try/catch. _Impact:_ Bij 'interested'-reply met schedule_call wordt nooit een taak aangemaakt; recruiter mist opvolgtaak.
- (bug) **draft-reactivation zoekt signal alleen binnen eerste 200 rijen** — `apps/api/src/modules/outreach/outreach.routes.ts:275` — listSignals(limit:200).find(id) → signal buiten 200 → 404; inefficiënt. _Impact:_ Reactivatie opstellen faalt met 404 voor oudere signals.
- (inconsistency) **Quota- en Signals-tab altijd leeg (data.items vs {data}/{data,next_cursor})** — `apps/web/hooks/useOutreach.ts:151,220` — useOutreachQuotas/useSignals returnen data.items; API geeft {data}/{data,next_cursor}. _Impact:_ Quota-tab + Signals-tab permanent leeg; limieten/reactivatie onbereikbaar.

**[pipeline]**
- (missing-guard) **Gearchiveerde (soft-deleted) kandidaten blijven in de pipeline zichtbaar** — `apps/api/src/modules/pipeline/pipeline.service.ts:299` — getApplicationsForJob JOIN candidates zonder c.deleted_at IS NULL; bulk-archive zet alleen kandidaat.deleted_at, applications blijven active. _Impact:_ Gearchiveerde kandidaat blijft in kanban-board hangen; inconsistent met kandidatenlijst die deleted_at wél filtert.
- (bug) **Applications zonder fase (stage_id null) onzichtbaar op board** — `apps/web/components/pipeline/KanbanBoard.tsx:146 / pipeline.service.ts:263` — Board rendert alleen bestaande stages; geen 'niet-toegewezen'-kolom. deleteStage van de eerste fase zet stage_id=NULL → die applications verschijnen nergens (Application.stage_id is als non-null getypt). _Impact:_ Eerste fase verwijderen laat kandidaten van het board verdwijnen; niet meer te slepen.

**[settings]**
- (bug) **Bedrijfsgegevens opslaan (Algemeen-tab) is nep (setTimeout + succes, geen API)** — `apps/web/app/(dashboard)/settings/page.tsx:289` — handleSaveTenant wacht 800ms + toast zonder company_name/timezone te persisteren. _Impact:_ Wijzigingen bedrijfsnaam/tijdzone gaan verloren; valse bevestiging.
- (i18n) **i18n-gap: custom-fields pagina volledig hardcoded NL** — `apps/web/app/(dashboard)/settings/custom-fields/page.tsx:100` — Geen react-i18next; labels/toasts hardcoded. _Impact:_ Blijft NL bij taal=en.
- (i18n) **i18n-gap: talent-fit pagina deels hardcoded ondanks useTranslation** — `apps/web/app/(dashboard)/settings/talent-fit/page.tsx:113` — Grote delen (StatTiles, MetricTiles, secties) hardcoded NL. _Impact:_ Halfvertaalde pagina bij taalwissel.
- (inconsistency) **Roles-lijst neemt permissions als array aan terwijl backend matrix-object levert** — `apps/web/app/(dashboard)/settings/roles/page.tsx:234` — r.permissions.length op object (backend: {resource:{action:bool}}); detail-pagina itereert met for..of → mogelijk crash (te verifiëren). _Impact:_ 'X resources'-teller leeg; mogelijk crash op rol-detail.

**[sourcing]**
- (missing-guard) **existing_db-source filtert deleted_at niet → soft-deleted kandidaten als findings** — `apps/api/src/modules/sourcing/sources/existingDb.ts:118` — Candidates-query WHERE alleen tenant_id + keyword/location, zonder deleted_at IS NULL (elders wél). _Impact:_ Verwijderde kandidaten duiken opnieuw op als findings, kunnen via approve benaderd worden — AVG-risico.
- (bug) **Start-run navigeert naar /runs/undefined** — `apps/web/hooks/useSourcing.ts:219` — POST briefs/:id/runs geeft {data:run}; hook returnt rauw → run.id undefined → router.push(/runs/undefined). _Impact:_ Na starten run kapotte URL.

**[timesheets]**
- (bug) **Detail-dialog toont nooit entries (lijst levert geen entries, geen detail-fetch)** — `apps/web/app/(dashboard)/timesheets/page.tsx:424` — Dialog rendert detail.entries maar detail komt uit lijst zonder entries; geen useTimesheet(id). _Impact:_ Urenregels-tabel permanent leeg; goedkeuren zonder inzicht in uren.

**[voice]**
- (inconsistency) **Gesprekkenlijst/-detail tonen kandidaat-UUID i.p.v. naam (candidate_name nooit geleverd)** — `apps/api/src/modules/voice/voice.service.ts:682` — listCalls/getCall SELECT * voice_calls zonder join candidates → geen candidate_name; frontend leest c.candidate_name (fallback id / 'onbekende kandidaat'). _Impact:_ Gesprekkenlijst toont rauwe UUID; detail 'onbekende kandidaat'.

**[webhooks]**
- (bug) **webhooks.service slikt DB-fouten en geeft nep-succes (leeg object / fake webhook)** — `apps/api/src/modules/webhooks/webhooks.service.ts:154` — update/toggle/rotate returnen bij niet-AppError {} / fake secret; create verzint webhook met random UUID; delete slikt fout. Controller stuurt 200 met lege/verzonnen data. _Impact:_ DB-fouten gemaskeerd als succes; frontend leest .id/.secret = undefined.
- (bug) **Bij herhaalbare delivery-failure blijft oorspronkelijke rij 'pending' i.p.v. 'failed'** — `apps/api/src/modules/webhooks/deliveries.service.ts:397` — Failure-pad zet rij op 'pending' + maakt nieuwe retry-rij; oorspronkelijke rij blijft pending zonder job. _Impact:_ Stuck pending-rijen; retry-knop niet beschikbaar; mogelijk dubbele deliveries via sweeper (te verifiëren).

**[workflows]**
- (bug) **createWorkflow verzint bij DB-fout een nep-workflow (all-zero id) + 201** — `apps/api/src/modules/workflows/workflows.service.ts:109` — Catch returnt fake stub id 00000000-… active:true; controller stuurt 201 → 'Workflow aangemaakt' terwijl niets opgeslagen. _Impact:_ Stille dataverlies-illusie; vervolgacties op nep-id falen.

### P3 — audit-inschatting (67 items)


**[/activity]**
- (i18n) **Ruwe snake_case event-codes i.p.v. leesbare labels** — `/activity + dashboard-widget 'Recente activiteit'` — Titels tonen 'resume_parsed','skill_profile_updated','email_queued','duplicated' i.p.v. vertaalde omschrijvingen. (Deels geraakt door recente activity-humanisering die alleen created/updated/etc. dekt.) _Impact:_ Technisch/onaf voor eindgebruikers.

**[/analytics]**
- (inconsistency) **Nav-label 'Rapporten' leidt naar Analytiek; aparte /reports heet óók 'Rapporten'** — `zijbalk ANALYSE 'Rapporten' → /analytics vs pagina /reports` — Menu-item 'Rapporten' opent /analytics (titel 'Analytiek'); de pagina die 'Rapporten' heet (/reports) is niet via dit label bereikbaar. _Impact:_ Verwarrende navigatie; twee pagina's heten 'Rapporten'.

**[/candidates]**
- (ux) **AI-score-badge zonder label in de lijst** — `/candidates — amberkleurig getal naast naam` — Getal (53/30/66) zonder uitleg; pas op detail blijkt het 'AI Score'. _Impact:_ Betekenis onduidelijk in de lijst.

**[/gdpr]**
- (visual) **KPI-kaarten kappen/proppen tekst** — `/gdpr — KPI-kaarten (o.a. Consent-dekking)` — 'Aandac[ht] vereist' en '% kandidaten met geldige GDPR-toestemmi[ng]' afgeknipt; kaarten te krap. _Impact:_ Compliance-status deels onleesbaar.

**[/jobs/<id>]**
- (inconsistency) **Pipeline-telling inconsistent tussen job-detail en pipeline** — `job-detail '450 kandidaten actief' vs pipeline/jobs-lijst '366'` — Job-detail toont 450 (badge 450); pipeline-pagina, /pipeline-selector én jobs-lijst tonen 366 voor dezelfde vacature. _Impact:_ Onbetrouwbare cijfers over dezelfde pipeline afhankelijk van waar je kijkt.

**[/settings/users]**
- (bug) **/settings/users 404 + 404-pagina zonder app-shell** — `/settings/users` — Route bestaat niet (404); gebruikers/rollen zit op /settings/roles. 404-pagina rendert kaal zonder zijbalk/topbalk. Geen in-app menu linkt hierheen (niet-bestaande route). _Impact:_ Verwacht pad bestaat niet; 404 verliest navigatie-context.

**[/skills]**
- (i18n) **Grafiek-legenda Engels ('Demand/Supply') in NL UI** — `/skills → 'Vraag vs aanbod' — legenda` — Legenda 'Demand'/'Supply' terwijl titel/tabel NL ('Vraag'/'Aanbod'). _Impact:_ Taalinconsistentie.

**[/sourcing-agent]**
- (ux) **Interne sprint-naam zichtbaar in de UI** — `/sourcing-agent — hero-badge` — Badge 'Sprint Q4.5 — Agentic AI sourcing' lekt interne roadmap/sprint-aanduiding naar eindgebruiker. _Impact:_ Oogt als dev-labeling in productie-UI.

**[analytics]**
- (missing-guard) **Match-score-histogram dropt negatieve cosine-scores maar telt ze in total/avg** — `apps/api/src/modules/analytics/analytics.service.ts:634` — bucket_idx=LEAST(FLOOR(score*10),9) zonder ondergrens 0; cosine-score ∈[-1,1] → negatieve bucket valt buiten 0..9 maar telt in total/AVG. _Impact:_ Som staven < total; avg_score_pct kan negatief; inconsistent histogram.
- (inconsistency) **KPI-label 'Kandidaten deze maand' telt sollicitaties + periode-mismatch** — `packages/i18n/locales/nl/analytics.json:25` — Label 'Kandidaten deze maand' hoort bij applications_this_month (telt sollicitaties; hint zegt zelf 'Nieuwe sollicitaties'). Verkeerd zn. Waarde volgt gekozen periode-from terwijl label 'deze maand' zegt (idem 'hired'). _Impact:_ Misleidend KPI-label: verkeerde eenheid + periode-aanduiding bij niet-maand-presets.
- (inconsistency) **getFunnel.conversion_rate is aandeel-van-totaal, verkeerd gelabeld en ongebruikt** — `apps/api/src/modules/analytics/analytics.service.ts:152` — conversion_rate = count/SUM(alle stages)*100 (verdeling die tot 100% optelt), geen funnel-conversie. Staat in type maar wordt nergens gerenderd. _Impact:_ Dode, misleidend genoemde output; risico op verkeerde interpretatie door toekomstige consumer.
- (i18n) **Back-office analytics hardcoded NL-strings (rest gebruikt t())** — `apps/web/app/(dashboard)/analytics/back-office/page.tsx:383-391` — 'Commissie per recruiter — MTD', omschrijving en 'Nog geen commissie geboekt deze maand.' hardcoded terwijl bestand verder useTranslation('analytics') gebruikt. _Impact:_ Titel/omschrijving/empty-state vertalen niet mee naar EN.
- (missing-guard) **Trends-tab charts missen empty-state** — `apps/web/app/(dashboard)/analytics/page.tsx:562` — Time-to-hire LineChart + applications BarChart renderen zonder guard bij lege data → lege assen; funnel/bronnen kregen wél EmptyChartState. _Impact:_ Lege Trends-tab lijkt kapot i.p.v. nette 'geen data'-melding.

**[auth]**
- (inconsistency) **SSO SP-metadata tab leest velden die de backend niet teruggeeft** — `apps/web/app/(dashboard)/settings/security/sso/page.tsx:399-401,422 vs sso.controller.ts:190-203` — Tab toont sp_entity_id/sp_acs_url/sp_metadata_url; GET config bevat die velden niet. _Impact:_ SP Entity ID/ACS/Metadata tonen altijd '—' en Download-knop rendert nooit; admin kan SP-gegevens niet uit UI kopiëren (endpoint bestaat wel).
- (security) **SAML ACS: validateInResponseTo uitgeschakeld (geen replay-binding aan AuthnRequest)** — `apps/api/src/modules/auth/sso.controller.ts:59 + saml.service.ts:279` — validateInResponseTo:false + geen AuthnRequest-ID bewaard → ongevraagde/ontkoppelde SAMLResponses geaccepteerd. Handtekening + NotOnOrAfter nog wel gevalideerd (beperkt venster). _Impact:_ Onderschepte geldig-ondertekende SAMLResponse kan binnen geldigheidsvenster opnieuw worden ingediend; zwakkere binding.

**[billing]**
- (inconsistency) **Factuurregels tonen uurtarief/aantal op 1.25-factor terwijl bedrag 1.5-basis is** — `apps/api/src/modules/billing/invoicing.service.ts:382` — billable=hours+ot*1.25 voor quantity/unit_price; line_total=amount_client (1.5). Totaal klopt, getoond tarief/aantal wijkt af. _Impact:_ Opgeblazen 'prijs per uur' + te laag urenaantal op factuur/PDF.
- (inconsistency) **timesheetsBridge fallback gebruikt 1.25 vs canonieke 1.5 (latent)** — `apps/api/src/modules/billing/timesheetsBridge.ts:131` — fallbackSummary (hours+ot*1.25)*rate vs canoniek 1.5; alleen bij falende dynamic import. _Impact:_ Latente afwijking factuurbedragen bij fallback.
- (i18n) **Factuurdetailpagina hardcoded strings (i18n-gat)** — `apps/web/app/(dashboard)/invoices/[id]/page.tsx:145` — Vrijwel alle labels/toasts/kolomkoppen hardcoded NL; alleen status-badge t(). _Impact:_ Pagina vertaalt niet mee.

**[candidates]**
- (ux) **Merge-dialog kan maar één duplicaat tegelijk samenvoegen** — `apps/web/app/(dashboard)/candidates/[id]/page.tsx:363` — MergeDialog krijgt vast duplicates[0]; service ondersteunt duplicate_ids[] maar UI biedt alleen de eerste. _Impact:_ Bij >1 duplicaat kan gebruiker de overige niet samenvoegen zonder herhaald navigeren.
- (inconsistency) **BulkActionResult-type belooft velden die API niet teruggeeft** — `apps/web/lib/types/atsExtensions.ts:250 / candidates.service.ts:1221` — Type vereist {affected,failed,errors?} maar handler retourneert alleen {affected}. _Impact:_ Consumers die failed/errors lezen krijgen undefined; verborgen contract-mismatch.

**[career-pages]**
- (tech-debt) **Admin career-page CRUD maskeert DB-fouten met mock-rows/lege lijst** — `apps/api/src/modules/career-pages/career-pages.service.ts:241-246,290-300,372-383,212-214` — get/create/updateCareerPage retourneren bij niet-AppError een mock-row; list een lege array → DB-fout als 'succes' met verzonnen id. _Impact:_ Admin denkt career page is aangemaakt/bijgewerkt terwijl niets persisteerde; fouten verborgen.
- (tech-debt) **Notes-fallback in submitApplication is dode code (transactie al aborted)** — `apps/api/src/modules/career-pages/career-pages.service.ts:849-874` — Eerste INSERT in BEGIN-transactie; bij fout is transactie aborted (25P02) → retry-zonder-notes kan nooit slagen (geen SAVEPOINT). _Impact:_ Backwards-compat fallback werkt niet; bij ontbrekende notes-kolom faalt apply alsnog.
- (missing-guard) **updateCareerPage slug-conflict → 500 i.p.v. 409 onder RLS-rol** — `apps/api/src/modules/career-pages/career-pages.service.ts:328-339` — Slug-precheck filtert niet op tenant en leunt op owner-bypass; na non-owner-cutover mist cross-tenant botsing → UPDATE raakt globale unique → 23505 niet naar 409 gemapt (create wél). Te verifiëren tegen RLS-status. _Impact:_ Latent: onder non-owner-RLS geeft cross-tenant slug-conflict 500 i.p.v. 409.
- (inconsistency) **Create-dialog mist 'agency'-template die wél ondersteund is** — `apps/web/app/(dashboard)/career-pages/page.tsx:55` — TEMPLATES mist 'agency' terwijl agency in TEMPLATE_LABELS/CareerPageTemplate staat en HeroSection agency-styling heeft. _Impact:_ Agency-template niet kiesbaar bij aanmaken hoewel render hem ondersteunt.
- (i18n) **Career-pages create-dialog + header hardcoded Nederlands (i18n-gat)** — `apps/web/app/(dashboard)/career-pages/page.tsx:453-586` — Create-dialog + PageHeader hardcoded NL terwijl CareerPageCard/TemplatePreview wél useTranslation('careerPages') gebruiken. _Impact:_ Bij EN blijven create-dialog + paginakop Nederlands.
- (inconsistency) **useSubmitApplication retourtype {id} matcht API-respons niet** — `apps/web/hooks/useCareerPages.ts:475-483` — Hook typeert apply-respons als {id} maar API geeft {success,candidate_id,application_id}. _Impact:_ data.id altijd undefined; drift die breekt zodra consumer op .id vertrouwt.

**[commissions]**
- (tenant-scope) **Marge-query mist expliciete tenant_id op timesheets/contracts join** — `apps/api/src/modules/commissions/commissions.service.ts:530` — candidate_total-query filtert alleen t.contract_id, zonder tenant_id (RLS inert). contract_id tenant-gescoped → geen aangetoonde lek. Te verifiëren. _Impact:_ Geen aangetoonde lek maar mist defense-in-depth.
- (inconsistency) **Scheme bewerken: 'type' wordt door backend genegeerd (zod strip)** — `apps/api/src/modules/commissions/commissions.routes.ts:67` — Edit-dialog stuurt type; updateSchemeBody kent geen type → gestript. Config onder nieuwe sleutels, DB houdt oude type. _Impact:_ Scheme-type wijzigen heeft geen effect; config kan niet bij type passen.

**[communications]**
- (inconsistency) **Campagne-status enum drift (frontend vs backend)** — `apps/web/app/(dashboard)/communications/campaigns/page.tsx:39-47` — Frontend kent draft/queued/running/completed/failed/paused; backend zet running/completed/cancelled/failed. 'cancelled' mist stijl+i18n-key. _Impact:_ Status 'cancelled' → lege/kapotte badge (latent).

**[compliance]**
- (inconsistency) **DSAR-status 'expired' ontbreekt in frontend labels/kleuren (contract-drift)** — `apps/web/lib/complianceLabels.ts:37-42 + DsarManagement.tsx:68-77 vs dsar.service.ts:55-60` — Backend DsarStatus omvat 'expired' maar labels/kleuren dekken dat niet → lege badge. Latent: momenteel schrijft geen codepad 'expired'. _Impact:_ Zodra een DSAR ooit 'expired' wordt (toekomstige cron) toont UI naamloze/kleurloze status.
- (bug) **Self-service token blijft na anonimisatie bruikbaar voor consent-wijziging/verwijderverzoek** — `apps/api/src/modules/compliance/selfService.service.ts:403-439,516-558` — recordCandidateConsentChange en recordCandidateDeletionRequest checken deleted_at/anonymized_at niet (andere paden wel); tokens worden bij anonimisatie niet ingetrokken. Geldige token kan consent op geanonimiseerde rij wijzigen + dubbele deletion-DSARs maken. _Impact:_ Misleidende consent/audit-registratie op geanonimiseerde kandidaten (geen PII-leak).

**[crm]**
- (i18n) **CRM zoek-placeholders + deal-stage-labels hardcoded Nederlands** — `apps/web/app/(dashboard)/crm/page.tsx:482,831 + hooks/useCrm.ts:36-42` — Zoekvelden + DEAL_STAGE_LABELS hardcoded NL terwijl rest t('crmPage') gebruikt. _Impact:_ CRM-labels/placeholders vertalen niet mee naar EN.
- (tenant-scope) **users-join in deals mist tenant-scoping (recruiter_id niet tenant-gevalideerd)** — `apps/api/src/modules/crm/deals.service.ts:60` — LEFT JOIN users u ON u.id=d.recruiter_id zonder AND u.tenant_id=d.tenant_id (org/jobs-joins wél). recruiter_id niet tegen tenant gevalideerd. _Impact:_ Onder RLS-bypass potentiële cross-tenant lek van een gebruikersnaam via geraden UUID; scoping-gap.
- (tech-debt) **Contacts/deals hard-delete terwijl schema soft-delete-kolom heeft** — `apps/api/src/modules/crm/contacts.service.ts:176` — deleteContact/deleteDeal doen harde DELETE; list/get filteren niet op deleted_at, terwijl migr 034 deleted_at + partiële index aanmaakt (organizations doet wél soft-delete). _Impact:_ Inconsistente delete-semantiek binnen CRM; ongebruikte deleted_at-kolom/index.

**[email-templates]**
- (tech-debt) **Dead code: NO_FIELDS-guard in updateEmailTemplate onbereikbaar** — `apps/api/src/modules/email-templates/email-templates.service.ts:176` — merge_variables + updated_at altijd toegevoegd → fields.length>=2; if(===1) vuurt nooit. Lege PATCH slaagt als no-op. _Impact:_ Dead code; lege PATCH bumpt updated_at.
- (i18n) **email-templates pagina geen i18n (hardcoded NL)** — `apps/web/app/(dashboard)/email-templates/page.tsx:533` — Hele pagina hardcoded NL terwijl settings/email + integrations react-i18next gebruiken. _Impact:_ Inconsistente i18n.
- (inconsistency) **Lege categorie-badge mogelijk (category kan null) + type-drift** — `apps/web/app/(dashboard)/email-templates/page.tsx:428` — categoryLabel(null) → lege badge; DB staat null toe maar shared type non-null. Te verifiëren. _Impact:_ Tekstloze categorie-badge; type verbergt null-mogelijkheid.

**[hm]**
- (bug) **HM: ontbrekende UUID-validatie op :id → 500 i.p.v. 4xx** — `apps/api/src/modules/hm/hm.controller.ts:90` — getApplicationDetails/review geven req.params.id ongevalideerd door → 22P02 → 500. _Impact:_ Malformed id → 500; log-ruis.
- (inconsistency) **reviewApplication geeft inconsistente response-shape voor 'later' vs approve/reject** — `apps/api/src/modules/hm/hm.service.ts:251` — 'later' returnt partiële SELECT; approve/reject volledige RETURNING *. _Impact:_ Frontend krijgt afhankelijk van beslissing andere/onvolledige shape.

**[inbox]**
- (inconsistency) **assignee_name wordt nooit door API teruggegeven** — `apps/api/src/modules/inbox/inbox.service.ts:220-224` — get/listThreads joinen users niet → geen assignee_name; frontend toont thread.assignee_name ?? 'noAssignee'. _Impact:_ Toegewezen threads tonen altijd 'geen toegewezen'.
- (bug) **Timeline-dedup van voice-calls werkt nooit (call_id niet op comm-rows)** — `apps/api/src/modules/inbox/inbox.service.ts:452-459` — Dedup filtert op metadata.call_id maar de comm-SELECT selecteert metadata niet en bouwt {message_id,subject}. call_id altijd undefined. _Impact:_ Een naar communications gespiegelde voice-call verschijnt dubbel in de timeline (spiegeling te verifiëren).
- (bug) **formatRelative op nullable last_message_at → 1970** — `apps/web/app/(dashboard)/inbox/page.tsx:480` — last_message_at is API-nullable maar frontend-type zegt string; new Date(null) → 1970. _Impact:_ Threads zonder bericht tonen tijd uit 1970 / verkeerde relatieve weergave.
- (missing-guard) **channelCounts indexeert op mogelijk-null last_channel → NaN** — `apps/web/app/(dashboard)/inbox/page.tsx:141` — counts[t.last_channel] += ... met nullable last_channel → NaN onder key 'null'. _Impact:_ Onbetrouwbare kanaal-badge-tellers bij threads zonder/onbekend kanaal.
- (i18n) **Verwijder-dialoog/knop hardcoded Nederlands (i18n-gat)** — `apps/web/app/(dashboard)/inbox/page.tsx:680,780,783,787,795,799` — Verwijder-teksten hardcoded terwijl de rest via useTranslation('miscInbox') loopt. _Impact:_ Deze teksten vertalen niet mee naar EN.

**[interviews]**
- (inconsistency) **Opname-uploader toont 'uploaded by undefined' (uploaded_by_name vs uploaded_by)** — `apps/web/app/(dashboard)/interviews/[id]/page.tsx:261` — Rendert uploaded_by_name; API levert uploaded_by (id). Ook transcript_status vs transcription_status. _Impact:_ 'geüpload door undefined' per opname.
- (inconsistency) **Opname-/scorecard-badges verschijnen nooit in lijst (has_recording/scorecard_count niet geleverd)** — `apps/web/app/(dashboard)/interviews/page.tsx:381` — Rendert iv.has_recording/scorecard_count; listInterviews levert ze niet. _Impact:_ Gebruiker ziet nooit of interview opname/scorecards heeft.
- (bug) **Annulerings-reden gaat verloren (notes_append vs cancel_reason) + verkeerde cache-invalidatie** — `apps/web/hooks/useInterviews.ts:64` — Stuurt notes_append (gestript); backend gebruikt cancel_reason. Cancel-tak geeft {message} → data.id undefined → invalidatet ['interview',undefined]. _Impact:_ Annuleringsreden niet opgeslagen; cache niet correct geïnvalideerd.

**[jobs]**
- (inconsistency) **Funnel-tegel labelt 'dropped' als 'Afgewezen' terwijl semantiek breder is** — `apps/web/components/jobs/tabs/JobPerformanceTab.tsx:188-190 + jobDetail.service.ts:522-528` — funnel.dropped = status NOT IN (active,hired) = rejected+withdrawn+offer_declined, maar UI labelt 'Afgewezen'. _Impact:_ 'Afgewezen' overschat echte afwijzingen (bevat teruggetrokken/afgewezen aanbod).
- (inconsistency) **useCreateJob/useUpdateJob typeren respons als JobDetail maar shape klopt niet** — `apps/web/hooks/useJobs.ts:84-88` — Respons getypt als JobDetail (met stages+recruiter_name) maar create/update geven rauwe RETURNING *-row zonder stages/recruiter_name + met embedding. _Impact:_ Consumers die .stages van create/update lezen krijgen undefined; latente drift.

**[outreach]**
- (inconsistency) **Diverse mutatie-hooks returnen {data}-wrapper i.p.v. object** — `apps/web/hooks/useNurture.ts:141 (+ useSourcing/useReorderSteps)` — useAddStep e.a. returnen rauwe body; API geeft {data:row} → draft-velden undefined. _Impact:_ Flows die mutatie-return gebruiken werken met undefined-velden.
- (inconsistency) **draft-reactivation-hook leest data.enrollment_id maar API geeft {data:enrollment}** — `apps/web/hooks/useOutreach.ts:245` — API geeft {data:enrollment} met .id; hook verwacht enrollment_id. _Impact:_ enrollment_id undefined (nu alleen toast, lage impact).
- (tech-debt) **Inbound-webhook: candidate_external_id geparsed maar nooit doorgegeven aan recordReply** — `apps/api/src/modules/outreach/inboundWebhook.routes.ts:101` — Schema accepteert candidate_external_id; recordReply krijgt alleen thread-velden → zonder match 400 CANNOT_LINK_REPLY. _Impact:_ Replies zonder thread-match geweigerd hoewel kandidaat-id meegestuurd.

**[pipeline]**
- (bug) **Activity-log labelt fase→NULL move als 'status_changed'** — `apps/api/src/modules/pipeline/pipeline.service.ts:429` — action = data.stage_id ? 'stage_changed' : 'status_changed'; bij expliciete stage_id=null is het feitelijk een fase-wijziging (audit-log doet het wél correct met !== undefined). _Impact:_ Timeline toont fout label bij fase leegmaken; inconsistentie activity vs audit.
- (ux) **Dode '+'-knop per kolomkop zonder handler/aria-label** — `apps/web/components/pipeline/KanbanColumn.tsx:35` — Plus-knop per fase-kolom heeft geen onClick + geen aria-label; klikken doet niets. _Impact:_ Suggereert 'kandidaat aan fase toevoegen' maar niet functioneel; verwarrend + niet toegankelijk.
- (inconsistency) **ApplicationStatus-type mist 'withdrawn'** — `apps/web/lib/mockData.ts:46 / pipeline.controller.ts:26` — API staat status active|rejected|withdrawn|hired toe; frontend-type mist 'withdrawn' (gemaskeerd door status='active'-filter). _Impact:_ Type dekt API-set niet; toekomstige withdrawn-UI zou typefouten geven.

**[reports]**
- (tech-debt) **aggregateChart met group_by negeert series na series[0]** — `apps/api/src/lib/reports/aggregator.ts:801,733` — Bij group_by wordt per punt alleen series[0].key gelezen; overige series vallen stil weg. baseEntity ook alleen uit series[0]. _Impact:_ Multi-series grafiek met groepering toont alleen eerste metric; stille weglating zonder foutmelding.

**[settings]**
- (i18n) **Hardcoded NL 'terug'-link op availability-pagina (i18n-gat)** — `apps/web/app/(dashboard)/settings/availability/page.tsx:258` — Tweede 'Terug naar instellingen' hardcoded terwijl eerste identieke t() gebruikt. _Impact:_ Deze link blijft NL bij taalwissel.

**[sourcing]**
- (tech-debt) **findStaleRuns is lege placeholder die de input teruggeeft als 'count'** — `apps/api/src/modules/sourcing/runs.service.ts:770` — Geen query; returnt autoCloseDays. _Impact:_ Cron krijgt misleidende data; stale runs nooit auto-afgesloten.

**[timesheets]**
- (inconsistency) **TimesheetSummary-type + useTimesheetSummary mismatchen API-shape (latent)** — `apps/web/lib/types/backOffice.ts:89` — Type verwacht total_revenue/margin_amount/weeks; API geeft total_amount_candidate/client/by_week; hook pakt {data} niet uit. Hooks nergens aangeroepen → latent. _Impact:_ Zodra gebruikt: velden undefined (kans op .toFixed-crash).

**[users]**
- (bug) **Users: ontbrekende UUID-validatie op :id → 500 i.p.v. 4xx** — `apps/api/src/modules/users/users.controller.ts:63` — updateUser/deactivateUser zonder uuid()-validatie → 22P02 → 500. _Impact:_ Malformed id → 500.

**[webhooks]**
- (tenant-scope) **getWebhookLogs inner-query mist tenant_id (leunt op ownership-check + RLS)** — `apps/api/src/modules/webhooks/webhooks.service.ts:251` — webhook_deliveries WHERE alleen subscription_id; afgedekt door voorafgaande ownership-check + withTenant. Bij afwezige RLS → latente lek. Te verifiëren. _Impact:_ Bij afwezige RLS delivery-logs buiten tenant lekbaar; nu afgedekt.

**[whatsapp]**
- (ux) **Consent 'Opnieuw uitnodigen' opent leeg invite-dialog zonder kandidaat** — `apps/web/app/(dashboard)/settings/whatsapp/page.tsx:1117` — Reinvite-knop roept alleen setInviteOpen(true); geen candidate_id/telefoon voorgevuld. _Impact:_ Verwarrende flow; kans op verkeerde kandidaat.
- (tech-debt) **Cursor-paginatie kan rijen met identieke created_at overslaan/dupliceren** — `apps/api/src/modules/whatsapp/consent.service.ts:413` — listConsents/Messages/Templates sorteren op created_at,id maar pagineren op alleen created_at<cursor; mist id-tiebreaker. _Impact:_ Zeldzame gemiste/dubbele items bij gelijke timestamps.
- (inconsistency) **Contract-drift: useSendWhatsAppMessage stuurt variables als object, backend verwacht array** — `apps/web/hooks/useWhatsApp.ts:236` — Hook typeert Record; backend valideert z.array; connector doet .map. Te verifiëren of aanroeper al array stuurt. _Impact:_ Template-berichten met variabelen kunnen 400/500 geven.
- (bug) **Media-bericht buiten 24u-venster niet geblokkeerd (geen window/template-check)** — `apps/api/src/modules/whatsapp/messaging.service.ts:161` — media checkt alleen mediaUrl-aanwezigheid; geen 24u-window/template-vereiste (text wél). Te verifiëren of bewust. _Impact:_ Media buiten venster gaat queue in en faalt pas bij 360dialog i.p.v. nette 409.

**[workflows]**
- (tech-debt) **listWorkflows/getWorkflowRuns slikken fouten en returnen []** — `apps/api/src/modules/workflows/workflows.service.ts:58,215` — Bij DB-fout log + lege array; controller stuurt {data:[]}. _Impact:_ Storingen als valse lege staat gepresenteerd.
- (i18n) **i18n-restanten: create-dialog/pagina hardcoded NL** — `apps/web/app/(dashboard)/workflows/page.tsx:557` — CreateWorkflowDialog/StepIndicator/toasts/labels hardcoded; TRIGGER_LABELS/ACTION_LABELS hardcoded. _Impact:_ Inconsistente i18n-dekking.

