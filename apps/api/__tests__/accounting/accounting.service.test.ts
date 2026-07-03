/**
 * Accounting-service tests — Sprint Q4.4 (Agent UUU).
 *
 * Cover connector mock-mode, integration CRUD with encryption, sync flow,
 * cross-tenant isolation, and idempotent re-sync.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

vi.mock('../../src/queue/queues', () => ({
  jobBoardPostQueue: { add: vi.fn(async () => ({ id: 'mock' })) },
  jobBoardPollQueue: { add: vi.fn(async () => ({ id: 'mock' })) },
}));

import * as service from '../../src/modules/accounting/accounting.service';
import { exactOnlineConnector } from '../../src/modules/accounting/connectors/exactOnline';
import { twinfieldConnector } from '../../src/modules/accounting/connectors/twinfield';
import { snelstartConnector } from '../../src/modules/accounting/connectors/snelstart';
import { encrypt, decrypt } from '../../src/lib/encryption';
import { isAccountingMockMode } from '../../src/modules/accounting/types';

const TENANT = '11111111-1111-1111-1111-111111111111';
const TENANT2 = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';

describe('accounting.connectors — mock mode', () => {
  it('exact_online produces synthetic external_id in mock mode', async () => {
    const result = await exactOnlineConnector.syncInvoice(
      { tenantId: TENANT, userId: null },
      {
        id: 'inv-1',
        tenant_id: TENANT,
        invoice_number: 'INV-2026-00001',
        client_organization_id: 'org-1',
        contract_id: 'c-1',
        period_start: '2026-04-01',
        period_end: '2026-04-30',
        issued_date: '2026-04-01',
        due_date: '2026-05-01',
        subtotal_amount: 100,
        vat_rate: 21,
        vat_amount: 21,
        total_amount: 121,
        currency: 'EUR',
        notes: null,
      },
      [],
      {
        id: 'i-1',
        tenant_id: TENANT,
        provider: 'exact_online',
        settings: {},
        credentials: {},
      }
    );
    expect(result.external_id).toMatch(/^exact-mock-/);
  });

  it('twinfield produces synthetic external_id in mock mode', async () => {
    const result = await twinfieldConnector.syncInvoice(
      { tenantId: TENANT, userId: null },
      {
        id: 'inv-2',
        tenant_id: TENANT,
        invoice_number: 'INV-2026-00002',
        client_organization_id: 'org-2',
        contract_id: null,
        period_start: null,
        period_end: null,
        issued_date: '2026-04-01',
        due_date: null,
        subtotal_amount: 50,
        vat_rate: 9,
        vat_amount: 4.5,
        total_amount: 54.5,
        currency: 'EUR',
        notes: null,
      },
      [],
      {
        id: 'i-2',
        tenant_id: TENANT,
        provider: 'twinfield',
        settings: {},
        credentials: {},
      }
    );
    expect(result.external_id).toMatch(/^twinfield-mock-/);
  });

  it('snelstart produces synthetic external_id in mock mode', async () => {
    const result = await snelstartConnector.syncInvoice(
      { tenantId: TENANT, userId: null },
      {
        id: 'inv-3',
        tenant_id: TENANT,
        invoice_number: 'INV-2026-00003',
        client_organization_id: null,
        contract_id: null,
        period_start: null,
        period_end: null,
        issued_date: '2026-04-01',
        due_date: null,
        subtotal_amount: 200,
        vat_rate: 21,
        vat_amount: 42,
        total_amount: 242,
        currency: 'EUR',
        notes: null,
      },
      [],
      {
        id: 'i-3',
        tenant_id: TENANT,
        provider: 'snelstart',
        settings: {},
        credentials: {},
      }
    );
    expect(result.external_id).toMatch(/^snelstart-mock-/);
  });

  it('isAccountingMockMode honours env override', () => {
    delete process.env.ACCOUNTING_MOCK;
    const real = {
      id: 'i',
      tenant_id: TENANT,
      provider: 'exact_online' as const,
      settings: {},
      credentials: { access_token: 'real-token-1234567890' },
    };
    expect(isAccountingMockMode(real)).toBe(false);
    process.env.ACCOUNTING_MOCK = 'true';
    expect(isAccountingMockMode(real)).toBe(true);
    delete process.env.ACCOUNTING_MOCK;
  });

  it('mock pullPayment returns deterministic structure', async () => {
    const info = await exactOnlineConnector.pullPayment(
      { tenantId: TENANT, userId: null },
      'exact-mock-abc',
      { id: 'i', tenant_id: TENANT, provider: 'exact_online', settings: {}, credentials: {} }
    );
    expect(info).not.toBeNull();
    expect(typeof info!.paid).toBe('boolean');
  });
});

describe('accounting.connectIntegration', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('encrypts credentials and writes audit row', async () => {
    let inserted: Record<string, unknown> | null = null;
    let auditAction: string | null = null;
    const client = mockClient({
      __matcher: (sql, params) => {
        if (/INSERT INTO accounting_integrations/i.test(sql)) {
          inserted = {
            id: 'i-1',
            tenant_id: params[0],
            provider: params[1],
            status: 'connected',
            settings: JSON.parse(params[3] as string),
            display_name: params[4],
            default_revenue_account: params[5],
            default_vat_code: params[6],
            connected_by: params[7],
            connected_at: new Date().toISOString(),
            last_synced_at: null,
            last_error: null,
            created_at: new Date().toISOString(),
            __creds_encrypted: params[2],
          };
          return { rows: [inserted], rowCount: 1 };
        }
        if (/INSERT INTO audit_events/i.test(sql)) {
          auditAction = params[2] as string;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await service.connectIntegration(
      TENANT,
      'exact_online',
      { access_token: 'live-1234567890' },
      { displayName: 'Exact', userId: USER }
    );
    expect(result.provider).toBe('exact_online');
    expect(auditAction).toBe('accounting.integration.connected');
    const blob = inserted!.__creds_encrypted as Buffer;
    expect(JSON.parse(decrypt(blob)).access_token).toBe('live-1234567890');
  });

  it('rejects unknown provider', async () => {
    teardown = installPoolMock(mockClient());
    await expect(
      service.connectIntegration(TENANT, 'unknown-provider', {})
    ).rejects.toMatchObject({ code: 'UNKNOWN_ACCOUNTING_PROVIDER' });
  });
});

describe('accounting.disconnectIntegration', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('marks integration disconnected + nullifies credentials', async () => {
    const ops: string[] = [];
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT id FROM accounting_integrations/i.test(sql)) {
            return { rows: [{ id: 'i-1' }], rowCount: 1 };
          }
          if (/UPDATE accounting_integrations[^]*status = 'disconnected'/i.test(sql)) {
            ops.push('disconnected');
            return { rows: [], rowCount: 1 };
          }
          if (/INSERT INTO audit_events/i.test(sql)) {
            ops.push('audit');
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    await service.disconnectIntegration(TENANT, 'exact_online');
    expect(ops).toContain('disconnected');
    expect(ops).toContain('audit');
  });

  it('throws 404 when integration not found', async () => {
    teardown = installPoolMock(
      mockClient({ __matcher: () => ({ rows: [], rowCount: 0 }) })
    );
    await expect(
      service.disconnectIntegration(TENANT, 'exact_online')
    ).rejects.toMatchObject({ code: 'ACCOUNTING_INTEGRATION_NOT_FOUND' });
  });
});

describe('accounting.syncInvoiceToAccounting — idempotent', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns already_synced=true when invoice already has external_id', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM invoices/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'inv-1',
                  tenant_id: TENANT,
                  invoice_number: 'INV',
                  external_accounting_id: 'exact-mock-123',
                  external_accounting_provider: 'exact_online',
                  client_organization_id: null,
                  contract_id: null,
                  status: 'sent',
                  period_start: null,
                  period_end: null,
                  issued_date: '2026-04-01',
                  due_date: null,
                  subtotal_amount: '100',
                  vat_rate: '21',
                  vat_amount: '21',
                  total_amount: '121',
                  currency: 'EUR',
                  notes: null,
                },
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );

    const result = await service.syncInvoiceToAccounting(TENANT, 'inv-1');
    expect(result.already_synced).toBe(true);
    expect(result.external_id).toBe('exact-mock-123');
  });

  it('throws NO_ACCOUNTING_INTEGRATION when none configured', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT \* FROM invoices/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'inv-1',
                  tenant_id: TENANT,
                  invoice_number: 'INV',
                  external_accounting_id: null,
                  external_accounting_provider: null,
                  client_organization_id: null,
                  contract_id: null,
                  status: 'sent',
                  period_start: null,
                  period_end: null,
                  issued_date: null,
                  due_date: null,
                  subtotal_amount: '0',
                  vat_rate: '21',
                  vat_amount: '0',
                  total_amount: '0',
                  currency: 'EUR',
                  notes: null,
                },
              ],
              rowCount: 1,
            };
          }
          if (/SELECT id, tenant_id, provider, settings, credentials_encrypted[^]*FROM accounting_integrations[^]*WHERE status = 'connected'[^]*ORDER BY connected_at/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );

    await expect(
      service.syncInvoiceToAccounting(TENANT, 'inv-1')
    ).rejects.toMatchObject({ code: 'NO_ACCOUNTING_INTEGRATION' });
  });

  it('writes external_accounting_id back on success (mock mode)', async () => {
    let updateCaptured: { ext: string; provider: string } | null = null;
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql, params) => {
          if (/SELECT \* FROM invoices WHERE id = \$1/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'inv-9',
                  tenant_id: TENANT,
                  invoice_number: 'INV',
                  external_accounting_id: null,
                  external_accounting_provider: null,
                  client_organization_id: 'o',
                  contract_id: null,
                  status: 'sent',
                  period_start: null,
                  period_end: null,
                  issued_date: '2026-04-01',
                  due_date: null,
                  subtotal_amount: '100',
                  vat_rate: '21',
                  vat_amount: '21',
                  total_amount: '121',
                  currency: 'EUR',
                  notes: null,
                },
              ],
              rowCount: 1,
            };
          }
          if (/SELECT id, tenant_id, provider, settings, credentials_encrypted[^]*FROM accounting_integrations[^]*WHERE tenant_id = \$1 AND status = 'connected'/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'i-1',
                  tenant_id: TENANT,
                  provider: 'exact_online',
                  settings: {},
                  credentials_encrypted: encrypt(JSON.stringify({})),
                },
              ],
              rowCount: 1,
            };
          }
          if (/SELECT id, description, quantity, unit, unit_price/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          if (/UPDATE invoices[^]*external_accounting_id/i.test(sql)) {
            updateCaptured = {
              ext: params[0] as string,
              provider: params[1] as string,
            };
            return { rows: [], rowCount: 1 };
          }
          if (/UPDATE accounting_integrations/i.test(sql)) {
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );

    process.env.ACCOUNTING_MOCK = 'true';
    const result = await service.syncInvoiceToAccounting(TENANT, 'inv-9');
    expect(result.already_synced).toBe(false);
    expect(result.provider).toBe('exact_online');
    expect(updateCaptured?.provider).toBe('exact_online');
    expect(updateCaptured?.ext).toMatch(/^exact-mock-/);
    delete process.env.ACCOUNTING_MOCK;
  });
});

describe('accounting.listCatalog — cross-tenant', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns connection state isolated per tenant via SET LOCAL', async () => {
    let observedTenant: string | null = null;
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          const m = sql.match(/SET LOCAL app\.tenant_id = '([0-9a-f-]{36})'/i);
          if (m) observedTenant = m[1];
          if (/SELECT id, provider, status FROM accounting_integrations/i.test(sql)) {
            if (observedTenant === TENANT) {
              return {
                rows: [{ id: 'i-1', provider: 'exact_online', status: 'connected' }],
                rowCount: 1,
              };
            }
            return { rows: [], rowCount: 0 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );

    const t1 = await service.listCatalog(TENANT);
    const t2 = await service.listCatalog(TENANT2);
    expect(t1.find((c) => c.id === 'exact_online')!.connected).toBe(true);
    expect(t2.find((c) => c.id === 'exact_online')!.connected).toBe(false);
  });
});
