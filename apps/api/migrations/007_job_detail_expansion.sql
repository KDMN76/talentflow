-- 007_job_detail_expansion.sql
-- Slice 4.5 — Manatal-pariteit + uitgebreid job-detail.
-- Volgt KDMN-conventie: idempotent (IF NOT EXISTS / DO $$ guards), snake_case,
-- UUID PKs, RLS-stijl uit 001_init.sql.
--
-- Bestaat uit:
--   A) Uitbreiding van `jobs` met Manatal-pariteitsvelden
--   B) Nieuwe tabellen:
--      - job_team_members      (multi-recruiter/HM per job)
--      - job_notes             (collaboration thread + @mentions)
--      - job_attachments       (job-bound files via storage abstractie)
--      - job_health_snapshots  (cache van computed health-scores)
--      - job_bias_checks       (cache van JD bias-/clarity-analyse)

-- =========================================================================
-- A) JOBS — Manatal-pariteit kolommen
-- =========================================================================

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_reference        TEXT;       -- alphanumeric ID, bv. 'JOB-9344Y'
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS headcount            INTEGER DEFAULT 1;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS experience_level     TEXT;       -- 'junior'|'medior'|'senior'|'lead'
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS contract_type        TEXT;       -- 'fulltime'|'parttime'|'contract'|'temp'
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS contract_details     TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS open_date            DATE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS close_date           DATE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS industry             TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS remote_type          TEXT;       -- 'onsite'|'hybrid'|'remote'
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS office_address       TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS package_details      TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS currency             TEXT DEFAULT 'EUR';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_frequency     TEXT DEFAULT 'monthly';  -- 'monthly'|'annual'|'hourly'
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS required_skills      TEXT[] DEFAULT '{}';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS nice_to_have_skills  TEXT[] DEFAULT '{}';

-- ─── CHECK constraints (idempotent) ────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_experience_level_check'
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_experience_level_check
      CHECK (experience_level IS NULL OR experience_level IN ('junior','medior','senior','lead'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_contract_type_check'
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_contract_type_check
      CHECK (contract_type IS NULL OR contract_type IN ('fulltime','parttime','contract','temp'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_remote_type_check'
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_remote_type_check
      CHECK (remote_type IS NULL OR remote_type IN ('onsite','hybrid','remote'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_salary_frequency_check'
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_salary_frequency_check
      CHECK (salary_frequency IS NULL OR salary_frequency IN ('monthly','annual','hourly'));
  END IF;
END $$;

-- ─── Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_jobs_tenant_status_active
  ON jobs(tenant_id, status, deleted_at);

CREATE INDEX IF NOT EXISTS idx_jobs_tenant_recruiter
  ON jobs(tenant_id, recruiter_id);

-- UNIQUE op job_reference (per tenant scope niet vereist — global uniek
-- houdt het simpeler en is in lijn met candidate_reference). Alleen waar
-- niet-soft-deleted; meerdere NULLs zijn toegestaan in PostgreSQL.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_jobs_job_reference'
  ) THEN
    CREATE UNIQUE INDEX uq_jobs_job_reference
      ON jobs(job_reference)
      WHERE job_reference IS NOT NULL AND deleted_at IS NULL;
  END IF;
END $$;

-- =========================================================================
-- B1) JOB_TEAM_MEMBERS — multi-recruiter / hiring-manager / observer per job
-- =========================================================================

CREATE TABLE IF NOT EXISTS job_team_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'recruiter',  -- 'recruiter'|'hiring_manager'|'observer'
  added_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (job_id, user_id)
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_team_members_role_check'
  ) THEN
    ALTER TABLE job_team_members
      ADD CONSTRAINT job_team_members_role_check
      CHECK (role IN ('recruiter','hiring_manager','observer'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_job_team_members_tenant_job
  ON job_team_members(tenant_id, job_id);
CREATE INDEX IF NOT EXISTS idx_job_team_members_user
  ON job_team_members(user_id);

ALTER TABLE job_team_members ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'job_team_members'
      AND policyname = 'tenant_isolation_job_team_members'
  ) THEN
    CREATE POLICY tenant_isolation_job_team_members ON job_team_members
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- B2) JOB_NOTES — collaboration thread + @mentions
-- =========================================================================

CREATE TABLE IF NOT EXISTS job_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  mentions    UUID[] DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_notes_tenant_job_created
  ON job_notes(tenant_id, job_id, created_at DESC);

ALTER TABLE job_notes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'job_notes'
      AND policyname = 'tenant_isolation_job_notes'
  ) THEN
    CREATE POLICY tenant_isolation_job_notes ON job_notes
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- B3) JOB_ATTACHMENTS — bestanden gekoppeld aan een job (storage-key)
-- =========================================================================

CREATE TABLE IF NOT EXISTS job_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id       UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  uploaded_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  filename     TEXT NOT NULL,
  storage_key  TEXT NOT NULL,
  mime_type    TEXT,
  size_bytes   BIGINT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_attachments_tenant_job
  ON job_attachments(tenant_id, job_id);

ALTER TABLE job_attachments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'job_attachments'
      AND policyname = 'tenant_isolation_job_attachments'
  ) THEN
    CREATE POLICY tenant_isolation_job_attachments ON job_attachments
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- B4) JOB_HEALTH_SNAPSHOTS — cache van computed health-scores
-- =========================================================================
-- Niet UNIQUE op (tenant_id, job_id): we schrijven nieuwe rij per recompute
-- en lezen `ORDER BY computed_at DESC LIMIT 1`. TTL-logica zit in service.

CREATE TABLE IF NOT EXISTS job_health_snapshots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id                UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  health_score          INTEGER NOT NULL,         -- 0-100
  days_open             INTEGER,
  candidates_total      INTEGER,
  candidates_in_funnel  INTEGER,
  velocity_score        INTEGER,                  -- 0-100
  drop_off_score        INTEGER,                  -- 0-100, hoger = minder drop-off
  recency_score         INTEGER,                  -- 0-100
  predicted_close_date  DATE,
  computed_at           TIMESTAMPTZ DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_health_snapshots_score_range_check'
  ) THEN
    ALTER TABLE job_health_snapshots
      ADD CONSTRAINT job_health_snapshots_score_range_check
      CHECK (health_score BETWEEN 0 AND 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_job_health_snapshots_tenant_job_recent
  ON job_health_snapshots(tenant_id, job_id, computed_at DESC);

ALTER TABLE job_health_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'job_health_snapshots'
      AND policyname = 'tenant_isolation_job_health_snapshots'
  ) THEN
    CREATE POLICY tenant_isolation_job_health_snapshots ON job_health_snapshots
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- B5) JOB_BIAS_CHECKS — cache van JD bias-/clarity-/inclusivity-analyse
-- =========================================================================
-- jd_hash = SHA-256 over { title || description || required_skills sorted }.
-- Bij identieke hash wordt de laatste row hergebruikt; anders nieuwe row.

CREATE TABLE IF NOT EXISTS job_bias_checks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id             UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  jd_hash            TEXT NOT NULL,
  bias_flags         JSONB DEFAULT '[]',
  clarity_score      INTEGER,
  inclusivity_score  INTEGER,
  computed_at        TIMESTAMPTZ DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_bias_checks_clarity_range_check'
  ) THEN
    ALTER TABLE job_bias_checks
      ADD CONSTRAINT job_bias_checks_clarity_range_check
      CHECK (clarity_score IS NULL OR (clarity_score BETWEEN 0 AND 100));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_bias_checks_inclusivity_range_check'
  ) THEN
    ALTER TABLE job_bias_checks
      ADD CONSTRAINT job_bias_checks_inclusivity_range_check
      CHECK (inclusivity_score IS NULL OR (inclusivity_score BETWEEN 0 AND 100));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_job_bias_checks_tenant_job_recent
  ON job_bias_checks(tenant_id, job_id, computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_bias_checks_tenant_job_hash
  ON job_bias_checks(tenant_id, job_id, jd_hash);

ALTER TABLE job_bias_checks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'job_bias_checks'
      AND policyname = 'tenant_isolation_job_bias_checks'
  ) THEN
    CREATE POLICY tenant_isolation_job_bias_checks ON job_bias_checks
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
