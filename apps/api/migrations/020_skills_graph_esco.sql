-- 020_skills_graph_esco.sql
-- Sprint Q3.6 — Skills Graph + ESCO (Agent HHH / backend).
--
-- Voegt vier tabellen toe voor de Skills-Graph laag:
--   1) esco_skills                — system-wide ESCO-taxonomie (geen tenant_id)
--   2) candidate_skill_mappings   — per kandidaat: gemapte ESCO-codes
--   3) job_skill_mappings         — per vacature:  gemapte ESCO-codes
--   4) skills_trending_snapshots  — wekelijkse snapshot voor demand/supply trends
--
-- Conventies (consistent met 014/016/017/018/019):
--   - Idempotent (IF NOT EXISTS / DO $$ guards op constraints / RLS / indexen).
--   - RLS via current_setting('app.tenant_id', true)::uuid voor tenant-tabellen.
--   - esco_skills is system-wide (geen RLS — read-only voor alle tenants).
--   - snake_case kolommen, UUID PK met gen_random_uuid().
--   - vector(1536) kolom op esco_skills voor fuzzy-matching naar embedding-space
--     (zelfde dim als candidates/jobs uit migratie 006).

-- =========================================================================
-- 0) PGVECTOR EXTENSION — al gegarandeerd door 006, maar defensief
-- =========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    -- Niet hard falen: de eerdere migratie 006 heeft dit al gedaan; wel een
    -- duidelijke foutmelding als iemand 020 standalone draait op een DB
    -- waar 006 nog niet draaide.
    RAISE EXCEPTION
      'pgvector extension is niet geïnstalleerd. Migratie 006 moet eerst draaien.';
  END IF;
END $$;

-- =========================================================================
-- A) ESCO_SKILLS — system-wide taxonomie
-- =========================================================================
-- ESCO = European Skills/Competences/Qualifications/Occupations classification.
-- Wij houden een lichtgewicht subset van ~300 skills voor MVP. De `id`-kolom
-- is een ESCO URI of korte code (bv 'KS123ABC' / 'http://data.europa.eu/esco/skill/...').
-- parent_id = optionele hierarchische link (bv 'JavaScript' parent='Web programming').

CREATE TABLE IF NOT EXISTS esco_skills (
  id              TEXT PRIMARY KEY,
  preferred_label TEXT NOT NULL,
  alt_labels      TEXT[] NOT NULL DEFAULT '{}',
  description     TEXT,
  skill_type      TEXT,
  category        TEXT,
  parent_id       TEXT REFERENCES esco_skills(id) ON DELETE SET NULL,
  embedding       vector(1536),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'esco_skills_skill_type_check'
  ) THEN
    ALTER TABLE esco_skills
      ADD CONSTRAINT esco_skills_skill_type_check
      CHECK (
        skill_type IS NULL
        OR skill_type IN ('skill','knowledge','language','transversal')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_esco_skills_preferred_label
  ON esco_skills(preferred_label);
CREATE INDEX IF NOT EXISTS idx_esco_skills_preferred_label_lower
  ON esco_skills(lower(preferred_label));
CREATE INDEX IF NOT EXISTS idx_esco_skills_category
  ON esco_skills(category);
CREATE INDEX IF NOT EXISTS idx_esco_skills_skill_type
  ON esco_skills(skill_type);
CREATE INDEX IF NOT EXISTS idx_esco_skills_alt_labels_gin
  ON esco_skills USING GIN (alt_labels);

-- HNSW-index voor fuzzy embedding-matching. Net als migratie 006: alleen
-- aanmaken als hij nog niet bestaat.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname  = 'idx_esco_skills_embedding_hnsw'
  ) THEN
    CREATE INDEX idx_esco_skills_embedding_hnsw
      ON esco_skills USING hnsw (embedding vector_cosine_ops);
  END IF;
END $$;

-- esco_skills heeft GEEN RLS — taxonomie is system-wide, alle tenants lezen
-- dezelfde data. Schrijfacties gebeuren alleen via import-script (admin).

-- =========================================================================
-- B) CANDIDATE_SKILL_MAPPINGS — kandidaat-skill → ESCO
-- =========================================================================

CREATE TABLE IF NOT EXISTS candidate_skill_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  candidate_id      UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  esco_skill_id     TEXT NOT NULL REFERENCES esco_skills(id) ON DELETE CASCADE,
  source_skill_text TEXT NOT NULL,
  confidence        NUMERIC(5,4) NOT NULL,
  proficiency       INTEGER,
  matched_via       TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'candidate_skill_mappings_confidence_range_check'
  ) THEN
    ALTER TABLE candidate_skill_mappings
      ADD CONSTRAINT candidate_skill_mappings_confidence_range_check
      CHECK (confidence >= 0 AND confidence <= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'candidate_skill_mappings_proficiency_range_check'
  ) THEN
    ALTER TABLE candidate_skill_mappings
      ADD CONSTRAINT candidate_skill_mappings_proficiency_range_check
      CHECK (proficiency IS NULL OR (proficiency BETWEEN 1 AND 10));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'candidate_skill_mappings_matched_via_check'
  ) THEN
    ALTER TABLE candidate_skill_mappings
      ADD CONSTRAINT candidate_skill_mappings_matched_via_check
      CHECK (matched_via IN ('exact','alt_label','embedding','manual'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_skill_mappings_tenant_candidate_esco
  ON candidate_skill_mappings(tenant_id, candidate_id, esco_skill_id);

CREATE INDEX IF NOT EXISTS idx_candidate_skill_mappings_tenant
  ON candidate_skill_mappings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_candidate_skill_mappings_candidate
  ON candidate_skill_mappings(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_skill_mappings_esco
  ON candidate_skill_mappings(esco_skill_id);
CREATE INDEX IF NOT EXISTS idx_candidate_skill_mappings_tenant_esco
  ON candidate_skill_mappings(tenant_id, esco_skill_id);

ALTER TABLE candidate_skill_mappings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'candidate_skill_mappings'
      AND policyname = 'tenant_isolation_candidate_skill_mappings'
  ) THEN
    CREATE POLICY tenant_isolation_candidate_skill_mappings
      ON candidate_skill_mappings
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- C) JOB_SKILL_MAPPINGS — vacature-skill → ESCO
-- =========================================================================

CREATE TABLE IF NOT EXISTS job_skill_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id            UUID NOT NULL REFERENCES jobs(id)    ON DELETE CASCADE,
  esco_skill_id     TEXT NOT NULL REFERENCES esco_skills(id) ON DELETE CASCADE,
  source_skill_text TEXT NOT NULL,
  confidence        NUMERIC(5,4) NOT NULL,
  required          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_skill_mappings_confidence_range_check'
  ) THEN
    ALTER TABLE job_skill_mappings
      ADD CONSTRAINT job_skill_mappings_confidence_range_check
      CHECK (confidence >= 0 AND confidence <= 1);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_skill_mappings_tenant_job_esco
  ON job_skill_mappings(tenant_id, job_id, esco_skill_id);

CREATE INDEX IF NOT EXISTS idx_job_skill_mappings_tenant
  ON job_skill_mappings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_job_skill_mappings_job
  ON job_skill_mappings(job_id);
CREATE INDEX IF NOT EXISTS idx_job_skill_mappings_esco
  ON job_skill_mappings(esco_skill_id);
CREATE INDEX IF NOT EXISTS idx_job_skill_mappings_tenant_esco_required
  ON job_skill_mappings(tenant_id, esco_skill_id, required);

ALTER TABLE job_skill_mappings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'job_skill_mappings'
      AND policyname = 'tenant_isolation_job_skill_mappings'
  ) THEN
    CREATE POLICY tenant_isolation_job_skill_mappings
      ON job_skill_mappings
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- D) SKILLS_TRENDING_SNAPSHOTS — wekelijkse demand/supply snapshot
-- =========================================================================
-- Eén rij per (tenant, esco_skill, week_starting). week_starting = ISO maandag.
-- De `skillsSnapshot.worker` schrijft elke maandag 01:00 een nieuwe rij voor
-- elk skill dat in de tenant relevant is. Trending-service vergelijkt
-- weken om growth_pct te berekenen.

CREATE TABLE IF NOT EXISTS skills_trending_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  esco_skill_id   TEXT NOT NULL REFERENCES esco_skills(id) ON DELETE CASCADE,
  week_starting   DATE NOT NULL,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  job_demand      INTEGER NOT NULL DEFAULT 0,
  hire_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'skills_trending_snapshots_counts_nonneg_check'
  ) THEN
    ALTER TABLE skills_trending_snapshots
      ADD CONSTRAINT skills_trending_snapshots_counts_nonneg_check
      CHECK (
        candidate_count >= 0
        AND job_demand   >= 0
        AND hire_count   >= 0
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_skills_trending_snapshots_tenant_esco_week
  ON skills_trending_snapshots(tenant_id, esco_skill_id, week_starting);

CREATE INDEX IF NOT EXISTS idx_skills_trending_snapshots_tenant_week
  ON skills_trending_snapshots(tenant_id, week_starting DESC);
CREATE INDEX IF NOT EXISTS idx_skills_trending_snapshots_esco
  ON skills_trending_snapshots(esco_skill_id);

ALTER TABLE skills_trending_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'skills_trending_snapshots'
      AND policyname = 'tenant_isolation_skills_trending_snapshots'
  ) THEN
    CREATE POLICY tenant_isolation_skills_trending_snapshots
      ON skills_trending_snapshots
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
