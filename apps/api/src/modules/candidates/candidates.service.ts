import fs from 'fs';
import path from 'path';
import { PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { resumeParserQueue } from '../../queue/queues';
import { getStorage, buildResumeStorageKey } from '../../lib/storage';
import { emitWorkflowEvent } from '../workflows/workflowEmitter';
import { queueEmbedding } from '../matching/matchingEmitter';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import {
  generateCandidateReference,
  type CreateCandidateInput,
  type UpdateCandidateInput,
  type CreateCandidateSkillInput,
} from './candidates.schema';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full Manatal-parity column set on `candidates`. Used to build dynamic
 * INSERT/UPDATE statements without enumerating columns multiple times.
 * Order matches the migration for grep-ability.
 */
const MUTABLE_CANDIDATE_COLUMNS = [
  // Identity
  'name',
  'first_name',
  'last_name',
  'email',
  'phone',
  'candidate_reference',

  // Demographics
  'gender',
  'birthdate',
  'nationalities',
  'languages',

  // Work
  'notice_period',
  'current_salary',
  'current_salary_currency',
  'expected_salary',
  'expected_salary_currency',
  'current_benefits',
  'expected_benefits',
  'years_of_experience',
  'graduation_date',
  'current_department',
  'current_position',
  'current_company',
  'industry',

  // Education
  'diploma',
  'university',

  // Address
  'address_line1',
  'address_line2',
  'address_city',
  'address_country',
  'address_postal_code',

  // Extra contact
  'skype',
  'other_contact',

  // Free text / sourcing
  'description',
  'source',

  // GDPR / consent
  'gdpr_consent',
  'gdpr_consent_at',
  'email_consent',
  'email_consent_at',

  // Legacy
  'tags',
  'notes',
  'skills',
  'ai_score',
] as const;

type MutableCandidateColumn = (typeof MUTABLE_CANDIDATE_COLUMNS)[number];

const REFERENCE_RETRY_LIMIT = 1; // 1 retry on UNIQUE-violation, per spec

/** PostgreSQL unique-violation SQLSTATE. */
const PG_UNIQUE_VIOLATION = '23505';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

type AnyCandidatePayload = Record<string, unknown>;

/**
 * Normalises a write payload before it hits the DB:
 *   - sync `name` ⇄ `first_name + last_name` when only one side is supplied
 *   - default consent timestamps to now() when consent is granted but no
 *     timestamp is supplied
 *
 * Returns a shallow copy so callers can pass plain validated input. Typed as
 * a loose record because both Create- and Update-input shapes flow through
 * here and Update fields can be `null` while Create fields cannot.
 */
function normaliseCandidatePayload(
  input: CreateCandidateInput | UpdateCandidateInput
): AnyCandidatePayload {
  const data: AnyCandidatePayload = { ...input };

  // Name sync: build `name` from first+last when name is missing
  if (!data.name && data.first_name && data.last_name) {
    data.name = `${String(data.first_name)} ${String(data.last_name)}`.trim();
  }
  // The reverse split (name → first/last) is intentionally NOT done — too
  // unreliable for international names.

  // GDPR / email consent timestamps
  const nowIso = new Date().toISOString();
  if (data.gdpr_consent === true && !data.gdpr_consent_at) {
    data.gdpr_consent_at = nowIso;
  }
  if (data.email_consent === true && !data.email_consent_at) {
    data.email_consent_at = nowIso;
  }

  return data;
}

/**
 * Builds the (columns, placeholders, values) tuple for an INSERT from a
 * validated, normalised payload. Only includes keys that are explicitly
 * present (i.e. !== undefined) so we let DB defaults apply otherwise.
 */
function buildInsertColumns(
  data: Record<string, unknown>,
  startIndex: number
): { cols: string[]; placeholders: string[]; values: unknown[]; nextIndex: number } {
  const cols: string[] = [];
  const placeholders: string[] = [];
  const values: unknown[] = [];
  let idx = startIndex;

  for (const col of MUTABLE_CANDIDATE_COLUMNS) {
    if (data[col] === undefined) continue;
    cols.push(col);
    placeholders.push(`$${idx++}`);
    values.push(data[col] ?? null);
  }
  return { cols, placeholders, values, nextIndex: idx };
}

async function fetchSkillsForCandidate(
  client: PoolClient,
  candidateId: string,
  tenantId: string
) {
  const { rows } = await client.query(
    `SELECT id, candidate_id, skill, score, source, created_at
     FROM candidate_skills
     WHERE candidate_id = $1 AND tenant_id = $2
     ORDER BY skill ASC`,
    [candidateId, tenantId]
  );
  return rows;
}

export interface CandidateResumeRow {
  id: string;
  candidate_id: string;
  filename: string;
  storage_url: string;
  storage_key: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  is_primary: boolean;
  parsed_at: Date | null;
  ai_summary: string | null;
  parse_status: 'pending' | 'processing' | 'done' | 'failed';
  parse_error: string | null;
  created_at: Date;
}

async function fetchResumesForCandidate(
  client: PoolClient,
  candidateId: string,
  tenantId: string
): Promise<CandidateResumeRow[]> {
  const { rows } = await client.query(
    `SELECT id, candidate_id, filename, storage_url, storage_key,
            mime_type, size_bytes, is_primary, parsed_at,
            ai_summary, parse_status, parse_error, created_at
     FROM candidate_resumes
     WHERE candidate_id = $1 AND tenant_id = $2
     ORDER BY is_primary DESC, created_at DESC`,
    [candidateId, tenantId]
  );
  return rows as CandidateResumeRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// List
// ─────────────────────────────────────────────────────────────────────────────

export interface CandidateListOptions {
  page: number;
  limit: number;
  search?: string;
  skills?: string[];
  tags?: string[];
  source?: string;
}

export async function listCandidates(tenantId: string, opts: CandidateListOptions) {
  return withTenant(tenantId, async (client) => {
    const conditions: string[] = [`tenant_id = $1`, `deleted_at IS NULL`];
    const values: unknown[] = [tenantId];
    let idx = 2;

    if (opts.search) {
      conditions.push(
        `(name ILIKE $${idx} OR email ILIKE $${idx} OR candidate_reference ILIKE $${idx})`
      );
      values.push(`%${opts.search}%`);
      idx++;
    }

    if (opts.skills && opts.skills.length > 0) {
      conditions.push(`skills && $${idx}::text[]`);
      values.push(opts.skills);
      idx++;
    }

    if (opts.tags && opts.tags.length > 0) {
      conditions.push(`tags && $${idx}::text[]`);
      values.push(opts.tags);
      idx++;
    }

    if (opts.source) {
      conditions.push(`source = $${idx}`);
      values.push(opts.source);
      idx++;
    }

    const where = conditions.join(' AND ');
    const offset = (opts.page - 1) * opts.limit;

    const { rows: countRows } = await client.query(
      `SELECT COUNT(*) as total FROM candidates WHERE ${where}`,
      values
    );
    const total = parseInt(countRows[0].total, 10);

    const { rows } = await client.query(
      `SELECT id, candidate_reference, name, first_name, last_name,
              email, phone, resume_url, skills, ai_score, source,
              tags, current_department, industry, years_of_experience,
              address_city, address_country,
              gdpr_consent, email_consent,
              created_at, updated_at
       FROM candidates
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, opts.limit, offset]
    );

    return {
      data: rows,
      meta: {
        total,
        page: opts.page,
        limit: opts.limit,
        pages: Math.ceil(total / opts.limit),
      },
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────────

export async function createCandidate(
  tenantId: string,
  userId: string,
  input: CreateCandidateInput,
  ctx: AuditContext = {}
) {
  const data = normaliseCandidatePayload(input);

  const candidate = await withTenant(tenantId, async (client) => {
    const userSuppliedReference = data.candidate_reference !== undefined;
    const maxAttempts = REFERENCE_RETRY_LIMIT + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Auto-generate candidate_reference if not supplied
      const payload: Record<string, unknown> = { ...data };
      if (!payload.candidate_reference) {
        payload.candidate_reference = generateCandidateReference();
      }

      const { cols, placeholders, values } = buildInsertColumns(
        payload,
        2 // $1 is reserved for tenant_id
      );

      const allCols = ['tenant_id', ...cols];
      const allPlaceholders = ['$1', ...placeholders];
      const allValues = [tenantId, ...values];

      const sql = `INSERT INTO candidates (${allCols.join(', ')})
                   VALUES (${allPlaceholders.join(', ')})
                   RETURNING *`;

      try {
        const { rows: [candidate] } = await client.query(sql, allValues);

        await client.query(
          `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
           VALUES ($1, 'candidate', $2, $3, 'created', $4)`,
          [tenantId, candidate.id, userId, JSON.stringify({ name: candidate.name })]
        );

        // Append-only compliance audit (atomic met de hoofd-INSERT).
        await logAudit(
          client,
          tenantId,
          {
            action: AuditActions.CANDIDATE_CREATED,
            entityType: 'candidate',
            entityId: candidate.id,
            after: candidate,
            userId,
          },
          ctx
        );

        return candidate;
      } catch (err: unknown) {
        const e = err as { code?: string; constraint?: string };
        const isReferenceCollision =
          e.code === PG_UNIQUE_VIOLATION &&
          (e.constraint === 'uq_candidates_candidate_reference' ||
            (typeof e.constraint === 'string' && e.constraint.includes('candidate_reference')));

        // Retry only on auto-generated reference collisions.
        const canRetry =
          !userSuppliedReference && isReferenceCollision && attempt < maxAttempts - 1;
        if (canRetry) continue;
        throw err;
      }
    }

    // Unreachable in practice — the loop either returns or throws — but
    // keeps TypeScript's control-flow analysis happy.
    throw new AppError(
      409,
      'REFERENCE_COLLISION',
      'Kon geen unieke candidate_reference genereren'
    );
  });

  // Emit AFTER the transaction commits — if the insert rolled back we never
  // want a downstream workflow firing on a non-existent candidate.
  await emitWorkflowEvent(tenantId, 'candidate.created', candidate.id, {
    candidate,
    user_id: userId,
  });

  // Slice 4: queue embedding generation. Best-effort — geen blokker als de
  // queue tijdelijk niet beschikbaar is (queueEmbedding logt zelf).
  await queueEmbedding(tenantId, 'candidate', candidate.id);

  return candidate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Get (with skills + resumes)
// ─────────────────────────────────────────────────────────────────────────────

export async function getCandidate(tenantId: string, candidateId: string) {
  return withTenant(tenantId, async (client) => {
    const { rows: [candidate] } = await client.query(
      `SELECT * FROM candidates
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [candidateId, tenantId]
    );

    if (!candidate) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
    }

    // Hydrate sub-resources. NIET via Promise.all op dezelfde client: één
    // pg-client voert maar één query tegelijk uit, dus dat serialiseert tóch
    // en geeft een `client.query()`-DeprecationWarning. Sequentieel awaiten =
    // identiek resultaat, geen warning.
    const skillRows = await fetchSkillsForCandidate(client, candidateId, tenantId);
    const resumeRows = await fetchResumesForCandidate(client, candidateId, tenantId);
    const applicationRows = await client.query(
      `SELECT a.id, a.job_id, a.stage_id, a.status, a.applied_at, a.updated_at,
              j.title as job_title, ps.name as stage_name
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       LEFT JOIN pipeline_stages ps ON ps.id = a.stage_id
       WHERE a.candidate_id = $1 AND a.tenant_id = $2`,
      [candidateId, tenantId]
    );

    return {
      ...candidate,
      candidate_skills: skillRows,
      resumes: resumeRows,
      applications: applicationRows.rows,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Update
// ─────────────────────────────────────────────────────────────────────────────

export async function updateCandidate(
  tenantId: string,
  candidateId: string,
  userId: string,
  input: UpdateCandidateInput,
  ctx: AuditContext = {}
) {
  const data = normaliseCandidatePayload(input);

  const candidate = await withTenant(tenantId, async (client) => {
    // Volledig before-snapshot voor audit-trail. We pakken `*` zodat
    // forensische review later precies kan zien wat veranderde.
    const { rows: [existing] } = await client.query(
      `SELECT * FROM candidates WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [candidateId, tenantId]
    );
    if (!existing) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const col of MUTABLE_CANDIDATE_COLUMNS) {
      const key = col as MutableCandidateColumn;
      if ((data as Record<string, unknown>)[key] === undefined) continue;
      fields.push(`${col} = $${idx++}`);
      values.push((data as Record<string, unknown>)[key]);
    }

    if (fields.length === 0) {
      throw new AppError(400, 'NO_FIELDS', 'Geen velden om bij te werken');
    }

    fields.push(`updated_at = now()`);
    values.push(candidateId, tenantId);

    const { rows: [updated] } = await client.query(
      `UPDATE candidates SET ${fields.join(', ')}
       WHERE id = $${idx++} AND tenant_id = $${idx}
       RETURNING *`,
      values
    );

    await client.query(
      `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
       VALUES ($1, 'candidate', $2, $3, 'updated', $4)`,
      [tenantId, candidateId, userId, JSON.stringify(data)]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.CANDIDATE_UPDATED,
        entityType: 'candidate',
        entityId: candidateId,
        before: existing,
        after: updated,
        userId,
      },
      ctx
    );

    // ─── Consent-deltas (Q1.2 follow-up) ──────────────────────────────
    // We schrijven ÉXTRA audit-rijen (naast de generieke candidate.updated)
    // wanneer gdpr_consent of email_consent kantelen. Q2 bouwt een
    // consent-management UI; tot die tijd hebben we al per-veld bewijs
    // dat consent is gegeven of ingetrokken.
    const consentFields: Array<['gdpr_consent' | 'email_consent', string]> = [
      ['gdpr_consent', 'gdpr_consent_at'],
      ['email_consent', 'email_consent_at'],
    ];
    for (const [field, atField] of consentFields) {
      const beforeVal = (existing as Record<string, unknown>)[field];
      const afterVal = (updated as Record<string, unknown>)[field];
      if (beforeVal === afterVal) continue;
      // Granted: false/null → true. Withdrawn: true → false/null.
      const granted = afterVal === true && beforeVal !== true;
      const withdrawn = beforeVal === true && afterVal !== true;
      if (!granted && !withdrawn) continue;
      await logAudit(
        client,
        tenantId,
        {
          action: granted
            ? AuditActions.CONSENT_GRANTED
            : AuditActions.CONSENT_WITHDRAWN,
          entityType: 'candidate',
          entityId: candidateId,
          before: { [field]: beforeVal },
          after: {
            [field]: afterVal,
            [atField]: (updated as Record<string, unknown>)[atField] ?? null,
            consent_type: field === 'gdpr_consent' ? 'gdpr' : 'email',
          },
          userId,
        },
        ctx
      );
    }

    return updated;
  });

  // Slice 4: na commit, queue embedding-regeneratie. We doen dit altijd na
  // een update — bepalen welk veld "relevant" is wordt een onderhoudsdrama;
  // de embedding-worker is goedkoop genoeg om hier overbodig te draaien.
  await queueEmbedding(tenantId, 'candidate', candidateId);

  return candidate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete (soft)
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteCandidate(
  tenantId: string,
  candidateId: string,
  userId: string,
  ctx: AuditContext = {}
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    // Snapshot vóór soft-delete — we hebben dit nodig in de audit-row
    // omdat na de UPDATE deleted_at IS NOT NULL en het record in de UI
    // niet meer leesbaar is.
    const { rows: [existing] } = await client.query(
      `SELECT * FROM candidates WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [candidateId, tenantId]
    );
    if (!existing) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
    }

    const { rows: [candidate] } = await client.query(
      `UPDATE candidates SET deleted_at = now()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [candidateId, tenantId]
    );

    if (!candidate) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
    }

    await client.query(
      `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
       VALUES ($1, 'candidate', $2, $3, 'deleted', '{}')`,
      [tenantId, candidateId, userId]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.CANDIDATE_DELETED,
        entityType: 'candidate',
        entityId: candidateId,
        before: existing,
        after: null,
        userId,
      },
      ctx
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Resume upload (legacy single-resume path) — kept for backwards compat
// ─────────────────────────────────────────────────────────────────────────────

export async function uploadResume(
  tenantId: string,
  candidateId: string,
  userId: string,
  file: Express.Multer.File
): Promise<{ resume_url: string; resume_id: string }> {
  return withTenant(tenantId, async (client) => {
    const { rows: [existing] } = await client.query(
      `SELECT id FROM candidates WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [candidateId, tenantId]
    );
    if (!existing) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
    }

    // Generate identifiers and storage key
    const resumeId = uuidv4();
    const storage = getStorage();
    const storageKey = buildResumeStorageKey(
      tenantId,
      candidateId,
      resumeId,
      file.originalname
    );

    // Read the multer-disk temp file into memory and hand off to the storage driver.
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(file.path);
    } catch (err) {
      throw new AppError(
        500,
        'RESUME_READ_FAILED',
        'Kon geuploade bestand niet lezen',
        { error: (err as Error).message }
      );
    }

    await storage.put(storageKey, buffer, file.mimetype);

    // Best-effort cleanup of multer temp file.
    try {
      fs.unlinkSync(file.path);
    } catch {
      /* ignore — temp dir is sweepable */
    }

    const resumeUrl = await storage.getDownloadUrl(storageKey);

    // Update legacy single-resume column for backwards-compat.
    await client.query(
      `UPDATE candidates SET resume_url = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3`,
      [resumeUrl, candidateId, tenantId]
    );

    // Demote any existing primary resume so the partial unique index doesn't bite.
    await client.query(
      `UPDATE candidate_resumes SET is_primary = FALSE
       WHERE candidate_id = $1 AND tenant_id = $2 AND is_primary = TRUE`,
      [candidateId, tenantId]
    );

    // Insert into candidate_resumes as the primary CV with the explicit resumeId.
    await client.query(
      `INSERT INTO candidate_resumes
         (id, tenant_id, candidate_id, filename, storage_url, storage_key,
          mime_type, size_bytes, is_primary, parse_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, 'pending')`,
      [
        resumeId,
        tenantId,
        candidateId,
        file.originalname,
        resumeUrl,
        storageKey,
        file.mimetype,
        file.size,
      ]
    );

    // Queue async parsing job — new contract.
    await resumeParserQueue.add('parse-resume', {
      resumeId,
      candidateId,
      tenantId,
      storageKey,
      mimeType: file.mimetype,
      filename: file.originalname,
    });

    await client.query(
      `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
       VALUES ($1, 'candidate', $2, $3, 'resume_uploaded', $4)`,
      [
        tenantId,
        candidateId,
        userId,
        JSON.stringify({ filename: file.originalname, resume_id: resumeId }),
      ]
    );

    return { resume_url: resumeUrl, resume_id: resumeId };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline
// ─────────────────────────────────────────────────────────────────────────────

export async function getCandidateTimeline(tenantId: string, candidateId: string) {
  return withTenant(tenantId, async (client) => {
    const { rows: [candidate] } = await client.query(
      `SELECT id FROM candidates WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [candidateId, tenantId]
    );
    if (!candidate) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
    }

    const { rows } = await client.query(
      `SELECT a.id, a.action, a.payload, a.created_at,
              u.name as user_name, u.email as user_email
       FROM activities a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.entity_type = 'candidate' AND a.entity_id = $1 AND a.tenant_id = $2
       ORDER BY a.created_at DESC`,
      [candidateId, tenantId]
    );

    return rows;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Skills
// ─────────────────────────────────────────────────────────────────────────────

async function ensureCandidateExists(
  client: PoolClient,
  candidateId: string,
  tenantId: string
): Promise<void> {
  const { rows: [row] } = await client.query(
    `SELECT id FROM candidates WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [candidateId, tenantId]
  );
  if (!row) {
    throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
  }
}

export async function listCandidateSkills(tenantId: string, candidateId: string) {
  return withTenant(tenantId, async (client) => {
    await ensureCandidateExists(client, candidateId, tenantId);
    return fetchSkillsForCandidate(client, candidateId, tenantId);
  });
}

export async function addCandidateSkill(
  tenantId: string,
  candidateId: string,
  userId: string,
  data: CreateCandidateSkillInput
) {
  return withTenant(tenantId, async (client) => {
    await ensureCandidateExists(client, candidateId, tenantId);

    try {
      const { rows: [skill] } = await client.query(
        `INSERT INTO candidate_skills (tenant_id, candidate_id, skill, score, source)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, candidate_id, skill, score, source, created_at`,
        [
          tenantId,
          candidateId,
          data.skill,
          data.score ?? null,
          data.source ?? 'manual',
        ]
      );

      await client.query(
        `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
         VALUES ($1, 'candidate', $2, $3, 'skill_added', $4)`,
        [tenantId, candidateId, userId, JSON.stringify({ skill: data.skill, score: data.score ?? null })]
      );

      return skill;
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === PG_UNIQUE_VIOLATION) {
        throw new AppError(409, 'SKILL_DUPLICATE', 'Deze skill bestaat al voor de kandidaat');
      }
      throw err;
    }
  });
}

export async function deleteCandidateSkill(
  tenantId: string,
  candidateId: string,
  skillId: string,
  userId: string
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    await ensureCandidateExists(client, candidateId, tenantId);

    const { rows: [skill] } = await client.query(
      `DELETE FROM candidate_skills
       WHERE id = $1 AND candidate_id = $2 AND tenant_id = $3
       RETURNING id, skill`,
      [skillId, candidateId, tenantId]
    );

    if (!skill) {
      throw new AppError(404, 'SKILL_NOT_FOUND', 'Skill niet gevonden voor deze kandidaat');
    }

    await client.query(
      `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
       VALUES ($1, 'candidate', $2, $3, 'skill_removed', $4)`,
      [tenantId, candidateId, userId, JSON.stringify({ skill: skill.skill })]
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Resumes (read-only here; uploads land in Slice 2)
// ─────────────────────────────────────────────────────────────────────────────

export async function listCandidateResumes(tenantId: string, candidateId: string) {
  return withTenant(tenantId, async (client) => {
    await ensureCandidateExists(client, candidateId, tenantId);
    return fetchResumesForCandidate(client, candidateId, tenantId);
  });
}

/**
 * Multi-CV upload. Stores each file via the storage driver, persists a
 * `candidate_resumes` row per file with parse_status='pending', enqueues
 * a parse job per resume, and optionally promotes the first upload to
 * primary if the candidate doesn't already have one.
 */
export async function uploadCandidateResumes(
  tenantId: string,
  candidateId: string,
  userId: string,
  files: Express.Multer.File[],
  setFirstAsPrimary: boolean
): Promise<CandidateResumeRow[]> {
  if (!files || files.length === 0) {
    throw new AppError(400, 'NO_FILES', 'Geen bestanden geuploaded');
  }

  return withTenant(tenantId, async (client) => {
    await ensureCandidateExists(client, candidateId, tenantId);

    // Determine current primary state once, before inserting anything.
    const { rows: primaryRows } = await client.query(
      `SELECT id FROM candidate_resumes
       WHERE candidate_id = $1 AND tenant_id = $2 AND is_primary = TRUE
       LIMIT 1`,
      [candidateId, tenantId]
    );
    const hasPrimary = primaryRows.length > 0;
    const shouldPromoteFirst = setFirstAsPrimary && !hasPrimary;

    const storage = getStorage();
    const inserted: CandidateResumeRow[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const resumeId = uuidv4();
      const storageKey = buildResumeStorageKey(
        tenantId,
        candidateId,
        resumeId,
        file.originalname
      );

      // Read multer temp file -> hand to storage -> cleanup temp.
      let buffer: Buffer;
      try {
        buffer = fs.readFileSync(file.path);
      } catch (err) {
        throw new AppError(
          500,
          'RESUME_READ_FAILED',
          'Kon geuploade bestand niet lezen',
          { error: (err as Error).message, filename: file.originalname }
        );
      }

      await storage.put(storageKey, buffer, file.mimetype);

      try {
        fs.unlinkSync(file.path);
      } catch {
        /* ignore — temp dir is sweepable */
      }

      const downloadUrl = await storage.getDownloadUrl(storageKey);
      const isPrimary = shouldPromoteFirst && i === 0;

      const { rows: [row] } = await client.query(
        `INSERT INTO candidate_resumes
           (id, tenant_id, candidate_id, filename, storage_url, storage_key,
            mime_type, size_bytes, is_primary, parse_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
         RETURNING id, candidate_id, filename, storage_url, storage_key,
                   mime_type, size_bytes, is_primary, parsed_at,
                   ai_summary, parse_status, parse_error, created_at`,
        [
          resumeId,
          tenantId,
          candidateId,
          file.originalname,
          downloadUrl,
          storageKey,
          file.mimetype,
          file.size,
          isPrimary,
        ]
      );

      inserted.push(row as CandidateResumeRow);

      // Enqueue parse job — CONTRACT for resumeParser.worker.
      await resumeParserQueue.add('parse-resume', {
        resumeId,
        candidateId,
        tenantId,
        storageKey,
        mimeType: file.mimetype,
        filename: file.originalname,
      });

      await client.query(
        `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
         VALUES ($1, 'candidate', $2, $3, 'resume_uploaded', $4)`,
        [
          tenantId,
          candidateId,
          userId,
          JSON.stringify({
            filename: file.originalname,
            resume_id: resumeId,
            is_primary: isPrimary,
          }),
        ]
      );
    }

    return inserted;
  });
}

/**
 * Delete a single resume: remove the storage object then the DB row.
 * If the deleted resume was the primary, promote the most-recent remaining
 * resume to primary so the candidate always has one when at least one CV exists.
 */
export async function deleteCandidateResume(
  tenantId: string,
  candidateId: string,
  resumeId: string,
  userId: string
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    await ensureCandidateExists(client, candidateId, tenantId);

    const { rows: [row] } = await client.query(
      `SELECT id, storage_key, storage_url, filename, is_primary
       FROM candidate_resumes
       WHERE id = $1 AND candidate_id = $2 AND tenant_id = $3`,
      [resumeId, candidateId, tenantId]
    );

    if (!row) {
      throw new AppError(404, 'RESUME_NOT_FOUND', 'CV niet gevonden voor deze kandidaat');
    }

    // Best-effort: delete from storage. If this fails we still remove the DB row,
    // because a dangling object is preferable to an orphan row that the user
    // cannot get rid of.
    if (row.storage_key) {
      const storage = getStorage();
      try {
        await storage.delete(row.storage_key);
      } catch (err) {
        // Logged; we continue with DB delete.
        // eslint-disable-next-line no-console
        console.warn('[candidates] storage.delete failed', {
          resumeId,
          error: (err as Error).message,
        });
      }
    }

    await client.query(
      `DELETE FROM candidate_resumes
       WHERE id = $1 AND candidate_id = $2 AND tenant_id = $3`,
      [resumeId, candidateId, tenantId]
    );

    // If we removed the primary, promote the most recent remaining CV.
    if (row.is_primary) {
      const { rows: [next] } = await client.query(
        `SELECT id FROM candidate_resumes
         WHERE candidate_id = $1 AND tenant_id = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [candidateId, tenantId]
      );
      if (next) {
        await client.query(
          `UPDATE candidate_resumes SET is_primary = TRUE
           WHERE id = $1 AND tenant_id = $2`,
          [next.id, tenantId]
        );
      }
    }

    await client.query(
      `INSERT INTO activities (tenant_id, entity_type, entity_id, user_id, action, payload)
       VALUES ($1, 'candidate', $2, $3, 'resume_deleted', $4)`,
      [
        tenantId,
        candidateId,
        userId,
        JSON.stringify({ resume_id: resumeId, filename: row.filename }),
      ]
    );
  });
}

/**
 * Switch which CV is the primary for this candidate. Done in a single DB
 * round-trip set: demote-all + promote-one. Both run inside the
 * `withTenant` transaction so the partial unique index `uq_candidate_resumes_primary`
 * never sees two TRUE rows simultaneously.
 */
export async function setPrimaryResume(
  tenantId: string,
  candidateId: string,
  resumeId: string
): Promise<void> {
  return withTenant(tenantId, async (client) => {
    await ensureCandidateExists(client, candidateId, tenantId);

    const { rows: [row] } = await client.query(
      `SELECT id FROM candidate_resumes
       WHERE id = $1 AND candidate_id = $2 AND tenant_id = $3`,
      [resumeId, candidateId, tenantId]
    );
    if (!row) {
      throw new AppError(404, 'RESUME_NOT_FOUND', 'CV niet gevonden voor deze kandidaat');
    }

    await client.query(
      `UPDATE candidate_resumes SET is_primary = FALSE
       WHERE candidate_id = $1 AND tenant_id = $2 AND is_primary = TRUE`,
      [candidateId, tenantId]
    );
    await client.query(
      `UPDATE candidate_resumes SET is_primary = TRUE
       WHERE id = $1 AND candidate_id = $2 AND tenant_id = $3`,
      [resumeId, candidateId, tenantId]
    );
  });
}

/**
 * Returns a download URL for the resume. For local disk that's the static
 * `/uploads/...` path; for S3 it's a presigned URL.
 */
export async function getResumeDownloadUrl(
  tenantId: string,
  candidateId: string,
  resumeId: string
): Promise<string> {
  return withTenant(tenantId, async (client) => {
    await ensureCandidateExists(client, candidateId, tenantId);

    const { rows: [row] } = await client.query(
      `SELECT id, storage_key, storage_url
       FROM candidate_resumes
       WHERE id = $1 AND candidate_id = $2 AND tenant_id = $3`,
      [resumeId, candidateId, tenantId]
    );
    if (!row) {
      throw new AppError(404, 'RESUME_NOT_FOUND', 'CV niet gevonden voor deze kandidaat');
    }

    // Legacy rows pre-dating migration 003 may have NULL storage_key. Fall
    // back to the legacy storage_url which is already a usable static path.
    if (!row.storage_key) {
      return row.storage_url as string;
    }

    const storage = getStorage();
    return storage.getDownloadUrl(row.storage_key);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk actions (Sprint Q1.2)
// ─────────────────────────────────────────────────────────────────────────────

export type BulkActionType =
  | 'archive'
  | 'add_tag'
  | 'remove_tag'
  | 'change_source';

export interface BulkActionPayload {
  tag?: string;
  source?: string;
}

export interface BulkActionResult {
  affected: number;
}

const VALID_BULK_ACTIONS: BulkActionType[] = [
  'archive',
  'add_tag',
  'remove_tag',
  'change_source',
];

/**
 * Apply an action to a list of candidates in one transaction. The endpoint
 * wrapper (Agent AA) wraps this with auth + zod validation. We always log
 * exactly one BULK_ACTION_PERFORMED audit event with the affected ids in
 * `after` so a single audit row covers the full bulk operation.
 */
export async function bulkAction(
  tenantId: string,
  userId: string,
  ids: string[],
  action: BulkActionType,
  payload: BulkActionPayload = {},
  ctx: AuditContext = {}
): Promise<BulkActionResult> {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError(400, 'NO_IDS', 'ids mag niet leeg zijn');
  }
  if (ids.length > 1000) {
    throw new AppError(400, 'TOO_MANY_IDS', 'Maximaal 1000 ids per bulk-actie');
  }
  if (!VALID_BULK_ACTIONS.includes(action)) {
    throw new AppError(400, 'INVALID_ACTION', `Onbekende bulk-actie: ${action}`);
  }

  return withTenant(tenantId, async (client) => {
    let affected = 0;

    switch (action) {
      case 'archive': {
        const { rowCount } = await client.query(
          `UPDATE candidates SET deleted_at = now()
           WHERE id = ANY($1::uuid[]) AND tenant_id = $2 AND deleted_at IS NULL`,
          [ids, tenantId]
        );
        affected = rowCount ?? 0;
        break;
      }
      case 'add_tag': {
        if (!payload.tag) throw new AppError(400, 'MISSING_TAG', 'payload.tag is verplicht');
        const { rowCount } = await client.query(
          `UPDATE candidates
           SET tags = (
             SELECT array_agg(DISTINCT t)
             FROM unnest(coalesce(tags, '{}'::text[]) || ARRAY[$1]::text[]) AS t
           ),
               updated_at = now()
           WHERE id = ANY($2::uuid[]) AND tenant_id = $3 AND deleted_at IS NULL`,
          [payload.tag, ids, tenantId]
        );
        affected = rowCount ?? 0;
        break;
      }
      case 'remove_tag': {
        if (!payload.tag) throw new AppError(400, 'MISSING_TAG', 'payload.tag is verplicht');
        const { rowCount } = await client.query(
          `UPDATE candidates
           SET tags = array_remove(coalesce(tags, '{}'::text[]), $1),
               updated_at = now()
           WHERE id = ANY($2::uuid[]) AND tenant_id = $3 AND deleted_at IS NULL`,
          [payload.tag, ids, tenantId]
        );
        affected = rowCount ?? 0;
        break;
      }
      case 'change_source': {
        if (!payload.source) {
          throw new AppError(400, 'MISSING_SOURCE', 'payload.source is verplicht');
        }
        const { rowCount } = await client.query(
          `UPDATE candidates SET source = $1, updated_at = now()
           WHERE id = ANY($2::uuid[]) AND tenant_id = $3 AND deleted_at IS NULL`,
          [payload.source, ids, tenantId]
        );
        affected = rowCount ?? 0;
        break;
      }
    }

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.BULK_ACTION_PERFORMED,
        entityType: 'candidate',
        entityId: null,
        after: { bulk_action: action, ids, payload, affected },
        userId,
      },
      ctx
    );

    return { affected };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom-fields hydration on getCandidate (Sprint Q1.2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wrapper voor getCandidate die custom_fields hydrateert. We laten de bestaande
 * getCandidate-functie ongewijzigd zodat alle bestaande call-sites (en tests)
 * blijven werken; deze nieuwe variant is wat de controller in Q1.2 gebruikt.
 *
 * Strategy: bij elke get hydrateren — kosten zijn 1 extra JOIN-query. Lazy/
 * conditioneel loaden is een latere optimalisatie zodra een kandidaat 50+
 * custom-field-values heeft.
 */
export async function getCandidateWithCustomFields(
  tenantId: string,
  candidateId: string
): Promise<Record<string, unknown>> {
  const candidate = await getCandidate(tenantId, candidateId);
  // Lazy import om circulaire imports te vermijden — custom-fields module mag
  // niet aan candidates hangen omdat het zélf naar audit/sentry/db verwijst.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getValuesForEntity } = require('../custom-fields/customFields.service') as
    typeof import('../custom-fields/customFields.service');
  const customFields = await getValuesForEntity(tenantId, 'candidate', candidateId);
  return { ...candidate, custom_fields: customFields };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline templates (system + tenant-scoped)
// ─────────────────────────────────────────────────────────────────────────────

export async function listPipelineTemplates(tenantId: string) {
  return withTenant(tenantId, async (client) => {
    const { rows: templates } = await client.query(
      `SELECT id, tenant_id, name, description, is_default, is_system,
              created_at, updated_at
       FROM pipeline_templates
       WHERE tenant_id IS NULL OR tenant_id = $1
       ORDER BY is_system DESC, is_default DESC, name ASC`,
      [tenantId]
    );

    if (templates.length === 0) return [];

    const ids = templates.map((t) => t.id);
    const { rows: stages } = await client.query(
      `SELECT id, template_id, name, position, color, created_at
       FROM pipeline_template_stages
       WHERE template_id = ANY($1::uuid[])
       ORDER BY template_id, position`,
      [ids]
    );

    const stagesByTemplate = new Map<string, typeof stages>();
    for (const s of stages) {
      const arr = stagesByTemplate.get(s.template_id) ?? [];
      arr.push(s);
      stagesByTemplate.set(s.template_id, arr);
    }

    return templates.map((t) => ({
      ...t,
      stages: stagesByTemplate.get(t.id) ?? [],
    }));
  });
}
