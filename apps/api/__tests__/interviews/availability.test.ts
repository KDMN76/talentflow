/**
 * Availability tests — focus op de pure interval-rekenkern (mergeIntervals,
 * subtractBusy, intersectIntervals, subtractTimeRange) plus de end-to-end
 * `getAvailableSlots` met een gemockte DB-pool.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';
import {
  getAvailableSlots,
  setRecurringHours,
  setDateOverride,
  mergeIntervals,
  subtractBusy,
  intersectIntervals,
  subtractTimeRange,
  isHHMM,
  toMinutes,
  timeWindowToInterval,
} from '../../src/modules/interviews/availability.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function tIso(date: string, time: string): string {
  return `${date}T${time}:00.000Z`;
}

describe('availability — pure helpers', () => {
  it('isHHMM accepts HH:MM and HH:MM:SS, rejects junk', () => {
    expect(isHHMM('09:00')).toBe(true);
    expect(isHHMM('23:59:59')).toBe(true);
    expect(isHHMM('24:00')).toBe(false);
    expect(isHHMM('9:00')).toBe(false);
    expect(isHHMM('')).toBe(false);
  });

  it('toMinutes converts HH:MM to minutes', () => {
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('09:30')).toBe(570);
    expect(toMinutes('23:59')).toBe(1439);
  });

  it('mergeIntervals collapses overlap and orders', () => {
    const merged = mergeIntervals([
      { start: 100, end: 200 },
      { start: 50, end: 80 },
      { start: 180, end: 250 },
      { start: 300, end: 400 },
    ]);
    expect(merged).toEqual([
      { start: 50, end: 80 },
      { start: 100, end: 250 },
      { start: 300, end: 400 },
    ]);
  });

  it('subtractBusy splits free intervals around busy ones', () => {
    const free = [{ start: 0, end: 1000 }];
    const busy = [
      { start: 200, end: 300 },
      { start: 600, end: 700 },
    ];
    expect(subtractBusy(free, busy)).toEqual([
      { start: 0, end: 200 },
      { start: 300, end: 600 },
      { start: 700, end: 1000 },
    ]);
  });

  it('subtractBusy returns empty when busy fully covers free', () => {
    expect(
      subtractBusy([{ start: 100, end: 200 }], [{ start: 0, end: 500 }])
    ).toEqual([]);
  });

  it('intersectIntervals returns overlap of two sorted lists', () => {
    const a = [
      { start: 0, end: 100 },
      { start: 200, end: 400 },
    ];
    const b = [
      { start: 50, end: 250 },
      { start: 350, end: 500 },
    ];
    expect(intersectIntervals(a, b)).toEqual([
      { start: 50, end: 100 },
      { start: 200, end: 250 },
      { start: 350, end: 400 },
    ]);
  });

  it('subtractTimeRange computes complement on a single day', () => {
    const dateStr = '2026-01-05'; // arbitrary monday
    const out = subtractTimeRange(dateStr, '09:00', '17:00', '12:00', '13:00', 'Europe/Amsterdam');
    expect(out).toEqual([
      timeWindowToInterval(dateStr, '09:00', '12:00', 'Europe/Amsterdam'),
      timeWindowToInterval(dateStr, '13:00', '17:00', 'Europe/Amsterdam'),
    ]);
  });
});

describe('getAvailableSlots — end-to-end with mocked DB', () => {
  let teardown: () => void;
  let client: MockClient;

  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

  it('rejects with NO_INTERVIEWERS for empty interviewer list', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      getAvailableSlots(TENANT, [], {
        from: new Date('2026-01-05T00:00:00Z'),
        to: new Date('2026-01-06T00:00:00Z'),
        durationMinutes: 60,
      })
    ).rejects.toMatchObject({ code: 'NO_INTERVIEWERS' });
  });

  it('rejects when from >= to', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      getAvailableSlots(TENANT, [USER_A], {
        from: new Date('2026-01-06T00:00:00Z'),
        to: new Date('2026-01-05T00:00:00Z'),
        durationMinutes: 60,
      })
    ).rejects.toMatchObject({ code: 'INVALID_RANGE' });
  });

  it('returns 60-min slots from a single recurring weekday window', async () => {
    // Monday 2026-01-05 (UTC weekday=1). Recurring 09:00-12:00.
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM interviewer_availability/i.test(sql)) {
          return {
            rows: [
              {
                weekday: 1,
                start_time: '09:00',
                end_time: '12:00',
                date_override: null,
                blocked: false,
                timezone: 'Europe/Amsterdam',
              },
            ],
            rowCount: 1,
          };
        }
        if (/FROM interviews i/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const slots = await getAvailableSlots(TENANT, [USER_A], {
      from: new Date(tIso('2026-01-05', '00:00')),
      to: new Date(tIso('2026-01-05', '23:59')),
      durationMinutes: 60,
    });
    // 09:00-12:00 venster, 60-min slot, 15-min stappen → 9 starts (09:00,
    // 09:15, ..., 11:00).
    expect(slots.length).toBe(9);
    expect(slots[0].start).toBe(tIso('2026-01-05', '09:00'));
    expect(slots[slots.length - 1].start).toBe(tIso('2026-01-05', '11:00'));
  });

  it('honors a full-day blackout override', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM interviewer_availability/i.test(sql)) {
          return {
            rows: [
              {
                weekday: 1,
                start_time: '09:00',
                end_time: '17:00',
                date_override: null,
                blocked: false,
                timezone: 'Europe/Amsterdam',
              },
              {
                weekday: null,
                start_time: null,
                end_time: null,
                date_override: '2026-01-05',
                blocked: true,
                timezone: 'Europe/Amsterdam',
              },
            ],
            rowCount: 2,
          };
        }
        if (/FROM interviews i/i.test(sql)) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const slots = await getAvailableSlots(TENANT, [USER_A], {
      from: new Date(tIso('2026-01-05', '00:00')),
      to: new Date(tIso('2026-01-05', '23:59')),
      durationMinutes: 60,
    });
    expect(slots).toEqual([]);
  });

  it('subtracts a busy existing interview from the free window', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM interviewer_availability/i.test(sql)) {
          return {
            rows: [
              {
                weekday: 1,
                start_time: '09:00',
                end_time: '12:00',
                date_override: null,
                blocked: false,
                timezone: 'Europe/Amsterdam',
              },
            ],
            rowCount: 1,
          };
        }
        if (/FROM interviews i/i.test(sql)) {
          return {
            rows: [
              {
                scheduled_start: tIso('2026-01-05', '10:00'),
                scheduled_end: tIso('2026-01-05', '11:00'),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const slots = await getAvailableSlots(TENANT, [USER_A], {
      from: new Date(tIso('2026-01-05', '00:00')),
      to: new Date(tIso('2026-01-05', '23:59')),
      durationMinutes: 60,
    });
    // Free is 09:00-10:00 + 11:00-12:00. Met 60-min slot in 15-min stappen
    // → 1 slot (09:00-10:00) + 1 slot (11:00-12:00). Andere starts <
    // duration door clip — exact 2 slots.
    const starts = slots.map((s) => s.start);
    expect(starts).toContain(tIso('2026-01-05', '09:00'));
    expect(starts).toContain(tIso('2026-01-05', '11:00'));
    expect(slots.length).toBe(2);
  });

  it('intersects multiple interviewers — only common windows survive', async () => {
    let callCount = 0;
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM interviewer_availability/i.test(sql)) {
          callCount++;
          // First user: 09:00-12:00. Second user: 11:00-14:00.
          if (callCount === 1) {
            return {
              rows: [
                {
                  weekday: 1,
                  start_time: '09:00',
                  end_time: '12:00',
                  date_override: null,
                  blocked: false,
                  timezone: 'Europe/Amsterdam',
                },
              ],
              rowCount: 1,
            };
          }
          return {
            rows: [
              {
                weekday: 1,
                start_time: '11:00',
                end_time: '14:00',
                date_override: null,
                blocked: false,
                timezone: 'Europe/Amsterdam',
              },
            ],
            rowCount: 1,
          };
        }
        if (/FROM interviews i/i.test(sql)) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const slots = await getAvailableSlots(TENANT, [USER_A, USER_B], {
      from: new Date(tIso('2026-01-05', '00:00')),
      to: new Date(tIso('2026-01-05', '23:59')),
      durationMinutes: 60,
    });
    // Intersect = 11:00-12:00 → één 60-min slot start om 11:00.
    expect(slots.length).toBe(1);
    expect(slots[0].start).toBe(tIso('2026-01-05', '11:00'));
    expect(slots[0].interviewers).toEqual([USER_A, USER_B]);
  });

  it('honors limit option', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM interviewer_availability/i.test(sql)) {
          return {
            rows: [
              {
                weekday: 1,
                start_time: '09:00',
                end_time: '17:00',
                date_override: null,
                blocked: false,
                timezone: 'Europe/Amsterdam',
              },
            ],
            rowCount: 1,
          };
        }
        if (/FROM interviews i/i.test(sql)) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const slots = await getAvailableSlots(TENANT, [USER_A], {
      from: new Date(tIso('2026-01-05', '00:00')),
      to: new Date(tIso('2026-01-05', '23:59')),
      durationMinutes: 30,
      limit: 5,
    });
    expect(slots.length).toBe(5);
  });
});

describe('setRecurringHours / setDateOverride', () => {
  let teardown: () => void;
  let client: MockClient;

  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

  it('rejects invalid weekday', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      setRecurringHours(TENANT, USER_A, [{ weekday: 9, start: '09:00', end: '17:00' }])
    ).rejects.toMatchObject({ code: 'INVALID_WEEKDAY' });
  });

  it('rejects start >= end', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      setRecurringHours(TENANT, USER_A, [{ weekday: 1, start: '17:00', end: '09:00' }])
    ).rejects.toMatchObject({ code: 'INVALID_TIME_RANGE' });
  });

  it('writes recurring hours after deleting existing', async () => {
    let deleted = false;
    let inserted = 0;
    client = mockClient({
      __matcher: (sql) => {
        if (/^DELETE FROM interviewer_availability/i.test(sql)) {
          deleted = true;
          return { rows: [], rowCount: 0 };
        }
        if (/^INSERT INTO interviewer_availability/i.test(sql)) {
          inserted++;
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await setRecurringHours(TENANT, USER_A, [
      { weekday: 1, start: '09:00', end: '17:00' },
      { weekday: 2, start: '10:00', end: '15:00' },
    ]);
    expect(deleted).toBe(true);
    expect(inserted).toBe(2);
  });

  it('rejects bad date in setDateOverride', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      setDateOverride(TENANT, USER_A, { date: '2026/01/05', blocked: true })
    ).rejects.toMatchObject({ code: 'INVALID_DATE' });
  });
});
