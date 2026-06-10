require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 30000 });
(async () => {
  // Policy zonder WITH CHECK (candidates) + mét WITH CHECK (zoek er een)
  const c = await pool.query(
    "SELECT tablename, policyname, cmd, roles, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ('candidates','jobs') ORDER BY tablename, policyname"
  );
  console.log('=== candidates/jobs policies (geen WITH CHECK) ===');
  c.rows.forEach(r => console.log(JSON.stringify(r)));

  const withchk = await pool.query(
    "SELECT tablename, policyname, cmd, roles, qual, with_check FROM pg_policies WHERE schemaname='public' AND with_check IS NOT NULL LIMIT 3"
  );
  console.log('\n=== voorbeelden MET WITH CHECK (modern style) ===');
  withchk.rows.forEach(r => console.log(JSON.stringify(r)));

  // tenants/esco_skills policies (de uitzonderingen)
  const ex = await pool.query(
    "SELECT tablename, policyname, cmd, roles, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ('tenants','esco_skills','pipeline_template_stages','refresh_tokens','api_keys','users') ORDER BY tablename"
  );
  console.log('\n=== auth/uitzondering-tabellen ===');
  ex.rows.forEach(r => console.log(JSON.stringify(r)));
  await pool.end();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
