/**
 * Invoicing service — Sprint Q4.4 (Agent UUU).
 *
 * Verantwoordelijk voor:
 *   - facturen genereren uit goedgekeurde timesheets (TTT-bridge)
 *   - state machine: draft → sent → paid; void
 *   - sequential per-tenant invoice-nummers (concurrency-safe via FOR UPDATE)
 *   - PDF-generatie + storage upload
 *   - delegate naar accounting-sync + commission-records
 *
 * Multi-tenancy: ALLE queries via `withTenant`. PDF rendering en commission-
 * triggers gebeuren NA de transactie zodat een rotte external dependency
 * de DB-write niet rolled back.
 */

import type { PoolClient } from 'pg';
import { withTenant } from '../../db/pool';
import { AppError, logger } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { getStorage } from '../../lib/storage';
import { renderInvoicePdf } from './invoicePdf';
import { summarizeApprovedHoursForBilling } from './timesheetsBridge';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void';

export interface InvoiceRow {
  id: string;
  tenant_id: string;
  invoice_number: string;
  client_organization_id: string | null;
  contract_id: string | null;
  status: InvoiceStatus;
  period_start: string | null;
  period_end: string | null;
  issued_date: string | null;
  due_date: string | null;
  paid_date: string | null;
  subtotal_amount: number;
  vat_rate: number;
  vat_amount: number;
  total_amount: number;
  currency: string;
  notes: string | null;
  pdf_storage_key: string | null;
  external_accounting_id: string | null;
  external_accounting_provider: string | null;
  external_synced_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineRow {
  id: string;
  tenant_id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  line_total: number;
  vat_rate: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ListInvoicesOptions {
  status?: InvoiceStatus;
  client_organization_id?: string;
  contract_id?: string;
  cursor?: string;
  limit?: number;
}

const DEFAULT_VAT_RATE = 21.0;
const DEFAULT_DUE_DAYS = 30;

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function rowToInvoice(row: Record<string, unknown>): InvoiceRow {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    invoice_number: String(row.invoice_number),
    client_organization_id:
      (row.client_organization_id as string | null) ?? null,
    contract_id: (row.contract_id as string | null) ?? null,
    status: row.status as InvoiceStatus,
    period_start: (row.period_start as string | null) ?? null,
    period_end: (row.period_end as string | null) ?? null,
    issued_date: (row.issued_date as string | null) ?? null,
    due_date: (row.due_date as string | null) ?? null,
    paid_date: (row.paid_date as string | null) ?? null,
    subtotal_amount: Number(row.subtotal_amount ?? 0),
    vat_rate: Number(row.vat_rate ?? 0),
    vat_amount: Number(row.vat_amount ?? 0),
    total_amount: Number(row.total_amount ?? 0),
    currency: String(row.currency ?? 'EUR'),
    notes: (row.notes as string | null) ?? null,
    pdf_storage_key: (row.pdf_storage_key as string | null) ?? null,
    external_accounting_id: (row.external_accounting_id as string | null) ?? null,
    external_accounting_provider:
      (row.external_accounting_provider as string | null) ?? null,
    external_synced_at: (row.external_synced_at as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function rowToLine(row: Record<string, unknown>): InvoiceLineRow {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    invoice_id: String(row.invoice_id),
    description: String(row.description),
    quantity: Number(row.quantity),
    unit: String(row.unit),
    unit_price: Number(row.unit_price),
    line_total: Number(row.line_total),
    vat_rate: row.vat_rate === null ? null : Number(row.vat_rate),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: String(row.created_at),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Concurrency-safe per-tenant invoice-nummer claim. Gebruikt SELECT … FOR
 * UPDATE in een upsert-pattern: één rij per (tenant, year), counter wordt
 * atomic ge-incrementeerd. Het UNIQUE-constraint op `invoices(tenant_id,
 * invoice_number)` is een tweede vangnet tegen race-conditions.
 */
async function claimInvoiceNumber(
  client: PoolClient,
  tenantId: string,
  year: number
): Promise<string> {
  // INSERT … ON CONFLICT DO UPDATE doet effectief een atomic increment
  // dankzij row-locking onder UPDATE. Dit werkt in alle PG-isolatieniveaus
  // die we draaien (READ COMMITTED).
  const { rows } = await client.query<{ current_value: string }>(
    `INSERT INTO tenant_invoice_sequences (tenant_id, year, current_value, updated_at)
     VALUES ($1, $2, 1, now())
     ON CONFLICT (tenant_id, year) DO UPDATE
       SET current_value = tenant_invoice_sequences.current_value + 1,
           updated_at    = now()
     RETURNING current_value`,
    [tenantId, year]
  );
  const seq = Number(rows[0].current_value);
  return `INV-${year}-${String(seq).padStart(5, '0')}`;
}

// ───────────────────────────────────────────────────────────────────────────
// CRUD / queries
// ───────────────────────────────────────────────────────────────────────────

export async function listInvoices(
  tenantId: string,
  opts: ListInvoicesOptions = {}
): Promise<{ data: InvoiceRow[]; next_cursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return withTenant(tenantId, async (client) => {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts.status) {
      params.push(opts.status);
      conditions.push(`status = $${params.length}`);
    }
    if (opts.client_organization_id) {
      params.push(opts.client_organization_id);
      conditions.push(`client_organization_id = $${params.length}`);
    }
    if (opts.contract_id) {
      params.push(opts.contract_id);
      conditions.push(`contract_id = $${params.length}`);
    }
    if (opts.cursor) {
      params.push(opts.cursor);
      conditions.push(`created_at < $${params.length}`);
    }
    params.push(limit + 1);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await client.query(
      `SELECT * FROM invoices ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length}`,
      params
    );
    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const data = slice.map(rowToInvoice);
    const nextCursor = hasMore
      ? rows[limit - 1].created_at
        ? String(rows[limit - 1].created_at)
        : null
      : null;
    return { data, next_cursor: nextCursor };
  });
}

export async function getInvoice(
  tenantId: string,
  invoiceId: string
): Promise<{ invoice: InvoiceRow; lines: InvoiceLineRow[] } | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM invoices WHERE id = $1`,
      [invoiceId]
    );
    if (!rows[0]) return null;
    const { rows: lines } = await client.query(
      `SELECT * FROM invoice_lines WHERE invoice_id = $1
        ORDER BY created_at ASC, id ASC`,
      [invoiceId]
    );
    return {
      invoice: rowToInvoice(rows[0]),
      lines: lines.map(rowToLine),
    };
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Generate from contract / timesheets
// ───────────────────────────────────────────────────────────────────────────

export interface GenerateInvoiceOptions {
  /** Aggregeer per week (default) of als één regel per maand. */
  aggregate?: 'week' | 'month' | 'flat';
  /** Override default 21% VAT (used for international clients). */
  vat_rate?: number;
  /** Optional notes to embed on the invoice header. */
  notes?: string | null;
  userId?: string | null;
  auditCtx?: AuditContext;
}

export async function generateInvoiceFromContract(
  tenantId: string,
  contractId: string,
  periodStart: string,
  periodEnd: string,
  opts: GenerateInvoiceOptions = {}
): Promise<{ invoice: InvoiceRow; lines: InvoiceLineRow[] }> {
  const summary = await summarizeApprovedHoursForBilling(
    tenantId,
    contractId,
    periodStart,
    periodEnd
  );

  if (summary.by_week.length === 0 && summary.total_amount_client === 0) {
    throw new AppError(
      400,
      'NO_BILLABLE_HOURS',
      'Geen goedgekeurde uren in deze periode'
    );
  }

  return withTenant(tenantId, async (client) => {
    // Fetch contract for client_organization_id
    const { rows: contractRows } = await client.query<{
      id: string;
      client_organization_id: string | null;
      currency: string;
      hourly_rate_client: string | null;
    }>(
      `SELECT id, client_organization_id, currency, hourly_rate_client
         FROM contracts
        WHERE id = $1 AND tenant_id = $2`,
      [contractId, tenantId]
    );
    const contract = contractRows[0];
    if (!contract) {
      throw new AppError(
        404,
        'CONTRACT_NOT_FOUND',
        'Contract niet gevonden'
      );
    }

    const year = new Date(periodEnd ?? new Date().toISOString()).getUTCFullYear();
    const invoiceNumber = await claimInvoiceNumber(client, tenantId, year);
    const vatRate = opts.vat_rate ?? DEFAULT_VAT_RATE;
    const subtotal = round2(summary.total_amount_client);
    const vatAmount = round2((subtotal * vatRate) / 100);
    const total = round2(subtotal + vatAmount);

    const { rows: invRows } = await client.query<{ id: string }>(
      `INSERT INTO invoices
         (tenant_id, invoice_number, client_organization_id, contract_id,
          status, period_start, period_end, subtotal_amount, vat_rate,
          vat_amount, total_amount, currency, notes, created_by)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        tenantId,
        invoiceNumber,
        contract.client_organization_id,
        contractId,
        periodStart,
        periodEnd,
        subtotal,
        vatRate,
        vatAmount,
        total,
        summary.currency ?? contract.currency ?? 'EUR',
        opts.notes ?? null,
        opts.userId ?? null,
      ]
    );
    const invoiceId = invRows[0].id;

    // Build lines
    const aggregate = opts.aggregate ?? 'week';
    const linesToInsert: Array<{
      description: string;
      quantity: number;
      unit: string;
      unit_price: number;
      line_total: number;
      metadata: Record<string, unknown>;
    }> = [];

    if (aggregate === 'flat') {
      linesToInsert.push({
        description: `Detachering periode ${periodStart} t/m ${periodEnd}`,
        quantity: round2(summary.total_hours + summary.total_overtime_hours),
        unit: 'hours',
        unit_price:
          summary.total_amount_client /
          Math.max(summary.total_hours + summary.total_overtime_hours * 1.25, 1),
        line_total: subtotal,
        metadata: { period_start: periodStart, period_end: periodEnd },
      });
    } else if (aggregate === 'month') {
      // Group by YYYY-MM
      const byMonth = new Map<
        string,
        { hours: number; overtime: number; amount: number }
      >();
      for (const w of summary.by_week) {
        const ym = w.week_start.slice(0, 7);
        const cur = byMonth.get(ym) ?? { hours: 0, overtime: 0, amount: 0 };
        cur.hours += w.hours;
        cur.overtime += w.overtime_hours;
        cur.amount += w.amount_client;
        byMonth.set(ym, cur);
      }
      for (const [ym, agg] of byMonth) {
        const billable = agg.hours + agg.overtime * 1.25;
        const unitPrice = billable > 0 ? agg.amount / billable : 0;
        linesToInsert.push({
          description: `Detachering ${ym}`,
          quantity: round2(billable),
          unit: 'hours',
          unit_price: round2(unitPrice),
          line_total: round2(agg.amount),
          metadata: { month: ym },
        });
      }
    } else {
      for (const w of summary.by_week) {
        const billable = w.hours + w.overtime_hours * 1.25;
        const unitPrice = billable > 0 ? w.amount_client / billable : 0;
        linesToInsert.push({
          description: `Week ${w.week_start} — ${round2(w.hours)}u + ${round2(
            w.overtime_hours
          )}u overuren`,
          quantity: round2(billable),
          unit: 'hours',
          unit_price: round2(unitPrice),
          line_total: round2(w.amount_client),
          metadata: { week_start: w.week_start },
        });
      }
    }

    const insertedLines: InvoiceLineRow[] = [];
    for (const line of linesToInsert) {
      const { rows: lineRows } = await client.query(
        `INSERT INTO invoice_lines
           (tenant_id, invoice_id, description, quantity, unit, unit_price,
            line_total, vat_rate, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         RETURNING *`,
        [
          tenantId,
          invoiceId,
          line.description,
          line.quantity,
          line.unit,
          line.unit_price,
          line.line_total,
          vatRate,
          JSON.stringify(line.metadata),
        ]
      );
      insertedLines.push(rowToLine(lineRows[0]));
    }

    const { rows: finalRows } = await client.query(
      `SELECT * FROM invoices WHERE id = $1`,
      [invoiceId]
    );
    const invoice = rowToInvoice(finalRows[0]);

    await logAudit(
      client,
      tenantId,
      {
        action: 'billing.invoice.generated',
        entityType: 'invoice',
        entityId: invoiceId,
        userId: opts.userId ?? null,
        after: {
          invoice_number: invoice.invoice_number,
          contract_id: contractId,
          subtotal,
          total,
        },
      },
      opts.auditCtx ?? {}
    );

    return { invoice, lines: insertedLines };
  });
}

// ───────────────────────────────────────────────────────────────────────────
// State machine
// ───────────────────────────────────────────────────────────────────────────

function assertTransition(
  current: InvoiceStatus,
  allowed: InvoiceStatus[]
): void {
  if (!allowed.includes(current)) {
    throw new AppError(
      409,
      'INVALID_INVOICE_TRANSITION',
      `Niet toegestane status-overgang vanuit '${current}'`
    );
  }
}

export async function issueInvoice(
  tenantId: string,
  invoiceId: string,
  options: { userId?: string | null; auditCtx?: AuditContext } = {}
): Promise<InvoiceRow> {
  // 1) Transitionnal DB update + audit
  const { invoice, lines } = await withTenant(tenantId, async (client) => {
    const { rows: existing } = await client.query(
      `SELECT * FROM invoices WHERE id = $1 FOR UPDATE`,
      [invoiceId]
    );
    if (!existing[0]) {
      throw new AppError(404, 'INVOICE_NOT_FOUND', 'Factuur niet gevonden');
    }
    const before = rowToInvoice(existing[0]);
    assertTransition(before.status, ['draft']);
    const issuedDate = new Date().toISOString().slice(0, 10);
    const dueDate = addDays(issuedDate, DEFAULT_DUE_DAYS);
    const { rows: updated } = await client.query(
      `UPDATE invoices
          SET status = 'sent',
              issued_date = $1,
              due_date    = $2,
              updated_at  = now()
        WHERE id = $3
        RETURNING *`,
      [issuedDate, dueDate, invoiceId]
    );
    const { rows: lineRows } = await client.query(
      `SELECT * FROM invoice_lines WHERE invoice_id = $1
        ORDER BY created_at ASC, id ASC`,
      [invoiceId]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: 'billing.invoice.issued',
        entityType: 'invoice',
        entityId: invoiceId,
        userId: options.userId ?? null,
        before: { status: before.status },
        after: { status: 'sent', issued_date: issuedDate, due_date: dueDate },
      },
      options.auditCtx ?? {}
    );
    return {
      invoice: rowToInvoice(updated[0]),
      lines: lineRows.map(rowToLine),
    };
  });

  // 2) Render PDF + upload (buiten transactie — als dit faalt, blijft de
  //    DB-state gewoon op 'sent'. De caller kan later /sync-accounting of
  //    opnieuw renderen via een aparte route.)
  try {
    const pdf = await renderInvoicePdf(
      {
        invoice_number: invoice.invoice_number,
        status: invoice.status,
        issued_date: invoice.issued_date,
        due_date: invoice.due_date,
        period_start: invoice.period_start,
        period_end: invoice.period_end,
        client_organization_id: invoice.client_organization_id,
        contract_id: invoice.contract_id,
        subtotal_amount: invoice.subtotal_amount,
        vat_rate: invoice.vat_rate,
        vat_amount: invoice.vat_amount,
        total_amount: invoice.total_amount,
        currency: invoice.currency,
        notes: invoice.notes,
      },
      lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unit_price: l.unit_price,
        line_total: l.line_total,
      }))
    );
    const storageKey = `tenants/${tenantId}/invoices/${invoiceId}__${invoice.invoice_number}.pdf`;
    await getStorage().put(storageKey, pdf, 'application/pdf');
    await withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE invoices SET pdf_storage_key = $1, updated_at = now() WHERE id = $2`,
        [storageKey, invoiceId]
      );
    });
    invoice.pdf_storage_key = storageKey;
  } catch (err) {
    logger.warn('[billing] PDF render/upload failed', {
      invoice_id: invoiceId,
      error: (err as Error).message,
    });
  }

  // 3) Trigger commission records (best-effort — niet blokkerend).
  try {
    const { recordCommissionsForInvoice } = await import(
      '../commissions/commissions.service'
    );
    await recordCommissionsForInvoice(tenantId, invoiceId);
  } catch (err) {
    logger.warn('[billing] commission trigger failed', {
      invoice_id: invoiceId,
      error: (err as Error).message,
    });
  }

  return invoice;
}

export async function markPaid(
  tenantId: string,
  invoiceId: string,
  paidDate: string,
  options: { userId?: string | null; auditCtx?: AuditContext } = {}
): Promise<InvoiceRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: existing } = await client.query(
      `SELECT * FROM invoices WHERE id = $1 FOR UPDATE`,
      [invoiceId]
    );
    if (!existing[0]) {
      throw new AppError(404, 'INVOICE_NOT_FOUND', 'Factuur niet gevonden');
    }
    const before = rowToInvoice(existing[0]);
    assertTransition(before.status, ['sent', 'overdue']);
    const { rows: updated } = await client.query(
      `UPDATE invoices
          SET status = 'paid', paid_date = $1, updated_at = now()
        WHERE id = $2
        RETURNING *`,
      [paidDate, invoiceId]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: 'billing.invoice.paid',
        entityType: 'invoice',
        entityId: invoiceId,
        userId: options.userId ?? null,
        before: { status: before.status },
        after: { status: 'paid', paid_date: paidDate },
      },
      options.auditCtx ?? {}
    );
    return rowToInvoice(updated[0]);
  });
}

export async function voidInvoice(
  tenantId: string,
  invoiceId: string,
  reason: string,
  options: { userId?: string | null; auditCtx?: AuditContext } = {}
): Promise<InvoiceRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: existing } = await client.query(
      `SELECT * FROM invoices WHERE id = $1 FOR UPDATE`,
      [invoiceId]
    );
    if (!existing[0]) {
      throw new AppError(404, 'INVOICE_NOT_FOUND', 'Factuur niet gevonden');
    }
    const before = rowToInvoice(existing[0]);
    if (before.status === 'paid') {
      throw new AppError(
        409,
        'CANNOT_VOID_PAID_INVOICE',
        'Een betaalde factuur kan niet ge-void worden'
      );
    }
    if (before.status === 'void') {
      throw new AppError(
        409,
        'ALREADY_VOIDED',
        'Factuur is al ge-void'
      );
    }
    const newNotes = before.notes
      ? `${before.notes}\n[VOID] ${reason}`
      : `[VOID] ${reason}`;
    const { rows: updated } = await client.query(
      `UPDATE invoices
          SET status = 'void', notes = $1, updated_at = now()
        WHERE id = $2
        RETURNING *`,
      [newNotes, invoiceId]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: 'billing.invoice.voided',
        entityType: 'invoice',
        entityId: invoiceId,
        userId: options.userId ?? null,
        before: { status: before.status },
        after: { status: 'void', reason },
      },
      options.auditCtx ?? {}
    );
    return rowToInvoice(updated[0]);
  });
}

/**
 * Cron entry-point: mark `sent` invoices past `due_date` as `overdue`. Loopt
 * cross-tenant; gebruikt RAW pool (geen withTenant). RLS bypass omdat we
 * geen `app.tenant_id` zetten — alleen de cron-worker mag dit doen.
 */
export async function markOverdueDueDate(): Promise<{
  scanned: number;
  marked_overdue: number;
}> {
  const { pool } = await import('../../db/pool');
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ id: string; tenant_id: string }>(
      `SELECT id, tenant_id FROM invoices
        WHERE status = 'sent'
          AND due_date IS NOT NULL
          AND due_date < CURRENT_DATE
        LIMIT 1000`
    );
    let marked = 0;
    for (const row of rows) {
      try {
        await withTenant(row.tenant_id, async (txClient) => {
          await txClient.query(
            `UPDATE invoices
                SET status = 'overdue', updated_at = now()
              WHERE id = $1 AND status = 'sent'`,
            [row.id]
          );
        });
        marked++;
      } catch (err) {
        logger.warn('[billing] markOverdue failed for invoice', {
          invoice_id: row.id,
          error: (err as Error).message,
        });
      }
    }
    return { scanned: rows.length, marked_overdue: marked };
  } finally {
    client.release();
  }
}

// Re-export voor convenience
export { renderInvoicePdf };
