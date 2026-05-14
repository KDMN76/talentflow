import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as apiKeysService from './api-keys.service';

// ────────────────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────────────────

const ipSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[\d.:a-fA-F/]+$/, 'Ongeldig IP-adres of CIDR');

const createApiKeySchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).nullish(),
    scopes: z.array(z.string()).default([]),
    // Legacy clients sturen `permissions` ipv `scopes`. Accepteer beide.
    permissions: z.array(z.string()).optional(),
    rate_limit_per_minute: z.number().int().min(1).max(10_000).optional(),
    allowed_ips: z.array(ipSchema).nullish(),
    expires_at: z.string().datetime().nullish(),
  })
  .transform((data) => ({
    ...data,
    scopes: data.scopes.length > 0 ? data.scopes : data.permissions ?? [],
  }));

const updateApiKeySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullish(),
  scopes: z.array(z.string()).optional(),
  rate_limit_per_minute: z.number().int().min(1).max(10_000).optional(),
  allowed_ips: z.array(ipSchema).nullish(),
  expires_at: z.string().datetime().nullish(),
});

// ────────────────────────────────────────────────────────────────────────────
// Handlers
// ────────────────────────────────────────────────────────────────────────────

export async function listKeys(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const keys = await apiKeysService.listApiKeys(req.user!.tenantId);
    res.json(keys);
  } catch (err) {
    next(err);
  }
}

export async function createKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = createApiKeySchema.parse(req.body);
    const apiKey = await apiKeysService.createApiKey(req.user!.tenantId, req.user!.userId, data);
    res.status(201).json(apiKey);
  } catch (err) {
    next(err);
  }
}

export async function updateKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = updateApiKeySchema.parse(req.body);
    const apiKey = await apiKeysService.updateApiKey(req.user!.tenantId, req.params.id, data);
    res.json(apiKey);
  } catch (err) {
    next(err);
  }
}

export async function rotateKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await apiKeysService.rotateApiKey(req.user!.tenantId, req.params.id);
    res.json({ key: result.key, full_key: result.key, record: result.record });
  } catch (err) {
    next(err);
  }
}

export async function revokeKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await apiKeysService.revokeApiKey(req.user!.tenantId, req.params.id);
    res.json({ message: 'API key ingetrokken' });
  } catch (err) {
    next(err);
  }
}

export async function getUsage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10) || 100, 500);
    const usage = await apiKeysService.getUsageLog(req.user!.tenantId, req.params.id, limit);
    res.json(usage);
  } catch (err) {
    next(err);
  }
}

export async function getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stats = await apiKeysService.getUsageStats(req.user!.tenantId, req.params.id);
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

export function getScopes(_req: Request, res: Response, next: NextFunction): void {
  try {
    res.json(apiKeysService.getAvailableScopes());
  } catch (err) {
    next(err);
  }
}
