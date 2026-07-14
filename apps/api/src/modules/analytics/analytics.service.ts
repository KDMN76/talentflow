import { withTenant } from '../../db/pool';
import {
  bucketAge,
  computeAge,
  normalizeGender,
} from '../compliance/payEquity.service';
import { bucketNationality } from '../compliance/deiFunnel.service';

/**
 * Gedeelde filters voor de analytiek-endpoints.
 *   - from/to: ISO-datums (periode). Per metric geldt een eigen default zodat
 *     bestaand gedrag behouden blijft als er géén periode is gekozen.
 *   - recruiterId: scope alles op de vacatures van één recruiter.
 * Momentopname-KPI's (open vacatures nu, actieve recruiters nu) negeren de
 * periode bewust — die horen "huidig" te zijn.
 */
export interface AnalyticsFilters {
  from?: string | null;
  to?: string | null;
  recruiterId?: string | null;
}

function norm(filters: AnalyticsFilters) {
  return {
    from: filters.from ?? null,
    to: filters.to ?? null,
    recruiterId: filters.recruiterId ?? null,
  };
}

export async function getOverview(
  tenantId: string,
  filters: AnalyticsFilters = {}
): Promise<{
  open_jobs: number;
  total_candidates: number;
  applications_this_month: number;
  avg_time_to_hire_days: number;
  hired_this_month: number;
  active_recruiters: number;
}> {
  const { from, to, recruiterId } = norm(filters);
  try {
    return await withTenant(tenantId, async (client) => {
      // Momentopname: open vacatures nu (alleen recruiter-scope).
      const { rows: [openJobsRow] } = await client.query(
        `SELECT COUNT(*) as count FROM jobs
         WHERE tenant_id = $1 AND status = 'open' AND deleted_at IS NULL
           AND ($2::uuid IS NULL OR recruiter_id = $2)`,
        [tenantId, recruiterId]
      );

      // Momentopname: totaal kandidaten (tenant-breed).
      const { rows: [totalCandidatesRow] } = await client.query(
        `SELECT COUNT(*) as count FROM candidates WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [tenantId]
      );

      // Periode-cijfer (default: deze maand) + recruiter via job.
      const { rows: [applicationsMonthRow] } = await client.query(
        `SELECT COUNT(*) as count
         FROM applications a JOIN jobs j ON j.id = a.job_id AND j.tenant_id = $1
         WHERE a.tenant_id = $1
           AND a.applied_at >= COALESCE($3::timestamptz, date_trunc('month', now()))
           AND ($4::timestamptz IS NULL OR a.applied_at < $4)
           AND ($2::uuid IS NULL OR j.recruiter_id = $2)`,
        [tenantId, recruiterId, from, to]
      );

      // Periode-cijfer (default: all-time) + recruiter.
      const { rows: [avgTimeRow] } = await client.query(
        // time-to-hire = tijd tot het job 'filled' werd. filled_at is het echte
        // hire-moment (gezet op de status→filled-transitie), niet de handmatige
        // close_date; consistent met de report-aggregator.
        `SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (filled_at - created_at)) / 86400), 0) as avg_days
         FROM jobs
         WHERE tenant_id = $1 AND filled_at IS NOT NULL AND deleted_at IS NULL
           AND ($2::uuid IS NULL OR recruiter_id = $2)
           AND ($3::timestamptz IS NULL OR filled_at >= $3)
           AND ($4::timestamptz IS NULL OR filled_at < $4)`,
        [tenantId, recruiterId, from, to]
      );

      // Periode-cijfer (default: deze maand) + recruiter via job.
      const { rows: [hiredMonthRow] } = await client.query(
        `SELECT COUNT(*) as count
         FROM applications a JOIN jobs j ON j.id = a.job_id AND j.tenant_id = $1
         WHERE a.tenant_id = $1 AND a.status = 'hired'
           AND a.updated_at >= COALESCE($3::timestamptz, date_trunc('month', now()))
           AND ($4::timestamptz IS NULL OR a.updated_at < $4)
           AND ($2::uuid IS NULL OR j.recruiter_id = $2)`,
        [tenantId, recruiterId, from, to]
      );

      // Momentopname: actieve recruiters nu (bij recruiter-filter wordt dit 0/1).
      const { rows: [activeRecruitersRow] } = await client.query(
        `SELECT COUNT(DISTINCT recruiter_id) as count FROM jobs
         WHERE tenant_id = $1 AND status = 'open' AND deleted_at IS NULL AND recruiter_id IS NOT NULL
           AND ($2::uuid IS NULL OR recruiter_id = $2)`,
        [tenantId, recruiterId]
      );

      return {
        open_jobs: parseInt(openJobsRow.count, 10),
        total_candidates: parseInt(totalCandidatesRow.count, 10),
        applications_this_month: parseInt(applicationsMonthRow.count, 10),
        avg_time_to_hire_days: Math.round(parseFloat(avgTimeRow.avg_days) * 10) / 10,
        hired_this_month: parseInt(hiredMonthRow.count, 10),
        active_recruiters: parseInt(activeRecruitersRow.count, 10),
      };
    });
  } catch {
    // Geen verzonnen demo-cijfers: bij een fout tonen we eerlijke nullen.
    return {
      open_jobs: 0,
      total_candidates: 0,
      applications_this_month: 0,
      avg_time_to_hire_days: 0,
      hired_this_month: 0,
      active_recruiters: 0,
    };
  }
}

export async function getFunnel(
  tenantId: string,
  filters: AnalyticsFilters = {}
): Promise<Array<{
  stage_name: string;
  count: number;
  conversion_rate: number;
}>> {
  const { from, to, recruiterId } = norm(filters);
  try {
    return await withTenant(tenantId, async (client) => {
      // Periode default = all-time (de funnel is een momentopname van de huidige
      // verdeling); zodra een periode is gekozen, tel alleen sollicitaties daarin.
      const { rows } = await client.query(
        `SELECT ps.name as stage_name, COUNT(a.id) as count, ps.position
         FROM pipeline_stages ps
         LEFT JOIN applications a ON a.stage_id = ps.id AND a.tenant_id = $1
           AND ($3::timestamptz IS NULL OR a.applied_at >= $3)
           AND ($4::timestamptz IS NULL OR a.applied_at < $4)
           AND ($2::uuid IS NULL OR a.job_id IN (
             SELECT id FROM jobs WHERE tenant_id = $1 AND recruiter_id = $2
           ))
         WHERE ps.tenant_id = $1
         GROUP BY ps.name, ps.position
         ORDER BY ps.position`,
        [tenantId, recruiterId, from, to]
      );

      const total = rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0);

      return rows.map((r) => ({
        stage_name: r.stage_name,
        count: parseInt(r.count, 10),
        conversion_rate: total > 0 ? Math.round((parseInt(r.count, 10) / total) * 1000) / 10 : 0,
      }));
    });
  } catch {
    return [];
  }
}

export async function getRecruiterStats(
  tenantId: string,
  filters: AnalyticsFilters = {}
): Promise<Array<{
  recruiter_id: string;
  recruiter_name: string;
  open_jobs: number;
  applications_this_month: number;
  hires_this_month: number;
  avg_time_to_hire_days: number;
}>> {
  const { from, to, recruiterId } = norm(filters);
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT
           u.id as recruiter_id,
           u.name as recruiter_name,
           COUNT(DISTINCT j.id) FILTER (WHERE j.status = 'open' AND j.deleted_at IS NULL) as open_jobs,
           COUNT(DISTINCT a.id) FILTER (
             WHERE a.applied_at >= COALESCE($3::timestamptz, date_trunc('month', now()))
               AND ($4::timestamptz IS NULL OR a.applied_at < $4)
           ) as applications_this_month,
           COUNT(DISTINCT a.id) FILTER (
             WHERE a.status = 'hired'
               AND a.updated_at >= COALESCE($3::timestamptz, date_trunc('month', now()))
               AND ($4::timestamptz IS NULL OR a.updated_at < $4)
           ) as hires_this_month,
           COALESCE(AVG(EXTRACT(EPOCH FROM (j.filled_at - j.created_at)) / 86400) FILTER (WHERE j.filled_at IS NOT NULL), 0) as avg_time_to_hire_days
         FROM users u
         LEFT JOIN jobs j ON j.recruiter_id = u.id AND j.tenant_id = $1 AND j.deleted_at IS NULL
         LEFT JOIN applications a ON a.job_id = j.id AND a.tenant_id = $1
         WHERE u.tenant_id = $1
           AND ($2::uuid IS NULL OR u.id = $2)
         GROUP BY u.id, u.name
         ORDER BY open_jobs DESC, applications_this_month DESC`,
        [tenantId, recruiterId, from, to]
      );

      return rows.map((r) => ({
        recruiter_id: r.recruiter_id,
        recruiter_name: r.recruiter_name,
        open_jobs: parseInt(r.open_jobs, 10),
        applications_this_month: parseInt(r.applications_this_month, 10),
        hires_this_month: parseInt(r.hires_this_month, 10),
        avg_time_to_hire_days: Math.round(parseFloat(r.avg_time_to_hire_days) * 10) / 10,
      }));
    });
  } catch {
    return [];
  }
}

export async function getSourceBreakdown(
  tenantId: string,
  filters: AnalyticsFilters = {}
): Promise<Array<{
  source: string;
  count: number;
  percentage: number;
}>> {
  const { from, to, recruiterId } = norm(filters);
  try {
    return await withTenant(tenantId, async (client) => {
      // Periode default = all-time; recruiter = kandidaten die op zijn/haar
      // vacatures hebben gesolliciteerd.
      const { rows } = await client.query(
        `SELECT COALESCE(c.source, 'Unknown') as source, COUNT(*) as count
         FROM candidates c
         WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
           AND ($3::timestamptz IS NULL OR c.created_at >= $3)
           AND ($4::timestamptz IS NULL OR c.created_at < $4)
           AND ($2::uuid IS NULL OR c.id IN (
             SELECT a.candidate_id FROM applications a
             JOIN jobs j ON j.id = a.job_id
             WHERE j.tenant_id = $1 AND j.recruiter_id = $2
           ))
         GROUP BY c.source
         ORDER BY count DESC`,
        [tenantId, recruiterId, from, to]
      );

      const total = rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0);

      return rows.map((r) => ({
        source: r.source,
        count: parseInt(r.count, 10),
        percentage: total > 0 ? Math.round((parseInt(r.count, 10) / total) * 1000) / 10 : 0,
      }));
    });
  } catch {
    return [];
  }
}

export async function getTimeToHireTrend(
  tenantId: string,
  filters: AnalyticsFilters = {}
): Promise<Array<{
  month: string;
  avg_days: number;
}>> {
  const { from, to, recruiterId } = norm(filters);
  try {
    return await withTenant(tenantId, async (client) => {
      // Periode default = laatste 6 maanden; recruiter-scope optioneel.
      const { rows } = await client.query(
        `SELECT
           to_char(date_trunc('month', created_at), 'Mon YYYY') as month,
           COALESCE(
             AVG(EXTRACT(EPOCH FROM (close_date::timestamptz - created_at)) / 86400) FILTER (WHERE close_date::timestamptz IS NOT NULL),
             0
           ) as avg_days
         FROM jobs
         WHERE tenant_id = $1 AND deleted_at IS NULL
           AND created_at >= COALESCE($3::timestamptz, now() - interval '6 months')
           AND ($4::timestamptz IS NULL OR created_at < $4)
           AND ($2::uuid IS NULL OR recruiter_id = $2)
         GROUP BY date_trunc('month', created_at)
         ORDER BY date_trunc('month', created_at) ASC
         LIMIT 24`,
        [tenantId, recruiterId, from, to]
      );

      return rows.map((r) => ({
        month: r.month,
        avg_days: Math.round(parseFloat(r.avg_days) * 10) / 10,
      }));
    });
  } catch {
    return [];
  }
}

export async function getApplicationsTrend(
  tenantId: string,
  filters: AnalyticsFilters = {}
): Promise<Array<{
  week: string;
  count: number;
}>> {
  const { from, to, recruiterId } = norm(filters);
  try {
    return await withTenant(tenantId, async (client) => {
      // Periode default = laatste 8 weken; recruiter via job.
      const { rows } = await client.query(
        `SELECT
           to_char(date_trunc('week', a.applied_at), 'DD Mon') as week,
           COUNT(*) as count
         FROM applications a
         WHERE a.tenant_id = $1
           AND a.applied_at >= COALESCE($3::timestamptz, now() - interval '8 weeks')
           AND ($4::timestamptz IS NULL OR a.applied_at < $4)
           AND ($2::uuid IS NULL OR a.job_id IN (
             SELECT id FROM jobs WHERE tenant_id = $1 AND recruiter_id = $2
           ))
         GROUP BY date_trunc('week', a.applied_at)
         ORDER BY MIN(a.applied_at)
         LIMIT 52`,
        [tenantId, recruiterId, from, to]
      );

      return rows.map((r) => ({
        week: r.week,
        count: parseInt(r.count, 10),
      }));
    });
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI & Bias — Sprint Q4.6 (EU AI Act bias-monitoring op het analytics-dashboard)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 4/5-regel (four-fifths rule, EEOC): de selectieratio van elke groep moet
 * minimaal 80% zijn van de ratio van de best scorende groep. Groepen kleiner
 * dan ADVERSE_IMPACT_MIN_GROUP_SIZE zijn statistisch te klein voor een
 * betrouwbare uitspraak en worden als 'onvoldoende data' gemarkeerd.
 */
export const FOUR_FIFTHS_THRESHOLD = 0.8;
export const ADVERSE_IMPACT_MIN_GROUP_SIZE = 30;

export interface AdverseImpactGroupInput {
  group: string;
  total: number;
  selected: number;
}

export interface AdverseImpactGroupResult {
  group: string;
  total: number;
  selected: number;
  /** selected / total, 4 decimalen. 0 bij total = 0. */
  selection_rate: number;
  /**
   * selection_rate gedeeld door de rate van de referentiegroep (hoogste
   * rate onder groepen met voldoende data, exclusief 'unknown').
   * null wanneer onvoldoende data of geen referentie beschikbaar.
   */
  impact_ratio: number | null;
  /** true = ratio ≥ 0.8 (4/5-regel). null wanneer geen ratio te bepalen. */
  passes_four_fifths: boolean | null;
  /** true wanneer total < ADVERSE_IMPACT_MIN_GROUP_SIZE. */
  insufficient_data: boolean;
  /** true voor de referentiegroep zelf. */
  is_reference: boolean;
}

/**
 * Pure adverse-impact-berekening — exported voor tests.
 *
 * Referentiegroep = hoogste selection-rate onder groepen met ≥ 30 records,
 * exclusief 'unknown' (een onbekende demografie kan geen benchmark zijn).
 * Wanneer géén enkele groep voldoende data heeft is er geen referentie en
 * krijgt iedere groep impact_ratio null.
 */
export function computeAdverseImpact(
  groups: AdverseImpactGroupInput[]
): AdverseImpactGroupResult[] {
  const rate = (g: AdverseImpactGroupInput): number =>
    g.total > 0 ? g.selected / g.total : 0;

  let referenceGroup: string | null = null;
  let referenceRate = 0;
  for (const g of groups) {
    if (g.group === 'unknown') continue;
    if (g.total < ADVERSE_IMPACT_MIN_GROUP_SIZE) continue;
    const r = rate(g);
    if (referenceGroup === null || r > referenceRate) {
      referenceGroup = g.group;
      referenceRate = r;
    }
  }

  return groups.map((g) => {
    const selectionRate = Number(rate(g).toFixed(4));
    const insufficient = g.total < ADVERSE_IMPACT_MIN_GROUP_SIZE;

    let impactRatio: number | null = null;
    let passes: boolean | null = null;

    if (!insufficient && referenceGroup !== null && referenceRate > 0) {
      impactRatio = Number((rate(g) / referenceRate).toFixed(4));
      passes = impactRatio >= FOUR_FIFTHS_THRESHOLD;
    }

    return {
      group: g.group,
      total: g.total,
      selected: g.selected,
      selection_rate: selectionRate,
      impact_ratio: impactRatio,
      passes_four_fifths: passes,
      insufficient_data: insufficient,
      is_reference: g.group === referenceGroup,
    };
  });
}

export type AdverseImpactDimension = 'gender' | 'age_bracket' | 'nationality';

export interface AdverseImpactReport {
  /** Definitie van 'geselecteerd': sollicitaties met status 'hired'. */
  selected_definition: 'hired';
  min_group_size: number;
  four_fifths_threshold: number;
  total_applications: number;
  dimensions: Array<{
    dimension: AdverseImpactDimension;
    groups: AdverseImpactGroupResult[];
  }>;
}

/**
 * Adverse-impact-ratio's over de sollicitaties in de gekozen periode
 * (default: laatste 12 maanden). Bucketing hergebruikt de compliance-
 * helpers (normalizeGender / bucketAge / bucketNationality) zodat dezelfde
 * groepsdefinities gelden als in de DEI-funnel en pay-equity.
 */
export async function getAdverseImpact(
  tenantId: string,
  filters: AnalyticsFilters = {}
): Promise<AdverseImpactReport> {
  const { from, to } = norm(filters);
  const empty: AdverseImpactReport = {
    selected_definition: 'hired',
    min_group_size: ADVERSE_IMPACT_MIN_GROUP_SIZE,
    four_fifths_threshold: FOUR_FIFTHS_THRESHOLD,
    total_applications: 0,
    dimensions: [
      { dimension: 'gender', groups: [] },
      { dimension: 'age_bracket', groups: [] },
      { dimension: 'nationality', groups: [] },
    ],
  };
  try {
    return await withTenant(tenantId, async (client) => {
      const refDate = to ? new Date(to) : new Date();
      const { rows } = await client.query<{
        status: string;
        gender: string | null;
        birthdate: string | null;
        nationalities: string[] | null;
      }>(
        `SELECT a.status,
                c.gender,
                c.birthdate::text AS birthdate,
                c.nationalities
           FROM applications a
           JOIN candidates c ON c.id = a.candidate_id AND c.tenant_id = a.tenant_id
          WHERE a.tenant_id = $1
            AND a.applied_at >= COALESCE($2::timestamptz, now() - interval '12 months')
            AND ($3::timestamptz IS NULL OR a.applied_at < $3)
            AND c.anonymized_at IS NULL`,
        [tenantId, from, to]
      );

      const buckets: Record<AdverseImpactDimension, Map<string, { total: number; selected: number }>> = {
        gender: new Map(),
        age_bracket: new Map(),
        nationality: new Map(),
      };

      const add = (
        dim: AdverseImpactDimension,
        group: string,
        hired: boolean
      ) => {
        const entry = buckets[dim].get(group) ?? { total: 0, selected: 0 };
        entry.total += 1;
        if (hired) entry.selected += 1;
        buckets[dim].set(group, entry);
      };

      for (const r of rows) {
        const hired = r.status === 'hired';
        add('gender', normalizeGender(r.gender), hired);
        add('age_bracket', bucketAge(computeAge(r.birthdate, refDate)), hired);
        add('nationality', bucketNationality(r.nationalities), hired);
      }

      const toResults = (dim: AdverseImpactDimension) =>
        computeAdverseImpact(
          [...buckets[dim].entries()]
            .map(([group, v]) => ({ group, total: v.total, selected: v.selected }))
            .sort((a, b) => b.total - a.total)
        );

      return {
        selected_definition: 'hired' as const,
        min_group_size: ADVERSE_IMPACT_MIN_GROUP_SIZE,
        four_fifths_threshold: FOUR_FIFTHS_THRESHOLD,
        total_applications: rows.length,
        dimensions: [
          { dimension: 'gender' as const, groups: toResults('gender') },
          { dimension: 'age_bracket' as const, groups: toResults('age_bracket') },
          { dimension: 'nationality' as const, groups: toResults('nationality') },
        ],
      };
    });
  } catch {
    return empty;
  }
}

export interface AiUsageMonth {
  /** 'YYYY-MM' — sorteerbaar. */
  month: string;
  /** 'Jan 2026' — as-label. */
  month_label: string;
  total: number;
  by_feature: Record<string, number>;
}

export interface AiUsageTrend {
  months: AiUsageMonth[];
  /** Distinct features, gesorteerd op totaal gebruik (desc) — voor stacked charts. */
  features: string[];
}

/**
 * AI-gebruik per maand uit ai_events (default: laatste 12 maanden).
 * Alleen counts per feature — geen prompts, hashes of kosten.
 */
export async function getAiUsageTrend(
  tenantId: string,
  filters: AnalyticsFilters = {}
): Promise<AiUsageTrend> {
  const { from, to } = norm(filters);
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query<{
        month: string;
        month_label: string;
        feature: string;
        count: string;
      }>(
        `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM')  AS month,
                to_char(date_trunc('month', created_at), 'Mon YYYY') AS month_label,
                feature,
                COUNT(*) AS count
           FROM ai_events
          WHERE tenant_id = $1
            AND created_at >= COALESCE($2::timestamptz, now() - interval '12 months')
            AND ($3::timestamptz IS NULL OR created_at < $3)
          GROUP BY 1, 2, 3
          ORDER BY 1 ASC`,
        [tenantId, from, to]
      );

      const monthMap = new Map<string, AiUsageMonth>();
      const featureTotals = new Map<string, number>();
      for (const r of rows) {
        const count = parseInt(r.count, 10) || 0;
        const entry = monthMap.get(r.month) ?? {
          month: r.month,
          month_label: r.month_label,
          total: 0,
          by_feature: {},
        };
        entry.total += count;
        entry.by_feature[r.feature] = (entry.by_feature[r.feature] ?? 0) + count;
        monthMap.set(r.month, entry);
        featureTotals.set(r.feature, (featureTotals.get(r.feature) ?? 0) + count);
      }

      return {
        months: [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
        features: [...featureTotals.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([f]) => f),
      };
    });
  } catch {
    return { months: [], features: [] };
  }
}

export interface MatchScoreBucket {
  /** '0-10' t/m '90-100' (score × 100). */
  bucket: string;
  /** Ondergrens van de bucket in % — voor sortering/as. */
  from_pct: number;
  count: number;
}

export interface MatchScoreDistribution {
  buckets: MatchScoreBucket[];
  total: number;
  avg_score_pct: number;
}

/**
 * Verdeling van AI-match-scores (match_scores.score, cosine similarity
 * 0..1) in 10 buckets van 10%. Alle 10 buckets worden altijd geretourneerd,
 * ook wanneer leeg — zo blijft de histogram-as stabiel.
 */
export async function getMatchScoreDistribution(
  tenantId: string,
  filters: AnalyticsFilters = {}
): Promise<MatchScoreDistribution> {
  const { from, to } = norm(filters);
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query<{
        bucket_idx: number;
        count: string;
      }>(
        `SELECT LEAST(FLOOR(score * 10), 9)::int AS bucket_idx,
                COUNT(*) AS count
           FROM match_scores
          WHERE tenant_id = $1
            AND ($2::timestamptz IS NULL OR computed_at >= $2)
            AND ($3::timestamptz IS NULL OR computed_at < $3)
          GROUP BY 1
          ORDER BY 1 ASC`,
        [tenantId, from, to]
      );
      const { rows: [aggRow] } = await client.query<{
        total: string;
        avg_score: string | null;
      }>(
        `SELECT COUNT(*) AS total, AVG(score) AS avg_score
           FROM match_scores
          WHERE tenant_id = $1
            AND ($2::timestamptz IS NULL OR computed_at >= $2)
            AND ($3::timestamptz IS NULL OR computed_at < $3)`,
        [tenantId, from, to]
      );

      const counts = new Map<number, number>();
      for (const r of rows) {
        counts.set(Number(r.bucket_idx), parseInt(r.count, 10) || 0);
      }
      const buckets: MatchScoreBucket[] = Array.from({ length: 10 }, (_, i) => ({
        bucket: `${i * 10}-${(i + 1) * 10}`,
        from_pct: i * 10,
        count: counts.get(i) ?? 0,
      }));

      return {
        buckets,
        total: parseInt(aggRow?.total ?? '0', 10) || 0,
        avg_score_pct:
          aggRow?.avg_score !== null && aggRow?.avg_score !== undefined
            ? Math.round(parseFloat(aggRow.avg_score) * 1000) / 10
            : 0,
      };
    });
  } catch {
    return { buckets: [], total: 0, avg_score_pct: 0 };
  }
}
