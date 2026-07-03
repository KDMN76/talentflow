/**
 * Notifications HTTP controller — Sprint Q2.4.
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { NotificationPreferencesUpdateSchema } from '@talentflow/contracts';
import { auditCtxFromReq } from '../../lib/audit';
import { getVapidPublicKey, type PushPayload } from '../../lib/webPush';
import {
  registerPushSubscription,
  listPushSubscriptions,
  deactivatePushSubscription,
} from './pushSubscription.service';
import {
  getConsolidatedPreferences,
  saveConsolidatedPreferences,
} from './preferences.service';
import {
  listNotificationLog,
  markNotificationClicked,
} from './notificationLog.service';
import { enqueuePush } from '../../queue/workers/pushNotifications.worker';

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const testPushSchema = z.object({
  event_type: z.string().min(1).max(64).default('test'),
});

export async function getVapidKey(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const key = getVapidPublicKey();
    res.json({ key, configured: key !== null });
  } catch (err) {
    next(err);
  }
}

export async function subscribe(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = subscribeSchema.parse(req.body);
    const sub = await registerPushSubscription(
      req.user!.tenantId,
      req.user!.userId,
      {
        endpoint: body.endpoint,
        keys: body.keys,
        userAgent: req.get('user-agent') ?? undefined,
      },
      auditCtxFromReq(req)
    );
    res.status(201).json({
      id: sub.id,
      device_label: sub.device_label,
      created_at: sub.created_at,
    });
  } catch (err) {
    next(err);
  }
}

export async function listSubscriptions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const subs = await listPushSubscriptions(
      req.user!.tenantId,
      req.user!.userId
    );
    res.json({
      data: subs.map((s) => ({
        id: s.id,
        device_label: s.device_label,
        last_seen_at: s.last_seen_at,
        created_at: s.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Zelfde data als `listSubscriptions`, maar in het shape dat de
 * settings/notifications-pagina verwacht: `{ devices: [...] }` incl.
 * `user_agent` (tooltip "Mijn devices").
 */
export async function listDevices(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const subs = await listPushSubscriptions(
      req.user!.tenantId,
      req.user!.userId
    );
    res.json({
      devices: subs.map((s) => ({
        id: s.id,
        device_label: s.device_label,
        user_agent: s.user_agent,
        last_seen_at: s.last_seen_at,
        created_at: s.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteSubscription(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await deactivatePushSubscription(
      req.user!.tenantId,
      req.user!.userId,
      req.params.id,
      auditCtxFromReq(req)
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/notifications/preferences — geconsolideerd object
 * `{ push_enabled, events{}, quiet_hours_start, quiet_hours_end, timezone }`.
 * Shape: `NotificationPreferencesSchema` uit @talentflow/contracts.
 */
export async function getPreferences(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const prefs = await getConsolidatedPreferences(
      req.user!.tenantId,
      req.user!.userId
    );
    res.json(prefs);
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/notifications/preferences — sla het geconsolideerde object op.
 * Body: `NotificationPreferencesUpdateSchema`; response: de volledige
 * opgeslagen staat (zelfde shape als GET).
 */
export async function putPreferences(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = NotificationPreferencesUpdateSchema.parse(req.body);
    const prefs = await saveConsolidatedPreferences(
      req.user!.tenantId,
      req.user!.userId,
      body,
      auditCtxFromReq(req)
    );
    res.json(prefs);
  } catch (err) {
    next(err);
  }
}

export async function getLog(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const limit = parseInt((req.query.limit as string) ?? '50', 10);
    const log = await listNotificationLog(
      req.user!.tenantId,
      req.user!.userId,
      limit
    );
    res.json({ data: log });
  } catch (err) {
    next(err);
  }
}

export async function sendTest(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = testPushSchema.parse(req.body ?? {});
    const payload: PushPayload = {
      title: 'TalentFlow test-push',
      body: 'Notifications werken — je ontvangt vanaf nu updates op dit apparaat.',
      icon: '/icons/notif-icon-192.png',
      badge: '/icons/notif-badge-72.png',
      tag: `test-${Date.now()}`,
      data: { type: 'test', url: '/hm' },
    };
    await enqueuePush(
      req.user!.tenantId,
      req.user!.userId,
      body.event_type,
      payload
    );
    res.status(202).json({ ok: true, queued: true });
  } catch (err) {
    next(err);
  }
}

export async function markClicked(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await markNotificationClicked(
      req.user!.tenantId,
      req.user!.userId,
      req.params.id
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
