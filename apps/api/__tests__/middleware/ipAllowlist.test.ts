/**
 * IP-allowlist middleware tests — Sprint Q4.2.
 *
 * Tests:
 *   - ipInCidr: IPv4-CIDR (exact, /24, /32, /0)
 *   - ipInCidr: IPv6-CIDR (exact, /64, /128)
 *   - ipInCidr: IPv4-mapped IPv6 (::ffff:1.2.3.4 matched 1.2.3.0/24)
 *   - ipInCidr: invalid CIDR returns false
 *   - ipInAllowlist: any-match
 *   - getClientIp: respects X-Forwarded-For first hop
 *   - enforceIpAllowlist: bypasses /api/auth/*, /health, /api-docs
 *   - enforceIpAllowlist: bypass when settings missing or enforced=false
 *   - enforceIpAllowlist: 403 + audit when IP not in allowlist
 *   - enforceIpAllowlist: 403 when allowlist enforced but empty
 *   - enforceIpAllowlist: soft-fail bij DB-error
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  enforceIpAllowlist,
  ipInCidr,
  ipInAllowlist,
  getClientIp,
  normaliseIp,
} from '../../src/middleware/ipAllowlist';
import {
  mockClient,
  installPoolMock,
  type MockClient,
} from '../helpers/dbMock';
import type { Request, Response, NextFunction } from 'express';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

function makeJwt(): string {
  return jwt.sign(
    { userId: USER_ID, tenantId: TENANT_ID, email: 'a@b.c', role: 'admin' },
    process.env.JWT_SECRET as string
  );
}

interface MockRes {
  statusCode: number | null;
  jsonBody: unknown;
  status: (code: number) => MockRes;
  json: (body: unknown) => MockRes;
}

function buildReq(overrides: Partial<Request> = {}): Request {
  const base = {
    method: 'GET',
    body: {},
    params: {},
    headers: {},
    get: () => undefined,
    socket: { remoteAddress: '127.0.0.1' } as unknown,
    ip: '203.0.113.5',
    path: '/api/candidates',
    originalUrl: '/api/candidates',
    ...overrides,
  };
  return base as unknown as Request;
}

function buildRes(): MockRes {
  return {
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('ipInCidr — IPv4', () => {
  it('matches exact IP without mask', () => {
    expect(ipInCidr('1.2.3.4', '1.2.3.4')).toBe(true);
    expect(ipInCidr('1.2.3.5', '1.2.3.4')).toBe(false);
  });
  it('matches /32 (single IP)', () => {
    expect(ipInCidr('1.2.3.4', '1.2.3.4/32')).toBe(true);
    expect(ipInCidr('1.2.3.5', '1.2.3.4/32')).toBe(false);
  });
  it('matches /24', () => {
    expect(ipInCidr('10.0.0.1', '10.0.0.0/24')).toBe(true);
    expect(ipInCidr('10.0.0.255', '10.0.0.0/24')).toBe(true);
    expect(ipInCidr('10.0.1.1', '10.0.0.0/24')).toBe(false);
  });
  it('matches /8', () => {
    expect(ipInCidr('10.255.255.255', '10.0.0.0/8')).toBe(true);
    expect(ipInCidr('11.0.0.1', '10.0.0.0/8')).toBe(false);
  });
  it('/0 matches everything', () => {
    expect(ipInCidr('203.0.113.5', '0.0.0.0/0')).toBe(true);
  });
  it('invalid CIDR returns false', () => {
    expect(ipInCidr('1.2.3.4', 'not-a-cidr')).toBe(false);
    expect(ipInCidr('1.2.3.4', '1.2.3.4/99')).toBe(false);
    expect(ipInCidr('1.2.3.4', '999.999.999.999/24')).toBe(false);
  });
});

describe('ipInCidr — IPv6', () => {
  it('matches exact IPv6', () => {
    expect(ipInCidr('2001:db8::1', '2001:db8::1')).toBe(true);
    expect(ipInCidr('2001:db8::2', '2001:db8::1')).toBe(false);
  });
  it('matches /64', () => {
    expect(ipInCidr('2001:db8::1', '2001:db8::/64')).toBe(true);
    expect(ipInCidr('2001:db8::ffff', '2001:db8::/64')).toBe(true);
    expect(ipInCidr('2001:db9::1', '2001:db8::/64')).toBe(false);
  });
  it('/128 single host', () => {
    expect(ipInCidr('2001:db8::1', '2001:db8::1/128')).toBe(true);
    expect(ipInCidr('2001:db8::2', '2001:db8::1/128')).toBe(false);
  });
});

describe('normaliseIp + IPv4-mapped IPv6', () => {
  it('un-maps ::ffff:1.2.3.4 to 1.2.3.4', () => {
    expect(normaliseIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
  });
  it('mapped IPv6 matched een v4-CIDR', () => {
    expect(ipInCidr('::ffff:10.0.0.1', '10.0.0.0/8')).toBe(true);
  });
});

describe('ipInAllowlist', () => {
  it('any-match wins', () => {
    expect(ipInAllowlist('192.168.1.5', ['10.0.0.0/8', '192.168.0.0/16'])).toBe(true);
    expect(ipInAllowlist('1.1.1.1', ['10.0.0.0/8', '192.168.0.0/16'])).toBe(false);
  });
  it('lege lijst → false', () => {
    expect(ipInAllowlist('1.2.3.4', [])).toBe(false);
  });
});

describe('getClientIp', () => {
  it('returnt req.ip eerst', () => {
    const req = buildReq({ ip: '1.2.3.4' });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });
  it('valt terug op X-Forwarded-For first hop', () => {
    const req = buildReq({
      ip: '',
      headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' },
    });
    expect(getClientIp(req)).toBe('203.0.113.1');
  });
  it('valt terug op socket.remoteAddress', () => {
    const req = buildReq({
      ip: '',
      headers: {},
      socket: { remoteAddress: '10.0.0.5' } as unknown,
    } as Partial<Request>);
    expect(getClientIp(req)).toBe('10.0.0.5');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Middleware integration
// ─────────────────────────────────────────────────────────────────────────────

describe('enforceIpAllowlist middleware', () => {
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('bypasses /api/auth/login', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const req = buildReq({ path: '/api/auth/login' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await enforceIpAllowlist(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });

  it('bypasses /health', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const req = buildReq({ path: '/health' });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await enforceIpAllowlist(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('past door wanneer geen JWT (pre-auth)', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const req = buildReq({ path: '/api/candidates' }); // geen Authorization
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await enforceIpAllowlist(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('past door wanneer settings missen (lazy default)', async () => {
    const client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    const req = buildReq({
      path: '/api/candidates',
      headers: { authorization: `Bearer ${makeJwt()}` },
    });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await enforceIpAllowlist(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('past door wanneer enforced=FALSE', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/FROM tenant_security_settings/i.test(sql)) {
          return {
            rows: [{ ip_allowlist: ['10.0.0.0/8'], ip_allowlist_enforced: false }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const req = buildReq({
      path: '/api/candidates',
      ip: '1.1.1.1',
      headers: { authorization: `Bearer ${makeJwt()}` },
    });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await enforceIpAllowlist(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('staat IP toe binnen CIDR', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/FROM tenant_security_settings/i.test(sql)) {
          return {
            rows: [{ ip_allowlist: ['10.0.0.0/8'], ip_allowlist_enforced: true }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const req = buildReq({
      path: '/api/candidates',
      ip: '10.5.5.5',
      headers: { authorization: `Bearer ${makeJwt()}` },
    });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await enforceIpAllowlist(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('blokkeert IP buiten CIDR met 403', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/FROM tenant_security_settings/i.test(sql)) {
          return {
            rows: [{ ip_allowlist: ['10.0.0.0/8'], ip_allowlist_enforced: true }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const req = buildReq({
      path: '/api/candidates',
      ip: '203.0.113.5',
      headers: { authorization: `Bearer ${makeJwt()}` },
    });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await enforceIpAllowlist(req, res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect((res.jsonBody as { error: { code: string } }).error.code).toBe(
      'IP_NOT_ALLOWED'
    );
  });

  it('blokkeert wanneer enforced=true maar lege allowlist', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/FROM tenant_security_settings/i.test(sql)) {
          return {
            rows: [{ ip_allowlist: [], ip_allowlist_enforced: true }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const req = buildReq({
      path: '/api/candidates',
      ip: '10.0.0.1',
      headers: { authorization: `Bearer ${makeJwt()}` },
    });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await enforceIpAllowlist(req, res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('soft-fail bij DB-error — request gaat door', async () => {
    const client: MockClient = mockClient({
      __matcher: () => {
        throw new Error('connection refused');
      },
    });
    teardown = installPoolMock(client);

    const req = buildReq({
      path: '/api/candidates',
      headers: { authorization: `Bearer ${makeJwt()}` },
    });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await enforceIpAllowlist(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });
});
