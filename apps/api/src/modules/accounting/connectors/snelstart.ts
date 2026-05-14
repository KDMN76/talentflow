/**
 * SnelStart connector — Sprint Q4.4 (Agent UUU).
 *
 * Authenticatie: API-key (per-tenant `subscription_key` + `api_access_key`).
 * SnelStart's B2B API gebruikt geen OAuth; je krijgt een access-token via
 * een `POST /b2bapi/v2/connect/token` met je `subscription_key` en
 * `api_access_key` als basis-auth.
 *
 * Endpoints (v2):
 *   - POST   https://b2bapi.snelstart.nl/v2/verkoopboekingen
 *   - GET    https://b2bapi.snelstart.nl/v2/verkoopboekingen/{id}
 */

import axios, { AxiosError } from 'axios';
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

const SNELSTART_API_BASE = 'https://b2bapi.snelstart.nl/v2';
const SNELSTART_TOKEN_URL = `${SNELSTART_API_BASE}/connect/token`;

interface SnelstartCreds {
  api_key?: string;
  subscription_key?: string;
  access_token?: string;
  expires_at?: string;
  administratie_id?: string;
}

function creds(integration: AccountingIntegrationCreds): SnelstartCreds {
  return integration.credentials as SnelstartCreds;
}

function mockSync(invoice: NormalizedInvoice): AccountingSyncResult {
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 18);
  return {
    external_id: `snelstart-mock-${id}`,
    external_url: null,
    raw: {
      mock: true,
      invoice_number: invoice.invoice_number,
      total: invoice.total_amount,
    },
  };
}

function mockPayment(externalId: string): AccountingPaymentInfo {
  const seed = crypto.createHash('sha256').update(externalId).digest()[2] ?? 0;
  const paid = seed % 5 === 0;
  return {
    paid,
    paid_date: paid ? new Date().toISOString().slice(0, 10) : null,
    amount_paid: null,
    raw: { mock: true, external_id: externalId },
  };
}

async function getAccessToken(
  integration: AccountingIntegrationCreds
): Promise<string> {
  const c = creds(integration);
  if (
    c.access_token &&
    c.expires_at &&
    new Date(c.expires_at) > new Date(Date.now() + 30_000)
  ) {
    return c.access_token;
  }
  if (!c.api_key || !c.subscription_key) {
    throw new Error('SnelStart api_key/subscription_key ontbreken');
  }
  const res = await axios.post<{
    access_token: string;
    expires_in: number;
  }>(
    SNELSTART_TOKEN_URL,
    new URLSearchParams({
      grant_type: 'clientcredentials',
      client_id: c.api_key,
    }).toString(),
    {
      headers: {
        'Ocp-Apim-Subscription-Key': c.subscription_key,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 10_000,
    }
  );
  (integration.credentials as SnelstartCreds).access_token =
    res.data.access_token;
  (integration.credentials as SnelstartCreds).expires_at = new Date(
    Date.now() + res.data.expires_in * 1000
  ).toISOString();
  return res.data.access_token;
}

function buildPayload(
  invoice: NormalizedInvoice,
  lines: NormalizedInvoiceLine[]
): Record<string, unknown> {
  return {
    factuurnummer: invoice.invoice_number,
    factuurdatum: invoice.issued_date,
    vervaldatum: invoice.due_date,
    valuta: invoice.currency,
    omschrijving: invoice.notes ?? '',
    relatie: { id: invoice.client_organization_id },
    boekingsregels: lines.map((line) => ({
      omschrijving: line.description,
      aantal: line.quantity,
      prijs: line.unit_price,
      bedrag: line.line_total,
      btwTariefPercentage: line.vat_rate ?? 21,
    })),
  };
}

export const snelstartConnector: AccountingConnector = {
  id: 'snelstart',
  displayName: 'SnelStart',

  async syncInvoice(_ctx, invoice, lines, integration) {
    if (isAccountingMockMode(integration)) {
      logger.info('[accounting] SnelStart syncInvoice (mock)', {
        invoice_id: invoice.id,
      });
      return mockSync(invoice);
    }
    const c = creds(integration);
    const token = await getAccessToken(integration);
    const payload = buildPayload(invoice, lines);
    const res = await axios.post<{ id: string }>(
      `${SNELSTART_API_BASE}/verkoopboekingen`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Ocp-Apim-Subscription-Key': c.subscription_key ?? '',
          'Content-Type': 'application/json',
        },
        timeout: 15_000,
      }
    );
    const externalId = res.data?.id;
    if (!externalId) {
      throw new Error('SnelStart sync: geen verkoopboeking-id in response');
    }
    return { external_id: externalId, external_url: null, raw: res.data };
  },

  async pullPayment(_ctx, externalId, integration) {
    if (isAccountingMockMode(integration)) {
      return mockPayment(externalId);
    }
    const c = creds(integration);
    const token = await getAccessToken(integration);
    try {
      const res = await axios.get<{
        betaalstatus?: string;
        betaaldatum?: string;
        betaaldBedrag?: number;
      }>(`${SNELSTART_API_BASE}/verkoopboekingen/${externalId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Ocp-Apim-Subscription-Key': c.subscription_key ?? '',
        },
        timeout: 10_000,
      });
      const paid =
        res.data.betaalstatus === 'Betaald' || Boolean(res.data.betaaldatum);
      return {
        paid,
        paid_date: res.data.betaaldatum ?? null,
        amount_paid: res.data.betaaldBedrag ?? null,
        raw: res.data,
      };
    } catch (err) {
      const ax = err as AxiosError;
      if (ax.response?.status === 404) return null;
      throw err;
    }
  },
};

export default snelstartConnector;
