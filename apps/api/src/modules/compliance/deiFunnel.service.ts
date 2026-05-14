/**
 * DEI funnel service — Sprint Q3.6 (Agent III).
 *
 * Genereert per stage een anonieme demographic-funnel: hoeveel kandidaten
 * van elke gender / leeftijds-bracket / nationaliteit-bucket bereiken elke
 * stap in de pipeline. Detecteert disproportionele drop-offs ("bias-funnel")
 * en triggert alerts.
 *
 * Bias-indicator formule (per stage t.o.v. vorige stage):
 *
 *     For each demographic group g in stage[t]:
 *       prev_pct = group_count[t-1] / total[t-1]
 *       curr_pct = group_count[t]   / total[t]
 *       deviation = (prev_pct - curr_pct) / max(prev_pct, 0.001)
 *
 *     bias_indicator = max(deviation, 0..n) * 100   (clamp 0..100)
 *
 * D.w.z.: een stage waarin een groep procentueel sterker krimpt dan andere
 * groepen krijgt een hoge indicator. Een waarde van 30 betekent dat de
 * grootst krimpende groep 30% van haar stage-aandeel verliest in deze
 * stap.
 *
 * Alerts:
 *   - bias_indicator > 25 EN drop_off > 30 → severity 'high'
 *   - één enkele demografische groep > 70% in deze stage → severity 'medium'
 *   - bias_indicator > 15 → severity 'low'
 *
 * K-anonymity ≥ 5 wordt toegepast op de gepubliceerde groep-counts. Onder
 * threshold mergen we in 'other' of weglaten — zelfde mechaniek als
 * payEquity.service.
 */

import type { PoolClient } from 'pg';
import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import {
  K_ANONYMITY_THRESHOLD,
  applyKAnonymity,
  bucketAge,
  computeAge,
  normalizeGender,
} from './payEquity.service';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const DEI_FUNNEL_DISCLOSURE =
  'Deze funnel bevat anonieme demografische tellingen van kandidaten in jouw pipeline. K-anonymity ≥ 5 is toegepast: groepen kleiner dan 5 personen worden gemerged in "other". Bias-indicator en alerts zijn statistische signalen — geen vaststelling van discriminatie. Recruiter blijft eindverantwoordelijk. (EU AI Act art. 13 — high-risk recruitment use)';

const EU_COUNTRIES = new Set<string>([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'low' | 'medium' | 'high';

export interface DEIAlert {
  stage_name: string;
  type: string;
  severity: AlertSeverity;
  message: string;
}

export interface DEIFunnelStage {
  stage_name: string;
  stage_position: number;
  total: number;
  by_gender: Record<string, number>;
  by_age_bracket: Record<string, number>;
  by_nationality_bucket: Record<string, number>;
  drop_off_from_previous_pct: number;
  bias_indicator: number;
}

export interface DEIFunnelReport {
  period_start: string;
  period_end: string;
  stages: DEIFunnelStage[];
  alerts: DEIAlert[];
  ai_disclosure: string;
  computed_at: string;
}

export interface DEIFunnelOptions {
  from: Date;
  to: Date;
}

interface ApplicationRow {
  application_id: string;
  candidate_id: string;
  stage_id: string | null;
  stage_name: string | null;
  stage_position: number | null;
  gender: string | null;
  birthdate: string | null;
  nationalities: string[] | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers — exported voor tests.
// ─────────────────────────────────────────────────────────────────────────────

export function bucketNationality(
  nationalities: string[] | null
): 'NL' | 'EU-other' | 'non-EU' | 'unknown' {
  if (!nationalities || nationalities.length === 0) return 'unknown';
  // Pak de eerste niet-lege ISO-2 code als "primaire" nationaliteit. Voor
  // bipatride kandidaten waarvan één van de codes 'NL' is, prioriteren we
  // 'NL' omdat dat de meest gunstige bucket is voor de kandidaat
  // (lokale arbeidsmarkt-status). Gevolgd door EU dan non-EU.
  const codes = nationalities
    .map((c) => (c ?? '').trim().toUpperCase())
    .filter((c) => /^[A-Z]{2,3}$/.test(c));
  if (codes.length === 0) return 'unknown';
  if (codes.includes('NL')) return 'NL';
  if (codes.some((c) => EU_COUNTRIES.has(c))) return 'EU-other';
  return 'non-EU';
}

/**
 * Records-based aggregation: returns Map<groupName, count> voor
 * verdere k-anonymity processing.
 */
function tally<T extends string>(values: T[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const v of values) {
    const list = out.get(v) ?? [];
    list.push(1); // 1 = "1 persoon" voor count-aggregaties.
    out.set(v, list);
  }
  return out;
}

export function tallyToCounts(
  raw: Map<string, number[]>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, values] of raw.entries()) {
    out[key] = values.length;
  }
  return out;
}

/**
 * Bias-indicator: maximale relatieve groep-deviation (in %) tussen deze
 * stage en de vorige. Returnt 0 als prev null/empty.
 *
 * @param prev  groep-counts vorige stage
 * @param curr  groep-counts deze stage
 * @param prevTotal  totaal vorige stage
 * @param currTotal  totaal deze stage
 */
export function computeBiasIndicator(
  prev: Record<string, number> | null,
  curr: Record<string, number>,
  prevTotal: number,
  currTotal: number
): number {
  if (!prev || prevTotal === 0 || currTotal === 0) return 0;
  let maxDeviation = 0;
  // Iterate over union of groups so we catch both "groep verdwijnt" en
  // "nieuwe groep verschijnt" — nieuwe groep duidt meestal op data-issue
  // maar kan ook bias zijn (bv. recruiter herclassificeert).
  const allKeys = new Set<string>([...Object.keys(prev), ...Object.keys(curr)]);
  for (const k of allKeys) {
    const prevPct = (prev[k] ?? 0) / prevTotal;
    const currPct = (curr[k] ?? 0) / currTotal;
    const denom = Math.max(prevPct, 0.001);
    const deviation = Math.abs(prevPct - currPct) / denom;
    if (deviation > maxDeviation) maxDeviation = deviation;
  }
  return Number(Math.min(maxDeviation * 100, 100).toFixed(2));
}

export function computeDropOffPct(
  prevTotal: number | null,
  currTotal: number
): number {
  if (prevTotal === null || prevTotal === 0) return 0;
  if (currTotal >= prevTotal) return 0;
  return Number((((prevTotal - currTotal) / prevTotal) * 100).toFixed(2));
}

/**
 * Alert-engine. Per stage genereren we 0..n alerts.
 */
export function buildAlerts(stages: DEIFunnelStage[]): DEIAlert[] {
  const alerts: DEIAlert[] = [];
  for (const stage of stages) {
    if (stage.bias_indicator > 25 && stage.drop_off_from_previous_pct > 30) {
      alerts.push({
        stage_name: stage.stage_name,
        type: 'bias_drop_off',
        severity: 'high',
        message: `Bias-indicator (${stage.bias_indicator}%) en drop-off (${stage.drop_off_from_previous_pct}%) wijzen op disproportionele uitval in deze stage. Inspecteer de selectie-criteria.`,
      });
    } else if (stage.bias_indicator > 15) {
      alerts.push({
        stage_name: stage.stage_name,
        type: 'bias_signal',
        severity: 'low',
        message: `Bias-indicator (${stage.bias_indicator}%) verhoogd t.o.v. vorige stage.`,
      });
    }

    // Demographic skew alert (één enkele groep > 70%)
    const allGroups: Array<[string, number]> = [
      ...Object.entries(stage.by_gender),
      ...Object.entries(stage.by_age_bracket),
      ...Object.entries(stage.by_nationality_bucket),
    ];
    if (stage.total > 0) {
      for (const [groupName, count] of allGroups) {
        const pct = (count / stage.total) * 100;
        if (pct > 70) {
          alerts.push({
            stage_name: stage.stage_name,
            type: 'demographic_skew',
            severity: 'medium',
            message: `Groep "${groupName}" omvat ${pct.toFixed(0)}% van deze stage. Overweeg of de selectie-criteria onbedoeld een groep bevoordelen.`,
          });
          break; // 1 demografische skew-alert per stage is voldoende.
        }
      }
    }
  }
  return alerts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hoofd-aggregator
// ─────────────────────────────────────────────────────────────────────────────

export async function generateDeiFunnel(
  tenantId: string,
  options: DEIFunnelOptions,
  userId: string | null = null,
  ctx: AuditContext = {}
): Promise<DEIFunnelReport> {
  if (!(options.from instanceof Date) || !(options.to instanceof Date)) {
    throw new AppError(
      400,
      'INVALID_PERIOD',
      'from en to moeten geldige Date-objecten zijn'
    );
  }
  if (options.from > options.to) {
    throw new AppError(400, 'INVALID_PERIOD', 'from moet vóór to liggen');
  }

  return withTenant(tenantId, async (client: PoolClient) => {
    const apps = await fetchApplications(client, tenantId, options);

    // Bucket per stage (we groeperen op stage_name/stage_position).
    interface StageBucket {
      stage_name: string;
      stage_position: number;
      genders: string[];
      ages: string[];
      nationalities: string[];
    }
    const stageBuckets = new Map<string, StageBucket>();

    for (const a of apps) {
      const stageName = a.stage_name ?? 'Unassigned';
      const stagePos = a.stage_position ?? 0;
      const key = `${stagePos}::${stageName}`;
      const bucket = stageBuckets.get(key) ?? {
        stage_name: stageName,
        stage_position: stagePos,
        genders: [] as string[],
        ages: [] as string[],
        nationalities: [] as string[],
      };
      bucket.genders.push(normalizeGender(a.gender));
      bucket.ages.push(bucketAge(computeAge(a.birthdate, options.to)));
      bucket.nationalities.push(bucketNationality(a.nationalities));
      stageBuckets.set(key, bucket);
    }

    // Sorteer stages op stage_position ascending, vervolgens stage_name.
    const sortedBuckets = [...stageBuckets.values()].sort((a, b) => {
      if (a.stage_position !== b.stage_position) {
        return a.stage_position - b.stage_position;
      }
      return a.stage_name.localeCompare(b.stage_name);
    });

    const stages: DEIFunnelStage[] = [];
    let prevTotal: number | null = null;
    let prevGenderCounts: Record<string, number> | null = null;

    for (const bucket of sortedBuckets) {
      const total = bucket.genders.length;

      const genderRaw = tally(bucket.genders);
      const ageRaw = tally(bucket.ages);
      const nationalityRaw = tally(bucket.nationalities);

      const genderSafe = applyKAnonymity(genderRaw);
      const ageSafe = applyKAnonymity(ageRaw);
      const nationalitySafe = applyKAnonymity(nationalityRaw);

      const byGender = tallyToCounts(genderSafe);
      const byAge = tallyToCounts(ageSafe);
      const byNationality = tallyToCounts(nationalitySafe);

      const dropOff = computeDropOffPct(prevTotal, total);
      const bias = computeBiasIndicator(prevGenderCounts, byGender, prevTotal ?? 0, total);

      stages.push({
        stage_name: bucket.stage_name,
        stage_position: bucket.stage_position,
        total,
        by_gender: byGender,
        by_age_bracket: byAge,
        by_nationality_bucket: byNationality,
        drop_off_from_previous_pct: dropOff,
        bias_indicator: bias,
      });

      prevTotal = total;
      prevGenderCounts = byGender;
    }

    const alerts = buildAlerts(stages);
    const computedAt = new Date().toISOString();

    const report: DEIFunnelReport = {
      period_start: options.from.toISOString().slice(0, 10),
      period_end: options.to.toISOString().slice(0, 10),
      stages,
      alerts,
      ai_disclosure: DEI_FUNNEL_DISCLOSURE,
      computed_at: computedAt,
    };

    // Persist snapshots — één rij per stage zodat we per-stage history-charts
    // kunnen plotten zonder het hele JSONB-document opnieuw te lezen.
    for (const stage of stages) {
      await client.query(
        `INSERT INTO dei_funnel_snapshots
           (tenant_id, period_start, period_end, stage_name, stage_position,
            total, by_gender, by_age_bracket, by_nationality,
            drop_off_from_previous_pct, bias_indicator)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11)`,
        [
          tenantId,
          report.period_start,
          report.period_end,
          stage.stage_name,
          stage.stage_position,
          stage.total,
          JSON.stringify(stage.by_gender),
          JSON.stringify(stage.by_age_bracket),
          JSON.stringify(stage.by_nationality_bucket),
          stage.drop_off_from_previous_pct,
          stage.bias_indicator,
        ]
      );
    }

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.DEI_FUNNEL_REPORT_GENERATED,
        entityType: 'dei_funnel_report',
        entityId: null,
        after: {
          period_start: report.period_start,
          period_end: report.period_end,
          stage_count: stages.length,
          alert_count: alerts.length,
          high_severity_alerts: alerts.filter((a) => a.severity === 'high').length,
        },
        userId,
      },
      ctx
    );

    return report;
  });
}

export async function listDeiFunnelSnapshots(
  tenantId: string,
  limit: number = 100
): Promise<
  Array<{
    period_start: string;
    period_end: string;
    stage_name: string;
    stage_position: number;
    total: number;
    by_gender: Record<string, number>;
    by_age_bracket: Record<string, number>;
    by_nationality: Record<string, number>;
    drop_off_from_previous_pct: number;
    bias_indicator: number;
    computed_at: string;
  }>
> {
  return withTenant(tenantId, async (client) => {
    const safeLimit = Math.max(1, Math.min(limit, 1000));
    const { rows } = await client.query<{
      period_start: string;
      period_end: string;
      stage_name: string;
      stage_position: number;
      total: number;
      by_gender: Record<string, number>;
      by_age_bracket: Record<string, number>;
      by_nationality: Record<string, number>;
      drop_off_from_previous_pct: string | null;
      bias_indicator: string | null;
      computed_at: string;
    }>(
      `SELECT period_start::text, period_end::text, stage_name, stage_position,
              total, by_gender, by_age_bracket, by_nationality,
              drop_off_from_previous_pct::text, bias_indicator::text,
              computed_at::text
         FROM dei_funnel_snapshots
        WHERE tenant_id = $1
        ORDER BY period_end DESC, stage_position ASC, computed_at DESC
        LIMIT $2`,
      [tenantId, safeLimit]
    );
    return rows.map((r) => ({
      period_start: r.period_start,
      period_end: r.period_end,
      stage_name: r.stage_name,
      stage_position: r.stage_position,
      total: r.total,
      by_gender: r.by_gender ?? {},
      by_age_bracket: r.by_age_bracket ?? {},
      by_nationality: r.by_nationality ?? {},
      drop_off_from_previous_pct:
        r.drop_off_from_previous_pct === null
          ? 0
          : Number(r.drop_off_from_previous_pct),
      bias_indicator:
        r.bias_indicator === null ? 0 : Number(r.bias_indicator),
      computed_at: r.computed_at,
    }));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DB-fetch helper
// ─────────────────────────────────────────────────────────────────────────────

async function fetchApplications(
  client: PoolClient,
  tenantId: string,
  options: DEIFunnelOptions
): Promise<ApplicationRow[]> {
  const { rows } = await client.query<ApplicationRow>(
    `SELECT a.id          AS application_id,
            a.candidate_id AS candidate_id,
            a.stage_id    AS stage_id,
            ps.name       AS stage_name,
            ps.position   AS stage_position,
            c.gender      AS gender,
            c.birthdate::text AS birthdate,
            c.nationalities AS nationalities
       FROM applications a
       JOIN candidates c ON c.id = a.candidate_id AND c.tenant_id = a.tenant_id
       LEFT JOIN pipeline_stages ps ON ps.id = a.stage_id AND ps.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1
        AND a.applied_at >= $2
        AND a.applied_at <= $3
        AND c.anonymized_at IS NULL`,
    [tenantId, options.from.toISOString(), options.to.toISOString()]
  );
  return rows;
}

// Export voor unit tests
export const _internal = {
  fetchApplications,
};
