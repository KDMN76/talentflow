/**
 * Candidate self-service — Sprint Q2.3.
 *
 * Token-based zelfportaal: kandidaat krijgt een tijdelijke (7 dagen)
 * URL waarmee zij hun eigen data kunnen inzien, consents wijzigen,
 * correcties aanvragen of een verwijderverzoek indienen.
 *
 * Security:
 *   - 64-char URL-safe token (32 bytes hex). Niet voorspelbaar.
 *   - Single-use rotation NIET geïmplementeerd; we tellen `used_count`
 *     en `last_used_at`. Reden: kandidaat kan binnen de 7-dagen-
 *     window meerdere acties willen doen (consent wijzigen na
 *     correctie ingediend te hebben). Een fresh token uitgeven na
 *     elke actie zou de UX breken.
 *   - Geen RLS-context gezet bij token-lookup: we doen één SELECT op
 *     token-hash zonder tenant-context. Daarna gebruiken we de
 *     tenant_id uit die rij voor alle vervolg-queries (RLS herstelt
 *     zichzelf via withTenant).
 *   - Rate-limiting (30 req/uur per token) wordt op router-niveau gedaan.
 */

import { randomBytes, createHash } from 'crypto';
import type { PoolClient } from 'pg';
import { withTenant, withoutTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import {
  createDsarRequest,
  createDataExportLink,
  type DsarStatus,
} from './dsar.service';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_BYTES = 32;
const TOKEN_TTL_DAYS = 7;
const TOKEN_TTL_MS = TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SafeCandidate {
  id: string;
  candidate_reference: string | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  current_position: string | null;
  current_company: string | null;
  description: string | null;
  /** ISO 8601. */
  created_at: string;
  updated_at: string;
}

export interface SafeApplication {
  id: string;
  job_title: string | null;
  status: string;
  stage_name: string | null;
  applied_at: string | null;
  updated_at: string | null;
}

export interface SafeCommunication {
  id: string;
  channel: string;
  direction: string;
  subject: string | null;
  status: string;
  sent_at: string | null;
}

export interface CandidateSelfPayload {
  candidate: SafeCandidate;
  applications: SafeApplication[];
  communications: SafeCommunication[];
  consents: {
    gdpr: boolean;
    email: boolean;
    granted_at: string | null;
  };
  retention: {
    policy: string;
    will_be_deleted_at: string | null;
  };
  tenant: {
    name: string;
    privacy_email: string | null;
  };
  deletion_request: {
    dsar_id: string;
    status: 'pending' | 'processing' | 'completed' | 'rejected';
    requested_at: string;
    deadline: string;
  } | null;
}

interface TokenRow {
  id: string;
  tenant_id: string;
  candidate_id: string;
  expires_at: string;
  used_count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token generation
// ─────────────────────────────────────────────────────────────────────────────

function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

/**
 * Hash een raw token met sha256 (hex). Zelfde conventie als
 * password_reset_tokens (041) en data_export_tokens (046): at rest
 * bewaren we alléén de hash, de raw token zit enkel in de URL.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function buildSelfServiceUrl(token: string): string {
  const base =
    process.env.PUBLIC_APP_URL?.replace(/\/$/, '') ??
    'https://app.talentflow.io';
  // NB: het portaal leeft op /profile/[token] in de web-app.
  return `${base}/profile/${token}`;
}

/**
 * Genereer een nieuwe self-service token voor de kandidaat.
 * Returnt token + url. Audit `candidate.self_token_generated`.
 */
export async function generateCandidateSelfToken(
  tenantId: string,
  candidateId: string,
  userId: string | null = null,
  ctx: AuditContext = {}
): Promise<{ token: string; url: string; expires_at: string }> {
  const token = generateOpaqueToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await withTenant(tenantId, async (client) => {
    // Verify candidate bestaat.
    const { rowCount } = await client.query(
      `SELECT 1 FROM candidates WHERE id = $1 AND tenant_id = $2`,
      [candidateId, tenantId]
    );
    if (rowCount === 0) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
    }

    // Alléén de hash bewaren; de raw token zit in de URL (buildSelfServiceUrl).
    await client.query(
      `INSERT INTO candidate_self_tokens
         (tenant_id, candidate_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, candidateId, tokenHash, expiresAt.toISOString()]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.CANDIDATE_SELF_TOKEN_GENERATED,
        entityType: 'candidate',
        entityId: candidateId,
        after: { expires_at: expiresAt.toISOString() },
        userId,
      },
      ctx
    );
  });

  return {
    token,
    url: buildSelfServiceUrl(token),
    expires_at: expiresAt.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Token lookup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lookup en valideer een token. Bumpt `used_count` + `last_used_at`.
 * Throwt 401 bij invalid/expired.
 */
async function findAndTouchToken(
  token: string
): Promise<TokenRow> {
  // Lookup zonder tenant-context — we kennen de tenant nog niet.
  return withoutTenant(async (client) => {
    try {
      await client.query(`SET LOCAL row_security = off`);
    } catch {
      /* ignore */
    }
    const { rows } = await client.query<TokenRow>(
      `SELECT id, tenant_id, candidate_id, expires_at::text, used_count
         FROM candidate_self_tokens
        WHERE token_hash = $1`,
      [hashToken(token)]
    );
    const row = rows[0];
    if (!row) {
      throw new AppError(401, 'TOKEN_INVALID', 'Ongeldige of verlopen link');
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Deze link is verlopen');
    }
    await client.query(
      `UPDATE candidate_self_tokens
          SET used_count = used_count + 1,
              last_used_at = now()
        WHERE id = $1`,
      [row.id]
    );
    return row;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Read self-service data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Geef de kandidaat een sanitised snapshot van zijn/haar gegevens.
 * Geen interne velden (ai_score, embedding, notes), alleen wat de
 * kandidaat zelf op een AVG-portaal hoort te zien.
 */
export async function getCandidateSelfData(
  token: string
): Promise<CandidateSelfPayload> {
  const tokenRow = await findAndTouchToken(token);
  const { tenant_id: tenantId, candidate_id: candidateId } = tokenRow;

  return withTenant(tenantId, async (client) => {
    const { rows: candidateRows } = await client.query(
      `SELECT id, candidate_reference, name, first_name, last_name,
              email, phone, current_position, current_company, description,
              gdpr_consent, gdpr_consent_at::text, email_consent, email_consent_at::text,
              last_activity_at::text,
              created_at::text, updated_at::text
         FROM candidates
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL AND anonymized_at IS NULL`,
      [candidateId, tenantId]
    );
    const candidate = candidateRows[0];
    if (!candidate) {
      throw new AppError(
        404,
        'CANDIDATE_NOT_FOUND',
        'Je gegevens zijn niet meer beschikbaar'
      );
    }

    // Sequentieel i.p.v. Promise.all: dezelfde pg-client kan maar één query
    // tegelijk uitvoeren, dus parallel triggert alleen de
    // `client.query()`-DeprecationWarning zonder echte winst. Resultaat gelijk.
    const { rows: applications } = await client.query(
      `SELECT a.id, a.status, a.applied_at::text, a.updated_at::text,
              j.title AS job_title,
              ps.name AS stage_name
         FROM applications a
         LEFT JOIN jobs j ON j.id = a.job_id
         LEFT JOIN pipeline_stages ps ON ps.id = a.stage_id
        WHERE a.candidate_id = $1 AND a.tenant_id = $2`,
      [candidateId, tenantId]
    );
    const { rows: communications } = await client
      .query(
        `SELECT id, channel, direction, subject, status, sent_at::text
           FROM communications
          WHERE candidate_id = $1 AND tenant_id = $2
          ORDER BY sent_at DESC NULLS LAST
          LIMIT 50`,
        [candidateId, tenantId]
      )
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const retention = await computeRetentionInfo(client, tenantId, candidate);

    // Tenant-naam voor de portaal-header ("Jouw gegevens bij <naam>").
    const { rows: tenantRows } = await client.query(
      `SELECT name, settings->>'privacy_email' AS privacy_email
         FROM tenants WHERE id = $1`,
      [tenantId]
    );

    // Laatste verwijderverzoek zodat de kandidaat de status kan volgen en
    // niet per ongeluk dubbel indient.
    const { rows: deletionRows } = await client.query(
      `SELECT id, status, created_at::text, due_at::text
         FROM dsar_requests
        WHERE tenant_id = $1 AND candidate_id = $2
          AND request_type = 'deletion'
        ORDER BY created_at DESC
        LIMIT 1`,
      [tenantId, candidateId]
    );
    const deletionRow = deletionRows[0] as
      | { id: string; status: DsarStatus; created_at: string; due_at: string }
      | undefined;

    return {
      candidate: {
        id: candidate.id,
        candidate_reference: candidate.candidate_reference,
        name: candidate.name,
        first_name: candidate.first_name,
        last_name: candidate.last_name,
        email: candidate.email,
        phone: candidate.phone,
        current_position: candidate.current_position,
        current_company: candidate.current_company,
        description: candidate.description,
        created_at: candidate.created_at,
        updated_at: candidate.updated_at,
      },
      applications: applications as SafeApplication[],
      communications: communications as SafeCommunication[],
      consents: {
        gdpr: Boolean(candidate.gdpr_consent),
        email: Boolean(candidate.email_consent),
        granted_at:
          candidate.gdpr_consent_at ?? candidate.email_consent_at ?? null,
      },
      retention,
      tenant: {
        name: (tenantRows[0]?.name as string) ?? 'Recruitment-team',
        privacy_email: (tenantRows[0]?.privacy_email as string) ?? null,
      },
      deletion_request: deletionRow
        ? {
            dsar_id: deletionRow.id,
            status: mapDsarStatusForPortal(deletionRow.status),
            requested_at: deletionRow.created_at,
            deadline: deletionRow.due_at,
          }
        : null,
    };
  });
}

function mapDsarStatusForPortal(
  status: DsarStatus
): 'pending' | 'processing' | 'completed' | 'rejected' {
  switch (status) {
    case 'in_progress':
      return 'processing';
    case 'fulfilled':
      return 'completed';
    case 'rejected':
    case 'expired':
      return 'rejected';
    default:
      return 'pending';
  }
}

interface CandidateRetentionFields {
  last_activity_at: string | null;
  created_at: string;
}

async function computeRetentionInfo(
  client: PoolClient,
  tenantId: string,
  candidate: CandidateRetentionFields
): Promise<CandidateSelfPayload['retention']> {
  const { rows } = await client.query(
    `SELECT retention_months, trigger_field, action_on_expiry, enabled
       FROM retention_policies
      WHERE tenant_id = $1 AND entity_type = 'candidate' AND enabled = TRUE
      LIMIT 1`,
    [tenantId]
  );
  const policy = rows[0];
  if (!policy) {
    return { policy: 'Geen actief retentiebeleid', will_be_deleted_at: null };
  }
  const triggerVal =
    policy.trigger_field === 'created_at'
      ? candidate.created_at
      : candidate.last_activity_at ?? candidate.created_at;
  if (!triggerVal) {
    return {
      policy: `${policy.retention_months} maanden (${policy.action_on_expiry})`,
      will_be_deleted_at: null,
    };
  }
  const expiresAt = new Date(triggerVal);
  expiresAt.setMonth(expiresAt.getMonth() + policy.retention_months);
  return {
    policy: `${policy.retention_months} maanden (${policy.action_on_expiry})`,
    will_be_deleted_at: expiresAt.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations via token
// ─────────────────────────────────────────────────────────────────────────────

export async function recordCandidateConsentChange(
  token: string,
  type: 'gdpr' | 'email',
  granted: boolean,
  ctx: AuditContext = {}
): Promise<void> {
  const tokenRow = await findAndTouchToken(token);
  const { tenant_id: tenantId, candidate_id: candidateId } = tokenRow;

  await withTenant(tenantId, async (client) => {
    const col = type === 'gdpr' ? 'gdpr_consent' : 'email_consent';
    const tsCol = type === 'gdpr' ? 'gdpr_consent_at' : 'email_consent_at';
    // Guard: geen consent-wijziging op een verwijderde/geanonimiseerde
    // kandidaat (zelfde check als getCandidateSelfData/export). Atomisch via
    // de WHERE-clause: 0 rijen → 404.
    const { rowCount } = await client.query(
      `UPDATE candidates
          SET ${col} = $1,
              ${tsCol} = CASE WHEN $1 THEN now() ELSE NULL END,
              updated_at = now()
        WHERE id = $2 AND tenant_id = $3
          AND deleted_at IS NULL AND anonymized_at IS NULL`,
      [granted, candidateId, tenantId]
    );
    if (rowCount === 0) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
    }
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.CONSENT_UPDATED_BY_CANDIDATE,
        entityType: 'candidate',
        entityId: candidateId,
        after: { type, granted },
        userId: null,
      },
      ctx
    );
  });
}

const ALLOWED_CORRECTION_FIELDS = new Set([
  'first_name',
  'last_name',
  'name',
  'email',
  'phone',
  'address_line1',
  'address_line2',
  'address_city',
  'address_country',
  'address_postal_code',
  'description',
]);

export async function recordCandidateCorrection(
  token: string,
  fields: Record<string, unknown>,
  ctx: AuditContext = {}
): Promise<{ dsar_id: string }> {
  const tokenRow = await findAndTouchToken(token);
  const { tenant_id: tenantId, candidate_id: candidateId } = tokenRow;

  // Filter de input op whitelist — voorkomt dat de kandidaat
  // ai_score/notes/etc kan zetten.
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (ALLOWED_CORRECTION_FIELDS.has(k)) sanitized[k] = v;
  }
  if (Object.keys(sanitized).length === 0) {
    throw new AppError(
      400,
      'CORRECTION_NO_FIELDS',
      'Geen toegestane velden om te corrigeren'
    );
  }

  // We schrijven NIET direct naar candidates: een correctie moet door
  // een recruiter worden bevestigd. Dus we maken een DSAR
  // request(type=correction) met de gewenste fields in `notes`.
  const candidate = await withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT email FROM candidates WHERE id = $1 AND tenant_id = $2`,
      [candidateId, tenantId]
    );
    return rows[0] ?? null;
  });

  const dsar = await createDsarRequest(
    tenantId,
    candidateId,
    'correction',
    candidate?.email ?? 'self-portal@talentflow.local',
    'self_portal',
    JSON.stringify(sanitized),
    ctx
  );

  await withTenant(tenantId, async (client) => {
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.CANDIDATE_CORRECTION_BY_CANDIDATE,
        entityType: 'candidate',
        entityId: candidateId,
        after: { dsar_id: dsar.id, fields: Object.keys(sanitized) },
        userId: null,
      },
      ctx
    );
  });

  return { dsar_id: dsar.id };
}

export async function recordCandidateDeletionRequest(
  token: string,
  reason?: string,
  ctx: AuditContext = {}
): Promise<{ dsar_id: string }> {
  const tokenRow = await findAndTouchToken(token);
  const { tenant_id: tenantId, candidate_id: candidateId } = tokenRow;

  // Guard: geen (dubbele) deletion-DSAR op een verwijderde/geanonimiseerde
  // kandidaat (zelfde check als getCandidateSelfData/export).
  const candidate = await withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT email FROM candidates
        WHERE id = $1 AND tenant_id = $2
          AND deleted_at IS NULL AND anonymized_at IS NULL`,
      [candidateId, tenantId]
    );
    return rows[0] ?? null;
  });
  if (!candidate) {
    throw new AppError(
      404,
      'CANDIDATE_NOT_FOUND',
      'Je gegevens zijn niet meer beschikbaar'
    );
  }

  const dsar = await createDsarRequest(
    tenantId,
    candidateId,
    'deletion',
    candidate.email ?? 'self-portal@talentflow.local',
    'self_portal',
    reason,
    ctx
  );

  await withTenant(tenantId, async (client) => {
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.CANDIDATE_DELETION_REQUESTED_BY_CANDIDATE,
        entityType: 'candidate',
        entityId: candidateId,
        after: { dsar_id: dsar.id, reason: reason ?? null },
        userId: null,
      },
      ctx
    );
  });

  return { dsar_id: dsar.id };
}

/**
 * Kandidaat vraagt via het portaal een kopie van zijn/haar gegevens
 * (AVG art. 15). We registreren een DSAR (type=export, self_portal),
 * genereren direct een kort-levende download-link en markeren het
 * verzoek als vervuld — de link ís het antwoord.
 *
 * Audit-spoor: dsar.requested → data_export_link.created → dsar.fulfilled.
 */
export async function recordCandidateExportRequest(
  token: string,
  ctx: AuditContext = {}
): Promise<{ dsar_id: string; url: string; expires_at: string }> {
  const tokenRow = await findAndTouchToken(token);
  const { tenant_id: tenantId, candidate_id: candidateId } = tokenRow;

  const candidate = await withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT email FROM candidates
        WHERE id = $1 AND tenant_id = $2
          AND deleted_at IS NULL AND anonymized_at IS NULL`,
      [candidateId, tenantId]
    );
    return rows[0] ?? null;
  });
  if (!candidate) {
    throw new AppError(
      404,
      'CANDIDATE_NOT_FOUND',
      'Je gegevens zijn niet meer beschikbaar'
    );
  }

  const dsar = await createDsarRequest(
    tenantId,
    candidateId,
    'export',
    candidate.email ?? 'self-portal@talentflow.local',
    'self_portal',
    'Export aangevraagd via self-service-portaal',
    ctx
  );

  const link = await createDataExportLink(tenantId, candidateId, {
    dsarId: dsar.id,
    ctx,
  });

  // Direct vervuld: response_url vastleggen zodat de recruiter in het
  // dashboard ziet dat dit verzoek automatisch is afgehandeld.
  await withTenant(tenantId, async (client) => {
    await client.query(
      `UPDATE dsar_requests
          SET status = 'fulfilled',
              response_url = $1,
              fulfilled_at = now()
        WHERE id = $2 AND tenant_id = $3`,
      [link.url, dsar.id, tenantId]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.DSAR_FULFILLED,
        entityType: 'dsar_request',
        entityId: dsar.id,
        after: {
          auto_fulfilled: true,
          request_type: 'export',
          expires_at: link.expires_at,
        },
        userId: null,
      },
      ctx
    );
  });

  return { dsar_id: dsar.id, url: link.url, expires_at: link.expires_at };
}

export const _internal = { TOKEN_TTL_DAYS, TOKEN_BYTES };
