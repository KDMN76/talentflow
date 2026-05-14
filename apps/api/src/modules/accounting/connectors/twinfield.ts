/**
 * Twinfield connector — Sprint Q4.4 (Agent UUU).
 *
 * Twinfield's officiële API is SOAP. Voor TalentFlow maken we gebruik van
 * het REST-wrapper-pad (Twinfield introduceerde een limited-scope REST
 * endpoint sinds 2022 voor sales-invoices) en vallen we anders terug op
 * de mock-mode.
 *
 * Authenticatie: OAuth 2.0 — `access_token` + `refresh_token` + `cluster`
 * (Twinfield-specifiek; de juiste cluster URL hangt aan de tenant).
 *
 * Endpoints:
 *   - POST   https://{cluster}/api/v1/sales-invoices
 *   - GET    https://{cluster}/api/v1/sales-invoices/{id}
 *   - POST   https://login.twinfield.com/auth/authentication/connect/token  (refresh)
 */

import axios, { AxiosError, type AxiosResponse } from 'axios';
import crypto from 'crypto';
import type {
  AccountingConnector,
  AccountingConnectorContext,
  AccountingIntegrationCreds,
  AccountingPaymentInfo,
  AccountingSyncResult,
  NormalizedInvoice,
  NormalizedInvoiceLine,
} from '../types';
import { isAccountingMockMode } from '../types';
import { logger } from '../../../middleware/errorHandler';

const TWINFIELD_OAUTH_URL =
  'https://login.twinfield.com/auth/authentication/connect/token';

interface TwinfieldCreds {
  access_token?: string;
  refresh_token?: string;
  cluster?: string;
  office_code?: string;
  client_id?: string;
  client_secret?: string;
}

function creds(integration: AccountingIntegrationCreds): TwinfieldCreds {
  return integration.credentials as TwinfieldCreds;
}

function clusterBase(integration: AccountingIntegrationCreds): string {
  const c = creds(integration);
  // Twinfield clusters worden door OAuth-flow gegeven; fallback naar
  // accounting.twinfield.com voor public endpoints.
  return c.cluster
    ? c.cluster.replace(/\/+$/, '')
    : 'https://accounting.twinfield.com';
}

function mockSync(invoice: NormalizedInvoice): AccountingSyncResult {
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 18);
  return {
    external_id: `twinfield-mock-${id}`,
    external_url: null,
    raw: {
      mock: true,
      invoice_number: invoice.invoice_number,
      total: invoice.total_amount,
    },
  };
}

function mockPayment(externalId: string): AccountingPaymentInfo {
  const seed = crypto.createHash('sha256').update(externalId).digest()[1] ?? 0;
  const paid = seed % 4 === 0;
  return {
    paid,
    paid_date: paid ? new Date().toISOString().slice(0, 10) : null,
    amount_paid: null,
    raw: { mock: true, external_id: externalId },
  };
}

function buildPayload(
  invoice: NormalizedInvoice,
  lines: NormalizedInvoiceLine[],
  integration: AccountingIntegrationCreds
): Record<string, unknown> {
  const c = creds(integration);
  return {
    office: c.office_code,
    customer: invoice.client_organization_id,
    invoiceNumber: invoice.invoice_number,
    invoiceDate: invoice.issued_date,
    dueDate: invoice.due_date,
    currency: invoice.currency,
    lines: lines.map((line, idx) => ({
      lineNumber: idx + 1,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unit_price,
      lineTotal: line.line_total,
      vatRate: line.vat_rate ?? 21,
    })),
  };
}

async function withTokenRefresh<T>(
  integration: AccountingIntegrationCreds,
  fn: (token: string) => Promise<AxiosResponse<T>>
): Promise<AxiosResponse<T>> {
  const c = creds(integration);
  if (!c.access_token) {
    throw new Error('Twinfield access_token ontbreekt');
  }
  try {
    return await fn(c.access_token);
  } catch (err) {
    const ax = err as AxiosError;
    if (ax.response?.status === 401 && c.refresh_token) {
      logger.info('[accounting] Twinfield 401 — refresh token + retry', {
        integration_id: integration.id,
      });
      const res = await axios.post<{
        access_token: string;
        refresh_token?: string;
      }>(
        TWINFIELD_OAUTH_URL,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: c.refresh_token,
          client_id: c.client_id ?? process.env.TWINFIELD_CLIENT_ID ?? '',
          client_secret:
            c.client_secret ?? process.env.TWINFIELD_CLIENT_SECRET ?? '',
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10_000,
        }
      );
      (integration.credentials as TwinfieldCreds).access_token =
        res.data.access_token;
      if (res.data.refresh_token) {
        (integration.credentials as TwinfieldCreds).refresh_token =
          res.data.refresh_token;
      }
      return await fn(res.data.access_token);
    }
    throw err;
  }
}

export const twinfieldConnector: AccountingConnector = {
  id: 'twinfield',
  displayName: 'Twinfield',

  async syncInvoice(_ctx, invoice, lines, integration) {
    if (isAccountingMockMode(integration)) {
      logger.info('[accounting] Twinfield syncInvoice (mock)', {
        invoice_id: invoice.id,
      });
      return mockSync(invoice);
    }
    const base = clusterBase(integration);
    const payload = buildPayload(invoice, lines, integration);
    const res = await withTokenRefresh(integration, (token) =>
      axios.post<{ id: string; url?: string }>(
        `${base}/api/v1/sales-invoices`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 15_000,
        }
      )
    );
    const externalId = res.data?.id;
    if (!externalId) {
      throw new Error('Twinfield sync: geen invoice id in response');
    }
    return {
      external_id: externalId,
      external_url: res.data.url ?? null,
      raw: res.data,
    };
  },

  async pullPayment(_ctx, externalId, integration) {
    if (isAccountingMockMode(integration)) {
      return mockPayment(externalId);
    }
    const base = clusterBase(integration);
    try {
      const res = await withTokenRefresh(integration, (token) =>
        axios.get<{
          status?: string;
          paidDate?: string;
          paidAmount?: number;
        }>(`${base}/api/v1/sales-invoices/${externalId}`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 10_000,
        })
      );
      const paid = res.data.status === 'paid' || Boolean(res.data.paidDate);
      return {
        paid,
        paid_date: res.data.paidDate ?? null,
        amount_paid: res.data.paidAmount ?? null,
        raw: res.data,
      };
    } catch (err) {
      const ax = err as AxiosError;
      if (ax.response?.status === 404) return null;
      throw err;
    }
  },
};

export default twinfieldConnector;
