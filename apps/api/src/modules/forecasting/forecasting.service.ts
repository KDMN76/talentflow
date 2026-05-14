/**
 * Revenue forecasting + margin reporting service — Sprint Q4.4 (Agent UUU).
 *
 * Two responsibilities:
 *   1. Nightly snapshot: compute expected + pipeline revenue per upcoming
 *      month and UPSERT into `revenue_forecasts`.
 *   2. Margin reporting: aggregate revenue/cost/margin per client OR per
 *      recruiter from contracts × invoices × commission_assignments.
 *
 * Pipeline source = `crm_deals`. We probeerden eerst expliciete velden
 * `expected_value` + `probability`, maar in TalentFlow's huidige schema
 * heeft `crm_deals` `value_eur` + `stage`. We gebruiken een stage→
 * probabiliteit-mapping (heuristic) en faalen graceful als de tabel
 * helemaal afwezig is.
 */

import type { PoolClient } from 'pg';
import { withTenant, pool } from '../../db/pool';
import { logger } from '../../middleware/errorHandler';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export interface RevenueForecastRow {
  id: string;
  tenant_id: string;
  forecast_month: string;
  expected_revenue: number;
  pipeline_revenue: number;
  hires_in_pipeline: number;
  active_contracts: number;
  computed_at: string;
}

export interface MarginReportRow {
  group_id: string | null;
  group_label: string | null;
  total_revenue: number;
  total_cost: number;
  margin_amount: number;
  margin_pct: number;
  invoice_count: number;
}

const STAGE_PROBABILITY: Record<string, number> = {
  prospect: 0.1,
  offerte: 0.4,
  onderhandeling: 0.7,
  gewonnen: 1.0,
  verloren: 0.0,
  // Fallback for english-mode stages encountered elsewhere:
  accepted: 0.95,
  offer: 0.7,
  proposal: 0.5,
  closed_won: 1.0,
  closed_lost: 0.0,
};

function probabilityForStage(stage: string | null | undefined): number {
  if (!stage) return 0.1;
  return STAGE_PROBABILITY[stage.toLowerCase()] ?? 0.1;
}

// ───────────────────────────────────────────────────────────────────────────
// Date helpers
// ───────────────────────────────────────────────────────────────────────────

function firstOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(d: Date, months: number): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate())
  );
}

function lastOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Bereken hoeveel werkbare weken (afgerond) er overlappen tussen een contract-
 * actief-periode en een kalendermaand. We gebruiken kalenderdagen / 7 als
 * fractioneel-week-getal — voldoende precisie voor forecasting (binnen ±0.5
 * werkweek per maand).
 */
function weeksInMonthOverlap(
  monthStart: Date,
  monthEnd: Date,
  contractStart: Date,
  contractEnd: Date | null
): number {
  const a = monthStart.getTime();
  const b = monthEnd.getTime() + 24 * 3600 * 1000; // exclusive
  const cs = contractStart.getTime();
  const ce = contractEnd
    ? contractEnd.getTime() + 24 * 3600 * 1000
    : Number.POSITIVE_INFINITY;
  const overlapStart = Math.max(a, cs);
  const overlapEnd = Math.min(b, ce);
  if (overlapEnd <= overlapStart) return 0;
  const days = (overlapEnd - overlapStart) / (24 * 3600 * 1000);
  return Math.round((days / 7) * 100) / 100;
}

// ───────────────────────────────────────────────────────────────────────────
// Compute forecast for a single tenant
// ───────────────────────────────────────────────────────────────────────────

interface ContractForForecast {
  id: string;
  start_date: string;
  end_date: string | null;
  weekly_hours: number | null;
  hourly_rate_client: number | null;
}

interface DealForPipeline {
  id: string;
  value_eur: number | null;
  stage: string | null;
  expected_close_date: string | null;
}

async function loadActiveContracts(
  client: PoolClient
): Promise<ContractForForecast[]> {
  const { rows } = await client.query<{
    id: string;
    start_date: string;
    end_date: string | null;
    weekly_hours: string | null;
    hourly_rate_client: string | null;
  }>(
    `SELECT id, start_date, end_date, weekly_hours, hourly_rate_client
       FROM contracts
      WHERE status IN ('active','renewed')`
  );
  return rows.map((r) => ({
    id: r.id,
    start_date: r.start_date,
    end_date: r.end_date,
    weekly_hours: r.weekly_hours === null ? null : Number(r.weekly_hours),
    hourly_rate_client:
      r.hourly_rate_client === null ? null : Number(r.hourly_rate_client),
  }));
}

async function loadOpenDeals(client: PoolClient): Promise<DealForPipeline[]> {
  try {
    const { rows } = await client.query<{
      id: string;
      value_eur: string | null;
      stage: string | null;
      expected_close_date: string | null;
    }>(
      `SELECT id, value_eur, stage, expected_close_date
         FROM crm_deals
        WHERE stage NOT IN ('gewonnen','verloren','closed_lost')`
    );
    return rows.map((r) => ({
      id: r.id,
      value_eur: r.value_eur === null ? null : Number(r.value_eur),
      stage: r.stage,
      expected_close_date: r.expected_close_date,
    }));
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '42P01') {
      logger.warn(
        '[forecasting] crm_deals missing — pipeline=0 fallback',
        { error: (err as Error).message }
      );
      return [];
    }
    throw err;
  }
}

export interface ComputedForecastSlice {
  forecast_month: string;
  expected_revenue: number;
  pipeline_revenue: number;
  hires_in_pipeline: number;
  active_contracts: number;
}

export async function computeForecastSlices(
  tenantId: string,
  monthsAhead: number = 6
): Promise<ComputedForecastSlice[]> {
  return withTenant(tenantId, async (client) => {
    const contracts = await loadActiveContracts(client);
    const deals = await loadOpenDeals(client);

    const today = new Date();
    const slices: ComputedForecastSlice[] = [];

    for (let i = 0; i < monthsAhead; i++) {
      const monthStart = firstOfMonth(addMonths(today, i));
      const monthEnd = lastOfMonth(monthStart);
      let expected = 0;
      let activeCount = 0;
      for (const c of contracts) {
        const cs = new Date(`${c.start_date}T00:00:00Z`);
        const ce = c.end_date ? new Date(`${c.end_date}T00:00:00Z`) : null;
        const weeks = weeksInMonthOverlap(monthStart, monthEnd, cs, ce);
        if (weeks > 0) {
          activeCount++;
          if (c.weekly_hours && c.hourly_rate_client) {
            expected +=
              c.weekly_hours * c.hourly_rate_client * weeks;
          }
        }
      }

      let pipeline = 0;
      let hires = 0;
      for (const d of deals) {
        if (!d.expected_close_date) continue;
        const close = new Date(`${d.expected_close_date}T00:00:00Z`);
        if (close >= monthStart && close <= monthEnd) {
          const prob = probabilityForStage(d.stage);
          pipeline += (d.value_eur ?? 0) * prob;
          if (
            d.stage &&
            ['accepted', 'offer', 'onderhandeling', 'gewonnen'].includes(
              d.stage.toLowerCase()
            )
          ) {
            hires++;
          }
        }
      }

      slices.push({
        forecast_month: toIsoDate(monthStart),
        expected_revenue: round2(expected),
        pipeline_revenue: round2(pipeline),
        hires_in_pipeline: hires,
        active_contracts: activeCount,
      });
    }
    return slices;
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function computeForecast(
  tenantId: string,
  monthsAhead: number = 6
): Promise<RevenueForecastRow[]> {
  const slices = await computeForecastSlices(tenantId, monthsAhead);
  return withTenant(tenantId, async (client) => {
    const out: RevenueForecastRow[] = [];
    for (const s of slices) {
      const { rows } = await client.query(
        `INSERT INTO revenue_forecasts
           (tenant_id, forecast_month, expected_revenue, pipeline_revenue,
            hires_in_pipeline, active_contracts, computed_at)
         VALUES ($1, $2::date, $3, $4, $5, $6, now())
         ON CONFLICT (tenant_id, forecast_month) DO UPDATE
           SET expected_revenue   = EXCLUDED.expected_revenue,
               pipeline_revenue   = EXCLUDED.pipeline_revenue,
               hires_in_pipeline  = EXCLUDED.hires_in_pipeline,
               active_contracts   = EXCLUDED.active_contracts,
               computed_at        = now()
         RETURNING *`,
        [
          tenantId,
          s.forecast_month,
          s.expected_revenue,
          s.pipeline_revenue,
          s.hires_in_pipeline,
          s.active_contracts,
        ]
      );
      const r = rows[0];
      out.push({
        id: String(r.id),
        tenant_id: String(r.tenant_id),
        forecast_month: String(r.forecast_month).slice(0, 10),
        expected_revenue: Number(r.expected_revenue),
        pipeline_revenue: Number(r.pipeline_revenue),
        hires_in_pipeline: Number(r.hires_in_pipeline),
        active_contracts: Number(r.active_contracts),
        computed_at: String(r.computed_at),
      });
    }
    return out;
  });
}

export async function getForecasts(
  tenantId: string,
  monthsAhead: number = 6
): Promise<RevenueForecastRow[]> {
  return withTenant(tenantId, async (client) => {
    const today = new Date();
    const start = toIsoDate(firstOfMonth(today));
    const end = toIsoDate(firstOfMonth(addMonths(today, monthsAhead)));
    const { rows } = await client.query(
      `SELECT * FROM revenue_forecasts
        WHERE forecast_month >= $1::date AND forecast_month < $2::date
        ORDER BY forecast_month ASC`,
      [start, end]
    );
    return rows.map((r) => ({
      id: String(r.id),
      tenant_id: String(r.tenant_id),
      forecast_month: String(r.forecast_month).slice(0, 10),
      expected_revenue: Number(r.expected_revenue),
      pipeline_revenue: Number(r.pipeline_revenue),
      hires_in_pipeline: Number(r.hires_in_pipeline),
      active_contracts: Number(r.active_contracts),
      computed_at: String(r.computed_at),
    }));
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Margin report
// ───────────────────────────────────────────────────────────────────────────

export type MarginGroupBy = 'client' | 'recruiter';

export interface MarginReportFilters {
  group_by: MarginGroupBy;
  period_start?: string;
  period_end?: string;
}

export async function getMarginReport(
  tenantId: string,
  filters: MarginReportFilters
): Promise<MarginReportRow[]> {
  return withTenant(tenantId, async (client) => {
    const params: unknown[] = [];
    const conditions: string[] = [`i.status IN ('paid','sent','overdue')`];
    if (filters.period_start) {
      params.push(filters.period_start);
      conditions.push(`i.period_start >= $${params.length}::date`);
    }
    if (filters.period_end) {
      params.push(filters.period_end);
      conditions.push(`i.period_end <= $${params.length}::date`);
    }
    const whereInv = conditions.join(' AND ');

    if (filters.group_by === 'client') {
      const sql = `
        WITH inv AS (
          SELECT i.client_organization_id   AS group_id,
                 i.contract_id,
                 i.id AS invoice_id,
                 i.subtotal_amount,
                 i.period_start, i.period_end
            FROM invoices i
           WHERE ${whereInv}
        ),
        cost AS (
          SELECT inv.invoice_id,
                 COALESCE(SUM(
                   (t.total_hours + t.total_overtime_hours * 1.25)
                   * COALESCE(c.hourly_rate_candidate, 0)
                 ), 0) AS candidate_cost
            FROM inv
            JOIN contracts c ON c.id = inv.contract_id
            LEFT JOIN timesheets t
              ON t.contract_id = inv.contract_id
             AND t.status = 'approved'
             AND (inv.period_start IS NULL OR t.week_start >= inv.period_start::date)
             AND (inv.period_end   IS NULL OR t.week_start <= inv.period_end::date)
           GROUP BY inv.invoice_id
        )
        SELECT inv.group_id,
               COUNT(DISTINCT inv.invoice_id)::int AS invoice_count,
               COALESCE(SUM(inv.subtotal_amount), 0) AS total_revenue,
               COALESCE(SUM(cost.candidate_cost), 0) AS total_cost
          FROM inv
          LEFT JOIN cost ON cost.invoice_id = inv.invoice_id
         GROUP BY inv.group_id
      `;
      const { rows } = await client.query<{
        group_id: string | null;
        invoice_count: number;
        total_revenue: string;
        total_cost: string;
      }>(sql, params);
      return rows.map((r) => buildRow(r.group_id, null, r));
    }

    // group_by === 'recruiter' — match via commission_assignments
    const sql = `
      WITH inv AS (
        SELECT i.id AS invoice_id,
               i.contract_id,
               i.subtotal_amount,
               i.period_start, i.period_end
          FROM invoices i
         WHERE ${whereInv}
      ),
      cost AS (
        SELECT inv.invoice_id,
               COALESCE(SUM(
                 (t.total_hours + t.total_overtime_hours * 1.25)
                 * COALESCE(c.hourly_rate_candidate, 0)
               ), 0) AS candidate_cost
          FROM inv
          JOIN contracts c ON c.id = inv.contract_id
          LEFT JOIN timesheets t
            ON t.contract_id = inv.contract_id
           AND t.status = 'approved'
           AND (inv.period_start IS NULL OR t.week_start >= inv.period_start::date)
           AND (inv.period_end   IS NULL OR t.week_start <= inv.period_end::date)
         GROUP BY inv.invoice_id
      )
      SELECT a.recruiter_id AS group_id,
             COUNT(DISTINCT inv.invoice_id)::int AS invoice_count,
             COALESCE(SUM(inv.subtotal_amount * a.share_percent / 100.0), 0) AS total_revenue,
             COALESCE(SUM(cost.candidate_cost * a.share_percent / 100.0), 0) AS total_cost
        FROM inv
        JOIN commission_assignments a ON a.contract_id = inv.contract_id
        LEFT JOIN cost ON cost.invoice_id = inv.invoice_id
       GROUP BY a.recruiter_id
    `;
    const { rows } = await client.query<{
      group_id: string | null;
      invoice_count: number;
      total_revenue: string;
      total_cost: string;
    }>(sql, params);
    return rows.map((r) => buildRow(r.group_id, null, r));
  });
}

function buildRow(
  groupId: string | null,
  label: string | null,
  raw: { invoice_count: number; total_revenue: string; total_cost: string }
): MarginReportRow {
  const revenue = Number(raw.total_revenue ?? 0);
  const cost = Number(raw.total_cost ?? 0);
  const margin = revenue - cost;
  const marginPct = revenue > 0 ? round2((margin / revenue) * 100) : 0;
  return {
    group_id: groupId,
    group_label: label,
    total_revenue: round2(revenue),
    total_cost: round2(cost),
    margin_amount: round2(margin),
    margin_pct: marginPct,
    invoice_count: Number(raw.invoice_count ?? 0),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Cron entry point
// ───────────────────────────────────────────────────────────────────────────

export async function computeForecastForAllTenants(
  monthsAhead = 6
): Promise<{ tenants: number; slices: number }> {
  const client = await pool.connect();
  let tenants = 0;
  let slices = 0;
  try {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM tenants`
    );
    for (const t of rows) {
      try {
        const out = await computeForecast(t.id, monthsAhead);
        tenants++;
        slices += out.length;
      } catch (err) {
        logger.warn('[forecasting] tenant compute failed', {
          tenant_id: t.id,
          error: (err as Error).message,
        });
      }
    }
  } finally {
    client.release();
  }
  return { tenants, slices };
}
