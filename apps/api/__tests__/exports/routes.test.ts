/**
 * Authenticated exports routes smoke tests — systeem-audit bugklasse 3
 * ("het laatste draadje").
 *
 * Verifieert dat de ECHTE HTTP-route-stack (requireAuth + tenantMiddleware +
 * requirePermission + controller + service) end-to-end werkt:
 *
 *   - recruiter: GET /api/exports/candidates → 200 met text/csv
 *   - viewer:    → 403 (candidates:write-guard — bulk-export dumpt PII)
 *   - zonder JWT → 401
 *
 * Patroon gekopieerd van __tests__/whatsapp/routes.test.ts: express-app met
 * de router op het echte mount-pad (zie src/index.ts: `/api/exports`),
 * jwt.sign met process.env.JWT_SECRET, en dbMock met een role-matcher voor
 * de permission-middleware queries.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

vi.mock('../../src/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/audit')>(
    '../../src/lib/audit'
  );
  return { ...actual, logAudit: vi.fn(async () => undefined) };
});

import exportsRouter from '../../src/modules/exports/exports.router';
import { errorHandler } from '../../src/middleware/errorHandler';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';

function jwtTokenForRole(role: string): string {
  return jwt.sign(
    { userId: USER_ID, tenantId: TENANT_ID, email: 'u@x.nl', role },
    process.env.JWT_SECRET!
  );
}

/** requirePermission('candidates', 'write') looks up the user's role
 * (+ any custom-role assignments) before the route handler runs.
 * Lokale kopie van de helper uit __tests__/whatsapp/routes.test.ts. */
function withRoleMatcher(
  role: string,
  extra?: (sql: string) => { rows: unknown[]; rowCount: number } | undefined
) {
  return async (sql: string) => {
    if (/FROM\s+users\b/i.test(sql)) return { rows: [{ role }], rowCount: 1 };
    if (/FROM\s+user_role_assignments\b/i.test(sql)) return { rows: [], rowCount: 0 };
    const extraResult = extra?.(sql);
    if (extraResult) return extraResult;
    return { rows: [], rowCount: 0 };
  };
}

/** Eén kandidaat-rij in de shape die listCandidates SELECT't. */
const CANDIDATE_ROW = {
  id: CAND_ID,
  candidate_reference: 'CAND-0001',
  name: 'Jane Doe',
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@example.com',
  phone: '+31612345678',
  resume_url: null,
  skills: ['react', 'typescript'],
  ai_score: 87,
  source: 'linkedin',
  tags: ['top-talent'],
  current_department: 'Engineering',
  industry: 'Tech',
  years_of_experience: 6,
  address_city: 'Rotterdam',
  address_country: 'NL',
  gdpr_consent: true,
  email_consent: false,
  created_at: '2026-01-15T10:00:00.000Z',
  updated_at: '2026-01-16T10:00:00.000Z',
};

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  // Zelfde mount-pad als src/index.ts: app.use('/api/exports', exportsRouter)
  app.use('/api/exports', exportsRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('exports routes — JWT gating', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET /candidates without JWT → 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp()).get('/api/exports/candidates');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('exports routes — happy path (recruiter)', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET /candidates as recruiter → 200 text/csv with header + data row', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('recruiter', (sql) => {
        // LET OP: de COUNT-query bevat óók "FROM candidates" — check die eerst.
        if (/COUNT\(\*\)/i.test(sql)) return { rows: [{ total: '1' }], rowCount: 1 };
        if (/FROM\s+candidates\b/i.test(sql)) return { rows: [CANDIDATE_ROW], rowCount: 1 };
        return undefined;
      }),
    });
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .get('/api/exports/candidates')
      .set('Authorization', `Bearer ${jwtTokenForRole('recruiter')}`);

    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);

    // Bestandsnaam: candidates-YYYY-MM-DD.csv
    const today = new Date().toISOString().slice(0, 10);
    expect(r.headers['content-disposition']).toBe(
      `attachment; filename="candidates-${today}.csv"`
    );
    expect(r.headers['x-export-row-count']).toBe('1');
    expect(r.headers['cache-control']).toContain('no-store');

    // CSV-inhoud: UTF-8 BOM, header-rij en de data-rij.
    expect(r.text.charCodeAt(0)).toBe(0xfeff);
    expect(r.text).toContain('id,reference,name,first_name,last_name,email');
    expect(r.text).toContain('jane@example.com');
    expect(r.text).toContain('react;typescript'); // skills join ';'
    expect(r.text).toContain(CAND_ID);
  });
});

describe('exports routes — permission gating (candidates:write)', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET /candidates as viewer → 403 INSUFFICIENT_PERMISSION', async () => {
    const client = mockClient({ __matcher: withRoleMatcher('viewer') });
    teardown = installPoolMock(client);

    const r = await request(buildApp())
      .get('/api/exports/candidates')
      .set('Authorization', `Bearer ${jwtTokenForRole('viewer')}`);

    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    expect(r.body.error.details.required).toEqual({
      resource: 'candidates',
      action: 'write',
    });
  });
});
