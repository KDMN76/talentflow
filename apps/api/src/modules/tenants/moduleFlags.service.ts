/**
 * Per-tenant module-zichtbaarheid (feature-flags) — migration 050.
 *
 * Eén JSONB-map per tenant in `tenant_module_settings` bepaalt welke
 * module-GROEPEN aan staan. Kern-functionaliteit (dashboard, vacatures,
 * kandidaten, pipeline, inbox, instellingen) is bewust géén module-key en
 * dus niet uitschakelbaar.
 *
 * Default-semantiek:
 *   - Geen rij (nieuwe tenant, ná migration 050) → alles AAN behalve de
 *     bevroren features `voice` en `whatsapp`.
 *   - Rij aanwezig maar key ontbreekt (bv. module-key later toegevoegd) →
 *     zelfde default per key.
 *   - Bestaande tenants zijn in migration 050 ge-grandfatherd met een
 *     expliciete alles-aan-rij (inclusief voice/whatsapp) zodat niemand
 *     iets ziet verdwijnen.
 *
 * Cache: in-memory met korte TTL (30s), zelfde patroon als
 * lib/twoFactorCache.ts — de guard-middleware draait op elk request naar een
 * module-router en mag geen DB-trip per request kosten. Invalidatie gebeurt
 * bij PUT; in testomgeving (NODE_ENV=test) staat de cache uit.
 */

import type { PoolClient } from 'pg';
import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';
import { logAudit, type AuditContext } from '../../lib/audit';

// ─────────────────────────────────────────────────────────────────────────────
// Module-keys (groepsniveau)
// ─────────────────────────────────────────────────────────────────────────────

export const MODULE_KEYS = [
  'recruit_to_cash', // contracts / timesheets / invoices / accounting / commissions / forecasting
  'outreach', // outreach-campagnes / sequences / nurture
  'sourcing_ai', // agentic AI-sourcing
  'voice', // VoIP/telefonie (bevroren feature)
  'whatsapp', // WhatsApp Business (bevroren feature)
  'job_boards', // vacature-distributie
  'career_pages', // career-page builder + publieke pagina's
  'portals', // klantportalen (shortlists)
  'reports_analytics', // rapportbouwer + analytics-dashboards
  'compliance_plus', // AVG-tools / AI-toezicht
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ModuleFlags = Record<ModuleKey, boolean>;

/** Bevroren features: default UIT voor tenants zonder expliciete rij/key. */
export const FROZEN_MODULE_KEYS: readonly ModuleKey[] = ['voice', 'whatsapp'];

export function isModuleKey(key: string): key is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(key);
}

/** Default-flags voor nieuwe tenants: alles aan behalve bevroren features. */
export function defaultModuleFlags(): ModuleFlags {
  const flags = {} as ModuleFlags;
  for (const key of MODULE_KEYS) {
    flags[key] = !FROZEN_MODULE_KEYS.includes(key);
  }
  return flags;
}

/**
 * Merge een opgeslagen (mogelijk onvolledige) JSONB-map over de defaults.
 * Onbekende keys in de opgeslagen map worden genegeerd; ontbrekende keys
 * vallen terug op de per-key default. Niet-boolean waarden tellen als
 * "niet gezet" (→ default) zodat een corrupte rij nooit een module
 * onbedoeld dicht- of openzet met garbage.
 */
export function resolveModuleFlags(stored: unknown): ModuleFlags {
  const flags = defaultModuleFlags();
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return flags;
  }
  const map = stored as Record<string, unknown>;
  for (const key of MODULE_KEYS) {
    const value = map[key];
    if (typeof value === 'boolean') flags[key] = value;
  }
  return flags;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache (30s TTL, uit in tests — zelfde patroon als lib/twoFactorCache.ts)
// ─────────────────────────────────────────────────────────────────────────────

const TTL_MS = 30_000;

interface CacheEntry {
  value: ModuleFlags;
  expiresAt: number;
}

const flagsCache = new Map<string, CacheEntry>();

function cacheDisabled(): boolean {
  return process.env.NODE_ENV === 'test';
}

export function invalidateModuleFlagsCache(tenantId: string): void {
  flagsCache.delete(tenantId);
}

/** Test-hook: volledige cache leegmaken. */
export function clearModuleFlagsCache(): void {
  flagsCache.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Effectieve module-flags voor een tenant (rij + defaults gemerged).
 * Gecached met korte TTL — dit pad draait op elk request naar een
 * module-router via de guard-middleware.
 */
export async function getModuleFlags(tenantId: string): Promise<ModuleFlags> {
  if (!cacheDisabled()) {
    const entry = flagsCache.get(tenantId);
    if (entry && entry.expiresAt > Date.now()) return entry.value;
    if (entry) flagsCache.delete(tenantId);
  }

  const flags = await withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ modules: unknown }>(
      `SELECT modules FROM tenant_module_settings WHERE tenant_id = $1`,
      [tenantId]
    );
    return resolveModuleFlags(rows[0]?.modules);
  });

  if (!cacheDisabled()) {
    flagsCache.set(tenantId, { value: flags, expiresAt: Date.now() + TTL_MS });
  }
  return flags;
}

/**
 * Update (deel van) de module-flags. Alleen bekende module-keys zijn
 * toegestaan — de controller valideert dat al via zod, maar we filteren hier
 * defensief nogmaals. Schrijft de VOLLEDIGE effectieve map terug (defaults +
 * bestaande rij + patch) zodat de rij altijd self-contained is, en logt een
 * audit-event binnen dezelfde transactie.
 */
export async function updateModuleFlags(
  tenantId: string,
  patch: Partial<Record<ModuleKey, boolean>>,
  actorUserId: string,
  auditCtx: AuditContext
): Promise<ModuleFlags> {
  const sanitized: Partial<Record<ModuleKey, boolean>> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (isModuleKey(key) && typeof value === 'boolean') sanitized[key] = value;
  }
  if (Object.keys(sanitized).length === 0) {
    throw new AppError(400, 'NO_FIELDS', 'Geen geldige module-keys om bij te werken');
  }

  const updated = await withTenant(tenantId, async (client: PoolClient) => {
    const { rows } = await client.query<{ modules: unknown }>(
      `SELECT modules FROM tenant_module_settings WHERE tenant_id = $1`,
      [tenantId]
    );
    const before = resolveModuleFlags(rows[0]?.modules);
    const after: ModuleFlags = { ...before, ...sanitized };

    await client.query(
      `INSERT INTO tenant_module_settings (tenant_id, modules, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (tenant_id) DO UPDATE
         SET modules = EXCLUDED.modules,
             updated_at = now()`,
      [tenantId, JSON.stringify(after)]
    );

    await logAudit(
      client,
      tenantId,
      {
        action: 'tenant.modules.updated',
        entityType: 'tenant_module_settings',
        entityId: tenantId,
        before,
        after,
        userId: actorUserId,
      },
      auditCtx
    );

    return after;
  });

  invalidateModuleFlagsCache(tenantId);
  return updated;
}
