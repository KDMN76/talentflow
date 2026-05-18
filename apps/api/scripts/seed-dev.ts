/**
 * Dev seed-script — idempotent.
 *
 * Vult de Neon dev-database met een minimale, voorspelbare dataset voor
 * Sub-fase 2C smoke-tests. Strategie: vaste UUIDs + ON CONFLICT DO UPDATE
 * zodat herhaalde runs geen duplicates produceren en de WORM-trigger op
 * `audit_events` niet raken (CASCADE-deletes op tenants zouden falen).
 *
 * Wachtwoord-format: alle dev-users delen één plain-text wachtwoord uit
 * `.seed-credentials.dev` (env var SEED_PASSWORD). Bcrypt-hash wordt
 * deterministisch per call gegenereerd (rounds=10, matchend met productie).
 *
 * Run:
 *   set -a; . .env.dev; set +a
 *   SEED_PASSWORD='dev-password-2026' npx tsx scripts/seed-dev.ts
 */
import { Client } from 'pg';
import bcrypt from 'bcrypt';

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'dev-password-2026';

// Vaste UUIDs — herhaalbare seed, geen duplicates op rerun.
const TENANT_A = '11111111-1111-1111-1111-aaaaaaaaaaaa';
const TENANT_B = '22222222-2222-2222-2222-bbbbbbbbbbbb';
const USER_A   = 'aaaaaaaa-aaaa-aaaa-aaaa-111111111111';
const USER_B   = 'bbbbbbbb-bbbb-bbbb-bbbb-222222222222';
const JOB_DRAFT  = 'd1d1d1d1-d1d1-d1d1-d1d1-111111111111';
const JOB_OPEN   = '00000000-0000-0000-0000-222222222222';
const JOB_CLOSED = 'cccccccc-cccc-cccc-cccc-333333333333';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[seed] DATABASE_URL ontbreekt — laad .env.dev eerst');
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('[seed] connected to', new URL(DATABASE_URL!).host);

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  // ─── Tenants ─────────────────────────────────────────────────────────────
  await client.query(
    `INSERT INTO tenants (id, slug, name)
     VALUES ($1, 'dev-a', 'Dev Tenant A'),
            ($2, 'dev-b', 'Dev Tenant B')
     ON CONFLICT (id) DO UPDATE
       SET slug = EXCLUDED.slug, name = EXCLUDED.name`,
    [TENANT_A, TENANT_B]
  );
  console.log('[seed] tenants upserted: dev-a, dev-b');

  // ─── Users (1 admin per tenant) ──────────────────────────────────────────
  // RLS-bypass: superuser/owner-rol kan altijd alle tenants schrijven. We
  // gebruiken `neondb_owner` dus dit werkt zonder SET app.tenant_id.
  await client.query(
    `INSERT INTO users (id, tenant_id, email, name, password_hash, role, is_active)
     VALUES
       ($1, $3, 'admin@dev-a.talentflow-dev.local', 'Admin A', $5, 'admin', true),
       ($2, $4, 'admin@dev-b.talentflow-dev.local', 'Admin B', $5, 'admin', true)
     ON CONFLICT (id) DO UPDATE
       SET email = EXCLUDED.email,
           name = EXCLUDED.name,
           password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           is_active = EXCLUDED.is_active`,
    [USER_A, USER_B, TENANT_A, TENANT_B, passwordHash]
  );
  console.log('[seed] users upserted: admin@dev-a/b');

  // ─── Jobs in tenant-a ────────────────────────────────────────────────────
  //
  // JOB 1: draft, geen recruiter (reproduceert oude "render-crash"-shape)
  await client.query(
    `INSERT INTO jobs (
       id, tenant_id, title, description, department, location,
       status, employment_type, headcount, currency, salary_frequency,
       pay_transparency_required, recruiter_id
     )
     VALUES ($1, $2, 'Backend Engineer (draft, geen recruiter)',
             'Reproduceert crash-shape: status=draft + recruiter_id NULL',
             'IT', 'Amsterdam',
             'draft', 'fulltime', 1, 'EUR', 'monthly',
             true, NULL)
     ON CONFLICT (id) DO UPDATE
       SET title = EXCLUDED.title,
           description = EXCLUDED.description,
           status = EXCLUDED.status,
           recruiter_id = EXCLUDED.recruiter_id`,
    [JOB_DRAFT, TENANT_A]
  );

  // JOB 2: open met recruiter toegewezen
  await client.query(
    `INSERT INTO jobs (
       id, tenant_id, title, description, department, location,
       salary_min, salary_max,
       status, employment_type, headcount, currency, salary_frequency,
       recruiter_id, pay_transparency_required
     )
     VALUES ($1, $2, 'Frontend Engineer (open, met recruiter)',
             'Standaard openstaande vacature voor frontend-werk',
             'IT', 'Utrecht',
             55000, 75000,
             'open', 'fulltime', 2, 'EUR', 'monthly',
             $3, true)
     ON CONFLICT (id) DO UPDATE
       SET title = EXCLUDED.title,
           description = EXCLUDED.description,
           salary_min = EXCLUDED.salary_min,
           salary_max = EXCLUDED.salary_max,
           status = EXCLUDED.status,
           recruiter_id = EXCLUDED.recruiter_id`,
    [JOB_OPEN, TENANT_A, USER_A]
  );

  // JOB 3: closed, ALLE nullable velden gevuld
  await client.query(
    `INSERT INTO jobs (
       id, tenant_id, title, description, department, location,
       salary_min, salary_max,
       status, employment_type, headcount, currency, salary_frequency,
       recruiter_id,
       job_reference, experience_level, contract_type, contract_details,
       open_date, close_date, industry, remote_type, office_address,
       package_details, required_skills, nice_to_have_skills,
       pay_transparency_required, compensation_criteria
     )
     VALUES (
       $1, $2, 'Senior Data Engineer (closed, alle velden gevuld)',
       'Vervulde positie met alle Manatal-pariteit velden geseed',
       'Data', 'Rotterdam',
       65000, 95000,
       'closed', 'fulltime', 1, 'EUR', 'annual',
       $3,
       'JOB-DEVCLD', 'senior', 'fulltime',
       '40 uur/week, hybride 2x/week op kantoor',
       '2026-01-01', '2026-03-31', 'FinTech', 'hybrid',
       'Wilhelminakade 1, 3072 AP Rotterdam',
       '8% pensioen, 30 vakantiedagen, leaseauto, mobiel',
       ARRAY['Python','dbt','Airflow','SQL','Snowflake']::text[],
       ARRAY['Kafka','Spark','Terraform']::text[],
       true,
       'Salaris gebaseerd op 5+ jaar ervaring, Hay-tabel niveau 12'
     )
     ON CONFLICT (id) DO UPDATE
       SET title = EXCLUDED.title,
           description = EXCLUDED.description,
           status = EXCLUDED.status,
           recruiter_id = EXCLUDED.recruiter_id,
           contract_details = EXCLUDED.contract_details,
           open_date = EXCLUDED.open_date,
           close_date = EXCLUDED.close_date,
           industry = EXCLUDED.industry,
           remote_type = EXCLUDED.remote_type,
           office_address = EXCLUDED.office_address,
           package_details = EXCLUDED.package_details,
           required_skills = EXCLUDED.required_skills,
           nice_to_have_skills = EXCLUDED.nice_to_have_skills,
           compensation_criteria = EXCLUDED.compensation_criteria`,
    [JOB_CLOSED, TENANT_A, USER_A]
  );

  console.log('[seed] 3 jobs upserted in tenant-a (draft / open / closed)');

  // ─── Pipeline-stages per job: instantieer uit "Bureau Pipeline" template ─
  // De resolvePipelineTemplateId-logica zit in service-code; voor dev-seed
  // klonen we de stages handmatig zodat de jobs-detail-pagina hydrated
  // stages krijgt.
  const { rows: defaultTemplate } = await client.query(
    `SELECT id FROM pipeline_templates
     WHERE is_system = true OR is_default = true OR name ILIKE '%bureau%'
     ORDER BY created_at ASC LIMIT 1`
  );
  if (defaultTemplate.length > 0) {
    const templateId = defaultTemplate[0].id;
    const { rows: templateStages } = await client.query(
      `SELECT name, position, color FROM pipeline_template_stages
       WHERE template_id = $1 ORDER BY position ASC`,
      [templateId]
    );

    for (const jobId of [JOB_DRAFT, JOB_OPEN, JOB_CLOSED]) {
      // Truncate bestaande stages voor deze job (geen WORM op pipeline_stages)
      await client.query(
        `DELETE FROM pipeline_stages WHERE job_id = $1 AND tenant_id = $2`,
        [jobId, TENANT_A]
      );
      for (const s of templateStages) {
        await client.query(
          `INSERT INTO pipeline_stages (tenant_id, job_id, name, position, color)
           VALUES ($1, $2, $3, $4, $5)`,
          [TENANT_A, jobId, s.name, s.position, s.color]
        );
      }
    }
    console.log(
      `[seed] pipeline_stages instantiated voor 3 jobs (template "${templateId}", ${templateStages.length} stages elk)`
    );
  } else {
    console.warn(
      '[seed] WAARSCHUWING: geen pipeline_template gevonden — jobs hebben 0 stages'
    );
  }

  await client.end();
  console.log('[seed] done');
}

main().catch((err) => {
  console.error('[seed] FAIL:', err);
  process.exit(1);
});
