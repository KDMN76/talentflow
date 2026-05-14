import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';
import {
  registerPushSubscription,
  listPushSubscriptions,
  deactivatePushSubscription,
  deletePushSubscriptionByEndpoint,
  deriveDeviceLabel,
} from '../../src/modules/notifications/pushSubscription.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SUB_ID = '33333333-3333-3333-3333-333333333333';

describe('pushSubscription.service', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

  describe('deriveDeviceLabel', () => {
    it('detects iPhone + Safari', () => {
      const ua =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/605.1';
      expect(deriveDeviceLabel(ua)).toContain('iPhone');
      expect(deriveDeviceLabel(ua)).toContain('Safari');
    });

    it('detects Mac + Chrome', () => {
      const ua =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0';
      const label = deriveDeviceLabel(ua);
      expect(label).toContain('Mac');
      expect(label).toContain('Chrome');
    });

    it('detects Windows + Edge', () => {
      const ua =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/120.0';
      expect(deriveDeviceLabel(ua)).toContain('Windows');
      expect(deriveDeviceLabel(ua)).toContain('Edge');
    });

    it('returns null for empty UA', () => {
      expect(deriveDeviceLabel(null)).toBeNull();
      expect(deriveDeviceLabel(undefined)).toBeNull();
    });

    it('falls back gracefully for unknown UA', () => {
      expect(deriveDeviceLabel('curl/8.0')).toBe('Onbekend device');
    });
  });

  describe('registerPushSubscription', () => {
    it('rejects payload missing endpoint', async () => {
      client = mockClient({});
      teardown = installPoolMock(client);
      await expect(
        registerPushSubscription(TENANT_ID, USER_ID, {
          endpoint: '',
          keys: { p256dh: 'p', auth: 'a' },
        })
      ).rejects.toMatchObject({ code: 'INVALID_SUBSCRIPTION' });
    });

    it('rejects payload missing keys', async () => {
      client = mockClient({});
      teardown = installPoolMock(client);
      await expect(
        registerPushSubscription(TENANT_ID, USER_ID, {
          endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
          keys: { p256dh: '', auth: '' },
        })
      ).rejects.toMatchObject({ code: 'INVALID_SUBSCRIPTION' });
    });

    it('upserts subscription and returns row', async () => {
      let upsertCalls = 0;
      client = mockClient({
        __matcher: (sql) => {
          if (/INSERT INTO push_subscriptions/i.test(sql)) {
            upsertCalls++;
            return {
              rows: [
                {
                  id: SUB_ID,
                  tenant_id: TENANT_ID,
                  user_id: USER_ID,
                  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
                  keys_p256dh: 'p256',
                  keys_auth: 'authkey',
                  user_agent: 'Mozilla/5.0',
                  device_label: 'iPhone',
                  active: true,
                  last_seen_at: '2025-01-01',
                  created_at: '2025-01-01',
                },
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      });
      teardown = installPoolMock(client);
      const sub = await registerPushSubscription(TENANT_ID, USER_ID, {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: 'p256', auth: 'authkey' },
        userAgent: 'Mozilla/5.0 (iPhone)',
      });
      expect(sub.id).toBe(SUB_ID);
      expect(upsertCalls).toBe(1);
    });
  });

  describe('listPushSubscriptions', () => {
    it('returns active rows for user', async () => {
      client = mockClient({
        __matcher: (sql) => {
          if (/FROM push_subscriptions/i.test(sql)) {
            return {
              rows: [
                { id: SUB_ID, device_label: 'iPhone', active: true },
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      });
      teardown = installPoolMock(client);
      const list = await listPushSubscriptions(TENANT_ID, USER_ID);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(SUB_ID);
    });
  });

  describe('deactivatePushSubscription', () => {
    it('404s when sub not found', async () => {
      client = mockClient({
        __matcher: () => ({ rows: [], rowCount: 0 }),
      });
      teardown = installPoolMock(client);
      await expect(
        deactivatePushSubscription(TENANT_ID, USER_ID, SUB_ID)
      ).rejects.toMatchObject({ code: 'SUBSCRIPTION_NOT_FOUND' });
    });

    it('marks sub inactive when found', async () => {
      let updateCalls = 0;
      client = mockClient({
        __matcher: (sql) => {
          if (/UPDATE push_subscriptions/i.test(sql)) {
            updateCalls++;
            return {
              rows: [
                {
                  id: SUB_ID,
                  device_label: 'iPhone',
                  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
                },
              ],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      });
      teardown = installPoolMock(client);
      await deactivatePushSubscription(TENANT_ID, USER_ID, SUB_ID);
      expect(updateCalls).toBe(1);
    });
  });

  describe('deletePushSubscriptionByEndpoint', () => {
    it('issues a DELETE without tenant context', async () => {
      let deleteCalls = 0;
      client = mockClient({
        __matcher: (sql) => {
          if (/DELETE FROM push_subscriptions/i.test(sql)) {
            deleteCalls++;
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      });
      teardown = installPoolMock(client);
      await deletePushSubscriptionByEndpoint(
        'https://fcm.googleapis.com/fcm/send/expired'
      );
      expect(deleteCalls).toBe(1);
    });
  });
});
