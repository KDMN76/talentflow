-- 023_api_key_permissions.sql
-- Sprint Q4.1 (Agent MMM) — Per-tenant API-keys met granulaire permissions,
-- rate-limit per key, IP-allowlist, expiry en usage-logging voor de API
-- playground.
--
-- Deze migratie:
--   1. Maakt de basis-tabel `api_keys` aan als die nog niet bestaat (de
--      service draaide tot nu toe alleen tegen een impliciet schema).
--   2. Voegt scopes-array, rate-limit-per-minute, IP-allowlist, expiry,
--      last_used + usage_count kolommen toe.
--   3. Maakt `api_key_usage_log` aan voor playground recente requests +
--      audit/billing.
--   4. RLS + indexes (tenant_id, api_key_id, created_at DESC).
--
-- Idempotent. Volgt KDMN-conventies: IF NOT EXISTS, DO $$ guards,
-- snake_case, RLS via app.tenant_id setting.

-- =========================================================================
-- A) BASIS TABEL — api_keys (alleen wanneer nog niet bestaand)
-- =========================================================================

CREATE TABLE IF NOT EXISTS api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  key_hash        TEXT NOT NULL,
  key_prefix      TEXT NOT NULL,
  permissions     TEXT[] NOT NULL DEFAULT '{}',
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

-- =========================================================================
-- B) UITBREIDINGEN — scopes, rate limit, IP-allowlist, expiry, usage
-- =========================================================================

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS rate_limit_per_minute INTEGER NOT NULL DEFAULT 100;

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS allowed_ips TEXT[];

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- Backfill: migreer oude `permissions` array naar `scopes` indien scopes leeg.
-- Idempotent: alleen wanneer scopes nog '{}' is.
UPDATE api_keys
SET scopes = permissions
WHERE (scopes IS NULL OR cardinality(scopes) = 0)
  AND permissions IS NOT NULL
  AND cardinality(permissions) > 0;

-- =========================================================================
-- C) USAGE LOG — recente requests voor playground / billing / debug
-- =========================================================================

CREATE TABLE IF NOT EXISTS api_key_usage_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  api_key_id      UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  method          TEXT NOT NULL,
  path            TEXT NOT NULL,
  status_code     INTEGER NOT NULL,
  ip_address      INET,
  user_agent      TEXT,
  duration_ms     INTEGER,
  error_code      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================================
-- D) INDEXES
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant
  ON api_keys (tenant_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash
  ON api_keys (key_hash) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_api_key_usage_tenant_created
  ON api_key_usage_log (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_key_created
  ON api_key_usage_log (api_key_id, created_at DESC);

-- =========================================================================
-- E) RLS
-- =========================================================================

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_key_usage_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'api_keys' AND policyname = 'api_keys_tenant_isolation'
  ) THEN
    CREATE POLICY api_keys_tenant_isolation ON api_keys
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'api_key_usage_log' AND policyname = 'api_key_usage_tenant_isolation'
  ) THEN
    CREATE POLICY api_key_usage_tenant_isolation ON api_key_usage_log
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- F) HELPER VIEW — usage-stats per key (gebruikt door de service)
-- =========================================================================

CREATE OR REPLACE VIEW api_key_usage_summary AS
SELECT
  l.tenant_id,
  l.api_key_id,
  COUNT(*)::BIGINT                                                  AS total,
  COUNT(*) FILTER (WHERE l.created_at > now() - INTERVAL '24 hours')::BIGINT  AS last_24h,
  COUNT(*) FILTER (WHERE l.created_at > now() - INTERVAL '7 days')::BIGINT    AS last_7d,
  COUNT(*) FILTER (WHERE l.status_code >= 400)::BIGINT              AS errors,
  AVG(l.duration_ms)::INTEGER                                       AS avg_duration_ms
FROM api_key_usage_log l
GROUP BY l.tenant_id, l.api_key_id;
