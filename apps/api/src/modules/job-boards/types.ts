/**
 * Shared types for the job-board connector framework — Sprint Q4.3.
 *
 * Iedere connector implementeert {@link JobBoardConnector}. De service
 * (`service.ts`) en de twee BullMQ workers (jobBoardPost / jobBoardPoll)
 * spreken alleen via dit interface — concrete connectors zoals LinkedIn
 * of Indeed weten niets van de DB of de queue.
 */

import { mocksAllowed } from '../../lib/env';

export type JobBoardRegion = 'global' | 'nl' | 'de' | 'eu';
export type JobBoardAuthType = 'oauth2' | 'api_key' | 'xml_feed' | 'none';
export type JobPostingStatus =
  | 'queued'
  | 'posted'
  | 'rejected'
  | 'expired'
  | 'retracted'
  | 'failed';
export type JobBoardIntegrationStatus =
  | 'connected'
  | 'disconnected'
  | 'error';

export interface NormalizedJob {
  id: string;
  title: string;
  description: string;
  salary_min?: number;
  salary_max?: number;
  currency?: string;
  employment_type?:
    | 'full_time'
    | 'part_time'
    | 'contract'
    | 'temporary'
    | 'internship';
  location?: {
    city?: string;
    country?: string;
    remote_policy?: 'onsite' | 'hybrid' | 'remote';
  };
  requirements?: string[];
  language?: 'nl' | 'en' | 'de' | 'fr';
  apply_url?: string;
}

export interface PostResult {
  external_id: string;
  external_url: string | null;
  cost_amount: number | null;
  cost_currency: string | null;
  expires_at: string | null;
  raw: unknown;
}

export interface StatusUpdate {
  status: 'posted' | 'rejected' | 'expired' | 'retracted' | 'failed';
  applicants_count?: number;
  error?: string;
  raw: unknown;
}

export interface IntegrationCreds {
  id: string;
  tenant_id: string;
  settings: Record<string, unknown>;
  credentials: Record<string, unknown>;
}

export interface PostingRef {
  id: string;
  external_id: string | null;
  tenant_id: string;
}

export interface ConnectorContext {
  tenantId: string;
  userId: string | null;
}

export interface JobBoardConnector {
  id: string;
  displayName: string;
  region: JobBoardRegion;
  authType: JobBoardAuthType;
  post(
    ctx: ConnectorContext,
    job: NormalizedJob,
    integration: IntegrationCreds
  ): Promise<PostResult>;
  pollStatus(
    ctx: ConnectorContext,
    posting: PostingRef,
    integration: IntegrationCreds
  ): Promise<StatusUpdate | null>;
  retract(
    ctx: ConnectorContext,
    posting: PostingRef,
    integration: IntegrationCreds
  ): Promise<void>;
}

/**
 * Mag een connector synthetische (mock) resultaten teruggeven? Zelfde patroon
 * als de AI-client: mock alleen buiten productie. In productie zonder echte
 * credentials moet een posting eerlijk op 'failed' uitkomen — nooit een
 * verzonnen 'posted'.
 */
export function mockPostingsAllowed(): boolean {
  return mocksAllowed();
}

/**
 * Heeft de integratie bruikbare credentials (token of api-key)?
 */
export function hasRealCredentials(
  integration: IntegrationCreds | null
): boolean {
  if (!integration) return false;
  const creds = integration.credentials ?? {};
  const hasToken =
    typeof creds.access_token === 'string' && creds.access_token.length > 8;
  const hasApiKey =
    typeof creds.api_key === 'string' && creds.api_key.length > 8;
  return hasToken || hasApiKey;
}

/**
 * Helper: detecteer of we in mock-mode draaien (env-flag of integratie zonder
 * geldige credentials). Connectors gebruiken dit zodat dev/demo werkt zonder
 * echte API-keys. In productie is mock-mode UIT: dan gaat het echte pad in en
 * faalt een niet-geconfigureerde integratie hard (geen fake succes).
 */
export function isMockMode(integration: IntegrationCreds | null): boolean {
  if (!mockPostingsAllowed()) return false;
  if (process.env.JOB_BOARDS_MOCK === 'true') return true;
  if (!integration) return true;
  return !hasRealCredentials(integration);
}
