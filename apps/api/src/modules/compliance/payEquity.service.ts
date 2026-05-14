/**
 * Pay-equity service — Sprint Q3.6 (Agent III).
 *
 * Genereert pay-equity rapporten conform EU Pay Transparency Directive
 * 2023/970. Per periode, per (optionele) job-categorie aggregeren we de
 * uitgebrachte offers en berekenen we:
 *
 *   - total_offers           Aantal applications met offer/hire-stage in periode.
 *   - median_salary          Mediaan van geboden salarissen (NUMERIC).
 *   - by_gender              Per gender-groep: count + median + mean.
 *   - by_age_bracket         Per leeftijds-bracket: count + median + mean.
 *   - pay_gap_pct            (max_median - min_median) / max_median * 100.
 *
 * Privacy / k-anonymity:
 *   * Demografische groepen met `count < K_ANONYMITY_THRESHOLD` (default 5)
 *     worden in 'other' gebucketed. Reden: kleine groepen kunnen via
 *     herhaalde queries geïdentificeerd worden ("welke kandidaat van
 *     gender X kreeg een offer in Q1"). De directive raadt het aan; wij
 *     enforce-en het hard.
 *   * Wanneer ook 'other' < K leden heeft mergen we 'other' met 'unknown'
 *     en als die nog steeds < K is wordt het hele veld weggelaten.
 *
 * Bron-data:
 *   * `applications` rows in periode met stage_name dat hint op offer
 *     ('offer', 'hire', 'aanbod', 'aangenomen' — case-insensitive). Geen
 *     applications-tabel offer_salary kolom in huidig schema, dus we
 *     gebruiken `jobs.salary_min`/`salary_max` als proxy: het midpoint
 *     van de band geldt als "geboden" salaris. Documenteer dat in de
 *     ai_explanation/disclosure.
 *   * `candidates.gender` en `candidates.birthdate` voor demographic
 *     bucketing.
 *
 * Audit: élke generate schrijft een `pay_equity.report_generated` event.
 * AI-explainer (optioneel) wordt via ai_events gelogd door de caller (we
 * doen alleen de tekstpresentatie hier).
 */

import type { PoolClient } from 'pg';
import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimum aantal mensen per demographic-group voor publicatie. Onder deze
 * threshold worden groepen gemerged in 'other' om re-identificatie te
 * voorkomen. EU AI Act + GDPR raden K >= 5 aan; sommige toezichthouders
 * eisen K >= 10. Default 5 is een veilige minimum.
 */
export const K_ANONYMITY_THRESHOLD = 5;

const GENDER_LABELS = ['male', 'female', 'other', 'prefer_not'] as const;
type GenderLabel = (typeof GENDER_LABELS)[number] | 'unknown';

const AGE_BRACKETS = ['<25', '25-34', '35-44', '45-54', '55+', 'unknown'] as const;
type AgeBracket = (typeof AGE_BRACKETS)[number];

export const PAY_EQUITY_DISCLOSURE =
  'Dit rapport is automatisch gegenereerd op basis van uitgebrachte offers in de geselecteerde periode. Salarissen zijn afgeleid uit de salarisbandbreedte (midpoint) van de bijbehorende vacature. K-anonymity ≥ 5 is toegepast: demografische groepen kleiner dan 5 personen worden gemerged in "other" of weggelaten. Recruiter blijft eindverantwoordelijk voor interpretatie en actie. (EU Pay Transparency Directive 2023/970)';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PayEquityGroupStats {
  count: number;
  median: number;
  mean: number;
}

export interface PayEquityReport {
  period_start: string;
  period_end: string;
  job_category: string;
  total_offers: number;
  median_salary: number;
  pay_gap_pct: number;
  by_gender: Record<string, PayEquityGroupStats>;
  by_age_bracket: Record<string, Pick<PayEquityGroupStats, 'count' | 'median'>>;
  ai_explanation?: string;
  ai_disclosure: string;
  computed_at: string;
}

export interface PayEquityOptions {
  from: Date;
  to: Date;
  jobCategory?: string;
}

interface OfferRow {
  application_id: string;
  candidate_id: string;
  gender: string | null;
  birthdate: string | null;
  salary_min: number | null;
  salary_max: number | null;
  job_industry: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers — exported voor unit tests.
// ─────────────────────────────────────────────────────────────────────────────

export function computeMidpoint(
  salaryMin: number | null,
  salaryMax: number | null
): number | null {
  if (salaryMin === null && salaryMax === null) return null;
  if (salaryMin === null) return salaryMax;
  if (salaryMax === null) return salaryMin;
  return (Number(salaryMin) + Number(salaryMax)) / 2;
}

export function computeAge(birthdateIso: string | null, refDate: Date): number | null {
  if (!birthdateIso) return null;
  const bd = new Date(birthdateIso);
  if (Number.isNaN(bd.getTime())) return null;
  let age = refDate.getFullYear() - bd.getFullYear();
  const m = refDate.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && refDate.getDate() < bd.getDate())) age--;
  if (age < 0 || age > 120) return null;
  return age;
}

export function bucketAge(age: number | null): AgeBracket {
  if (age === null) return 'unknown';
  if (age < 25) return '<25';
  if (age < 35) return '25-34';
  if (age < 45) return '35-44';
  if (age < 55) return '45-54';
  return '55+';
}

export function normalizeGender(g: string | null): GenderLabel {
  if (!g) return 'unknown';
  const lower = g.trim().toLowerCase();
  if ((GENDER_LABELS as readonly string[]).includes(lower)) {
    return lower as GenderLabel;
  }
  return 'unknown';
}

export function median(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function mean(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

/**
 * K-anonymity merge: groepen met count < threshold worden in 'other'
 * gebucketed. Als 'other' daarna nog steeds < threshold is, mergen we in
 * 'unknown'. Als 'unknown' nog steeds < threshold is, returnen we een
 * leeg object — de groep is te klein om publiceerbaar te zijn.
 *
 * @param raw  groep-naam → list van waardes (salaries / 1's voor counts)
 */
export function applyKAnonymity<T>(
  raw: Map<string, T[]>,
  threshold: number = K_ANONYMITY_THRESHOLD
): Map<string, T[]> {
  const merged = new Map<string, T[]>();
  const overflow: T[] = [];

  for (const [key, values] of raw.entries()) {
    if (values.length >= threshold) {
      merged.set(key, values);
    } else {
      overflow.push(...values);
    }
  }

  if (overflow.length > 0) {
    if (overflow.length >= threshold) {
      // Bestaande 'other' samenvoegen.
      const existingOther = merged.get('other') ?? [];
      merged.set('other', [...existingOther, ...overflow]);
    } else if (merged.has('other')) {
      // 'other' is wel groot genoeg, voeg overflow toe.
      const existingOther = merged.get('other') ?? [];
      merged.set('other', [...existingOther, ...overflow]);
    }
    // Anders: overflow wordt verzwegen — te klein om k-anoniem te zijn.
  }

  return merged;
}

/**
 * Pay-gap berekening: relatieve afstand tussen de hoogste en laagste
 * mediaan over de gepubliceerde groepen. Returnt 0 als < 2 groepen.
 *
 *   pay_gap_pct = (max_median - min_median) / max_median * 100
 *
 * Een waarde van 15.0 betekent dat de laagstbetaalde groep gemiddeld
 * 15% minder verdient dan de hoogstbetaalde groep in dezelfde rol.
 */
export function computePayGap(groupMedians: number[]): number {
  if (groupMedians.length < 2) return 0;
  const max = Math.max(...groupMedians);
  const min = Math.min(...groupMedians);
  if (max <= 0) return 0;
  return Number((((max - min) / max) * 100).toFixed(2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Hoofd-aggregator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Genereert een pay-equity rapport voor één tenant + periode + (optionele)
 * job-categorie. Schrijft een snapshot in `pay_equity_snapshots` voor
 * caching/historie en logt het audit-event.
 *
 * Job-categorie mapping: we gebruiken `jobs.industry` als proxy. 'all'
 * (default) overslaat de filter.
 */
export async function generatePayEquityReport(
  tenantId: string,
  options: PayEquityOptions,
  userId: string | null = null,
  ctx: AuditContext = {}
): Promise<PayEquityReport> {
  if (!(options.from instanceof Date) || !(options.to instanceof Date)) {
    throw new AppError(
      400,
      'INVALID_PERIOD',
      'from en to moeten geldige Date-objecten zijn'
    );
  }
  if (options.from > options.to) {
    throw new AppError(
      400,
      'INVALID_PERIOD',
      'from moet vóór to liggen'
    );
  }

  const jobCategory = options.jobCategory ?? 'all';

  return withTenant(tenantId, async (client: PoolClient) => {
    const offers = await fetchOffers(client, tenantId, options);

    // Aggregatie
    const allMidpoints: number[] = [];

    // Gender-bucketing
    const byGenderRaw = new Map<string, number[]>();
    const byAgeRaw = new Map<string, number[]>();

    for (const row of offers) {
      const mid = computeMidpoint(row.salary_min, row.salary_max);
      if (mid === null) continue; // Geen band → niet meetellen.
      allMidpoints.push(mid);

      const g = normalizeGender(row.gender);
      const list = byGenderRaw.get(g) ?? [];
      list.push(mid);
      byGenderRaw.set(g, list);

      const age = computeAge(row.birthdate, options.to);
      const bracket = bucketAge(age);
      const ageList = byAgeRaw.get(bracket) ?? [];
      ageList.push(mid);
      byAgeRaw.set(bracket, ageList);
    }

    // K-anonymity toepassen
    const byGenderSafe = applyKAnonymity(byGenderRaw);
    const byAgeSafe = applyKAnonymity(byAgeRaw);

    const byGender: Record<string, PayEquityGroupStats> = {};
    for (const [g, salaries] of byGenderSafe.entries()) {
      byGender[g] = {
        count: salaries.length,
        median: Number(median(salaries).toFixed(2)),
        mean: Number(mean(salaries).toFixed(2)),
      };
    }

    const byAge: Record<string, Pick<PayEquityGroupStats, 'count' | 'median'>> = {};
    for (const [bracket, salaries] of byAgeSafe.entries()) {
      byAge[bracket] = {
        count: salaries.length,
        median: Number(median(salaries).toFixed(2)),
      };
    }

    // Pay-gap over de gender-groepen die de k-anonymity overleefden.
    const genderMedians = Object.values(byGender).map((g) => g.median);
    const payGap = computePayGap(genderMedians);

    const totalOffers = offers.length;
    const medianSalary = Number(median(allMidpoints).toFixed(2));
    const computedAt = new Date().toISOString();

    const report: PayEquityReport = {
      period_start: options.from.toISOString().slice(0, 10),
      period_end: options.to.toISOString().slice(0, 10),
      job_category: jobCategory,
      total_offers: totalOffers,
      median_salary: medianSalary,
      pay_gap_pct: payGap,
      by_gender: byGender,
      by_age_bracket: byAge,
      ai_disclosure: PAY_EQUITY_DISCLOSURE,
      computed_at: computedAt,
    };

    // Persist snapshot voor caching (idempotent per tenant+period+category).
    await client.query(
      `INSERT INTO pay_equity_snapshots
         (tenant_id, period_start, period_end, job_category,
          total_offers, median_salary, by_gender, by_age_bracket, pay_gap_pct)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
      [
        tenantId,
        report.period_start,
        report.period_end,
        report.job_category,
        report.total_offers,
        report.median_salary,
        JSON.stringify(report.by_gender),
        JSON.stringify(report.by_age_bracket),
        report.pay_gap_pct,
      ]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.PAY_EQUITY_REPORT_GENERATED,
        entityType: 'pay_equity_snapshot',
        entityId: null,
        after: {
          period_start: report.period_start,
          period_end: report.period_end,
          job_category: report.job_category,
          total_offers: report.total_offers,
          pay_gap_pct: report.pay_gap_pct,
          gender_groups: Object.keys(report.by_gender).length,
          age_groups: Object.keys(report.by_age_bracket).length,
        },
        userId,
      },
      ctx
    );

    return report;
  });
}

/**
 * Lijst van eerder berekende snapshots voor caching / dashboard. Limiet
 * default 12 (3 jaar kwartaal-rapporten).
 */
export async function listPayEquitySnapshots(
  tenantId: string,
  limit: number = 12
): Promise<PayEquityReport[]> {
  return withTenant(tenantId, async (client) => {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const { rows } = await client.query<{
      period_start: string;
      period_end: string;
      job_category: string;
      total_offers: number;
      median_salary: string | null;
      by_gender: Record<string, PayEquityGroupStats>;
      by_age_bracket: Record<string, Pick<PayEquityGroupStats, 'count' | 'median'>>;
      pay_gap_pct: string | null;
      ai_explanation: string | null;
      computed_at: string;
    }>(
      `SELECT period_start::text, period_end::text, job_category,
              total_offers, median_salary::text,
              by_gender, by_age_bracket, pay_gap_pct::text,
              ai_explanation, computed_at::text
         FROM pay_equity_snapshots
        WHERE tenant_id = $1
        ORDER BY period_end DESC, computed_at DESC
        LIMIT $2`,
      [tenantId, safeLimit]
    );
    return rows.map((r) => ({
      period_start: r.period_start,
      period_end: r.period_end,
      job_category: r.job_category,
      total_offers: r.total_offers,
      median_salary: r.median_salary === null ? 0 : Number(r.median_salary),
      pay_gap_pct: r.pay_gap_pct === null ? 0 : Number(r.pay_gap_pct),
      by_gender: r.by_gender ?? {},
      by_age_bracket: r.by_age_bracket ?? {},
      ai_explanation: r.ai_explanation ?? undefined,
      ai_disclosure: PAY_EQUITY_DISCLOSURE,
      computed_at: r.computed_at,
    }));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DB-fetch helper — geïsoleerd voor mocking in tests.
// ─────────────────────────────────────────────────────────────────────────────

async function fetchOffers(
  client: PoolClient,
  tenantId: string,
  options: PayEquityOptions
): Promise<OfferRow[]> {
  const params: unknown[] = [
    tenantId,
    options.from.toISOString(),
    options.to.toISOString(),
  ];
  let categoryFilter = '';
  if (options.jobCategory && options.jobCategory !== 'all') {
    params.push(options.jobCategory);
    categoryFilter = `AND j.industry = $${params.length}`;
  }

  // Stage_name patterns waarop we offer/hire detecteren. We checken
  // case-insensitive substring zodat customised pipeline-stages
  // ('Offer Sent', 'Aanbod uitgebracht', 'Hired') allemaal getriggerd worden.
  const sql = `
    SELECT a.id           AS application_id,
           a.candidate_id AS candidate_id,
           c.gender       AS gender,
           c.birthdate::text AS birthdate,
           j.salary_min   AS salary_min,
           j.salary_max   AS salary_max,
           j.industry     AS job_industry
      FROM applications a
      JOIN candidates c       ON c.id = a.candidate_id  AND c.tenant_id = a.tenant_id
      JOIN jobs j             ON j.id = a.job_id        AND j.tenant_id = a.tenant_id
      LEFT JOIN pipeline_stages ps ON ps.id = a.stage_id AND ps.tenant_id = a.tenant_id
     WHERE a.tenant_id = $1
       AND a.updated_at >= $2
       AND a.updated_at <= $3
       AND (
         lower(coalesce(ps.name, '')) LIKE '%offer%'
         OR lower(coalesce(ps.name, '')) LIKE '%aanbod%'
         OR lower(coalesce(ps.name, '')) LIKE '%hire%'
         OR lower(coalesce(ps.name, '')) LIKE '%aangenomen%'
         OR a.status = 'hired'
       )
       ${categoryFilter}
       AND c.anonymized_at IS NULL
  `;
  const { rows } = await client.query<OfferRow>(sql, params);
  return rows;
}

// Export voor unit tests
export const _internal = {
  fetchOffers,
};
