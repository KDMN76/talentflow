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
