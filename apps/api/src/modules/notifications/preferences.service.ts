/**
 * Notification preferences — Sprint Q2.4 (geconsolideerd contract: ROADMAP
 * "Notificatie-voorkeuren: frontend/backend-contract mismatch").
 *
 * Opslagmodel (source-of-truth voor de delivery-worker): per
 * (user, channel, event_type)-rij in `notification_preferences`:
 *   - enabled        (default TRUE als rij ontbreekt — opt-out policy)
 *   - quiet_hours_start / quiet_hours_end (TIME, optioneel)
 *   - timezone       (default Europe/Amsterdam)
 *
 * Wire-model (settings-pagina, `GET/PUT /api/notifications/preferences`):
 * één geconsolideerd object — zie `NotificationPreferencesSchema` in
 * `@talentflow/contracts`. De mapping object ↔ rijen gebeurt hier.
 *
 * Master-representatie: de UI-toggle `push_enabled` wordt bewaard als
 * sentinel-rij met `event_type = '_master'` (MASTER_EVENT_TYPE). Dat kan
 * zonder migratie: `event_type` is TEXT zonder CHECK-constraint en de
 * UNIQUE (tenant, user, channel, event_type) dekt de master-rij mee.
 * Geen master-rij = kanaal aan (zelfde opt-out default als per-event).
 *
 * Quiet-hours wordt geëvalueerd in de user's TZ. Verschil met server-tijd
 * is belangrijk: een Nederlandse user die om 22:00 lokale tijd niet meer
 * gestoord wil worden, is in UTC iets anders.
 *
 * `getEffectivePreference` is de hot-path die de worker per push aanroept
 * — moet snel en stabiel zijn. Sinds de master-rij checkt hij master AND
 * event: master uit = alles uit voor dat kanaal.
 */

import {
  NOTIFICATION_EVENT_TYPES,
  type NotificationEventToggles,
  type NotificationPreferences,
  type NotificationPreferencesUpdate,
} from '@talentflow/contracts';
import { withTenant } from '../../db/pool';
import { logAudit, type AuditContext } from '../../lib/audit';
import { AuditActions } from '../../lib/auditActions';

export type NotificationChannel = 'push' | 'email' | 'in_app';

/** Bekende event-types — single source of truth in @talentflow/contracts. */
export const ALL_EVENT_TYPES = NOTIFICATION_EVENT_TYPES;
export type NotificationEventType = (typeof ALL_EVENT_TYPES)[number] | string;

/**
 * Sentinel event_type voor de master-rij ("push aan/uit" van de UI).
 * De underscore-prefix voorkomt botsingen met echte event-types en valt
 * buiten het vocabulaire in `NOTIFICATION_EVENT_TYPES`.
 */
export const MASTER_EVENT_TYPE = '_master';

const DEFAULT_TIMEZONE = 'Europe/Amsterdam';

interface PreferenceRow {
  event_type: string;
  enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string;
}

/** Postgres TIME ("HH:MM:SS") of "H:MM" → genormaliseerd "HH:MM". */
function toHHMM(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/**
 * Map de per-rij-representatie (channel='push') naar het geconsolideerde
 * wire-object. Ontbrekende rijen = enabled (opt-out policy, consistent
 * met `getEffectivePreference`).
 */
function mapRowsToConsolidated(rows: PreferenceRow[]): NotificationPreferences {
  const master = rows.find((r) => r.event_type === MASTER_EVENT_TYPE);

  const events = {} as NotificationEventToggles;
  for (const evt of NOTIFICATION_EVENT_TYPES) {
    const row = rows.find((r) => r.event_type === evt);
    events[evt] = row ? row.enabled : true;
  }

  // Quiet-hours + timezone zijn kanaal-breed: master-rij is leidend; val
  // terug op de eerste rij met een venster (legacy per-rij data), daarna
  // op een willekeurige rij (timezone), daarna defaults.
  const src =
    master ??
    rows.find((r) => r.quiet_hours_start !== null || r.quiet_hours_end !== null) ??
    rows[0];

  return {
    push_enabled: master ? master.enabled : true,
    events,
    quiet_hours_start: toHHMM(src?.quiet_hours_start),
    quiet_hours_end: toHHMM(src?.quiet_hours_end),
    timezone: src?.timezone || DEFAULT_TIMEZONE,
  };
}

const SELECT_PUSH_ROWS_SQL = `
  SELECT event_type, enabled, quiet_hours_start, quiet_hours_end, timezone
  FROM notification_preferences
  WHERE tenant_id = $1 AND user_id = $2 AND channel = 'push'`;

/**
 * Geconsolideerde voorkeuren voor de settings-pagina
 * (`GET /api/notifications/preferences`).
 */
export async function getConsolidatedPreferences(
  tenantId: string,
  userId: string
): Promise<NotificationPreferences> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query(SELECT_PUSH_ROWS_SQL, [
      tenantId,
      userId,
    ]);
    return mapRowsToConsolidated(rows as PreferenceRow[]);
  });
}

/**
 * Sla het geconsolideerde object op als per-rij-data
 * (`PUT /api/notifications/preferences`).
 *
 * Eén transactie: master-rij (`_master` ← push_enabled) + één rij per
 * meegegeven event-toggle. Quiet-hours + timezone worden op ALLE
 * geschreven rijen gesynchroniseerd zodat de worker-hot-path
 * (`getEffectivePreference`) ze op de event-rij zelf vindt.
 *
 * Semantiek: `quiet_hours_*` weggelaten of null = venster wissen;
 * `timezone` weggelaten = huidige waarde behouden; ontbrekende
 * event-keys blijven onaangeroerd.
 */
export async function saveConsolidatedPreferences(
  tenantId: string,
  userId: string,
  input: NotificationPreferencesUpdate,
  ctx: AuditContext = {}
): Promise<NotificationPreferences> {
  return withTenant(tenantId, async (client) => {
    // Huidige staat — nodig voor timezone-behoud bij weggelaten veld.
    const before = await client.query(SELECT_PUSH_ROWS_SQL, [tenantId, userId]);
    const existing = mapRowsToConsolidated(before.rows as PreferenceRow[]);

    const quietStart = input.quiet_hours_start ?? null;
    const quietEnd = input.quiet_hours_end ?? null;
    const timezone = input.timezone ?? existing.timezone ?? DEFAULT_TIMEZONE;

    const upserts: Array<{ eventType: string; enabled: boolean }> = [
      { eventType: MASTER_EVENT_TYPE, enabled: input.push_enabled },
    ];
    for (const evt of NOTIFICATION_EVENT_TYPES) {
      const value = input.events?.[evt];
      if (typeof value === 'boolean') {
        upserts.push({ eventType: evt, enabled: value });
      }
    }

    for (const { eventType, enabled } of upserts) {
      await client.query(
        `INSERT INTO notification_preferences
           (tenant_id, user_id, channel, event_type,
            enabled, quiet_hours_start, quiet_hours_end, timezone)
         VALUES ($1, $2, 'push', $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, user_id, channel, event_type)
         DO UPDATE SET
           enabled            = EXCLUDED.enabled,
           quiet_hours_start  = EXCLUDED.quiet_hours_start,
           quiet_hours_end    = EXCLUDED.quiet_hours_end,
           timezone           = EXCLUDED.timezone,
           updated_at         = now()`,
        [tenantId, userId, eventType, enabled, quietStart, quietEnd, timezone]
      );
    }

    // Het quiet-venster is één instelling voor het hele kanaal, maar wordt
    // per rij opgeslagen. Sync het daarom naar ÁLLE bestaande push-rijen —
    // ook events die deze PUT niet meestuurde. Zonder deze stap houdt een
    // partial PUT (bv. alleen push_enabled) oude vensters in leven op de
    // niet-geraakte event-rijen, en leest getEffectivePreference (event-rij
    // leidend) dan een venster dat de gebruiker al had uitgezet.
    await client.query(
      `UPDATE notification_preferences
          SET quiet_hours_start = $3,
              quiet_hours_end   = $4,
              timezone          = $5,
              updated_at        = now()
        WHERE tenant_id = $1 AND user_id = $2 AND channel = 'push'
          AND (quiet_hours_start IS DISTINCT FROM $3
            OR quiet_hours_end   IS DISTINCT FROM $4
            OR timezone          IS DISTINCT FROM $5)`,
      [tenantId, userId, quietStart, quietEnd, timezone]
    );

    const after = await client.query(SELECT_PUSH_ROWS_SQL, [tenantId, userId]);
    const consolidated = mapRowsToConsolidated(after.rows as PreferenceRow[]);

    await logAudit(
      client,
      tenantId,
      {
        action: AuditActions.NOTIFICATION_PREFERENCE_UPDATED,
        entityType: 'notification_preference',
        entityId: userId,
        before: existing,
        after: consolidated,
        userId,
      },
      ctx
    );

    return consolidated;
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
  // Eén query voor beide rijen (event + master) — hot-path, geen 2 roundtrips.
  const rows = await withTenant(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT event_type, enabled, quiet_hours_start, quiet_hours_end, timezone
       FROM notification_preferences
       WHERE tenant_id = $1 AND user_id = $2
         AND channel = $3 AND event_type IN ($4, $5)`,
      [tenantId, userId, channel, eventType, MASTER_EVENT_TYPE]
    );
    return rows as PreferenceRow[];
  });

  const master = rows.find((r) => r.event_type === MASTER_EVENT_TYPE);
  const event = rows.find((r) => r.event_type === eventType);

  // Default-policy: opt-out, niet opt-in. Geen rij ⇒ aan.
  // Master AND event: master uit ⇒ kanaal volledig uit, ongeacht per-event.
  const enabled = (master?.enabled ?? true) && (event?.enabled ?? true);
  if (!enabled) {
    return { enabled: false, quietNow: false, quietEndsAtUtc: null };
  }

  // Quiet-hours: event-rij is leidend (de save-path synct het venster naar
  // alle rijen); val terug op de master-rij voor users zonder event-rij.
  const src = event ?? master;
  if (!src) {
    return { enabled: true, quietNow: false, quietEndsAtUtc: null };
  }

  const window = computeQuietWindow(
    src.quiet_hours_start,
    src.quiet_hours_end,
    src.timezone || DEFAULT_TIMEZONE,
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
