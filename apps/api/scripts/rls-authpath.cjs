require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 30000 });
(async () => {
  const t = await pool.query(`
    SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
           (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) AS n_pol
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'
      AND c.relname IN ('tenants','esco_skills','pipeline_template_stages','schema_migrations',
                        'refresh_tokens','users','user_2fa_secrets','api_keys','api_key_usage_log',
                        'audit_events','tenant_sso_config','scim_provisioning_log')
    ORDER BY c.relname`);
  console.table(t.rows);
  await pool.end();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
