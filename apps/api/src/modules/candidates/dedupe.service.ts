/**
 * Candidate de-duplication.
 *
 * Detection (`findDuplicatesForCandidate`):
 *   - exact email      → confidence 1.0
 *   - exact phone      → confidence 0.9
 *   - name + company   → confidence 0.7  (lowercased trim, both must match)
 *
 * Merge (`mergeCandidates`):
 *   - Re-points all references on the duplicate(s) to the primary:
 *       applications, activities, candidate_skills, candidate_resumes,
 *       custom_field_values, scorecards (none — applications already pointed),
 *       communications (best-effort table check).
 *   - Soft-deletes the duplicate candidates (deleted_at = now()).
 *   - Optional `field_choices` merges chosen scalar values from duplicate
 *     into primary BEFORE soft-delete (e.g. keep the duplicate's email).
 *   - Wraps everything in one withTenant transaction → atomic.
 *   - Logs one CANDIDATE_MERGED audit per duplicate so the trail is granular.
 */

import { PoolClient } from 'pg';
import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';

export type DedupeMatchReason = 'email' | 'phone' | 'name+company';

export interface DedupeMatch {
  candidate_id: string;
  candidate_name: string;
  match_reason: DedupeMatchReason;
  confidence: number;
}

export interface MergeInput {
  primary_id: string;
  duplicate_ids: string[];
  field_choices: Record<string, 'primary' | 'duplicate'>;
}

export interface MergeResult {
  merged_into: string;
  merged_count: number;
}

// Tabellen waar we candidate-FK's moeten her-pointen bij merge. Per item een
// best-effort flag: als de tabel (nog) niet bestaat, slaan we 'm over zodat
// dedupe ook werkt vóór alle migraties.
interface FkTable {
  table: string;
  column: string;
  required: boolean; // when false, we tolerate "table doesn't exist"
}

const REPOINT_TABLES: FkTable[] = [
  { table: 'applications', column: 'candidate_id', required: true },
  { table: 'activities', column: 'entity_id', required: false }, // entity_type='candidate'
  { table: 'candidate_skills', column: 'candidate_id', required: false },
  { table: 'candidate_resumes', column: 'candidate_id', required: false },
  { table: 'communications', column: 'candidate_id', required: false },
  { table: 'notes', column: 'candidate_id', required: false },
  { table: 'tags_candidates', column: 'candidate_id', required: false },
];

// Custom-field values are stored generically — re-point with extra entity_type guard.
const CUSTOM_FIELDS_TABLE = 'custom_field_values';

// ────────────────────────────────────────────────────────────────────────────
// Detection
// ────────────────────────────────────────────────────────────────────────────

export async function findDuplicatesForCandidate(
  tenantId: string,
  candidateId: string
): Promise<DedupeMatch[]> {
  return withTenant(tenantId, async (client) => {
    const { rows: src } = await client.query(
      `SELECT id, name, email, phone, current_company
       FROM candidates
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [candidateId, tenantId]
    );
    if (src.length === 0) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
    }
    const c = src[0] as {
      id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      current_company: string | null;
    };

    const matches = new Map<string, DedupeMatch>();

    // Email match
    if (c.email) {
      const { rows } = await client.query(
        `SELECT id, name FROM candidates
         WHERE tenant_id = $1
           AND id <> $2
           AND deleted_at IS NULL
           AND lower(email) = lower($3)`,
        [tenantId, candidateId, c.email]
      );
      for (const r of rows as Array<{ id: string; name: string | null }>) {
        addMatch(matches, r.id, r.name ?? '', 'email', 1.0);
      }
    }

    // Phone match — normalise spaces/dashes for comparison
    if (c.phone) {
      const normalisedPhone = c.phone.replace(/[\s\-().]/g, '');
      const { rows } = await client.query(
        `SELECT id, name FROM candidates
         WHERE tenant_id = $1
           AND id <> $2
           AND deleted_at IS NULL
           AND regexp_replace(coalesce(phone, ''), '[\\s\\-().]', '', 'g') = $3`,
        [tenantId, candidateId, normalisedPhone]
      );
      for (const r of rows as Array<{ id: string; name: string | null }>) {
        addMatch(matches, r.id, r.name ?? '', 'phone', 0.9);
      }
    }

    // Name + company match
    if (c.name && c.current_company) {
      const { rows } = await client.query(
        `SELECT id, name FROM candidates
         WHERE tenant_id = $1
           AND id <> $2
           AND deleted_at IS NULL
           AND lower(trim(name)) = lower(trim($3))
           AND lower(trim(coalesce(current_company, ''))) = lower(trim($4))`,
        [tenantId, candidateId, c.name, c.current_company]
      );
      for (const r of rows as Array<{ id: string; name: string | null }>) {
        addMatch(matches, r.id, r.name ?? '', 'name+company', 0.7);
      }
    }

    return Array.from(matches.values()).sort((a, b) => b.confidence - a.confidence);
  });
}

function addMatch(
  map: Map<string, DedupeMatch>,
  id: string,
  name: string,
  reason: DedupeMatchReason,
  confidence: number
): void {
  const existing = map.get(id);
  if (!existing || existing.confidence < confidence) {
    map.set(id, { candidate_id: id, candidate_name: name, match_reason: reason, confidence });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Merge
// ────────────────────────────────────────────────────────────────────────────

async function tableExists(client: PoolClient, name: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = $1 LIMIT 1`,
    [name]
  );
  return rows.length > 0;
}

export async function mergeCandidates(
  tenantId: string,
  userId: string,
  input: MergeInput,
  ctx: AuditContext = {}
): Promise<MergeResult> {
  if (!input.primary_id) {
    throw new AppError(400, 'MISSING_PRIMARY', 'primary_id is verplicht');
  }
  if (!Array.isArray(input.duplicate_ids) || input.duplicate_ids.length === 0) {
    throw new AppError(400, 'MISSING_DUPLICATES', 'duplicate_ids mag niet leeg zijn');
  }
  if (input.duplicate_ids.includes(input.primary_id)) {
    throw new AppError(400, 'INVALID_INPUT', 'primary_id mag niet in duplicate_ids voorkomen');
  }

  return withTenant(tenantId, async (client) => {
    // Fetch primary + duplicates (all in same query → 1 round-trip)
    const all = [input.primary_id, ...input.duplicate_ids];
    const { rows: candidates } = await client.query(
      `SELECT * FROM candidates
       WHERE id = ANY($1::uuid[]) AND tenant_id = $2 AND deleted_at IS NULL`,
      [all, tenantId]
    );

    const byId = new Map(
      (candidates as Array<Record<string, unknown> & { id: string }>).map((c) => [c.id, c])
    );
    const primary = byId.get(input.primary_id);
    if (!primary) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Primaire kandidaat niet gevonden');
    }
    for (const did of input.duplicate_ids) {
      if (!byId.has(did)) {
        throw new AppError(404, 'CANDIDATE_NOT_FOUND', `Duplicate ${did} niet gevonden`);
      }
    }

    // Apply field-choices BEFORE re-pointing FKs. We only allow scalar fields.
    if (Object.keys(input.field_choices).length > 0) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      let idx = 1;

      for (const [field, choice] of Object.entries(input.field_choices)) {
        if (choice !== 'duplicate') continue;
        // Pak de eerste duplicate die het veld gevuld heeft.
        let chosenValue: unknown = null;
        for (const did of input.duplicate_ids) {
          const dup = byId.get(did);
          if (dup && dup[field] !== null && dup[field] !== undefined) {
            chosenValue = dup[field];
            break;
          }
        }
        if (chosenValue === null) continue;
        sets.push(`${field} = $${idx++}`);
        vals.push(chosenValue);
      }

      if (sets.length > 0) {
        sets.push(`updated_at = now()`);
        vals.push(input.primary_id, tenantId);
        await client.query(
          `UPDATE candidates SET ${sets.join(', ')}
           WHERE id = $${idx++} AND tenant_id = $${idx}`,
          vals
        );
      }
    }

    // Re-point FKs per table per duplicate.
    for (const fk of REPOINT_TABLES) {
      const exists = await tableExists(client, fk.table);
      if (!exists) {
        if (fk.required) {
          throw new AppError(
            500,
            'SCHEMA_MISSING',
            `Verplichte tabel ${fk.table} ontbreekt`
          );
        }
        continue;
      }

      // 'activities' uses entity_type='candidate' + entity_id=candidate_id
      const extraGuard = fk.table === 'activities' ? `AND entity_type = 'candidate'` : '';

      for (const did of input.duplicate_ids) {
        // Best-effort: een column kan ontbreken. Laat de query falen-stil
        // zodat rare schemas dedupe niet blokkeren.
        try {
          await client.query(
            `UPDATE ${fk.table}
             SET ${fk.column} = $1
             WHERE ${fk.column} = $2 AND tenant_id = $3 ${extraGuard}`,
            [input.primary_id, did, tenantId]
          );
        } catch (err: unknown) {
          // Bij een UNIQUE-violation (bv. applications heeft UNIQUE(tenant_id,
          // job_id, candidate_id)) verwijderen we de duplicate rij — primary
          // had die job-applicatie al.
          const e = err as { code?: string };
          if (e.code === '23505') {
            await client.query(
              `DELETE FROM ${fk.table}
               WHERE ${fk.column} = $1 AND tenant_id = $2 ${extraGuard}`,
              [did, tenantId]
            );
          } else {
            throw err;
          }
        }
      }
    }

    // Custom-field values: extra entity_type guard
    if (await tableExists(client, CUSTOM_FIELDS_TABLE)) {
      for (const did of input.duplicate_ids) {
        try {
          await client.query(
            `UPDATE ${CUSTOM_FIELDS_TABLE}
             SET entity_id = $1
             WHERE entity_id = $2 AND tenant_id = $3 AND entity_type = 'candidate'`,
            [input.primary_id, did, tenantId]
          );
        } catch (err: unknown) {
          const e = err as { code?: string };
          if (e.code === '23505') {
            // Primary heeft die custom-field-value al — drop duplicate's value.
            await client.query(
              `DELETE FROM ${CUSTOM_FIELDS_TABLE}
               WHERE entity_id = $1 AND tenant_id = $2 AND entity_type = 'candidate'`,
              [did, tenantId]
            );
          } else {
            throw err;
          }
        }
      }
    }

    // Soft-delete duplicates + audit per duplicate
    for (const did of input.duplicate_ids) {
      await client.query(
        `UPDATE candidates SET deleted_at = now()
         WHERE id = $1 AND tenant_id = $2`,
        [did, tenantId]
      );

      await logAudit(
        client,
        tenantId,
        {
          action: AuditActions.CANDIDATE_MERGED,
          entityType: 'candidate',
          entityId: did,
          before: byId.get(did),
          after: { merged_into: input.primary_id },
          userId,
        },
        ctx
      );
    }

    return {
      merged_into: input.primary_id,
      merged_count: input.duplicate_ids.length,
    };
  });
}
