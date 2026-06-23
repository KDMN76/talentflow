/**
 * Accounting orchestration service — Sprint Q4.4 (Agent UUU).
 *
 * Doet voor accounting-providers wat job-boards/service.ts doet voor boards:
 *   - per-tenant integratie-CRUD met encrypted credentials
 *   - sync van invoices naar de externe provider
 *   - payment-pull voor reeds gesync'de invoices
 *
 * Multi-tenancy: ALLE queries via `withTenant(tenantId, ...)` zodat RLS
 * automatisch isolatie afdwingt. Audit-events worden ge-logged via lib/audit.
 */

import type { PoolClient } from 'pg';
import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { encrypt, decrypt } from '../../lib/encryption';
import {
  getAccountingConnector,
  listAccountingConnectors,
} from './registry';
import type {
  AccountingConnector,
  AccountingIntegrationCreds,
  AccountingIntegrationStatus,
  AccountingProviderId,
  NormalizedInvoice,
  NormalizedInvoiceLine,
} from './types';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export interface AccountingIntegrationRow {
  id: string;
  tenant_id: string;
  provider: AccountingProviderId;
  status: AccountingIntegrationStatus;
  display_name: string | null;
  settings: Record<string, unknown>;
  default_revenue_account: string | null;
  default_vat_code: string | null;
  connected_by: string | null;
  connected_at: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface AccountingCatalogEntry {
  id: AccountingProviderId;
  display_name: string;
  connected: boolean;
  integration_id: string | null;
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function rowToIntegration(row: Record<string, unknown>): AccountingIntegrationRow {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    provider: row.provider as AccountingProviderId,
    status: (row.status as AccountingIntegrationStatus) ?? 'connected',
    display_name: (row.display_name as string | null) ?? null,
    settings: (row.settings as Record<string, unknown>) ?? {},
    default_revenue_account:
      (row.default_revenue_account as string | null) ?? null,
    default_vat_code: (row.default_vat_code as string | null) ?? null,
    connected_by: (row.connected_by as string | null) ?? null,
    connected_at: (row.connected_at as string | null) ?? null,
    last_synced_at: (row.last_synced_at as string | null) ?? null,
    last_error: (row.last_error as string | null) ?? null,
    created_at: String(row.created_at),
  };
}

function rowToCreds(row: {
  id: string;
  tenant_id: string;
  provider: AccountingProviderId;
  settings: Record<string, unknown>;
  credentials_encrypted: Buffer | null;
}): AccountingIntegrationCreds {
  let credentials: Record<string, unknown> = {};
  if (row.credentials_encrypted) {
    try {
      credentials = JSON.parse(decrypt(row.credentials_encrypted));
    } catch (err) {
      logger.warn('[accounting] decrypt failed — falling back to empty creds', {
        integration_id: row.id,
        error: (err as Error).message,
      });
    }
  }
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    provider: row.provider,
    settings: row.settings ?? {},
    credentials,
  };
}

async function loadIntegrationCreds(
  client: PoolClient,
  tenantId: string,
  provider: AccountingProviderId
): Promise<AccountingIntegrationCreds | null> {
  const { rows } = await client.query<{
    id: string;
    tenant_id: string;
    provider: AccountingProviderId;
    settings: Record<string, unknown>;
    credentials_encrypted: Buffer | null;
  }>(
    `SELECT id, tenant_id, provider, settings, credentials_encrypted
       FROM accounting_integrations
      WHERE provider = $1 AND tenant_id = $2 AND status = 'connected'`,
    [provider, tenantId]
  );
  if (!rows[0]) return null;
  if (rows[0].tenant_id !== tenantId) return null;
  return rowToCreds(rows[0]);
}

// ───────────────────────────────────────────────────────────────────────────
// Catalog & integrations
// ───────────────────────────────────────────────────────────────────────────

export async function listCatalog(
  tenantId: string
): Promise<AccountingCatalogEntry[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      id: string;
      provider: AccountingProviderId;
      status: AccountingIntegrationStatus;
    }>(`SELECT id, provider, status FROM accounting_integrations WHERE tenant_id = $1`, [
      tenantId,
    ]);
    const byProvider = new Map(rows.map((r) => [r.provider, r]));
    return listAccountingConnectors().map<AccountingCatalogEntry>((conn) => {
      const row = byProvider.get(conn.id);
      return {
        id: conn.id,
        display_name: conn.displayName,
        connected: row?.status === 'connected',
        integration_id: row?.id ?? null,
      };
    });
  });
}

export async function listIntegrations(
  tenantId: string
): Promise<AccountingIntegrationRow[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, tenant_id, provider, status, display_name, settings,
              default_revenue_account, default_vat_code,
              connected_by, connected_at, last_synced_at, last_error, created_at
         FROM accounting_integrations
        WHERE tenant_id = $1
        ORDER BY created_at DESC`,
      [tenantId]
    );
    return rows.map(rowToIntegration);
  });
}

export async function connectIntegration(
  tenantId: string,
  provider: string,
  credentials: Record<string, unknown>,
  options: {
    displayName?: string;
    settings?: Record<string, unknown>;
    defaultRevenueAccount?: string | null;
    defaultVatCode?: string | null;
    userId?: string | null;
    auditCtx?: AuditContext;
  } = {}
): Promise<AccountingIntegrationRow> {
  const conn = getAccountingConnector(provider);
  if (!conn) {
    throw new AppError(
      400,
      'UNKNOWN_ACCOUNTING_PROVIDER',
      `Onbekende accounting-provider '${provider}'`
    );
  }
  const encrypted = encrypt(JSON.stringify(credentials));

  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO accounting_integrations
         (tenant_id, provider, status, credentials_encrypted, settings,
          display_name, default_revenue_account, default_vat_code,
          connected_by, connected_at)
       VALUES ($1, $2, 'connected', $3, $4::jsonb, $5, $6, $7, $8, now())
       ON CONFLICT (tenant_id, provider) DO UPDATE
         SET status                  = 'connected',
             credentials_encrypted   = EXCLUDED.credentials_encrypted,
             settings                = EXCLUDED.settings,
             display_name            = EXCLUDED.display_name,
             default_revenue_account = EXCLUDED.default_revenue_account,
             default_vat_code        = EXCLUDED.default_vat_code,
             connected_by            = EXCLUDED.connected_by,
             connected_at            = now(),
             last_error              = NULL
       RETURNING id, tenant_id, provider, status, display_name, settings,
                 default_revenue_account, default_vat_code,
                 connected_by, connected_at, last_synced_at, last_error, created_at`,
      [
        tenantId,
        conn.id,
        encrypted,
        JSON.stringify(options.settings ?? {}),
        options.displayName ?? conn.displayName,
        options.defaultRevenueAccount ?? null,
        options.defaultVatCode ?? null,
        options.userId ?? null,
      ]
    );
    const row = rowToIntegration(rows[0]);
    await logAudit(
      client,
      tenantId,
      {
        action: 'accounting.integration.connected',
        entityType: 'accounting_integration',
        entityId: row.id,
        userId: options.userId ?? null,
        after: { provider: conn.id, display_name: row.display_name },
      },
      options.auditCtx ?? {}
    );
    return row;
  });
}

export async function disconnectIntegration(
  tenantId: string,
  provider: string,
  options: { userId?: string | null; auditCtx?: AuditContext } = {}
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const { rows: existing } = await client.query<{ id: string }>(
      `SELECT id FROM accounting_integrations WHERE provider = $1 AND tenant_id = $2`,
      [provider, tenantId]
    );
    if (!existing[0]) {
      throw new AppError(
        404,
        'ACCOUNTING_INTEGRATION_NOT_FOUND',
        'Integratie niet gevonden'
      );
    }
    const integrationId = existing[0].id;

    await client.query(
      `UPDATE accounting_integrations
          SET status = 'disconnected', credentials_encrypted = NULL
        WHERE id = $1 AND tenant_id = $2`,
      [integrationId, tenantId]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: 'accounting.integration.disconnected',
        entityType: 'accounting_integration',
        entityId: integrationId,
        userId: options.userId ?? null,
        before: { provider },
      },
      options.auditCtx ?? {}
    );
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Invoice sync
// ───────────────────────────────────────────────────────────────────────────

/**
 * Bekijk welk integratie-record deze tenant heeft als "primary" voor sync.
 * Strategie: pak de eerste connected. (Later kan dit een expliciete
 * `is_primary` flag worden, maar tenants gebruiken maximaal 1 accounting
 * provider tegelijk in de praktijk.)
 */
async function pickPrimaryIntegration(
  client: PoolClient,
  tenantId: string
): Promise<AccountingIntegrationCreds | null> {
  const { rows } = await client.query<{
    id: string;
    tenant_id: string;
    provider: AccountingProviderId;
    settings: Record<string, unknown>;
    credentials_encrypted: Buffer | null;
  }>(
    `SELECT id, tenant_id, provider, settings, credentials_encrypted
       FROM accounting_integrations
      WHERE tenant_id = $1 AND status = 'connected'
      ORDER BY connected_at DESC NULLS LAST
      LIMIT 1`,
    [tenantId]
  );
  if (!rows[0]) return null;
  if (rows[0].tenant_id !== tenantId) return null;
  return rowToCreds(rows[0]);
}

export interface SyncInvoiceResult {
  external_id: string;
  provider: AccountingProviderId;
  already_synced: boolean;
}

/**
 * Push een invoice (header + lines) naar de tenant's primary accounting
 * integratie. Idempotent: als de invoice al een `external_accounting_id`
 * heeft, doen we niets en retourneren `already_synced=true`.
 */
export async function syncInvoiceToAccounting(
  tenantId: string,
  invoiceId: string,
  options: { userId?: string | null; auditCtx?: AuditContext } = {}
): Promise<SyncInvoiceResult> {
  return withTenant(tenantId, async (client) => {
    // Load invoice
    const { rows: invRows } = await client.query<{
      id: string;
      tenant_id: string;
      invoice_number: string;
      client_organization_id: string | null;
      contract_id: string | null;
      status: string;
      period_start: string | null;
      period_end: string | null;
      issued_date: string | null;
      due_date: string | null;
      subtotal_amount: string;
      vat_rate: string;
      vat_amount: string;
      total_amount: string;
      currency: string;
      notes: string | null;
      external_accounting_id: string | null;
      external_accounting_provider: AccountingProviderId | null;
    }>(`SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2`, [invoiceId, tenantId]);
    const invRow = invRows[0];
    if (!invRow) {
      throw new AppError(
        404,
        'INVOICE_NOT_FOUND',
        'Factuur niet gevonden'
      );
    }
    if (invRow.external_accounting_id) {
      return {
        external_id: invRow.external_accounting_id,
        provider: invRow.external_accounting_provider!,
        already_synced: true,
      };
    }

    const integration = await pickPrimaryIntegration(client, tenantId);
    if (!integration) {
      throw new AppError(
        409,
        'NO_ACCOUNTING_INTEGRATION',
        'Geen actieve accounting-integratie geconfigureerd'
      );
    }
    const conn = getAccountingConnector(integration.provider);
    if (!conn) {
      throw new AppError(
        500,
        'CONNECTOR_NOT_FOUND',
        `Connector niet geregistreerd: ${integration.provider}`
      );
    }

    // Load lines
    const { rows: lineRows } = await client.query<{
      id: string;
      description: string;
      quantity: string;
      unit: string;
      unit_price: string;
      line_total: string;
      vat_rate: string | null;
      metadata: Record<string, unknown>;
    }>(
      `SELECT id, description, quantity, unit, unit_price, line_total,
              vat_rate, metadata
         FROM invoice_lines
        WHERE invoice_id = $1 AND tenant_id = $2
        ORDER BY created_at ASC, id ASC`,
      [invoiceId, tenantId]
    );

    const invoice: NormalizedInvoice = {
      id: invRow.id,
      tenant_id: invRow.tenant_id,
      invoice_number: invRow.invoice_number,
      client_organization_id: invRow.client_organization_id,
      contract_id: invRow.contract_id,
      period_start: invRow.period_start,
      period_end: invRow.period_end,
      issued_date: invRow.issued_date,
      due_date: invRow.due_date,
      subtotal_amount: Number(invRow.subtotal_amount),
      vat_rate: Number(invRow.vat_rate),
      vat_amount: Number(invRow.vat_amount),
      total_amount: Number(invRow.total_amount),
      currency: invRow.currency,
      notes: invRow.notes,
    };
    const lines: NormalizedInvoiceLine[] = lineRows.map((l) => ({
      id: l.id,
      description: l.description,
      quantity: Number(l.quantity),
      unit: l.unit,
      unit_price: Number(l.unit_price),
      line_total: Number(l.line_total),
      vat_rate: l.vat_rate === null ? null : Number(l.vat_rate),
      metadata: l.metadata ?? {},
    }));

    let result;
    try {
      result = await conn.syncInvoice(
        { tenantId, userId: options.userId ?? null },
        invoice,
        lines,
        integration
      );
    } catch (err) {
      // Mark integration last_error but rethrow so caller sees the failure.
      await client.query(
        `UPDATE accounting_integrations
            SET last_error = $1, status = 'error'
          WHERE id = $2 AND tenant_id = $3`,
        [(err as Error).message.slice(0, 500), integration.id, tenantId]
      );
      throw err;
    }

    await client.query(
      `UPDATE invoices
          SET external_accounting_id = $1,
              external_accounting_provider = $2,
              external_synced_at = now(),
              updated_at = now()
        WHERE id = $3 AND tenant_id = $4`,
      [result.external_id, integration.provider, invoiceId, tenantId]
    );
    await client.query(
      `UPDATE accounting_integrations
          SET last_synced_at = now(), last_error = NULL, status = 'connected'
        WHERE id = $1 AND tenant_id = $2`,
      [integration.id, tenantId]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: 'accounting.invoice.synced',
        entityType: 'invoice',
        entityId: invoiceId,
        userId: options.userId ?? null,
        after: { provider: integration.provider, external_id: result.external_id },
      },
      options.auditCtx ?? {}
    );

    return {
      external_id: result.external_id,
      provider: integration.provider,
      already_synced: false,
    };
  });
}

/**
 * Cron entry-point: voor alle invoices met `external_accounting_id` en
 * `status = 'sent'` checkt de connector of upstream "betaald" zegt en update
 * dan de DB. Niet-blokkerend: per-invoice try/catch zodat één rotte rij niet
 * de hele cron sloopt.
 */
export async function pullPaymentsForAllTenants(): Promise<{
  scanned: number;
  marked_paid: number;
}> {
  const { pool } = await import('../../db/pool');
  const client = await pool.connect();
  let scanned = 0;
  let markedPaid = 0;
  try {
    const { rows } = await client.query<{
      tenant_id: string;
      id: string;
      external_accounting_id: string;
      external_accounting_provider: AccountingProviderId;
    }>(
      `SELECT tenant_id, id, external_accounting_id, external_accounting_provider
         FROM invoices
        WHERE external_accounting_id IS NOT NULL
          AND external_accounting_provider IS NOT NULL
          AND status = 'sent'
        LIMIT 500`
    );
    for (const row of rows) {
      scanned++;
      try {
        // Re-load creds inside tenant context
        const paid = await withTenant(row.tenant_id, async (txClient) => {
          const integration = await loadIntegrationCreds(
            txClient,
            row.tenant_id,
            row.external_accounting_provider
          );
          if (!integration) return null;
          const conn = getAccountingConnector(row.external_accounting_provider);
          if (!conn) return null;
          const info = await conn.pullPayment(
            { tenantId: row.tenant_id, userId: null },
            row.external_accounting_id,
            integration
          );
          if (info && info.paid) {
            await txClient.query(
              `UPDATE invoices
                  SET status = 'paid',
                      paid_date = COALESCE($1, CURRENT_DATE),
                      updated_at = now()
                WHERE id = $2`,
              [info.paid_date, row.id]
            );
            return true;
          }
          return false;
        });
        if (paid) markedPaid++;
      } catch (err) {
        logger.warn('[accounting] pullPayment failed for invoice', {
          invoice_id: row.id,
          error: (err as Error).message,
        });
      }
    }
    return { scanned, marked_paid: markedPaid };
  } finally {
    client.release();
  }
}

export { getAccountingConnector, listAccountingConnectors };
