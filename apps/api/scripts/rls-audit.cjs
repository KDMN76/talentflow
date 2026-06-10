/* Eenmalige RLS-audit — leest de echte staat, wijzigt niets. */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 30000 });

(async () => {
  const role = await pool.query(
    "SELECT current_user AS u, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
  );
  console.log('ROL:', role.rows[0]);

  const owns = await pool.query(
    "SELECT tableowner, count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' GROUP BY tableowner"
  );
  console.log('EIGENAARS:', owns.rows);

  // Per-tabel: RLS enabled? forced? heeft tenant_id-kolom? aantal policies + welke met WITH CHECK?
  const tbls = await pool.query(`
    SELECT c.relname AS tbl,
           c.relrowsecurity AS rls,
           c.relforcerowsecurity AS forced,
           EXISTS (SELECT 1 FROM information_schema.columns col
                   WHERE col.table_schema='public' AND col.table_name=c.relname AND col.column_name='tenant_id') AS has_tenant,
           (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) AS n_pol,
           (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname AND p.with_check IS NOT NULL) AS n_withcheck
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'
    ORDER BY c.relname
  `);

  const tenantTables = tbls.rows.filter(r => r.has_tenant);
  console.log('\n== SAMENVATTING ==');
  console.log('Tabellen totaal:', tbls.rows.length);
  console.log('Met tenant_id-kolom:', tenantTables.length);
  console.log('RLS enabled:', tbls.rows.filter(r => r.rls).length, '| FORCED:', tbls.rows.filter(r => r.forced).length);
  console.log('Tenant-tabellen ZONDER policy:', tenantTables.filter(r => r.n_pol === 0).map(r => r.tbl));
  console.log('Tenant-tabellen ZONDER enige WITH CHECK:', tenantTables.filter(r => r.n_withcheck === 0).map(r => r.tbl));
  console.log('Tenant-tabellen NIET forced:', tenantTables.filter(r => !r.forced).map(r => r.tbl).length, 'stuks');

  console.log('\n== TABELLEN ZONDER tenant_id (auth/global — kandidaten voor uitzondering) ==');
  console.log(tbls.rows.filter(r => !r.has_tenant).map(r => r.tbl).join(', '));

  // Kerntest: isoleert RLS nu? (verwacht NEE door bypassrls)
  const cl = await pool.connect();
  try {
    await cl.query('BEGIN');
    await cl.query("SET LOCAL app.tenant_id = '11111111-1111-1111-1111-aaaaaaaaaaaa'");
    const scoped = await cl.query('SELECT count(*)::int AS n FROM candidates');
    await cl.query('COMMIT');
    const all = await pool.query('SELECT count(*)::int AS n, count(DISTINCT tenant_id)::int AS t FROM candidates');
    console.log('\n== KERNTEST ISOLATIE ==');
    console.log('candidates met app.tenant_id=A:', scoped.rows[0].n, '| totaal:', all.rows[0].n, 'over', all.rows[0].t, 'tenants');
    console.log('RLS isoleert nu echt?', scoped.rows[0].n < all.rows[0].n ? 'JA' : 'NEE (owner bypasst — isolatie = app-WHERE)');
  } finally { cl.release(); }

  await pool.end();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
