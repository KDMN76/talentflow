/**
 * Scheduler tests — schedule/cancel/reschedule/markAttendance flows.
 * DB-laag is gemockt via dbMock zodat we focus houden op service-logica:
 * conflict-detection, audit-emit, reminder-jobs.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';
import {
  scheduleInterview,
  cancelInterview,
  rescheduleInterview,
  markAttendance,
  listInterviews,
  getInterview,
} from '../../src/modules/interviews/interviews.service';

// Spy de queue-add zodat we verifiëren dat reminders worden enqueueed.
vi.mock('../../src/queue/queues', async () => {
  const actual = await vi.importActual<typeof import('../../src/queue/queues')>(
    '../../src/queue/queues'
  );
  const addMock = vi.fn(async () => ({ id: 'mock-job-id' }));
  return {
    ...actual,
    interviewRemindersQueue: { add: addMock },
    workflowEventsQueue: { add: vi.fn(async () => ({ id: 'wf-1' })) },
  };
});

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const APP_ID = '33333333-3333-3333-3333-333333333333';
const INT_USER_A = '44444444-4444-4444-4444-444444444444';
const INT_USER_B = '55555555-5555-5555-5555-555555555555';
const IV_ID = '66666666-6666-6666-6666-666666666666';

function isoFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

describe('scheduleInterview', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    teardown?.();
  });

  it('rejects when no interviewers given', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      scheduleInterview(TENANT, USER, {
        application_id: APP_ID,
        scheduled_start: isoFromNow(48),
        scheduled_end: isoFromNow(49),
        interviewer_user_ids: [],
      })
    ).rejects.toMatchObject({ code: 'NO_INTERVIEWERS' });
  });

  it('rejects invalid time range', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      scheduleInterview(TENANT, USER, {
        application_id: APP_ID,
        scheduled_start: isoFromNow(50),
        scheduled_end: isoFromNow(48),
        interviewer_user_ids: [INT_USER_A],
      })
    ).rejects.toMatchObject({ code: 'INVALID_TIME_RANGE' });
  });

  it('404s when application missing', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM applications/i.test(sql)) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      scheduleInterview(TENANT, USER, {
        application_id: APP_ID,
        scheduled_start: isoFromNow(48),
        scheduled_end: isoFromNow(49),
        interviewer_user_ids: [INT_USER_A],
      })
    ).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });
  });

  it('throws INTERVIEWER_CONFLICT when an interviewer is already booked', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM applications/i.test(sql)) {
          return {
            rows: [
              {
                id: APP_ID,
                candidate_id: 'cand-1',
                candidate_email: 'k@example.com',
                first_name: 'K',
                last_name: 'L',
              },
            ],
            rowCount: 1,
          };
        }
        if (/FROM interviews i\s+JOIN interview_participants/i.test(sql)) {
          return { rows: [{ user_id: INT_USER_A }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      scheduleInterview(TENANT, USER, {
        application_id: APP_ID,
        scheduled_start: isoFromNow(48),
        scheduled_end: isoFromNow(49),
        interviewer_user_ids: [INT_USER_A],
      })
    ).rejects.toMatchObject({ code: 'INTERVIEWER_CONFLICT' });
  });

  it('happy path: inserts interview, participants, audit and enqueues reminders', async () => {
    let insertedInterview = 0;
    let insertedParts = 0;
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM applications/i.test(sql) && /candidate_email/i.test(sql)) {
          return {
            rows: [
              {
                id: APP_ID,
                candidate_id: 'cand-1',
                candidate_email: 'k@example.com',
                first_name: 'K',
                last_name: 'L',
              },
            ],
            rowCount: 1,
          };
        }
        // Conflict check returns no conflicts.
        if (/FROM interviews i\s+JOIN interview_participants/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/INSERT INTO interviews/i.test(sql)) {
          insertedInterview++;
          return {
            rows: [
              {
                id: IV_ID,
                tenant_id: TENANT,
                application_id: APP_ID,
                stage_id: null,
                scheduled_start: isoFromNow(48),
                scheduled_end: isoFromNow(49),
                duration_minutes: 60,
                status: 'scheduled',
                created_by: USER,
                cancelled_at: null,
                cancellation_reason: null,
                meeting_url: null,
                meeting_provider: null,
                location: null,
                interview_kit_id: null,
                notes: null,
                created_at: 'a',
                updated_at: 'a',
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT INTO interview_participants/i.test(sql)) {
          insertedParts++;
          return { rows: [], rowCount: 1 };
        }
        if (/^SELECT email FROM users/i.test(sql)) {
          return { rows: [{ email: 'iv@example.com' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const queues = await import('../../src/queue/queues');
    const addSpy = queues.interviewRemindersQueue.add as unknown as ReturnType<typeof vi.fn>;

    const iv = await scheduleInterview(TENANT, USER, {
      application_id: APP_ID,
      scheduled_start: isoFromNow(48),
      scheduled_end: isoFromNow(49),
      interviewer_user_ids: [INT_USER_A, INT_USER_B],
      observer_user_ids: [],
    });
    expect(iv.id).toBe(IV_ID);
    expect(insertedInterview).toBe(1);
    // 1 candidate + 2 interviewers = 3 participants.
    expect(insertedParts).toBe(3);
    // 24h + 1h reminders.
    expect(addSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('cancelInterview', () => {
  let client: MockClient;
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('marks interview cancelled with reason', async () => {
    let updated = false;
    client = mockClient({
      __matcher: (sql) => {
        if (/UPDATE interviews/i.test(sql)) {
          updated = true;
          return {
            rows: [{ id: IV_ID, status: 'cancelled' }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await cancelInterview(TENANT, IV_ID, 'kandidaat ziek');
    expect(updated).toBe(true);
  });

  it('404s when interview missing or already final', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    await expect(cancelInterview(TENANT, IV_ID, 'x')).rejects.toMatchObject({
      code: 'INTERVIEW_NOT_FOUND_OR_FINAL',
    });
  });
});

describe('rescheduleInterview', () => {
  let client: MockClient;
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('rejects bad time range', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      rescheduleInterview(TENANT, IV_ID, isoFromNow(50), isoFromNow(48))
    ).rejects.toMatchObject({ code: 'INVALID_TIME_RANGE' });
  });

  it('happy path updates start/end and resets status', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/^SELECT \* FROM interviews/i.test(sql)) {
          return {
            rows: [
              {
                id: IV_ID,
                scheduled_start: isoFromNow(24),
                scheduled_end: isoFromNow(25),
                status: 'scheduled',
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT user_id FROM interview_participants/i.test(sql)) {
          return { rows: [{ user_id: INT_USER_A }], rowCount: 1 };
        }
        // No conflict.
        if (/FROM interviews i\s+JOIN interview_participants/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/UPDATE interviews/i.test(sql)) {
          return {
            rows: [
              {
                id: IV_ID,
                scheduled_start: isoFromNow(48),
                scheduled_end: isoFromNow(49),
                status: 'scheduled',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const iv = await rescheduleInterview(TENANT, IV_ID, isoFromNow(48), isoFromNow(49));
    expect(iv.id).toBe(IV_ID);
    expect(iv.status).toBe('scheduled');
  });
});

describe('markAttendance', () => {
  let client: MockClient;
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('updates participant attendance', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/UPDATE interview_participants/i.test(sql)) {
          return { rows: [{ id: 'p-1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await markAttendance(TENANT, IV_ID, 'p-1', true);
  });

  it('404s when participant missing', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    await expect(markAttendance(TENANT, IV_ID, 'p-x', true)).rejects.toMatchObject({
      code: 'PARTICIPANT_NOT_FOUND',
    });
  });
});

describe('listInterviews + getInterview', () => {
  let client: MockClient;
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('lists with filters', async () => {
    client = mockClient({
      __matcher: (sql) => {
        // listInterviews selecteert i.* + hydration-kolommen (location_type,
        // candidate_name, job_title) met LEFT JOINs vóór FROM interviews i.
        if (/^SELECT i\.\*[^]*FROM interviews i/i.test(sql)) {
          return {
            rows: [
              {
                id: IV_ID,
                tenant_id: TENANT,
                application_id: APP_ID,
                status: 'scheduled',
                scheduled_start: isoFromNow(24),
                scheduled_end: isoFromNow(25),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const out = await listInterviews(TENANT, { status: 'scheduled' });
    expect(out).toHaveLength(1);
  });

  it('getInterview returns participants + kit', async () => {
    client = mockClient({
      __matcher: (sql) => {
        // getInterview selecteert i.* + hydration-kolommen met LEFT JOINs.
        if (/^SELECT i\.\*[^]*FROM interviews i/i.test(sql)) {
          return {
            rows: [
              {
                id: IV_ID,
                tenant_id: TENANT,
                application_id: APP_ID,
                status: 'scheduled',
                scheduled_start: isoFromNow(24),
                scheduled_end: isoFromNow(25),
                interview_kit_id: 'kit-1',
              },
            ],
            rowCount: 1,
          };
        }
        if (/FROM interview_participants/i.test(sql)) {
          return {
            rows: [
              {
                id: 'p-1',
                participant_type: 'candidate',
                email: 'k@example.com',
              },
            ],
            rowCount: 1,
          };
        }
        if (/FROM interview_kits/i.test(sql)) {
          return { rows: [{ id: 'kit-1', name: 'Default' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const iv = await getInterview(TENANT, IV_ID);
    expect(iv.participants).toHaveLength(1);
    expect(iv.kit?.id).toBe('kit-1');
  });

  it('404s when interview missing', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    await expect(getInterview(TENANT, IV_ID)).rejects.toMatchObject({
      code: 'INTERVIEW_NOT_FOUND',
    });
  });
});
