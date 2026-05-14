/**
 * Notifications HTTP controller — Sprint Q2.4.
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { auditCtxFromReq } from '../../lib/audit';
import { getVapidPublicKey, type PushPayload } from '../../lib/webPush';
import {
  registerPushSubscription,
  listPushSubscriptions,
  deactivatePushSubscription,
} from './pushSubscription.service';
import {
  listPreferences,
  upsertPreference,
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

const preferenceSchema = z.object({
  channel: z.enum(['push', 'email', 'in_app']),
  event_type: z.string().min(1).max(64),
  enabled: z.boolean().optional(),
  quiet_hours_start: z
    .string()
    .regex(/^\d{2}:\d{2}(?::\d{2})?$/)
    .nullable()
    .optional(),
  quiet_hours_end: z
    .string()
    .regex(/^\d{2}:\d{2}(?::\d{2})?$/)
    .nullable()
    .optional(),
  timezone: z.string().min(1).max(64).optional(),
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

export async function getPreferences(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const prefs = await listPreferences(
      req.user!.tenantId,
      req.user!.userId
    );
    res.json({ data: prefs });
  } catch (err) {
    next(err);
  }
}

export async function patchPreferences(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = preferenceSchema.parse(req.body);
    const pref = await upsertPreference(
      req.user!.tenantId,
      req.user!.userId,
      body.channel,
      body.event_type,
      {
        enabled: body.enabled,
        quiet_hours_start: body.quiet_hours_start ?? null,
        quiet_hours_end: body.quiet_hours_end ?? null,
        timezone: body.timezone,
      },
      auditCtxFromReq(req)
    );
    res.json(pref);
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
