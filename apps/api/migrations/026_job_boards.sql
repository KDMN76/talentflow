-- 026_job_boards.sql
-- Sprint Q4.3 — Echte job-board integraties (Agent QQQ + RRR).
--
-- Vervangt de eerste-versie `job_board_postings`-shape (status enum
-- pending|published|failed|expired|removed) met de nieuwe contract-shape
-- waarin we per-tenant board-credentials, posting-events en cost-per-hire
-- bijhouden. Tabellen die hieronder staan zijn ALLEMAAL nieuw — de oude
-- `job_board_postings` blijft staan voor historische data maar wordt niet
-- meer geschreven door de nieuwe service.
--
-- Idempotent. KDMN-conventies: IF NOT EXISTS, DO $$ guards, RLS via
-- app.tenant_id setting, snake_case, `created_at` op alle tabellen.

-- =========================================================================
-- A) job_board_integrations — per-tenant board-credentials + sync-state
-- =========================================================================
--
-- Eén rij per (tenant, board). `credentials_encrypted` is AES-256-GCM-cipher
-- (zie src/lib/encryption.ts). `settings` JSONB voor non-secret config zoals
-- organisation_urn, sponsored_cpc, default_currency, etc.

CREATE TABLE IF NOT EXISTS job_board_integrations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  board_id               TEXT NOT NULL,
  display_name           TEXT,
  status                 TEXT NOT NULL DEFAULT 'connected',
  credentials_encrypted  BYTEA,
  settings               JSONB NOT NULL DEFAULT '{}'::jsonb,
  connected_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  connected_at           TIMESTAMPTZ,
  last_polled_at         TIMESTAMPTZ,
  last_error             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_board_integrations_status_check'
  ) THEN
    ALTER TABLE job_board_integrations
      ADD CONSTRAINT job_board_integrations_status_check
      CHECK (status IN ('connected','disconnected','error'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_board_integrations_tenant_board_unique'
  ) THEN
    ALTER TABLE job_board_integrations
      ADD CONSTRAINT job_board_integrations_tenant_board_unique
      UNIQUE (tenant_id, board_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_job_board_integrations_tenant_status
  ON job_board_integrations (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_job_board_integrations_tenant_board
  ON job_board_integrations (tenant_id, board_id);

ALTER TABLE job_board_integrations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'job_board_integrations'
      AND policyname = 'tenant_isolation_job_board_integrations'
  ) THEN
    CREATE POLICY tenant_isolation_job_board_integrations ON job_board_integrations
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- B) job_postings — één rij per (job, board) externe plaatsing
-- =========================================================================
--
-- LET OP: andere tabel dan de legacy `job_board_postings` (zonder onderscore).
-- De nieuwe naam matcht de service.ts naming.

CREATE TABLE IF NOT EXISTS job_postings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id            UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  board_id          TEXT NOT NULL,
  integration_id    UUID REFERENCES job_board_integrations(id) ON DELETE SET NULL,
  external_id       TEXT,
  external_url      TEXT,
  status            TEXT NOT NULL DEFAULT 'queued',
  posted_at         TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  retracted_at      TIMESTAMPTZ,
  cost_amount       NUMERIC(10,2),
  cost_currency     TEXT NOT NULL DEFAULT 'EUR',
  applicants_count  INTEGER NOT NULL DEFAULT 0,
  last_polled_at    TIMESTAMPTZ,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message     TEXT,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_postings_status_check'
  ) THEN
    ALTER TABLE job_postings
      ADD CONSTRAINT job_postings_status_check
      CHECK (status IN ('queued','posted','rejected','expired','retracted','failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_job_postings_tenant_status
  ON job_postings (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_job_postings_tenant_job
  ON job_postings (tenant_id, job_id);
CREATE INDEX IF NOT EXISTS idx_job_postings_tenant_board
  ON job_postings (tenant_id, board_id);

ALTER TABLE job_postings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'job_postings' AND policyname = 'tenant_isolation_job_postings'
  ) THEN
    CREATE POLICY tenant_isolation_job_postings ON job_postings
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- C) job_posting_status_events — append-only audit per posting-event
-- =========================================================================

CREATE TABLE IF NOT EXISTS job_posting_status_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  posting_id  UUID NOT NULL REFERENCES job_postings(id) ON DELETE CASCADE,
  event       TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_posting_status_events_tenant_posting
  ON job_posting_status_events (tenant_id, posting_id, created_at DESC);

ALTER TABLE job_posting_status_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'job_posting_status_events'
      AND policyname = 'tenant_isolation_job_posting_status_events'
  ) THEN
    CREATE POLICY tenant_isolation_job_posting_status_events ON job_posting_status_events
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- D) cost_per_hire_records — toegerekende kosten per hire
-- =========================================================================

CREATE TABLE IF NOT EXISTS cost_per_hire_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id            UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  application_id    UUID,
  posting_id        UUID REFERENCES job_postings(id) ON DELETE SET NULL,
  source_board_id   TEXT,
  attributed_cost   NUMERIC(10,2),
  currency          TEXT NOT NULL DEFAULT 'EUR',
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_per_hire_tenant_job
  ON cost_per_hire_records (tenant_id, job_id);

ALTER TABLE cost_per_hire_records ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cost_per_hire_records'
      AND policyname = 'tenant_isolation_cost_per_hire_records'
  ) THEN
    CREATE POLICY tenant_isolation_cost_per_hire_records ON cost_per_hire_records
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
