/*
 * RLS-isolatieproef — bewijst dat een NON-OWNER, NON-BYPASSRLS rol de
 * tenant-grens daadwerkelijk afdwingt na migratie 036 (FORCE + WITH CHECK).
 *
 * Maakt een tijdelijke testrol aan, geeft 'm app-privileges, en test als die
 * rol vier scenario's tegen `candidates`. Ruimt de rol daarna op. Wijzigt geen
 * data (alle inserts in een ROLLBACK).
 *
 * Draait als de owner (neondb_owner) voor het aanmaken/opruimen van de rol.
 */
require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

const TENANT_A = '11111111-1111-1111-1111-aaaaaaaaaaaa';
const TENANT_B = '22222222-2222-2222-2222-bbbbbbbbbbbb';
const ROLE = 'tf_rls_proof';
const PW = 'Proof_' + crypto.randomBytes(9).toString('hex');

const ownerUrl = process.env.DATABASE_URL;
const owner = new Pool({ connectionString: ownerUrl, connectionTimeoutMillis: 30000 });

function asRoleUrl() {
  const u = new URL(ownerUrl);
  u.username = ROLE;
  u.password = PW;
  return u.toString();
}

(async () => {
  // 1) Rol aanmaken + rechten geven (als owner).
  await owner.query(`DROP ROLE IF EXISTS ${ROLE}`);
  await owner.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${PW}' NOBYPASSRLS`);
  await owner.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
  await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`);
  await owner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`);
  console.log(`[proof] rol ${ROLE} aangemaakt (NOBYPASSRLS) + app-grants`);

  const role = new Pool({ connectionString: asRoleUrl(), connectionTimeoutMillis: 30000, max: 2 });
  const results = {};
  try {
    // Bevestig dat de rol echt geen bypass heeft.
    const attr = await role.query('SELECT current_user AS u, rolbypassrls FROM pg_roles WHERE rolname = current_user');
    console.log('[proof] verbonden als:', attr.rows[0]);

    // Scenario A — tenant A gezet: ziet A's kandidaten.
    {
      const c = await role.connect();
      try {
        await c.query('BEGIN');
        await c.query(`SET LOCAL app.tenant_id = '${TENANT_A}'`);
        const r = await c.query('SELECT count(*)::int AS n FROM candidates');
        await c.query('COMMIT');
        results.A_ziet_eigen = r.rows[0].n;
      } finally { c.release(); }
    }

    // Scenario B — tenant B gezet (geen kandidaten): ziet A's rijen NIET.
    {
      const c = await role.connect();
      try {
        await c.query('BEGIN');
        await c.query(`SET LOCAL app.tenant_id = '${TENANT_B}'`);
        const r = await c.query('SELECT count(*)::int AS n FROM candidates');
        await c.query('COMMIT');
        results.B_ziet_van_A = r.rows[0].n;
      } finally { c.release(); }
    }

    // Scenario C — GEEN tenant gezet: geweigerd. De policy-expressie
    // (current_setting(...)::uuid) faalt LUID op een lege GUC i.p.v. stil 0
    // rijen te geven — ook een vorm van deny (geen lek). We accepteren beide.
    {
      const c = await role.connect();
      try {
        const r = await c.query('SELECT count(*)::int AS n FROM candidates');
        results.geen_ctx = r.rows[0].n === 0 ? 'GEWEIGERD (0 rijen)' : `LEK! (${r.rows[0].n})`;
      } catch (e) {
        results.geen_ctx = 'GEWEIGERD (error: ' + e.message.split('\n')[0] + ')';
      } finally { c.release(); }
    }

    // Scenario D — WITH CHECK: als tenant A, proberen rij met tenant B in te voegen → moet falen.
    {
      const c = await role.connect();
      try {
        await c.query('BEGIN');
        await c.query(`SET LOCAL app.tenant_id = '${TENANT_A}'`);
        await c.query(
          `INSERT INTO candidates (tenant_id, name) VALUES ('${TENANT_B}', 'cross-tenant-smokkel')`
        );
        await c.query('ROLLBACK');
        results.D_cross_insert = 'TOEGESTAAN (LEK!)';
      } catch (e) {
        results.D_cross_insert = 'GEBLOKKEERD: ' + e.message.split('\n')[0];
        // Belangrijk: ROLLBACK op DEZE connectie vóór release, anders komt 'm
        // in aborted-state terug in de pool en breekt de volgende scenario.
        try { await c.query('ROLLBACK'); } catch {}
      } finally { c.release(); }
    }

    // Scenario E — legitieme insert binnen eigen tenant: moet slagen (en rollback).
    {
      const c = await role.connect();
      try {
        await c.query('BEGIN');
        await c.query(`SET LOCAL app.tenant_id = '${TENANT_A}'`);
        await c.query(`INSERT INTO candidates (tenant_id, name) VALUES ('${TENANT_A}', 'eigen-tenant-ok')`);
        await c.query('ROLLBACK');
        results.E_eigen_insert = 'TOEGESTAAN (correct)';
      } catch (e) {
        results.E_eigen_insert = 'GEBLOKKEERD (onverwacht): ' + e.message.split('\n')[0];
        try { await c.query('ROLLBACK'); } catch {}
      } finally { c.release(); }
    }
  } finally {
    await role.end();
    // 3) Rol opruimen (als owner). Revoke eerst, anders blokkeren de grants DROP.
    await owner.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ROLE}`);
    await owner.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${ROLE}`);
    await owner.query(`REVOKE ALL ON SCHEMA public FROM ${ROLE}`);
    await owner.query(`DROP ROLE IF EXISTS ${ROLE}`);
    console.log(`[proof] rol ${ROLE} opgeruimd`);
  }

  console.log('\n== ISOLATIE-RESULTATEN (non-owner rol) ==');
  console.log('A) tenant A gezet, telt eigen kandidaten :', results.A_ziet_eigen, results.A_ziet_eigen === 12 ? 'OK' : '??');
  console.log('B) tenant B gezet, telt A-kandidaten     :', results.B_ziet_van_A, results.B_ziet_van_A === 0 ? 'OK (geïsoleerd)' : 'LEK!');
  console.log('C) geen tenant-ctx                        :', results.geen_ctx);
  console.log('D) cross-tenant INSERT                    :', results.D_cross_insert);
  console.log('E) eigen-tenant INSERT                    :', results.E_eigen_insert);

  const pass = results.A_ziet_eigen === 12 && results.B_ziet_van_A === 0 &&
               /GEWEIGERD/.test(results.geen_ctx) && /GEBLOKKEERD/.test(results.D_cross_insert) &&
               /TOEGESTAAN/.test(results.E_eigen_insert);
  console.log('\n>>> ISOLATIE', pass ? 'BEWEZEN ✔ — non-owner rol dwingt tenant-grens af' : 'NIET compleet — zie hierboven');
  await owner.end();
  process.exit(pass ? 0 : 1);
})().catch(async (e) => {
  console.error('[proof] FAIL:', e.message);
  try { await owner.query(`DROP ROLE IF EXISTS ${ROLE}`); } catch {}
  try { await owner.end(); } catch {}
  process.exit(2);
});
