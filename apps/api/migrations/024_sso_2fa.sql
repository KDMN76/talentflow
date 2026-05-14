-- 024_sso_2fa.sql
-- Sprint Q4.2 (Agent NNN) — Enterprise security: SSO/SAML, SCIM provisioning,
-- en TOTP 2FA backend.
--
-- Idempotent. Volgt KDMN-conventies: IF NOT EXISTS, DO $$ guards,
-- snake_case, RLS via app.tenant_id setting.
--
-- Bevat:
--   1. tenant_sso_config       — per-tenant SAML + SCIM-config
--   2. user_2fa_secrets        — TOTP-secret + backup-codes per user
--   3. tenant_2fa_policy       — afdwingen 2FA voor specifieke roles
--   4. scim_provisioning_log   — audit-trail van SCIM-events

-- =========================================================================
-- A) TENANT SSO CONFIG — SAML IdP-koppeling + SCIM-token
-- =========================================================================

CREATE TABLE IF NOT EXISTS tenant_sso_config (
  tenant_id           UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  provider            TEXT CHECK (provider IN ('okta','azure_ad','google_workspace','generic_saml')),
  enabled             BOOLEAN NOT NULL DEFAULT FALSE,

  -- SAML
  entry_point         TEXT,                       -- IdP login URL (SSO endpoint)
  issuer              TEXT,                       -- TalentFlow's entity ID (SP-side)
  idp_cert            TEXT,                       -- IdP signing cert (PEM, multi-line)

  -- SCIM
  scim_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  scim_token_hash     TEXT,                       -- bcrypt-hashed bearer token

  -- Auto-provisioning
  auto_create_users   BOOLEAN NOT NULL DEFAULT TRUE,
  default_role        TEXT NOT NULL DEFAULT 'recruiter',
  attribute_mapping   JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenant_sso_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tenant_sso_config' AND policyname = 'tenant_sso_config_isolation'
  ) THEN
    CREATE POLICY tenant_sso_config_isolation ON tenant_sso_config
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- B) USER 2FA SECRETS — TOTP + backup-codes
-- =========================================================================
--
-- Note: secret is base32 plaintext (MVP). Productie-hardening: pgcrypto
-- symmetric encrypt met tenant-key. Backup-codes worden ALTIJD bcrypt-hashed
-- (single-use, plain-text-leak-resistant).

CREATE TABLE IF NOT EXISTS user_2fa_secrets (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  secret         TEXT NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  backup_codes   TEXT[] NOT NULL DEFAULT '{}',     -- bcrypt-hashed, 10 codes
  enabled_at     TIMESTAMPTZ,
  last_used_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_2fa_secrets_tenant
  ON user_2fa_secrets (tenant_id, enabled);

ALTER TABLE user_2fa_secrets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_2fa_secrets' AND policyname = 'user_2fa_secrets_tenant_isolation'
  ) THEN
    CREATE POLICY user_2fa_secrets_tenant_isolation ON user_2fa_secrets
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- C) TENANT 2FA POLICY — afdwingen voor admins/owners/etc.
-- =========================================================================

CREATE TABLE IF NOT EXISTS tenant_2fa_policy (
  tenant_id          UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  required_for_roles TEXT[] NOT NULL DEFAULT '{}',
  required_for_all   BOOLEAN NOT NULL DEFAULT FALSE,
  grace_period_days  INTEGER NOT NULL DEFAULT 7,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenant_2fa_policy ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tenant_2fa_policy' AND policyname = 'tenant_2fa_policy_isolation'
  ) THEN
    CREATE POLICY tenant_2fa_policy_isolation ON tenant_2fa_policy
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- D) SCIM PROVISIONING LOG — audit-trail
-- =========================================================================

CREATE TABLE IF NOT EXISTS scim_provisioning_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scim_id      TEXT NOT NULL,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  operation    TEXT NOT NULL CHECK (operation IN ('create','update','deactivate','delete','patch')),
  payload      JSONB,
  status       TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success','error')),
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scim_log_tenant_created
  ON scim_provisioning_log (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scim_log_tenant_scim_id
  ON scim_provisioning_log (tenant_id, scim_id);

ALTER TABLE scim_provisioning_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'scim_provisioning_log' AND policyname = 'scim_log_tenant_isolation'
  ) THEN
    CREATE POLICY scim_log_tenant_isolation ON scim_provisioning_log
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- =========================================================================
-- E) USERS — externe SSO/SCIM koppeling kolommen
-- =========================================================================
-- Voor SCIM moeten we users kunnen mappen op IdP externalId, en bij
-- SAML-callback weten of een user via SSO is aangemaakt (audit/UX).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS scim_external_id TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sso_provider TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_scim_external_id
  ON users (tenant_id, scim_external_id) WHERE scim_external_id IS NOT NULL;

-- =========================================================================
-- F) UPDATED_AT triggers
-- =========================================================================

CREATE OR REPLACE FUNCTION set_sso_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tenant_sso_config_updated_at'
  ) THEN
    CREATE TRIGGER trg_tenant_sso_config_updated_at
      BEFORE UPDATE ON tenant_sso_config
      FOR EACH ROW EXECUTE FUNCTION set_sso_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tenant_2fa_policy_updated_at'
  ) THEN
    CREATE TRIGGER trg_tenant_2fa_policy_updated_at
      BEFORE UPDATE ON tenant_2fa_policy
      FOR EACH ROW EXECUTE FUNCTION set_sso_updated_at();
  END IF;
END $$;
