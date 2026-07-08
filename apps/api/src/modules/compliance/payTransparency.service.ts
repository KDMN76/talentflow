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

export const SALARY_FREQUENCY_VALUES = ['monthly', 'annual', 'hourly'] as const;
export type SalaryFrequency = (typeof SALARY_FREQUENCY_VALUES)[number];

export interface TenantPaySettings {
  tenant_id: string;
  pay_transparency_enforced: boolean;
  prohibit_current_salary_questions: boolean;
  reporting_threshold: number;
  default_currency: string;
  default_salary_frequency: SalaryFrequency;
  benchmark_data_consent: boolean;
  updated_at: string;
  created_at: string;
}

export interface UpdatePaySettingsInput {
  pay_transparency_enforced?: boolean;
  prohibit_current_salary_questions?: boolean;
  reporting_threshold?: number;
  default_currency?: string;
  default_salary_frequency?: SalaryFrequency;
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
    default_salary_frequency: 'monthly',
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
              default_salary_frequency,
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
  if (
    patch.default_salary_frequency !== undefined &&
    !SALARY_FREQUENCY_VALUES.includes(patch.default_salary_frequency)
  ) {
    throw new AppError(
      400,
      'INVALID_FREQUENCY',
      'default_salary_frequency moet monthly, annual of hourly zijn'
    );
  }

  return withTenant(tenantId, async (client: PoolClient) => {
    // Lees eerste de bestaande rij — voor de audit-before-snapshot.
    const { rows: existingRows } = await client.query<TenantPaySettings>(
      `SELECT tenant_id, pay_transparency_enforced,
              prohibit_current_salary_questions, reporting_threshold,
              default_currency, default_salary_frequency,
              benchmark_data_consent,
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
          default_currency, default_salary_frequency,
          benchmark_data_consent, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (tenant_id) DO UPDATE SET
         pay_transparency_enforced         = EXCLUDED.pay_transparency_enforced,
         prohibit_current_salary_questions = EXCLUDED.prohibit_current_salary_questions,
         reporting_threshold               = EXCLUDED.reporting_threshold,
         default_currency                  = EXCLUDED.default_currency,
         default_salary_frequency          = EXCLUDED.default_salary_frequency,
         benchmark_data_consent            = EXCLUDED.benchmark_data_consent,
         updated_at                        = now()
       RETURNING tenant_id, pay_transparency_enforced,
                 prohibit_current_salary_questions, reporting_threshold,
                 default_currency, default_salary_frequency,
                 benchmark_data_consent,
                 updated_at::text, created_at::text`,
      [
        tenantId,
        next.pay_transparency_enforced,
        next.prohibit_current_salary_questions,
        next.reporting_threshold,
        next.default_currency,
        next.default_salary_frequency,
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

// ─────────────────────────────────────────────────────────────────────────────
// Pay-transparency rapport (EU 2023/970 art. 5 — band in vacature)
// ─────────────────────────────────────────────────────────────────────────────

export type PayTransparencyMissingField =
  | 'salary_min'
  | 'salary_max'
  | 'salary_frequency';

/** NL-labels voor de publiceer-gate-melding (UI is NL). */
export const MISSING_FIELD_LABELS_NL: Record<PayTransparencyMissingField, string> = {
  salary_min: 'minimumsalaris',
  salary_max: 'maximumsalaris',
  salary_frequency: 'salarisfrequentie',
};

/**
 * Bouwt de uniforme 422-payload voor een geblokkeerde publicatie. Eén plek
 * zodat middleware (POST/PATCH /jobs) en jd-draft-publish exact dezelfde
 * NL-melding + details geven.
 */
export function buildPayTransparencyError(
  missing: PayTransparencyMissingField[]
): { code: string; message: string; details: Record<string, unknown> } {
  const labels = missing.map((f) => MISSING_FIELD_LABELS_NL[f]);
  const opsomming =
    labels.length <= 1
      ? labels.join('')
      : `${labels.slice(0, -1).join(', ')} en ${labels[labels.length - 1]}`;
  return {
    code: 'PAY_TRANSPARENCY_REQUIRED',
    message:
      `Vacature kan niet gepubliceerd worden: ${opsomming} ontbreekt. ` +
      `Vul de volledige salarisband (minimum, maximum en frequentie) in — ` +
      `verplicht volgens de EU-loontransparantierichtlijn (2023/970).`,
    details: {
      missing,
      required_fields: ['salary_min', 'salary_max', 'salary_frequency'],
      settings_url: '/settings/pay-transparency',
      directive: 'EU 2023/970',
    },
  };
}

/**
 * Service-level publiceer-gate voor flows die NIET door de /api/jobs
 * middleware gaan (bv. jd-draft publish). Gooit AppError 422 wanneer de
 * tenant afdwingt en de band incompleet is. DB-fouten bij het lezen van de
 * settings soft-failen (zelfde beleid als de middleware): beschikbaarheid
 * boven blokkade, de audit-trail vangt het later op.
 */
export async function assertJobPublishable(
  tenantId: string,
  fields: {
    salary_min: number | null | undefined;
    salary_max: number | null | undefined;
    salary_frequency: string | null | undefined;
  },
  audit?: { userId?: string | null; source?: string; ctx?: AuditContext }
): Promise<void> {
  let enforced: boolean;
  try {
    enforced = await isPayTransparencyEnforced(tenantId);
  } catch {
    return; // soft-fail: settings onleesbaar → niet blokkeren
  }
  if (!enforced) return;

  const missing = computeMissingFields({
    salary_min: fields.salary_min ?? null,
    salary_max: fields.salary_max ?? null,
    salary_frequency: fields.salary_frequency ?? null,
  });
  if (missing.length === 0) return;

  // Zelfde compliance-trail als de /api/jobs-middleware: het blok is een
  // audit-feit, ongeacht via welke flow (REST of jd-publish) het gebeurde.
  // Best-effort — een audit-DB-fout mag de 422 niet verdringen.
  if (audit) {
    try {
      await withTenant(tenantId, async (client: PoolClient) => {
        await logAudit(
          client,
          tenantId,
          {
            action: AuditActions.PAY_TRANSPARENCY_BLOCKED,
            entityType: 'job',
            entityId: null,
            after: {
              source: audit.source ?? 'service',
              attempted_status: 'open',
              missing,
              user_id: audit.userId ?? null,
            },
            userId: audit.userId ?? null,
          },
          audit.ctx ?? {}
        );
      });
    } catch {
      // swallow — compliance-trail is nice-to-have op dit pad
    }
  }

  const err = buildPayTransparencyError(missing);
  throw new AppError(422, err.code, err.message, err.details);
}

export interface PayTransparencyActionItem {
  id: string;
  title: string;
  job_reference: string | null;
  created_at: string;
  pay_transparency_required: boolean;
  missing: PayTransparencyMissingField[];
}

export interface PayTransparencyReport {
  generated_at: string;
  /** Tenant-brede afdwinging (tenant_pay_settings.pay_transparency_enforced). */
  enforced: boolean;
  default_salary_frequency: SalaryFrequency;
  totals: {
    open: number;
    open_with_band: number;
    open_without_band: number;
    /** Open vacatures met band maar zonder frequency (band ≠ volledig). */
    open_without_frequency: number;
    draft: number;
    draft_with_band: number;
    /** % open vacatures met volledige band (min+max). 100 bij 0 open jobs. */
    pct_open_with_band: number;
  };
  /** Open vacatures die (nog) niet compliant zijn — publicatie-actielijst. */
  action_list: PayTransparencyActionItem[];
}

interface ActionRow {
  id: string;
  title: string;
  job_reference: string | null;
  created_at: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_frequency: string | null;
  pay_transparency_required: boolean | null;
}

/** Bepaal welke band-velden op een rij ontbreken. Exported voor tests. */
export function computeMissingFields(row: {
  salary_min: number | null;
  salary_max: number | null;
  salary_frequency: string | null;
}): PayTransparencyMissingField[] {
  const missing: PayTransparencyMissingField[] = [];
  if (row.salary_min === null || row.salary_min === undefined) {
    missing.push('salary_min');
  }
  if (row.salary_max === null || row.salary_max === undefined) {
    missing.push('salary_max');
  }
  if (!row.salary_frequency) {
    missing.push('salary_frequency');
  }
  return missing;
}

/**
 * Aggregatie voor het "Pay transparency"-overzicht:
 *   - % open vacatures met salarisband (salary_band_disclosed);
 *   - actielijst van open vacatures zonder (volledige) band;
 *   - tenant-instellingen (afdwinging + default frequency) voor context.
 *
 * `salary_band_disclosed` is een GENERATED kolom (min+max beide gezet), dus
 * de percentages kunnen niet driften t.o.v. de daadwerkelijke salariskolommen.
 */
export async function getPayTransparencyReport(
  tenantId: string
): Promise<PayTransparencyReport> {
  const settings = await getPaySettings(tenantId);

  return withTenant(tenantId, async (client) => {
    const { rows: totalRows } = await client.query<{
      open_total: string;
      open_with_band: string;
      open_without_band: string;
      open_without_frequency: string;
      draft_total: string;
      draft_with_band: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'open')                                          AS open_total,
         COUNT(*) FILTER (WHERE status = 'open' AND salary_band_disclosed)                AS open_with_band,
         COUNT(*) FILTER (WHERE status = 'open' AND NOT salary_band_disclosed)            AS open_without_band,
         COUNT(*) FILTER (WHERE status = 'open' AND salary_band_disclosed
                            AND salary_frequency IS NULL)                                 AS open_without_frequency,
         COUNT(*) FILTER (WHERE status = 'draft')                                         AS draft_total,
         COUNT(*) FILTER (WHERE status = 'draft' AND salary_band_disclosed)               AS draft_with_band
       FROM jobs
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND status IN ('draft', 'open')`,
      [tenantId]
    );

    const t = totalRows[0] ?? {
      open_total: '0',
      open_with_band: '0',
      open_without_band: '0',
      open_without_frequency: '0',
      draft_total: '0',
      draft_with_band: '0',
    };
    const open = parseInt(t.open_total, 10) || 0;
    const openWithBand = parseInt(t.open_with_band, 10) || 0;

    const { rows: actionRows } = await client.query<ActionRow>(
      `SELECT id, title, job_reference, created_at::text,
              salary_min, salary_max, salary_frequency,
              pay_transparency_required
         FROM jobs
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          AND status = 'open'
          AND (salary_band_disclosed = false OR salary_frequency IS NULL)
        ORDER BY created_at ASC
        LIMIT 200`,
      [tenantId]
    );

    return {
      generated_at: new Date().toISOString(),
      enforced: settings.pay_transparency_enforced,
      default_salary_frequency: settings.default_salary_frequency,
      totals: {
        open,
        open_with_band: openWithBand,
        open_without_band: parseInt(t.open_without_band, 10) || 0,
        open_without_frequency: parseInt(t.open_without_frequency, 10) || 0,
        draft: parseInt(t.draft_total, 10) || 0,
        draft_with_band: parseInt(t.draft_with_band, 10) || 0,
        pct_open_with_band:
          open === 0 ? 100 : Math.round((openWithBand / open) * 1000) / 10,
      },
      action_list: actionRows.map((row) => ({
        id: row.id,
        title: row.title,
        job_reference: row.job_reference,
        created_at: row.created_at,
        pay_transparency_required: row.pay_transparency_required !== false,
        missing: computeMissingFields(row),
      })),
    };
  });
}
