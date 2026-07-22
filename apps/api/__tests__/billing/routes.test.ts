/**
 * Authenticated billing/invoicing routes smoke tests — systeem-audit
 * bugklasse 3 ("het laatste draadje").
 *
 * Gaat door de ECHTE HTTP-routes van modules/billing/invoicing.routes.ts,
 * inclusief requireAuth + tenantMiddleware + requirePermission('billing',
 * 'write'). Service-details worden elders getest (invoicing.service.test.ts);
 * hier mocken we alleen de minimale SQL die de happy path raakt.
 *
 * NB: in src/index.ts is de router gemount als
 *   app.use('/api/invoices', requireModule('recruit_to_cash'), invoicingRouter)
 * — de module-gate valt buiten deze test; we mounten de kale router op
 * hetzelfde pad, net als __tests__/whatsapp/routes.test.ts doet.
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

import invoicingRouter from '../../src/modules/billing/invoicing.routes';
import { errorHandler } from '../../src/middleware/errorHandler';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const INVOICE_ID = '33333333-3333-3333-3333-333333333333';

function jwtTokenForRole(role: string): string {
  return jwt.sign(
    { userId: USER_ID, tenantId: TENANT_ID, email: 'u@x.nl', role },
    process.env.JWT_SECRET!
  );
}

/** requirePermission('billing', 'write') looks up the user's role
 * (+ any custom-role assignments) before the route handler runs. */
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

/** Minimale invoice-rij zoals rowToInvoice die verwacht. */
function invoiceRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: INVOICE_ID,
    tenant_id: TENANT_ID,
    invoice_number: 'INV-2026-00001',
    client_organization_id: null,
    contract_id: null,
    status: 'sent',
    period_start: '2026-06-01',
    period_end: '2026-06-30',
    issued_date: '2026-07-01',
    due_date: '2026-07-31',
    paid_date: null,
    subtotal_amount: '1000.00',
    vat_rate: '21.00',
    vat_amount: '210.00',
    total_amount: '1210.00',
    currency: 'EUR',
    notes: null,
    pdf_storage_key: null,
    external_accounting_id: null,
    external_accounting_provider: null,
    external_synced_at: null,
    created_by: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/invoices', invoicingRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JWT gating', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET /api/invoices without JWT → 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp()).get('/api/invoices');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /api/invoices/:id/mark-paid without JWT → 401', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post(`/api/invoices/${INVOICE_ID}/mark-paid`)
      .send({ paid_date: '2026-07-15' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('admin happy path', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET /api/invoices as admin → 200 with data + next_cursor', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('admin', (sql) => {
        if (/FROM\s+invoices\b/i.test(sql)) {
          return { rows: [invoiceRow()], rowCount: 1 };
        }
        return undefined;
      }),
    });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .get('/api/invoices')
      .set('Authorization', `Bearer ${jwtTokenForRole('admin')}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].invoice_number).toBe('INV-2026-00001');
    expect(r.body.data[0].total_amount).toBe(1210);
    expect(r.body.next_cursor).toBeNull();
  });

  it('GET /api/invoices/:id as admin → 200 with invoice + lines', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('admin', (sql) => {
        if (/FROM\s+invoice_lines\b/i.test(sql)) return { rows: [], rowCount: 0 };
        if (/FROM\s+invoices\b/i.test(sql)) {
          return { rows: [invoiceRow()], rowCount: 1 };
        }
        return undefined;
      }),
    });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .get(`/api/invoices/${INVOICE_ID}`)
      .set('Authorization', `Bearer ${jwtTokenForRole('admin')}`);
    expect(r.status).toBe(200);
    expect(r.body.invoice.id).toBe(INVOICE_ID);
    expect(r.body.lines).toEqual([]);
  });

  it('POST /api/invoices/:id/mark-paid as admin → 200, status paid', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('admin', (sql) => {
        // markPaid: eerst SELECT … FOR UPDATE (status moet sent/overdue zijn),
        // daarna UPDATE … RETURNING *.
        if (/UPDATE\s+invoices\b/i.test(sql)) {
          return {
            rows: [invoiceRow({ status: 'paid', paid_date: '2026-07-15' })],
            rowCount: 1,
          };
        }
        if (/FROM\s+invoices\b/i.test(sql)) {
          return { rows: [invoiceRow({ status: 'sent' })], rowCount: 1 };
        }
        return undefined;
      }),
    });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post(`/api/invoices/${INVOICE_ID}/mark-paid`)
      .set('Authorization', `Bearer ${jwtTokenForRole('admin')}`)
      .send({ paid_date: '2026-07-15' });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('paid');
    expect(r.body.data.paid_date).toBe('2026-07-15');
  });
});

describe('permission gating — mutaties vereisen billing:write', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST /api/invoices/:id/mark-paid as viewer → 403 INSUFFICIENT_PERMISSION', async () => {
    const client = mockClient({ __matcher: withRoleMatcher('viewer') });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post(`/api/invoices/${INVOICE_ID}/mark-paid`)
      .set('Authorization', `Bearer ${jwtTokenForRole('viewer')}`)
      .send({ paid_date: '2026-07-15' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    expect(r.body.error.details.required).toEqual({
      resource: 'billing',
      action: 'write',
    });
  });

  it('POST /api/invoices (generate) as viewer → 403 INSUFFICIENT_PERMISSION', async () => {
    const client = mockClient({ __matcher: withRoleMatcher('viewer') });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .post('/api/invoices')
      .set('Authorization', `Bearer ${jwtTokenForRole('viewer')}`)
      .send({
        contract_id: '44444444-4444-4444-4444-444444444444',
        period_start: '2026-06-01',
        period_end: '2026-06-30',
      });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('INSUFFICIENT_PERMISSION');
  });

  it('GET /api/invoices as viewer → 200 (read routes blijven open)', async () => {
    const client = mockClient({
      __matcher: withRoleMatcher('viewer', (sql) => {
        if (/FROM\s+invoices\b/i.test(sql)) return { rows: [], rowCount: 0 };
        return undefined;
      }),
    });
    teardown = installPoolMock(client);
    const r = await request(buildApp())
      .get('/api/invoices')
      .set('Authorization', `Bearer ${jwtTokenForRole('viewer')}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });
});
