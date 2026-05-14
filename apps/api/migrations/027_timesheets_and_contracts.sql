-- 027_timesheets_and_contracts.sql
-- Sprint Q4.4 — Temp/contract back-office (Agent TTT).
--
-- Tabellen voor het uitzendbureau-deel: contracten + extensies, timesheets +
-- entries, contract-expiry notification queue, timesheet audit-trail, en
-- public timesheet portal-tokens (kandidaat vult uren in zonder login).
--
-- Idempotent. KDMN-conventies: IF NOT EXISTS, DO $$ guards, RLS via
-- `app.tenant_id` setting, snake_case, `created_at` op alle tabellen.
--
-- Coordineert met:
--   - Agent UUU (billing/exact-online/commissions/forecasting) — UUU importeert
--     `summarizeApprovedHoursForBilling` uit timesheets.service.ts. Wij
--     publiceren alleen die signature; UUU's tabellen staan in 028_*.
--   - Agent VVV (web) — frontend consumeert deze REST routes.

-- =========================================================================
-- A) contracts — plaatsings-contract per kandidaat (temp/contract/perm/freelance)
-- =========================================================================

CREATE TABLE IF NOT EXISTS contracts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id             UUID NOT NULL REFERENCES candidates(id) ON DELETE RESTRICT,
  application_id           UUID,
  client_organization_id   UUID,
  job_id                   UUID REFERENCES jobs(id) ON DELETE SET NULL,
  contract_type            TEXT NOT NULL DEFAULT 'temp',
  status                   TEXT NOT NULL DEFAULT 'draft',
  start_date               DATE NOT NULL,
  end_date                 DATE,
  weekly_hours             NUMERIC(5,2),
  hourly_rate_candidate    NUMERIC(10,2),
  hourly_rate_client       NUMERIC(10,2),
  margin_percent           NUMERIC(5,2),
  currency                 TEXT NOT NULL DEFAULT 'EUR',
  cao                      TEXT,
  wtza_compliant           BOOLEAN,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  signed_at                TIMESTAMPTZ,
  terminated_at            TIMESTAMPTZ,
  termination_reason       TEXT,
  created_by               UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contracts_type_check'
  ) THEN
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_type_check
      CHECK (contract_type IN ('temp','contract','permanent','freelance'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contracts_status_check'
  ) THEN
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_status_check
      CHECK (status IN ('draft','active','ended','terminated','renewed'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contracts_weekly_hours_check'
  ) THEN
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_weekly_hours_check
      CHECK (weekly_hours IS NULL OR (weekly_hours >= 0 AND weekly_hours <= 168));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contracts_tenant_status
  ON contracts (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_contracts_tenant_candidate
  ON contracts (tenant_id, candidate_id);
CREATE INDEX IF NOT EXISTS idx_contracts_tenant_job
  ON contracts (tenant_id, job_id);
CREATE INDEX IF NOT EXISTS idx_contracts_tenant_end_date
  ON contracts (tenant_id, end_date);
CREATE INDEX IF NOT EXISTS idx_contracts_tenant_created
  ON contracts (tenant_id, created_at DESC, id DESC);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'contracts' AND policyname = 'tenant_isolation_contracts'
  ) THEN
    CREATE POLICY tenant_isolation_contracts ON contracts
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- B) contract_extensions — historische verlengingen (één rij per verlenging)
-- =========================================================================

CREATE TABLE IF NOT EXISTS contract_extensions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id         UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  previous_end_date   DATE NOT NULL,
  new_end_date        DATE NOT NULL,
  reason              TEXT,
  signed_at           TIMESTAMPTZ,
  signed_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_extensions_tenant_contract
  ON contract_extensions (tenant_id, contract_id, created_at DESC);

ALTER TABLE contract_extensions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'contract_extensions'
      AND policyname = 'tenant_isolation_contract_extensions'
  ) THEN
    CREATE POLICY tenant_isolation_contract_extensions ON contract_extensions
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- C) timesheets — één rij per (contract, week_start)
-- =========================================================================

CREATE TABLE IF NOT EXISTS timesheets (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id            UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  candidate_id           UUID,
  week_start             DATE NOT NULL,
  week_end               DATE NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'draft',
  total_hours            NUMERIC(6,2) NOT NULL DEFAULT 0,
  total_overtime_hours   NUMERIC(6,2) NOT NULL DEFAULT 0,
  notes                  TEXT,
  submitted_at           TIMESTAMPTZ,
  approved_at            TIMESTAMPTZ,
  approved_by            UUID,
  rejected_at            TIMESTAMPTZ,
  rejection_reason       TEXT,
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'timesheets_status_check'
  ) THEN
    ALTER TABLE timesheets
      ADD CONSTRAINT timesheets_status_check
      CHECK (status IN ('draft','submitted','approved','rejected','disputed'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'timesheets_tenant_contract_week_unique'
  ) THEN
    ALTER TABLE timesheets
      ADD CONSTRAINT timesheets_tenant_contract_week_unique
      UNIQUE (tenant_id, contract_id, week_start);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_timesheets_tenant_status
  ON timesheets (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_timesheets_tenant_contract
  ON timesheets (tenant_id, contract_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_tenant_candidate
  ON timesheets (tenant_id, candidate_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_tenant_week_start
  ON timesheets (tenant_id, week_start);

ALTER TABLE timesheets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'timesheets' AND policyname = 'tenant_isolation_timesheets'
  ) THEN
    CREATE POLICY tenant_isolation_timesheets ON timesheets
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- D) timesheet_entries — één rij per dag binnen een timesheet
-- =========================================================================

CREATE TABLE IF NOT EXISTS timesheet_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  timesheet_id    UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  hours           NUMERIC(5,2) NOT NULL,
  overtime_hours  NUMERIC(5,2) NOT NULL DEFAULT 0,
  break_minutes   INTEGER NOT NULL DEFAULT 0,
  description     TEXT,
  project_code    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'timesheet_entries_hours_check'
  ) THEN
    ALTER TABLE timesheet_entries
      ADD CONSTRAINT timesheet_entries_hours_check
      CHECK (hours >= 0 AND hours <= 24);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'timesheet_entries_overtime_check'
  ) THEN
    ALTER TABLE timesheet_entries
      ADD CONSTRAINT timesheet_entries_overtime_check
      CHECK (overtime_hours >= 0 AND overtime_hours <= 24);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_timesheet_entries_tenant_timesheet
  ON timesheet_entries (tenant_id, timesheet_id, date);

ALTER TABLE timesheet_entries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'timesheet_entries'
      AND policyname = 'tenant_isolation_timesheet_entries'
  ) THEN
    CREATE POLICY tenant_isolation_timesheet_entries ON timesheet_entries
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- E) contract_notification_queue — driven by BullMQ contractExpiry cron
-- =========================================================================

CREATE TABLE IF NOT EXISTS contract_notification_queue (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id         UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  notification_type   TEXT NOT NULL,
  scheduled_for       DATE NOT NULL,
  sent_at             TIMESTAMPTZ,
  recipients          JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contract_notification_queue_type_check'
  ) THEN
    ALTER TABLE contract_notification_queue
      ADD CONSTRAINT contract_notification_queue_type_check
      CHECK (notification_type IN ('expiring_30d','expiring_14d','expiring_7d','ended'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contract_notification_queue_unique'
  ) THEN
    ALTER TABLE contract_notification_queue
      ADD CONSTRAINT contract_notification_queue_unique
      UNIQUE (tenant_id, contract_id, notification_type);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contract_notif_queue_scheduled
  ON contract_notification_queue (scheduled_for, sent_at);
CREATE INDEX IF NOT EXISTS idx_contract_notif_queue_tenant_contract
  ON contract_notification_queue (tenant_id, contract_id);

ALTER TABLE contract_notification_queue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'contract_notification_queue'
      AND policyname = 'tenant_isolation_contract_notification_queue'
  ) THEN
    CREATE POLICY tenant_isolation_contract_notification_queue
      ON contract_notification_queue
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- F) timesheet_audit — append-only per-row diffs voor approvers/disputes
-- =========================================================================

CREATE TABLE IF NOT EXISTS timesheet_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  timesheet_id    UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
  actor_user_id   UUID,
  actor_role      TEXT,
  action          TEXT NOT NULL,
  diff            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_timesheet_audit_tenant_timesheet
  ON timesheet_audit (tenant_id, timesheet_id, created_at DESC);

ALTER TABLE timesheet_audit ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'timesheet_audit'
      AND policyname = 'tenant_isolation_timesheet_audit'
  ) THEN
    CREATE POLICY tenant_isolation_timesheet_audit ON timesheet_audit
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- G) timesheet_portal_tokens — public timesheet portal-token (no login)
-- =========================================================================
--
-- Aparte tabel i.p.v. extending het bestaande `guest_portal_links` (dat is
-- shortlist-specifiek met permissions/branding/notify-flows). Wij willen een
-- simpele kandidaat-side token: 1 contract, 1 candidate, expiry. Token wordt
-- als sha256-hash opgeslagen — alleen de raw URL-token kan auth doen, en
-- wordt nooit op de server bewaard.

CREATE TABLE IF NOT EXISTS timesheet_portal_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id   UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  candidate_id  UUID NOT NULL,
  token_hash    TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'timesheet_portal_tokens_hash_unique'
  ) THEN
    ALTER TABLE timesheet_portal_tokens
      ADD CONSTRAINT timesheet_portal_tokens_hash_unique
      UNIQUE (token_hash);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_timesheet_portal_tokens_tenant_contract
  ON timesheet_portal_tokens (tenant_id, contract_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_portal_tokens_expires
  ON timesheet_portal_tokens (expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE timesheet_portal_tokens ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'timesheet_portal_tokens'
      AND policyname = 'tenant_isolation_timesheet_portal_tokens'
  ) THEN
    CREATE POLICY tenant_isolation_timesheet_portal_tokens
      ON timesheet_portal_tokens
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
