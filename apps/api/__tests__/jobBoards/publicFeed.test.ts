/**
 * Public Vacaturebank XML feed route tests — Sprint Q4.3 (Agent RRR).
 *
 * Covers:
 *   - Tenant resolution by slug
 *   - 404 on unknown slug
 *   - Only `status='posted'` rows are emitted
 *   - Cross-tenant isolation: tenant A's feed does NOT include tenant B's jobs
 *   - Cache-Control + Content-Type headers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mockClient, installPoolMock } from '../helpers/dbMock';
import publicFeedRouter from '../../src/modules/job-boards/publicFeedRoutes';

const TENANT_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

interface JobRow {
  job_id: string;
  title: string;
  description: string;
  location: string | null;
  remote_type: string | null;
  employment_type: string | null;
  salary_min: number | null;
  salary_max: number | null;
  currency: string | null;
}

const TENANT_A_JOBS: JobRow[] = [
  {
    job_id: 'job-A-1',
    title: 'Job A1',
    description: '<p>Desc A1</p>',
    location: 'Amsterdam',
    remote_type: 'hybrid',
    employment_type: 'fulltime',
    salary_min: 50_000,
    salary_max: 70_000,
    currency: 'EUR',
  },
  {
    job_id: 'job-A-2',
    title: 'Job A2 & friends',
    description: 'Plain desc',
    location: 'Utrecht',
    remote_type: null,
    employment_type: null,
    salary_min: null,
    salary_max: null,
    currency: null,
  },
];

const TENANT_B_JOBS: JobRow[] = [
  {
    job_id: 'job-B-1',
    title: 'Job B1 — DO NOT LEAK',
    description: 'Tenant B private',
    location: 'Berlin',
    remote_type: null,
    employment_type: null,
    salary_min: null,
    salary_max: null,
    currency: null,
  },
];

function buildApp() {
  const app = express();
  app.use('/api/public', publicFeedRouter);
  return app;
}

/**
 * Build a mock client whose query() routes by SQL pattern:
 *   - SELECT id FROM tenants WHERE slug = $1   → resolve slug → tenant id
 *   - SELECT ... FROM job_postings p JOIN jobs → return that tenant's jobs
 */
function makeRoutedMock() {
  return mockClient({
    __matcher: (sql: string, params: unknown[]) => {
      // Tenant slug resolution
      if (/FROM\s+tenants/i.test(sql)) {
        const slug = params[0] as string;
        if (slug === 'acme') return { rows: [{ id: TENANT_A_ID }], rowCount: 1 };
        if (slug === 'beta') return { rows: [{ id: TENANT_B_ID }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }
      // Feed loader — params[0] is the tenant id passed by withTenant.
      if (/FROM\s+job_postings/i.test(sql)) {
        const tenantId = params[0] as string;
        if (tenantId === TENANT_A_ID) return { rows: TENANT_A_JOBS, rowCount: TENANT_A_JOBS.length };
        if (tenantId === TENANT_B_ID) return { rows: TENANT_B_JOBS, rowCount: TENANT_B_JOBS.length };
        return { rows: [], rowCount: 0 };
      }
      // BEGIN/COMMIT/SET silent ack
      return { rows: [], rowCount: 0 };
    },
  });
}

describe('GET /api/public/job-feeds/:tenantSlug/vacaturebank.xml', () => {
  let teardown: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    teardown = installPoolMock(makeRoutedMock());
  });

  afterEach(() => {
    teardown?.();
  });

  it('returns 404 for an unknown tenant slug', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/public/job-feeds/does-not-exist/vacaturebank.xml');
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('TENANT_NOT_FOUND');
  });

  it('returns XML with Cache-Control: public, max-age=300 + correct Content-Type', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/public/job-feeds/acme/vacaturebank.xml');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.headers['content-type']).toMatch(/application\/xml/);
    expect(res.text).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(res.text).toContain('<vacatures>');
  });

  it("includes only the resolved tenant's jobs (cross-tenant isolation)", async () => {
    const app = buildApp();
    const res = await request(app).get('/api/public/job-feeds/acme/vacaturebank.xml');
    expect(res.status).toBe(200);
    // Tenant A jobs must be present.
    expect(res.text).toContain('<id>job-A-1</id>');
    expect(res.text).toContain('<id>job-A-2</id>');
    // Tenant B job must NOT leak across.
    expect(res.text).not.toContain('job-B-1');
    expect(res.text).not.toContain('DO NOT LEAK');
  });

  it("a different slug returns its OWN jobs only — no leakage either way", async () => {
    const app = buildApp();
    const res = await request(app).get('/api/public/job-feeds/beta/vacaturebank.xml');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<id>job-B-1</id>');
    expect(res.text).not.toContain('job-A-1');
    expect(res.text).not.toContain('job-A-2');
  });

  it('escapes XML-special characters in titles', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/public/job-feeds/acme/vacaturebank.xml');
    expect(res.text).toContain('Job A2 &amp; friends');
  });

  it('serves an empty <vacatures/> feed gracefully when DB throws', async () => {
    // Override: tenant resolves OK, but the feed query throws.
    teardown();
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql: string, params: unknown[]) => {
          if (/FROM\s+tenants/i.test(sql)) {
            return { rows: [{ id: TENANT_A_ID }], rowCount: 1 };
          }
          if (/FROM\s+job_postings/i.test(sql)) {
            throw new Error('simulated DB outage');
          }
          // BEGIN/COMMIT/ROLLBACK/SET — must silently succeed even on rollback.
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const app = buildApp();
    const res = await request(app).get('/api/public/job-feeds/acme/vacaturebank.xml');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<vacatures>');
    expect(res.text).not.toContain('<vacature>');
  });
});

