/**
 * Skills-trending service — Sprint Q3.6 (Agent HHH).
 *
 * Aggregaten op basis van `skills_trending_snapshots`:
 *   - getTrendingSkills:   per skill: laatste week vs week ervoor, growth_pct.
 *   - getSkillDemandSupply: per category: huidige open demand (jobs) vs supply
 *                           (candidates) — directe COUNT op de mappings-tabellen,
 *                           geen snapshot-historie nodig.
 *
 * Growth-calculation (week-on-week):
 *   - "demand" = job_demand (open jobs die om deze skill vragen).
 *   - growth_pct = (this_week.job_demand - prev_week.job_demand) / max(1, prev_week.job_demand) * 100.
 *   - Als prev_week ontbreekt: growth_pct = +100 wanneer this_week > 0, anders 0.
 *   - We gebruiken job_demand (niet candidate_count) omdat trending ≈ "wat wordt gevraagd",
 *     wat het meest bruikbare signaal is voor recruiters die rapporteren "skill X stijgt".
 *
 * Scarcity-ratio = job_demand / max(1, candidate_count). >1 = supply-tekort.
 */

import { withTenant } from '../../db/pool';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface TrendingSkill {
  esco_skill_id: string;
  preferred_label: string;
  category: string | null;
  candidate_count: number;
  job_demand: number;
  hire_count: number;
  /** Week-on-week growth-percentage van job_demand (-100 .. +∞). */
  growth_pct: number;
  /** demand / max(1, supply). >1 = tekort. */
  scarcity_ratio: number;
}

export interface DemandSupplyEntry {
  category: string;
  demand: number;
  supply: number;
  gap: number;
}

export interface DemandSupplyResult {
  per_category: DemandSupplyEntry[];
}

export interface GetTrendingOptions {
  category?: string;
  limit?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Geëxporteerd voor unit-tests: bereken growth-percentage week-on-week.
 *
 *   - Beide 0 ⇒ 0 (vlak).
 *   - prev = 0 en current > 0 ⇒ +100 (nieuw signaal — niet Infinity).
 *   - Anders: (current - prev) / prev * 100, afgerond op 2 decimalen.
 */
export function computeGrowthPct(prev: number, current: number): number {
  if (prev === 0 && current === 0) return 0;
  if (prev === 0) return 100;
  const pct = ((current - prev) / prev) * 100;
  return Number(pct.toFixed(2));
}

/**
 * Geëxporteerd voor unit-tests: scarcity-ratio = demand / max(1, supply).
 */
export function computeScarcityRatio(demand: number, supply: number): number {
  const denom = supply <= 0 ? 1 : supply;
  return Number((demand / denom).toFixed(4));
}

// ────────────────────────────────────────────────────────────────────────────
// getTrendingSkills
// ────────────────────────────────────────────────────────────────────────────

interface TrendingRow {
  esco_skill_id: string;
  preferred_label: string;
  category: string | null;
  candidate_count: number | string;
  job_demand: number | string;
  hire_count: number | string;
  prev_job_demand: number | string | null;
}

export async function getTrendingSkills(
  tenantId: string,
  options: GetTrendingOptions = {}
): Promise<TrendingSkill[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));

  return withTenant(tenantId, async (client) => {
    const params: unknown[] = [tenantId];
    let categoryFilter = '';
    if (options.category) {
      params.push(options.category);
      categoryFilter = `AND s.category = $${params.length}`;
    }
    params.push(limit);

    // Self-join: laatste twee snapshots per skill via window functions.
    // LET OP: expliciet op tenant_id filteren. RLS is inert onder de owner-rol,
    // dus zonder deze WHERE lekken snapshots van ALLE tenants door (cross-tenant).
    const { rows } = await client.query<TrendingRow>(
      `WITH ranked AS (
         SELECT t.esco_skill_id,
                t.candidate_count,
                t.job_demand,
                t.hire_count,
                t.week_starting,
                ROW_NUMBER() OVER (
                  PARTITION BY t.esco_skill_id
                  ORDER BY t.week_starting DESC
                ) AS rn
           FROM skills_trending_snapshots t
          WHERE t.tenant_id = $1
       ),
       latest AS (
         SELECT esco_skill_id, candidate_count, job_demand, hire_count
           FROM ranked WHERE rn = 1
       ),
       prev AS (
         SELECT esco_skill_id, job_demand AS prev_job_demand
           FROM ranked WHERE rn = 2
       )
       SELECT l.esco_skill_id,
              s.preferred_label,
              s.category,
              l.candidate_count,
              l.job_demand,
              l.hire_count,
              p.prev_job_demand
         FROM latest l
         JOIN esco_skills s ON s.id = l.esco_skill_id
         LEFT JOIN prev p ON p.esco_skill_id = l.esco_skill_id
        WHERE 1=1 ${categoryFilter}
        ORDER BY l.job_demand DESC NULLS LAST
        LIMIT $${params.length}`,
      params
    );

    const result: TrendingSkill[] = rows.map((r) => {
      const cur = Number(r.job_demand);
      const prev = r.prev_job_demand == null ? 0 : Number(r.prev_job_demand);
      const supply = Number(r.candidate_count);
      return {
        esco_skill_id: r.esco_skill_id,
        preferred_label: r.preferred_label,
        category: r.category,
        candidate_count: supply,
        job_demand: cur,
        hire_count: Number(r.hire_count),
        growth_pct: computeGrowthPct(prev, cur),
        scarcity_ratio: computeScarcityRatio(cur, supply),
      };
    });

    // Sorteer op growth_pct desc — frontend toont het sterkst stijgende eerst.
    result.sort((a, b) => b.growth_pct - a.growth_pct);
    return result;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// getSkillDemandSupply
// ────────────────────────────────────────────────────────────────────────────

interface DemandSupplyRow {
  category: string | null;
  demand: number | string;
  supply: number | string;
}

export async function getSkillDemandSupply(
  tenantId: string
): Promise<DemandSupplyResult> {
  return withTenant(tenantId, async (client) => {
    // Per categorie: hoeveel unieke skills worden door open jobs gevraagd
    // (demand) en door kandidaten geclaimd (supply)?
    //
    // We tellen op het niveau van DISTINCT skill-rijen per category, want
    // recruiters denken in skills-coverage, niet in raw row-counts.
    const { rows } = await client.query<DemandSupplyRow>(
      `WITH job_skills AS (
         SELECT DISTINCT s.category, m.esco_skill_id
           FROM job_skill_mappings m
           JOIN esco_skills s ON s.id = m.esco_skill_id
           JOIN jobs j ON j.id = m.job_id
          WHERE j.deleted_at IS NULL
            AND j.status = 'open'
            AND m.tenant_id = $1
       ),
       cand_skills AS (
         SELECT DISTINCT s.category, m.esco_skill_id
           FROM candidate_skill_mappings m
           JOIN esco_skills s ON s.id = m.esco_skill_id
           JOIN candidates c ON c.id = m.candidate_id
          WHERE c.deleted_at IS NULL
            AND m.tenant_id = $1
       )
       SELECT COALESCE(j.category, c.category) AS category,
              COUNT(j.esco_skill_id)::int AS demand,
              COUNT(c.esco_skill_id)::int AS supply
         FROM job_skills j
         FULL OUTER JOIN cand_skills c
           ON j.category = c.category AND j.esco_skill_id = c.esco_skill_id
        GROUP BY COALESCE(j.category, c.category)
        ORDER BY demand DESC, supply DESC`,
      [tenantId]
    );

    const per_category: DemandSupplyEntry[] = rows.map((r) => {
      const demand = Number(r.demand);
      const supply = Number(r.supply);
      return {
        category: r.category ?? 'Other',
        demand,
        supply,
        gap: demand - supply,
      };
    });

    return { per_category };
  });
}
