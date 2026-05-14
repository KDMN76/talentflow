-- 031_whatsapp.sql
-- Sprint Q4.6 — WhatsApp Business + omni-channel inbox (Agent ZZZ).
--
-- 360dialog-based WhatsApp Business integration. One integration per tenant,
-- approved templates, per-candidate consent, opt-in tokens, and inbound +
-- outbound message tracking. All messages are dual-written to the existing
-- `communications` table (Q3.1) so AAAA's omni-channel inbox aggregates them.
--
-- Tables:
--   - whatsapp_integrations  : one row per tenant 360dialog connection
--   - whatsapp_templates     : Meta-reviewed message templates
--   - whatsapp_messages      : inbound + outbound message rows
--   - whatsapp_consents      : per-candidate consent state
--   - whatsapp_optin_tokens  : signed tokens for the GDPR opt-in landing page
--
-- Idempotent. KDMN conventions: IF NOT EXISTS, DO $$ guards, RLS via
-- `app.tenant_id` setting, snake_case, `created_at` columns.

-- =========================================================================
-- A) whatsapp_integrations — one row per tenant WhatsApp Business account
-- =========================================================================

CREATE TABLE IF NOT EXISTS whatsapp_integrations (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider                     TEXT NOT NULL DEFAULT '360dialog',
  status                       TEXT NOT NULL DEFAULT 'disconnected',
  phone_number                 TEXT NOT NULL,
  display_name                 TEXT,
  api_key_encrypted            BYTEA,
  waba_id                      TEXT,
  webhook_secret_encrypted     BYTEA,
  quality_rating               TEXT NOT NULL DEFAULT 'unknown',
  messaging_limit              TEXT,
  connected_by                 UUID REFERENCES users(id) ON DELETE SET NULL,
  connected_at                 TIMESTAMPTZ,
  last_health_check_at         TIMESTAMPTZ,
  last_error                   TEXT,
  metadata                     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_integrations_provider_check'
  ) THEN
    ALTER TABLE whatsapp_integrations
      ADD CONSTRAINT whatsapp_integrations_provider_check
      CHECK (provider IN ('360dialog'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_integrations_status_check'
  ) THEN
    ALTER TABLE whatsapp_integrations
      ADD CONSTRAINT whatsapp_integrations_status_check
      CHECK (status IN ('connected','disconnected','suspended','error'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_integrations_quality_check'
  ) THEN
    ALTER TABLE whatsapp_integrations
      ADD CONSTRAINT whatsapp_integrations_quality_check
      CHECK (quality_rating IN ('green','yellow','red','unknown'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_integrations_tenant_unique'
  ) THEN
    ALTER TABLE whatsapp_integrations
      ADD CONSTRAINT whatsapp_integrations_tenant_unique UNIQUE (tenant_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_whatsapp_integrations_tenant
  ON whatsapp_integrations (tenant_id, status);

ALTER TABLE whatsapp_integrations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'whatsapp_integrations'
      AND policyname = 'tenant_isolation_whatsapp_integrations'
  ) THEN
    CREATE POLICY tenant_isolation_whatsapp_integrations ON whatsapp_integrations
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- B) whatsapp_templates — Meta-reviewed templates required for >24h outbound
-- =========================================================================

CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_id      UUID REFERENCES whatsapp_integrations(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  external_id         TEXT,
  language            TEXT NOT NULL,
  category            TEXT,
  status              TEXT NOT NULL DEFAULT 'draft',
  header              JSONB,
  body                TEXT NOT NULL,
  footer              TEXT,
  buttons             JSONB NOT NULL DEFAULT '[]'::jsonb,
  example_variables   JSONB NOT NULL DEFAULT '[]'::jsonb,
  rejection_reason    TEXT,
  submitted_at        TIMESTAMPTZ,
  approved_at         TIMESTAMPTZ,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_templates_category_check'
  ) THEN
    ALTER TABLE whatsapp_templates
      ADD CONSTRAINT whatsapp_templates_category_check
      CHECK (category IS NULL OR category IN ('marketing','utility','authentication'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_templates_status_check'
  ) THEN
    ALTER TABLE whatsapp_templates
      ADD CONSTRAINT whatsapp_templates_status_check
      CHECK (status IN ('draft','submitted','approved','rejected','paused','disabled'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_templates_name_unique'
  ) THEN
    ALTER TABLE whatsapp_templates
      ADD CONSTRAINT whatsapp_templates_name_unique UNIQUE (tenant_id, name, language);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_tenant_status
  ON whatsapp_templates (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_integration
  ON whatsapp_templates (integration_id);

ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'whatsapp_templates'
      AND policyname = 'tenant_isolation_whatsapp_templates'
  ) THEN
    CREATE POLICY tenant_isolation_whatsapp_templates ON whatsapp_templates
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- C) whatsapp_messages — outbound + inbound messages
-- =========================================================================
-- Note: candidate_id is referenced by id but kept nullable to allow inbound
-- messages from unknown numbers that haven't been matched to a candidate yet.
-- The service layer resolves candidates via phone number lookup; if no match
-- we still insert the row so it can be reviewed.

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_id       UUID REFERENCES whatsapp_integrations(id) ON DELETE SET NULL,
  candidate_id         UUID REFERENCES candidates(id) ON DELETE SET NULL,
  conversation_id      TEXT,
  direction            TEXT NOT NULL,
  message_type         TEXT NOT NULL DEFAULT 'text',
  template_id          UUID REFERENCES whatsapp_templates(id) ON DELETE SET NULL,
  template_variables   JSONB NOT NULL DEFAULT '[]'::jsonb,
  body_text            TEXT,
  media_url            TEXT,
  media_mime           TEXT,
  status               TEXT NOT NULL DEFAULT 'queued',
  external_id          TEXT,
  reply_to_id          UUID REFERENCES whatsapp_messages(id) ON DELETE SET NULL,
  pricing_category     TEXT,
  pricing_amount_cents INTEGER,
  sent_at              TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  read_at              TIMESTAMPTZ,
  error_code           TEXT,
  error_message        TEXT,
  communication_id     UUID,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_messages_direction_check'
  ) THEN
    ALTER TABLE whatsapp_messages
      ADD CONSTRAINT whatsapp_messages_direction_check
      CHECK (direction IN ('outbound','inbound'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_messages_type_check'
  ) THEN
    ALTER TABLE whatsapp_messages
      ADD CONSTRAINT whatsapp_messages_type_check
      CHECK (message_type IN ('text','template','image','video','document','audio','location','reaction','interactive'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_messages_status_check'
  ) THEN
    ALTER TABLE whatsapp_messages
      ADD CONSTRAINT whatsapp_messages_status_check
      CHECK (status IN ('queued','sent','delivered','read','failed','received'));
  END IF;
END $$;

-- Idempotency for inbound webhooks: dedupe by tenant + external_id.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_messages_external_id_unique'
  ) THEN
    ALTER TABLE whatsapp_messages
      ADD CONSTRAINT whatsapp_messages_external_id_unique UNIQUE (tenant_id, external_id);
  END IF;
END $$;

-- Append-only enforcement: once `sent_at` is set, forbid changes to
-- `body_text` and `external_id`. Compliance/audit reasons (DoD §5).
CREATE OR REPLACE FUNCTION whatsapp_messages_append_only()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.sent_at IS NOT NULL THEN
    IF NEW.body_text   IS DISTINCT FROM OLD.body_text
       OR NEW.external_id IS DISTINCT FROM OLD.external_id THEN
      RAISE EXCEPTION 'whatsapp_messages: append-only after sent_at is set'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'whatsapp_messages_append_only_tg'
  ) THEN
    CREATE TRIGGER whatsapp_messages_append_only_tg
      BEFORE UPDATE ON whatsapp_messages
      FOR EACH ROW
      EXECUTE FUNCTION whatsapp_messages_append_only();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_tenant_candidate
  ON whatsapp_messages (tenant_id, candidate_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_tenant_dir_status
  ON whatsapp_messages (tenant_id, direction, status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_tenant_conversation
  ON whatsapp_messages (tenant_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_tenant_external
  ON whatsapp_messages (tenant_id, external_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_tenant_created
  ON whatsapp_messages (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_communication
  ON whatsapp_messages (communication_id);

ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'whatsapp_messages'
      AND policyname = 'tenant_isolation_whatsapp_messages'
  ) THEN
    CREATE POLICY tenant_isolation_whatsapp_messages ON whatsapp_messages
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- D) whatsapp_consents — per-candidate consent state
-- =========================================================================

CREATE TABLE IF NOT EXISTS whatsapp_consents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id        UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  phone_number        TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  opt_in_source       TEXT,
  opt_in_message_id   UUID REFERENCES whatsapp_messages(id) ON DELETE SET NULL,
  granted_at          TIMESTAMPTZ,
  withdrawn_at        TIMESTAMPTZ,
  withdrawal_reason   TEXT,
  ip_address          TEXT,
  user_agent          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_consents_status_check'
  ) THEN
    ALTER TABLE whatsapp_consents
      ADD CONSTRAINT whatsapp_consents_status_check
      CHECK (status IN ('pending','granted','withdrawn','blocked'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_consents_source_check'
  ) THEN
    ALTER TABLE whatsapp_consents
      ADD CONSTRAINT whatsapp_consents_source_check
      CHECK (opt_in_source IS NULL OR opt_in_source IN ('career_page','recruiter_invite','reply','imported'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_consents_candidate_unique'
  ) THEN
    ALTER TABLE whatsapp_consents
      ADD CONSTRAINT whatsapp_consents_candidate_unique UNIQUE (tenant_id, candidate_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_whatsapp_consents_tenant_status
  ON whatsapp_consents (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_consents_tenant_phone
  ON whatsapp_consents (tenant_id, phone_number);

ALTER TABLE whatsapp_consents ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'whatsapp_consents'
      AND policyname = 'tenant_isolation_whatsapp_consents'
  ) THEN
    CREATE POLICY tenant_isolation_whatsapp_consents ON whatsapp_consents
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- E) whatsapp_optin_tokens — signed tokens for GDPR opt-in landing page
-- =========================================================================

CREATE TABLE IF NOT EXISTS whatsapp_optin_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id  UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  phone_number  TEXT NOT NULL,
  token_hash    TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_optin_tokens_hash_unique'
  ) THEN
    ALTER TABLE whatsapp_optin_tokens
      ADD CONSTRAINT whatsapp_optin_tokens_hash_unique UNIQUE (token_hash);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_whatsapp_optin_tokens_tenant_candidate
  ON whatsapp_optin_tokens (tenant_id, candidate_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_optin_tokens_expires
  ON whatsapp_optin_tokens (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE whatsapp_optin_tokens ENABLE ROW LEVEL SECURITY;
-- The public consent route looks up by token_hash with the postgres-level user;
-- inside the API we look up via withoutTenant. Policy allows tenant-scoped reads
-- when app.tenant_id is set, and is bypassed by the BYPASSRLS service account.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'whatsapp_optin_tokens'
      AND policyname = 'tenant_isolation_whatsapp_optin_tokens'
  ) THEN
    CREATE POLICY tenant_isolation_whatsapp_optin_tokens ON whatsapp_optin_tokens
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
