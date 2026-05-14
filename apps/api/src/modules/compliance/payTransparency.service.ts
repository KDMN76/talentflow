/**
 * Pay-transparency tenant settings service — Sprint Q3.6 (Agent III).
 *
 * CRUD voor `tenant_pay_settings`. De directive-flags zijn allemaal default
 * TRUE — een nieuwe tenant is direct compliant. Updates schrijven een
 * audit-event `pay_settings.updated`.
 *
 * Defensief: als de rij voor een tenant ontbreekt (bv. tenant aangemaakt
 * vóór migration 021 zonder backfill), `getPaySettings` retourneert de
 * directive-defaults zonder side-effect. `updatePaySettings` doet een
 * UPSERT zodat de eerste write tegelijk de rij creëert.
 */

import type { PoolClient } from 'pg';
import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';

export interface TenantPaySettings {
  tenant_id: string;
  pay_transparency_enforced: boolean;
  prohibit_current_salary_questions: boolean;
  reporting_threshold: number;
  default_currency: string;
  benchmark_data_consent: boolean;
  updated_at: string;
  created_at: string;
}

export interface UpdatePaySettingsInput {
  pay_transparency_enforced?: boolean;
  prohibit_current_salary_questions?: boolean;
  reporting_threshold?: number;
  default_currency?: string;
  benchmark_data_consent?: boolean;
}

/**
 * Directive-defaults — gebruikt voor zowel default-row als fallback als
 * de DB-rij ontbreekt.
 */
function defaultsFor(tenantId: string): TenantPaySettings {
  const now = new Date().toISOString();
  return {
    tenant_id: tenantId,
    pay_transparency_enforced: true,
    prohibit_current_salary_questions: true,
    reporting_threshold: 100,
    default_currency: 'EUR',
    benchmark_data_consent: false,
    updated_at: now,
    created_at: now,
  };
}

export async function getPaySettings(
  tenantId: string
): Promise<TenantPaySettings> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<TenantPaySettings>(
      `SELECT tenant_id,
              pay_transparency_enforced,
              prohibit_current_salary_questions,
              reporting_threshold,
              default_currency,
              benchmark_data_consent,
              updated_at::text,
              created_at::text
         FROM tenant_pay_settings
        WHERE tenant_id = $1`,
      [tenantId]
    );
    if (rows.length === 0) {
      return defaultsFor(tenantId);
    }
    return rows[0];
  });
}

export async function updatePaySettings(
  tenantId: string,
  userId: string | null,
  patch: UpdatePaySettingsInput,
  ctx: AuditContext = {}
): Promise<TenantPaySettings> {
  if (Object.keys(patch).length === 0) {
    throw new AppError(
      400,
      'EMPTY_PATCH',
      'Patch mag niet leeg zijn'
    );
  }
  if (
    patch.reporting_threshold !== undefined &&
    (patch.reporting_threshold <= 0 || patch.reporting_threshold > 100000)
  ) {
    throw new AppError(
      400,
      'INVALID_THRESHOLD',
      'reporting_threshold moet tussen 1 en 100000 liggen'
    );
  }
  if (
    patch.default_currency !== undefined &&
    !/^[A-Z]{3}$/.test(patch.default_currency)
  ) {
    throw new AppError(
      400,
      'INVALID_CURRENCY',
      'default_currency moet een 3-letter ISO-code zijn (bv. EUR)'
    );
  }

  return withTenant(tenantId, async (client: PoolClient) => {
    // Lees eerste de bestaande rij — voor de audit-before-snapshot.
    const { rows: existingRows } = await client.query<TenantPaySettings>(
      `SELECT tenant_id, pay_transparency_enforced,
              prohibit_current_salary_questions, reporting_threshold,
              default_currency, benchmark_data_consent,
              updated_at::text, created_at::text
         FROM tenant_pay_settings
        WHERE tenant_id = $1`,
      [tenantId]
    );
    const before = existingRows[0] ?? defaultsFor(tenantId);

    const next: TenantPaySettings = {
      ...before,
      ...patch,
      tenant_id: tenantId,
      updated_at: new Date().toISOString(),
    };

    // UPSERT zodat eerste-update tegelijk de rij creëert (defensief voor
    // tenants zonder backfill-rij).
    const { rows: upsertRows } = await client.query<TenantPaySettings>(
      `INSERT INTO tenant_pay_settings
         (tenant_id, pay_transparency_enforced,
          prohibit_current_salary_questions, reporting_threshold,
          default_currency, benchmark_data_consent, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (tenant_id) DO UPDATE SET
         pay_transparency_enforced         = EXCLUDED.pay_transparency_enforced,
         prohibit_current_salary_questions = EXCLUDED.prohibit_current_salary_questions,
         reporting_threshold               = EXCLUDED.reporting_threshold,
         default_currency                  = EXCLUDED.default_currency,
         benchmark_data_consent            = EXCLUDED.benchmark_data_consent,
         updated_at                        = now()
       RETURNING tenant_id, pay_transparency_enforced,
                 prohibit_current_salary_questions, reporting_threshold,
                 default_currency, benchmark_data_consent,
                 updated_at::text, created_at::text`,
      [
        tenantId,
        next.pay_transparency_enforced,
        next.prohibit_current_salary_questions,
        next.reporting_threshold,
        next.default_currency,
        next.benchmark_data_consent,
      ]
    );
    const updated = upsertRows[0];

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.PAY_SETTINGS_UPDATED,
        entityType: 'tenant_pay_settings',
        entityId: tenantId,
        before,
        after: updated,
        userId,
      },
      ctx
    );

    return updated;
  });
}

/**
 * Helper voor andere services (bv. middleware, snapshot worker) — leest
 * één flag zonder de hele row terug te geven.
 */
export async function isPayTransparencyEnforced(
  tenantId: string
): Promise<boolean> {
  const settings = await getPaySettings(tenantId);
  return settings.pay_transparency_enforced;
}
