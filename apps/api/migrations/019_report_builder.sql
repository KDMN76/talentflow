-- 019_report_builder.sql
-- Sprint Q3.5 — Custom Report Builder (Agent EEE / backend).
--
-- Voegt twee tabellen toe voor de Report Builder:
--   1) reports       — opgeslagen rapport-configuraties per tenant
--   2) report_runs   — history-log van uitgevoerde rapport-runs (audit + 1h cache)
--
-- Conventies (consistent met 014/016/017/018):
--   - Idempotent (IF NOT EXISTS / DO $$ guards op constraints / RLS / indexen).
--   - RLS via current_setting('app.tenant_id', true)::uuid.
--   - snake_case kolommen, UUID PK met gen_random_uuid().
--
-- Embed-tokens worden in de service-laag gegenereerd (random 32-byte hex).
-- De public read-only embed flow gaat via withoutTenant + handmatige
-- tenant_id-set, met UNIQUE op embed_token zodat token-lookup O(log n) is.

-- =========================================================================
-- A) REPORTS — opgeslagen builder-configuraties
-- =========================================================================

CREATE TABLE IF NOT EXISTS reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  config          JSONB NOT NULL,
  template_key    TEXT,
  is_template     BOOLEAN NOT NULL DEFAULT FALSE,
  is_shared       BOOLEAN NOT NULL DEFAULT FALSE,
  embed_token     TEXT,
  embed_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  schedule        JSONB,
  last_run_at     TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reports_template_key_check'
  ) THEN
    ALTER TABLE reports
      ADD CONSTRAINT reports_template_key_check
      CHECK (
        template_key IS NULL
        OR template_key IN (
          'recruiter','manager','chro',
          'source_of_hire','dei_funnel','custom'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reports_embed_token_unique'
  ) THEN
    -- UNIQUE constraint via partial unique index zodat NULL embed_tokens
    -- onbeperkt mogen voorkomen — alleen actieve tokens moeten uniek zijn.
    CREATE UNIQUE INDEX reports_embed_token_unique
      ON reports(embed_token)
      WHERE embed_token IS NOT NULL;
  END IF;
END $$;

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'reports'
      AND policyname = 'tenant_isolation_reports'
  ) THEN
    CREATE POLICY tenant_isolation_reports ON reports
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reports_tenant_active
  ON reports(tenant_id, deleted_at);

CREATE INDEX IF NOT EXISTS idx_reports_tenant_template
  ON reports(tenant_id, template_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_reports_tenant_user
  ON reports(tenant_id, user_id)
  WHERE deleted_at IS NULL;

-- =========================================================================
-- B) REPORT_RUNS — execution-history + cache (TTL 1h gecontroleerd in service)
-- =========================================================================

CREATE TABLE IF NOT EXISTS report_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_id       UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  triggered_by    TEXT NOT NULL,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  parameters      JSONB,
  result_data     JSONB,
  result_size_kb  INTEGER,
  duration_ms     INTEGER,
  status          TEXT NOT NULL DEFAULT 'success',
  error           TEXT,
  ran_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'report_runs_status_check'
  ) THEN
    ALTER TABLE report_runs
      ADD CONSTRAINT report_runs_status_check
      CHECK (status IN ('success','failed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'report_runs_triggered_by_check'
  ) THEN
    ALTER TABLE report_runs
      ADD CONSTRAINT report_runs_triggered_by_check
      CHECK (triggered_by IN ('manual','scheduled','embed'));
  END IF;
END $$;

ALTER TABLE report_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'report_runs'
      AND policyname = 'tenant_isolation_report_runs'
  ) THEN
    CREATE POLICY tenant_isolation_report_runs ON report_runs
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_report_runs_tenant_report
  ON report_runs(tenant_id, report_id, ran_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_runs_recent_success
  ON report_runs(report_id, ran_at DESC)
  WHERE status = 'success';
