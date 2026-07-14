/**
 * Bridge naar TTT's timesheets-module — Sprint Q4.4 (Agent UUU).
 *
 * TTT exposeert (eventueel later) `summarizeApprovedHoursForBilling()` in
 * `apps/api/src/modules/timesheets/timesheets.service.ts`. Onze invoicing-
 * service mag echter NIET hard-importeren — TTT's module bestaat in een
 * parallel-spoor en kan op deze sprint nog niet aanwezig zijn.
 *
 * Strategie: dynamic import met fallback. Als de module afwezig is, val
 * direct terug op een query op `timesheets` + `timesheet_entries` (TTT's
 * 027-migratie heeft die tabellen sowieso aangemaakt en RLS+kolommen-shape
 * is bekend).
 *
 * Zo:
 *   - In de happy path (TTT live) gebruiken we hun canonical implementatie.
 *   - In de tussentijd werkt onze code zelfstandig, blijft TS clean en gaan
 *     onze tests groen op een mockable bridge.
 */

import type { PoolClient } from 'pg';
import { withTenant } from '../../db/pool';

export interface TimesheetWeekSummary {
  week_start: string;
  hours: number;
  overtime_hours: number;
  amount_candidate: number;
  amount_client: number;
}

export interface TimesheetSummary {
  total_hours: number;
  total_overtime_hours: number;
  total_amount_candidate: number;
  total_amount_client: number;
  currency: string;
  by_week: TimesheetWeekSummary[];
}

interface TimesheetsServiceShape {
  summarizeApprovedHoursForBilling: (
    tenantId: string,
    contractId: string,
    periodStart: string,
    periodEnd: string
  ) => Promise<TimesheetSummary>;
}

let cached: TimesheetsServiceShape | null | undefined;

async function tryLoadTttService(): Promise<TimesheetsServiceShape | null> {
  if (cached !== undefined) return cached;
  try {
    // Dynamic — node resolves vanaf src/modules/billing → ../timesheets/...
    const mod = (await import('../timesheets/timesheets.service')) as Partial<TimesheetsServiceShape>;
    if (typeof mod.summarizeApprovedHoursForBilling === 'function') {
      cached = { summarizeApprovedHoursForBilling: mod.summarizeApprovedHoursForBilling };
      return cached;
    }
    cached = null;
    return null;
  } catch {
    cached = null;
    return null;
  }
}

/**
 * Test-helper: forceer een specifieke implementatie. Bij `null` gaat de
 * bridge weer naar de DB-fallback. Bij een mock-object gebruiken we die.
 */
export function _setTimesheetsBridgeForTests(
  impl: TimesheetsServiceShape | null
): void {
  cached = impl;
}

async function fallbackSummary(
  client: PoolClient,
  tenantId: string,
  contractId: string,
  periodStart: string,
  periodEnd: string
): Promise<TimesheetSummary> {
  // Hourly rates uit contracts (TTT's tabel) lezen.
  const { rows: contractRows } = await client.query<{
    hourly_rate_candidate: string | null;
    hourly_rate_client: string | null;
    currency: string;
    metadata: unknown;
  }>(
    `SELECT hourly_rate_candidate, hourly_rate_client, currency, metadata
       FROM contracts
      WHERE id = $1 AND tenant_id = $2`,
    [contractId, tenantId]
  );
  const contract = contractRows[0];
  const rateCand = contract?.hourly_rate_candidate
    ? Number(contract.hourly_rate_candidate)
    : 0;
  const rateClient = contract?.hourly_rate_client
    ? Number(contract.hourly_rate_client)
    : 0;
  const currency = contract?.currency ?? 'EUR';
  // Overtime-factor canoniek (zie timesheets.service): per-contract
  // metadata-override of de NL CAO-default 1.5 (voorheen hardcoded 1.25).
  const overtimeMult = resolveOvertimeMultiplier(contract?.metadata);

  // Approved timesheets within the period.
  const { rows: weekRows } = await client.query<{
    week_start: string;
    total_hours: string;
    total_overtime_hours: string;
  }>(
    `SELECT to_char(week_start, 'YYYY-MM-DD') AS week_start,
            total_hours,
            total_overtime_hours
       FROM timesheets
      WHERE contract_id = $1
        AND tenant_id = $2
        AND status = 'approved'
        AND week_start >= $3::date
        AND week_start <= $4::date
      ORDER BY week_start ASC`,
    [contractId, tenantId, periodStart, periodEnd]
  );

  let totalHours = 0;
  let totalOvertime = 0;
  let totalAmountCandidate = 0;
  let totalAmountClient = 0;
  const byWeek: TimesheetWeekSummary[] = weekRows.map((r) => {
    const hours = Number(r.total_hours ?? 0);
    const ot = Number(r.total_overtime_hours ?? 0);
    const amountCand = (hours + ot * overtimeMult) * rateCand;
    const amountClient = (hours + ot * overtimeMult) * rateClient;
    totalHours += hours;
    totalOvertime += ot;
    totalAmountCandidate += amountCand;
    totalAmountClient += amountClient;
    return {
      week_start: r.week_start,
      hours,
      overtime_hours: ot,
      amount_candidate: round2(amountCand),
      amount_client: round2(amountClient),
    };
  });
  return {
    total_hours: round2(totalHours),
    total_overtime_hours: round2(totalOvertime),
    total_amount_candidate: round2(totalAmountCandidate),
    total_amount_client: round2(totalAmountClient),
    currency,
    by_week: byWeek,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Overtime-multiplier canoniek resolven — spiegelt
 * timesheets.service.summarizeApprovedHoursForBilling: gebruik
 * contract.metadata.overtime_multiplier zodra dat een positief getal is,
 * anders de NL CAO-default van 1.5.
 */
function resolveOvertimeMultiplier(metadata: unknown): number {
  let meta: Record<string, unknown> = {};
  if (metadata && typeof metadata === 'object') {
    meta = metadata as Record<string, unknown>;
  } else if (typeof metadata === 'string') {
    try {
      meta = JSON.parse(metadata) as Record<string, unknown>;
    } catch {
      meta = {};
    }
  }
  const m = meta.overtime_multiplier;
  return typeof m === 'number' && m > 0 ? m : 1.5;
}

export async function summarizeApprovedHoursForBilling(
  tenantId: string,
  contractId: string,
  periodStart: string,
  periodEnd: string
): Promise<TimesheetSummary> {
  const ttt = await tryLoadTttService();
  if (ttt) {
    return ttt.summarizeApprovedHoursForBilling(
      tenantId,
      contractId,
      periodStart,
      periodEnd
    );
  }
  return withTenant(tenantId, (client) =>
    fallbackSummary(client, tenantId, contractId, periodStart, periodEnd)
  );
}
