/**
 * Shared types for the job-board connector framework — Sprint Q4.3.
 *
 * Iedere connector implementeert {@link JobBoardConnector}. De service
 * (`service.ts`) en de twee BullMQ workers (jobBoardPost / jobBoardPoll)
 * spreken alleen via dit interface — concrete connectors zoals LinkedIn
 * of Indeed weten niets van de DB of de queue.
 */

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
 * Helper: detecteer of we in mock-mode draaien (env-flag of integratie zonder
 * geldige credentials). Connectors gebruiken dit zodat dev/demo werkt zonder
 * echte API-keys.
 */
export function isMockMode(integration: IntegrationCreds | null): boolean {
  if (process.env.JOB_BOARDS_MOCK === 'true') return true;
  if (!integration) return true;
  const creds = integration.credentials ?? {};
  // Heuristiek: als er ECHT geen tokens of api-keys zijn → mock.
  const hasReal =
    typeof creds.access_token === 'string' && creds.access_token.length > 8;
  const hasApiKey =
    typeof creds.api_key === 'string' && creds.api_key.length > 8;
  return !(hasReal || hasApiKey);
}
