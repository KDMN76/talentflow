-- 012_compliance_layer.sql
-- Sprint Q2.3 — Compliance platformlaag.
--
-- Voegt vier nieuwe stukken toe:
--   1. retention_policies         — per tenant: hoe lang we kandidaat-data
--                                    bewaren en wat er bij expiry gebeurt.
--   2. dsar_requests              — Data Subject Access Requests (AVG art. 12)
--                                    incl. due_at = +30 dagen na aanvraag.
--   3. candidate_self_tokens      — kortdurende tokens (7 dagen) waarmee een
--                                    kandidaat zelf inzage/correctie/verwijder
--                                    aanvragen kan doen zonder login.
--   4. candidates extra kolommen  — anonymized_at, last_activity_at,
--                                    retention_excluded(_reason).
--
-- Plus: trigger-functie `bump_candidate_activity()` zodat
-- last_activity_at automatisch wordt bijgewerkt door updates op candidates,
-- inserts op applications en inserts op communications. Hierdoor heeft de
-- retention-cron een betrouwbaar "laatste activiteit"-veld.
--
-- Volgt KDMN-conventie: alles idempotent (IF NOT EXISTS, DO $$ guards op
-- triggers/policies/constraints), snake_case, RLS via app.tenant_id setting.

-- =========================================================================
-- A) RETENTION POLICIES — per tenant retentie-instellingen
-- =========================================================================

CREATE TABLE IF NOT EXISTS retention_policies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type       TEXT NOT NULL,
  retention_months  INTEGER NOT NULL,
  trigger_field     TEXT NOT NULL DEFAULT 'last_activity_at',
  action_on_expiry  TEXT NOT NULL,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'retention_policies_entity_type_check'
  ) THEN
    ALTER TABLE retention_policies
      ADD CONSTRAINT retention_policies_entity_type_check
      CHECK (entity_type IN ('candidate', 'application'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'retention_policies_months_check'
  ) THEN
    ALTER TABLE retention_policies
      ADD CONSTRAINT retention_policies_months_check
      CHECK (retention_months BETWEEN 1 AND 120);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'retention_policies_trigger_field_check'
  ) THEN
    ALTER TABLE retention_policies
      ADD CONSTRAINT retention_policies_trigger_field_check
      CHECK (trigger_field IN ('last_activity_at', 'created_at', 'rejected_at'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'retention_policies_action_check'
  ) THEN
    ALTER TABLE retention_policies
      ADD CONSTRAINT retention_policies_action_check
      CHECK (action_on_expiry IN ('archive', 'anonymize', 'delete'));
  END IF;
END $$;

ALTER TABLE retention_policies ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'retention_policies' AND policyname = 'tenant_isolation_retention_policies'
  ) THEN
    CREATE POLICY tenant_isolation_retention_policies ON retention_policies
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Per tenant + entity_type max 1 ENABLED policy.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'uq_retention_policies_tenant_entity_enabled'
  ) THEN
    CREATE UNIQUE INDEX uq_retention_policies_tenant_entity_enabled
      ON retention_policies(tenant_id, entity_type)
      WHERE enabled = TRUE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_retention_policies_tenant
  ON retention_policies(tenant_id);

-- =========================================================================
-- B) DSAR REQUESTS — Data Subject Access Requests (AVG art. 12)
-- =========================================================================

CREATE TABLE IF NOT EXISTS dsar_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id    UUID REFERENCES candidates(id) ON DELETE SET NULL,
  request_type    TEXT NOT NULL,
  requested_via   TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  response_url    TEXT,
  fulfilled_at    TIMESTAMPTZ,
  fulfilled_by    UUID REFERENCES users(id),
  notes           TEXT,
  due_at          TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dsar_requests_request_type_check'
  ) THEN
    ALTER TABLE dsar_requests
      ADD CONSTRAINT dsar_requests_request_type_check
      CHECK (request_type IN ('access', 'export', 'correction', 'deletion'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dsar_requests_requested_via_check'
  ) THEN
    ALTER TABLE dsar_requests
      ADD CONSTRAINT dsar_requests_requested_via_check
      CHECK (requested_via IN ('self_portal', 'email', 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dsar_requests_status_check'
  ) THEN
    ALTER TABLE dsar_requests
      ADD CONSTRAINT dsar_requests_status_check
      CHECK (status IN ('pending', 'in_progress', 'fulfilled', 'rejected', 'expired'));
  END IF;
END $$;

ALTER TABLE dsar_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'dsar_requests' AND policyname = 'tenant_isolation_dsar_requests'
  ) THEN
    CREATE POLICY tenant_isolation_dsar_requests ON dsar_requests
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dsar_requests_tenant_status_due
  ON dsar_requests(tenant_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_dsar_requests_candidate
  ON dsar_requests(candidate_id);
CREATE INDEX IF NOT EXISTS idx_dsar_requests_tenant_created
  ON dsar_requests(tenant_id, created_at DESC);

-- =========================================================================
-- C) CANDIDATE SELF-SERVICE TOKENS
-- =========================================================================

CREATE TABLE IF NOT EXISTS candidate_self_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id  UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  token         TEXT UNIQUE NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE candidate_self_tokens ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'candidate_self_tokens' AND policyname = 'tenant_isolation_candidate_self_tokens'
  ) THEN
    CREATE POLICY tenant_isolation_candidate_self_tokens ON candidate_self_tokens
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_candidate_self_tokens_candidate
  ON candidate_self_tokens(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_self_tokens_expires
  ON candidate_self_tokens(expires_at);
-- token-lookup is een unique index van zichzelf via UNIQUE constraint.

-- =========================================================================
-- D) CANDIDATES — extra kolommen voor compliance
-- =========================================================================

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS retention_excluded BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS retention_excluded_reason TEXT;

-- Backfill: bestaande rows krijgen last_activity_at = greatest(updated_at, created_at).
UPDATE candidates
   SET last_activity_at = COALESCE(updated_at, created_at, now())
 WHERE last_activity_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_candidates_last_activity
  ON candidates(tenant_id, last_activity_at)
  WHERE deleted_at IS NULL AND retention_excluded = FALSE AND anonymized_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_candidates_anonymized_at
  ON candidates(tenant_id, anonymized_at)
  WHERE anonymized_at IS NOT NULL;

-- =========================================================================
-- E) TRIGGER — bump candidates.last_activity_at op activiteit
-- =========================================================================
--
-- Drie call-sites:
--   1. UPDATE op candidates              → bump self
--   2. INSERT op applications            → bump candidates(NEW.candidate_id)
--   3. INSERT op communications          → bump candidates(NEW.candidate_id)
--
-- We laten "bump self" in een aparte BEFORE UPDATE-trigger lopen zodat de
-- waarde in dezelfde row wordt geschreven; voor de andere twee gebruiken we
-- een AFTER INSERT-trigger met een UPDATE op de andere tabel.

CREATE OR REPLACE FUNCTION bump_candidate_activity_self() RETURNS TRIGGER AS $$
BEGIN
  -- Niet bumpen als de mutatie zelf last_activity_at, anonymized_at of
  -- deleted_at zet — anders zouden we in een trigger-loop / spurious
  -- writes terechtkomen tijdens GDPR-actions.
  IF NEW.anonymized_at IS DISTINCT FROM OLD.anonymized_at THEN
    RETURN NEW;
  END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RETURN NEW;
  END IF;
  IF NEW.last_activity_at IS DISTINCT FROM OLD.last_activity_at THEN
    -- Caller heeft expliciet gezet — respecteer de waarde.
    RETURN NEW;
  END IF;
  NEW.last_activity_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION bump_candidate_activity_via_app() RETURNS TRIGGER AS $$
BEGIN
  UPDATE candidates
     SET last_activity_at = now()
   WHERE id = NEW.candidate_id
     AND tenant_id = NEW.tenant_id
     AND anonymized_at IS NULL
     AND deleted_at IS NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'candidates_bump_activity_self') THEN
    CREATE TRIGGER candidates_bump_activity_self
      BEFORE UPDATE ON candidates
      FOR EACH ROW EXECUTE FUNCTION bump_candidate_activity_self();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'applications_bump_candidate_activity') THEN
    CREATE TRIGGER applications_bump_candidate_activity
      AFTER INSERT ON applications
      FOR EACH ROW EXECUTE FUNCTION bump_candidate_activity_via_app();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'communications_bump_candidate_activity') THEN
    -- communications-tabel kan in oudere envs nog niet bestaan (002_email).
    -- Defensief: alleen aanmaken als de tabel bestaat.
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'communications') THEN
      CREATE TRIGGER communications_bump_candidate_activity
        AFTER INSERT ON communications
        FOR EACH ROW EXECUTE FUNCTION bump_candidate_activity_via_app();
    END IF;
  END IF;
END $$;
