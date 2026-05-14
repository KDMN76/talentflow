import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';
import {
  getEffectivePreference,
  upsertPreference,
  computeQuietWindow,
} from '../../src/modules/notifications/preferences.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

describe('preferences.service', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

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

    it('respects enabled=false from DB', async () => {
      client = mockClient({
        __matcher: (sql) => {
          if (/FROM notification_preferences/i.test(sql)) {
            return {
              rows: [
                {
                  enabled: false,
                  quiet_hours_start: null,
                  quiet_hours_end: null,
                  timezone: 'Europe/Amsterdam',
                },
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
        'daily_digest'
      );
      expect(eff.enabled).toBe(false);
    });
  });

  describe('upsertPreference', () => {
    it('rejects invalid channel', async () => {
      client = mockClient({});
      teardown = installPoolMock(client);
      await expect(
        upsertPreference(
          TENANT_ID,
          USER_ID,
          'invalid' as 'push',
          'daily_digest',
          { enabled: true }
        )
      ).rejects.toMatchObject({ code: 'INVALID_CHANNEL' });
    });

    it('inserts/updates preference row', async () => {
      let upsertCalls = 0;
      client = mockClient({
        __matcher: (sql) => {
          if (/INSERT INTO notification_preferences/i.test(sql)) {
            upsertCalls++;
            return {
              rows: [
                {
                  id: 'p-1',
                  tenant_id: TENANT_ID,
                  user_id: USER_ID,
                  channel: 'push',
                  event_type: 'daily_digest',
                  enabled: true,
                  quiet_hours_start: '22:00:00',
                  quiet_hours_end: '08:00:00',
                  timezone: 'Europe/Amsterdam',
                  created_at: '2025',
                  updated_at: '2025',
                },
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      });
      teardown = installPoolMock(client);
      const pref = await upsertPreference(
        TENANT_ID,
        USER_ID,
        'push',
        'daily_digest',
        {
          enabled: true,
          quiet_hours_start: '22:00',
          quiet_hours_end: '08:00',
        }
      );
      expect(upsertCalls).toBe(1);
      expect(pref.enabled).toBe(true);
    });
  });

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
