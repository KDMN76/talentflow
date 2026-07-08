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

import { randomBytes, createHash } from 'crypto';
import { withTenant, withAuthTx } from '../../db/pool';
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
  scorecards: Record<string, unknown>[];
  ai_events: Record<string, unknown>[];
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

/**
 * Kolommen die we bewust NIET meesturen in de export: interne
 * ML-representaties zijn geen leesbare persoonsgegevens (AVG art. 15
 * vraagt om een "kopie van de persoonsgegevens", niet om vector-blobs)
 * en blazen het bestand enorm op.
 */
const PROFILE_EXCLUDED_KEYS = new Set(['embedding', 'embedding_updated_at']);

function stripExcludedProfileKeys(
  candidate: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(candidate)) {
    if (!PROFILE_EXCLUDED_KEYS.has(k)) out[k] = v;
  }
  return out;
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
    const candidate = candidateRows[0] as Record<string, unknown> | undefined;
    if (!candidate) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
    }

    // Sequentieel i.p.v. Promise.all: alle queries delen dezelfde pg-client,
    // die maar één query tegelijk aankan — parallel uitvoeren serialiseert tóch
    // en triggert de `client.query()`-DeprecationWarning. Resultaat identiek.
    const { rows: applications } = await client.query(
      `SELECT a.*, j.title AS job_title
         FROM applications a
         LEFT JOIN jobs j ON j.id = a.job_id
        WHERE a.candidate_id = $1 AND a.tenant_id = $2`,
      [candidateId, tenantId]
    );
    const { rows: communications } = await client
      .query(
        `SELECT id, channel, direction, subject, body, status, sent_at, created_at
           FROM communications
          WHERE candidate_id = $1 AND tenant_id = $2`,
        [candidateId, tenantId]
      )
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));
    const { rows: resumes } = await client.query(
      `SELECT id, filename, storage_key, mime_type, size_bytes,
              is_primary, parsed_at, created_at, ai_summary
         FROM candidate_resumes
        WHERE candidate_id = $1 AND tenant_id = $2`,
      [candidateId, tenantId]
    );
    const { rows: auditTrail } = await client.query(
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
    );

    // Scorecards over de sollicitaties van deze kandidaat — beoordelingen
    // zijn persoonsgegevens (AVG art. 15 lid 1) en horen dus in de kopie.
    const { rows: scorecards } = await client
      .query(
        `SELECT sc.id, sc.application_id, j.title AS job_title,
                sc.overall_score, sc.recommendation, sc.notes,
                sc.criteria_scores, sc.submitted_at, sc.created_at
           FROM scorecards sc
           JOIN applications a
             ON a.id = sc.application_id AND a.tenant_id = sc.tenant_id
           LEFT JOIN jobs j ON j.id = a.job_id
          WHERE a.candidate_id = $1 AND sc.tenant_id = $2
          ORDER BY sc.created_at ASC`,
        [candidateId, tenantId]
      )
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));

    // AI-events over de kandidaat (EU AI Act / AVG art. 15 lid 1h —
    // transparantie over geautomatiseerde verwerking). We nemen events op
    // die direct op de kandidaat slaan én events op zijn/haar sollicitaties.
    // Bewust ZONDER input_hash/kosten-kolommen: die zeggen de betrokkene
    // niets en zijn intern.
    const { rows: aiEvents } = await client
      .query(
        `SELECT id, feature, model, provider, output_summary,
                entity_type, entity_id, status, created_at
           FROM ai_events
          WHERE tenant_id = $1
            AND ((entity_type = 'candidate' AND entity_id = $2)
                 OR (entity_type = 'application' AND entity_id IN
                     (SELECT id FROM applications
                       WHERE candidate_id = $2 AND tenant_id = $1))
                )
          ORDER BY created_at ASC`,
        [tenantId, candidateId]
      )
      .catch(() => ({ rows: [] as Record<string, unknown>[] }));

    return {
      profile: stripExcludedProfileKeys(candidate),
      applications: applications as Record<string, unknown>[],
      communications: communications as Record<string, unknown>[],
      scorecards: scorecards as Record<string, unknown>[],
      ai_events: aiEvents as Record<string, unknown>[],
      consents: {
        gdpr_consent: candidate.gdpr_consent as boolean | null,
        gdpr_consent_at: candidate.gdpr_consent_at as string | null,
        email_consent: candidate.email_consent as boolean | null,
        email_consent_at: candidate.email_consent_at as string | null,
      },
      resumes: resumes as CandidateExportData['resumes'],
      audit_trail: auditTrail as Record<string, unknown>[],
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Leesbare variant (AVG art. 12 lid 1: "beknopte, transparante, begrijpelijke
// en gemakkelijk toegankelijke vorm") — platte tekst naast de JSON-bestanden.
// ─────────────────────────────────────────────────────────────────────────────

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Ja' : 'Nee';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function renderReadableExport(data: CandidateExportData): string {
  const lines: string[] = [];
  const hr = '─'.repeat(72);

  lines.push('KOPIE PERSOONSGEGEVENS — AVG ARTIKEL 15');
  lines.push(`Gegenereerd op: ${new Date().toISOString()}`);
  lines.push(
    'Dit document is de leesbare samenvatting; de bijgevoegde JSON-bestanden'
  );
  lines.push('bevatten dezelfde gegevens in machine-leesbare vorm.');
  lines.push(hr);

  lines.push('');
  lines.push('1. PROFIELGEGEVENS');
  lines.push(hr);
  for (const [key, value] of Object.entries(data.profile ?? {})) {
    lines.push(`  ${key}: ${fmtValue(value)}`);
  }

  lines.push('');
  lines.push(`2. SOLLICITATIES (${data.applications.length})`);
  lines.push(hr);
  if (data.applications.length === 0) lines.push('  Geen sollicitaties.');
  for (const app of data.applications) {
    lines.push(
      `  • ${fmtValue(app.job_title)} — status: ${fmtValue(app.status)}, ` +
        `gesolliciteerd: ${fmtValue(app.applied_at ?? app.created_at)}`
    );
  }

  lines.push('');
  lines.push(`3. COMMUNICATIE (${data.communications.length})`);
  lines.push(hr);
  if (data.communications.length === 0) lines.push('  Geen communicatie.');
  for (const c of data.communications) {
    lines.push(
      `  • [${fmtValue(c.channel)}/${fmtValue(c.direction)}] ` +
        `${fmtValue(c.subject)} — ${fmtValue(c.sent_at ?? c.created_at)}`
    );
  }

  lines.push('');
  lines.push(`4. BEOORDELINGEN / SCORECARDS (${data.scorecards.length})`);
  lines.push(hr);
  if (data.scorecards.length === 0) lines.push('  Geen beoordelingen.');
  for (const sc of data.scorecards) {
    lines.push(
      `  • ${fmtValue(sc.job_title)} — score: ${fmtValue(sc.overall_score)}, ` +
        `aanbeveling: ${fmtValue(sc.recommendation)}, ` +
        `ingediend: ${fmtValue(sc.submitted_at)}`
    );
    if (sc.notes) lines.push(`    notities: ${fmtValue(sc.notes)}`);
  }

  lines.push('');
  lines.push(`5. AI-VERWERKINGEN (${data.ai_events.length})`);
  lines.push(hr);
  lines.push(
    '  Geautomatiseerde verwerkingen waarbij jouw gegevens zijn gebruikt'
  );
  lines.push('  (AVG art. 15 lid 1h / EU AI Act transparantie):');
  if (data.ai_events.length === 0) lines.push('  Geen AI-verwerkingen.');
  for (const ev of data.ai_events) {
    lines.push(
      `  • ${fmtValue(ev.feature)} (${fmtValue(ev.model)}) — ` +
        `${fmtValue(ev.created_at)}: ${fmtValue(ev.output_summary)}`
    );
  }

  lines.push('');
  lines.push('6. TOESTEMMINGEN');
  lines.push(hr);
  lines.push(`  AVG-toestemming: ${fmtValue(data.consents.gdpr_consent)}` +
    ` (per: ${fmtValue(data.consents.gdpr_consent_at)})`);
  lines.push(`  E-mail-toestemming: ${fmtValue(data.consents.email_consent)}` +
    ` (per: ${fmtValue(data.consents.email_consent_at)})`);

  lines.push('');
  lines.push(`7. CV-BESTANDEN (${data.resumes.length})`);
  lines.push(hr);
  if (data.resumes.length === 0) lines.push('  Geen CV-bestanden.');
  for (const r of data.resumes) {
    lines.push(`  • ${r.filename} — zie map resumes/ in deze ZIP`);
  }

  lines.push('');
  lines.push(`8. VERWERKINGSHISTORIE / AUDIT-TRAIL (${data.audit_trail.length} events)`);
  lines.push(hr);
  lines.push('  Zie audit-trail.json voor de volledige historie.');
  lines.push('');

  return lines.join('\n');
}

/**
 * Bouw een ZIP met alle data voor de kandidaat:
 *   - overzicht.txt        (leesbare variant — AVG art. 12 lid 1)
 *   - profile.json
 *   - applications.json
 *   - communications.json
 *   - scorecards.json
 *   - ai-events.json
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

  archive.append(renderReadableExport(data), { name: 'overzicht.txt' });
  archive.append(JSON.stringify(data.profile, null, 2), { name: 'profile.json' });
  archive.append(JSON.stringify(data.applications, null, 2), {
    name: 'applications.json',
  });
  archive.append(JSON.stringify(data.communications, null, 2), {
    name: 'communications.json',
  });
  archive.append(JSON.stringify(data.scorecards, null, 2), {
    name: 'scorecards.json',
  });
  archive.append(JSON.stringify(data.ai_events, null, 2), {
    name: 'ai-events.json',
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

// ─────────────────────────────────────────────────────────────────────────────
// Export-download-tokens (migration 046) — AVG art. 15 download-links
//
// Flow: recruiter/kandidaat vraagt een export aan → we maken een opaque
// token (32 bytes hex) met korte TTL en download-limiet → de publieke
// endpoint `/api/gdpr-export/:token` valideert en streamt de ZIP.
//
// At rest slaan we — net als password_reset_tokens (041) — alléén de
// sha256-hash van het token op (kolom `token_hash`). De raw token zit enkel
// in de download-URL; een DB-lek geeft dus geen bruikbare download-links.
// De lookup zoekt op sha256(incoming).
// ─────────────────────────────────────────────────────────────────────────────

const EXPORT_TOKEN_BYTES = 32;
const EXPORT_TOKEN_TTL_HOURS = 24;
const EXPORT_TOKEN_MAX_DOWNLOADS = 3;

/** sha256-hash van een export-token (hex). Alleen de hash wordt opgeslagen. */
function hashExportToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface DataExportLinkResult {
  token: string;
  url: string;
  expires_at: string;
}

interface ExportTokenRow {
  id: string;
  tenant_id: string;
  candidate_id: string;
  dsar_id: string | null;
  expires_at: string;
  max_downloads: number;
  download_count: number;
}

function buildExportDownloadUrl(token: string): string {
  const base =
    process.env.PUBLIC_API_URL?.replace(/\/$/, '') ?? 'http://localhost:4000';
  return `${base}/api/gdpr-export/${token}`;
}

/**
 * Maak een kort-levende download-link voor het AVG-dossier van een
 * kandidaat. Audit: `data_export_link.created` (zonder PII — alleen
 * dsar_id/expiry/limiet).
 *
 * Throws 404 als de kandidaat niet bestaat, 409 als de kandidaat al
 * geanonimiseerd is (er valt niets meer te exporteren).
 */
export async function createDataExportLink(
  tenantId: string,
  candidateId: string,
  opts: { dsarId?: string | null; userId?: string | null; ctx?: AuditContext } = {}
): Promise<DataExportLinkResult> {
  const token = randomBytes(EXPORT_TOKEN_BYTES).toString('hex');
  const tokenHash = hashExportToken(token);
  const expiresAt = new Date(
    Date.now() + EXPORT_TOKEN_TTL_HOURS * 60 * 60 * 1000
  );

  await withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT anonymized_at FROM candidates WHERE id = $1 AND tenant_id = $2`,
      [candidateId, tenantId]
    );
    if (!rows[0]) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
    }
    if (rows[0].anonymized_at) {
      throw new AppError(
        409,
        'CANDIDATE_ANONYMIZED',
        'Deze kandidaat is geanonimiseerd — er zijn geen persoonsgegevens meer om te exporteren'
      );
    }

    await client.query(
      `INSERT INTO data_export_tokens
         (tenant_id, candidate_id, dsar_id, token_hash, expires_at,
          max_downloads, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tenantId,
        candidateId,
        opts.dsarId ?? null,
        tokenHash,
        expiresAt.toISOString(),
        EXPORT_TOKEN_MAX_DOWNLOADS,
        opts.userId ?? null,
      ]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.DATA_EXPORT_LINK_CREATED,
        entityType: 'candidate',
        entityId: candidateId,
        after: {
          dsar_id: opts.dsarId ?? null,
          expires_at: expiresAt.toISOString(),
          max_downloads: EXPORT_TOKEN_MAX_DOWNLOADS,
        },
        userId: opts.userId ?? null,
      },
      opts.ctx ?? {}
    );
  });

  return {
    token,
    url: buildExportDownloadUrl(token),
    expires_at: expiresAt.toISOString(),
  };
}

/**
 * Valideer een export-token en lever de ZIP. Publieke flow (geen JWT):
 * de token-lookup draait zonder tenant-context via de auth_context-
 * carve-out (zelfde vorm als password-reset, migration 046); alle
 * vervolg-queries zijn tenant-scoped via de tenant_id uit de token-rij.
 *
 * Throws 404 (onbekend token), 410 (verlopen of download-limiet bereikt).
 */
export async function downloadDataExportByToken(
  token: string,
  ctx: AuditContext = {}
): Promise<{ buffer: Buffer; filename: string }> {
  const tokenHash = hashExportToken(token);
  const row = await withAuthTx(
    async (client) => {
      const { rows } = await client.query<ExportTokenRow>(
        `SELECT id, tenant_id, candidate_id, dsar_id,
                expires_at::text, max_downloads, download_count
           FROM data_export_tokens
          WHERE token_hash = $1`,
        [tokenHash]
      );
      return rows[0] ?? null;
    },
    { authContext: true }
  );

  if (!row) {
    throw new AppError(
      404,
      'EXPORT_TOKEN_INVALID',
      'Deze download-link is ongeldig'
    );
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new AppError(
      410,
      'EXPORT_TOKEN_EXPIRED',
      'Deze download-link is verlopen — vraag een nieuwe export aan'
    );
  }
  if (row.download_count >= row.max_downloads) {
    throw new AppError(
      410,
      'EXPORT_TOKEN_EXHAUSTED',
      'Het maximale aantal downloads voor deze link is bereikt — vraag een nieuwe export aan'
    );
  }

  // Teller bumpen met een guard tegen races: als twee downloads tegelijk
  // binnenkomen wint er precies één per resterende download-slot.
  const bumped = await withTenant(row.tenant_id, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE data_export_tokens
          SET download_count = download_count + 1,
              last_downloaded_at = now()
        WHERE id = $1 AND download_count < max_downloads`,
      [row.id]
    );
    return (rowCount ?? 0) > 0;
  });
  if (!bumped) {
    throw new AppError(
      410,
      'EXPORT_TOKEN_EXHAUSTED',
      'Het maximale aantal downloads voor deze link is bereikt — vraag een nieuwe export aan'
    );
  }

  const { buffer, filename } = await generateDataExportZip(
    row.tenant_id,
    row.candidate_id,
    ctx,
    null
  );

  await withTenant(row.tenant_id, async (client) => {
    await logAudit(
      client,
      row.tenant_id,
      {
        action: AuditActions.DATA_EXPORT_PACKAGE_DOWNLOADED,
        entityType: 'candidate',
        entityId: row.candidate_id,
        after: {
          dsar_id: row.dsar_id,
          download_number: row.download_count + 1,
          max_downloads: row.max_downloads,
        },
        userId: null,
      },
      ctx
    );
  });

  return { buffer, filename };
}

export const _internal = {
  DSAR_DUE_DAYS,
  EXPORT_TOKEN_TTL_HOURS,
  EXPORT_TOKEN_MAX_DOWNLOADS,
  loadCandidateExportData,
  renderReadableExport,
  stripExcludedProfileKeys,
};
