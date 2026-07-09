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
