/**
 * Demo seed-script — idempotent. Verrijkt een tenant met realistische
 * demo-data zodat de "leeg systeem"-indruk verdwijnt tijdens presentaties:
 *
 *   - 12 kandidaten (NL-namen, skills, bronnen, ai-scores)
 *   - sollicitaties verdeeld over de pipeline-stages van de open vacature
 *   - 3 interviews (1 vandaag, 1 morgen, 1 afgerond)
 *   - CRM: 3 organisaties + 3 contactpersonen + 4 deals over de stages
 *   - activities voor een gevulde dashboard-feed
 *
 * Strategie identiek aan seed-dev.ts: vaste UUIDs + ON CONFLICT DO UPDATE,
 * dus herhaald draaien is veilig. Draait via de owner-rol (RLS-bypass), net
 * als seed-dev en de migrate-runner.
 *
 * Run (dev):   npx tsx scripts/seed-demo.ts            (leest apps/api/.env)
 * Run (prod):  TENANT_SLUG=kdmn node dist/scripts/seed-demo.js — of via tsx
 *              in de container; TENANT_SLUG bepaalt welke tenant gevuld wordt.
 */
import 'dotenv/config';
import { Client } from 'pg';

const TENANT_SLUG = process.env.TENANT_SLUG ?? 'dev-a';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[seed-demo] DATABASE_URL ontbreekt');
  process.exit(1);
}

// Vaste UUID-prefix voor alle demo-entiteiten — herkenbaar én idempotent.
const did = (n: number) => `de30de30-0000-4000-8000-${String(n).padStart(12, '0')}`;

const CANDIDATES = [
  { n: 1,  name: 'Sanne de Vries',     email: 'sanne.devries@example.com',     skills: ['React', 'TypeScript', 'Next.js'],        source: 'LinkedIn',    score: 88, notes: '6 jaar frontend, beschikbaar per 1 augustus.' },
  { n: 2,  name: 'Tim Bakker',         email: 'tim.bakker@example.com',        skills: ['React', 'GraphQL', 'Node.js'],            source: 'Referral',    score: 81, notes: 'Referral via huidige klant; sterke communicatie.' },
  { n: 3,  name: 'Noor Janssen',       email: 'noor.janssen@example.com',      skills: ['Vue', 'TypeScript', 'CSS'],               source: 'Indeed',      score: 74, notes: 'Wil overstappen van agency naar product.' },
  { n: 4,  name: 'Daan Visser',        email: 'daan.visser@example.com',       skills: ['React', 'Redux', 'Jest'],                 source: 'LinkedIn',    score: 79, notes: 'Opzegtermijn 2 maanden.' },
  { n: 5,  name: 'Fatima el Amrani',   email: 'fatima.elamrani@example.com',   skills: ['React', 'Next.js', 'Tailwind'],           source: 'Career Fair', score: 91, notes: 'Topkandidaat; ook in gesprek bij twee anderen — snel schakelen.' },
  { n: 6,  name: 'Ruben Smit',         email: 'ruben.smit@example.com',        skills: ['Angular', 'TypeScript', 'RxJS'],          source: 'Indeed',      score: 66, notes: 'Angular-achtergrond, wil React leren.' },
  { n: 7,  name: 'Lisa Mulder',        email: 'lisa.mulder@example.com',       skills: ['React', 'TypeScript', 'Storybook'],       source: 'LinkedIn',    score: 85, notes: 'Design-system-ervaring bij scale-up.' },
  { n: 8,  name: 'Mehmet Yilmaz',      email: 'mehmet.yilmaz@example.com',     skills: ['React Native', 'TypeScript'],             source: 'Referral',    score: 77, notes: 'Mobile-first profiel; match voor toekomstige app.' },
  { n: 9,  name: 'Emma van Dijk',      email: 'emma.vandijk@example.com',      skills: ['Python', 'SQL', 'dbt'],                   source: 'LinkedIn',    score: 83, notes: 'Data-profiel; ook interessant voor data-rollen.' },
  { n: 10, name: 'Joris Hendriks',     email: 'joris.hendriks@example.com',    skills: ['Java', 'Spring', 'Kubernetes'],           source: 'Manual',      score: 70, notes: 'Backend-zwaargewicht, handmatig toegevoegd na meetup.' },
  { n: 11, name: 'Aaliyah Osei',       email: 'aaliyah.osei@example.com',      skills: ['React', 'Node.js', 'AWS'],                source: 'Career Fair', score: 89, notes: 'Fullstack; sterke referenties.' },
  { n: 12, name: 'Pieter Willems',     email: 'pieter.willems@example.com',    skills: ['PHP', 'Laravel', 'MySQL'],                source: 'Indeed',      score: 58, notes: 'Profiel matcht matig met huidige vacatures.' },
];

const ORGS = [
  { n: 101, name: 'ITProposal BV',        industry: 'Recruitment',  type: 'client',   website: 'https://itproposal.nl' },
  { n: 102, name: 'Brouwer Logistics',    industry: 'Logistiek',    type: 'client',   website: 'https://brouwerlogistics.example' },
  { n: 103, name: 'FinWise Group',        industry: 'FinTech',      type: 'prospect', website: 'https://finwise.example' },
];

const CONTACTS = [
  { n: 201, org: 101, name: 'Karin Bos',      email: 'karin@itproposal.nl',          role: 'HR Director' },
  { n: 202, org: 102, name: 'Jeroen Brouwer', email: 'jeroen@brouwerlogistics.example', role: 'COO' },
  { n: 203, org: 103, name: 'Sophie Lin',     email: 'sophie@finwise.example',       role: 'Head of Engineering' },
];

const DEALS = [
  { n: 301, org: 101, title: 'Detachering frontend Q3',      stage: 'gewonnen',       value: 18000 },
  { n: 302, org: 102, title: 'Werving 2x warehouse-lead',    stage: 'onderhandeling', value: 12500 },
  { n: 303, org: 103, title: 'RPO-pilot engineering',        stage: 'offerte',        value: 30000 },
  { n: 304, org: 103, title: 'Exclusieve search CTO',        stage: 'prospect',       value: 25000 },
];

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const { rows: [tenant] } = await client.query(
    `SELECT id FROM tenants WHERE slug = $1`, [TENANT_SLUG]
  );
  if (!tenant) {
    console.error(`[seed-demo] tenant met slug "${TENANT_SLUG}" niet gevonden`);
    process.exit(1);
  }
  const TENANT = tenant.id;
  console.log(`[seed-demo] tenant ${TENANT_SLUG} (${TENANT})`);

  const { rows: [recruiter] } = await client.query(
    `SELECT id FROM users WHERE tenant_id = $1 AND role = 'admin' ORDER BY created_at ASC LIMIT 1`,
    [TENANT]
  );
  const RECRUITER = recruiter?.id ?? null;

  // ─── Kandidaten ──────────────────────────────────────────────────────────
  for (const c of CANDIDATES) {
    await client.query(
      `INSERT INTO candidates (id, tenant_id, name, email, phone, skills, ai_score, source, tags, notes)
       VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9::text[], $10)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, email = EXCLUDED.email, skills = EXCLUDED.skills,
             ai_score = EXCLUDED.ai_score, source = EXCLUDED.source, notes = EXCLUDED.notes,
             deleted_at = NULL`,
      [did(c.n), TENANT, c.name, c.email, `+31 6 ${String(10000000 + c.n * 137).slice(0, 8)}`,
       c.skills, c.score, c.source, c.score >= 85 ? ['top-kandidaat'] : [], c.notes]
    );
  }
  console.log(`[seed-demo] ${CANDIDATES.length} kandidaten upserted`);

  // ─── Sollicitaties: verdeel kandidaten 1-8 over de stages van de open job ─
  const { rows: [openJob] } = await client.query(
    `SELECT id, title FROM jobs
     WHERE tenant_id = $1 AND status = 'open' AND deleted_at IS NULL
     ORDER BY created_at ASC LIMIT 1`,
    [TENANT]
  );
  if (!openJob) {
    console.warn('[seed-demo] geen open vacature gevonden — sollicitaties/interviews overgeslagen');
  } else {
    const { rows: stages } = await client.query(
      `SELECT id, name, position FROM pipeline_stages
       WHERE job_id = $1 AND tenant_id = $2 ORDER BY position ASC`,
      [openJob.id, TENANT]
    );
    if (stages.length === 0) {
      console.warn('[seed-demo] open vacature heeft geen stages — sollicitaties overgeslagen');
    } else {
      // Spreiding: vroege stages meer kandidaten dan late (echte funnel-vorm).
      const spread = [3, 2, 1, 1, 1]; // per stage-index, totaal 8
      let cand = 1;
      let appN = 400;
      const appIds: Array<{ id: string; stageIdx: number }> = [];
      for (let s = 0; s < Math.min(stages.length, spread.length); s++) {
        for (let k = 0; k < spread[s] && cand <= 8; k++, cand++) {
          const appId = did(appN++);
          await client.query(
            `INSERT INTO applications (id, tenant_id, job_id, candidate_id, stage_id, status, applied_at)
             VALUES ($1, $2, $3, $4, $5, 'active', now() - ($6 || ' days')::interval)
             ON CONFLICT (tenant_id, job_id, candidate_id) DO UPDATE
               SET stage_id = EXCLUDED.stage_id, status = 'active'`,
            [appId, TENANT, openJob.id, did(cand), stages[s].id, String(14 - cand)]
          );
          appIds.push({ id: appId, stageIdx: s });
        }
      }
      // 1 afwijzing voor een eerlijke funnel.
      await client.query(
        `INSERT INTO applications (id, tenant_id, job_id, candidate_id, stage_id, status, applied_at)
         VALUES ($1, $2, $3, $4, $5, 'rejected', now() - interval '12 days')
         ON CONFLICT (tenant_id, job_id, candidate_id) DO UPDATE
           SET status = 'rejected'`,
        [did(450), TENANT, openJob.id, did(12), stages[0].id]
      );
      console.log(`[seed-demo] ${cand - 1} actieve sollicitaties + 1 afwijzing op "${openJob.title}"`);

      // ─── Interviews: pak sollicitaties uit een latere stage ─────────────
      const lateApps = appIds.filter((a) => a.stageIdx >= 2);
      const interviewTargets = (lateApps.length >= 2 ? lateApps : appIds).slice(0, 3);
      const slots = [
        { n: 501, start: 'now() + interval \'3 hours\'',  end: 'now() + interval \'4 hours\'',  status: 'scheduled', provider: 'google_meet', url: 'https://meet.google.com/demo-tf-501' },
        { n: 502, start: 'now() + interval \'1 day\'',    end: 'now() + interval \'1 day 1 hour\'', status: 'scheduled', provider: 'teams', url: 'https://teams.microsoft.com/demo-tf-502' },
        { n: 503, start: 'now() - interval \'2 days\'',   end: 'now() - interval \'2 days\' + interval \'1 hour\'', status: 'completed', provider: 'in_person', url: null },
      ];
      for (let i = 0; i < interviewTargets.length && i < slots.length; i++) {
        const s = slots[i];
        await client.query(
          `INSERT INTO interviews (id, tenant_id, application_id, scheduled_start, scheduled_end,
                                   meeting_url, meeting_provider, status, created_by, notes)
           VALUES ($1, $2, $3, ${s.start}, ${s.end}, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO UPDATE
             SET scheduled_start = EXCLUDED.scheduled_start,
                 scheduled_end = EXCLUDED.scheduled_end,
                 status = EXCLUDED.status`,
          [did(s.n), TENANT, interviewTargets[i].id, s.url, s.provider, s.status, RECRUITER,
           s.status === 'completed' ? 'Sterk gesprek; doorzetten naar volgende ronde.' : null]
        );
      }
      console.log(`[seed-demo] ${Math.min(interviewTargets.length, slots.length)} interviews upserted`);

      // ─── Activities voor de dashboard-feed ───────────────────────────────
      const acts = [
        { n: 601, action: 'application', days: 1 },
        { n: 602, action: 'stage_change', days: 0 },
        { n: 603, action: 'application', days: 2 },
      ];
      for (const a of acts) {
        await client.query(
          `INSERT INTO activities (id, tenant_id, entity_type, entity_id, user_id, action, payload, created_at)
           VALUES ($1, $2, 'application', $3, $4, $5, '{}'::jsonb, now() - ($6 || ' days')::interval)
           ON CONFLICT (id) DO NOTHING`,
          [did(a.n), TENANT, appIds[0]?.id ?? did(400), RECRUITER, a.action, String(a.days)]
        );
      }
      console.log('[seed-demo] activities upserted');
    }
  }

  // ─── CRM: organisaties, contacten, deals ─────────────────────────────────
  for (const o of ORGS) {
    await client.query(
      `INSERT INTO organizations (id, tenant_id, name, industry, website, type)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, industry = EXCLUDED.industry,
             type = EXCLUDED.type, deleted_at = NULL`,
      [did(o.n), TENANT, o.name, o.industry, o.website, o.type]
    );
  }
  for (const c of CONTACTS) {
    await client.query(
      `INSERT INTO crm_contacts (id, tenant_id, organization_id, name, email, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role,
             deleted_at = NULL`,
      [did(c.n), TENANT, did(c.org), c.name, c.email, c.role]
    );
  }
  for (const d of DEALS) {
    await client.query(
      `INSERT INTO crm_deals (id, tenant_id, organization_id, recruiter_id, title, stage, value_eur)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title, stage = EXCLUDED.stage,
             value_eur = EXCLUDED.value_eur, deleted_at = NULL`,
      [did(d.n), TENANT, did(d.org), RECRUITER, d.title, d.stage, d.value]
    );
  }
  console.log(`[seed-demo] CRM: ${ORGS.length} organisaties, ${CONTACTS.length} contacten, ${DEALS.length} deals`);

  await client.end();
  console.log('[seed-demo] done ✔');
}

main().catch((err) => {
  console.error('[seed-demo] FAIL:', err);
  process.exit(1);
});
