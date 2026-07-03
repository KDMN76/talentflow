/**
 * Tests voor lib/readiness.ts — de `/health/ready` handler.
 *
 * Geen echte Postgres of Redis: de deps zijn injectable, dus we geven mocks.
 * De timeout-paden gebruiken een korte timeoutMs zodat de test snel blijft.
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import type { Request, Response } from 'express';
import { createReadinessHandler } from '../../src/lib/readiness';

interface MockRes {
  status: Mock;
  json: Mock;
}

function mockRes(): MockRes & Response {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res as unknown as MockRes & Response;
}

const req = {} as Request;

const okDb = { query: vi.fn(async () => ({ rows: [{ '?column?': 1 }] })) };
const okRedis = { ping: vi.fn(async () => 'PONG') };
const failingDb = { query: vi.fn(async () => Promise.reject(new Error('db down'))) };
const failingRedis = { ping: vi.fn(async () => Promise.reject(new Error('redis down'))) };
/** Promise die nooit resolvet — simuleert een hangende dependency. */
const hangingDb = { query: vi.fn(() => new Promise<never>(() => {})) };
const hangingRedis = { ping: vi.fn(() => new Promise<never>(() => {})) };

describe('createReadinessHandler', () => {
  it('geeft 200 + ready wanneer db en redis beide ok zijn', async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) };
    const redis = { ping: vi.fn(async () => 'PONG') };
    const handler = createReadinessHandler({ db, redis });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      status: 'ready',
      checks: { db: 'ok', redis: 'ok' },
    });
    // Contract: SELECT 1 op Postgres, PING op Redis.
    expect(db.query).toHaveBeenCalledWith('SELECT 1');
    expect(redis.ping).toHaveBeenCalledTimes(1);
  });

  it('geeft 503 + not_ready wanneer de db-check faalt', async () => {
    const handler = createReadinessHandler({ db: failingDb, redis: okRedis });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      status: 'not_ready',
      checks: { db: 'failed', redis: 'ok' },
    });
  });

  it('geeft 503 + not_ready wanneer de redis-check faalt', async () => {
    const handler = createReadinessHandler({ db: okDb, redis: failingRedis });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      status: 'not_ready',
      checks: { db: 'ok', redis: 'failed' },
    });
  });

  it('geeft 503 wanneer beide dependencies falen', async () => {
    const handler = createReadinessHandler({
      db: failingDb,
      redis: failingRedis,
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      status: 'not_ready',
      checks: { db: 'failed', redis: 'failed' },
    });
  });

  it('markeert een hangende db-check als failed via de timeout', async () => {
    const handler = createReadinessHandler({
      db: hangingDb,
      redis: okRedis,
      timeoutMs: 20,
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      status: 'not_ready',
      checks: { db: 'failed', redis: 'ok' },
    });
  });

  it('markeert een hangende redis-check als failed via de timeout', async () => {
    const handler = createReadinessHandler({
      db: okDb,
      redis: hangingRedis,
      timeoutMs: 20,
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      status: 'not_ready',
      checks: { db: 'ok', redis: 'failed' },
    });
  });
});
