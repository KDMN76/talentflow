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
