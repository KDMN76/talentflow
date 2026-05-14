/**
 * DSAR (Data Subject Access Request) service — Sprint Q2.3.
 *
 * AVG art. 12: betrokkenen hebben het recht binnen 30 dagen een
 * antwoord te krijgen op verzoeken om inzage, kopie, correctie of
 * verwijdering. Deze service registreert en beantwoordt die verzoeken.
 *
 * Vier verzoek-types:
 *   - access      — kandidaat wil weten welke gegevens we hebben (DSAR-info)
 *   - export      — kandidaat wil een kopie (machine-readable ZIP)
 *   - correction  — kandidaat vraagt aanpassing (recruiter beoordeelt)
 *   - deletion    — kandidaat vraagt "wis mij" (admin oordeelt; bij
 *                   fulfillment runnen we anonimisatie)
 *
 * Audit: élke transitie genereert een audit-event.
 */

import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import { logger } from '../../middleware/errorHandler';
import { getStorage } from '../../lib/storage';
import { anonymizeCandidatePermanently } from './anonymization.service';

// archiver wordt dynamisch geladen zodat een ontbrekende install niet
// het hele compliance-module-import laat falen. De ZIP-functie throwt
// dan een AppError 501.
type ArchiverModule = typeof import('archiver');
let cachedArchiver: ArchiverModule | null | undefined;
function loadArchiver(): ArchiverModule | null {
  if (cachedArchiver !== undefined) return cachedArchiver;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedArchiver = require('archiver') as ArchiverModule;
  } catch {
    cachedArchiver = null;
  }
  return cachedArchiver;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type DsarRequestType =
  | 'access'
  | 'export'
  | 'correction'
  | 'deletion';

export type DsarRequestedVia = 'self_portal' | 'email' | 'admin';

export type DsarStatus =
  | 'pending'
  | 'in_progress'
  | 'fulfilled'
  | 'rejected'
  | 'expired';

export interface DsarRequestRow {
  id: string;
  tenant_id: string;
  candidate_id: string | null;
  request_type: DsarRequestType;
  requested_via: DsarRequestedVia;
  requester_email: string;
  status: DsarStatus;
  response_url: string | null;
  fulfilled_at: string | null;
  fulfilled_by: string | null;
  notes: string | null;
  due_at: string;
  created_at: string;
}

export interface DsarFilter {
  status?: DsarStatus;
  candidate_id?: string;
  request_type?: DsarRequestType;
  /** ISO-string — only requests created on/after this. */
  created_since?: string;
}

export interface DsarFulfillmentInput {
  status?: 'fulfilled' | 'rejected' | 'in_progress';
  notes?: string;
  response_url?: string;
}

const DSAR_DUE_DAYS = 30;

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maak een nieuwe DSAR aan. `due_at` = nu + 30 dagen (AVG art. 12).
 * Schrijft een audit-event met action `dsar.requested`.
 */
export async function createDsarRequest(
  tenantId: string,
  candidateId: string | null,
  requestType: DsarRequestType,
  requesterEmail: string,
  source: DsarRequestedVia,
  notes?: string,
  ctx: AuditContext = {},
  userId: string | null = null
): Promise<DsarRequestRow> {
  if (!requesterEmail || !requesterEmail.includes('@')) {
    throw new AppError(
      400,
      'DSAR_EMAIL_INVALID',
      'Een geldig e-mailadres is verplicht voor een DSAR-verzoek'
    );
  }

  return withTenant(tenantId, async (client) => {
    const dueAt = new Date(Date.now() + DSAR_DUE_DAYS * 24 * 60 * 60 * 1000);
    const { rows } = await client.query<DsarRequestRow>(
      `INSERT INTO dsar_requests
         (tenant_id, candidate_id, request_type, requested_via,
          requester_email, status, notes, due_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
       RETURNING *`,
      [
        tenantId,
        candidateId,
        requestType,
        source,
        requesterEmail.toLowerCase(),
        notes ?? null,
        dueAt.toISOString(),
      ]
    );
    const created = rows[0];
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.DSAR_REQUESTED,
        entityType: 'dsar_request',
        entityId: created.id,
        after: {
          request_type: requestType,
          requested_via: source,
          candidate_id: candidateId,
          due_at: created.due_at,
        },
        userId,
      },
      ctx
    );
    return created;
  });
}

export async function listDsarRequests(
  tenantId: string,
  filters: DsarFilter = {}
): Promise<DsarRequestRow[]> {
  return withTenant(tenantId, async (client) => {
    const conditions: string[] = ['tenant_id = $1'];
    const values: unknown[] = [tenantId];
    let idx = 2;

    if (filters.status) {
      conditions.push(`status = $${idx++}`);
      values.push(filters.status);
    }
    if (filters.candidate_id) {
      conditions.push(`candidate_id = $${idx++}`);
      values.push(filters.candidate_id);
    }
    if (filters.request_type) {
      conditions.push(`request_type = $${idx++}`);
      values.push(filters.request_type);
    }
    if (filters.created_since) {
      conditions.push(`created_at >= $${idx++}`);
      values.push(filters.created_since);
    }

    const { rows } = await client.query<DsarRequestRow>(
      `SELECT * FROM dsar_requests
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC`,
      values
    );
    return rows;
  });
}

export async function getDsarRequest(
  tenantId: string,
  dsarId: string
): Promise<DsarRequestRow> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<DsarRequestRow>(
      `SELECT * FROM dsar_requests
        WHERE id = $1 AND tenant_id = $2`,
      [dsarId, tenantId]
    );
    if (!rows[0]) {
      throw new AppError(404, 'DSAR_NOT_FOUND', 'DSAR-verzoek niet gevonden');
    }
    return rows[0];
  });
}

/**
 * Mark een DSAR als afgehandeld of afgewezen. Bij `deletion` + status
 * `fulfilled` runnen we automatisch `anonymizeCandidatePermanently`.
 */
export async function fulfillDsarRequest(
  tenantId: string,
  dsarId: string,
  userId: string,
  response: DsarFulfillmentInput = {},
  ctx: AuditContext = {}
): Promise<DsarRequestRow> {
  const newStatus: DsarStatus = response.status ?? 'fulfilled';
  if (
    newStatus !== 'fulfilled' &&
    newStatus !== 'rejected' &&
    newStatus !== 'in_progress'
  ) {
    throw new AppError(
      400,
      'DSAR_STATUS_INVALID',
      `Ongeldige status: ${String(response.status)}`
    );
  }

  const existing = await getDsarRequest(tenantId, dsarId);
  if (existing.status === 'fulfilled' || existing.status === 'rejected') {
    throw new AppError(
      409,
      'DSAR_ALREADY_CLOSED',
      'Dit DSAR-verzoek is al afgehandeld'
    );
  }

  // Voor deletion-fulfillment voeren we eerst de anonimisatie uit.
  if (
    newStatus === 'fulfilled' &&
    existing.request_type === 'deletion' &&
    existing.candidate_id
  ) {
    await anonymizeCandidatePermanently(
      tenantId,
      existing.candidate_id,
      userId,
      ctx
    );
  }

  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<DsarRequestRow>(
      `UPDATE dsar_requests
          SET status = $1,
              notes = COALESCE($2, notes),
              response_url = COALESCE($3, response_url),
              fulfilled_at = CASE WHEN $1 IN ('fulfilled','rejected') THEN now() ELSE fulfilled_at END,
              fulfilled_by = CASE WHEN $1 IN ('fulfilled','rejected') THEN $4::uuid ELSE fulfilled_by END
        WHERE id = $5 AND tenant_id = $6
        RETURNING *`,
      [
        newStatus,
        response.notes ?? null,
        response.response_url ?? null,
        userId,
        dsarId,
        tenantId,
      ]
    );
    const updated = rows[0];

    await logAudit(
      client,
      tenantId,
      {
        action:
          newStatus === 'rejected'
            ? AuditActions.DSAR_REJECTED
            : AuditActions.DSAR_FULFILLED,
        entityType: 'dsar_request',
        entityId: dsarId,
        before: existing,
        after: updated,
        userId,
      },
      ctx
    );
    return updated;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Data export ZIP
// ─────────────────────────────────────────────────────────────────────────────

interface CandidateExportData {
  profile: Record<string, unknown> | null;
  applications: Record<string, unknown>[];
  communications: Record<string, unknown>[];
  consents: {
    gdpr_consent: boolean | null;
    gdpr_consent_at: string | null;
    email_consent: boolean | null;
    email_consent_at: string | null;
  };
  resumes: Array<{
    id: string;
    filename: string;
    storage_key: string | null;
    mime_type: string | null;
  }>;
  audit_trail: Record<string, unknown>[];
}

async function loadCandidateExportData(
  tenantId: string,
  candidateId: string
): Promise<CandidateExportData> {
  return withTenant(tenantId, async (client) => {
    const { rows: candidateRows } = await client.query(
      `SELECT * FROM candidates WHERE id = $1 AND tenant_id = $2`,
      [candidateId, tenantId]
    );
    const candidate = candidateRows[0];
    if (!candidate) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
    }

    const [
      { rows: applications },
      { rows: communications },
      { rows: resumes },
      { rows: auditTrail },
    ] = await Promise.all([
      client.query(
        `SELECT a.*, j.title AS job_title
           FROM applications a
           LEFT JOIN jobs j ON j.id = a.job_id
          WHERE a.candidate_id = $1 AND a.tenant_id = $2`,
        [candidateId, tenantId]
      ),
      client
        .query(
          `SELECT id, channel, direction, subject, body, status, sent_at, created_at
             FROM communications
            WHERE candidate_id = $1 AND tenant_id = $2`,
          [candidateId, tenantId]
        )
        .catch(() => ({ rows: [] as Record<string, unknown>[] })),
      client.query(
        `SELECT id, filename, storage_key, mime_type, size_bytes,
                is_primary, parsed_at, created_at, ai_summary
           FROM candidate_resumes
          WHERE candidate_id = $1 AND tenant_id = $2`,
        [candidateId, tenantId]
      ),
      client.query(
        `SELECT id, action, entity_type, entity_id, before, after, created_at
           FROM audit_events
          WHERE tenant_id = $1
            AND ((entity_type = 'candidate' AND entity_id = $2)
                 OR (entity_type = 'candidate_resume' AND entity_id IN
                     (SELECT id FROM candidate_resumes
                       WHERE candidate_id = $2 AND tenant_id = $1))
                )
          ORDER BY created_at ASC`,
        [tenantId, candidateId]
      ),
    ]);

    return {
      profile: candidate as Record<string, unknown>,
      applications: applications as Record<string, unknown>[],
      communications: communications as Record<string, unknown>[],
      consents: {
        gdpr_consent: (candidate as Record<string, unknown>).gdpr_consent as
          | boolean
          | null,
        gdpr_consent_at: (candidate as Record<string, unknown>)
          .gdpr_consent_at as string | null,
        email_consent: (candidate as Record<string, unknown>).email_consent as
          | boolean
          | null,
        email_consent_at: (candidate as Record<string, unknown>)
          .email_consent_at as string | null,
      },
      resumes: resumes as CandidateExportData['resumes'],
      audit_trail: auditTrail as Record<string, unknown>[],
    };
  });
}

/**
 * Bouw een ZIP met alle data voor de kandidaat:
 *   - profile.json
 *   - applications.json
 *   - communications.json
 *   - consents.json
 *   - audit-trail.json
 *   - resumes/<filename>   (origineel, niet geanonimiseerd — dit is
 *                           tenslotte de kopie die de kandidaat zelf
 *                           opvraagt)
 */
export async function generateDataExportZip(
  tenantId: string,
  candidateId: string,
  ctx: AuditContext = {},
  userId: string | null = null
): Promise<{ buffer: Buffer; filename: string }> {
  const archiverMod = loadArchiver();
  if (!archiverMod) {
    throw new AppError(
      501,
      'EXPORT_LIB_UNAVAILABLE',
      'ZIP-export-bibliotheek is niet beschikbaar — neem contact op met support'
    );
  }

  const data = await loadCandidateExportData(tenantId, candidateId);
  const storage = getStorage();

  // We vangen archiver-output op in een Buffer-collectie zodat we
  // synchroon een Buffer kunnen returnen. Voor MVP-volume (<100MB) is
  // dit acceptabel; bij grotere exports wordt dit een streaming-flow
  // naar S3 in een latere sprint.
  const chunks: Buffer[] = [];
  const archive = archiverMod('zip', { zlib: { level: 9 } });

  const done = new Promise<void>((resolve, reject) => {
    archive.on('data', (c: Buffer) => chunks.push(c));
    archive.on('warning', (err: Error & { code?: string }) => {
      if (err.code === 'ENOENT') {
        logger.warn('[dsar] archiver missing-file warning', { error: err.message });
      } else {
        reject(err);
      }
    });
    archive.on('error', (err: Error) => reject(err));
    archive.on('end', () => resolve());
  });

  archive.append(JSON.stringify(data.profile, null, 2), { name: 'profile.json' });
  archive.append(JSON.stringify(data.applications, null, 2), {
    name: 'applications.json',
  });
  archive.append(JSON.stringify(data.communications, null, 2), {
    name: 'communications.json',
  });
  archive.append(JSON.stringify(data.consents, null, 2), {
    name: 'consents.json',
  });
  archive.append(JSON.stringify(data.audit_trail, null, 2), {
    name: 'audit-trail.json',
  });

  // Resumes (originele bestanden). Best-effort: missende files loggen
  // we maar laten we de ZIP niet falen.
  for (const resume of data.resumes) {
    if (!resume.storage_key) continue;
    try {
      const stream = await storage.getStream(resume.storage_key);
      const buf: Buffer[] = [];
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        buf.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      archive.append(Buffer.concat(buf), {
        name: `resumes/${safeBaseName(resume.filename)}`,
      });
    } catch (err) {
      logger.warn('[dsar] resume file unavailable', {
        candidate_id: candidateId,
        resume_id: resume.id,
        error: (err as Error).message,
      });
    }
  }

  await archive.finalize();
  await done;

  const buffer = Buffer.concat(chunks);
  const filename = `dsar-${candidateId}-${new Date()
    .toISOString()
    .slice(0, 10)}.zip`;

  await withTenant(tenantId, async (client) => {
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.DATA_EXPORT_PACKAGE_GENERATED,
        entityType: 'candidate',
        entityId: candidateId,
        after: { filename, byte_size: buffer.length },
        userId,
      },
      ctx
    );
  });

  return { buffer, filename };
}

function safeBaseName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'resume.bin';
}

export const _internal = { DSAR_DUE_DAYS };
