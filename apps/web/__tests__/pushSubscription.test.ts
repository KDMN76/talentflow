/**
 * Vitest unit tests for lib/pushSubscription.ts.
 *
 * Vitest is nog niet geconfigureerd in apps/web (alleen Playwright). Deze
 * test is geschreven met de standaard `describe/it/expect/vi` API zodat
 * hij draait zodra Vitest is toegevoegd:
 *
 *   npm i -D vitest @vitest/ui jsdom
 *   # vitest.config.ts: { test: { environment: 'jsdom' } }
 *
 * Service-worker integration tests zijn browser-only en horen in
 * Playwright (zie __e2e__/) — niet hier.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock '@/lib/api' voordat de SUT geïmporteerd wordt.
// Gebruik vi.hoisted() omdat vi.mock automatisch naar de top wordt gehoisted —
// een normale `const` zou ten tijde van het uitvoeren van de factory nog niet
// bestaan.
const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));

import {
  urlBase64ToUint8Array,
  isPushSupported,
  getNotificationPermission,
  getCurrentPushSubscription,
  subscribeToPushNotifications,
  unsubscribeFromPushNotifications,
} from "@/lib/pushSubscription";

// ----------------------------------------------------------------
// Browser globals — minimal mocks
// ----------------------------------------------------------------

type MockSubscription = {
  endpoint: string;
  expirationTime: number | null;
  toJSON: () => { keys: { p256dh: string; auth: string } };
  unsubscribe: () => Promise<boolean>;
};

function makeSubscription(overrides: Partial<MockSubscription> = {}): MockSubscription {
  return {
    endpoint: "https://push.example/abc",
    expirationTime: null,
    toJSON: () => ({ keys: { p256dh: "P256DH", auth: "AUTH" } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

/**
 * jsdom levert al `window` + `navigator`, maar zonder
 * serviceWorker / PushManager / Notification. We muteren de
 * bestaande globals via defineProperty zodat we niet de hele
 * jsdom-omgeving kapotmaken.
 */
function installServiceWorkerMock(opts: {
  permission?: NotificationPermission;
  existingSub?: MockSubscription | null;
  subscribeImpl?: () => Promise<MockSubscription>;
}) {
  const { permission = "default", existingSub = null, subscribeImpl } = opts;

  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(existingSub),
    subscribe: vi.fn(
      subscribeImpl ?? (() => Promise.resolve(makeSubscription())),
    ),
  };

  // navigator.serviceWorker
  Object.defineProperty(navigator, "serviceWorker", {
    value: { ready: Promise.resolve({ pushManager }) },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, "userAgent", {
    value: "Mozilla/5.0 (Macintosh) Chrome/120 Safari/537.36",
    configurable: true,
  });

  // window.PushManager
  Object.defineProperty(window, "PushManager", {
    value: function MockPushManager() {},
    configurable: true,
    writable: true,
  });

  // window.Notification
  class MockNotification {
    static permission: NotificationPermission = permission;
    static requestPermission = vi
      .fn()
      .mockResolvedValue(permission === "default" ? "granted" : permission);
  }
  Object.defineProperty(window, "Notification", {
    value: MockNotification,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "Notification", {
    value: MockNotification,
    configurable: true,
    writable: true,
  });

  return { pushManager };
}

/**
 * Cleanup helpers — zet het tegenovergestelde van installServiceWorkerMock.
 */
function uninstallServiceWorkerMock() {
  for (const key of ["serviceWorker"] as const) {
    if (key in navigator) {
      try {
        // @ts-expect-error: deleting the mocked property
        delete navigator[key];
      } catch {
        Object.defineProperty(navigator, key, {
          value: undefined,
          configurable: true,
        });
      }
    }
  }
  for (const key of ["PushManager", "Notification"] as const) {
    if (key in window) {
      try {
        delete (window as unknown as Record<string, unknown>)[key];
      } catch {
        Object.defineProperty(window, key, {
          value: undefined,
          configurable: true,
        });
      }
    }
  }
  if ("Notification" in globalThis) {
    try {
      // @ts-expect-error: deleting the mocked property
      delete globalThis.Notification;
    } catch {
      Object.defineProperty(globalThis, "Notification", {
        value: undefined,
        configurable: true,
      });
    }
  }
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe("urlBase64ToUint8Array", () => {
  it("decodes a standard base64 string", () => {
    // "hello" → "aGVsbG8="
    const arr = urlBase64ToUint8Array("aGVsbG8=");
    expect(Array.from(arr)).toEqual([104, 101, 108, 108, 111]);
  });

  it("decodes base64-url with -/_ replaced and missing padding", () => {
    // VAPID-style key with url-safe chars + no padding
    const arr = urlBase64ToUint8Array("aGVsbG8");
    expect(arr.length).toBe(5);
  });

  it("returns Uint8Array of correct length for 65-byte VAPID key", () => {
    // Simulate a VAPID public key (65 bytes raw → ~88 base64 chars)
    const raw = new Uint8Array(65).fill(0x42);
    const b64 = Buffer.from(raw).toString("base64");
    const arr = urlBase64ToUint8Array(b64);
    expect(arr.length).toBe(65);
    expect(arr[0]).toBe(0x42);
  });
});

describe("isPushSupported", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
  });

  afterEach(() => {
    uninstallServiceWorkerMock();
  });

  it("returns false when serviceWorker / PushManager / Notification ontbreken", () => {
    // jsdom heeft `window` maar geen Push-APIs — exact wat de runtime-check
    // moet detecteren.
    expect(isPushSupported()).toBe(false);
  });

  it("returns true when serviceWorker, PushManager and Notification exist", () => {
    installServiceWorkerMock({});
    expect(isPushSupported()).toBe(true);
  });
});

describe("getNotificationPermission", () => {
  afterEach(() => {
    uninstallServiceWorkerMock();
  });

  it("returns 'unsupported' when Notification is missing", () => {
    expect(getNotificationPermission()).toBe("unsupported");
  });

  it("returns the current permission value", () => {
    installServiceWorkerMock({ permission: "granted" });
    expect(getNotificationPermission()).toBe("granted");
  });
});

describe("getCurrentPushSubscription", () => {
  afterEach(() => {
    uninstallServiceWorkerMock();
  });

  it("returns null when push is not supported", async () => {
    expect(await getCurrentPushSubscription()).toBeNull();
  });

  it("returns the existing subscription when present", async () => {
    const sub = makeSubscription();
    installServiceWorkerMock({ existingSub: sub });
    const result = await getCurrentPushSubscription();
    expect(result).toBe(sub);
  });
});

describe("subscribeToPushNotifications", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
  });

  afterEach(() => {
    uninstallServiceWorkerMock();
  });

  it("throws if push is not supported", async () => {
    await expect(subscribeToPushNotifications()).rejects.toThrow(
      /niet ondersteund/i,
    );
  });

  it("throws if permission is denied", async () => {
    installServiceWorkerMock({ permission: "denied" });
    await expect(subscribeToPushNotifications()).rejects.toThrow(/geblokkeerd/i);
  });

  it("creates a new subscription, fetches VAPID key, and POSTs to backend", async () => {
    const newSub = makeSubscription();
    const { pushManager } = installServiceWorkerMock({
      permission: "granted",
      existingSub: null,
      subscribeImpl: () => Promise.resolve(newSub),
    });

    // Geldige base64-url VAPID-style sleutel (raw bytes voor het oog
    // van urlBase64ToUint8Array — moet decodebaar zijn).
    const vapidKey = Buffer.from(new Uint8Array(65).fill(7))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    apiMock.get.mockResolvedValue({ data: { key: vapidKey } });
    apiMock.post.mockResolvedValue({ data: { ok: true } });

    const result = await subscribeToPushNotifications();
    expect(result?.subscription).toBe(newSub);
    expect(apiMock.get).toHaveBeenCalledWith("/notifications/vapid-public-key");
    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        userVisibleOnly: true,
        // SUT geeft een ArrayBuffer mee aan PushManager.subscribe.
        applicationServerKey: expect.any(ArrayBuffer),
      }),
    );
    expect(apiMock.post).toHaveBeenCalledWith(
      "/notifications/subscribe",
      expect.objectContaining({
        endpoint: newSub.endpoint,
        keys: { p256dh: "P256DH", auth: "AUTH" },
        userAgent: expect.stringContaining("Chrome"),
      }),
    );
  });

  it("reuses an existing subscription without fetching VAPID key", async () => {
    const existing = makeSubscription({ endpoint: "https://push.example/existing" });
    installServiceWorkerMock({
      permission: "granted",
      existingSub: existing,
    });

    apiMock.post.mockResolvedValue({ data: { ok: true } });

    const result = await subscribeToPushNotifications();
    expect(result?.subscription).toBe(existing);
    expect(apiMock.get).not.toHaveBeenCalled();
    expect(apiMock.post).toHaveBeenCalledWith(
      "/notifications/subscribe",
      expect.objectContaining({ endpoint: "https://push.example/existing" }),
    );
  });
});

describe("unsubscribeFromPushNotifications", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
  });

  afterEach(() => {
    uninstallServiceWorkerMock();
  });

  it("is a no-op when push is not supported", async () => {
    await expect(unsubscribeFromPushNotifications()).resolves.toBeUndefined();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it("calls unsubscribe and notifies the backend", async () => {
    const sub = makeSubscription();
    installServiceWorkerMock({ permission: "granted", existingSub: sub });
    apiMock.post.mockResolvedValue({ data: {} });

    await unsubscribeFromPushNotifications();

    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(apiMock.post).toHaveBeenCalledWith(
      "/notifications/unsubscribe",
      { endpoint: sub.endpoint },
    );
  });
});
