/**
 * Database mock helper.
 *
 * Provides a `mockClient(scenarios)` factory that returns a PoolClient-like
 * object whose `query()` looks at the SQL string and returns canned rows.
 *
 * Two ways to use it:
 *   1. Map keyed by table-name (matched against `FROM <table>`):
 *
 *        const client = mockClient({ candidates: [{ id: 'c1' }] });
 *
 *   2. Sequential queue of responses (returned in call order):
 *
 *        const client = mockClient({ __sequence: [
 *          { rows: [{ id: 'c1' }], rowCount: 1 },
 *          { rows: [], rowCount: 0 },
 *        ]});
 *
 *   3. Dynamic matchers — caller can supply a function:
 *
 *        const client = mockClient({ __matcher: (sql) => ({ rows: ... }) });
 *
 * `installPoolMock(client)` overrides `pool.connect` to return the given mock
 * so service code under test transparently uses it through `withTenant` /
 * `withoutTenant`.
 */

import { vi, type Mock } from 'vitest';
import type { PoolClient } from 'pg';
import { pool } from '../../src/db/pool';

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface MockClient extends PoolClient {
  query: Mock;
  release: Mock;
}

export interface MockClientOptions {
  /**
   * Map keyed by table name. The first FROM/INTO/UPDATE word in the query
   * is matched against keys here; matching key's rows are returned.
   *
   * Special key "__matcher" lets the caller fully take over.
   */
  [table: string]:
    | Record<string, unknown>[]
    | QueryResult
    | ((sql: string, params: unknown[]) => Promise<QueryResult> | QueryResult)
    | unknown[];
}

/**
 * Extract the first table name from a SQL string. Looks for FROM, INTO, or
 * UPDATE followed by an identifier. Returns null if none found.
 */
function extractTableHint(sql: string): string | null {
  const re = /\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*)/i;
  const m = re.exec(sql);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Build a fake PoolClient whose `query` returns canned data based on the
 * SQL pattern.
 */
export function mockClient(options: MockClientOptions = {}): MockClient {
  const matcher = options.__matcher as
    | ((sql: string, params: unknown[]) => Promise<QueryResult> | QueryResult)
    | undefined;

  const sequence = options.__sequence as QueryResult[] | undefined;
  let seqIdx = 0;

  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      // 1) Custom matcher takes precedence
      if (matcher) return matcher(sql, params);

      // 2) Sequence mode
      if (sequence && sequence.length > 0) {
        const next = sequence[Math.min(seqIdx, sequence.length - 1)];
        seqIdx++;
        return next;
      }

      // 3) Table-keyed lookup
      const table = extractTableHint(sql);
      if (table && options[table] !== undefined) {
        const value = options[table];
        if (Array.isArray(value)) {
          return { rows: value as Record<string, unknown>[], rowCount: value.length };
        }
        if (
          value &&
          typeof value === 'object' &&
          'rows' in (value as object)
        ) {
          return value as QueryResult;
        }
      }

      // BEGIN/COMMIT/ROLLBACK/SET — silent ack
      if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET\s)/i.test(sql)) {
        return { rows: [], rowCount: 0 };
      }

      // Default: empty
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  } as unknown as MockClient;

  return client;
}

/**
 * Override `pool.connect` so service code transparently uses the given
 * mock client. Returns a teardown function that restores the original
 * implementation. Always call teardown in afterEach to keep tests isolated.
 */
export function installPoolMock(client: MockClient): () => void {
  const original = pool.connect;
  // pool.connect is typed as overloaded — cast to any to assign our mock.
  (pool as unknown as { connect: unknown }).connect = vi.fn(async () => client);
  return () => {
    (pool as unknown as { connect: unknown }).connect = original;
  };
}

/**
 * Convenience: a mockClient that returns the same response for every query.
 * Used when the test only cares about call recording, not return values.
 */
export function mockClientReturning(
  rows: Record<string, unknown>[] = []
): MockClient {
  return mockClient({
    __matcher: () => ({ rows, rowCount: rows.length }),
  });
}
