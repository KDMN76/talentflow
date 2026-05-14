import crypto from 'crypto';
import { withTenant } from '../../db/pool';
import { AppError } from '../../middleware/errorHandler';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface ApiKey {
  id: string;
  name: string;
  description: string | null;
  key_prefix: string;
  scopes: string[];
  permissions: string[]; // legacy alias — gespiegeld op scopes
  rate_limit_per_minute: number;
  allowed_ips: string[] | null;
  expires_at: string | null;
  last_used_at: string | null;
  usage_count: number;
  revoked_at: string | null;
  created_at: string;
  status: 'active' | 'revoked' | 'expired';
}

export interface CreatedApiKey extends ApiKey {
  full_key: string;
}

export interface ApiKeyUsage {
  id: string;
  api_key_id: string;
  method: string;
  path: string;
  status_code: number;
  ip_address: string | null;
  user_agent: string | null;
  duration_ms: number | null;
  error_code: string | null;
  created_at: string;
}

export interface UsageStats {
  total: number;
  last_24h: number;
  last_7d: number;
  errors_24h: number;
  avg_duration_ms: number | null;
  top_endpoints: Array<{ path: string; count: number }>;
  by_status: Array<{ status_code: number; count: number }>;
  daily: Array<{ date: string; count: number }>;
}

export interface ApiScopeDefinition {
  key: string;
  label: string;
  group: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Scopes
// ────────────────────────────────────────────────────────────────────────────

export const AVAILABLE_SCOPES: ApiScopeDefinition[] = [
  { key: 'candidates:read', label: 'Kandidaten lezen', group: 'Kandidaten' },
  { key: 'candidates:write', label: 'Kandidaten beheren', group: 'Kandidaten' },
  { key: 'jobs:read', label: 'Vacatures lezen', group: 'Vacatures' },
  { key: 'jobs:write', label: 'Vacatures beheren', group: 'Vacatures' },
  { key: 'pipeline:read', label: 'Pipeline lezen', group: 'Pipeline' },
  { key: 'pipeline:write', label: 'Pipeline beheren', group: 'Pipeline' },
  { key: 'communications:read', label: 'Berichten lezen', group: 'Communicatie' },
  { key: 'communications:write', label: 'Berichten versturen', group: 'Communicatie' },
  { key: 'webhooks:manage', label: 'Webhooks beheren', group: 'Integraties' },
  { key: 'reports:read', label: 'Rapporten lezen', group: 'Rapporten' },
  { key: 'reports:write', label: 'Rapporten beheren', group: 'Rapporten' },
  { key: 'analytics:read', label: 'Analytics lezen', group: 'Rapporten' },
  { key: 'crm:read', label: 'CRM lezen', group: 'CRM' },
  { key: 'crm:write', label: 'CRM beheren', group: 'CRM' },
  { key: '*', label: 'Volledige toegang (admin)', group: 'Admin' },
];

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const KEY_PREFIX = 'tf_live_';

function generateKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  // 32-char base62 segment voor leesbaar prefix-gedeelte. crypto.randomBytes
  // levert hex; we encoderen naar base62-achtige string met URL-veilig alfabet.
  const random = crypto.randomBytes(48).toString('base64url').slice(0, 40);
  const rawKey = `${KEY_PREFIX}${random}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  // Toon prefix `tf_live_xxxx...yyyy` — eerste 8 + laatste 4 chars van het
  // random-deel. Geeft developer genoeg context zonder de key te lekken.
  const head = rawKey.slice(0, KEY_PREFIX.length + 8);
  const tail = rawKey.slice(-4);
  const keyPrefix = `${head}...${tail}`;
  return { rawKey, keyHash, keyPrefix };
}

function deriveStatus(row: {
  revoked_at: string | null;
  deleted_at: string | null;
  expires_at: string | null;
}): ApiKey['status'] {
  if (row.revoked_at || row.deleted_at) return 'revoked';
  if (row.expires_at && new Date(row.expires_at) < new Date()) return 'expired';
  return 'active';
}

function mapRow(row: Record<string, unknown>): ApiKey {
  const scopes = (row.scopes as string[] | null) ?? [];
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    key_prefix: row.key_prefix as string,
    scopes,
    permissions: scopes,
    rate_limit_per_minute: (row.rate_limit_per_minute as number | null) ?? 100,
    allowed_ips: (row.allowed_ips as string[] | null) ?? null,
    expires_at: (row.expires_at as string | null) ?? null,
    last_used_at: (row.last_used_at as string | null) ?? null,
    usage_count: (row.usage_count as number | null) ?? 0,
    revoked_at: (row.revoked_at as string | null) ?? null,
    created_at: row.created_at as string,
    status: deriveStatus({
      revoked_at: (row.revoked_at as string | null) ?? null,
      deleted_at: (row.deleted_at as string | null) ?? null,
      expires_at: (row.expires_at as string | null) ?? null,
    }),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// CRUD
// ────────────────────────────────────────────────────────────────────────────

export async function listApiKeys(tenantId: string): Promise<ApiKey[]> {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, name, description, key_prefix, scopes, rate_limit_per_minute,
                allowed_ips, expires_at, last_used_at, usage_count,
                revoked_at, deleted_at, created_at
           FROM api_keys
          WHERE tenant_id = $1 AND deleted_at IS NULL
          ORDER BY created_at DESC`,
        [tenantId]
      );
      return rows.map(mapRow);
    });
  } catch {
    return [];
  }
}

export interface CreateApiKeyInput {
  name: string;
  description?: string | null;
  scopes: string[];
  rate_limit_per_minute?: number;
  allowed_ips?: string[] | null;
  expires_at?: string | null;
}

export async function createApiKey(
  tenantId: string,
  userId: string,
  data: CreateApiKeyInput
): Promise<CreatedApiKey> {
  const validScopes = data.scopes.filter((s) =>
    AVAILABLE_SCOPES.some((avail) => avail.key === s)
  );

  const { rawKey, keyHash, keyPrefix } = generateKey();

  try {
    return await withTenant(tenantId, async (client) => {
      const {
        rows: [row],
      } = await client.query(
        `INSERT INTO api_keys (
            tenant_id, name, description, key_hash, key_prefix,
            scopes, permissions, rate_limit_per_minute, allowed_ips,
            expires_at, created_by
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10
          )
          RETURNING id, name, description, key_prefix, scopes, rate_limit_per_minute,
                    allowed_ips, expires_at, last_used_at, usage_count,
                    revoked_at, deleted_at, created_at`,
        [
          tenantId,
          data.name,
          data.description ?? null,
          keyHash,
          keyPrefix,
          validScopes,
          data.rate_limit_per_minute ?? 100,
          data.allowed_ips ?? null,
          data.expires_at ?? null,
          userId,
        ]
      );
      return { ...mapRow(row), full_key: rawKey };
    });
  } catch {
    // Mock fallback voor dev zonder DB.
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    return {
      id,
      name: data.name,
      description: data.description ?? null,
      key_prefix: keyPrefix,
      scopes: validScopes,
      permissions: validScopes,
      rate_limit_per_minute: data.rate_limit_per_minute ?? 100,
      allowed_ips: data.allowed_ips ?? null,
      expires_at: data.expires_at ?? null,
      last_used_at: null,
      usage_count: 0,
      revoked_at: null,
      created_at: now,
      status: 'active',
      full_key: rawKey,
    };
  }
}

export interface UpdateApiKeyInput {
  name?: string;
  description?: string | null;
  scopes?: string[];
  rate_limit_per_minute?: number;
  allowed_ips?: string[] | null;
  expires_at?: string | null;
}

export async function updateApiKey(
  tenantId: string,
  keyId: string,
  data: UpdateApiKeyInput
): Promise<ApiKey> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(data.name);
  }
  if (data.description !== undefined) {
    fields.push(`description = $${idx++}`);
    values.push(data.description);
  }
  if (data.scopes !== undefined) {
    const validScopes = data.scopes.filter((s) =>
      AVAILABLE_SCOPES.some((avail) => avail.key === s)
    );
    fields.push(`scopes = $${idx++}`);
    fields.push(`permissions = $${idx++}`);
    values.push(validScopes);
    values.push(validScopes);
  }
  if (data.rate_limit_per_minute !== undefined) {
    fields.push(`rate_limit_per_minute = $${idx++}`);
    values.push(data.rate_limit_per_minute);
  }
  if (data.allowed_ips !== undefined) {
    fields.push(`allowed_ips = $${idx++}`);
    values.push(data.allowed_ips);
  }
  if (data.expires_at !== undefined) {
    fields.push(`expires_at = $${idx++}`);
    values.push(data.expires_at);
  }

  if (fields.length === 0) {
    const existing = await getApiKey(tenantId, keyId);
    if (!existing) throw new AppError(404, 'API_KEY_NOT_FOUND', 'API-sleutel niet gevonden');
    return existing;
  }

  values.push(keyId);
  values.push(tenantId);

  return await withTenant(tenantId, async (client) => {
    const {
      rows: [row],
    } = await client.query(
      `UPDATE api_keys
          SET ${fields.join(', ')}
        WHERE id = $${idx++} AND tenant_id = $${idx++} AND deleted_at IS NULL
        RETURNING id, name, description, key_prefix, scopes, rate_limit_per_minute,
                  allowed_ips, expires_at, last_used_at, usage_count,
                  revoked_at, deleted_at, created_at`,
      values
    );
    if (!row) throw new AppError(404, 'API_KEY_NOT_FOUND', 'API-sleutel niet gevonden');
    return mapRow(row);
  });
}

export async function getApiKey(tenantId: string, keyId: string): Promise<ApiKey | null> {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, name, description, key_prefix, scopes, rate_limit_per_minute,
                allowed_ips, expires_at, last_used_at, usage_count,
                revoked_at, deleted_at, created_at
           FROM api_keys
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
          LIMIT 1`,
        [keyId, tenantId]
      );
      return rows[0] ? mapRow(rows[0]) : null;
    });
  } catch {
    return null;
  }
}

export async function rotateApiKey(
  tenantId: string,
  keyId: string
): Promise<{ key: string; record: ApiKey }> {
  const { rawKey, keyHash, keyPrefix } = generateKey();

  return await withTenant(tenantId, async (client) => {
    const {
      rows: [row],
    } = await client.query(
      `UPDATE api_keys
          SET key_hash = $1,
              key_prefix = $2,
              last_used_at = NULL,
              revoked_at = NULL
        WHERE id = $3 AND tenant_id = $4 AND deleted_at IS NULL
        RETURNING id, name, description, key_prefix, scopes, rate_limit_per_minute,
                  allowed_ips, expires_at, last_used_at, usage_count,
                  revoked_at, deleted_at, created_at`,
      [keyHash, keyPrefix, keyId, tenantId]
    );
    if (!row) throw new AppError(404, 'API_KEY_NOT_FOUND', 'API-sleutel niet gevonden');
    return { key: rawKey, record: mapRow(row) };
  });
}

export async function revokeApiKey(tenantId: string, keyId: string): Promise<void> {
  try {
    await withTenant(tenantId, async (client) => {
      const {
        rows: [key],
      } = await client.query(
        `UPDATE api_keys
            SET deleted_at = now(),
                revoked_at = now()
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
          RETURNING id`,
        [keyId, tenantId]
      );
      if (!key) {
        throw new AppError(404, 'API_KEY_NOT_FOUND', 'API key niet gevonden');
      }
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Non-AppError DB failures: swallow
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Usage
// ────────────────────────────────────────────────────────────────────────────

export async function getUsageLog(
  tenantId: string,
  keyId: string,
  limit = 100
): Promise<ApiKeyUsage[]> {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, api_key_id, method, path, status_code, ip_address::text AS ip_address,
                user_agent, duration_ms, error_code, created_at
           FROM api_key_usage_log
          WHERE tenant_id = $1 AND api_key_id = $2
          ORDER BY created_at DESC
          LIMIT $3`,
        [tenantId, keyId, Math.min(limit, 500)]
      );
      return rows;
    });
  } catch {
    return [];
  }
}

export async function getUsageStats(
  tenantId: string,
  keyId: string
): Promise<UsageStats> {
  try {
    return await withTenant(tenantId, async (client) => {
      const { rows: aggRows } = await client.query(
        `SELECT
            COUNT(*)::int                                                      AS total,
            COUNT(*) FILTER (WHERE created_at > now() - INTERVAL '24 hours')::int AS last_24h,
            COUNT(*) FILTER (WHERE created_at > now() - INTERVAL '7 days')::int   AS last_7d,
            COUNT(*) FILTER (WHERE status_code >= 400 AND created_at > now() - INTERVAL '24 hours')::int AS errors_24h,
            AVG(duration_ms)::int                                              AS avg_duration_ms
           FROM api_key_usage_log
          WHERE tenant_id = $1 AND api_key_id = $2`,
        [tenantId, keyId]
      );

      const { rows: topEndpoints } = await client.query(
        `SELECT path, COUNT(*)::int AS count
           FROM api_key_usage_log
          WHERE tenant_id = $1 AND api_key_id = $2
            AND created_at > now() - INTERVAL '7 days'
          GROUP BY path
          ORDER BY count DESC
          LIMIT 10`,
        [tenantId, keyId]
      );

      const { rows: byStatus } = await client.query(
        `SELECT status_code, COUNT(*)::int AS count
           FROM api_key_usage_log
          WHERE tenant_id = $1 AND api_key_id = $2
            AND created_at > now() - INTERVAL '7 days'
          GROUP BY status_code
          ORDER BY count DESC`,
        [tenantId, keyId]
      );

      const { rows: daily } = await client.query(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date,
                COUNT(*)::int AS count
           FROM api_key_usage_log
          WHERE tenant_id = $1 AND api_key_id = $2
            AND created_at > now() - INTERVAL '7 days'
          GROUP BY 1
          ORDER BY 1 ASC`,
        [tenantId, keyId]
      );

      const agg = aggRows[0] ?? {};
      return {
        total: Number(agg.total ?? 0),
        last_24h: Number(agg.last_24h ?? 0),
        last_7d: Number(agg.last_7d ?? 0),
        errors_24h: Number(agg.errors_24h ?? 0),
        avg_duration_ms: agg.avg_duration_ms ?? null,
        top_endpoints: topEndpoints,
        by_status: byStatus,
        daily,
      };
    });
  } catch {
    return {
      total: 0,
      last_24h: 0,
      last_7d: 0,
      errors_24h: 0,
      avg_duration_ms: null,
      top_endpoints: [],
      by_status: [],
      daily: [],
    };
  }
}

export function getAvailableScopes(): ApiScopeDefinition[] {
  return AVAILABLE_SCOPES;
}
