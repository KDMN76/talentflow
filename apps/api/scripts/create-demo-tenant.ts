/**
 * create-demo-tenant.ts — idempotent demo-tenant voor prospects.
 *
 * Maakt (of ververst) een geïsoleerde tenant `demo` met een beperkte maar
 * overtuigende dataset:
 *
 *   - 15 vacatures (10 open / 2 concept / 3 vervuld) met pipeline-stages
 *   - 60 kandidaten (NL-namen, skills, bronnen, ai-scores)
 *   - ±45 sollicitaties met funnel-vormige spreiding over de stages
 *     (+ afwijzingen en 3 hires voor eerlijke cijfers)
 *   - 8 interviews (verleden + komende dagen) en 6 ingevulde scorecards
 *   - activiteiten-feed voor een gevuld dashboard
 *   - CRM: 4 organisaties, 4 contactpersonen, 5 deals
 *   - 1 read-only user (rol `viewer`, zie src/lib/permissions.ts) met een
 *     random wachtwoord dat ELKE RUN opnieuw wordt gegenereerd en alleen
 *     naar stdout wordt geprint — er staan GEEN credentials in dit bestand.
 *
 * Strategie identiek aan seed-demo.ts / seed-dev.ts: vaste UUIDs (prefix
 * de111111-…) + ON CONFLICT DO UPDATE, dus herhaald draaien is veilig en
 * produceert geen duplicates. Draait via de owner-rol (RLS-bypass), net als
 * de migrate-runner.
 *
 * ── Draaien ────────────────────────────────────────────────────────────────
 * Lokaal (leest apps/api/.env):
 *     cd apps/api && npx tsx scripts/create-demo-tenant.ts
 *
 * Productie (in de api-container op de VPS):
 *     docker compose exec api npx tsx scripts/create-demo-tenant.ts
 *   (of, na build: docker compose exec api node dist/scripts/create-demo-tenant.js)
 *
 * De inlog-URL, het e-mailadres en het verse wachtwoord staan onderaan de
 * stdout-output. Opnieuw draaien = nieuw wachtwoord (oude vervalt).
 *
 * ── Verwijderen ────────────────────────────────────────────────────────────
 * De hele demo-tenant weghalen (psql, als owner):
 *     DELETE FROM tenants WHERE slug = 'demo';
 * Alle rijen hangen met ON DELETE CASCADE aan de tenant. Let op: als er via
 * app-gebruik audit_events voor deze tenant zijn ontstaan, blokkeert de
 * WORM-trigger op audit_events de cascade-delete. Verwijder dan eerst die
 * rijen met de trigger tijdelijk uitgeschakeld:
 *     ALTER TABLE audit_events DISABLE TRIGGER ALL;
 *     DELETE FROM audit_events WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'demo');
 *     ALTER TABLE audit_events ENABLE TRIGGER ALL;
 *     DELETE FROM tenants WHERE slug = 'demo';
 */
import 'dotenv/config';
import crypto from 'crypto';
import { Client } from 'pg';
import bcrypt from 'bcrypt';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[create-demo-tenant] DATABASE_URL ontbreekt');
  process.exit(1);
}

// Vaste UUIDs — herkenbaar (prefix de111111) én idempotent bij her-runs.
const did = (n: number) =>
  `de111111-0000-4000-8000-${String(n).padStart(12, '0')}`;

const TENANT_ID = did(1);
const VIEWER_ID = did(2);
const TENANT_SLUG = 'demo';
const VIEWER_EMAIL = 'demo@talentflow-demo.nl';

// ── Deterministische data-generatoren (geen Math.random → stabiele reruns) ──

const FIRST_NAMES = [
  'Sanne', 'Daan', 'Noor', 'Tim', 'Fatima', 'Ruben', 'Lisa', 'Mehmet',
  'Emma', 'Joris', 'Aaliyah', 'Pieter', 'Yasmin', 'Lars', 'Sofie', 'Bram',
  'Elif', 'Thijs', 'Merel', 'Omar',
];
const LAST_NAMES = [
  'de Vries', 'Bakker', 'Janssen', 'Visser', 'el Amrani', 'Smit',
  'Mulder', 'Yilmaz', 'van Dijk', 'Hendriks', 'Osei', 'Willems',
];
const SOURCES = ['LinkedIn', 'Indeed', 'Referral', 'Career Fair', 'Website'];
const SKILL_POOLS = [
  ['React', 'TypeScript', 'Next.js'],
  ['Node.js', 'PostgreSQL', 'Docker'],
  ['Python', 'SQL', 'dbt'],
  ['Java', 'Spring', 'Kubernetes'],
  ['Vue', 'CSS', 'Tailwind'],
  ['C#', '.NET', 'Azure'],
  ['PHP', 'Laravel', 'MySQL'],
  ['React Native', 'TypeScript', 'GraphQL'],
];

interface DemoJob {
  n: number;
  title: string;
  department: string;
  location: string;
  status: 'open' | 'draft' | 'closed';
  salaryMin: number;
  salaryMax: number;
}

const JOBS: DemoJob[] = [
  { n: 100, title: 'Frontend Developer',        department: 'IT',        location: 'Amsterdam',  status: 'open',   salaryMin: 3800, salaryMax: 5200 },
  { n: 101, title: 'Backend Engineer',          department: 'IT',        location: 'Utrecht',    status: 'open',   salaryMin: 4200, salaryMax: 5800 },
  { n: 102, title: 'DevOps Engineer',           department: 'IT',        location: 'Rotterdam',  status: 'open',   salaryMin: 4500, salaryMax: 6200 },
  { n: 103, title: 'Data Engineer',             department: 'Data',      location: 'Amsterdam',  status: 'open',   salaryMin: 4300, salaryMax: 6000 },
  { n: 104, title: 'Data Analist',              department: 'Data',      location: 'Den Haag',   status: 'open',   salaryMin: 3400, salaryMax: 4600 },
  { n: 105, title: 'Product Owner',             department: 'Product',   location: 'Utrecht',    status: 'open',   salaryMin: 4600, salaryMax: 6000 },
  { n: 106, title: 'UX Designer',               department: 'Product',   location: 'Amsterdam',  status: 'open',   salaryMin: 3600, salaryMax: 4800 },
  { n: 107, title: 'Fullstack Developer',       department: 'IT',        location: 'Eindhoven',  status: 'open',   salaryMin: 4000, salaryMax: 5600 },
  { n: 108, title: 'Salesforce Consultant',     department: 'Consultancy', location: 'Den Haag', status: 'open',   salaryMin: 4200, salaryMax: 5800 },
  { n: 109, title: 'Security Specialist',       department: 'IT',        location: 'Amersfoort', status: 'open',   salaryMin: 4800, salaryMax: 6500 },
  { n: 110, title: 'Mobile Developer (React Native)', department: 'IT',  location: 'Amsterdam',  status: 'draft',  salaryMin: 4000, salaryMax: 5400 },
  { n: 111, title: 'Scrum Master',              department: 'Product',   location: 'Rotterdam',  status: 'draft',  salaryMin: 4100, salaryMax: 5300 },
  { n: 112, title: 'Java Developer',            department: 'IT',        location: 'Utrecht',    status: 'closed', salaryMin: 4200, salaryMax: 5600 },
  { n: 113, title: 'BI Consultant',             department: 'Data',      location: 'Zwolle',     status: 'closed', salaryMin: 3800, salaryMax: 5000 },
  { n: 114, title: 'Cloud Architect',           department: 'IT',        location: 'Amsterdam',  status: 'closed', salaryMin: 5500, salaryMax: 7500 },
];

// Fallback-stages als er geen systeem-pipeline-template in de DB staat.
const FALLBACK_STAGES = [
  { name: 'Nieuw',       position: 0, color: '#6366f1' },
  { name: 'Screening',   position: 1, color: '#8b5cf6' },
  { name: 'Interview',   position: 2, color: '#f59e0b' },
  { name: 'Aanbod',      position: 3, color: '#10b981' },
  { name: 'Aangenomen',  position: 4, color: '#059669' },
];

const ORGS = [
  { n: 700, name: 'NovaTech Solutions', industry: 'SaaS',      type: 'client',   website: 'https://novatech.example' },
  { n: 701, name: 'Van Berkel Groep',   industry: 'Bouw',      type: 'client',   website: 'https://vanberkel.example' },
  { n: 702, name: 'FinArc',             industry: 'FinTech',   type: 'prospect', website: 'https://finarc.example' },
  { n: 703, name: 'ZorgPlus',           industry: 'Zorg',      type: 'prospect', website: 'https://zorgplus.example' },
];
const CONTACTS = [
  { n: 710, org: 700, name: 'Karin Bos',       email: 'karin@novatech.example',   role: 'HR Director' },
  { n: 711, org: 701, name: 'Jeroen van Berkel', email: 'jeroen@vanberkel.example', role: 'COO' },
  { n: 712, org: 702, name: 'Sophie Lin',      email: 'sophie@finarc.example',    role: 'Head of Engineering' },
  { n: 713, org: 703, name: 'Ali Demir',       email: 'ali@zorgplus.example',     role: 'Recruitment Lead' },
];
const DEALS = [
  { n: 720, org: 700, title: 'Detachering 2x frontend',      stage: 'gewonnen',       value: 24000 },
  { n: 721, org: 701, title: 'Werving projectleider',        stage: 'onderhandeling', value: 15000 },
  { n: 722, org: 702, title: 'RPO-pilot engineering',        stage: 'offerte',        value: 32000 },
  { n: 723, org: 703, title: 'Exclusieve search IT-manager', stage: 'prospect',       value: 21000 },
  { n: 724, org: 700, title: 'Verlenging raamovereenkomst',  stage: 'offerte',        value: 18000 },
];

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('[create-demo-tenant] verbonden met', new URL(DATABASE_URL!).host);

  // ─── Tenant ───────────────────────────────────────────────────────────────
  await client.query(
    `INSERT INTO tenants (id, slug, name, plan)
     VALUES ($1, $2, 'TalentFlow Demo', 'demo')
     ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name`,
    [TENANT_ID, TENANT_SLUG]
  );
  console.log(`[create-demo-tenant] tenant "${TENANT_SLUG}" (${TENANT_ID})`);

  // ─── Read-only viewer-user met runtime-random wachtwoord ─────────────────
  // base64url zonder padding → 16 tekens, geen shell-onvriendelijke chars.
  const password = crypto.randomBytes(12).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 10);
  await client.query(
    `INSERT INTO users (id, tenant_id, email, name, password_hash, role, is_active)
     VALUES ($1, $2, $3, 'Demo Bezoeker', $4, 'viewer', true)
     ON CONFLICT (id) DO UPDATE
       SET email = EXCLUDED.email,
           password_hash = EXCLUDED.password_hash,
           role = 'viewer',
           is_active = true`,
    [VIEWER_ID, TENANT_ID, VIEWER_EMAIL, passwordHash]
  );
  console.log('[create-demo-tenant] viewer-user upserted (wachtwoord geroteerd)');

  // ─── Vacatures ────────────────────────────────────────────────────────────
  for (const j of JOBS) {
    await client.query(
      `INSERT INTO jobs (
         id, tenant_id, title, description, department, location,
         salary_min, salary_max, status, employment_type, headcount,
         currency, salary_frequency, pay_transparency_required
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'fulltime', 1,
               'EUR', 'monthly', true)
       ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title, description = EXCLUDED.description,
             department = EXCLUDED.department, location = EXCLUDED.location,
             salary_min = EXCLUDED.salary_min, salary_max = EXCLUDED.salary_max,
             status = EXCLUDED.status, deleted_at = NULL`,
      [
        did(j.n), TENANT_ID, j.title,
        `Wij zoeken een ${j.title} voor onze klant in ${j.location}. ` +
          `Je werkt in een klein team, met veel eigenaarschap en ruimte om te groeien.`,
        j.department, j.location, j.salaryMin, j.salaryMax, j.status,
      ]
    );
  }
  console.log(`[create-demo-tenant] ${JOBS.length} vacatures upserted`);

  // ─── Pipeline-stages per vacature (systeem-template of fallback) ─────────
  const { rows: tmpl } = await client.query(
    `SELECT id FROM pipeline_templates
     WHERE is_system = true OR is_default = true
     ORDER BY created_at ASC LIMIT 1`
  );
  let templateStages = FALLBACK_STAGES;
  if (tmpl.length > 0) {
    const { rows } = await client.query(
      `SELECT name, position, color FROM pipeline_template_stages
       WHERE template_id = $1 ORDER BY position ASC`,
      [tmpl[0].id]
    );
    if (rows.length > 0) templateStages = rows;
  }

  // Alleen aanmaken als de job nog geen stages heeft — geen churn op rerun
  // (stage-ids blijven stabiel; interviews/scorecards verwijzen ernaar).
  const stagesByJob = new Map<string, Array<{ id: string; position: number }>>();
  for (const j of JOBS) {
    const jobId = did(j.n);
    const { rows: existing } = await client.query(
      `SELECT id, position FROM pipeline_stages
       WHERE job_id = $1 AND tenant_id = $2 ORDER BY position ASC`,
      [jobId, TENANT_ID]
    );
    if (existing.length > 0) {
      stagesByJob.set(jobId, existing);
      continue;
    }
    const created: Array<{ id: string; position: number }> = [];
    for (const s of templateStages) {
      const { rows } = await client.query(
        `INSERT INTO pipeline_stages (tenant_id, job_id, name, position, color)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, position`,
        [TENANT_ID, jobId, s.name, s.position, s.color]
      );
      created.push(rows[0]);
    }
    stagesByJob.set(jobId, created);
  }
  console.log(
    `[create-demo-tenant] pipeline-stages klaar (${templateStages.length} per vacature)`
  );

  // ─── 60 kandidaten (deterministisch gegenereerd) ──────────────────────────
  const candidateIds: string[] = [];
  for (let i = 0; i < 60; i++) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[(i * 7 + 3) % LAST_NAMES.length];
    const name = `${first} ${last}`;
    const email = `${first}.${last}`
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z.]/g, '') + `${i}@example.com`;
    const skills = SKILL_POOLS[i % SKILL_POOLS.length];
    const score = 55 + ((i * 13) % 41); // 55..95
    const source = SOURCES[i % SOURCES.length];
    const id = did(200 + i);
    candidateIds.push(id);
    await client.query(
      `INSERT INTO candidates (id, tenant_id, name, email, phone, skills, ai_score, source, tags, notes)
       VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9::text[], $10)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, email = EXCLUDED.email,
             skills = EXCLUDED.skills, ai_score = EXCLUDED.ai_score,
             source = EXCLUDED.source, deleted_at = NULL`,
      [
        id, TENANT_ID, name, email,
        `+31 6 ${String(20000000 + i * 131).slice(0, 8)}`,
        skills, score, source,
        score >= 88 ? ['top-kandidaat'] : [],
        score >= 88 ? 'Sterk profiel — snel schakelen.' : null,
      ]
    );
  }
  console.log(`[create-demo-tenant] ${candidateIds.length} kandidaten upserted`);

  // ─── Sollicitaties: funnel-spreiding over de 10 open vacatures ───────────
  // Per open vacature 4-5 kandidaten: funnel [2,1,1,1] over de eerste 4
  // stages. Kandidaten rouleren zodat sommige kandidaten 1 sollicitatie
  // hebben en anderen geen (talent-pool).
  const openJobs = JOBS.filter((j) => j.status === 'open');
  const spread = [2, 1, 1, 1];
  let candIdx = 0;
  let appN = 400;
  const interviewableApps: Array<{ id: string; stageId: string }> = [];
  for (const j of openJobs) {
    const jobId = did(j.n);
    const stages = stagesByJob.get(jobId) ?? [];
    for (let s = 0; s < Math.min(stages.length, spread.length); s++) {
      for (let k = 0; k < spread[s]; k++) {
        const appId = did(appN++);
        const candId = candidateIds[candIdx % candidateIds.length];
        candIdx++;
        await client.query(
          `INSERT INTO applications (id, tenant_id, job_id, candidate_id, stage_id, status, applied_at)
           VALUES ($1, $2, $3, $4, $5, 'active', now() - ($6 || ' days')::interval)
           ON CONFLICT (tenant_id, job_id, candidate_id) DO UPDATE
             SET stage_id = EXCLUDED.stage_id, status = 'active'`,
          [appId, TENANT_ID, jobId, candId, stages[s].id, String(3 + ((appN * 3) % 18))]
        );
        // Stage-index >= 2 ("Interview" of later) → kandidaat voor interviews.
        if (s >= 2) interviewableApps.push({ id: appId, stageId: stages[s].id });
      }
    }
    // Per vacature 1 afwijzing in de eerste stage — eerlijke funnel.
    const rejId = did(appN++);
    const rejCand = candidateIds[candIdx % candidateIds.length];
    candIdx++;
    if (stages.length > 0) {
      await client.query(
        `INSERT INTO applications (id, tenant_id, job_id, candidate_id, stage_id, status, applied_at)
         VALUES ($1, $2, $3, $4, $5, 'rejected', now() - interval '10 days')
         ON CONFLICT (tenant_id, job_id, candidate_id) DO UPDATE SET status = 'rejected'`,
        [rejId, TENANT_ID, jobId, rejCand, stages[0].id]
      );
    }
  }
  // 3 hires op de vervulde vacatures.
  const closedJobs = JOBS.filter((j) => j.status === 'closed');
  for (let i = 0; i < closedJobs.length; i++) {
    const jobId = did(closedJobs[i].n);
    const stages = stagesByJob.get(jobId) ?? [];
    const lastStage = stages[stages.length - 1];
    if (!lastStage) continue;
    await client.query(
      `INSERT INTO applications (id, tenant_id, job_id, candidate_id, stage_id, status, applied_at)
       VALUES ($1, $2, $3, $4, $5, 'hired', now() - ($6 || ' days')::interval)
       ON CONFLICT (tenant_id, job_id, candidate_id) DO UPDATE
         SET status = 'hired', stage_id = EXCLUDED.stage_id`,
      [did(appN++), TENANT_ID, jobId, candidateIds[50 + i], lastStage.id, String(30 + i * 12)]
    );
  }
  console.log(
    `[create-demo-tenant] ${appN - 400} sollicitaties upserted (incl. afwijzingen + ${closedJobs.length} hires)`
  );

  // ─── Interviews (8) + scorecards (6) ──────────────────────────────────────
  const providers = ['google_meet', 'teams', 'in_person', 'phone'];
  const interviewTargets = interviewableApps.slice(0, 8);
  for (let i = 0; i < interviewTargets.length; i++) {
    const target = interviewTargets[i];
    // 4 afgerond (verleden), 4 gepland (komende dagen).
    const completed = i < 4;
    const offsetHours = completed ? -(24 * (i + 1)) : 4 + i * 20;
    await client.query(
      `INSERT INTO interviews (id, tenant_id, application_id, stage_id,
                               scheduled_start, scheduled_end,
                               meeting_url, meeting_provider, status, created_by, notes)
       VALUES ($1, $2, $3, $4,
               now() + ($5 || ' hours')::interval,
               now() + ($5 || ' hours')::interval + interval '1 hour',
               $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE
         SET scheduled_start = EXCLUDED.scheduled_start,
             scheduled_end = EXCLUDED.scheduled_end,
             status = EXCLUDED.status`,
      [
        did(600 + i), TENANT_ID, target.id, target.stageId,
        String(offsetHours),
        providers[i % providers.length] === 'in_person' ? null : `https://meet.example/demo-${i}`,
        providers[i % providers.length],
        completed ? 'completed' : 'scheduled',
        VIEWER_ID,
        completed ? 'Prettig gesprek; vervolg ingepland.' : null,
      ]
    );
  }
  // Scorecards op de 6 eerste interview-sollicitaties.
  const recommendations = ['strong_yes', 'yes', 'yes', 'neutral', 'strong_yes', 'no'];
  for (let i = 0; i < Math.min(6, interviewTargets.length); i++) {
    const target = interviewTargets[i];
    const overall = [4.5, 4.0, 3.5, 3.0, 4.8, 2.5][i];
    await client.query(
      `INSERT INTO scorecards (id, tenant_id, application_id, stage_id, interviewer_id,
                               overall_score, recommendation, notes, criteria_scores, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now() - ($10 || ' days')::interval)
       ON CONFLICT (id) DO UPDATE
         SET overall_score = EXCLUDED.overall_score,
             recommendation = EXCLUDED.recommendation,
             criteria_scores = EXCLUDED.criteria_scores`,
      [
        did(650 + i), TENANT_ID, target.id, target.stageId, VIEWER_ID,
        overall, recommendations[i],
        'Beoordeling uit demo-dataset.',
        JSON.stringify([
          { criterion: 'Technische diepgang', score: Math.min(5, Math.round(overall)) },
          { criterion: 'Communicatie', score: Math.min(5, Math.round(overall) + (i % 2)) },
          { criterion: 'Cultuurfit', score: Math.max(1, Math.round(overall) - (i % 2)) },
        ]),
        String(i + 1),
      ]
    );
  }
  console.log(
    `[create-demo-tenant] ${interviewTargets.length} interviews + ${Math.min(6, interviewTargets.length)} scorecards upserted`
  );

  // ─── Activiteiten-feed ────────────────────────────────────────────────────
  const actions = ['application', 'stage_change', 'note_added', 'application'];
  for (let i = 0; i < 16; i++) {
    const target = interviewableApps[i % Math.max(1, interviewableApps.length)];
    await client.query(
      `INSERT INTO activities (id, tenant_id, entity_type, entity_id, user_id, action, payload, created_at)
       VALUES ($1, $2, 'application', $3, $4, $5, '{}'::jsonb, now() - ($6 || ' hours')::interval)
       ON CONFLICT (id) DO NOTHING`,
      [
        did(800 + i), TENANT_ID,
        target?.id ?? did(400), VIEWER_ID,
        actions[i % actions.length], String(2 + i * 7),
      ]
    );
  }
  console.log('[create-demo-tenant] activiteiten upserted');

  // ─── CRM ──────────────────────────────────────────────────────────────────
  for (const o of ORGS) {
    await client.query(
      `INSERT INTO organizations (id, tenant_id, name, industry, website, type)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, industry = EXCLUDED.industry,
             type = EXCLUDED.type, deleted_at = NULL`,
      [did(o.n), TENANT_ID, o.name, o.industry, o.website, o.type]
    );
  }
  for (const c of CONTACTS) {
    await client.query(
      `INSERT INTO crm_contacts (id, tenant_id, organization_id, name, email, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, email = EXCLUDED.email,
             role = EXCLUDED.role, deleted_at = NULL`,
      [did(c.n), TENANT_ID, did(c.org), c.name, c.email, c.role]
    );
  }
  for (const d of DEALS) {
    await client.query(
      `INSERT INTO crm_deals (id, tenant_id, organization_id, recruiter_id, title, stage, value_eur)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title, stage = EXCLUDED.stage,
             value_eur = EXCLUDED.value_eur, deleted_at = NULL`,
      [did(d.n), TENANT_ID, did(d.org), VIEWER_ID, d.title, d.stage, d.value]
    );
  }
  console.log(
    `[create-demo-tenant] CRM: ${ORGS.length} organisaties, ${CONTACTS.length} contacten, ${DEALS.length} deals`
  );

  await client.end();

  // Credentials ALLEEN op stdout — nergens gepersisteerd.
  console.log('');
  console.log('══════════════════════════════════════════════════════════');
  console.log(' Demo-tenant klaar ✔');
  console.log(`   Tenant : ${TENANT_SLUG}`);
  console.log(`   Login  : ${VIEWER_EMAIL}`);
  console.log(`   Wachtwoord (nieuw gegenereerd, alleen hier zichtbaar):`);
  console.log(`     ${password}`);
  console.log('   Rol    : viewer (read-only permissiematrix)');
  console.log('══════════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('[create-demo-tenant] FAIL:', err);
  process.exit(1);
});
