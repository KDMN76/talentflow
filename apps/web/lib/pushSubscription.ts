/**
 * Push subscription helpers
 * ----------------------------------------------------------------
 * Wrapper rond de Web Push / Notification APIs zodat de UI zich
 * niet hoeft te bekommeren om VAPID-conversie, permission state
 * of het serialiseren van een PushSubscription.
 *
 * Backend-contracts:
 *   GET  /api/notifications/vapid-public-key   → { key: string }
 *   POST /api/notifications/subscribe           body: PushSubscriptionInput
 *
 * Browser-only — nooit aanroepen tijdens SSR.
 */

import { api } from "./api";

export type PushSubscriptionInput = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent: string;
  deviceLabel?: string;
};

export type SubscribeResult = {
  subscription: PushSubscription;
  serverResponse: unknown;
};

// ----------------------------------------------------------------
// Capability checks
// ----------------------------------------------------------------

export function isPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

// ----------------------------------------------------------------
// Server-side push-configuratie (VAPID)
// ----------------------------------------------------------------

export type PushConfig = {
  /** True zodra de beheerder VAPID-keys als env heeft gezet (server-side). */
  configured: boolean;
  /** De VAPID public key, of null als push nog niet geconfigureerd is. */
  key: string | null;
};

/**
 * Haal de push-configuratie op bij de backend. Het endpoint
 * `GET /notifications/vapid-public-key` geeft `{ key, configured }` terug:
 * de key is `null` (en `configured` false) zolang de VAPID-env niet gezet is.
 *
 * Gooit door bij een netwerk-/serverfout, zodat de caller "onbekend" kan
 * onderscheiden van "niet geconfigureerd" en niet ten onrechte meldt dat de
 * beheerder niets heeft ingesteld.
 */
export async function getPushConfig(): Promise<PushConfig> {
  const { data } = await api.get<{ key: string | null; configured?: boolean }>(
    "/notifications/vapid-public-key",
  );
  const key = data?.key ?? null;
  return { configured: data?.configured ?? key !== null, key };
}

// ----------------------------------------------------------------
// Read current subscription
// ----------------------------------------------------------------

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch (err) {
    console.warn("[push] getCurrentPushSubscription failed", err);
    return null;
  }
}

// ----------------------------------------------------------------
// Subscribe flow
// ----------------------------------------------------------------

export async function subscribeToPushNotifications(): Promise<SubscribeResult | null> {
  if (!isPushSupported()) {
    throw new Error("Push notifications worden niet ondersteund door deze browser.");
  }

  // 1. Permission
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Meldingen zijn geblokkeerd. Wijzig dit in je browserinstellingen."
        : "Meldingen zijn niet ingeschakeld.",
    );
  }

  // 2. Service worker ready
  const reg = await navigator.serviceWorker.ready;

  // 3. Hergebruik bestaande subscription indien aanwezig
  let subscription = await reg.pushManager.getSubscription();

  if (!subscription) {
    // 4. VAPID key ophalen
    const { data } = await api.get<{ key: string | null }>(
      "/notifications/vapid-public-key",
    );
    if (!data?.key) {
      // Geen key = VAPID niet geconfigureerd door de beheerder. Geef een
      // eerlijke, niet-technische melding i.p.v. een raw serverfout.
      throw new Error(
        "Push-notificaties zijn nog niet geconfigureerd door de beheerder.",
      );
    }

    // 5. Subscriben.
    // Note: PushManager.subscribe wil een BufferSource — geef de
    // onderliggende ArrayBuffer door zodat TS niet over generics zeurt.
    const keyBytes = urlBase64ToUint8Array(data.key);
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes.buffer.slice(
        keyBytes.byteOffset,
        keyBytes.byteOffset + keyBytes.byteLength,
      ) as ArrayBuffer,
    });
  }

  // 6. Serializen naar JSON-vriendelijk payload
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!subscription.endpoint || !p256dh || !auth) {
    throw new Error("PushSubscription mist verplichte velden.");
  }

  const body: PushSubscriptionInput = {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime ?? null,
    keys: { p256dh, auth },
    userAgent: navigator.userAgent,
    deviceLabel: deriveDeviceLabel(),
  };

  // 7. Backend aanmelden
  const { data: serverResponse } = await api.post(
    "/notifications/subscribe",
    body,
  );

  return { subscription, serverResponse };
}

// ----------------------------------------------------------------
// Unsubscribe flow
// ----------------------------------------------------------------

export async function unsubscribeFromPushNotifications(): Promise<void> {
  if (!isPushSupported()) return;

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;

  const endpoint = sub.endpoint;

  // Lokaal afmelden
  try {
    await sub.unsubscribe();
  } catch (err) {
    console.warn("[push] subscription.unsubscribe failed", err);
  }

  // Server-side opruimen — best-effort
  try {
    await api.post("/notifications/unsubscribe", { endpoint });
  } catch (err) {
    console.warn("[push] backend unsubscribe failed", err);
  }
}

// ----------------------------------------------------------------
// VAPID helper — base64-url naar Uint8Array
// ----------------------------------------------------------------

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = typeof window !== "undefined"
    ? window.atob(normalized)
    : Buffer.from(normalized, "base64").toString("binary");

  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

// ----------------------------------------------------------------
// Best-effort device label voor de "Geregistreerde apparaten" lijst
// ----------------------------------------------------------------

function deriveDeviceLabel(): string {
  if (typeof navigator === "undefined") return "Onbekend apparaat";

  const ua = navigator.userAgent;
  const platform =
    // @ts-expect-error: userAgentData is a newer surface
    navigator.userAgentData?.platform ?? navigator.platform ?? "";

  let browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = "Safari";

  let os = platform || "";
  if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Linux/.test(ua)) os = "Linux";

  return os ? `${browser} op ${os}` : browser;
}
