/**
 * Pay-transparency middleware tests — Sprint Q3.6 (Agent III).
 *
 * Test:
 *   - POST zonder status='open' → next() (geen blokkade)
 *   - POST met status='open' zonder salary-band + enforced=TRUE → 422
 *   - POST met status='open' met volledige salary-band → next()
 *   - POST met enforced=FALSE → next() ongeacht band
 *   - PATCH met status='open' zonder body-band maar DB heeft band → next()
 *   - PATCH met status='open' zonder body-band en DB ook geen band → 422
 *   - PATCH met expliciet salary_min=null clears de band → 422
 *   - DB-fout → soft-fail → next() (mag niet 500-en)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';
import { enforcePayTransparency } from '../../src/middleware/payTransparency';
import type { Request, Response, NextFunction } from 'express';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const JOB_ID = '33333333-3333-3333-3333-333333333333';

interface MockRes {
  statusCode: number | null;
  jsonBody: unknown;
  status: (code: number) => MockRes;
  json: (body: unknown) => MockRes;
}

function buildReq(overrides: Partial<Request>): Request {
  const base = {
    method: 'POST',
    body: {},
    params: {} as Record<string, string>,
    user: { tenantId: TENANT_ID, userId: USER_ID, email: '', role: 'admin' },
    headers: {},
    get: () => undefined,
    socket: {} as unknown,
    ip: '127.0.0.1',
    originalUrl: '/api/jobs',
    ...overrides,
  };
  return base as unknown as Request;
}

function buildRes(): MockRes {
  const res: MockRes = {
    statusCode: null,
    jsonBody: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.jsonBody = body;
      return this;
    },
  };
  return res;
}

describe('enforcePayTransparency middleware', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('past door als status niet "open" is', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);

    const req = buildReq({ method: 'POST', body: { title: 'Engineer', status: 'draft' } });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await enforcePayTransparency(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });

  it('past door als body geen status veld bevat', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);

    const req = buildReq({ method: 'POST', body: { title: 'Engineer' } });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await enforcePayTransparency(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('blokkeert POST status=open zonder salary-band wanneer enforced', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM tenant_pay_settings/i.test(sql)) {
          return {
            rows: [{ pay_transparency_enforced: true }],
            rowCount: 1,
          };
        }
        if (/INSERT INTO audit_events/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const req = buildReq({ method: 'POST', body: { title: 'Engineer', status: 'open' } });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await enforcePayTransparency(req, res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(422);
    expect((res.jsonBody as { error: { code: string } }).error.code).toBe(
      'PAY_TRANSPARENCY_REQUIRED'
    );
  });

  it('past door bij POST status=open MET volledige salary-band', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM tenant_pay_settings/i.test(sql)) {
          return {
            rows: [{ pay_transparency_enforced: true }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const req = buildReq({
      method: 'POST',
      body: {
        title: 'Engineer',
        status: 'open',
        salary_min: 40000,
        salary_max: 60000,
      },
    });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await enforcePayTransparency(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });

  it('past door wanneer tenant enforced=FALSE', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM tenant_pay_settings/i.test(sql)) {
          return {
            rows: [{ pay_transparency_enforced: false }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const req = buildReq({ method: 'POST', body: { title: 'X', status: 'open' } });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await enforcePayTransparency(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('PATCH status=open zonder body-band maar DB heeft band → next()', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM tenant_pay_settings/i.test(sql)) {
          return {
            rows: [{ pay_transparency_enforced: true }],
            rowCount: 1,
          };
        }
        if (/FROM jobs/i.test(sql)) {
          return {
            rows: [{ salary_min: 40000, salary_max: 60000 }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const req = buildReq({
      method: 'PATCH',
      body: { status: 'open' },
      params: { id: JOB_ID },
      originalUrl: `/api/jobs/${JOB_ID}`,
    });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await enforcePayTransparency(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('PATCH status=open zonder band ook in DB → 422', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM tenant_pay_settings/i.test(sql)) {
          return {
            rows: [{ pay_transparency_enforced: true }],
            rowCount: 1,
          };
        }
        if (/FROM jobs/i.test(sql)) {
          return {
            rows: [{ salary_min: null, salary_max: null }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const req = buildReq({
      method: 'PATCH',
      body: { status: 'open' },
      params: { id: JOB_ID },
      originalUrl: `/api/jobs/${JOB_ID}`,
    });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await enforcePayTransparency(req, res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(422);
  });

  it('PATCH met expliciet salary_min=null wist de band → 422 ondanks DB-band', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM tenant_pay_settings/i.test(sql)) {
          return {
            rows: [{ pay_transparency_enforced: true }],
            rowCount: 1,
          };
        }
        if (/FROM jobs/i.test(sql)) {
          return {
            rows: [{ salary_min: 40000, salary_max: 60000 }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const req = buildReq({
      method: 'PATCH',
      body: { status: 'open', salary_min: null },
      params: { id: JOB_ID },
      originalUrl: `/api/jobs/${JOB_ID}`,
    });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await enforcePayTransparency(req, res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(422);
  });

  it('soft-fail bij DB-error — middleware roept next() aan', async () => {
    client = mockClient({
      __matcher: () => {
        throw new Error('connection refused');
      },
    });
    teardown = installPoolMock(client);

    const req = buildReq({ method: 'POST', body: { title: 'X', status: 'open' } });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await enforcePayTransparency(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });

  it('zonder req.user (geen auth) past gewoon door (defensief)', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);

    const req = buildReq({});
    delete (req as { user?: unknown }).user;
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await enforcePayTransparency(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });
});
