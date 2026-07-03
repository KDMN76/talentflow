/**
 * Push-notifications worker tests — delivery-pad.
 *
 * We draaien `processPushJob` tegen de ECHTE `getEffectivePreference`
 * (DB gemockt via dbMock) zodat de master-AND-event-regel op het
 * delivery-pad zelf bewezen wordt: master-rij (`_master`) uit ⇒ geen push,
 * ook al staat het event-type aan.
 *
 * webPush, subscriptions en de notification-log zijn module-gemockt;
 * BullMQ Queue/Worker + ioredis komen uit setup.ts.
 */

import { describe, it, expect, afterEach, beforeEach, vi, type Mock } from 'vitest';
import type { Job } from 'bullmq';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

vi.mock('../../src/lib/webPush', () => ({
  sendPushNotification: vi.fn(async () => ({ success: true })),
  getVapidPublicKey: vi.fn(() => 'mock-vapid-key'),
}));

vi.mock('../../src/modules/notifications/pushSubscription.service', () => ({
  listActiveSubscriptionsForUser: vi.fn(async () => []),
  deletePushSubscriptionByEndpoint: vi.fn(async () => undefined),
}));

vi.mock('../../src/modules/notifications/notificationLog.service', () => ({
  insertNotificationLog: vi.fn(async () => undefined),
}));

vi.mock('../../src/queue/queues', () => ({
  pushNotificationsQueue: { add: vi.fn(async () => ({ id: 'mock-job-id' })) },
}));

import {
  processPushJob,
  type PushJobData,
} from '../../src/queue/workers/pushNotifications.worker';
import { MASTER_EVENT_TYPE } from '../../src/modules/notifications/preferences.service';
import { pushNotificationsQueue } from '../../src/queue/queues';
import { sendPushNotification } from '../../src/lib/webPush';
import { listActiveSubscriptionsForUser } from '../../src/modules/notifications/pushSubscription.service';
import { insertNotificationLog } from '../../src/modules/notifications/notificationLog.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

interface PrefRow {
  event_type: string;
  enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string;
}

function prefRow(overrides: Partial<PrefRow> & { event_type: string }): PrefRow {
  return {
    enabled: true,
    quiet_hours_start: null,
    quiet_hours_end: null,
    timezone: 'Europe/Amsterdam',
    ...overrides,
  };
}

function makeJob(
  eventType: string,
  extra: Partial<PushJobData> = {}
): Job<PushJobData> {
  return {
    data: {
      tenantId: TENANT_ID,
      userId: USER_ID,
      eventType,
      payload: {
        title: 'Test',
        body: 'Test body',
        tag: `test-${eventType}`,
      },
      ...extra,
    },
  } as Job<PushJobData>;
}

/** dbMock-client die notification_preferences-rijen teruggeeft. */
function prefsClient(rows: PrefRow[]): MockClient {
  return mockClient({
    __matcher: (sql) => {
      if (/FROM notification_preferences/i.test(sql)) {
        return {
          rows: rows as unknown as Record<string, unknown>[],
          rowCount: rows.length,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  });
}

/** "HH:MM" in UTC voor een Date — voor quiet-windows rond "nu". */
function hhmmUtc(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(
    d.getUTCMinutes()
  ).padStart(2, '0')}`;
}

const activeSub = {
  id: 'sub-1',
  endpoint: 'https://push.example.com/sub-1',
  keys_p256dh: 'p256dh-key',
  keys_auth: 'auth-key',
};

describe('pushNotifications.worker — processPushJob', () => {
  let teardown: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    // Expliciete default: geen actieve subscriptions. Per-test overriden
    // met mockResolvedValue (niet ...Once — een test die vóór de
    // subscriptions-stap suppressed raakt, laat een Once-waarde achter
    // die in de volgende test zou lekken).
    (listActiveSubscriptionsForUser as Mock).mockReset();
    (listActiveSubscriptionsForUser as Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    teardown?.();
  });

  it('sends when no preference rows exist (opt-out default)', async () => {
    teardown = installPoolMock(prefsClient([]));
    (listActiveSubscriptionsForUser as Mock).mockResolvedValue([activeSub]);

    const result = await processPushJob(makeJob('new_candidate_review'));

    expect(result.status).toBe('sent');
    expect(result.delivered).toBe(1);
    expect(sendPushNotification).toHaveBeenCalledTimes(1);
    expect(insertNotificationLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent', eventType: 'new_candidate_review' })
    );
  });

  it('suppresses when the MASTER row is disabled, even with the event row enabled', async () => {
    teardown = installPoolMock(
      prefsClient([
        prefRow({ event_type: MASTER_EVENT_TYPE, enabled: false }),
        prefRow({ event_type: 'new_candidate_review', enabled: true }),
      ])
    );
    (listActiveSubscriptionsForUser as Mock).mockResolvedValue([activeSub]);

    const result = await processPushJob(makeJob('new_candidate_review'));

    expect(result.status).toBe('suppressed_pref');
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(insertNotificationLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'suppressed_pref' })
    );
  });

  it('suppresses when the event row is disabled (master enabled)', async () => {
    teardown = installPoolMock(
      prefsClient([
        prefRow({ event_type: MASTER_EVENT_TYPE, enabled: true }),
        prefRow({ event_type: 'daily_digest', enabled: false }),
      ])
    );

    const result = await processPushJob(makeJob('daily_digest'));

    expect(result.status).toBe('suppressed_pref');
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it('sends when master AND event are both enabled', async () => {
    teardown = installPoolMock(
      prefsClient([
        prefRow({ event_type: MASTER_EVENT_TYPE, enabled: true }),
        prefRow({ event_type: 'scorecard_deadline', enabled: true }),
      ])
    );
    (listActiveSubscriptionsForUser as Mock).mockResolvedValue([activeSub]);

    const result = await processPushJob(makeJob('scorecard_deadline'));

    expect(result.status).toBe('sent');
    expect(result.delivered).toBe(1);
    expect(sendPushNotification).toHaveBeenCalledTimes(1);
  });

  it('reschedules past quiet-hours (suppressed_quiet + delayed re-enqueue)', async () => {
    const start = hhmmUtc(new Date(Date.now() - 60 * 60 * 1000));
    const end = hhmmUtc(new Date(Date.now() + 60 * 60 * 1000));
    teardown = installPoolMock(
      prefsClient([
        prefRow({ event_type: MASTER_EVENT_TYPE, enabled: true }),
        prefRow({
          event_type: 'interview_reminder',
          enabled: true,
          quiet_hours_start: start,
          quiet_hours_end: end,
          timezone: 'UTC',
        }),
      ])
    );

    const result = await processPushJob(makeJob('interview_reminder'));

    expect(result.status).toBe('suppressed_quiet');
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(insertNotificationLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'suppressed_quiet' })
    );

    const addMock = pushNotificationsQueue.add as Mock;
    expect(addMock).toHaveBeenCalledTimes(1);
    const [, jobData, opts] = addMock.mock.calls[0];
    expect((jobData as PushJobData)._quietRetries).toBe(1);
    expect((opts as { delay: number }).delay).toBeGreaterThanOrEqual(60_000);
  });

  it('stops rescheduling after 3 quiet-retries', async () => {
    const start = hhmmUtc(new Date(Date.now() - 60 * 60 * 1000));
    const end = hhmmUtc(new Date(Date.now() + 60 * 60 * 1000));
    teardown = installPoolMock(
      prefsClient([
        prefRow({
          event_type: 'interview_reminder',
          enabled: true,
          quiet_hours_start: start,
          quiet_hours_end: end,
          timezone: 'UTC',
        }),
      ])
    );

    const result = await processPushJob(
      makeJob('interview_reminder', { _quietRetries: 3 })
    );

    expect(result.status).toBe('suppressed_quiet');
    expect(pushNotificationsQueue.add).not.toHaveBeenCalled();
  });

  it('returns no_subscriptions when the user has no active devices', async () => {
    teardown = installPoolMock(prefsClient([]));
    
    const result = await processPushJob(makeJob('daily_digest'));

    expect(result.status).toBe('no_subscriptions');
    expect(sendPushNotification).not.toHaveBeenCalled();
  });
});
