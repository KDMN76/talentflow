import { Pool, PoolClient } from 'pg';
import { logger } from '../middleware/errorHandler';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
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
