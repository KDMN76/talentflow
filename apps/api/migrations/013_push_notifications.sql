-- 013_push_notifications.sql
-- Sprint Q2.4 — Web Push notifications voor Hiring Manager PWA.
--
-- Voegt drie tabellen toe:
--   1. push_subscriptions        — per device-subscription (endpoint UNIQUE).
--   2. notification_preferences  — per (user, channel, event_type) on/off + quiet-hours.
--   3. notification_log          — append-only delivery-tracking voor dashboard + click-attribution.
--
-- Volgt KDMN-conventie: idempotent (IF NOT EXISTS, DO $$ guards), snake_case,
-- RLS via app.tenant_id setting.

-- =========================================================================
-- A) PUSH_SUBSCRIPTIONS — Web Push subscription per device
-- =========================================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL UNIQUE,
  keys_p256dh   TEXT NOT NULL,
  keys_auth     TEXT NOT NULL,
  user_agent    TEXT,
  device_label  TEXT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'push_subscriptions' AND policyname = 'tenant_isolation_push_subscriptions'
  ) THEN
    CREATE POLICY tenant_isolation_push_subscriptions ON push_subscriptions
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_tenant_user
  ON push_subscriptions(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint
  ON push_subscriptions(endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_active
  ON push_subscriptions(tenant_id, user_id) WHERE active = TRUE;

-- =========================================================================
-- B) NOTIFICATION_PREFERENCES — per user opt-in/out per (channel, event)
-- =========================================================================

CREATE TABLE IF NOT EXISTS notification_preferences (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel            TEXT NOT NULL,
  event_type         TEXT NOT NULL,
  enabled            BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_hours_start  TIME,
  quiet_hours_end    TIME,
  timezone           TEXT NOT NULL DEFAULT 'Europe/Amsterdam',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_preferences_channel_check'
  ) THEN
    ALTER TABLE notification_preferences
      ADD CONSTRAINT notification_preferences_channel_check
      CHECK (channel IN ('push','email','in_app'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_preferences_unique_combo'
  ) THEN
    ALTER TABLE notification_preferences
      ADD CONSTRAINT notification_preferences_unique_combo
      UNIQUE (tenant_id, user_id, channel, event_type);
  END IF;
END $$;

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'notification_preferences' AND policyname = 'tenant_isolation_notification_preferences'
  ) THEN
    CREATE POLICY tenant_isolation_notification_preferences ON notification_preferences
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notification_preferences_tenant_user
  ON notification_preferences(tenant_id, user_id);

-- =========================================================================
-- C) NOTIFICATION_LOG — append-only delivery-tracking
-- =========================================================================

CREATE TABLE IF NOT EXISTS notification_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  payload       JSONB,
  status        TEXT NOT NULL,
  error         TEXT,
  delivered_at  TIMESTAMPTZ,
  clicked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_log_status_check'
  ) THEN
    ALTER TABLE notification_log
      ADD CONSTRAINT notification_log_status_check
      CHECK (status IN ('queued','sent','failed','suppressed_quiet','suppressed_pref','clicked'));
  END IF;
END $$;

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'notification_log' AND policyname = 'tenant_isolation_notification_log'
  ) THEN
    CREATE POLICY tenant_isolation_notification_log ON notification_log
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notification_log_tenant_user_created
  ON notification_log(tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_log_event_type
  ON notification_log(tenant_id, event_type, created_at DESC);
