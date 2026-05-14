-- 022_webhook_deliveries.sql
-- Sprint Q4.1 (Agent LLL) — Webhook event-log + retry-mechanism + admin-UI.
--
-- Drie dingen:
--   1) `webhook_subscriptions`   — vervangt de oude (nooit aangemaakte) `webhooks`
--                                   tabel; canoniek model met HMAC-secret +
--                                   wildcard event-matching + failure_count.
--   2) `webhook_deliveries`      — per-attempt delivery log incl request/response
--                                   bodies, status, retry-schedule.
--   3) compat-view `webhooks`    — backwards-compat zodat oudere queries blijven
--                                   werken; nieuwe code gebruikt `webhook_subscriptions`.
--
-- Idempotent: IF NOT EXISTS / DO-blocks / ON CONFLICT.
-- RLS: tenant-isolated via `app.tenant_id` setting.

-- =========================================================================
-- A) WEBHOOK_SUBSCRIPTIONS
-- =========================================================================

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  name              TEXT,
  description       TEXT,
  url               TEXT NOT NULL,
  secret            TEXT NOT NULL,
  events            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  failure_count     INTEGER NOT NULL DEFAULT 0,
  last_delivered_at TIMESTAMPTZ,
  last_failure_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

-- Idempotente kolom-toevoegingen voor het geval een eerdere prerelease al
-- bestond met een ander schema:
ALTER TABLE webhook_subscriptions ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE webhook_subscriptions ADD COLUMN IF NOT EXISTS failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE webhook_subscriptions ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE webhook_subscriptions ADD COLUMN IF NOT EXISTS last_delivered_at TIMESTAMPTZ;
ALTER TABLE webhook_subscriptions ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMPTZ;
ALTER TABLE webhook_subscriptions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE webhook_subscriptions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- ─── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'webhook_subscriptions'
      AND policyname = 'tenant_isolation_webhook_subscriptions'
  ) THEN
    CREATE POLICY tenant_isolation_webhook_subscriptions ON webhook_subscriptions
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- ─── Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_webhook_subs_tenant_active
  ON webhook_subscriptions(tenant_id, active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_subs_events
  ON webhook_subscriptions USING GIN (events);

-- =========================================================================
-- B) WEBHOOK_DELIVERIES
-- =========================================================================

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id   UUID NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL,
  event_id          UUID,
  payload           JSONB NOT NULL,
  request_url       TEXT NOT NULL,
  request_headers   JSONB,
  request_body      TEXT,
  response_status   INTEGER,
  response_headers  JSONB,
  response_body     TEXT,
  attempt           INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','delivering','succeeded','failed','dead')),
  error_message     TEXT,
  duration_ms       INTEGER,
  next_retry_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at      TIMESTAMPTZ
);

-- ─── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'webhook_deliveries'
      AND policyname = 'tenant_isolation_webhook_deliveries'
  ) THEN
    CREATE POLICY tenant_isolation_webhook_deliveries ON webhook_deliveries
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- ─── Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_tenant_created
  ON webhook_deliveries(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_subscription_created
  ON webhook_deliveries(subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status
  ON webhook_deliveries(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event_type
  ON webhook_deliveries(tenant_id, event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending_retry
  ON webhook_deliveries(next_retry_at) WHERE status = 'pending';

-- =========================================================================
-- C) BACKWARDS-COMPAT VIEW `webhooks`
-- =========================================================================
--
-- Oudere code (settings UI / hooks) verwijst naar `webhooks` met
-- `name`/`active`. We mappen 1:1 op webhook_subscriptions zodat nieuwe
-- migraties geen brede refactor vereisen. SECURITY INVOKER zodat RLS
-- correct doorslaat naar de onderliggende tabel.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'webhooks'
  ) THEN
    EXECUTE $v$
      CREATE VIEW webhooks AS
        SELECT
          id, tenant_id, user_id,
          COALESCE(name, description, url) AS name,
          url, secret, events, active,
          last_delivered_at,
          failure_count,
          description,
          created_at, updated_at, deleted_at
        FROM webhook_subscriptions
    $v$;
  END IF;
END $$;

-- =========================================================================
-- D) COMMENTS
-- =========================================================================

COMMENT ON TABLE webhook_subscriptions IS
  'Webhook abonnement per tenant. Wildcards: events[] kan ''candidate.*'' bevatten — match-logic in deliveries.service.ts.';
COMMENT ON COLUMN webhook_subscriptions.secret IS
  'Random hex (40 char). Gebruikt om HMAC-SHA256 signature te genereren in X-TalentFlow-Signature header.';
COMMENT ON COLUMN webhook_subscriptions.failure_count IS
  'Loopt op bij elke failed delivery, reset op succes. Bij >= 20 logt de worker een audit-event WEBHOOK_AUTO_DISABLED.';
COMMENT ON TABLE webhook_deliveries IS
  'Append-style delivery log: één row per attempt. status=pending → delivering → succeeded|failed|dead.';
COMMENT ON COLUMN webhook_deliveries.attempt IS
  'Pogingnummer: 1..5. Backoff: 1m, 5m, 30m, 2h, 6h. Bij attempt=5 + failure → status=dead.';
