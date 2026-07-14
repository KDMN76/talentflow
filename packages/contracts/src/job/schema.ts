/**
 * Job schemas — single source of truth.
 *
 * Vier afgeleide schemas (List/Detail/Create/Update) komen via .pick(),
 * .omit() en .extend() uit het canonieke JobRowSchema. Alle decisions over
 * nullable/optional/required staan letterlijk in de DB-schema (zie
 * `apps/api/migrations/001_init.sql` en `007_job_detail_expansion.sql`);
 * dit bestand mirrort die werkelijkheid. Wijken alleen af met expliciete
 * comment + reden.
 */

import { z } from "zod";
import {
  JOB_CONTRACT_TYPE_VALUES,
  JOB_EMPLOYMENT_TYPE_VALUES,
  JOB_EXPERIENCE_LEVEL_VALUES,
  JOB_REMOTE_TYPE_VALUES,
  JOB_SALARY_FREQUENCY_VALUES,
  JOB_STATUS_VALUES,
} from "./constants";

// ─────────────────────────────────────────────────────────────────────────────
// Sub-schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PipelineStage als het door de `getJob` SQL `LEFT JOIN`-tak wordt
 * geretourneerd: id, name, position, color + COUNT(applications) als
 * `application_count`. Alleen gehydrateerd in JobDetailSchema.
 */
export const PipelineStageHydratedSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  position: z.coerce.number().int().nonnegative(),
  color: z.string().nullable(),
  application_count: z.coerce.number().int().nonnegative(),
});

export type PipelineStageHydrated = z.infer<typeof PipelineStageHydratedSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// JobRowSchema — DB-realiteit (read-shape, ná DB-defaults)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mirrort `jobs` tabel zoals die uit SELECT komt. Decision-rules:
 *
 *   - DB NOT NULL kolommen (incl. die met DEFAULT)   → required, niet-nullable
 *     (na DB-default is de read-waarde altijd aanwezig).
 *   - DB nullable kolommen                            → `.nullable()`.
 *   - GENERATED kolommen (salary_band_disclosed)      → read-only, required.
 *   - Server-managed timestamps (created_at/updated_at) → required (DB-default
 *     `now()` garandeert presence op elke row).
 *   - embedding (vector(1536))                        → buiten scope (alleen
 *     intern voor matching, nooit via API geserialiseerd). NIET in dit schema.
 *
 * NOTE: clients-tabel ontbreekt in DB; client_id/client_name worden
 * toegevoegd in toekomstige migratie — zie ROADMAP.md "Clients/CRM module".
 * Daarom geen `client*` of `owner_*` velden in dit schema (waren fantoom
 * in `JobManatalFields`).
 */
export const JobRowSchema = z.object({
  // ── identity + tenancy ──
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),

  // ── core (001_init.sql) ──
  title: z.string().min(1),
  description: z.string().nullable(),
  department: z.string().nullable(),
  location: z.string().nullable(),
  salary_min: z.number().int().nullable(),
  salary_max: z.number().int().nullable(),
  employment_type: z.enum(JOB_EMPLOYMENT_TYPE_VALUES).nullable(),
  status: z.enum(JOB_STATUS_VALUES),
  recruiter_id: z.string().uuid().nullable(),
  organization_id: z.string().uuid().nullable(),

  // ── lifecycle ──
  deleted_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),

  // ── Manatal-pariteit (007_job_detail_expansion.sql) ──
  job_reference: z.string().nullable(),
  headcount: z.number().int().min(1).nullable(),
  experience_level: z.enum(JOB_EXPERIENCE_LEVEL_VALUES).nullable(),
  contract_type: z.enum(JOB_CONTRACT_TYPE_VALUES).nullable(),
  contract_details: z.string().nullable(),
  open_date: z.string().nullable(), // DB `date` → ISO yyyy-mm-dd string
  close_date: z.string().nullable(),
  industry: z.string().nullable(),
  remote_type: z.enum(JOB_REMOTE_TYPE_VALUES).nullable(),
  office_address: z.string().nullable(),
  package_details: z.string().nullable(),
  currency: z.string().nullable(),
  salary_frequency: z.enum(JOB_SALARY_FREQUENCY_VALUES).nullable(),
  required_skills: z.array(z.string()).nullable(),
  nice_to_have_skills: z.array(z.string()).nullable(),

  // ── Pay Transparency (012_compliance_layer.sql) ──
  pay_transparency_required: z.boolean(),
  salary_band_disclosed: z.boolean(), // GENERATED ALWAYS — read-only
  compensation_criteria: z.string().nullable(),
});

export type JobRow = z.infer<typeof JobRowSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// JobListItemSchema — GET /jobs response per item
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decision-rules:
 *   - Subset van JobRow die ECHT op lijst-views getoond wordt (omit zware
 *     velden zoals embedding + audit-only kolommen).
 *   - Hydration-velden uit `LEFT JOIN`: `recruiter_name` (nullable als
 *     recruiter_id NULL is) en `application_count` (COUNT komt als string
 *     uit pg → `z.coerce.number()`).
 *   - `description` IS opgenomen ondanks dat huidige `listJobs` SELECT hem
 *     mist — backend in Stap 2 wordt gedwongen die te leveren. Het hele
 *     punt van shared contracts: schema dwingt af, niet andersom.
 */
export const JobListItemSchema = JobRowSchema.pick({
  id: true,
  title: true,
  description: true,
  department: true,
  location: true,
  salary_min: true,
  salary_max: true,
  employment_type: true,
  status: true,
  recruiter_id: true,
  organization_id: true,
  created_at: true,
  updated_at: true,
  job_reference: true,
  headcount: true,
  experience_level: true,
  contract_type: true,
  industry: true,
  remote_type: true,
  open_date: true,
  close_date: true,
  currency: true,
  salary_frequency: true,
})
  .extend({
    recruiter_name: z.string().nullable(),
    organization_name: z.string().nullable(),
    application_count: z.coerce.number().int().nonnegative(),
  })
  // `.strict()` op response: in dev/test mode faalt parse als backend per
  // ongeluk een extra veld stuurt — dat is fail-fast bij contract-drift.
  .strict();

export type JobListItem = z.infer<typeof JobListItemSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// JobDetailSchema — GET /jobs/:id response
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decision-rules:
 *   - JobRow in z'n geheel (detail view toont alle velden, incl. zwaar/zelden
 *     gebruikt zoals `contract_details`, `package_details`, `compensation_criteria`).
 *   - + `recruiter_name` hydration (`u.name` via LEFT JOIN).
 *   - + `stages` hydration (secundaire pipeline_stages query met COUNT).
 *   - `application_count` is OPTIONAL in detail (huidige backend retourneert
 *     het niet voor getJob; UI rekent stages-counts op). Eventueel later
 *     bijschakelen — geen breaking change voor consumers.
 */
export const JobDetailSchema = JobRowSchema.extend({
  recruiter_name: z.string().nullable(),
  stages: z.array(PipelineStageHydratedSchema),
}).strict();

export type JobDetail = z.infer<typeof JobDetailSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// JobCreateInputSchema — POST /jobs request body
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decision-rules (per veld, vanuit DB-schema):
 *
 *   - id, tenant_id, created_at, updated_at, deleted_at, embedding,
 *     embedding_updated_at, salary_band_disclosed (GENERATED), job_reference
 *     (server-auto-generates met collision-retry in createJob)
 *       → server-generated, OMITTED.
 *
 *   - title  (DB NOT NULL, geen default)
 *       → required, min 1 char.
 *
 *   - status (DB NOT NULL met DEFAULT 'draft')
 *   - employment_type (DB nullable + DEFAULT 'fulltime')
 *   - headcount (DB nullable + DEFAULT 1)
 *   - currency (DB nullable + DEFAULT 'EUR')
 *   - salary_frequency (DB nullable + DEFAULT 'monthly')
 *   - required_skills, nice_to_have_skills (DB nullable + DEFAULT '{}')
 *   - pay_transparency_required (DB nullable + DEFAULT true)
 *       → optional (DB-default vult aan).
 *
 *   - description, department, location, salary_min/max, recruiter_id,
 *     experience_level, contract_type, contract_details, open_date,
 *     close_date, industry, remote_type, office_address, package_details,
 *     compensation_criteria  (DB nullable, geen default)
 *       → optional (client laat weg → DB krijgt NULL).
 *
 *   - pipeline_template_id  (BEDRIJFSlogica, niet in jobs-kolom — apart
 *     verwerkt door `resolvePipelineTemplateId`)
 *       → optional UUID.
 *
 * `.strict()` is bewust ingezet zodat onbekende velden (zoals het
 * frontend-fantasie `requirements` veld) een Zod-error geven ipv silent
 * gedropt te worden — dat is een van de bekende bugs die deze laag moet
 * elimineren.
 */
export const JobCreateInputSchema = z
  .object({
    // Required
    title: z.string().min(1).max(200),

    // Optional met DB-default of nullable
    description: z.string().max(50000).optional(),
    department: z.string().max(100).optional(),
    location: z.string().max(200).optional(),
    salary_min: z.number().int().nonnegative().optional(),
    salary_max: z.number().int().nonnegative().optional(),
    employment_type: z.enum(JOB_EMPLOYMENT_TYPE_VALUES).optional(),
    status: z.enum(JOB_STATUS_VALUES).optional(),
    recruiter_id: z.string().uuid().nullable().optional(),
    organization_id: z.string().uuid().nullable().optional(),

    // Manatal-pariteit
    headcount: z.number().int().min(1).max(999).optional(),
    experience_level: z.enum(JOB_EXPERIENCE_LEVEL_VALUES).optional(),
    contract_type: z.enum(JOB_CONTRACT_TYPE_VALUES).optional(),
    contract_details: z.string().max(2000).optional(),
    open_date: z.string().date().optional(),
    close_date: z.string().date().optional(),
    industry: z.string().max(120).optional(),
    remote_type: z.enum(JOB_REMOTE_TYPE_VALUES).optional(),
    office_address: z.string().max(500).optional(),
    package_details: z.string().max(2000).optional(),
    currency: z.string().min(2).max(8).optional(),
    salary_frequency: z.enum(JOB_SALARY_FREQUENCY_VALUES).optional(),
    required_skills: z.array(z.string().min(1).max(120)).max(50).optional(),
    nice_to_have_skills: z.array(z.string().min(1).max(120)).max(50).optional(),

    // Compliance
    pay_transparency_required: z.boolean().optional(),
    compensation_criteria: z.string().max(2000).optional(),

    // Custom fields (EAV, geen jobs-kolom) — `key → value` map. Wordt ná de
    // job-insert door createJob via setValuesForEntity gepersisteerd + tegen de
    // per-tenant custom_field_definitions gevalideerd. Zonder dit veld werden
    // de CustomFieldsRenderer-waarden in JobForm stilletjes gedropt.
    custom_fields: z.record(z.unknown()).optional(),

    // Business-logica (niet in jobs-kolom)
    pipeline_template_id: z.string().uuid().optional(),
  })
  .strict();

export type JobCreateInput = z.infer<typeof JobCreateInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// JobUpdateInputSchema — PATCH /jobs/:id request body
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decision-rules:
 *   - Alles uit JobCreateInputSchema, maar `.partial()` — geen veld is
 *     verplicht (PATCH semantiek: stuur alleen wat je wil wijzigen).
 *   - Bovendien OMITTED:
 *       * `pipeline_template_id` — swappen ná create zou bestaande
 *          applications losmaken van stages; backend heeft een aparte
 *          route POST `/jobs/:id/pipeline-template` voor template-rotatie.
 *       * `custom_fields` — updateJob verwerkt (nog) geen custom-field-waarden;
 *          ze worden via een aparte custom-fields-route bijgewerkt. Weglaten
 *          i.p.v. accepteren voorkomt een silent-drop op PATCH.
 *   - Server-immutable velden (id, tenant_id, created_at, job_reference)
 *     waren al niet in CreateInput aanwezig → blijven afwezig.
 *   - `.strict()` blijft aan om silent-drop te voorkomen.
 */
export const JobUpdateInputSchema = JobCreateInputSchema.omit({
  pipeline_template_id: true,
  custom_fields: true,
}).partial();

export type JobUpdateInput = z.infer<typeof JobUpdateInputSchema>;
