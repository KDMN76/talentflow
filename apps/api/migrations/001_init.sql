-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Tenants
CREATE TABLE IF NOT EXISTS tenants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE NOT NULL,
  plan       TEXT NOT NULL DEFAULT 'starter',
  settings   JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'recruiter',
  avatar_url    TEXT,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, email)
);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'tenant_isolation_users'
  ) THEN
    CREATE POLICY tenant_isolation_users ON users
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Refresh tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'refresh_tokens' AND policyname = 'tenant_isolation_refresh_tokens'
  ) THEN
    CREATE POLICY tenant_isolation_refresh_tokens ON refresh_tokens
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Candidates
CREATE TABLE IF NOT EXISTS candidates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  resume_url  TEXT,
  resume_text TEXT,
  skills      TEXT[] DEFAULT '{}',
  ai_score    INT,
  source      TEXT,
  tags        TEXT[] DEFAULT '{}',
  notes       TEXT,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'candidates' AND policyname = 'tenant_isolation_candidates'
  ) THEN
    CREATE POLICY tenant_isolation_candidates ON candidates
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_candidates_tenant ON candidates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates(tenant_id, email);

-- Jobs (vacatures)
CREATE TABLE IF NOT EXISTS jobs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  description          TEXT,
  department           TEXT,
  location             TEXT,
  salary_min           INT,
  salary_max           INT,
  employment_type      TEXT DEFAULT 'fulltime',
  status               TEXT NOT NULL DEFAULT 'draft',
  recruiter_id         UUID REFERENCES users(id),
  deleted_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'jobs' AND policyname = 'tenant_isolation_jobs'
  ) THEN
    CREATE POLICY tenant_isolation_jobs ON jobs
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_jobs_tenant ON jobs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(tenant_id, status);

-- Pipeline stages
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id    UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  position  INT NOT NULL,
  color     TEXT DEFAULT '#6366f1',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'pipeline_stages' AND policyname = 'tenant_isolation_pipeline_stages'
  ) THEN
    CREATE POLICY tenant_isolation_pipeline_stages ON pipeline_stages
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_job ON pipeline_stages(job_id);

-- Applications (candidate <-> job linking)
CREATE TABLE IF NOT EXISTS applications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id       UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  stage_id     UUID REFERENCES pipeline_stages(id),
  status       TEXT NOT NULL DEFAULT 'active',
  applied_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, job_id, candidate_id)
);
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'applications' AND policyname = 'tenant_isolation_applications'
  ) THEN
    CREATE POLICY tenant_isolation_applications ON applications
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id);
CREATE INDEX IF NOT EXISTS idx_applications_candidate ON applications(candidate_id);
CREATE INDEX IF NOT EXISTS idx_applications_stage ON applications(stage_id);

-- Activities log
CREATE TABLE IF NOT EXISTS activities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  user_id     UUID REFERENCES users(id),
  action      TEXT NOT NULL,
  payload     JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'activities' AND policyname = 'tenant_isolation_activities'
  ) THEN
    CREATE POLICY tenant_isolation_activities ON activities
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_activities_entity ON activities(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activities_tenant ON activities(tenant_id);
