/**
 * In-memory cache voor 2FA policy-enforcement — Sprint Q4.2 vervolg.
 *
 * enforce2faPolicy draait op elk geauthenticeerd request; zonder cache
 * kost dat 2 DB-queries per request (tenant-policy + user-enabled-flag).
 * Beide waarden veranderen zelden, dus een korte TTL (30s) volstaat.
 *
 * Invalidation:
 *   - twoFactor.service invalideert de user-entry bij enable/disable;
 *   - setTenant2faPolicy invalideert de tenant-entry;
 *   - in testomgeving (NODE_ENV=test) is de cache volledig uitgeschakeld
 *     zodat gemockte DB-scenario's per test blijven werken.
 *
 * Apart bestand (niet in middleware/auth.ts) om een circulaire import
 * tussen middleware en twoFactor.service te vermijden.
 */

import type { Tenant2faPolicy } from '../modules/auth/twoFactor.service';

const TTL_MS = 30_000;

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const policyCache = new Map<string, Entry<Tenant2faPolicy | null>>();
const enabledCache = new Map<string, Entry<boolean>>();

function cacheDisabled(): boolean {
  return process.env.NODE_ENV === 'test';
}

function readEntry<T>(map: Map<string, Entry<T>>, key: string): { hit: boolean; value?: T } {
  if (cacheDisabled()) return { hit: false };
  const entry = map.get(key);
  if (!entry) return { hit: false };
  if (entry.expiresAt < Date.now()) {
    map.delete(key);
    return { hit: false };
  }
  return { hit: true, value: entry.value };
}

export function getCachedTenantPolicy(
  tenantId: string
): { hit: boolean; value?: Tenant2faPolicy | null } {
  return readEntry(policyCache, tenantId);
}

export function setCachedTenantPolicy(
  tenantId: string,
  value: Tenant2faPolicy | null
): void {
  if (cacheDisabled()) return;
  policyCache.set(tenantId, { value, expiresAt: Date.now() + TTL_MS });
}

export function invalidateTenantPolicy(tenantId: string): void {
  policyCache.delete(tenantId);
}

export function getCachedUser2faEnabled(
  userId: string
): { hit: boolean; value?: boolean } {
  return readEntry(enabledCache, userId);
}

export function setCachedUser2faEnabled(userId: string, value: boolean): void {
  if (cacheDisabled()) return;
  enabledCache.set(userId, { value, expiresAt: Date.now() + TTL_MS });
}

export function invalidateUser2fa(userId: string): void {
  enabledCache.delete(userId);
}

/** Test-hook: volledige cache leegmaken. */
export function clear2faCache(): void {
  policyCache.clear();
  enabledCache.clear();
}
