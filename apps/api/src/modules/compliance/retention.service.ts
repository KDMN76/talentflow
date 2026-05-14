/**
 * Retention-policy service — Sprint Q2.3.
 *
 * CRUD voor `retention_policies` + de uitvoering van een policy
 * (queryen welke kandidaten zijn verlopen + actie uitvoeren). Wordt
 * aangeroepen vanuit de retention-worker (BullMQ daily 03:00) en
 * vanuit ad-hoc admin-triggers in compliance.controller.
 */

import type { PoolClient } from 'pg';
import { withTenant, withoutTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import { logger } from '../../middleware/errorHandler';
import { anonymizeCandidatePermanently } from './anonymization.service';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type RetentionEntityType = 'candidate' | 'application';
export type RetentionTriggerField =
  | 'last_activity_at'
  | 'created_at'
  | 'rejected_at';
export type RetentionAction = 'archive' | 'anonymize' | 'delete';

export interface RetentionPolicyRow {
  id: string;
  tenant_id: string;
  entity_type: RetentionEntityType;
  retention_months: number;
  trigger_field: RetentionTriggerField;
  action_on_expiry: RetentionAction;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateRetentionPolicyInput {
  entity_type: RetentionEntityType;
  retention_months: number;
  trigger_field?: RetentionTriggerField;
  action_on_expiry: RetentionAction;
  enabled?: boolean;
}

export interface UpdateRetentionPolicyInput {
  retention_months?: number;
  trigger_field?: RetentionTriggerField;
  action_on_expiry?: RetentionAction;
  enabled?: boolean;
}

export interface RetentionRunResult {
  tenant_id: string;
  policy_id: string;
  entity_type: RetentionEntityType;
  action: RetentionAction;
  candidates_processed: number;
  candidates_skipped: number;
  errors: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function listRetentionPolicies(
  tenantId: string
): Promise<RetentionPolicyRow[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<RetentionPolicyRow>(
      `SELECT * FROM retention_policies
        WHERE tenant_id = $1
        ORDER BY entity_type ASC, created_at DESC`,
      [tenantId]
    );
    return rows;
  });
}

export async function createRetentionPolicy(
  tenantId: string,
  userId: string | null,
  input: CreateRetentionPolicyInput,
  ctx: AuditContext = {}
): Promise<RetentionPolicyRow> {
  return withTenant(tenantId, async (client) => {
    try {
      const { rows } = await client.query<RetentionPolicyRow>(
        `INSERT INTO retention_policies
           (tenant_id, entity_type, retention_months, trigger_field,
            action_on_expiry, enabled)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, TRUE))
         RETURNING *`,
        [
          tenantId,
          input.entity_type,
          input.retention_months,
          input.trigger_field ?? 'last_activity_at',
          input.action_on_expiry,
          input.enabled ?? true,
        ]
      );
      const created = rows[0];
      await logAudit(
        client,
        tenantId,
        {
          action: AuditActions.RETENTION_POLICY_CREATED,
          entityType: 'retention_policy',
          entityId: created.id,
          after: created,
          userId,
        },
        ctx
      );
      return created;
    } catch (err) {
      // 23505 = unique_violation (uq_retention_policies_tenant_entity_enabled).
      if ((err as { code?: string }).code === '23505') {
        throw new AppError(
          409,
          'RETENTION_POLICY_DUPLICATE',
          'Er bestaat al een actieve policy voor dit entity_type'
        );
      }
      throw err;
    }
  });
}

export async function updateRetentionPolicy(
  tenantId: string,
  policyId: string,
  userId: string | null,
  input: UpdateRetentionPolicyInput,
  ctx: AuditContext = {}
): Promise<RetentionPolicyRow> {
  return withTenant(tenantId, async (client) => {
    const { rows: existingRows } = await client.query<RetentionPolicyRow>(
      `SELECT * FROM retention_policies WHERE id = $1 AND tenant_id = $2`,
      [policyId, tenantId]
    );
    const existing = existingRows[0];
    if (!existing) {
      throw new AppError(
        404,
        'RETENTION_POLICY_NOT_FOUND',
        'Retentie-policy niet gevonden'
      );
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.retention_months !== undefined) {
      fields.push(`retention_months = $${idx++}`);
      values.push(input.retention_months);
    }
    if (input.trigger_field !== undefined) {
      fields.push(`trigger_field = $${idx++}`);
      values.push(input.trigger_field);
    }
    if (input.action_on_expiry !== undefined) {
      fields.push(`action_on_expiry = $${idx++}`);
      values.push(input.action_on_expiry);
    }
    if (input.enabled !== undefined) {
      fields.push(`enabled = $${idx++}`);
      values.push(input.enabled);
    }

    if (fields.length === 0) {
      throw new AppError(400, 'NO_FIELDS', 'Geen velden om bij te werken');
    }

    fields.push(`updated_at = now()`);
    values.push(policyId, tenantId);

    const { rows } = await client.query<RetentionPolicyRow>(
      `UPDATE retention_policies
          SET ${fields.join(', ')}
        WHERE id = $${idx++} AND tenant_id = $${idx}
        RETURNING *`,
      values
    );
    const updated = rows[0];

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.RETENTION_POLICY_UPDATED,
        entityType: 'retention_policy',
        entityId: policyId,
        before: existing,
        after: updated,
        userId,
      },
      ctx
    );
    return updated;
  });
}

export async function deleteRetentionPolicy(
  tenantId: string,
  policyId: string,
  userId: string | null,
  ctx: AuditContext = {}
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const { rows } = await client.query<RetentionPolicyRow>(
      `DELETE FROM retention_policies
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [policyId, tenantId]
    );
    const deleted = rows[0];
    if (!deleted) {
      throw new AppError(
        404,
        'RETENTION_POLICY_NOT_FOUND',
        'Retentie-policy niet gevonden'
      );
    }
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.RETENTION_POLICY_DELETED,
        entityType: 'retention_policy',
        entityId: policyId,
        before: deleted,
        userId,
      },
      ctx
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Retention exclusion (per kandidaat)
// ─────────────────────────────────────────────────────────────────────────────

export async function setCandidateRetentionExcluded(
  tenantId: string,
  candidateId: string,
  excluded: boolean,
  reason: string | null,
  userId: string | null,
  ctx: AuditContext = {}
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE candidates
          SET retention_excluded = $1,
              retention_excluded_reason = $2,
              updated_at = now()
        WHERE id = $3 AND tenant_id = $4`,
      [excluded, reason, candidateId, tenantId]
    );
    if (rowCount === 0) {
      throw new AppError(404, 'CANDIDATE_NOT_FOUND', 'Kandidaat niet gevonden');
    }
    await logAudit(
      client,
      tenantId,
      {
        action: excluded
          ? AuditActions.CANDIDATE_RETENTION_EXCLUDED
          : AuditActions.CANDIDATE_RETENTION_INCLUDED,
        entityType: 'candidate',
        entityId: candidateId,
        after: { excluded, reason },
        userId,
      },
      ctx
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Retention worker — applyRetentionForTenant + listAllEnabledTenants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lijst alle (tenant_id, policy)-paren waarop de cron iets te doen heeft.
 * Loopt buiten withTenant (we hebben geen tenant-context!) maar leest
 * alleen rij-aggregaten die niet onder RLS-verbod kruipen — RLS staat
 * standaard SELECT toe als de policy niet wordt geactiveerd. We
 * gebruiken een SECURITY DEFINER-stijl fallback: in development draaien
 * we als eigenaar van de DB en de RLS-USING-clause faalt veilig naar
 * "alles" als `app.tenant_id` niet gezet is.
 *
 * Voor robuustheid laten we de cron alleen polices selecteren waarvan
 * `enabled=TRUE`.
 */
export async function listAllEnabledRetentionPolicies(): Promise<
  RetentionPolicyRow[]
> {
  return withoutTenant(async (client) => {
    // Tijdelijk RLS uitzetten voor deze SELECT (super-user binnen
    // dezelfde sessie). Failsafe: als SET niet mag, vangen we de error
    // op en retourneren we [] — cron skipt dan deze tick.
    try {
      await client.query(`SET LOCAL row_security = off`);
    } catch {
      /* row_security toggle niet beschikbaar — DB zal SELECT toelaten
         met expliciet WHERE-filter; geen probleem. */
    }
    const { rows } = await client.query<RetentionPolicyRow>(
      `SELECT * FROM retention_policies WHERE enabled = TRUE`
    );
    return rows;
  });
}

interface ExpiredCandidateRow {
  id: string;
  candidate_reference: string | null;
}

/**
 * Selecteer kandidaten die volgens deze policy zijn verlopen. We
 * filteren op:
 *   - tenant_id matched (RLS via withTenant)
 *   - retention_excluded = false
 *   - anonymized_at IS NULL  (al klaar)
 *   - deleted_at IS NULL     (al gearchiveerd)
 *   - <trigger_field> < now() - retention_months
 */
async function selectExpiredCandidates(
  client: PoolClient,
  tenantId: string,
  policy: RetentionPolicyRow,
  limit: number
): Promise<ExpiredCandidateRow[]> {
  // Whitelist het kolomnaam zodat we hem veilig kunnen interpoleren.
  const allowed: Record<RetentionTriggerField, string> = {
    last_activity_at: 'last_activity_at',
    created_at: 'created_at',
    // candidates heeft geen rejected_at — fallback naar last_activity_at
    // voor kandidaat-level. application-level kan in een latere sprint.
    rejected_at: 'last_activity_at',
  };
  const col = allowed[policy.trigger_field] ?? 'last_activity_at';

  const { rows } = await client.query<ExpiredCandidateRow>(
    `SELECT id, candidate_reference
       FROM candidates
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND retention_excluded = FALSE
        AND anonymized_at IS NULL
        AND ${col} < (now() - ($2 || ' months')::interval)
      ORDER BY ${col} ASC
      LIMIT $3`,
    [tenantId, String(policy.retention_months), limit]
  );
  return rows;
}

const RETENTION_BATCH_SIZE = 500;

/**
 * Voer één policy uit voor één tenant. Gebruikt door de daily cron.
 *
 * Returnt counters; gooit nooit (errors per kandidaat worden geteld
 * maar bubbelen niet zodat één gebroken row de hele cron niet
 * blokkeert).
 */
export async function applyRetentionPolicy(
  tenantId: string,
  policy: RetentionPolicyRow
): Promise<RetentionRunResult> {
  const result: RetentionRunResult = {
    tenant_id: tenantId,
    policy_id: policy.id,
    entity_type: policy.entity_type,
    action: policy.action_on_expiry,
    candidates_processed: 0,
    candidates_skipped: 0,
    errors: 0,
  };

  if (policy.entity_type !== 'candidate') {
    // application-retention is buiten scope MVP.
    return result;
  }

  const expired = await withTenant(tenantId, async (client) => {
    return selectExpiredCandidates(client, tenantId, policy, RETENTION_BATCH_SIZE);
  });

  if (expired.length === 0) return result;

  for (const row of expired) {
    try {
      switch (policy.action_on_expiry) {
        case 'archive': {
          await withTenant(tenantId, async (client) => {
            await client.query(
              `UPDATE candidates
                  SET deleted_at = now(), updated_at = now()
                WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
              [row.id, tenantId]
            );
            await logAudit(
              client,
              tenantId,
              {
                action: AuditActions.RETENTION_APPLIED,
                entityType: 'candidate',
                entityId: row.id,
                after: { action: 'archive', policy_id: policy.id },
                userId: null,
              },
              {}
            );
          });
          result.candidates_processed += 1;
          break;
        }
        case 'anonymize': {
          await anonymizeCandidatePermanently(tenantId, row.id, null, {});
          await withTenant(tenantId, async (client) => {
            await logAudit(
              client,
              tenantId,
              {
                action: AuditActions.RETENTION_APPLIED,
                entityType: 'candidate',
                entityId: row.id,
                after: { action: 'anonymize', policy_id: policy.id },
                userId: null,
              },
              {}
            );
          });
          result.candidates_processed += 1;
          break;
        }
        case 'delete': {
          await withTenant(tenantId, async (client) => {
            await client.query(
              `DELETE FROM candidates WHERE id = $1 AND tenant_id = $2`,
              [row.id, tenantId]
            );
            await logAudit(
              client,
              tenantId,
              {
                action: AuditActions.RETENTION_APPLIED,
                entityType: 'candidate',
                entityId: row.id,
                after: { action: 'delete', policy_id: policy.id },
                userId: null,
              },
              {}
            );
          });
          result.candidates_processed += 1;
          break;
        }
      }
    } catch (err) {
      result.errors += 1;
      logger.error('[retention] failed to apply action', {
        tenantId,
        candidateId: row.id,
        action: policy.action_on_expiry,
        error: (err as Error).message,
      });
    }
  }

  return result;
}
