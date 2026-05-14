-- 002_manatal_parity.sql
-- Uitbreiding van het candidates-schema voor pariteit met Manatal.
-- Volgt KDMN-conventie: idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING),
-- snake_case, UUID PKs, RLS-stijl uit 001_init.sql.

-- =========================================================================
-- 1) CANDIDATES — uitbreiding met Manatal-pariteitsvelden
-- =========================================================================

-- Identifier alfanumeriek (door applicatielaag gegenereerd, bijv. 'Y5694WY99')
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS candidate_reference TEXT;

-- Unieke index op candidate_reference (NULL toegestaan voor bestaande rows;
-- meerdere NULLs zijn toegestaan in een UNIQUE INDEX in PostgreSQL).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_candidates_candidate_reference'
  ) THEN
    CREATE UNIQUE INDEX uq_candidates_candidate_reference
      ON candidates(candidate_reference)
      WHERE candidate_reference IS NOT NULL;
  END IF;
END $$;

-- Naam-uitsplitsing (bestaande 'name' blijft voor backwards compat)
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS last_name  TEXT;

-- Demografisch
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS gender        TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS birthdate     DATE;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS nationalities TEXT[];
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS languages     TEXT[];

-- CHECK constraint voor gender (enum-achtig). Idempotent toegevoegd.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'candidates_gender_check'
  ) THEN
    ALTER TABLE candidates
      ADD CONSTRAINT candidates_gender_check
      CHECK (gender IS NULL OR gender IN ('male', 'female', 'other', 'prefer_not'));
  END IF;
END $$;

-- Werkdetails
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS notice_period             TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS current_salary            NUMERIC(10,2);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS current_salary_currency   TEXT DEFAULT 'EUR';
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS expected_salary           NUMERIC(10,2);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS expected_salary_currency  TEXT DEFAULT 'EUR';
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS current_benefits          TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS expected_benefits         TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS years_of_experience       INTEGER;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS graduation_date           DATE;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS current_department        TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS industry                  TEXT;

-- Opleiding
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS diploma    TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS university TEXT;

-- Adres
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS address_line1       TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS address_line2       TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS address_city        TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS address_country     TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS address_postal_code TEXT;

-- Contact
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS skype         TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS other_contact TEXT;

-- Vrije tekst (cover letter / beschrijving)
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS description TEXT;

-- Source: 001_init.sql heeft 'source TEXT' al staan, dus geen ADD nodig.
-- We documenteren hier de toegestane waarden in een comment:
COMMENT ON COLUMN candidates.source IS
  'Herkomstkanaal: career_page | linkedin | manual_import | csv_import | referral | overig';

-- GDPR / consent tracking
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS gdpr_consent     BOOLEAN DEFAULT FALSE;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS gdpr_consent_at  TIMESTAMPTZ;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS email_consent    BOOLEAN DEFAULT FALSE;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS email_consent_at TIMESTAMPTZ;

-- Indexes voor veelgebruikte queries
CREATE INDEX IF NOT EXISTS idx_candidates_reference
  ON candidates(candidate_reference);
CREATE INDEX IF NOT EXISTS idx_candidates_source
  ON candidates(tenant_id, source);
CREATE INDEX IF NOT EXISTS idx_candidates_gdpr_consent_at
  ON candidates(gdpr_consent_at);

-- =========================================================================
-- 2) CANDIDATE_SKILLS — skills met score (1-10) en herkomst
-- =========================================================================

CREATE TABLE IF NOT EXISTS candidate_skills (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  skill        TEXT NOT NULL,
  score        INTEGER CHECK (score BETWEEN 1 AND 10),
  source       TEXT, -- 'ai_extracted' | 'manual'
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Defensief: voeg score-kolom toe als de tabel ooit zonder is aangemaakt.
ALTER TABLE candidate_skills ADD COLUMN IF NOT EXISTS score INTEGER;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'candidate_skills_score_check'
  ) THEN
    ALTER TABLE candidate_skills
      ADD CONSTRAINT candidate_skills_score_check
      CHECK (score IS NULL OR (score BETWEEN 1 AND 10));
  END IF;
END $$;

-- Defensief: zorg dat source-kolom bestaat als de tabel pre-bestaand was.
ALTER TABLE candidate_skills ADD COLUMN IF NOT EXISTS source TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_skill
  ON candidate_skills(candidate_id, lower(skill));

CREATE INDEX IF NOT EXISTS idx_candidate_skills_tenant
  ON candidate_skills(tenant_id);
CREATE INDEX IF NOT EXISTS idx_candidate_skills_candidate
  ON candidate_skills(candidate_id);

ALTER TABLE candidate_skills ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'candidate_skills'
      AND policyname = 'tenant_isolation_candidate_skills'
  ) THEN
    CREATE POLICY tenant_isolation_candidate_skills ON candidate_skills
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- 3) CANDIDATE_RESUMES — multi-CV per kandidaat
-- =========================================================================

CREATE TABLE IF NOT EXISTS candidate_resumes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  storage_url  TEXT NOT NULL,
  mime_type    TEXT,
  size_bytes   BIGINT,
  is_primary   BOOLEAN DEFAULT FALSE,
  parsed_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidate_resumes_tenant
  ON candidate_resumes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_candidate_resumes_candidate
  ON candidate_resumes(candidate_id);

-- Slechts één primaire CV per kandidaat (partial unique index).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_candidate_resumes_primary'
  ) THEN
    CREATE UNIQUE INDEX uq_candidate_resumes_primary
      ON candidate_resumes(candidate_id)
      WHERE is_primary = TRUE;
  END IF;
END $$;

ALTER TABLE candidate_resumes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'candidate_resumes'
      AND policyname = 'tenant_isolation_candidate_resumes'
  ) THEN
    CREATE POLICY tenant_isolation_candidate_resumes ON candidate_resumes
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- 4) PIPELINE_TEMPLATES — herbruikbare pipeline-blueprints
-- =========================================================================
-- 001_init.sql definieert pipeline_stages met NOT NULL job_id, dus daar
-- kunnen we geen template-stages opslaan. We maken een aparte template-store.

CREATE TABLE IF NOT EXISTS pipeline_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL = systeem-template
  name        TEXT NOT NULL,
  description TEXT,
  is_default  BOOLEAN DEFAULT FALSE,
  is_system   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Defensief: kolommen toevoegen als pipeline_templates al bestond zonder ze.
ALTER TABLE pipeline_templates ADD COLUMN IF NOT EXISTS is_default  BOOLEAN DEFAULT FALSE;
ALTER TABLE pipeline_templates ADD COLUMN IF NOT EXISTS is_system   BOOLEAN DEFAULT FALSE;
ALTER TABLE pipeline_templates ADD COLUMN IF NOT EXISTS description TEXT;

-- Slechts één unieke systeem-template-naam (tenant_id IS NULL).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_pipeline_templates_system_name'
  ) THEN
    CREATE UNIQUE INDEX uq_pipeline_templates_system_name
      ON pipeline_templates(name)
      WHERE tenant_id IS NULL;
  END IF;
END $$;

-- Per tenant unieke naam (voor klantspecifieke templates).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_pipeline_templates_tenant_name'
  ) THEN
    CREATE UNIQUE INDEX uq_pipeline_templates_tenant_name
      ON pipeline_templates(tenant_id, name)
      WHERE tenant_id IS NOT NULL;
  END IF;
END $$;

ALTER TABLE pipeline_templates ENABLE ROW LEVEL SECURITY;
-- Systeem-templates (tenant_id IS NULL) zijn voor iedereen leesbaar;
-- tenant-specifieke templates blijven geïsoleerd.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pipeline_templates'
      AND policyname = 'tenant_isolation_pipeline_templates'
  ) THEN
    CREATE POLICY tenant_isolation_pipeline_templates ON pipeline_templates
      USING (
        tenant_id IS NULL
        OR tenant_id = current_setting('app.tenant_id', true)::uuid
      );
  END IF;
END $$;

-- Stages voor een template (los van pipeline_stages, dat job-bound is).
CREATE TABLE IF NOT EXISTS pipeline_template_stages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES pipeline_templates(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  position    INT  NOT NULL,
  color       TEXT DEFAULT '#6366f1',
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (template_id, position),
  UNIQUE (template_id, name)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_template_stages_template
  ON pipeline_template_stages(template_id);

-- =========================================================================
-- 5) SEED — Bureau Pipeline systeem-template (idempotent)
-- =========================================================================

INSERT INTO pipeline_templates (id, tenant_id, name, description, is_default, is_system)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  NULL,
  'Bureau Pipeline',
  'Standaard 9-fasen recruitmentpipeline voor bureaus (van new candidate tot probation passed).',
  TRUE,
  TRUE
)
ON CONFLICT (id) DO NOTHING;

-- Stages — idempotent via ON CONFLICT op (template_id, position).
INSERT INTO pipeline_template_stages (template_id, name, position, color) VALUES
  ('00000000-0000-0000-0000-000000000001', 'New Candidates',     1, '#94a3b8'),
  ('00000000-0000-0000-0000-000000000001', 'Interested',         2, '#60a5fa'),
  ('00000000-0000-0000-0000-000000000001', 'Shortlisted',        3, '#6366f1'),
  ('00000000-0000-0000-0000-000000000001', 'Client Submission',  4, '#8b5cf6'),
  ('00000000-0000-0000-0000-000000000001', 'Client Interview',   5, '#a855f7'),
  ('00000000-0000-0000-0000-000000000001', 'Offered',            6, '#f59e0b'),
  ('00000000-0000-0000-0000-000000000001', 'Hired',              7, '#10b981'),
  ('00000000-0000-0000-0000-000000000001', 'Started',            8, '#059669'),
  ('00000000-0000-0000-0000-000000000001', 'Probation passed',   9, '#047857')
ON CONFLICT (template_id, position) DO NOTHING;
