/**
 * Shared types for the accounting-connector framework — Sprint Q4.4 (Agent UUU).
 *
 * Iedere connector implementeert {@link AccountingConnector}. De service
 * (`accounting.service.ts`) en de sync-worker spreken alleen via dit interface
 * — concrete connectors zoals Exact Online, Twinfield of SnelStart weten niets
 * van de DB of de queue.
 *
 * Mirrort de Q4.3 job-boards-aanpak (`modules/job-boards/types.ts`) bewust:
 * dezelfde mock-mode-helper, dezelfde `IntegrationCreds`-shape, dezelfde
 * registry-stijl. Zo blijft connector-onderhoud DRY voor toekomstige boards
 * én accounting-providers.
 */

export type AccountingProviderId = 'exact_online' | 'twinfield' | 'snelstart';

export type AccountingIntegrationStatus =
  | 'connected'
  | 'disconnected'
  | 'error';

/**
 * Versimpelde invoice-shape waarmee connectors werken. Bewust ontkoppeld van
 * de DB-row zodat we de DB-shape kunnen evolueren zonder elke connector aan
 * te passen.
 */
export interface NormalizedInvoice {
  id: string;
  tenant_id: string;
  invoice_number: string;
  client_organization_id: string | null;
  contract_id: string | null;
  period_start: string | null;
  period_end: string | null;
  issued_date: string | null;
  due_date: string | null;
  subtotal_amount: number;
  vat_rate: number;
  vat_amount: number;
  total_amount: number;
  currency: string;
  notes: string | null;
}

export interface NormalizedInvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  line_total: number;
  vat_rate: number | null;
  metadata?: Record<string, unknown>;
}

export interface AccountingIntegrationCreds {
  id: string;
  tenant_id: string;
  provider: AccountingProviderId;
  settings: Record<string, unknown>;
  credentials: Record<string, unknown>;
}

export interface AccountingSyncResult {
  external_id: string;
  external_url?: string | null;
  raw: unknown;
}

export interface AccountingPaymentInfo {
  paid: boolean;
  paid_date: string | null;
  amount_paid: number | null;
  raw: unknown;
}

export interface AccountingConnectorContext {
  tenantId: string;
  userId: string | null;
}

export interface AccountingConnector {
  id: AccountingProviderId;
  displayName: string;
  /**
   * Push een factuur (header + lines) naar de externe accounting-provider.
   * Bij succes retourneert de connector het `external_id` dat we in de DB
   * persisteren. Bij failure throwt hij — caller logt + markeert `last_error`.
   */
  syncInvoice(
    ctx: AccountingConnectorContext,
    invoice: NormalizedInvoice,
    lines: NormalizedInvoiceLine[],
    integration: AccountingIntegrationCreds
  ): Promise<AccountingSyncResult>;

  /**
   * Vraag de payment-status van een eerder ge-sync'de factuur op. Retourneert
   * null als de provider geen state-info heeft (bijvoorbeeld 404 → "weg").
   */
  pullPayment(
    ctx: AccountingConnectorContext,
    externalId: string,
    integration: AccountingIntegrationCreds
  ): Promise<AccountingPaymentInfo | null>;
}

/**
 * Helper: detecteer of we in mock-mode draaien. Dev/demo werkt zonder echte
 * accounting-API-keys. Mirror van `isMockMode` in modules/job-boards/types.ts.
 */
export function isAccountingMockMode(
  integration: AccountingIntegrationCreds | null
): boolean {
  if (process.env.ACCOUNTING_MOCK === 'true') return true;
  if (!integration) return true;
  const creds = integration.credentials ?? {};
  const hasToken =
    typeof creds.access_token === 'string' && creds.access_token.length > 8;
  const hasApiKey =
    typeof creds.api_key === 'string' && creds.api_key.length > 8;
  const hasSession =
    typeof creds.session_token === 'string' && creds.session_token.length > 8;
  return !(hasToken || hasApiKey || hasSession);
}
