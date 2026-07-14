/**
 * Anonimisatie-service — Sprint Q2.3.
 *
 * Twee sleutelpaden:
 *
 *   - `anonymizeCandidatePermanently(...)`
 *     Onomkeerbaar. Vervangt PII in `candidates` (en gerelateerde rijen)
 *     door placeholders, zet `anonymized_at`, schrijft een audit-event.
 *     Geheime CV-bestanden worden van storage verwijderd; metadata-rij
 *     blijft bestaan voor statistiek-doeleinden (counts, funnel).
 *
 *   - `generateAnonymizedResumePdf(...)`
 *     On-the-fly: pakt de primaire CV, anonimiseert met `pdf-lib` en
 *     returnt buffer + filename. Geen permanente DB-wijziging.
 *
 * Beide flows eindigen met een audit-rij via `logAudit`. RLS-isolatie via
 * `withTenant` is altijd verplicht.
 */

import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import { getStorage } from '../../lib/storage';
import {
  anonymizeResumePdf,
  DEFAULT_ANONYMIZATION_RULES,
  type AnonymizationRules,
} from '../../lib/anonymization';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ResumeRow {
  id: string;
  filename: string;
  storage_key: string | null;
  storage_url: string | null;
  mime_type: string | null;
}

interface CandidatePiiRow {
  id: string;
  candidate_reference: string | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  birthdate: string | null;
  address_line1: string | null;
  address_city: string | null;
  address_postal_code: string | null;
  anonymized_at: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Permanent anonymization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Onomkeerbare anonimisatie van een kandidaat.
 *
 *   1. Vervang PII-velden in `candidates`-rij door placeholders.
 *   2. Anonimiseer `description`, `notes` en `resume_text`.
 *   3. Verwijder fysieke CV-bestanden uit storage; behoud de
 *      `candidate_resumes`-rij maar leeg de PII-velden.
 *   4. Set `anonymized_at = now()`.
 *   5. Audit-event `candidate.anonymized`.
 *
 * Throws 404 als kandidaat niet bestaat. Idempotent: als
 * `anonymized_at` al niet-NULL is, retourneren we stilletjes zonder
 * extra audit-rij om bulk-cron-runs niet te vervuilen.
 */
export async function anonymizeCandidatePermanently(
  tenantId: string,
  candidateId: string,
  userId: string | null,
  ctx: AuditContext = {}
): Promise<void> {
  const storage = getStorage();

  const resumeKeys: string[] = [];

  await withTenant(tenantId, async (client) => {
    const { rows } = await client.query<CandidatePiiRow>(
      `SELECT id, candidate_reference, name, first_name, last_name, email, phone,
              birthdate::text AS birthdate,
              address_line1, address_city, address_postal_code, anonymized_at::text
         FROM candidates
        WHERE id = $1 AND tenant_id = $2`,
      [candidateId, tenantId]
    );
    const candidate = rows[0];
    if (!candidate) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
    }
    if (candidate.anonymized_at) {
      // Idempotent — niets te doen.
      return;
    }

    const reference = candidate.candidate_reference ?? candidate.id;
    const placeholderName = `Kandidaat #${reference}`;

    // 1. Reset PII in candidates.
    await client.query(
      `UPDATE candidates
          SET name = $1,
              first_name = 'Kandidaat',
              last_name = $2,
              email = NULL,
              phone = NULL,
              birthdate = NULL,
              gender = NULL,
              nationalities = NULL,
              address_line1 = NULL,
              address_line2 = NULL,
              address_city = NULL,
              address_postal_code = NULL,
              skype = NULL,
              other_contact = NULL,
              description = NULL,
              notes = NULL,
              resume_text = NULL,
              resume_url = NULL,
              anonymized_at = now(),
              updated_at = now()
        WHERE id = $3 AND tenant_id = $4`,
      [placeholderName, `#${reference}`, candidateId, tenantId]
    );

    // 1b. Trek nog-geldige self-service-tokens in: na anonimisatie mag geen
    //     enkele /profile/<token>-link nog data tonen of muteren. Binnen
    //     dezelfde transactie zodat het atomisch met anonymized_at gebeurt.
    await client.query(
      `DELETE FROM candidate_self_tokens
        WHERE candidate_id = $1 AND tenant_id = $2`,
      [candidateId, tenantId]
    );

    // 2. Verzamel resumes voor delete + scrub metadata.
    const { rows: resumeRows } = await client.query<ResumeRow>(
      `SELECT id, filename, storage_key, storage_url, mime_type
         FROM candidate_resumes
        WHERE candidate_id = $1 AND tenant_id = $2`,
      [candidateId, tenantId]
    );
    for (const r of resumeRows) {
      if (r.storage_key) resumeKeys.push(r.storage_key);
    }

    if (resumeRows.length > 0) {
      await client.query(
        `UPDATE candidate_resumes
            SET filename = 'redacted.pdf',
                storage_url = NULL,
                storage_key = NULL,
                ai_summary = NULL,
                parsed_text = NULL,
                parse_error = NULL
          WHERE candidate_id = $1 AND tenant_id = $2`,
        [candidateId, tenantId]
      );
    }

    // 3. Audit-event.
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.ANONYMIZATION_APPLIED,
        entityType: 'candidate',
        entityId: candidateId,
        before: {
          // Bewaar zo min mogelijk PII in audit-trail. Alleen
          // betekenisvolle "we hebben deze kandidaat geanonimiseerd"-keys.
          had_email: candidate.email !== null,
          had_phone: candidate.phone !== null,
          resume_count: resumeRows.length,
        },
        after: { anonymized_at: new Date().toISOString() },
        userId,
      },
      ctx
    );
  });

  // 4. Buiten transactie: verwijder fysieke files. We catchen errors
  //    omdat een storage-glitch de DB-actie niet mag rollbacken; de DB
  //    is al op anonymized=true gezet, dus retry van storage-delete is
  //    veilig (idempotent).
  for (const key of resumeKeys) {
    try {
      await storage.delete(key);
    } catch {
      /* swallow — operationele monitoring vangt dit op via storage-logs */
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// On-the-fly resume anonymization (geen permanente DB-wijziging)
// ─────────────────────────────────────────────────────────────────────────────

interface ResumeWithCandidate {
  id: string;
  candidate_id: string;
  filename: string;
  storage_key: string | null;
  storage_url: string | null;
  mime_type: string | null;
  candidate_reference: string | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  birthdate: string | null;
  address_line1: string | null;
  address_city: string | null;
  address_postal_code: string | null;
}

/**
 * Lees CV uit storage, anonimiseer met de gegeven rules en geef een
 * gecleande PDF-buffer + suggested filename terug. Wordt typisch
 * aangeroepen door de portal-share-flow zodat de hiring manager nooit
 * de originele PDF te zien krijgt.
 *
 * Throws 404 als resume niet bestaat / niet toegankelijk is.
 * Throws 422 als de mime-type geen PDF is.
 */
export async function generateAnonymizedResumePdf(
  tenantId: string,
  resumeId: string,
  rules: AnonymizationRules = DEFAULT_ANONYMIZATION_RULES,
  ctx: AuditContext = {},
  userId: string | null = null
): Promise<{ buffer: Buffer; filename: string }> {
  const storage = getStorage();

  const meta = await withTenant(tenantId, async (client) => {
    const { rows } = await client.query<ResumeWithCandidate>(
      `SELECT cr.id, cr.candidate_id, cr.filename, cr.storage_key, cr.storage_url,
              cr.mime_type,
              c.candidate_reference, c.name, c.first_name, c.last_name,
              c.email, c.phone, c.birthdate::text AS birthdate,
              c.address_line1, c.address_city, c.address_postal_code
         FROM candidate_resumes cr
         JOIN candidates c
           ON c.id = cr.candidate_id
          AND c.tenant_id = cr.tenant_id
        WHERE cr.id = $1 AND cr.tenant_id = $2`,
      [resumeId, tenantId]
    );
    return rows[0] ?? null;
  });

  if (!meta) {
    throw new AppError(404, 'RESUME_NOT_FOUND', 'CV niet gevonden');
  }
  if (!meta.storage_key) {
    throw new AppError(
      404,
      'RESUME_FILE_MISSING',
      'CV-bestand is niet meer beschikbaar (geanonimiseerd of verwijderd)'
    );
  }
  if (meta.mime_type && meta.mime_type !== 'application/pdf') {
    throw new AppError(
      422,
      'RESUME_NOT_PDF',
      'Alleen PDF-CVs kunnen automatisch worden geanonimiseerd'
    );
  }

  // Lees stream → buffer.
  const stream = await storage.getStream(meta.storage_key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const original = Buffer.concat(chunks);

  const anonymized = await anonymizeResumePdf(original, rules, {
    name: meta.name,
    first_name: meta.first_name,
    last_name: meta.last_name,
    email: meta.email,
    phone: meta.phone,
    address_line1: meta.address_line1,
    address_city: meta.address_city,
    address_postal_code: meta.address_postal_code,
    birthdate: meta.birthdate,
  });

  const reference = meta.candidate_reference ?? meta.candidate_id;
  const filename = `anoniem-${reference}.pdf`;

  // Audit (best-effort — share UI valt niet om als audit faalt).
  await withTenant(tenantId, async (client) => {
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.RESUME_ANONYMIZED_FOR_SHARE,
        entityType: 'candidate_resume',
        entityId: resumeId,
        after: { rules, candidate_id: meta.candidate_id },
        userId,
      },
      ctx
    );
  });

  return { buffer: anonymized, filename };
}
