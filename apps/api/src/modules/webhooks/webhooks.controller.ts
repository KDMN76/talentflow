import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as webhooksService from './webhooks.service';
import * as deliveriesService from './deliveries.service';

// ─── Subscription schemas ───────────────────────────────────────────────────

const createWebhookSchema = z.object({
  name: z.string().min(1).max(200),
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  description: z.string().max(1000).optional(),
});

const updateWebhookSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  url: z.string().url().optional(),
  events: z.array(z.string()).min(1).optional(),
  active: z.boolean().optional(),
  description: z.string().max(1000).optional(),
});

// ─── Delivery schemas ───────────────────────────────────────────────────────

const deliveryFiltersSchema = z.object({
  subscription_id: z.string().uuid().optional(),
  event_type: z.string().optional(),
  status: z.enum(['pending', 'delivering', 'succeeded', 'failed', 'dead']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const testWebhookSchema = z.object({
  url: z.string().url(),
  event_type: z.string().min(1).max(200),
  payload: z.record(z.unknown()).optional(),
});

// ─── Subscription handlers ─────────────────────────────────────────────────

export async function listWebhooks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const webhooks = await webhooksService.listWebhooks(req.user!.tenantId);
    res.json(webhooks);
  } catch (err) {
    next(err);
  }
}

export async function createWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createWebhookSchema.parse(req.body);
    const webhook = await webhooksService.createWebhook(req.user!.tenantId, data);
    res.status(201).json(webhook);
  } catch (err) {
    next(err);
  }
}

export async function updateWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = updateWebhookSchema.parse(req.body);
    const webhook = await webhooksService.updateWebhook(req.user!.tenantId, req.params.id, data);
    res.json(webhook);
  } catch (err) {
    next(err);
  }
}

export async function deleteWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await webhooksService.deleteWebhook(req.user!.tenantId, req.params.id);
    res.json({ message: 'Webhook verwijderd' });
  } catch (err) {
    next(err);
  }
}

export async function toggleWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const webhook = await webhooksService.toggleWebhook(req.user!.tenantId, req.params.id);
    res.json(webhook);
  } catch (err) {
    next(err);
  }
}

export async function rotateWebhookSecret(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await webhooksService.rotateWebhookSecret(req.user!.tenantId, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getWebhookLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const logs = await webhooksService.getWebhookLogs(req.user!.tenantId, req.params.id);
    res.json(logs);
  } catch (err) {
    next(err);
  }
}

// ─── Delivery handlers ─────────────────────────────────────────────────────

export async function listDeliveries(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filters = deliveryFiltersSchema.parse(req.query);
    const deliveries = await deliveriesService.listDeliveries(req.user!.tenantId, filters);
    res.json(deliveries);
  } catch (err) {
    next(err);
  }
}

export async function getDelivery(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const delivery = await deliveriesService.getDeliveryDetails(req.user!.tenantId, req.params.id);
    res.json(delivery);
  } catch (err) {
    next(err);
  }
}

export async function retryDelivery(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await deliveriesService.retryDelivery(req.user!.tenantId, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function testWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = testWebhookSchema.parse(req.body);
    const result = await deliveriesService.deliverTestEvent(
      data.url,
      data.event_type,
      data.payload ?? {}
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listEventTypes(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ event_types: [...deliveriesService.KNOWN_EVENT_TYPES] });
  } catch (err) {
    next(err);
  }
}
