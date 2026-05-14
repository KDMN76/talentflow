-- 014_mailbox_integrations.sql
-- Sprint Q3.1 — Persoonlijke mailbox-integraties (Gmail/Outlook OAuth) +
-- bulk-mailcampagnes.
--
-- Voegt drie tabellen toe:
--   1. mailbox_integrations    — per (tenant, user, provider, account) OAuth-tokens + sync-state.
--   2. bulk_campaigns          — verzendoverzicht voor bulk-mail (consent-respect, progress).
-- Daarnaast extend `communications` met `mailbox_integration_id` zodat
-- Resend-emails (transactional) onderscheiden kunnen worden van native
-- mailbox-emails (persoonlijke Gmail/Outlook).
--
-- Volgt KDMN-conventie: idempotent (IF NOT EXISTS, DO $$ guards), snake_case,
-- RLS via app.tenant_id setting. Tokens zijn TEXT (plaintext MVP) — env var
-- MAILBOX_TOKEN_ENCRYPTION_KEY zou later kunnen worden gebruikt met pgcrypto.

-- =========================================================================
-- A) MAILBOX_INTEGRATIONS — OAuth-credentials + sync-cursor per account
-- =========================================================================

CREATE TABLE IF NOT EXISTS mailbox_integrations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  account_email     TEXT NOT NULL,
  account_name      TEXT,
  -- OAuth tokens. MVP: plaintext (zie env-warning in mailbox.service.ts).
  -- Roadmap: pgp_sym_encrypt(MAILBOX_TOKEN_ENCRYPTION_KEY).
  access_token      TEXT NOT NULL,
  refresh_token     TEXT NOT NULL,
  token_expires_at  TIMESTAMPTZ NOT NULL,
  scope             TEXT NOT NULL,
  -- Sync state
  last_sync_at      TIMESTAMPTZ,
  history_id        TEXT,
  sync_error        TEXT,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mailbox_integrations_provider_check'
  ) THEN
    ALTER TABLE mailbox_integrations
      ADD CONSTRAINT mailbox_integrations_provider_check
      CHECK (provider IN ('gmail','outlook'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mailbox_integrations_unique_account'
  ) THEN
    ALTER TABLE mailbox_integrations
      ADD CONSTRAINT mailbox_integrations_unique_account
      UNIQUE (tenant_id, user_id, provider, account_email);
  END IF;
END $$;

ALTER TABLE mailbox_integrations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'mailbox_integrations' AND policyname = 'tenant_isolation_mailbox_integrations'
  ) THEN
    CREATE POLICY tenant_isolation_mailbox_integrations ON mailbox_integrations
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mailbox_integrations_tenant_user
  ON mailbox_integrations(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_mailbox_integrations_active_sync
  ON mailbox_integrations(active, last_sync_at) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_mailbox_integrations_account_email
  ON mailbox_integrations(tenant_id, account_email);

-- =========================================================================
-- B) COMMUNICATIONS — link naar mailbox_integrations (optioneel; NULL = Resend)
-- =========================================================================

ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS mailbox_integration_id UUID
    REFERENCES mailbox_integrations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_communications_mailbox_integration
  ON communications(mailbox_integration_id)
  WHERE mailbox_integration_id IS NOT NULL;

-- =========================================================================
-- C) BULK_CAMPAIGNS — verzendoverzicht voor bulk-mail
-- =========================================================================

CREATE TABLE IF NOT EXISTS bulk_campaigns (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject                 TEXT NOT NULL,
  body_html               TEXT NOT NULL,
  template_id             UUID REFERENCES email_templates(id) ON DELETE SET NULL,
  via                     TEXT NOT NULL,
  mailbox_integration_id  UUID REFERENCES mailbox_integrations(id) ON DELETE SET NULL,
  total_eligible          INT NOT NULL DEFAULT 0,
  total_skipped_consent   INT NOT NULL DEFAULT 0,
  total_sent              INT NOT NULL DEFAULT 0,
  total_failed            INT NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'running',
  started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at            TIMESTAMPTZ
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bulk_campaigns_via_check'
  ) THEN
    ALTER TABLE bulk_campaigns
      ADD CONSTRAINT bulk_campaigns_via_check
      CHECK (via IN ('resend','mailbox_integration'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bulk_campaigns_status_check'
  ) THEN
    ALTER TABLE bulk_campaigns
      ADD CONSTRAINT bulk_campaigns_status_check
      CHECK (status IN ('running','completed','cancelled','failed'));
  END IF;
END $$;

ALTER TABLE bulk_campaigns ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'bulk_campaigns' AND policyname = 'tenant_isolation_bulk_campaigns'
  ) THEN
    CREATE POLICY tenant_isolation_bulk_campaigns ON bulk_campaigns
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bulk_campaigns_tenant_started
  ON bulk_campaigns(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_bulk_campaigns_status
  ON bulk_campaigns(tenant_id, status);

-- =========================================================================
-- D) BULK_CAMPAIGN_RECIPIENTS — per-kandidaat status (audit-trail + retries)
-- =========================================================================

CREATE TABLE IF NOT EXISTS bulk_campaign_recipients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id   UUID NOT NULL REFERENCES bulk_campaigns(id) ON DELETE CASCADE,
  candidate_id  UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'queued',
  error_message TEXT,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bulk_campaign_recipients_status_check'
  ) THEN
    ALTER TABLE bulk_campaign_recipients
      ADD CONSTRAINT bulk_campaign_recipients_status_check
      CHECK (status IN ('queued','sent','failed','skipped_no_consent'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bulk_campaign_recipients_unique'
  ) THEN
    ALTER TABLE bulk_campaign_recipients
      ADD CONSTRAINT bulk_campaign_recipients_unique
      UNIQUE (campaign_id, candidate_id);
  END IF;
END $$;

ALTER TABLE bulk_campaign_recipients ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'bulk_campaign_recipients' AND policyname = 'tenant_isolation_bulk_campaign_recipients'
  ) THEN
    CREATE POLICY tenant_isolation_bulk_campaign_recipients ON bulk_campaign_recipients
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bulk_campaign_recipients_campaign
  ON bulk_campaign_recipients(campaign_id, status);
