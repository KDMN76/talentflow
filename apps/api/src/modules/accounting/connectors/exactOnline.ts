/**
 * Exact Online connector — Sprint Q4.4 (Agent UUU).
 *
 * Authenticatie: OAuth 2.0. Per-tenant `access_token` + `refresh_token`
 * encrypted opgeslagen in `accounting_integrations.credentials_encrypted`.
 *
 * Endpoints (officieel):
 *   - POST   https://start.exactonline.nl/api/v1/{division}/salesinvoice/SalesInvoices
 *   - GET    https://start.exactonline.nl/api/v1/{division}/salesinvoice/SalesInvoices(guid'…')
 *   - POST   https://start.exactonline.nl/api/oauth2/token  (refresh)
 *
 * Mock-mode is enabled wanneer `ACCOUNTING_MOCK=true` of wanneer er geen
 * geldige credentials zijn. Dan retourneren we deterministische synthetic
 * external_ids zodat dev/demo werkt.
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

const EXACT_API_BASE = 'https://start.exactonline.nl/api/v1';
const EXACT_OAUTH_URL = 'https://start.exactonline.nl/api/oauth2/token';

interface ExactCreds {
  access_token?: string;
  refresh_token?: string;
  expires_at?: string;
  division?: string;
  client_id?: string;
  client_secret?: string;
}

function creds(integration: AccountingIntegrationCreds): ExactCreds {
  return integration.credentials as ExactCreds;
}

function mockSync(invoice: NormalizedInvoice): AccountingSyncResult {
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 18);
  return {
    external_id: `exact-mock-${id}`,
    external_url: `https://start.exactonline.nl/docs/SalesInvoiceView.aspx?id=mock-${id}`,
    raw: {
      mock: true,
      invoice_number: invoice.invoice_number,
      total: invoice.total_amount,
    },
  };
}

function mockPayment(externalId: string): AccountingPaymentInfo {
  // Deterministische "is paid" — hash externalId; ~33% paid in dev/demo.
  const seed = crypto.createHash('sha256').update(externalId).digest()[0] ?? 0;
  const paid = seed % 3 === 0;
  return {
    paid,
    paid_date: paid ? new Date().toISOString().slice(0, 10) : null,
    amount_paid: null,
    raw: { mock: true, external_id: externalId, seed },
  };
}

/**
 * Build het Exact Online SalesInvoice payload uit onze NormalizedInvoice.
 * Exact verwacht een specifieke shape met `Customer` (GUID), `InvoiceDate`
 * (yyyymmdd), en `SalesInvoiceLines` (array met `Item`/`Quantity`/`UnitPrice`).
 */
function buildExactPayload(
  invoice: NormalizedInvoice,
  lines: NormalizedInvoiceLine[],
  integration: AccountingIntegrationCreds
): Record<string, unknown> {
  const settings = integration.settings as Record<string, unknown>;
  const defaultRevenueAccount =
    (settings.default_revenue_account as string | undefined) ?? null;

  return {
    InvoiceTo: invoice.client_organization_id,
    OrderedBy: invoice.client_organization_id,
    Customer: invoice.client_organization_id,
    InvoiceDate: invoice.issued_date ?? invoice.period_start,
    Description: `${invoice.invoice_number} — ${invoice.notes ?? ''}`.trim(),
    Currency: invoice.currency,
    YourRef: invoice.invoice_number,
    SalesInvoiceLines: lines.map((line, idx) => ({
      LineNumber: idx + 1,
      Description: line.description,
      Quantity: line.quantity,
      UnitPrice: line.unit_price,
      AmountFC: line.line_total,
      VATCode: line.vat_rate
        ? line.vat_rate >= 21
          ? 'VH'
          : line.vat_rate >= 9
            ? 'VL'
            : 'VN'
        : 'VN',
      GLAccount: defaultRevenueAccount,
    })),
  };
}

async function withTokenRefresh<T>(
  integration: AccountingIntegrationCreds,
  fn: (token: string) => Promise<AxiosResponse<T>>
): Promise<AxiosResponse<T>> {
  const c = creds(integration);
  if (!c.access_token) {
    throw new Error('Exact Online access_token ontbreekt');
  }
  try {
    return await fn(c.access_token);
  } catch (err) {
    const ax = err as AxiosError;
    if (ax.response?.status === 401 && c.refresh_token) {
      logger.info('[accounting] Exact 401 — refresh token + retry', {
        integration_id: integration.id,
      });
      const refreshed = await refreshAccessToken(integration);
      (integration.credentials as ExactCreds).access_token =
        refreshed.access_token;
      if (refreshed.refresh_token) {
        (integration.credentials as ExactCreds).refresh_token =
          refreshed.refresh_token;
      }
      return await fn(refreshed.access_token);
    }
    throw err;
  }
}

interface ExactTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

async function refreshAccessToken(
  integration: AccountingIntegrationCreds
): Promise<ExactTokenResponse> {
  const c = creds(integration);
  if (!c.refresh_token) {
    throw new Error('Exact Online refresh_token ontbreekt');
  }
  const res = await axios.post<ExactTokenResponse>(
    EXACT_OAUTH_URL,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: c.refresh_token,
      client_id: c.client_id ?? process.env.EXACT_CLIENT_ID ?? '',
      client_secret: c.client_secret ?? process.env.EXACT_CLIENT_SECRET ?? '',
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10_000,
    }
  );
  return res.data;
}

export const exactOnlineConnector: AccountingConnector = {
  id: 'exact_online',
  displayName: 'Exact Online',

  async syncInvoice(_ctx, invoice, lines, integration) {
    if (isAccountingMockMode(integration)) {
      logger.info('[accounting] Exact syncInvoice (mock)', {
        invoice_id: invoice.id,
      });
      return mockSync(invoice);
    }
    const c = creds(integration);
    const division = c.division ?? '0';
    const payload = buildExactPayload(invoice, lines, integration);
    const res = await withTokenRefresh(integration, (token) =>
      axios.post<{ d: { InvoiceID: string } }>(
        `${EXACT_API_BASE}/${division}/salesinvoice/SalesInvoices`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          timeout: 15_000,
        }
      )
    );
    const externalId = res.data?.d?.InvoiceID;
    if (!externalId) {
      throw new Error('Exact Online sync: geen InvoiceID in response');
    }
    return {
      external_id: externalId,
      external_url: `https://start.exactonline.nl/docs/SalesInvoiceView.aspx?id=${externalId}`,
      raw: res.data,
    };
  },

  async pullPayment(_ctx, externalId, integration) {
    if (isAccountingMockMode(integration)) {
      return mockPayment(externalId);
    }
    const c = creds(integration);
    const division = c.division ?? '0';
    try {
      const res = await withTokenRefresh(integration, (token) =>
        axios.get<{
          d: { Status?: number; PaymentReference?: string; AmountFC?: number };
        }>(
          `${EXACT_API_BASE}/${division}/salesinvoice/SalesInvoices(guid'${externalId}')`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
            },
            timeout: 10_000,
          }
        )
      );
      const status = res.data?.d?.Status;
      // Exact statuscodes: 50 = processed/paid (best-effort heuristic).
      const paid = status === 50;
      return {
        paid,
        paid_date: paid ? new Date().toISOString().slice(0, 10) : null,
        amount_paid: res.data?.d?.AmountFC ?? null,
        raw: res.data,
      };
    } catch (err) {
      const ax = err as AxiosError;
      if (ax.response?.status === 404) return null;
      throw err;
    }
  },
};

export default exactOnlineConnector;
