/**
 * Web Push helper — Sprint Q2.4.
 *
 * Centrale wrapper rond `web-push` met:
 *   - Lazy VAPID-configuratie (eenmalig op eerste send).
 *   - Mock-mode voor development zonder VAPID keys: payload wordt gelogd,
 *     er gaat niets de deur uit. In production gooien we keihard een error
 *     zodat je nooit per ongeluk in een "stille" staat draait.
 *   - Expired-detectie via 410 Gone / 404 — caller (worker) ruimt de
 *     subscription dan op uit de DB.
 *
 * Type-safety: alle externe input (PushPayload) is strikt getypeerd zodat
 * downstream service-workers altijd dezelfde shape ontvangen.
 */

import webpush from 'web-push';
import { logger } from '../middleware/errorHandler';

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:noreply@talentflow.app';

let configured = false;

/**
 * Eenmalig de VAPID-details op de webpush-singleton zetten.
 * Returnt `false` (en logt) als de keys ontbreken in dev — caller weet
 * dan dat we in mock-mode draaien. In productie throwt dit hard.
 */
function configure(): boolean {
  if (configured) return true;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[webPush] VAPID_PUBLIC_KEY en VAPID_PRIVATE_KEY zijn verplicht in productie'
      );
    }
    logger.warn('[webPush] VAPID keys ontbreken — mock-mode actief (geen echte push)');
    return false;
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  configured = true;
  return true;
}

/** Browser → service-worker payload-shape. */
export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: {
    url?: string;
    type?: string;
    entityId?: string;
    notificationLogId?: string;
  };
  /**
   * Collision-tag — een nieuwe push met dezelfde tag overschrijft een
   * eerdere notificatie in de OS-tray. Gebruik bv. `interview-{appId}`.
   */
  tag?: string;
  requireInteraction?: boolean;
}

export interface PushSubscriptionShape {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface SendPushResult {
  success: boolean;
  /** True bij 410/404 — caller moet de subscription uit de DB verwijderen. */
  expired?: boolean;
  /** True wanneer we in dev-mode zonder keys draaien. */
  mocked?: boolean;
  error?: string;
  statusCode?: number;
}

/**
 * Verstuur één push-notificatie naar één subscription.
 *
 * Failure-modes:
 *   - 410 Gone / 404 Not Found → endpoint expired, sub moet weg uit DB.
 *   - Andere errors → success:false + error-message; caller logt naar
 *     notification_log met status='failed'.
 *
 * Note: we configureren VAPID lazy zodat module-import niet failt in
 * test/dev zonder env. `configure()` raised in production wel.
 */
export async function sendPushNotification(
  subscription: PushSubscriptionShape,
  payload: PushPayload
): Promise<SendPushResult> {
  const isConfigured = configure();

  if (!isConfigured) {
    logger.info('[webPush] mock send', {
      endpoint: subscription.endpoint.slice(0, 60),
      title: payload.title,
      body: payload.body,
      tag: payload.tag,
    });
    return { success: true, mocked: true };
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
      },
      JSON.stringify(payload),
      {
        TTL: 60 * 60 * 24, // 24h max — daarna sowieso stale.
        urgency: payload.requireInteraction ? 'high' : 'normal',
      }
    );
    return { success: true };
  } catch (err) {
    const e = err as { statusCode?: number; body?: string; message?: string };
    const status = e.statusCode;

    // 410 Gone / 404 Not Found → endpoint expired.
    if (status === 410 || status === 404) {
      return {
        success: false,
        expired: true,
        statusCode: status,
        error: e.message ?? 'subscription expired',
      };
    }

    logger.error('[webPush] send failed', {
      statusCode: status,
      message: e.message,
      body: e.body,
      endpoint: subscription.endpoint.slice(0, 60),
    });

    return {
      success: false,
      statusCode: status,
      error: e.message ?? 'unknown push error',
    };
  }
}

/**
 * Geeft de VAPID public key terug (frontend heeft die nodig om
 * `pushManager.subscribe({applicationServerKey})` te bouwen).
 *
 * Returns null in mock-mode zodat de frontend kan detecteren dat push
 * niet geconfigureerd is en de UI kan grijzen.
 */
export function getVapidPublicKey(): string | null {
  return VAPID_PUBLIC ?? null;
}

/**
 * Test-helper: reset module-state. Alleen voor unit tests.
 * @internal
 */
export function __resetForTests(): void {
  configured = false;
}
