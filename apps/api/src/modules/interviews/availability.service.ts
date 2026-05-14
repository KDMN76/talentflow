/**
 * Interviewer availability — recurring working hours, date-overrides en
 * slot-zoeker (intersect van meerdere interviewers).
 *
 * Algoritme `getAvailableSlots`:
 *   1. Per interviewer:
 *        a. Haal recurring hours + alle date-overrides binnen [from..to].
 *        b. Materialize "raw windows" per dag binnen de range op basis van
 *           weekday-recurrence, met overrides die ofwel volledig blokken,
 *           ofwel partial-block (start_time/end_time leeg in override-rij
 *           = volle dag).
 *        c. Bestaande interviews waar deze user deelneemt (interviewer of
 *           observer, status `scheduled`) trekken we als "busy"-intervals
 *           af van de raw windows.
 *   2. Pak de **intersect** over alle interviewers — alleen waar iedereen
 *      tegelijk vrij is.
 *   3. Slice in slots van `durationMinutes` met 15-min stappen, sort op
 *      start, limit op 100 (UI-pagination).
 *
 * Complexity: O(I * (W + B)) voor het opbouwen van per-interviewer windows,
 * waar I = aantal interviewers, W = aantal dagen in de range, B = busy-
 * intervals. Daarna één lineaire merge over de gesorteerde lijsten voor
 * de intersect → totaal O(I * (W + B)) — ruim binnen UI-budget voor
 * realistische use-cases (I≤5, W≤30, B≤200).
 */

import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';
import type { PoolClient } from 'pg';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface RecurringHourBlock {
  weekday: number; // 0=Sun ... 6=Sat
  start: string; // 'HH:MM' or 'HH:MM:SS'
  end: string;
  timezone?: string;
}

export interface DateOverrideInput {
  date: string; // YYYY-MM-DD
  blocked: boolean;
  start_time?: string;
  end_time?: string;
  reason?: string;
  timezone?: string;
}

export interface AvailabilityRow {
  id: string;
  user_id: string;
  weekday: number | null;
  start_time: string | null;
  end_time: string | null;
  date_override: string | null;
  blocked: boolean;
  reason: string | null;
  timezone: string;
}

export interface AvailableSlot {
  start: string;
  end: string;
  interviewers: string[];
}

export interface SlotSearchOptions {
  from: Date;
  to: Date;
  durationMinutes: number;
  timezone?: string;
  /** 15 min default */
  stepMinutes?: number;
  /** UI-side cap; default 100 */
  limit?: number;
}

interface Interval {
  start: number; // ms epoch
  end: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API — recurring hours + overrides
// ────────────────────────────────────────────────────────────────────────────

export async function setRecurringHours(
  tenantId: string,
  userId: string,
  blocks: RecurringHourBlock[],
  actorId?: string,
  ctx: AuditContext = {}
): Promise<void> {
  // Valideer voor we de DB raken — failed CHECK op DB-laag is onhandig
  // diagnoseerbaar voor de UI-developer.
  for (const b of blocks) {
    if (b.weekday < 0 || b.weekday > 6 || !Number.isInteger(b.weekday)) {
      throw new AppError(400, 'INVALID_WEEKDAY', 'weekday moet 0..6 zijn');
    }
    if (!isHHMM(b.start) || !isHHMM(b.end)) {
      throw new AppError(400, 'INVALID_TIME_FORMAT', 'start/end moeten HH:MM zijn');
    }
    if (toMinutes(b.start) >= toMinutes(b.end)) {
      throw new AppError(400, 'INVALID_TIME_RANGE', 'end moet na start liggen');
    }
  }

  return withTenant(tenantId, async (client) => {
    // Vervang de set: delete oude recurring rows, insert nieuwe.
    await client.query(
      `DELETE FROM interviewer_availability
       WHERE tenant_id = $1 AND user_id = $2 AND date_override IS NULL`,
      [tenantId, userId]
    );
    for (const b of blocks) {
      await client.query(
        `INSERT INTO interviewer_availability
           (tenant_id, user_id, weekday, start_time, end_time, timezone)
         VALUES ($1, $2, $3, $4::time, $5::time, $6)`,
        [tenantId, userId, b.weekday, b.start, b.end, b.timezone ?? 'Europe/Amsterdam']
      );
    }
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.INTERVIEWER_AVAILABILITY_UPDATED,
        entityType: 'interviewer_availability',
        entityId: userId,
        after: { recurring_blocks: blocks.length },
        userId: actorId ?? null,
      },
      ctx
    );
  });
}

export async function setDateOverride(
  tenantId: string,
  userId: string,
  override: DateOverrideInput,
  actorId?: string,
  ctx: AuditContext = {}
): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(override.date)) {
    throw new AppError(400, 'INVALID_DATE', 'date moet YYYY-MM-DD zijn');
  }
  if (override.start_time && !isHHMM(override.start_time)) {
    throw new AppError(400, 'INVALID_TIME_FORMAT', 'start_time moet HH:MM zijn');
  }
  if (override.end_time && !isHHMM(override.end_time)) {
    throw new AppError(400, 'INVALID_TIME_FORMAT', 'end_time moet HH:MM zijn');
  }

  return withTenant(tenantId, async (client) => {
    // Eén override-rij per (user, date). Replace bij update.
    await client.query(
      `DELETE FROM interviewer_availability
       WHERE tenant_id = $1 AND user_id = $2 AND date_override = $3::date`,
      [tenantId, userId, override.date]
    );
    await client.query(
      `INSERT INTO interviewer_availability
         (tenant_id, user_id, date_override, blocked, start_time, end_time, reason, timezone)
       VALUES ($1, $2, $3::date, $4, $5::time, $6::time, $7, $8)`,
      [
        tenantId,
        userId,
        override.date,
        override.blocked,
        override.start_time ?? null,
        override.end_time ?? null,
        override.reason ?? null,
        override.timezone ?? 'Europe/Amsterdam',
      ]
    );
    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.INTERVIEWER_AVAILABILITY_UPDATED,
        entityType: 'interviewer_availability',
        entityId: userId,
        after: { date: override.date, blocked: override.blocked },
        userId: actorId ?? null,
      },
      ctx
    );
  });
}

export async function getAvailability(
  tenantId: string,
  userId: string
): Promise<AvailabilityRow[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, user_id, weekday,
              to_char(start_time, 'HH24:MI') AS start_time,
              to_char(end_time,   'HH24:MI') AS end_time,
              to_char(date_override, 'YYYY-MM-DD') AS date_override,
              blocked, reason, timezone
       FROM interviewer_availability
       WHERE tenant_id = $1 AND user_id = $2
       ORDER BY date_override NULLS LAST, weekday, start_time`,
      [tenantId, userId]
    );
    return rows as AvailabilityRow[];
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Public API — slot zoeker
// ────────────────────────────────────────────────────────────────────────────

export async function getAvailableSlots(
  tenantId: string,
  interviewerIds: string[],
  options: SlotSearchOptions
): Promise<AvailableSlot[]> {
  if (interviewerIds.length === 0) {
    throw new AppError(400, 'NO_INTERVIEWERS', 'Minimaal 1 interviewer vereist');
  }
  if (options.durationMinutes < 5 || options.durationMinutes > 480) {
    throw new AppError(400, 'INVALID_DURATION', 'duration buiten 5..480');
  }
  if (options.from.getTime() >= options.to.getTime()) {
    throw new AppError(400, 'INVALID_RANGE', 'from moet vóór to liggen');
  }

  const stepMs = (options.stepMinutes ?? 15) * 60_000;
  const durationMs = options.durationMinutes * 60_000;
  const limit = options.limit ?? 100;

  return withTenant(tenantId, async (client) => {
    // Per interviewer: free intervals (gesorteerd, gemerged).
    const perInterviewer: Interval[][] = [];
    for (const uid of interviewerIds) {
      const free = await computeFreeIntervalsForUser(
        client,
        tenantId,
        uid,
        options.from,
        options.to
      );
      perInterviewer.push(free);
    }

    // Intersect: doorloop iteratief — start met eerste, intersect met de rest.
    let intersected: Interval[] = perInterviewer[0] ?? [];
    for (let i = 1; i < perInterviewer.length; i++) {
      intersected = intersectIntervals(intersected, perInterviewer[i]);
    }

    // Slice in slots van `durationMinutes` met `stepMs` stappen.
    const slots: AvailableSlot[] = [];
    for (const window of intersected) {
      // Anker: eerste slot start op het eerstvolgende stepMs-grid van window.start.
      const firstStart = Math.ceil(window.start / stepMs) * stepMs;
      for (let s = firstStart; s + durationMs <= window.end; s += stepMs) {
        slots.push({
          start: new Date(s).toISOString(),
          end: new Date(s + durationMs).toISOString(),
          interviewers: [...interviewerIds],
        });
        if (slots.length >= limit) break;
      }
      if (slots.length >= limit) break;
    }
    return slots;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Internals — exposed voor testbaarheid (lichte unit-tests op pure functies)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Bereken vrije intervals voor één user binnen [from..to]. Pure DB-aanroep
 * + in-memory window-arithmetic. Returnt gemerged + sorted intervals.
 */
async function computeFreeIntervalsForUser(
  client: PoolClient,
  tenantId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<Interval[]> {
  const { rows: availRows } = await client.query(
    `SELECT weekday,
            to_char(start_time, 'HH24:MI') AS start_time,
            to_char(end_time,   'HH24:MI') AS end_time,
            to_char(date_override, 'YYYY-MM-DD') AS date_override,
            blocked, timezone
     FROM interviewer_availability
     WHERE tenant_id = $1 AND user_id = $2`,
    [tenantId, userId]
  );

  // Bestaande interviews waar deze user al deelneemt — worden uitgesloten.
  const { rows: busyRows } = await client.query(
    `SELECT i.scheduled_start, i.scheduled_end
     FROM interviews i
     JOIN interview_participants p ON p.interview_id = i.id
     WHERE i.tenant_id = $1
       AND p.user_id = $2
       AND p.participant_type IN ('interviewer', 'observer')
       AND i.status = 'scheduled'
       AND i.scheduled_end > $3
       AND i.scheduled_start < $4`,
    [tenantId, userId, from, to]
  );

  const recurring: AvailabilityRow[] = (availRows as AvailabilityRow[]).filter(
    (r) => r.date_override === null
  );
  const overrides: AvailabilityRow[] = (availRows as AvailabilityRow[]).filter(
    (r) => r.date_override !== null
  );
  const overrideByDate = new Map<string, AvailabilityRow>();
  for (const o of overrides) {
    if (o.date_override) overrideByDate.set(o.date_override, o);
  }

  const tz =
    recurring[0]?.timezone ?? overrides[0]?.timezone ?? 'Europe/Amsterdam';

  // Materialize per dag tussen from..to.
  const free: Interval[] = [];
  const cursor = new Date(from);
  cursor.setUTCHours(0, 0, 0, 0);
  const limit = to.getTime();
  while (cursor.getTime() <= limit) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const ovr = overrideByDate.get(dateStr);
    if (ovr) {
      if (ovr.blocked) {
        // Volle dag geblokkeerd OR partial-block via start/end.
        if (ovr.start_time && ovr.end_time) {
          // Partial-block: voeg complement toe binnen werkdag-recurring.
          const recurringForDay = recurring.filter((r) => r.weekday === cursor.getUTCDay());
          for (const r of recurringForDay) {
            const dayWindows = subtractTimeRange(
              dateStr,
              r.start_time!,
              r.end_time!,
              ovr.start_time,
              ovr.end_time,
              tz
            );
            free.push(...dayWindows);
          }
        }
        // Volle dag blocked: niks toevoegen.
      } else {
        // Override met blocked=false betekent expliciete extra availability.
        if (ovr.start_time && ovr.end_time) {
          free.push(timeWindowToInterval(dateStr, ovr.start_time, ovr.end_time, tz));
        } else {
          // Volle dag beschikbaar — gebruik 09:00-18:00 als default.
          free.push(timeWindowToInterval(dateStr, '09:00', '18:00', tz));
        }
      }
    } else {
      // Geen override — gebruik recurring voor deze weekday.
      const wd = cursor.getUTCDay();
      const recurringForDay = recurring.filter((r) => r.weekday === wd);
      for (const r of recurringForDay) {
        if (r.start_time && r.end_time) {
          free.push(timeWindowToInterval(dateStr, r.start_time, r.end_time, tz));
        }
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  // Clip naar [from..to].
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const clipped = free
    .map((iv) => ({ start: Math.max(iv.start, fromMs), end: Math.min(iv.end, toMs) }))
    .filter((iv) => iv.end > iv.start);

  // Subtract busy intervals.
  const busy: Interval[] = busyRows.map((r) => ({
    start: new Date(r.scheduled_start).getTime(),
    end: new Date(r.scheduled_end).getTime(),
  }));

  return subtractBusy(mergeIntervals(clipped), mergeIntervals(busy));
}

// ────────────────────────────────────────────────────────────────────────────
// Pure helpers — geëxporteerd voor unit-tests
// ────────────────────────────────────────────────────────────────────────────

export function isHHMM(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s);
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

/**
 * Construeer een UTC-Interval uit een datum + HH:MM-range. We negeren de
 * timezone-string in deze MVP-implementatie (volledige IANA-tz-handling
 * vereist een tz-library; we documenteren 'Europe/Amsterdam' default en
 * gebruiken de UTC-anker — frontends mogen converteren bij weergave).
 *
 * `_tz` is opgenomen voor toekomstige uitbreiding.
 */
export function timeWindowToInterval(
  dateStr: string,
  startHHMM: string,
  endHHMM: string,
  _tz: string
): Interval {
  return {
    start: Date.parse(`${dateStr}T${normHHMM(startHHMM)}:00.000Z`),
    end: Date.parse(`${dateStr}T${normHHMM(endHHMM)}:00.000Z`),
  };
}

function normHHMM(s: string): string {
  // Accepteer HH:MM of HH:MM:SS — geef HH:MM terug.
  return s.length >= 5 ? s.slice(0, 5) : s;
}

/**
 * Geef de complement-windows van [base] minus [block]:
 *   base: [bs..be], block: [ks..ke] →
 *     [bs..ks] + [ke..be] (mits non-empty)
 */
export function subtractTimeRange(
  dateStr: string,
  baseStart: string,
  baseEnd: string,
  blockStart: string,
  blockEnd: string,
  tz: string
): Interval[] {
  const base = timeWindowToInterval(dateStr, baseStart, baseEnd, tz);
  const block = timeWindowToInterval(dateStr, blockStart, blockEnd, tz);
  return subtractBusy([base], [block]);
}

export function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length <= 1) return [...intervals];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/**
 * Standaard "free MINUS busy" — beide arrays moeten al gemerged en gesorteerd
 * zijn. Per free-interval splitsen we wanneer een busy-interval het overlapt.
 */
export function subtractBusy(free: Interval[], busy: Interval[]): Interval[] {
  if (busy.length === 0) return [...free];
  const result: Interval[] = [];
  for (const f of free) {
    let segs: Interval[] = [{ ...f }];
    for (const b of busy) {
      const next: Interval[] = [];
      for (const s of segs) {
        if (b.end <= s.start || b.start >= s.end) {
          next.push(s);
          continue;
        }
        if (b.start > s.start) next.push({ start: s.start, end: b.start });
        if (b.end < s.end) next.push({ start: b.end, end: s.end });
      }
      segs = next;
      if (segs.length === 0) break;
    }
    result.push(...segs);
  }
  return result.filter((i) => i.end > i.start);
}

/**
 * Lineaire intersect tussen twee gesorteerde, niet-overlappende lijsten.
 */
export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (end > start) out.push({ start, end });
    if (a[i].end < b[j].end) i++;
    else j++;
  }
  return out;
}
