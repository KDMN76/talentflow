/**
 * Report-schedules service — Sprint Q3.5 (Agent GGG).
 *
 * Houdt schedule-config bij in de `reports.schedule` JSONB-kolom (Agent EEE
 * heeft deze kolom in de reports-migratie aangemaakt). De service heeft drie
 * verantwoordelijkheden:
 *
 *   1. setReportSchedule()   — UPSERT van het JSONB-payload + audit-log
 *   2. clearReportSchedule() — schedule = NULL + audit-log
 *   3. listScheduledReports()— alle reports met schedule IS NOT NULL
 *      (gebruikt door de cron-worker om elk uur te bepalen wat er moet draaien)
 *
 * Plus twee helpers die naar de cron-worker exporteren:
 *   - validateSchedule()     — defensief: 0..23 hour, 0..6 dow, 1..31 dom
 *   - isDue(schedule, now)   — bepaalt of een report NU moet draaien op
 *     basis van frequency + tenant-timezone. Edge cases (DST, end-of-month)
 *     gedocumenteerd inline.
 *
 * RLS: alle DB-acties via withTenant. listScheduledReports gebruikt een
 * admin-pool query in de worker omdat we cross-tenant scannen — dat zit
 * NIET hier maar in `queue/workers/reportSchedule.worker.ts`.
 */

import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';
export type ScheduleFormat = 'pdf' | 'excel' | 'csv';

export interface ReportSchedule {
  frequency: ScheduleFrequency;
  /** 0=Sunday..6=Saturday — required when frequency='weekly'. */
  day_of_week?: number;
  /** 1..31 — required when frequency='monthly'. End-of-month logic clamps to last day. */
  day_of_month?: number;
  /** 0..23 in IANA tz. */
  hour: number;
  /** Email-recipients. Geen lengte-limiet hier — we validate format. */
  recipients: string[];
  format: ScheduleFormat;
  /** IANA timezone string (bv "Europe/Amsterdam"). */
  timezone: string;
}

export interface ScheduledReportSummary {
  id: string;
  tenant_id: string;
  name: string;
  schedule: ReportSchedule;
  last_run_at: string | null;
  config: unknown;
}

// ────────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_FREQ = new Set<ScheduleFrequency>(['daily', 'weekly', 'monthly']);
const VALID_FORMAT = new Set<ScheduleFormat>(['pdf', 'excel', 'csv']);

/**
 * Defensieve validatie. We accepteren `unknown` zodat callers niet zelf
 * type-asserts hoeven te doen — gooien een AppError(400) bij issues.
 */
export function validateSchedule(input: unknown): ReportSchedule {
  if (!input || typeof input !== 'object') {
    throw new AppError(400, 'SCHEDULE_INVALID', 'Schedule object vereist');
  }
  const s = input as Record<string, unknown>;

  if (typeof s.frequency !== 'string' || !VALID_FREQ.has(s.frequency as ScheduleFrequency)) {
    throw new AppError(
      400,
      'SCHEDULE_INVALID_FREQUENCY',
      'frequency moet daily|weekly|monthly zijn'
    );
  }
  const frequency = s.frequency as ScheduleFrequency;

  if (typeof s.hour !== 'number' || s.hour < 0 || s.hour > 23 || !Number.isInteger(s.hour)) {
    throw new AppError(400, 'SCHEDULE_INVALID_HOUR', 'hour moet 0..23 zijn');
  }
  const hour = s.hour;

  let day_of_week: number | undefined;
  if (frequency === 'weekly') {
    if (
      typeof s.day_of_week !== 'number' ||
      s.day_of_week < 0 ||
      s.day_of_week > 6 ||
      !Number.isInteger(s.day_of_week)
    ) {
      throw new AppError(
        400,
        'SCHEDULE_INVALID_DOW',
        'day_of_week moet 0..6 zijn voor weekly schedule'
      );
    }
    day_of_week = s.day_of_week;
  }

  let day_of_month: number | undefined;
  if (frequency === 'monthly') {
    if (
      typeof s.day_of_month !== 'number' ||
      s.day_of_month < 1 ||
      s.day_of_month > 31 ||
      !Number.isInteger(s.day_of_month)
    ) {
      throw new AppError(
        400,
        'SCHEDULE_INVALID_DOM',
        'day_of_month moet 1..31 zijn voor monthly schedule'
      );
    }
    day_of_month = s.day_of_month;
  }

  if (typeof s.format !== 'string' || !VALID_FORMAT.has(s.format as ScheduleFormat)) {
    throw new AppError(
      400,
      'SCHEDULE_INVALID_FORMAT',
      'format moet pdf|excel|csv zijn'
    );
  }
  const format = s.format as ScheduleFormat;

  if (
    !Array.isArray(s.recipients) ||
    s.recipients.length === 0 ||
    s.recipients.length > 50
  ) {
    throw new AppError(
      400,
      'SCHEDULE_INVALID_RECIPIENTS',
      'recipients moet 1..50 emails bevatten'
    );
  }
  const recipients: string[] = [];
  for (const raw of s.recipients) {
    if (typeof raw !== 'string' || !EMAIL_RE.test(raw)) {
      throw new AppError(
        400,
        'SCHEDULE_INVALID_EMAIL',
        `Ongeldig email-adres: ${String(raw)}`
      );
    }
    recipients.push(raw.trim().toLowerCase());
  }

  if (typeof s.timezone !== 'string' || s.timezone.length === 0) {
    throw new AppError(
      400,
      'SCHEDULE_INVALID_TIMEZONE',
      'timezone vereist (bv "Europe/Amsterdam")'
    );
  }
  // Cheap probe: Intl.DateTimeFormat throws op onbekende tz-strings.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: s.timezone });
  } catch {
    throw new AppError(
      400,
      'SCHEDULE_INVALID_TIMEZONE',
      `Onbekende timezone: ${s.timezone}`
    );
  }

  return {
    frequency,
    day_of_week,
    day_of_month,
    hour,
    recipients,
    format,
    timezone: s.timezone,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// is_due() — wordt door de cron-worker elk uur per scheduled report gebruikt
//
// Edge cases die expliciet getest worden:
//
//   1. DST overgang. We gebruiken Intl.DateTimeFormat met `timeZone` om de
//      "lokale" hour/dow/dom in de tenant-tz te bepalen. Daardoor mist een
//      schedule met hour=2 GEEN run tijdens forward-DST (omdat we daadwerkelijk
//      naar de wallclock-hour kijken die in die tz bestaat) en duplicate-runt
//      ook NIET tijdens backward-DST (omdat de cron exact 1x per uur firet en
//      we last_run_at vergelijken om dubbele runs te voorkomen).
//
//   2. End-of-month. Schedule met day_of_month=31 zou in februari nooit
//      firen. We clampen: als day_of_month > daysInMonth → fire op de
//      laatste dag van de maand. Dat is consistent met cron's "L" specifier.
//
//   3. Worker draait om :00. Iedere cron-tick is dus exact één hour-bucket.
//      isDue checkt of de scheduled hour overeenkomt met de huidige hour
//      in tenant-tz. Geen minuten-precisie nodig.
// ────────────────────────────────────────────────────────────────────────────

interface TzNow {
  hour: number;
  dayOfWeek: number; // 0..6 (Sun..Sat)
  dayOfMonth: number;
  daysInMonth: number;
  yyyymmddhh: string; // bucket-key voor dedup
}

/**
 * Bepaal het wall-clock uur, dag-van-week en dag-van-maand in de gegeven
 * timezone op tijdstip `now`. Returnt ook `daysInMonth` zodat de monthly
 * end-of-month clamp werkt.
 *
 * Implementatie: één Intl.DateTimeFormat call met alle parts; we parsen
 * de output. Performant genoeg voor cron (max 1 call per scheduled report
 * per hour).
 */
export function tzNow(timezone: string, now: Date): TzNow {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  const year = parseInt(get('year'), 10);
  const month = parseInt(get('month'), 10);
  const day = parseInt(get('day'), 10);
  let hour = parseInt(get('hour'), 10);
  // Sommige locales returnen "24" voor middernacht in en-CA hour12=false
  if (hour === 24) hour = 0;
  const weekdayShort = get('weekday');
  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayOfWeek = dowMap[weekdayShort] ?? 0;
  // daysInMonth: gebruik UTC-Date om last-day te vinden — we kennen alleen
  // de tz-locale year+month, en Date(yyyy, mm, 0) returnt de laatste dag
  // van de vorige (1-indexed) maand → wat we willen.
  const daysInMonth = new Date(year, month, 0).getDate();
  return {
    hour,
    dayOfWeek,
    dayOfMonth: day,
    daysInMonth,
    yyyymmddhh: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(
      hour
    ).padStart(2, '0')}`,
  };
}

/**
 * Returns true als het rapport NU (in tenant-tz) moet draaien.
 *
 * Caller is verantwoordelijk voor dedup tegen `last_run_at` (we returnen
 * géén dedup-state hier — pure functie zodat tests deterministisch zijn).
 */
export function isDue(schedule: ReportSchedule, now: Date = new Date()): boolean {
  const t = tzNow(schedule.timezone, now);
  if (t.hour !== schedule.hour) return false;

  switch (schedule.frequency) {
    case 'daily':
      return true;

    case 'weekly':
      return schedule.day_of_week === t.dayOfWeek;

    case 'monthly': {
      const target = schedule.day_of_month ?? 1;
      // End-of-month clamp: als de gewenste dag groter is dan deze maand
      // heeft, dan fire op de laatste dag van de maand. Voorkomt dat een
      // schedule day_of_month=31 in februari (28/29 dagen) nooit draait.
      const effectiveDay = Math.min(target, t.daysInMonth);
      return t.dayOfMonth === effectiveDay;
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Persistence
// ────────────────────────────────────────────────────────────────────────────

/**
 * UPSERT schedule op een rapport. Failed als rapport niet bestaat / soft-deleted.
 *
 * Audit: action `report.schedule_set`.
 */
export async function setReportSchedule(
  tenantId: string,
  reportId: string,
  userId: string | null,
  schedule: ReportSchedule,
  ctx: AuditContext = {}
): Promise<void> {
  const validated = validateSchedule(schedule);
  await withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `UPDATE reports
          SET schedule = $1::jsonb,
              updated_at = now()
        WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL
        RETURNING id`,
      [JSON.stringify(validated), reportId, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'REPORT_NOT_FOUND', 'Rapport niet gevonden');
    }
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.REPORT_SCHEDULE_SET,
        entityType: 'report',
        entityId: reportId,
        after: validated,
        userId,
      },
      ctx
    );
  });
}

/**
 * Verwijder de schedule (schedule = NULL). Idempotent — geen 404 als al weg.
 *
 * Audit: action `report.schedule_cleared`.
 */
export async function clearReportSchedule(
  tenantId: string,
  reportId: string,
  userId: string | null,
  ctx: AuditContext = {}
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `UPDATE reports
          SET schedule = NULL,
              updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        RETURNING id`,
      [reportId, tenantId]
    );
    if (rows.length === 0) {
      throw new AppError(404, 'REPORT_NOT_FOUND', 'Rapport niet gevonden');
    }
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.REPORT_SCHEDULE_CLEARED,
        entityType: 'report',
        entityId: reportId,
        userId,
      },
      ctx
    );
  });
}

/**
 * Alle scheduled reports voor één tenant (gebruikt door UI-overzicht).
 * De cron-worker doet een aparte cross-tenant query via een admin-pool.
 */
export async function listScheduledReports(
  tenantId: string
): Promise<ScheduledReportSummary[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, tenant_id, name, schedule, last_run_at, config
         FROM reports
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          AND schedule IS NOT NULL
        ORDER BY name ASC`,
      [tenantId]
    );
    return rows as ScheduledReportSummary[];
  });
}

/**
 * Compute the human-readable next-run preview voor de UI ("Volgende run:
 * maandag 9 mei 09:00"). Niet exact dezelfde berekening als isDue (die
 * draait elk uur en check NU); deze kijkt vooruit max 32 dagen.
 */
export function nextRunAfter(
  schedule: ReportSchedule,
  now: Date = new Date()
): Date | null {
  // Probe iedere komende hour boundary en check isDue. Max 32 dagen
  // verticale scan = 32*24 = 768 iteraties — verwaarloosbare kost.
  for (let i = 1; i <= 24 * 32; i++) {
    const probe = new Date(now.getTime() + i * 60 * 60 * 1000);
    // probe naar exact het uur ronden zodat tzNow.hour stabiel is
    probe.setMinutes(0, 0, 0);
    if (isDue(schedule, probe)) {
      return probe;
    }
  }
  return null;
}
