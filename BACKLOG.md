# BACKLOG.md

Bugs en losse eindjes die tijdens scoped werk opgevallen zijn maar **niet** in
de actieve sprint horen. Niet fixen zonder expliciete instructie. Zie
`LAUNCH_PLAN.md` voor sprint-prioritering.

---

## fix-morgen

### 1. Vacature-detail pagina crasht — `TypeError: Cannot read properties of undefined (reading 'map')`

- **Pad:** `/jobs/[id]` (component: `apps/web/app/(dashboard)/jobs/[id]/page.tsx` of een child-tab daarvan)
- **Trigger:** klik vanaf vacaturelijst op een job-detail-link
- **Symptoom:** witte pagina, `Application error: a client-side exception has occurred`
- **Waarschijnlijke oorzaak:** een sub-component itereert op een veld dat backend niet retourneert of dat NULL is (denk aan `stages`, `team_members`, `notes`, `requirements`, `tags` op de job-detail-response). Vergelijkbaar root-cause-patroon als de vacaturelijst-fix die ik vandaag deed.
- **Geverifieerd vandaag** (2026-05-16) met de job `6e99ee73-11f2-4e38-97f4-94afe843acf8` in kdmn tenant.
- **Fix-aanpak (later):**
  - Vergelijk frontend `JobDetailPage` props met backend `GET /jobs/:id` response shape (`apps/api/src/modules/jobs/jobs.service.ts` `getJob()`).
  - Per tab-component (`JobOverzichtTab`, `JobActiviteitTab`, `JobTeamTab`, `JobDistributionTab`) een null-guard op `.map()` calls en arrays die ontbreken.
  - Overweeg `JobTabBoundary` per tab in zelfde stijl als `JobRowBoundary` zodat één kapotte tab niet de hele detail-view sloopt.
- **Out of scope vandaag** want bugfix-opdracht was alleen lijst-render.

### 2. `POST /api/jobs` via UI faalt met HTTP 400, identieke payload via curl werkt wel

- **Pad:** form op `/jobs/new`, hook `useCreateJob` (in `apps/web/hooks/useJobs.ts`)
- **Trigger:** vul Titel + Afdeling + Locatie + Omschrijving, klik "Vacature aanmaken"
- **Symptoom:** toast "Fout — Vacature kon niet worden aangemaakt", form blijft open, geen redirect.
- **Geverifieerd vandaag** dat dezelfde minimale payload via direct `curl POST /api/jobs` (zonder optionele velden) WEL een 201 + nieuw job-record geeft. Dus de mismatch zit tussen wat de form bouwt en wat de Zod-schema in `apps/api/src/modules/jobs/jobs.controller.ts` accepteert.
- **Mogelijke kandidaten** (zonder onderzocht te hebben):
  - Form stuurt `recruiter_id: ""` ipv weglaten — backend Zod gooit "Invalid UUID".
  - Form stuurt `requirements: ""` waar `string[]` of niets verwacht wordt.
  - Form stuurt `salary_min: 0` ipv weglaten — kan onder schema-minimum vallen.
  - Form stuurt extra default-velden die niet in het accept-schema staan en de Zod `.strict()`-modus afwijst.
- **Fix-aanpak (later):**
  - Open browser DevTools netwerk-tab op `/jobs/new`, inspecteer exact request-body.
  - Match tegen `createJobSchema` in `apps/api/src/modules/jobs/jobs.controller.ts`.
  - Strip lege strings / undefined velden in de form-payload vóór POST, of relax het Zod-schema waar logisch.
- **Out of scope vandaag** want opdracht was render-fix, niet form-flow.

### 3. Backend `GET /jobs` SELECT bevat geen `description`

- **Pad:** `apps/api/src/modules/jobs/jobs.service.ts` → `listJobs()`
- **Geverifieerd**: frontend `Job` interface in `apps/web/lib/mockData.ts` zegt `description: string` (required), maar backend `listJobs` haalt het veld niet op. Resultaat: `job.description` is `undefined` op runtime — geen crash op lijst zelf (JobCard rendert hem niet), maar potentieel issue voor toekomstige componenten die `description` aannemen.
- **Fix-aanpak (later):** voeg `j.description` toe aan de SELECT-list — kost niets en lost type-mismatch op.
- **Out of scope vandaag** want **opdracht zei expliciet** geen backend API-contract aanpassen.

---

## fix-binnenkort (niet kritiek)

### 4. PWA-manifest klaagt over deprecated `apple-mobile-web-app-capable` en mist `icon-192.png`

- **Symptoom:** console warning + 404 bij elke page load.
- **Fix:** vervang meta-tag door `<meta name="mobile-web-app-capable">`, plaats correcte icon-files in `apps/web/public/icons/`.

### 5. Express rate-limit waarschuwing over `trust proxy` op elke request

- **Pad:** `apps/api/src/index.ts`
- **Symptoom:** `ValidationError: The 'X-Forwarded-For' header is set but the Express 'trust proxy' setting is false` — gespamd in API logs.
- **Fix:** `app.set('trust proxy', 1)` direct na `const app = express()`. Nodig omdat Nginx ervoor zit en `req.ip` nu loopback is ipv echte client-IP.

### 6. pg `client.query()` deprecation warning

- **Symptoom:** `DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0`
- **Pad:** ergens in een service die `await client.query(...)` chained zonder await; vermoedelijk in `withTenant()` helper of een specifieke worker.
- **Fix:** track-down met `node --trace-deprecation` op de container, dan `await` correct toepassen.
