import { Pool, PoolClient } from 'pg';
import { logger } from '../middleware/errorHandler';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  // Bumped from 2_000 → 30_000 om Neon free-tier cold-start (~3-15s na
  // scale-to-zero) op te vangen tijdens dev. Productie (Hetzner) is altijd
  // warm, dus de hogere timeout is no-op daar. Zie ROADMAP "Neon free tier
  // scale-to-zero + pg-pool timeout".
  connectionTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle PostgreSQL client', { error: err.message });
});

/**
 * Executes a function with a dedicated DB client that has the tenant_id set for RLS.
 * The tenant_id is injected via SET LOCAL so it only applies within this transaction/session.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    // Validate UUID format before interpolation into SET LOCAL.
    // pg does not support $1 parameters in SET statements, but the UUID regex
    // guarantees no SQL injection is possible.
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenantId)) {
      throw new Error('Invalid tenant_id format');
    }
    // Wrap in an explicit transaction so SET LOCAL is scoped to this transaction
    // only. Without BEGIN, SET (not SET LOCAL) would persist for the connection's
    // lifetime — dangerous in a connection pool.
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Executes a function WITHOUT tenant isolation — used only for auth operations
 * where the tenant context is being established (login, register, refresh).
 */
export async function withoutTenant<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Auth-transactie voor de inlog-/registratie-/refresh-flow.
 *
 * Verschilt op twee punten van withoutTenant:
 *  1. Wikkelt het werk in een echte transactie (BEGIN/COMMIT/ROLLBACK). Dat is
 *     noodzakelijk omdat de auth-functies `SET LOCAL app.tenant_id` gebruiken
 *     nadat ze de tenant hebben ontdekt — zonder transactie heeft SET LOCAL in
 *     node-pg geen effect over meerdere statements (elke query autocommit).
 *  2. Optioneel `SET LOCAL app.auth_context = 'on'`. Dit zet één RLS-uitzondering
 *     aan voor de handvol secret-key-lookups die per definitie geen tenant-context
 *     kunnen hebben (refresh-token op token_hash, api-key op key_hash). De
 *     bijbehorende policies (migratie 037) staan een READ toe als auth_context
 *     'on' is; de WITH CHECK op writes blijft altijd strikt tenant-gebonden.
 *
 * Onder de huidige owner-rol (BYPASSRLS) is dit functioneel een no-op qua
 * security; het wordt pas actief zodra de app als non-owner-rol verbindt.
 */
export async function withAuthTx<T>(
  fn: (client: PoolClient) => Promise<T>,
  opts: { authContext?: boolean } = {}
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (opts.authContext) {
      await client.query("SET LOCAL app.auth_context = 'on'");
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* rollback-fouten onderdrukken; de oorspronkelijke fout is leidend */
    }
    throw err;
  } finally {
    client.release();
  }
}
