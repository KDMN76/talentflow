/**
 * Interview calendar-sync tests — Sprint Q3.4 (Agent CCC).
 *
 * Coverage:
 *   - happy path: createCalendarEventForInterview belt provider.createEvent
 *     en INSERTeert een interview_calendar_events-rij per interviewer met
 *     active mailbox-integratie.
 *   - cancel-flow: deleteCalendarEventForInterview zoekt links op, calls
 *     provider.deleteEvent, markeert rijen status='deleted'.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

// ─── Hoisted shared mocks (vi.mock factories run vóór top-level code; we
// gebruiken vi.hoisted om de referenties beschikbaar te maken vóór hoisting.)

const fakeIntegration = {
  id: '99999999-9999-9999-9999-999999999999',
  tenant_id: '11111111-1111-1111-1111-111111111111',
  user_id: '22222222-2222-2222-2222-222222222222',
  provider: 'gmail' as const,
  account_email: 'recruiter@example.com',
  account_name: 'Recruiter',
  scope: 'mail.read mail.send calendar.events',
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
  history_id: null,
  sync_error: null,
  last_sync_at: null,
  active: true,
  created_at: new Date().toISOString(),
};

const mocks = vi.hoisted(() => {
  const integ = {
    id: '99999999-9999-9999-9999-999999999999',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    user_id: '22222222-2222-2222-2222-222222222222',
    provider: 'gmail' as const,
    account_email: 'recruiter@example.com',
    account_name: 'Recruiter',
    scope: 'mail.read mail.send calendar.events',
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    history_id: null,
    sync_error: null,
    last_sync_at: null,
    active: true,
    created_at: new Date().toISOString(),
  };
  return {
    fakeCalendarProvider: {
      createEvent: vi.fn(async () => ({
        eventId: 'remote-event-1',
        calendarId: 'primary',
        htmlLink: 'https://example.com/cal/1',
      })),
      updateEvent: vi.fn(async () => undefined),
      deleteEvent: vi.fn(async () => undefined),
      getEvent: vi.fn(async () => ({
        id: 'remote-event-1',
        status: 'confirmed' as const,
      })),
    },
    getIntegrationFullMock: vi.fn(async () => integ),
    refreshTokenIfExpiredMock: vi.fn(async () => integ),
    invalidateIntegrationMock: vi.fn(async () => undefined),
  };
});

const { fakeCalendarProvider, getIntegrationFullMock, refreshTokenIfExpiredMock } = mocks;

vi.mock('../../src/lib/providers/calendar', () => ({
  getCalendarProvider: vi.fn(() => mocks.fakeCalendarProvider),
  calendarProviderFromMailProvider: (p: 'gmail' | 'outlook') =>
    p === 'gmail' ? 'google' : 'outlook',
}));

vi.mock('../../src/modules/integrations/mailbox.service', () => ({
  getIntegrationFull: mocks.getIntegrationFullMock,
  refreshTokenIfExpired: mocks.refreshTokenIfExpiredMock,
  invalidateIntegration: mocks.invalidateIntegrationMock,
}));

// ─── Queues mock ────────────────────────────────────────────────────────────

vi.mock('../../src/queue/queues', () => ({
  redis: {
    setex: vi.fn(async () => 'OK'),
    get: vi.fn(async () => null),
    del: vi.fn(async () => 1),
  },
  emailSenderQueue: { add: vi.fn(async () => ({ id: 'm' })) },
  workflowEventsQueue: { add: vi.fn(async () => ({ id: 'm' })) },
  inboxSyncQueue: { add: vi.fn(async () => ({ id: 'm' })) },
  bulkMailQueue: { add: vi.fn(async () => ({ id: 'm' })) },
  interviewTranscriptionQueue: { add: vi.fn(async () => ({ id: 'm' })) },
  interviewAiSummaryQueue: { add: vi.fn(async () => ({ id: 'm' })) },
  interviewCalendarSyncQueue: { add: vi.fn(async () => ({ id: 'm' })) },
  interviewRemindersQueue: { add: vi.fn(async () => ({ id: 'm' })) },
}));

import {
  createCalendarEventForInterview,
  deleteCalendarEventForInterview,
} from '../../src/modules/interviews/calendarSync.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const INTEGRATION_ID = '99999999-9999-9999-9999-999999999999';
const INTERVIEW_ID = '88888888-8888-8888-8888-888888888888';
const LINK_ID = '77777777-7777-7777-7777-777777777777';

const interviewBundleRow = {
  interview_id: INTERVIEW_ID,
  application_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  scheduled_start: '2026-06-01T10:00:00.000Z',
  scheduled_end: '2026-06-01T11:00:00.000Z',
  status: 'scheduled',
  meeting_url: 'https://meet.example/abc',
  location: null,
  job_title: 'Senior Engineer',
  candidate_name: 'Jan Jansen',
  candidate_email: 'jan@example.com',
};

describe('calendarSync.createCalendarEventForInterview', () => {
  let teardown: (() => void) | null = null;

  beforeEach(() => {
    fakeCalendarProvider.createEvent.mockClear();
    fakeCalendarProvider.deleteEvent.mockClear();
    getIntegrationFullMock.mockClear();
    refreshTokenIfExpiredMock.mockClear();
  });

  afterEach(() => {
    teardown?.();
    teardown = null;
    vi.clearAllMocks();
  });

  it('happy path: maakt remote event aan en INSERTeert calendar-link-rij', async () => {
    const insertedRow = {
      id: LINK_ID,
      tenant_id: TENANT_ID,
      interview_id: INTERVIEW_ID,
      user_id: USER_ID,
      mailbox_integration_id: INTEGRATION_ID,
      provider: 'google',
      external_event_id: 'remote-event-1',
      external_calendar_id: 'primary',
      last_synced_at: new Date().toISOString(),
      status: 'synced',
      created_at: new Date().toISOString(),
    };

    let insertSql = '';
    const client = mockClient({
      __matcher: (sql) => {
        if (/FROM interviews i/i.test(sql) && /scheduled_start/i.test(sql)) {
          return { rows: [interviewBundleRow], rowCount: 1 };
        }
        if (/FROM interview_participants ip/i.test(sql) && /JOIN mailbox_integrations/i.test(sql)) {
          return {
            rows: [
              {
                user_id: USER_ID,
                email: 'recruiter@example.com',
                integration_id: INTEGRATION_ID,
                provider: 'gmail',
              },
            ],
            rowCount: 1,
          };
        }
        if (/FROM interview_participants/i.test(sql) && /SELECT email/i.test(sql)) {
          return {
            rows: [
              { email: 'recruiter@example.com' },
              { email: 'candidate@example.com' },
            ],
            rowCount: 2,
          };
        }
        if (/INSERT INTO interview_calendar_events/i.test(sql)) {
          insertSql = sql;
          return { rows: [insertedRow], rowCount: 1 };
        }
        if (/INSERT INTO audit_events/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await createCalendarEventForInterview(TENANT_ID, INTERVIEW_ID);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.external_event_id).toBe('remote-event-1');
    expect(result.events[0]!.provider).toBe('google');

    // Provider werd aangeroepen met candidate + recruiter als attendees.
    expect(fakeCalendarProvider.createEvent).toHaveBeenCalledTimes(1);
    const [tokenArg, paramsArg] = fakeCalendarProvider.createEvent.mock.calls[0]!;
    expect(tokenArg).toBe('mock-access-token');
    expect(paramsArg.summary).toMatch(/Sollicitatie:.*Senior Engineer/);
    expect(paramsArg.startsAt).toBe('2026-06-01T10:00:00.000Z');
    expect(paramsArg.endsAt).toBe('2026-06-01T11:00:00.000Z');
    expect(paramsArg.attendees?.map((a: { email: string }) => a.email).sort()).toEqual([
      'candidate@example.com',
      'recruiter@example.com',
    ]);

    // Token-refresh werd geprobeerd.
    expect(refreshTokenIfExpiredMock).toHaveBeenCalledTimes(1);
    // INSERT met ON CONFLICT voor idempotentie.
    expect(insertSql).toMatch(/ON CONFLICT/i);
  });

  it('returnt geen events wanneer er geen interviewers met integratie zijn', async () => {
    const client: MockClient = mockClient({
      __matcher: (sql) => {
        if (/FROM interviews i/i.test(sql) && /scheduled_start/i.test(sql)) {
          return { rows: [interviewBundleRow], rowCount: 1 };
        }
        if (/FROM interview_participants/i.test(sql) && /JOIN mailbox_integrations/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await createCalendarEventForInterview(TENANT_ID, INTERVIEW_ID);
    expect(result.events).toHaveLength(0);
    expect(fakeCalendarProvider.createEvent).not.toHaveBeenCalled();
  });

  it('throws 404 als interview niet bestaat', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/FROM interviews i/i.test(sql)) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      createCalendarEventForInterview(TENANT_ID, INTERVIEW_ID)
    ).rejects.toMatchObject({ code: 'INTERVIEW_NOT_FOUND' });
  });
});

describe('calendarSync.deleteCalendarEventForInterview', () => {
  let teardown: (() => void) | null = null;

  beforeEach(() => {
    fakeCalendarProvider.deleteEvent.mockClear();
  });

  afterEach(() => {
    teardown?.();
    teardown = null;
    vi.clearAllMocks();
  });

  it('cancel-flow: roept provider.deleteEvent en zet status=deleted', async () => {
    const linkRow = {
      id: LINK_ID,
      tenant_id: TENANT_ID,
      interview_id: INTERVIEW_ID,
      user_id: USER_ID,
      mailbox_integration_id: INTEGRATION_ID,
      provider: 'google',
      external_event_id: 'remote-event-1',
      external_calendar_id: 'primary',
      last_synced_at: new Date().toISOString(),
      status: 'synced',
      created_at: new Date().toISOString(),
    };

    let updateSql = '';
    const client = mockClient({
      __matcher: (sql) => {
        if (/FROM interview_calendar_events/i.test(sql) && /status != 'deleted'/i.test(sql)) {
          return { rows: [linkRow], rowCount: 1 };
        }
        if (/UPDATE interview_calendar_events/i.test(sql) && /status = 'deleted'/i.test(sql)) {
          updateSql = sql;
          return { rows: [], rowCount: 1 };
        }
        if (/audit_events/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await deleteCalendarEventForInterview(TENANT_ID, INTERVIEW_ID);

    expect(result.deleted).toBe(1);
    expect(fakeCalendarProvider.deleteEvent).toHaveBeenCalledTimes(1);
    const [tokenArg, eventIdArg] = fakeCalendarProvider.deleteEvent.mock.calls[0]!;
    expect(tokenArg).toBe('mock-access-token');
    expect(eventIdArg).toBe('remote-event-1');
    expect(updateSql).toMatch(/status = 'deleted'/);
  });

  it('returnt 0 wanneer er geen synced links zijn', async () => {
    const client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    const result = await deleteCalendarEventForInterview(TENANT_ID, INTERVIEW_ID);
    expect(result.deleted).toBe(0);
    expect(fakeCalendarProvider.deleteEvent).not.toHaveBeenCalled();
  });
});
