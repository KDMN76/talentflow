/**
 * Invoicing-service tests — Sprint Q4.4 (Agent UUU).
 *
 * Cover invoice generation math, sequential numbering, state machine,
 * cross-tenant isolation, en de timesheets-bridge.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

// Hoisted mocks BEFORE imports.
vi.mock('../../src/queue/queues', () => ({
  jobBoardPostQueue: { add: vi.fn(async () => ({ id: 'mock-job' })) },
  jobBoardPollQueue: { add: vi.fn(async () => ({ id: 'mock-job' })) },
}));

import * as service from '../../src/modules/billing/invoicing.service';
import {
  _setTimesheetsBridgeForTests,
} from '../../src/modules/billing/timesheetsBridge';
import * as commissions from '../../src/modules/commissions/commissions.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const TENANT2 = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

describe('billing.generateInvoiceFromContract', () => {
  let teardown: () => void;
  afterEach(() => {
    teardown?.();
    _setTimesheetsBridgeForTests(null);
  });

  beforeEach(() => {
    _setTimesheetsBridgeForTests({
      summarizeApprovedHoursForBilling: vi.fn(async () => ({
        total_hours: 80,
        total_overtime_hours: 4,
        total_amount_candidate: 4000,
        total_amount_client: 6000,
        currency: 'EUR',
        by_week: [
          {
            week_start: '2026-04-06',
            hours: 40,
            overtime_hours: 2,
            amount_candidate: 2000,
            amount_client: 3000,
          },
          {
            week_start: '2026-04-13',
            hours: 40,
            overtime_hours: 2,
            amount_candidate: 2000,
            amount_client: 3000,
          },
        ],
      })),
    });
  });

  it('creates a draft invoice with correct VAT math + sequential number', async () => {
    let inserted: Record<string, unknown> | null = null;
    const insertedLines: Array<Record<string, unknown>> = [];
    const client = mockClient({
      __matcher: (sql, params) => {
        if (/INSERT INTO tenant_invoice_sequences/i.test(sql)) {
          return { rows: [{ current_value: '7' }], rowCount: 1 };
        }
        if (/SELECT id, client_organization_id, currency, hourly_rate_client/i.test(sql)) {
          return {
            rows: [
              {
                id: 'contract-1',
                client_organization_id: 'org-99',
                currency: 'EUR',
                hourly_rate_client: '75.00',
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT INTO invoices/i.test(sql)) {
          inserted = {
            id: 'inv-1',
            tenant_id: params[0],
            invoice_number: params[1],
            client_organization_id: params[2],
            contract_id: params[3],
            status: 'draft',
            subtotal_amount: params[6],
            vat_rate: params[7],
            vat_amount: params[8],
            total_amount: params[9],
          };
          return { rows: [{ id: 'inv-1' }], rowCount: 1 };
        }
        if (/INSERT INTO invoice_lines/i.test(sql)) {
          insertedLines.push({
            description: params[2],
            quantity: params[3],
            unit: params[4],
            unit_price: params[5],
            line_total: params[6],
          });
          return {
            rows: [
              {
                id: `line-${insertedLines.length}`,
                tenant_id: TENANT,
                invoice_id: 'inv-1',
                description: params[2],
                quantity: params[3],
                unit: params[4],
                unit_price: params[5],
                line_total: params[6],
                vat_rate: params[7],
                metadata: {},
                created_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT \* FROM invoices/i.test(sql)) {
          return {
            rows: [
              {
                ...(inserted ?? {}),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
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

    const result = await service.generateInvoiceFromContract(
      TENANT,
      'contract-1',
      '2026-04-01',
      '2026-04-30',
      { userId: USER_ID }
    );
    // Invoice number format INV-YYYY-NNNNN
    expect(result.invoice.invoice_number).toMatch(/^INV-2026-00007$/);
    // 6000 subtotal × 21% VAT = 1260; total = 7260
    expect(result.invoice.subtotal_amount).toBe(6000);
    expect(result.invoice.vat_rate).toBe(21);
    expect(result.invoice.vat_amount).toBe(1260);
    expect(result.invoice.total_amount).toBe(7260);
    // 2 weekly lines
    expect(insertedLines.length).toBe(2);
    expect(insertedLines[0].description).toContain('Week 2026-04-06');
  });

  it('aggregates by month when aggregate=month', async () => {
    const insertedLines: Array<Record<string, unknown>> = [];
    const client = mockClient({
      __matcher: (sql, params) => {
        if (/INSERT INTO tenant_invoice_sequences/i.test(sql)) {
          return { rows: [{ current_value: '1' }], rowCount: 1 };
        }
        if (/SELECT id, client_organization_id, currency, hourly_rate_client/i.test(sql)) {
          return {
            rows: [{ id: 'c1', client_organization_id: 'o1', currency: 'EUR', hourly_rate_client: '50' }],
            rowCount: 1,
          };
        }
        if (/INSERT INTO invoices/i.test(sql)) {
          return { rows: [{ id: 'inv-2' }], rowCount: 1 };
        }
        if (/INSERT INTO invoice_lines/i.test(sql)) {
          insertedLines.push({ description: params[2] });
          return { rows: [{ id: 'l', tenant_id: TENANT, invoice_id: 'inv-2', description: params[2], quantity: 0, unit: 'hours', unit_price: 0, line_total: 0, vat_rate: 21, metadata: {}, created_at: new Date().toISOString() }], rowCount: 1 };
        }
        if (/SELECT \* FROM invoices/i.test(sql)) {
          return {
            rows: [
              {
                id: 'inv-2',
                tenant_id: TENANT,
                invoice_number: 'INV-2026-00001',
                status: 'draft',
                subtotal_amount: 0,
                vat_rate: 21,
                vat_amount: 0,
                total_amount: 0,
                currency: 'EUR',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await service.generateInvoiceFromContract(
      TENANT,
      'contract-1',
      '2026-04-01',
      '2026-04-30',
      { aggregate: 'month' }
    );
    // Both weeks fall in April → exactly one line
    expect(insertedLines.length).toBe(1);
    expect(insertedLines[0].description).toContain('2026-04');
  });

  it('produces a single flat line when aggregate=flat', async () => {
    const insertedLines: Array<Record<string, unknown>> = [];
    const client = mockClient({
      __matcher: (sql, params) => {
        if (/INSERT INTO tenant_invoice_sequences/i.test(sql)) {
          return { rows: [{ current_value: '2' }], rowCount: 1 };
        }
        if (/SELECT id, client_organization_id, currency, hourly_rate_client/i.test(sql)) {
          return {
            rows: [{ id: 'c1', client_organization_id: 'o1', currency: 'EUR', hourly_rate_client: '50' }],
            rowCount: 1,
          };
        }
        if (/INSERT INTO invoices/i.test(sql)) {
          return { rows: [{ id: 'inv-3' }], rowCount: 1 };
        }
        if (/INSERT INTO invoice_lines/i.test(sql)) {
          insertedLines.push({ description: params[2], quantity: params[3] });
          return { rows: [{ id: 'l', tenant_id: TENANT, invoice_id: 'inv-3', description: params[2], quantity: params[3], unit: 'hours', unit_price: 0, line_total: 0, vat_rate: 21, metadata: {}, created_at: new Date().toISOString() }], rowCount: 1 };
        }
        if (/SELECT \* FROM invoices/i.test(sql)) {
          return { rows: [{ id: 'inv-3', tenant_id: TENANT, invoice_number: 'INV-2026-00002', status: 'draft', subtotal_amount: 0, vat_rate: 21, vat_amount: 0, total_amount: 0, currency: 'EUR', created_at: '', updated_at: '' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await service.generateInvoiceFromContract(
      TENANT,
      'contract-1',
      '2026-04-01',
      '2026-04-30',
      { aggregate: 'flat' }
    );
    expect(insertedLines.length).toBe(1);
    expect(insertedLines[0].description).toContain('Detachering periode');
  });

  it('rejects when there are no billable hours', async () => {
    _setTimesheetsBridgeForTests({
      summarizeApprovedHoursForBilling: vi.fn(async () => ({
        total_hours: 0,
        total_overtime_hours: 0,
        total_amount_candidate: 0,
        total_amount_client: 0,
        currency: 'EUR',
        by_week: [],
      })),
    });
    teardown = installPoolMock(mockClient());
    await expect(
      service.generateInvoiceFromContract(
        TENANT,
        'contract-x',
        '2026-04-01',
        '2026-04-30'
      )
    ).rejects.toMatchObject({ code: 'NO_BILLABLE_HOURS' });
  });

  it('respects per-tenant SET LOCAL app.tenant_id (cross-tenant isolation)', async () => {
    const observed: string[] = [];
    const client = mockClient({
      __matcher: (sql) => {
        const m = sql.match(/SET LOCAL app\.tenant_id = '([0-9a-f-]{36})'/i);
        if (m) observed.push(m[1]);
        if (/INSERT INTO tenant_invoice_sequences/i.test(sql)) {
          return { rows: [{ current_value: '1' }], rowCount: 1 };
        }
        if (/SELECT id, client_organization_id, currency, hourly_rate_client/i.test(sql)) {
          return {
            rows: [{ id: 'c', client_organization_id: 'o', currency: 'EUR', hourly_rate_client: '50' }],
            rowCount: 1,
          };
        }
        if (/INSERT INTO invoices/i.test(sql)) return { rows: [{ id: 'i' }], rowCount: 1 };
        if (/INSERT INTO invoice_lines/i.test(sql))
          return { rows: [{ id: 'l', tenant_id: 't', invoice_id: 'i', description: '', quantity: 0, unit: 'hours', unit_price: 0, line_total: 0, vat_rate: 21, metadata: {}, created_at: '' }], rowCount: 1 };
        if (/SELECT \* FROM invoices/i.test(sql))
          return { rows: [{ id: 'i', tenant_id: 't', invoice_number: 'X', status: 'draft', subtotal_amount: 0, vat_rate: 21, vat_amount: 0, total_amount: 0, currency: 'EUR', created_at: '', updated_at: '' }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await service.generateInvoiceFromContract(
      TENANT,
      'c1',
      '2026-04-01',
      '2026-04-07'
    );
    await service.generateInvoiceFromContract(
      TENANT2,
      'c1',
      '2026-04-01',
      '2026-04-07'
    );
    expect(observed).toContain(TENANT);
    expect(observed).toContain(TENANT2);
  });
});

describe('billing.issueInvoice — state machine', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('transitions draft → sent + sets due_date issuedDate+30', async () => {
    let updateCaptured: { issued_date: string; due_date: string } | null = null;
    const recordSpy = vi
      .spyOn(commissions, 'recordCommissionsForInvoice')
      .mockResolvedValue([]);
    const client = mockClient({
      __matcher: (sql, params) => {
        if (/SELECT \* FROM invoices WHERE id = \$1 AND tenant_id = \$2 FOR UPDATE/i.test(sql)) {
          return {
            rows: [
              {
                id: 'inv-1',
                tenant_id: TENANT,
                invoice_number: 'INV-2026-00001',
                status: 'draft',
                subtotal_amount: 100,
                vat_rate: 21,
                vat_amount: 21,
                total_amount: 121,
                currency: 'EUR',
                created_at: '',
                updated_at: '',
              },
            ],
            rowCount: 1,
          };
        }
        if (/UPDATE invoices[^]*status = 'sent'/i.test(sql)) {
          updateCaptured = { issued_date: params[0] as string, due_date: params[1] as string };
          return {
            rows: [
              {
                id: 'inv-1',
                tenant_id: TENANT,
                invoice_number: 'INV-2026-00001',
                status: 'sent',
                issued_date: params[0],
                due_date: params[1],
                subtotal_amount: 100,
                vat_rate: 21,
                vat_amount: 21,
                total_amount: 121,
                currency: 'EUR',
                created_at: '',
                updated_at: '',
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT \* FROM invoice_lines/i.test(sql)) return { rows: [], rowCount: 0 };
        if (/UPDATE invoices SET pdf_storage_key/i.test(sql)) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await service.issueInvoice(TENANT, 'inv-1', { userId: USER_ID });
    expect(result.status).toBe('sent');
    expect(updateCaptured).not.toBeNull();
    const issued = new Date(updateCaptured!.issued_date);
    const due = new Date(updateCaptured!.due_date);
    const days = (due.getTime() - issued.getTime()) / (24 * 3600 * 1000);
    expect(Math.round(days)).toBe(30);
    expect(recordSpy).toHaveBeenCalledWith(TENANT, 'inv-1');
    recordSpy.mockRestore();
  });

  it('refuses to issue an already-sent invoice', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM invoices WHERE id = \$1 AND tenant_id = \$2 FOR UPDATE/i.test(sql)) {
          return {
            rows: [
              {
                id: 'inv-1',
                tenant_id: TENANT,
                invoice_number: 'X',
                status: 'sent',
                subtotal_amount: 0,
                vat_rate: 21,
                vat_amount: 0,
                total_amount: 0,
                currency: 'EUR',
                created_at: '',
                updated_at: '',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(service.issueInvoice(TENANT, 'inv-1')).rejects.toMatchObject({
      code: 'INVALID_INVOICE_TRANSITION',
    });
  });

  it('void blocks transitions from paid', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM invoices WHERE id = \$1 AND tenant_id = \$2 FOR UPDATE/i.test(sql)) {
          return {
            rows: [
              {
                id: 'inv-1',
                tenant_id: TENANT,
                invoice_number: 'X',
                status: 'paid',
                subtotal_amount: 0,
                vat_rate: 21,
                vat_amount: 0,
                total_amount: 0,
                currency: 'EUR',
                created_at: '',
                updated_at: '',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      service.voidInvoice(TENANT, 'inv-1', 'mistake')
    ).rejects.toMatchObject({ code: 'CANNOT_VOID_PAID_INVOICE' });
  });

  it('markPaid transitions sent → paid', async () => {
    const client = mockClient({
      __matcher: (sql, params) => {
        if (/SELECT \* FROM invoices WHERE id = \$1 AND tenant_id = \$2 FOR UPDATE/i.test(sql)) {
          return {
            rows: [
              {
                id: 'inv-1',
                tenant_id: TENANT,
                invoice_number: 'X',
                status: 'sent',
                subtotal_amount: 0,
                vat_rate: 21,
                vat_amount: 0,
                total_amount: 0,
                currency: 'EUR',
                created_at: '',
                updated_at: '',
              },
            ],
            rowCount: 1,
          };
        }
        if (/UPDATE invoices[^]*status = 'paid'/i.test(sql)) {
          return {
            rows: [
              {
                id: 'inv-1',
                tenant_id: TENANT,
                invoice_number: 'X',
                status: 'paid',
                paid_date: params[0],
                subtotal_amount: 0,
                vat_rate: 21,
                vat_amount: 0,
                total_amount: 0,
                currency: 'EUR',
                created_at: '',
                updated_at: '',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const result = await service.markPaid(TENANT, 'inv-1', '2026-05-01');
    expect(result.status).toBe('paid');
    expect(result.paid_date).toBe('2026-05-01');
  });
});

describe('billing.invoicePdf — produces a real PDF', () => {
  it('renderInvoicePdf returns a Buffer that starts with %PDF', async () => {
    const { renderInvoicePdf } = await import(
      '../../src/modules/billing/invoicePdf'
    );
    const pdf = await renderInvoicePdf(
      {
        invoice_number: 'INV-2026-00001',
        status: 'sent',
        issued_date: '2026-04-01',
        due_date: '2026-05-01',
        period_start: '2026-04-01',
        period_end: '2026-04-30',
        client_organization_id: 'org-1',
        contract_id: 'c-1',
        subtotal_amount: 100,
        vat_rate: 21,
        vat_amount: 21,
        total_amount: 121,
        currency: 'EUR',
        notes: 'Test invoice',
      },
      [
        {
          description: 'Detachering Week 1',
          quantity: 40,
          unit: 'hours',
          unit_price: 50,
          line_total: 2000,
        },
      ]
    );
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(100);
    expect(pdf.subarray(0, 4).toString('utf8')).toBe('%PDF');
  });

  it('strips non-ANSI characters in description without crashing', async () => {
    const { renderInvoicePdf } = await import(
      '../../src/modules/billing/invoicePdf'
    );
    const pdf = await renderInvoicePdf(
      {
        invoice_number: 'INV-2026-00002',
        status: 'sent',
        issued_date: '2026-04-01',
        due_date: '2026-05-01',
        period_start: null,
        period_end: null,
        client_organization_id: null,
        contract_id: null,
        subtotal_amount: 0,
        vat_rate: 21,
        vat_amount: 0,
        total_amount: 0,
        currency: 'EUR',
        notes: 'Emoji 🎉 stripped',
      },
      []
    );
    expect(pdf.subarray(0, 4).toString('utf8')).toBe('%PDF');
  });
});
