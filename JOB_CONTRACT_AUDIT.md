# JOB_CONTRACT_AUDIT.md

**Datum:** 2026-05-17
**Scope:** entiteit `Job` (vacatures). Research-only — geen code aangepast.
**Doel:** fundament voor Fase 2 (shared contracts laag tussen frontend en backend).

---

## 1. Samenvatting

De `Job`-entiteit heeft op dit moment **vier verschillende, gedeeltelijk-overlappende contract-definities** (DB-schema, backend Zod, backend SELECT, frontend TS) die geen van allen elkaars autoriteit erkennen. Er zijn **vier verschillende `Job`-of-Job-derived TypeScript types** in de frontend (`mockData.ts`, `shared/types/job.ts`, `JobManatalFields`, `JobDetailExtended`) die elkaar tegenspreken op nullable-ness, enum-waarden en welke velden er bestaan. De backend `listJobs` SELECT laat 13 van de 34 DB-kolommen vallen (waaronder `description`); de frontend `JobForm` stuurt twee velden die de backend Zod-schema afwijst (`salary_min: null` ipv weggelaten + een verzonnen `requirements`-veld); en de frontend-type voor `JobHealthBreakdown` heeft een gefantaseerde `components: []`-eigenschap die het backend response-shape niet retourneert (resulterend in de detail-pagina crash). Geen enkele plek treedt op als single source of truth, geen contract wordt op runtime gevalideerd in beide richtingen, en de IDE biedt geen safety net omdat de types zelf inconsistent zijn. Een shared `packages/shared`-package met Zod-schemas als single source of truth en geïnferenceerde TS-types is technisch onvermijdbaar voordat we Sprint 1 (core recruiter flow) responsibele kunnen bouwen.

---

## 2. Job velden — overzicht (alle kolommen, alle lagen)

Legenda: **R** = required, **O** = optional / nullable, **—** = veld bestaat niet, **DEF** = heeft DB-default, `T` = type-aanduiding.

| Veld | DB (Postgres) | Backend Zod `jobBodySchema` (POST) | Backend Zod `updateJobSchema` (PATCH) | Backend SELECT `listJobs` | Backend SELECT `getJob` | FE type `Job` (mockData) | FE type `Job` (shared) | FE form (`/jobs/new`) |
|---|---|---|---|---|---|---|---|---|
| `id` | R `uuid` DEF | — | — | ✅ | ✅ (via `j.*`) | R `string` | R `string` | — (server) |
| `tenant_id` | R `uuid` FK | — (uit JWT) | — | ❌ (niet in SELECT) | ✅ | R `string` | R `string` | — |
| `title` | R `text` | R `string(1..200)` | O | ✅ | ✅ | R `string` | R `string` | R `string >=2` |
| `description` | O `text` | O `string` | O | **❌ ontbreekt** | ✅ | **R `string`** | O `string \| null` | R `string >=10` |
| `department` | O `text` | O `string(0..100)` | O | ✅ | ✅ | **R `string`** | O `string \| null` | R `string >=1` |
| `location` | O `text` | O `string(0..200)` | O | ✅ | ✅ | **R `string`** | O `string \| null` | R `string >=1` |
| `salary_min` | O `integer` | O `number int >=0` | O | ✅ | ✅ | O `number \| null` | O `number \| null` | O `string` → `Number()` of `null` |
| `salary_max` | O `integer` | O `number int >=0` | O | ✅ | ✅ | O `number \| null` | O `number \| null` | O idem |
| `employment_type` | O `text` DEF `'fulltime'` (geen DB-check) | O enum `['fulltime','parttime','contract','freelance','internship']` | O | ✅ | ✅ | O `string` | O `EmploymentType \| string` | — |
| `status` | R `text` DEF `'draft'` (geen DB-check) | O enum `['draft','open','filled','closed','archived']` | O | ✅ | ✅ | R `JobStatus = 'draft' \| 'open' \| 'filled' \| 'closed'` (**geen `archived`**) | R `'draft' \| 'open' \| 'filled' \| 'closed' \| 'archived'` | — (server defaults `draft`) |
| `recruiter_id` | O `uuid` FK | O `uuid().optional().nullable()` | O | ✅ | ✅ | **R `string`** | O `string \| null` | — (form stuurt niet) |
| `deleted_at` | O `timestamptz` | — | — | ❌ (gefilterd) | ✅ | O `string \| null` | R `string \| null` | — |
| `created_at` | O `timestamptz` DEF `now()` | — | — | ✅ | ✅ | R `string` | R `string` | — |
| `updated_at` | O `timestamptz` DEF `now()` | — | — | ✅ | ✅ | R `string` | R `string` | — |
| `embedding` | O `vector(1536)` | — | — | ❌ | ✅ (niet bedoeld in client) | — | — | — |
| `embedding_updated_at` | O `timestamptz` | — | — | ❌ | ✅ | — | — | — |
| `job_reference` | O `text` UNIQUE | O regex `[A-Z0-9-]{4..40}` | O | ✅ | ✅ | O `string \| null` | O `string \| null` | — (server auto-genereert) |
| `headcount` | O `integer` DEF `1` | O `int(1..999)` | O | ✅ | ✅ | O `number \| null` | O `number \| null` | — |
| `experience_level` | O `text` CHECK `['junior','medior','senior','lead']` | O enum **matches DB** | O | ✅ | ✅ | O enum **`['intern','junior','medior','senior','lead','director'] \| string`** (mismatch met DB) | O `'junior' \| 'medior' \| 'senior' \| 'lead'` | — |
| `contract_type` | O `text` CHECK `['fulltime','parttime','contract','temp']` | O enum **matches DB** | O | ✅ | ✅ | O enum **`['fulltime','parttime','contract','freelance','internship']`** (mismatch — `freelance`/`internship` bestaan niet in DB, mist `temp`) | O `['fulltime','parttime','contract','temp']` | — |
| `contract_details` | O `text` | O `string(0..2000)` | O | ❌ | ✅ | O | O | — |
| `open_date` | O `date` | O ISO-date regex | O | ✅ | ✅ | O `string \| null` | O | — |
| `close_date` | O `date` | O ISO-date regex | O | ✅ | ✅ | O `string \| null` | O | — |
| `industry` | O `text` | O `string(0..120)` | O | ✅ | ✅ | O | O | — |
| `remote_type` | O `text` CHECK `['onsite','hybrid','remote']` | O enum **matches DB** | O | ✅ | ✅ | O | O | — |
| `office_address` | O `text` | O `string(0..500)` | O | ❌ | ✅ | O | O | — |
| `package_details` | O `text` | O `string(0..2000)` | O | ❌ | ✅ | O | O | — |
| `currency` | O `text` DEF `'EUR'` | O `string(2..8)` | O | ✅ | ✅ | O | O | — |
| `salary_frequency` | O `text` CHECK `['monthly','annual','hourly']` | O enum **matches DB** | O | ✅ | ✅ | O **`['hourly','monthly','yearly'] \| string`** (mismatch — `yearly` bestaat niet, mist `annual`) | O `'monthly' \| 'annual' \| 'hourly'` | — |
| `required_skills` | O `text[]` DEF `'{}'` | O `string[]` (max 50) | O | ❌ | ✅ | — | O `string[] \| null` | — |
| `nice_to_have_skills` | O `text[]` DEF `'{}'` | O `string[]` (max 50) | O | ❌ | ✅ | — | O `string[] \| null` | — |
| `pay_transparency_required` | O `boolean` DEF `true` | — | — | ❌ | ✅ | — | — | — |
| `salary_band_disclosed` | O `boolean` GENERATED | — | — | ❌ | ✅ | — | — | — |
| `compensation_criteria` | O `text` | — | — | ❌ | ✅ | — | — | — |
| **`recruiter_name`** (JOIN `users.name`) | — (geen kolom) | — | — | ✅ (`u.name as recruiter_name`) | ✅ | **R `string`** | O `string \| null` | — |
| **`application_count`** (COUNT) | — | — | — | ✅ (`COUNT(...) as application_count`) | ❌ (niet hydrated) | **R `number`** | — (mist) | — |
| **`stages`** (hydrated) | — | — | — | ❌ | ✅ (extra query) | O `PipelineStage[]` | O `PipelineStage[]` | — |
| **`requirements`** (frontend-fantasie) | — | — | — | — | — | O `string[]` (comment zegt "parsed from description") | — | **R verzonnen veld** in submit payload |
| **`client`** (frontend-fantasie) | — (geen DB-kolom!) | — | — | — | — | O via `JobManatalFields` | — | — |
| **`client_logo_url`** | — | — | — | — | — | O via `JobManatalFields` | — | — |
| **`owner_id` / `owner_name`** | — | — | — | — | — | O via `JobManatalFields` | — | — |

**Tellingen:**
- DB-kolommen: 34 (incl. 1 generated)
- Backend `jobBodySchema` accepteert: 22 velden
- Backend `listJobs` SELECT: 23 velden (incl. `recruiter_name` + `application_count` hydration), **13 DB-kolommen DROPT** waaronder `description`, `contract_details`, `office_address`, `package_details`, `required_skills`, `nice_to_have_skills`, `tenant_id`, `deleted_at`, `embedding*`, `pay_transparency_required`, `salary_band_disclosed`, `compensation_criteria`
- Backend `getJob` SELECT: **alle DB-kolommen** (via `j.*`) + hydratie `recruiter_name` + `stages` (geen `application_count`)
- Frontend `Job` (mockData): 22 velden, waarvan 8 inkorrect required of mismatched
- Frontend `Job` (shared/types): 24 velden, beter aligned maar nergens daadwerkelijk geïmporteerd

---

## 3. Backend Zod schemas — overzicht per endpoint

### `paginationSchema` (gebruik: GET `/jobs` query string)
```ts
{ page: number≥1 default 1, limit: number 1..100 default 20,
  status: string optional, recruiter_id: uuid optional }
```
**Issue:** `status` is plain `string`, niet de `JobStatus` enum — willekeurige strings worden geaccepteerd en geforward naar SQL `WHERE j.status = $`.

### `jobBodySchema` (gebruik: POST `/jobs`)
Zie tabel hierboven. Alle velden behalve `title` zijn `.optional()`. **Niet `.strict()`** — onbekende velden worden stilletjes gedropt.

### `updateJobSchema` (gebruik: PATCH `/jobs/:id`)
`jobBodySchema.partial().omit({ pipeline_template_id: true })`. Dus alle velden inclusief `title` optional.

### `applyPipelineTemplateSchema` (gebruik: POST `/jobs/:id/pipeline-template`)
`{ pipeline_template_id: uuid optional }`

---

## 4. Backend SQL queries — exact

| Functie | Kolommen | JOINs | WHERE | Bijzonderheden |
|---|---|---|---|---|
| `listJobs` | 21 jobs.* + `u.name as recruiter_name` + `COUNT(a.id) as application_count` | `LEFT JOIN users u ON u.id = j.recruiter_id`, `LEFT JOIN applications a ON a.job_id = j.id AND a.status='active'` | `tenant_id = $1 AND deleted_at IS NULL` [+optional `status`/`recruiter_id`] | GROUP BY `j.id, u.name`; ORDER BY `created_at DESC` |
| `getJob` | `j.*` + `u.name as recruiter_name` | `LEFT JOIN users u ON u.id = j.recruiter_id` | `id = $1 AND tenant_id = $2 AND deleted_at IS NULL` | + secundaire query naar `pipeline_stages` met COUNT applications; merged in `{ ...job, stages }` |
| `createJob` | Dynamisch via `buildInsertColumns(payload, 2)` uit `MUTABLE_JOB_COLUMNS` (24 velden) | — | INSERT | Auto-genereert `job_reference` als ontbreekt, retry on collision; defaults `employment_type='fulltime'`, `status='draft'` |
| `updateJob` | Dynamisch via `MUTABLE_JOB_COLUMNS`-filter op `data` | — | `id = $.. AND tenant_id = $..` | Schrijft `updated_at=now()`, fail als 0 velden mee |
| `getJob.stages` | `ps.id, ps.name, ps.position, ps.color, COUNT(a.id) as application_count` | `LEFT JOIN applications a ON a.stage_id = ps.id AND a.status='active'` | `ps.job_id=$1 AND ps.tenant_id=$2` | ORDER BY position |
| `duplicateJob` | INSERT clone met nieuwe `job_reference`, status forced naar `'draft'`, title gesuffixed | — | INSERT + secundaire stage-clone | — |
| `deleteJob` | `UPDATE SET deleted_at=now()` | — | `id=$1 AND tenant_id=$2 AND deleted_at IS NULL` | Soft-delete |
| `getJobStats` | applications grouped by stage + status + totaal/recent | — | — | Geen jobs-kolommen retourneert |

`MUTABLE_JOB_COLUMNS` (gebruikt door create + update): 24 velden, mist t.o.v. DB: `pay_transparency_required`, `salary_band_disclosed` (generated), `compensation_criteria`, `embedding`, `embedding_updated_at`, `tenant_id`, `id`, `deleted_at`, `created_at`, `updated_at`.

---

## 5. Backend TypeScript types

Eén ding bestaat: `apps/api/src/modules/jobs/jobs.service.ts:172` — `interface CreateJobInput`. Verder **geen** Job-interface aan de backend-kant. Geen response-DTO type, geen `JobRecord` type, niets.

`CreateJobInput` accepteert alle velden als `string | null | undefined` of `number | null | undefined` (alleen `title` is `string` required). **Maar:** Zod-schema `jobBodySchema` accepteert alleen `T | undefined` (geen `null`) voor de meeste optionals — dus de TS-interface is permissiever dan wat ECHT werkt op de POST-route.

---

## 6. Frontend types

### A. `apps/web/lib/mockData.ts:56` — `interface Job extends JobManatalFields`
Dit is wat **de hooks en componenten in de praktijk importeren**. Bevat:
- 8 verkeerd-required velden (`description`, `department`, `location`, `recruiter_id`, `recruiter_name`, `application_count`) terwijl ze in DB nullable zijn
- `JobStatus = 'draft'|'open'|'filled'|'closed'` (mist `archived`)
- Frontend-fantasie `requirements?: string[]` met de comment "parsed from description on the backend" — wat **niet gebeurt**

### B. `apps/web/lib/shared/types/job.ts:45` — `interface Job`
Bedoeld als canonical, maar **wordt nergens geïmporteerd door productie-code**. Inhoudelijk beter aligned: `description: string | null`, `recruiter_name?: string | null`, `JobStatus` incl. `archived`, `JobContractType` matcht DB (incl. `temp`). Mist `application_count`.

### C. `apps/web/lib/types/jobDetail.ts:177` — `interface JobManatalFields`
Extra-velden-overlay die op `Job` (variant A) ge-extend wordt. Bevat:
- `client`, `client_logo_url`, `owner_id`, `owner_name` — **bestaan niet in DB**
- `experience_level` enum `['intern','junior','medior','senior','lead','director']` — DB-CHECK accepteert **alleen** `['junior','medior','senior','lead']`
- `contract_type` enum `['fulltime','parttime','contract','freelance','internship']` — DB-CHECK accepteert `['fulltime','parttime','contract','temp']`
- `salary_frequency` enum `['hourly','monthly','yearly']` — DB-CHECK accepteert `['monthly','annual','hourly']`

### D. `apps/web/lib/shared/types/job-detail.ts:43` — `interface JobDetailExtended`
Apart type voor detail-view. Vrijwel ongebruikt (alleen door 1-2 sub-componenten).

### E. Form schema `apps/web/components/jobs/JobForm.tsx:30` — `jobSchema`
```ts
z.object({
  title: z.string().min(2),
  department: z.string().min(1),
  location: z.string().min(1),
  description: z.string().min(10),
  requirements_raw: z.string().optional(),   // textarea, frontend-only
  salary_min: z.string().optional(),         // STRING, niet number
  salary_max: z.string().optional(),
})
```

`onSubmit` mapt naar:
```ts
createJob.mutateAsync({
  title, department, location, description,
  salary_min: data.salary_min ? Number(data.salary_min) : null,   // ← null
  salary_max: data.salary_max ? Number(data.salary_max) : null,   // ← null
  requirements: data.requirements_raw ? [..split..] : [],         // ← veld bestaat niet backend
})
```

### F. `JobCardProps` (`components/jobs/JobCard.tsx:32`) — `{ job: Job }`. Gebruikt: `id, title, status, department, location, application_count, recruiter_name, created_at` (alle 8 nu null-safe-rendered sinds gistermiddag).

### G. `JobDetailHeaderProps` — gebruikt: `id, title, status, location, job_reference, remote_type, contract_type, client, owner_name, recruiter_name, department`. `client` en `owner_name` zijn altijd undefined uit backend.

### H. `useJobs()` hook return — `{ data: Job[] }`. Type cast tegen `Job` (mockData-variant), runtime niet gevalideerd.

### I. `useJob(id)` hook return — `Job & { stages: unknown[] }`. `stages` als `unknown[]` is een rode vlag.

### J. `useJobHealth(id)` hook return — typed als `JobHealthBreakdown`, maar backend geeft `{ health_score, days_open, candidates_total, velocity_score, drop_off_score, recency_score, predicted_close_date, computed_at, weights }`. Frontend type verwacht `{ job_id, score, components: JobHealthSubScore[], predicted_close_date, days_open }`. Geen enkel veld matcht behalve `predicted_close_date` en `days_open`.

---

## 7. Mismatches — alle gevonden, met bug-attributie

Volgorde: meest impactvol bovenaan.

1. **`useJobHealth` shape volledig mismatch met backend response** — frontend verwacht `health.components: []`, backend levert `health_score`/`velocity_score`/etc. → **VEROORZAAKT de detail-page crash** (`TypeError: Cannot read properties of undefined (reading 'map')` op `JobOverzichtTab.tsx:256`).
2. **Form stuurt `salary_min: null`/`salary_max: null` waar Zod `.optional()` is** — `optional()` is `T | undefined`, niet nullable. Backend gooit Zod `400` "Expected number, received null". → **VEROORZAAKT de form 400 op POST `/jobs` via UI** (`apps/web/components/jobs/JobForm.tsx:106-107`).
3. **Form stuurt `requirements: string[]`** — staat **niet** in `jobBodySchema`. Wordt door Zod's default-mode stilletjes gedropt. → Geen crash, maar het invoer-veld voor "Vereisten" wordt **nergens opgeslagen** — sluipende data-loss.
4. **`listJobs` SELECT mist `description`** — frontend `Job` interface (variant A) zegt `description: string` required. Op runtime is hij `undefined` op alle list-rows. → Crash-risico voor elke component die `job.description.length` of `.slice()` doet zonder guard. Vandaag toevallig niet getroffen in `JobCard` na fix gisteren.
5. **`Job.recruiter_id` is `string` required in frontend type** — DB laat `NULL` toe; form stuurt nooit een waarde. → **Veroorzaakte de oorspronkelijke vacaturelijst render-crash** (gisteren gefixt met defensieve render + error boundary, maar het type-contract klopt nog steeds niet).
6. **`Job.recruiter_name` is `string` required (mockData variant)** — backend LEFT JOIN geeft `null` als `recruiter_id` null is. → Veroorzaakte dezelfde lijst-crash via `getInitials(null)`. Gefixt op render-niveau, niet type-niveau.
7. **`Job.application_count` is `number` required** — backend geeft het terug als **string** (`COUNT(...)::text` zonder ::int cast). → JobCard had `{job.application_count} sollicitanten` wat `"0 sollicitanten"` gaf ipv `0 sollicitanten`. Gisteren defensief gefixt met `Number()` coerce; type liegt nog steeds.
8. **`JobStatus` mismatch: mockData mist `'archived'`** — backend Zod en DB accepteren `'archived'`. Als ooit een archived job uit de DB komt, gaat `statusConfig[job.status]` fallback naar `draft`. Silent fout.
9. **`JobManatalFields.contract_type` enum: `freelance`/`internship`, mist `temp`** — DB CHECK accepteert `temp`. Tegelijk: backend Zod's `employment_type` enum heeft `'freelance'`/`'internship'` maar DB heeft daarvoor geen CHECK. **Twee enums die met elkaar verward worden** (`employment_type` vs `contract_type` — beide bestaan in jobs-tabel en in Zod, met verschillende semantiek). Vrijwel zeker een silent data-corruption-risico bij PATCH.
10. **`JobManatalFields.experience_level` enum bevat `intern`, `director`** — DB CHECK weigert beide. Eventuele PATCH met die waarden → DB constraint violation → 500.
11. **`JobManatalFields.salary_frequency` heeft `yearly`** — DB CHECK accepteert `annual`. Idem 500 bij PATCH.
12. **`JobManatalFields.client`, `client_logo_url`, `owner_id`, `owner_name` bestaan niet in DB** — als de form ooit deze velden meestuurt: silent drop door Zod (niet in jobBodySchema). Read-only consumers (JobDetailHeader) renderen `undefined`. Past nu een `?? department ?? "—"` toe op `client`. Klant-data bestaat nergens in het systeem (geen `clients` tabel — al opgemerkt in eerdere DB-audit).
13. **Form-veld `requirements_raw` heeft tegenhanger `requirements: string[]` in mockData-type, met comment "parsed from description on the backend"** — dat parsen gebeurt niet. Pure fictie.
14. **Backend Zod `paginationSchema.status: z.string()`** ipv enum — accepteert willekeurige strings die richting SQL gaan zonder validatie. Niet exploit-able (geparameteriseerde query) maar laat tikfouten als `'opn'` stilletjes 0 resultaten geven.
15. **`Job` type heeft 4 verschillende definities** (mockData, shared/types/job, JobDetailExtended, JobManatalFields-overlay) die elkaar tegenspreken. IDE-types geven geen warning bij mismatch want elk component kiest z'n eigen variant. Maintenance-hel.
16. **`useJob(id)` return type heeft `stages: unknown[]`** — geen type-safety op de meest-getoonde nested data. Een typo in `stage.name` bij rendering wordt niet door TS gevangen.
17. **`Job.tenant_id` is required in TS** — backend `listJobs` SELECT geeft het **niet** terug. Type liegt; component-code die ergens `job.tenant_id` leest krijgt `undefined`.
18. **`paginationSchema.recruiter_id: z.string().uuid()`** — werkt, maar wanneer frontend de "Mijn open jobs" quick-filter activeert met een lege JWT (current user is `null`), zou de URL `recruiter_id=undefined` worden — bug die we al via `f.recruiter_id === currentUserId` met null-guard geneutraliseerd hebben. Type-laag biedt geen safety.

---

## 8. Concrete bug-attributies (samenvattend)

| Bug | Root cause-veld(en) | Welke mismatch |
|---|---|---|
| **Vacature-detail crash `TypeError ... 'map'`** | `health.components` | Frontend type `JobHealthBreakdown.components` bestaat niet in backend response (mismatch #1) |
| **Form POST `/jobs` 400 via UI, curl werkt** | `salary_min`, `salary_max` | Form stuurt `null`, Zod `.optional()` = `T \| undefined` (mismatch #2). Bonus: `requirements` veld bestaat niet (#3) |
| **`description` ontbreekt in lijst** | `description` | Backend `listJobs` SELECT laat `description` weg, frontend `Job` type zegt required (#4) |
| **Vacaturelijst render-crash (gisteren gefixt op renderlaag)** | `recruiter_name` NULL → `getInitials(null)` | Frontend type zegt `recruiter_name: string` required, DB LEFT JOIN geeft `null` (#5, #6) |
| **`application_count` als "0 sollicitanten"-string** | `application_count` als text uit `COUNT()` | Type zegt `number`, backend geeft string (#7) |
| **Silent dropped form-input "Vereisten"** | `requirements_raw` → `requirements` | Backend Zod kent het veld niet, Zod default = drop (#3) |
| **PATCH `/jobs/:id` met `experience_level='intern'` of `salary_frequency='yearly'`** | Frontend enum-mismatch | DB CHECK weigert (#10, #11) → 500 |

---

## 9. Aanbevolen aanpak Fase 2

### 9.1 Architectuur

**Eén `packages/shared/contracts` workspace-package** als single source of truth. **Geen nieuwe library** — pure Zod, al in monorepo aanwezig.

```
packages/shared/contracts/
  src/
    job/
      schema.ts          # Zod-schemas (DB-row, request, response per endpoint)
      types.ts           # TypeScript-types via z.infer<>
      constants.ts       # enum-arrays als const + helpers
      index.ts           # public re-export
    candidate/           # later, zelfde patroon
    application/
    common/
      pagination.ts      # gedeelde page/limit/total schema
      errors.ts          # gedeelde error-response shape
    index.ts
  package.json           # name "@talentflow/contracts", exports per entiteit
  tsconfig.json
```

Backend importeert: `import { jobCreateSchema, type JobRow } from '@talentflow/contracts/job'`.
Frontend importeert: hetzelfde.

### 9.2 Schema-laag — per entiteit drie soorten schemas

```ts
// 1. DB-row schema — wat de DB letterlijk teruggeeft. Eén-op-één met SQL-kolommen.
export const jobRowSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  // ...alle 34 kolommen, exact-nullable per DB-schema
  status: z.enum(['draft', 'open', 'filled', 'closed', 'archived']),
  experience_level: z.enum(['junior', 'medior', 'senior', 'lead']).nullable(),
  contract_type: z.enum(['fulltime', 'parttime', 'contract', 'temp']).nullable(),
  salary_frequency: z.enum(['monthly', 'annual', 'hourly']).nullable(),
  application_count: z.coerce.number().int().nonnegative().optional(),  // pg COUNT komt als string
  recruiter_name: z.string().nullable().optional(),  // hydration field
  // ...
});

// 2. Endpoint-specifieke response schemas — afgeleid via .pick()/.omit()
export const jobListItemSchema = jobRowSchema.pick({
  id: true, title: true, status: true, department: true, location: true,
  salary_min: true, salary_max: true, recruiter_id: true, recruiter_name: true,
  application_count: true, created_at: true, updated_at: true,
  job_reference: true, employment_type: true, /* etc — alle velden die listJobs ECHT levert */
});

export const jobDetailSchema = jobRowSchema.extend({
  stages: z.array(pipelineStageSchema),
});

export const jobListResponseSchema = z.object({
  data: z.array(jobListItemSchema),
  meta: paginationMetaSchema,
});

// 3. Request-input schemas — wat de client mag sturen
export const jobCreateInputSchema = jobRowSchema
  .pick({ title: true, description: true, department: true, location: true, /* ... */ })
  .partial()
  .required({ title: true });
// Optionele expliciete .strict() om silent-drop te voorkomen.

export const jobUpdateInputSchema = jobCreateInputSchema.partial();

// 4. Geïnferenceerde types — single source for TS
export type JobRow = z.infer<typeof jobRowSchema>;
export type JobListItem = z.infer<typeof jobListItemSchema>;
export type JobDetail = z.infer<typeof jobDetailSchema>;
export type JobCreateInput = z.infer<typeof jobCreateInputSchema>;
```

### 9.3 Backend enforcement

In `jobs.controller.ts`:
```ts
import { jobCreateInputSchema, jobListResponseSchema } from '@talentflow/contracts/job';

// Input — al bestaande pattern
const data = jobCreateInputSchema.parse(req.body);

// Output — NIEUW: response valideren in dev/test mode
const response = await jobsService.listJobs(...);
if (process.env.NODE_ENV !== 'production') {
  jobListResponseSchema.parse(response);  // throws bij contract-mismatch
}
res.json(response);
```

In `jobs.service.ts` `listJobs`: SQL-SELECT moet **alle velden in `jobListItemSchema`** retourneren — als we de SELECT uitbreiden met `description` + missende velden, dwingt het Zod-schema afstand af dat we niets overslaan. Optioneel een gedeeld `JOB_LIST_COLUMNS` array in `contracts` package.

### 9.4 Frontend enforcement

In `useJobs.ts`:
```ts
import { jobListResponseSchema, type JobListItem } from '@talentflow/contracts/job';

queryFn: async () => {
  const raw = await api.get('/jobs', { params });
  return jobListResponseSchema.parse(raw.data);  // crash fail-fast bij mismatch
}
```

In `JobForm.tsx`:
```ts
import { jobCreateInputSchema } from '@talentflow/contracts/job';

useForm({ resolver: zodResolver(jobCreateInputSchema) });
// Form bouwt en valideert tegen exact wat backend accepteert. Eén schema, geen duplicatie.
```

### 9.5 Migratie-volgorde

**Stap 1 — package bootstrap (1 dag)**
- `packages/shared/contracts/` opzetten als npm workspace
- `apps/api` + `apps/web` toevoegen als consumers
- CI verifieert dat package builds

**Stap 2 — Job entiteit (2 dagen)**
- Job schemas schrijven, **exact gespiegeld aan huidige DB** (geen schema-wijzigingen!)
- Backend `listJobs` SELECT uitbreiden om response-schema te valideren (fix: `description` toevoegen)
- Backend response-validatie aan in dev-mode
- Frontend `useJobs`/`useJob` switchen naar geïnferenceerd type — verwijder `mockData.ts:Job`, `shared/types/job.ts:Job`, `JobManatalFields`
- Frontend `JobForm` switchen naar `jobCreateInputSchema` als resolver
- Componenten compileren tegen nieuwe `JobListItem`/`JobDetail` — laat TS de mismatches vinden, fix per-component
- Fixt automatisch: detail crash (#1), form 400 (#2), description missing (#4), recruiter_name null (#5, #6), application_count string (#7), JobStatus mismatch (#8), client/owner fictie (#12), requirements fictie (#13)

**Stap 3 — herhaal voor Candidate (2 dagen)**
- Zelfde patroon

**Stap 4 — herhaal voor Application + PipelineStage (1 dag elk)**

**Stap 5 — overige entiteiten on-demand** wanneer een sprint-taak ze raakt. Geen big bang.

### 9.6 Wat we expliciet NIET doen in Fase 2

- **Geen Drizzle/Prisma introduceren** — extra dependency, extra migration-path. Pure Zod + raw SQL blijft, alleen het Zod-schema dwingt overeenstemming af.
- **Geen DB-schema wijzigingen** — alle mismatches worden in TS/Zod-laag opgelost, niet door kolommen toe te voegen.
- **Geen rename van bestaande DB-kolommen** — backward compatibility met data van gisteren.
- **Geen OpenAPI auto-gen** in Fase 2 — kan later via `zod-to-openapi`, maar is een aparte feature. Eerst contract-validatie aan beide kanten landen.
- **Geen runtime-validatie in production** — alleen dev/test (te kostbaar voor elke response). Production vertrouwt op typecheck + unit tests.

### 9.7 Definition of Done voor Job Fase 2

- Eén `JobRow` type, één `JobListItem` type, één `JobDetail` type, één `JobCreateInput` type — allemaal in `@talentflow/contracts`, geïmporteerd door API en web.
- `apps/web/lib/mockData.ts:Job` verwijderd.
- `apps/web/lib/shared/types/job.ts:Job` verwijderd of een dunne re-export.
- `JobManatalFields` verwijderd; `client`/`owner_*`-velden ofwel in `JobRow` (na DB-migratie, out of scope) ofwel als bewust-frontend-only type apart benoemd.
- Detail-page rendert zonder crash.
- Form POST werkt via UI.
- `npm run build` op beide apps groen, geen TS-errors.
- Een unit-test die `parse(jobRowSchema, livePostgresRow)` doet en omgekeerd op een gemockte response — bewijst dat schema en realiteit overeenkomen.
