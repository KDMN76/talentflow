/**
 * Mail-provider factory — selecteert provider obv DB-discriminator.
 *
 * Gebruik:
 *   import { getMailProvider } from '../../lib/providers';
 *   const p = getMailProvider('gmail');
 *   const url = p.getAuthUrl(state);
 */

import { MailProvider, MailProviderName } from '../mailProvider';
import { gmailProvider, isGmailMockMode } from './gmailProvider';
import { outlookProvider, isOutlookMockMode } from './outlookProvider';

export function getMailProvider(provider: MailProviderName): MailProvider {
  if (provider === 'gmail') return gmailProvider;
  if (provider === 'outlook') return outlookProvider;
  throw new Error(`Unknown mail provider: ${provider as string}`);
}

export function isProviderMockMode(provider: MailProviderName): boolean {
  if (provider === 'gmail') return isGmailMockMode();
  if (provider === 'outlook') return isOutlookMockMode();
  return false;
}

export { gmailProvider, outlookProvider };
