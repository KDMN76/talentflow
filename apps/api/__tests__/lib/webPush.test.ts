import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock 'web-push' BEFORE we import the module under test.
const setVapidDetails = vi.fn();
const sendNotification = vi.fn();
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}));

describe('webPush.ts', () => {
  beforeEach(() => {
    setVapidDetails.mockClear();
    sendNotification.mockClear();
    vi.resetModules();
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    process.env.NODE_ENV = 'test';
  });

  it('mock-mode when VAPID keys missing in non-prod', async () => {
    const mod = await import('../../src/lib/webPush');
    const result = await mod.sendPushNotification(
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: 'p', auth: 'a' },
      },
      { title: 't', body: 'b' }
    );
    expect(result.success).toBe(true);
    expect(result.mocked).toBe(true);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('getVapidPublicKey returns null in mock-mode', async () => {
    const mod = await import('../../src/lib/webPush');
    expect(mod.getVapidPublicKey()).toBeNull();
  });

  it('sends successfully when VAPID keys present', async () => {
    process.env.VAPID_PUBLIC_KEY = 'BPUBLIC';
    process.env.VAPID_PRIVATE_KEY = 'BPRIVATE';
    sendNotification.mockResolvedValueOnce({ statusCode: 201 });

    const mod = await import('../../src/lib/webPush');
    const result = await mod.sendPushNotification(
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: 'p', auth: 'a' },
      },
      { title: 't', body: 'b' }
    );
    expect(result.success).toBe(true);
    expect(result.mocked).toBeUndefined();
    expect(setVapidDetails).toHaveBeenCalledOnce();
    expect(sendNotification).toHaveBeenCalledOnce();
    // Payload moet als JSON-string verstuurd zijn.
    const args = sendNotification.mock.calls[0];
    expect(typeof args[1]).toBe('string');
    expect(JSON.parse(args[1] as string)).toMatchObject({ title: 't', body: 'b' });
  });

  it('flags expired=true on 410 Gone', async () => {
    process.env.VAPID_PUBLIC_KEY = 'BPUBLIC';
    process.env.VAPID_PRIVATE_KEY = 'BPRIVATE';
    sendNotification.mockRejectedValueOnce({
      statusCode: 410,
      message: 'Gone',
    });
    const mod = await import('../../src/lib/webPush');
    const result = await mod.sendPushNotification(
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/expired',
        keys: { p256dh: 'p', auth: 'a' },
      },
      { title: 't', body: 'b' }
    );
    expect(result.success).toBe(false);
    expect(result.expired).toBe(true);
    expect(result.statusCode).toBe(410);
  });

  it('flags expired=true on 404 Not Found', async () => {
    process.env.VAPID_PUBLIC_KEY = 'BPUBLIC';
    process.env.VAPID_PRIVATE_KEY = 'BPRIVATE';
    sendNotification.mockRejectedValueOnce({
      statusCode: 404,
      message: 'Not Found',
    });
    const mod = await import('../../src/lib/webPush');
    const result = await mod.sendPushNotification(
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/missing',
        keys: { p256dh: 'p', auth: 'a' },
      },
      { title: 't', body: 'b' }
    );
    expect(result.expired).toBe(true);
  });

  it('returns error (no expired) for other failures', async () => {
    process.env.VAPID_PUBLIC_KEY = 'BPUBLIC';
    process.env.VAPID_PRIVATE_KEY = 'BPRIVATE';
    sendNotification.mockRejectedValueOnce({
      statusCode: 500,
      message: 'server boom',
    });
    const mod = await import('../../src/lib/webPush');
    const result = await mod.sendPushNotification(
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: 'p', auth: 'a' },
      },
      { title: 't', body: 'b' }
    );
    expect(result.success).toBe(false);
    expect(result.expired).toBeFalsy();
    expect(result.statusCode).toBe(500);
    expect(result.error).toContain('boom');
  });

  it('throws hard in production when keys missing', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    const mod = await import('../../src/lib/webPush');
    await expect(
      mod.sendPushNotification(
        {
          endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
          keys: { p256dh: 'p', auth: 'a' },
        },
        { title: 't', body: 'b' }
      )
    ).rejects.toThrow(/VAPID/);

    process.env.NODE_ENV = 'test';
  });
});
