/**
 * Notification preferences service tests.
 *
 * Dekt het geconsolideerde contract (GET/PUT wire-object ↔ per-rij-tabel)
 * en de worker-hot-path `getEffectivePreference`, inclusief de
 * master-AND-event-regel: master-rij (`_master`) uit ⇒ kanaal uit.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';
import {
  getEffectivePreference,
  getConsolidatedPreferences,
  saveConsolidatedPreferences,
  computeQuietWindow,
  MASTER_EVENT_TYPE,
  ALL_EVENT_TYPES,
} from '../../src/modules/notifications/preferences.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

interface StoredRow {
  event_type: string;
  enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string;
}

function prefRow(overrides: Partial<StoredRow> & { event_type: string }): StoredRow {
  return {
    enabled: true,
    quiet_hours_start: null,
    quiet_hours_end: null,
    timezone: 'Europe/Amsterdam',
    ...overrides,
  };
}

/** "HH:MM" in UTC voor een Date — voor quiet-windows rond "nu". */
function hhmmUtc(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(
    d.getUTCMinutes()
  ).padStart(2, '0')}`;
}

/**
 * Stateful mock: INSERT ... ON CONFLICT-upserts schrijven naar een
 * in-memory map; SELECTs op notification_preferences lezen daaruit.
 * Daarmee testen we de echte round-trip van saveConsolidatedPreferences.
 */
function statefulPrefsClient(seed: StoredRow[] = []): {
  client: MockClient;
  store: Map<string, StoredRow>;
} {
  const store = new Map<string, StoredRow>(seed.map((r) => [r.event_type, r]));
  const client = mockClient({
    __matcher: (sql, params) => {
      if (/INSERT INTO notification_preferences/i.test(sql)) {
        const [, , eventType, enabled, qs, qe, tz] = params as [
          string,
          string,
          string,
          boolean,
          string | null,
          string | null,
          string,
        ];
        store.set(eventType, {
          event_type: eventType,
          enabled,
          quiet_hours_start: qs,
          quiet_hours_end: qe,
          timezone: tz,
        });
        return { rows: [], rowCount: 1 };
      }
      if (/FROM notification_preferences/i.test(sql)) {
        const rows = [...store.values()];
        return { rows: rows as unknown as Record<string, unknown>[], rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  });
  return { client, store };
}

describe('preferences.service', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────
  // getEffectivePreference — worker-hot-path
  // ──────────────────────────────────────────────────────────────────────

  describe('getEffectivePreference — defaults', () => {
    it('returns enabled=true when no row exists (opt-out default)', async () => {
      client = mockClient({
        __matcher: () => ({ rows: [], rowCount: 0 }),
      });
      teardown = installPoolMock(client);
      const eff = await getEffectivePreference(
        TENANT_ID,
        USER_ID,
        'push',
        'new_candidate_review'
      );
      expect(eff.enabled).toBe(true);
      expect(eff.quietNow).toBe(false);
    });

    it('queries event row AND master row in one statement', async () => {
      let capturedSql = '';
      let capturedParams: unknown[] = [];
      client = mockClient({
        __matcher: (sql, params) => {
          if (/FROM notification_preferences/i.test(sql)) {
            capturedSql = sql;
            capturedParams = params;
          }
          return { rows: [], rowCount: 0 };
        },
      });
      teardown = installPoolMock(client);
      await getEffectivePreference(TENANT_ID, USER_ID, 'push', 'daily_digest');
      expect(capturedSql).toMatch(/event_type IN \(\$4, \$5\)/i);
      expect(capturedParams[3]).toBe('daily_digest');
      expect(capturedParams[4]).toBe(MASTER_EVENT_TYPE);
    });

    it('respects enabled=false on the event row', async () => {
      client = mockClient({
        __matcher: (sql) => {
          if (/FROM notification_preferences/i.test(sql)) {
            return {
              rows: [prefRow({ event_type: 'daily_digest', enabled: false })],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      });
      teardown = installPoolMock(client);
      const eff = await getEffectivePreference(
        TENANT_ID,
        USER_ID,
        'push',
        'daily_digest'
      );
      expect(eff.enabled).toBe(false);
    });
  });

  describe('getEffectivePreference — master AND event', () => {
    it('master OFF wins even when the event row is enabled', async () => {
      client = mockClient({
        __matcher: (sql) => {
          if (/FROM notification_preferences/i.test(sql)) {
            return {
              rows: [
                prefRow({ event_type: MASTER_EVENT_TYPE, enabled: false }),
                prefRow({ event_type: 'new_candidate_review', enabled: true }),
              ],
              rowCount: 2,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      });
      teardown = installPoolMock(client);
      const eff = await getEffectivePreference(
        TENANT_ID,
        USER_ID,
        'push',
        'new_candidate_review'
      );
      expect(eff.enabled).toBe(false);
      expect(eff.quietNow).toBe(false);
    });

    it('master OFF suppresses events without an own row', async () => {
      client = mockClient({
        __matcher: (sql) => {
          if (/FROM notification_preferences/i.test(sql)) {
            return {
              rows: [prefRow({ event_type: MASTER_EVENT_TYPE, enabled: false })],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      });
      teardown = installPoolMock(client);
      const eff = await getEffectivePreference(
        TENANT_ID,
        USER_ID,
        'push',
        'interview_reminder'
      );
      expect(eff.enabled).toBe(false);
    });

    it('master ON + event ON stays enabled', async () => {
      client = mockClient({
        __matcher: (sql) => {
          if (/FROM notification_preferences/i.test(sql)) {
            return {
              rows: [
                prefRow({ event_type: MASTER_EVENT_TYPE, enabled: true }),
                prefRow({ event_type: 'daily_digest', enabled: true }),
              ],
              rowCount: 2,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      });
      teardown = installPoolMock(client);
      const eff = await getEffectivePreference(
        TENANT_ID,
        USER_ID,
        'push',
        'daily_digest'
      );
      expect(eff.enabled).toBe(true);
    });

    it('master ON + event OFF stays disabled', async () => {
      client = mockClient({
        __matcher: (sql) => {
          if (/FROM notification_preferences/i.test(sql)) {
            return {
              rows: [
                prefRow({ event_type: MASTER_EVENT_TYPE, enabled: true }),
                prefRow({ event_type: 'daily_digest', enabled: false }),
              ],
              rowCount: 2,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      });
      teardown = installPoolMock(client);
      const eff = await getEffectivePreference(
        TENANT_ID,
        USER_ID,
        'push',
        'daily_digest'
      );
      expect(eff.enabled).toBe(false);
    });

    it('applies quiet-hours from the event row when enabled', async () => {
      const start = hhmmUtc(new Date(Date.now() - 60 * 60 * 1000));
      const end = hhmmUtc(new Date(Date.now() + 60 * 60 * 1000));
      client = mockClient({
        __matcher: (sql) => {
          if (/FROM notification_preferences/i.test(sql)) {
            return {
              rows: [
                prefRow({ event_type: MASTER_EVENT_TYPE, enabled: true }),
                prefRow({
                  event_type: 'daily_digest',
                  enabled: true,
                  quiet_hours_start: start,
                  quiet_hours_end: end,
                  timezone: 'UTC',
                }),
              ],
              rowCount: 2,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      });
      teardown = installPoolMock(client);
      const eff = await getEffectivePreference(
        TENANT_ID,
        USER_ID,
        'push',
        'daily_digest'
      );
      expect(eff.enabled).toBe(true);
      expect(eff.quietNow).toBe(true);
      expect(eff.quietEndsAtUtc).not.toBeNull();
    });

    it('falls back to master-row quiet-hours when the event has no row', async () => {
      const start = hhmmUtc(new Date(Date.now() - 60 * 60 * 1000));
      const end = hhmmUtc(new Date(Date.now() + 60 * 60 * 1000));
      client = mockClient({
        __matcher: (sql) => {
          if (/FROM notification_preferences/i.test(sql)) {
            return {
              rows: [
                prefRow({
                  event_type: MASTER_EVENT_TYPE,
                  enabled: true,
                  quiet_hours_start: start,
                  quiet_hours_end: end,
                  timezone: 'UTC',
                }),
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      });
      teardown = installPoolMock(client);
      const eff = await getEffectivePreference(
        TENANT_ID,
        USER_ID,
        'push',
        'scorecard_deadline'
      );
      expect(eff.enabled).toBe(true);
      expect(eff.quietNow).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // getConsolidatedPreferences — rijen → wire-object
  // ──────────────────────────────────────────────────────────────────────

  describe('getConsolidatedPreferences', () => {
    it('returns opt-out defaults when no rows exist', async () => {
      client = mockClient({
        __matcher: () => ({ rows: [], rowCount: 0 }),
      });
      teardown = installPoolMock(client);
      const prefs = await getConsolidatedPreferences(TENANT_ID, USER_ID);
      expect(prefs.push_enabled).toBe(true);
      for (const evt of ALL_EVENT_TYPES) {
        expect(prefs.events[evt]).toBe(true);
      }
      expect(prefs.quiet_hours_start).toBeNull();
      expect(prefs.quiet_hours_end).toBeNull();
      expect(prefs.timezone).toBe('Europe/Amsterdam');
    });

    it('maps rows to the consolidated object and normalizes TIME to HH:MM', async () => {
      client = mockClient({
        __matcher: (sql) => {
          if (/FROM notification_preferences/i.test(sql)) {
            return {
              rows: [
                prefRow({
                  event_type: MASTER_EVENT_TYPE,
                  enabled: false,
                  quiet_hours_start: '22:00:00',
                  quiet_hours_end: '07:30:00',
                  timezone: 'Europe/London',
                }),
                prefRow({ event_type: 'daily_digest', enabled: false }),
              ],
              rowCount: 2,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      });
      teardown = installPoolMock(client);
      const prefs = await getConsolidatedPreferences(TENANT_ID, USER_ID);
      expect(prefs.push_enabled).toBe(false);
      expect(prefs.events.daily_digest).toBe(false);
      expect(prefs.events.new_candidate_review).toBe(true); // geen rij ⇒ aan
      expect(prefs.quiet_hours_start).toBe('22:00');
      expect(prefs.quiet_hours_end).toBe('07:30');
      expect(prefs.timezone).toBe('Europe/London');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // saveConsolidatedPreferences — wire-object → rijen (round-trip)
  // ──────────────────────────────────────────────────────────────────────

  describe('saveConsolidatedPreferences', () => {
    it('writes the master row plus one row per provided event toggle', async () => {
      const { client: c, store } = statefulPrefsClient();
      client = c;
      teardown = installPoolMock(client);

      const saved = await saveConsolidatedPreferences(TENANT_ID, USER_ID, {
        push_enabled: false,
        events: { daily_digest: false },
        quiet_hours_start: '22:00',
        quiet_hours_end: '07:00',
        timezone: 'Europe/Amsterdam',
      });

      // Master-rij bewaart push_enabled.
      expect(store.get(MASTER_EVENT_TYPE)).toMatchObject({
        enabled: false,
        quiet_hours_start: '22:00',
        quiet_hours_end: '07:00',
        timezone: 'Europe/Amsterdam',
      });
      // Alleen meegegeven event-keys worden geschreven.
      expect(store.get('daily_digest')).toMatchObject({ enabled: false });
      expect(store.has('new_candidate_review')).toBe(false);

      // Response = volledige geconsolideerde staat.
      expect(saved.push_enabled).toBe(false);
      expect(saved.events.daily_digest).toBe(false);
      expect(saved.events.new_candidate_review).toBe(true);
      expect(saved.quiet_hours_start).toBe('22:00');
      expect(saved.quiet_hours_end).toBe('07:00');
    });

    it('syncs the quiet window onto every written row (worker reads event rows)', async () => {
      const { client: c, store } = statefulPrefsClient();
      client = c;
      teardown = installPoolMock(client);

      await saveConsolidatedPreferences(TENANT_ID, USER_ID, {
        push_enabled: true,
        events: {
          new_candidate_review: true,
          scorecard_deadline: false,
        },
        quiet_hours_start: '23:00',
        quiet_hours_end: '06:30',
        timezone: 'Europe/Brussels',
      });

      for (const key of [
        MASTER_EVENT_TYPE,
        'new_candidate_review',
        'scorecard_deadline',
      ]) {
        expect(store.get(key)).toMatchObject({
          quiet_hours_start: '23:00',
          quiet_hours_end: '06:30',
          timezone: 'Europe/Brussels',
        });
      }
    });

    it('preserves the stored timezone when the field is omitted', async () => {
      const { client: c, store } = statefulPrefsClient([
        prefRow({
          event_type: MASTER_EVENT_TYPE,
          enabled: true,
          timezone: 'Europe/London',
        }),
      ]);
      client = c;
      teardown = installPoolMock(client);

      await saveConsolidatedPreferences(TENANT_ID, USER_ID, {
        push_enabled: true,
      });

      expect(store.get(MASTER_EVENT_TYPE)?.timezone).toBe('Europe/London');
    });

    it('clears the quiet window when quiet_hours_* are omitted', async () => {
      const { client: c, store } = statefulPrefsClient([
        prefRow({
          event_type: MASTER_EVENT_TYPE,
          enabled: true,
          quiet_hours_start: '22:00:00',
          quiet_hours_end: '08:00:00',
        }),
      ]);
      client = c;
      teardown = installPoolMock(client);

      const saved = await saveConsolidatedPreferences(TENANT_ID, USER_ID, {
        push_enabled: true,
      });

      expect(store.get(MASTER_EVENT_TYPE)?.quiet_hours_start).toBeNull();
      expect(store.get(MASTER_EVENT_TYPE)?.quiet_hours_end).toBeNull();
      expect(saved.quiet_hours_start).toBeNull();
      expect(saved.quiet_hours_end).toBeNull();
    });

    it('round-trips: save → getConsolidatedPreferences returns identical state', async () => {
      const { client: c } = statefulPrefsClient();
      client = c;
      teardown = installPoolMock(client);

      const input = {
        push_enabled: true,
        events: {
          new_candidate_review: false,
          scorecard_deadline: true,
          interview_reminder: true,
          application_status_change: false,
          daily_digest: true,
        },
        quiet_hours_start: '21:15',
        quiet_hours_end: '06:45',
        timezone: 'Europe/Paris',
      };
      const saved = await saveConsolidatedPreferences(TENANT_ID, USER_ID, input);
      const fetched = await getConsolidatedPreferences(TENANT_ID, USER_ID);
      expect(fetched).toEqual(saved);
      expect(fetched.events).toEqual(input.events);
      expect(fetched.quiet_hours_start).toBe('21:15');
      expect(fetched.quiet_hours_end).toBe('06:45');
      expect(fetched.timezone).toBe('Europe/Paris');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // computeQuietWindow — puur, geen DB
  // ──────────────────────────────────────────────────────────────────────

  describe('computeQuietWindow', () => {
    it('returns quietNow=false when no window set', () => {
      const r = computeQuietWindow(null, null, 'Europe/Amsterdam', new Date());
      expect(r.quietNow).toBe(false);
      expect(r.endsAtUtc).toBeNull();
    });

    it('returns quietNow=true inside non-wrapping window', () => {
      // 13:00 UTC = 14:00 Europe/Amsterdam (CET +01) of 15:00 (CEST +02).
      // Pak een datum in de winter — Europe/Amsterdam = UTC+1.
      const winterAt13UTC = new Date('2025-01-15T13:00:00Z');
      const r = computeQuietWindow(
        '13:00',
        '16:00',
        'Europe/Amsterdam',
        winterAt13UTC
      );
      expect(r.quietNow).toBe(true);
      expect(r.endsAtUtc).not.toBeNull();
    });

    it('handles wrap-around window (22:00..08:00) — late night', () => {
      // 23:30 Europe/Amsterdam in winter = 22:30 UTC.
      const lateNight = new Date('2025-01-15T22:30:00Z');
      const r = computeQuietWindow(
        '22:00',
        '08:00',
        'Europe/Amsterdam',
        lateNight
      );
      expect(r.quietNow).toBe(true);
    });

    it('handles wrap-around window — early morning', () => {
      // 06:00 Europe/Amsterdam in winter = 05:00 UTC.
      const earlyMorning = new Date('2025-01-15T05:00:00Z');
      const r = computeQuietWindow(
        '22:00',
        '08:00',
        'Europe/Amsterdam',
        earlyMorning
      );
      expect(r.quietNow).toBe(true);
    });

    it('returns false when outside wrap-around window', () => {
      // 12:00 Europe/Amsterdam in winter = 11:00 UTC, niet in 22-08.
      const noon = new Date('2025-01-15T11:00:00Z');
      const r = computeQuietWindow(
        '22:00',
        '08:00',
        'Europe/Amsterdam',
        noon
      );
      expect(r.quietNow).toBe(false);
    });

    it('treats zero-length window as disabled', () => {
      const t = new Date('2025-01-15T13:00:00Z');
      const r = computeQuietWindow('14:00', '14:00', 'Europe/Amsterdam', t);
      expect(r.quietNow).toBe(false);
    });

    it('falls back to UTC for unknown timezone (no crash)', () => {
      const t = new Date('2025-01-15T13:00:00Z');
      const r = computeQuietWindow(
        '12:00',
        '14:00',
        'Made/Up_Zone',
        t
      );
      // Met UTC-fallback is 13:00 UTC tussen 12-14 → quietNow.
      expect(r.quietNow).toBe(true);
    });
  });
});
