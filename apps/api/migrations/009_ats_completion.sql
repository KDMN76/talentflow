-- 009_ats_completion.sql
-- Sprint Q1.2 — ATS-completering.
--
-- Voegt zes tabellen toe voor de ontbrekende ATS-functies:
--   1) saved_searches             — opgeslagen Boolean searches per user
--   2) job_templates              — herbruikbare job-blueprints
--   3) custom_field_definitions   — per tenant/entity custom velden
--   4) custom_field_values        — generic values store (EAV)
--   5) scorecards                 — per applicatie+stage+interviewer
--   6) scorecard_templates        — per tenant/job: te scoren criteria
--   7) csv_imports                — async bulk-import jobs (status/errors)
--
-- Alle tabellen zijn idempotent (CREATE TABLE IF NOT EXISTS / DO-block guards).
-- Alle tabellen gebruiken RLS via `app.tenant_id` setting (zie 001_init.sql).
-- Job_templates kunnen system-wide zijn (tenant_id IS NULL).

-- =========================================================================
-- 1) SAVED_SEARCHES
-- =========================================================================

CREATE TABLE IF NOT EXISTS saved_searches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  query_text   TEXT NOT NULL,                    -- raw boolean string
  filters      JSONB NOT NULL DEFAULT '{}'::jsonb,
  entity_type  TEXT NOT NULL,                    -- 'candidates' | 'jobs'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'saved_searches_entity_type_check'
  ) THEN
    ALTER TABLE saved_searches
      ADD CONSTRAINT saved_searches_entity_type_check
      CHECK (entity_type IN ('candidates', 'jobs'));
  END IF;
END $$;

ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'saved_searches' AND policyname = 'tenant_isolation_saved_searches'
  ) THEN
    CREATE POLICY tenant_isolation_saved_searches ON saved_searches
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_saved_searches_tenant_user_entity
  ON saved_searches(tenant_id, user_id, entity_type);

-- =========================================================================
-- 2) JOB_TEMPLATES
-- =========================================================================
--
-- tenant_id mag NULL voor system-templates (door TalentFlow geleverd).
-- Een DO-block CHECK forceert dat created_by NULL is wanneer is_system=true.

CREATE TABLE IF NOT EXISTS job_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  job_data     JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_system    BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_templates_system_tenant_check'
  ) THEN
    ALTER TABLE job_templates
      ADD CONSTRAINT job_templates_system_tenant_check
      CHECK (
        (is_system = TRUE  AND tenant_id IS NULL) OR
        (is_system = FALSE AND tenant_id IS NOT NULL)
      );
  END IF;
END $$;

ALTER TABLE job_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'job_templates' AND policyname = 'tenant_isolation_job_templates'
  ) THEN
    CREATE POLICY tenant_isolation_job_templates ON job_templates
      USING (
        tenant_id IS NULL                                                  -- system templates: zichtbaar voor iedereen
        OR tenant_id = current_setting('app.tenant_id', true)::uuid
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_job_templates_tenant
  ON job_templates(tenant_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_job_templates_system
  ON job_templates(is_system) WHERE deleted_at IS NULL;

-- =========================================================================
-- 3) CUSTOM_FIELD_DEFINITIONS
-- =========================================================================

CREATE TABLE IF NOT EXISTS custom_field_definitions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type  TEXT NOT NULL,                    -- 'candidate'|'job'|'application'
  key          TEXT NOT NULL,                    -- snake_case identifier
  label        TEXT NOT NULL,
  field_type   TEXT NOT NULL,                    -- text|number|date|dropdown|multiselect|boolean
  options      JSONB NOT NULL DEFAULT '[]'::jsonb,  -- voor dropdown/multiselect
  required     BOOLEAN NOT NULL DEFAULT FALSE,
  position     INT NOT NULL DEFAULT 0,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'custom_field_definitions_entity_type_check'
  ) THEN
    ALTER TABLE custom_field_definitions
      ADD CONSTRAINT custom_field_definitions_entity_type_check
      CHECK (entity_type IN ('candidate', 'job', 'application'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'custom_field_definitions_field_type_check'
  ) THEN
    ALTER TABLE custom_field_definitions
      ADD CONSTRAINT custom_field_definitions_field_type_check
      CHECK (field_type IN ('text', 'number', 'date', 'dropdown', 'multiselect', 'boolean'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'custom_field_definitions_key_check'
  ) THEN
    ALTER TABLE custom_field_definitions
      ADD CONSTRAINT custom_field_definitions_key_check
      CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$');
  END IF;
END $$;

ALTER TABLE custom_field_definitions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'custom_field_definitions' AND policyname = 'tenant_isolation_cfd'
  ) THEN
    CREATE POLICY tenant_isolation_cfd ON custom_field_definitions
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Unieke key per tenant+entity, maar alleen voor levende rijen — soft-deleted
-- definities mogen blijven bestaan en hergebruik moet kunnen.
CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_field_definitions_tenant_entity_key
  ON custom_field_definitions(tenant_id, entity_type, key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_custom_field_definitions_tenant_entity_position
  ON custom_field_definitions(tenant_id, entity_type, position)
  WHERE deleted_at IS NULL;

-- =========================================================================
-- 4) CUSTOM_FIELD_VALUES
-- =========================================================================

CREATE TABLE IF NOT EXISTS custom_field_values (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  definition_id UUID NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL,
  entity_id     UUID NOT NULL,
  value         JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE custom_field_values ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'custom_field_values' AND policyname = 'tenant_isolation_cfv'
  ) THEN
    CREATE POLICY tenant_isolation_cfv ON custom_field_values
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_field_values_definition_entity
  ON custom_field_values(definition_id, entity_id);

CREATE INDEX IF NOT EXISTS idx_custom_field_values_tenant_entity
  ON custom_field_values(tenant_id, entity_type, entity_id);

-- =========================================================================
-- 5) SCORECARDS
-- =========================================================================

CREATE TABLE IF NOT EXISTS scorecards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  application_id  UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  stage_id        UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  interviewer_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  overall_score   NUMERIC(2,1),                  -- 1.0 - 5.0
  recommendation  TEXT,                          -- strong_yes|yes|neutral|no|strong_no
  notes           TEXT,
  criteria_scores JSONB NOT NULL DEFAULT '[]'::jsonb,
  submitted_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scorecards_recommendation_check'
  ) THEN
    ALTER TABLE scorecards
      ADD CONSTRAINT scorecards_recommendation_check
      CHECK (recommendation IS NULL OR recommendation IN ('strong_yes', 'yes', 'neutral', 'no', 'strong_no'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scorecards_overall_score_check'
  ) THEN
    ALTER TABLE scorecards
      ADD CONSTRAINT scorecards_overall_score_check
      CHECK (overall_score IS NULL OR (overall_score >= 1.0 AND overall_score <= 5.0));
  END IF;
END $$;

ALTER TABLE scorecards ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'scorecards' AND policyname = 'tenant_isolation_scorecards'
  ) THEN
    CREATE POLICY tenant_isolation_scorecards ON scorecards
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_scorecards_application_stage
  ON scorecards(application_id, stage_id);

-- 1 scorecard per interviewer per (applicatie, stage). NULL stage_id wordt
-- door PostgreSQL als distinct behandeld in een UNIQUE-index — dat is precies
-- wat we willen (een algemene scorecard zonder stage mag separaat).
CREATE UNIQUE INDEX IF NOT EXISTS uq_scorecards_app_stage_interviewer
  ON scorecards(application_id, stage_id, interviewer_id);

-- =========================================================================
-- 6) SCORECARD_TEMPLATES
-- =========================================================================

CREATE TABLE IF NOT EXISTS scorecard_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  criteria            JSONB NOT NULL DEFAULT '[]'::jsonb,
  applies_to_job_id   UUID REFERENCES jobs(id) ON DELETE CASCADE,
  applies_to_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  is_default          BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE scorecard_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'scorecard_templates' AND policyname = 'tenant_isolation_scorecard_templates'
  ) THEN
    CREATE POLICY tenant_isolation_scorecard_templates ON scorecard_templates
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_scorecard_templates_tenant_job
  ON scorecard_templates(tenant_id, applies_to_job_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_scorecard_templates_tenant_default
  ON scorecard_templates(tenant_id, is_default) WHERE deleted_at IS NULL;

-- =========================================================================
-- 7) CSV_IMPORTS
-- =========================================================================
--
-- Async bulk-import lifecycle. Worker leest `pending`, zet door naar
-- `parsing` → `importing` → `done`/`failed`. errors bevat per-row failures.

CREATE TABLE IF NOT EXISTS csv_imports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL,
  filename        TEXT NOT NULL,
  total_rows      INT NOT NULL DEFAULT 0,
  processed_rows  INT NOT NULL DEFAULT 0,
  imported_count  INT NOT NULL DEFAULT 0,
  skipped_count   INT NOT NULL DEFAULT 0,
  error_count     INT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending',
  errors          JSONB NOT NULL DEFAULT '[]'::jsonb,
  mapping         JSONB NOT NULL DEFAULT '{}'::jsonb,
  storage_key     TEXT,                          -- waar de CSV-bytes staan
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'csv_imports_status_check'
  ) THEN
    ALTER TABLE csv_imports
      ADD CONSTRAINT csv_imports_status_check
      CHECK (status IN ('pending', 'parsing', 'importing', 'done', 'failed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'csv_imports_entity_type_check'
  ) THEN
    ALTER TABLE csv_imports
      ADD CONSTRAINT csv_imports_entity_type_check
      CHECK (entity_type IN ('candidate', 'job'));
  END IF;
END $$;

ALTER TABLE csv_imports ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'csv_imports' AND policyname = 'tenant_isolation_csv_imports'
  ) THEN
    CREATE POLICY tenant_isolation_csv_imports ON csv_imports
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_csv_imports_tenant_status_created
  ON csv_imports(tenant_id, status, created_at DESC);
