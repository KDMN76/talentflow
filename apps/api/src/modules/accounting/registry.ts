/**
 * Accounting connector registry — Sprint Q4.4 (Agent UUU).
 *
 * Mirror van `modules/job-boards/registry.ts`. Eén centrale dispatcher zodat
 * de service-laag (en de sync-worker) provider-onafhankelijk blijft.
 */

import type {
  AccountingConnector,
  AccountingProviderId,
} from './types';
import { exactOnlineConnector } from './connectors/exactOnline';
import { twinfieldConnector } from './connectors/twinfield';
import { snelstartConnector } from './connectors/snelstart';

export const ACCOUNTING_REGISTRY: Record<
  AccountingProviderId,
  AccountingConnector
> = {
  exact_online: exactOnlineConnector,
  twinfield: twinfieldConnector,
  snelstart: snelstartConnector,
};

export function getAccountingConnector(
  provider: string
): AccountingConnector | null {
  return (
    ACCOUNTING_REGISTRY[provider as AccountingProviderId] ?? null
  );
}

export function listAccountingConnectors(): AccountingConnector[] {
  return Object.values(ACCOUNTING_REGISTRY);
}
