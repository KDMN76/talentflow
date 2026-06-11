/*
 * Beheert een tijdelijke non-owner applicatierol voor de end-to-end RLS-proef.
 *
 *   node scripts/rls-e2e-role.cjs create   → maakt rol + grants, print DATABASE_URL (laatste regel)
 *   node scripts/rls-e2e-role.cjs drop     → revoke + drop rol
 *
 * De rol bootst exact na wat de productie-cutover doet: NOBYPASSRLS + alleen
 * DML-rechten (geen ownership). Zo draait de echte app onder afgedwongen RLS.
 */
require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

const ROLE = 'tf_app_e2e';
const PW_FILE = require('path').join(require('os').tmpdir(), 'tf_app_e2e_pw');
const fs = require('fs');

const owner = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 30000 });

async function create() {
  const pw = 'E2e_' + crypto.randomBytes(12).toString('hex');
  fs.writeFileSync(PW_FILE, pw);
  await owner.query(`DROP ROLE IF EXISTS ${ROLE}`);
  await owner.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${pw}' NOBYPASSRLS`);
  await owner.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
  await owner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`);
  await owner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`);
  await owner.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${ROLE}`);
  // Toekomstige objecten (defensief; cutover-runbook gebruikt hetzelfde).
  await owner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE}`);
  await owner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${ROLE}`);

  const u = new URL(process.env.DATABASE_URL);
  u.username = ROLE;
  u.password = pw;
  await owner.end();
  // Laatste regel = de URL (door bash op te pikken).
  process.stderr.write(`[e2e-role] rol ${ROLE} aangemaakt (NOBYPASSRLS) + grants\n`);
  process.stdout.write(u.toString() + '\n');
}

async function drop() {
  await owner.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ROLE}`).catch(() => {});
  await owner.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${ROLE}`).catch(() => {});
  await owner.query(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${ROLE}`).catch(() => {});
  await owner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM ${ROLE}`).catch(() => {});
  await owner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM ${ROLE}`).catch(() => {});
  await owner.query(`REVOKE ALL ON SCHEMA public FROM ${ROLE}`).catch(() => {});
  await owner.query(`DROP ROLE IF EXISTS ${ROLE}`);
  try { fs.unlinkSync(PW_FILE); } catch {}
  await owner.end();
  process.stderr.write(`[e2e-role] rol ${ROLE} opgeruimd\n`);
}

const cmd = process.argv[2];
(cmd === 'create' ? create() : cmd === 'drop' ? drop() : Promise.reject(new Error('gebruik: create|drop')))
  .catch(e => { process.stderr.write('[e2e-role] FAIL: ' + e.message + '\n'); process.exit(1); });
