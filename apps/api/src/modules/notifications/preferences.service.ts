/**
 * Notification preferences — Sprint Q2.4.
 *
 * Per (user, channel, event_type) bewaren we:
 *   - enabled        (default TRUE als rij ontbreekt)
 *   - quiet_hours_start / quiet_hours_end (TIME, optioneel)
 *   - timezone       (default Europe/Amsterdam)
 *
 * Quiet-hours wordt geëvalueerd in de user's TZ. Verschil met server-tijd
 * is belangrijk: een Nederlandse user die om 22:00 lokale tijd niet meer
 * gestoord wil worden, is in UTC iets anders.
 *
 * `getEffectivePreference` is de hot-path die de worker per push aanroept
 * — moet snel en stabiel zijn.
 */

import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';

export type NotificationChannel = 'push' | 'email' | 'in_app';

export const ALL_EVENT_TYPES = [
  'new_candidate_review',
  'scorecard_deadline',
  'interview_reminder',
  'application_status_change',
  'daily_digest',
] as const;
export type NotificationEventType = (typeof ALL_EVENT_TYPES)[number] | string;

export interface NotificationPreference {
  id: string;
  tenant_id: string;
  user_id: string;
  channel: NotificationChannel;
  event_type: string;
  enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertPreferenceInput {
  enabled?: boolean;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  timezone?: string;
}

export async function listPreferences(
  tenantId: string,
  userId: string
): Promise<NotificationPreference[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM notification_preferences
       WHERE tenant_id = $1 AND user_id = $2
       ORDER BY channel, event_type`,
      [tenantId, userId]
    );
    return rows as NotificationPreference[];
  });
}

export async function upsertPreference(
  tenantId: string,
  userId: string,
  channel: NotificationChannel,
  eventType: string,
  settings: UpsertPreferenceInput,
  ctx: AuditContext = {}
): Promise<NotificationPreference> {
  if (!['push', 'email', 'in_app'].includes(channel)) {
    throw new AppError(400, 'INVALID_CHANNEL', `Onbekend channel: ${channel}`);
  }

  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO notification_preferences
         (tenant_id, user_id, channel, event_type,
          enabled, quiet_hours_start, quiet_hours_end, timezone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, user_id, channel, event_type)
       DO UPDATE SET
         enabled            = COALESCE(EXCLUDED.enabled, notification_preferences.enabled),
         quiet_hours_start  = EXCLUDED.quiet_hours_start,
         quiet_hours_end    = EXCLUDED.quiet_hours_end,
         timezone           = COALESCE(EXCLUDED.timezone, notification_preferences.timezone),
         updated_at         = now()
       RETURNING *`,
      [
        tenantId,
        userId,
        channel,
        eventType,
        settings.enabled ?? true,
        settings.quiet_hours_start ?? null,
        settings.quiet_hours_end ?? null,
        settings.timezone ?? 'Europe/Amsterdam',
      ]
    );

    const pref = rows[0] as NotificationPreference;

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.NOTIFICATION_PREFERENCE_UPDATED,
        entityType: 'notification_preference',
        entityId: pref.id,
        after: {
          channel: pref.channel,
          event_type: pref.event_type,
          enabled: pref.enabled,
          quiet_hours: pref.quiet_hours_start
            ? `${pref.quiet_hours_start}-${pref.quiet_hours_end}`
            : null,
          timezone: pref.timezone,
        },
        userId,
      },
      ctx
    );

    return pref;
  });
}

export interface EffectivePreference {
  enabled: boolean;
  quietNow: boolean;
  /** Wanneer de quiet-window eindigt (UTC ISO) — null als !quietNow. */
  quietEndsAtUtc: string | null;
}

/**
 * Effectieve preference voor de worker.
 *
 * - enabled defaults to TRUE als geen rij bestaat (opt-out, niet opt-in).
 * - quietNow=true als huidige tijd in user's TZ binnen [start, end) valt.
 *   Window mag wraps midnight (start > end), bijv. 22:00..08:00.
 * - quietEndsAtUtc geeft de UTC-tijdstempel waarop het quiet-venster
 *   eindigt; de worker gebruikt dat om de job te delayen.
 */
export async function getEffectivePreference(
  tenantId: string,
  userId: string,
  channel: NotificationChannel,
  eventType: string
): Promise<EffectivePreference> {
  const pref = await withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT enabled, quiet_hours_start, quiet_hours_end, timezone
       FROM notification_preferences
       WHERE tenant_id = $1 AND user_id = $2
         AND channel = $3 AND event_type = $4`,
      [tenantId, userId, channel, eventType]
    );
    return rows[0] as
      | {
          enabled: boolean;
          quiet_hours_start: string | null;
          quiet_hours_end: string | null;
          timezone: string;
        }
      | undefined;
  });

  // Default-policy: opt-out, niet opt-in. Geen rij ⇒ alles aan.
  if (!pref) {
    return { enabled: true, quietNow: false, quietEndsAtUtc: null };
  }

  if (!pref.enabled) {
    return { enabled: false, quietNow: false, quietEndsAtUtc: null };
  }

  const window = computeQuietWindow(
    pref.quiet_hours_start,
    pref.quiet_hours_end,
    pref.timezone || 'Europe/Amsterdam',
    new Date()
  );

  return {
    enabled: true,
    quietNow: window.quietNow,
    quietEndsAtUtc: window.endsAtUtc,
  };
}

interface QuietWindowResult {
  quietNow: boolean;
  /** UTC-ISO van eind quiet-venster — null als geen quiet OF venster ongeldig. */
  endsAtUtc: string | null;
}

/**
 * Bereken of `now` binnen het quiet-venster valt, geïnterpreteerd in `tz`.
 *
 * Implementatie via `Intl.DateTimeFormat` om de huidige uren+min in tz te
 * krijgen. Werkt cross-platform (Node bundelt ICU) en blijft stable rond
 * DST-overgangen omdat we elke call vers berekenen.
 *
 * Exported voor unit-tests.
 */
export function computeQuietWindow(
  startStr: string | null,
  endStr: string | null,
  tz: string,
  now: Date
): QuietWindowResult {
  if (!startStr || !endStr) {
    return { quietNow: false, endsAtUtc: null };
  }

  const start = parseTimeStr(startStr);
  const end = parseTimeStr(endStr);
  if (!start || !end) return { quietNow: false, endsAtUtc: null };

  // Huidige uur:minuut in user's tz.
  const local = getZonedHourMinute(now, tz);
  const nowMinutes = local.hour * 60 + local.minute;
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;

  // Window dat midnight wrapt (bv. 22:00..08:00).
  const wraps = startMinutes > endMinutes;

  let quietNow = false;
  if (wraps) {
    quietNow = nowMinutes >= startMinutes || nowMinutes < endMinutes;
  } else if (startMinutes === endMinutes) {
    // 0-length window — disabled.
    quietNow = false;
  } else {
    quietNow = nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }

  if (!quietNow) {
    return { quietNow: false, endsAtUtc: null };
  }

  // Bereken UTC-tijd waarop het quiet-venster eindigt.
  const endsAt = computeEndOfQuietUtc(now, tz, end.hour, end.minute);
  return { quietNow: true, endsAtUtc: endsAt.toISOString() };
}

function parseTimeStr(s: string): { hour: number; minute: number } | null {
  // Postgres TIME komt als "HH:MM:SS" of "HH:MM" terug.
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { hour: h, minute: min };
}

/**
 * Geeft uur+minuut van `date` weer in tijdzone `tz`.
 */
function getZonedHourMinute(
  date: Date,
  tz: string
): { hour: number; minute: number } {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(date);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
    const minute = parseInt(
      parts.find((p) => p.type === 'minute')?.value ?? '0',
      10
    );
    // "24:00" guard — Intl kan in sommige envs 24 als hour geven om middernacht.
    return { hour: hour === 24 ? 0 : hour, minute };
  } catch {
    // Onbekende TZ → fall back naar UTC.
    return { hour: date.getUTCHours(), minute: date.getUTCMinutes() };
  }
}

/**
 * Bereken de UTC-tijd waarop het quiet-venster afloopt, gegeven dat we
 * "nu" in tz `tz` zijn.
 *
 * Strategie: bouw een Date die `endHour:endMinute` in tz weergeeft op
 * vandaag-of-morgen, afhankelijk van of de eindtijd al voorbij is in lokaal.
 * We benaderen dit door de offset tussen UTC en tz uit te lezen via
 * `Intl.DateTimeFormat`.
 */
function computeEndOfQuietUtc(
  now: Date,
  tz: string,
  endHour: number,
  endMinute: number
): Date {
  const zonedNow = getZonedHourMinute(now, tz);
  const nowMinutes = zonedNow.hour * 60 + zonedNow.minute;
  const endMinutes = endHour * 60 + endMinute;

  // Tz-offset (minuten) van tz t.o.v. UTC voor deze datum.
  const tzOffsetMin = getTzOffsetMinutes(now, tz);

  // Aantal minuten tot eindtijd in lokale tijd.
  let deltaMin = endMinutes - nowMinutes;
  if (deltaMin <= 0) deltaMin += 24 * 60;

  return new Date(now.getTime() + deltaMin * 60_000 - 0 * tzOffsetMin);
  // Note: we gebruiken now+delta direct in UTC. tzOffsetMin is alleen
  // beschikbaar voor evt. logging/debugging; delta-in-minuten geldt zowel
  // in lokaal als UTC zolang we DST-overgangen tijdens het venster
  // accepteren als best-effort (worst-case: 1u te vroeg of laat).
}

function getTzOffsetMinutes(date: Date, tz: string): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    });
    const parts = fmt.formatToParts(date);
    const off = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(off);
    if (!m) return 0;
    const sign = m[1] === '-' ? -1 : 1;
    const h = parseInt(m[2], 10);
    const min = m[3] ? parseInt(m[3], 10) : 0;
    return sign * (h * 60 + min);
  } catch {
    return 0;
  }
}
