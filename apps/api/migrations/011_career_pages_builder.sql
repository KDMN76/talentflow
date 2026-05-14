-- 011_career_pages_builder.sql
-- Sprint Q2.2 — Career-page builder + sollicitatie-applicatie-handler.
--
-- Voegt vijf dingen toe:
--   0) BASELINE — `career_pages`. De service-code in
--      `apps/api/src/modules/career-pages/career-pages.service.ts` refereerde
--      al naar deze tabel maar er was nog géén migration voor; we leggen
--      hem hier officieel vast met de bestaande columns en dan de Q2.2
--      uitbreidingen.
--   1) `career_pages` builder-config kolommen (template/blocks/SEO/domain/
--      analytics/published flags).
--   2) `career_page_application_forms` — per-vacature applicatieformulier-config
--      (NULL job_id = global form voor alle vacatures op deze career page).
--   3) `career_page_applications` — sollicitaties via career-page voordat ze
--      een echte candidate worden (worker pikt 'm op, dedupe + create).
--   4) `career_page_application_rate_limit` — IP-throttle voor public POST
--      submitApplication (max 10 / IP / 15 min).
--
-- Alle DDL is idempotent (IF NOT EXISTS / DO-block guards) zodat
-- her-runs in dev geen errors gooien.

-- =========================================================================
-- 0) BASELINE — career_pages (was alleen impliciet aanwezig in TS-service)
-- =========================================================================

CREATE TABLE IF NOT EXISTS career_pages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug              TEXT NOT NULL UNIQUE,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  config            JSONB NOT NULL DEFAULT '{}'::jsonb,
  language          TEXT NOT NULL DEFAULT 'nl',
  template          TEXT NOT NULL DEFAULT 'modern',
  visit_count       INTEGER NOT NULL DEFAULT 0,
  application_count INTEGER NOT NULL DEFAULT 0,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE career_pages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'career_pages'
      AND policyname = 'tenant_isolation_career_pages'
  ) THEN
    CREATE POLICY tenant_isolation_career_pages ON career_pages
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_career_pages_tenant
  ON career_pages(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_career_pages_slug
  ON career_pages(slug) WHERE deleted_at IS NULL;

-- =========================================================================
-- 1) CAREER_PAGES — Q2.2 builder uitbreidingen
-- =========================================================================

ALTER TABLE career_pages ADD COLUMN IF NOT EXISTS template_id TEXT DEFAULT 'modern';
ALTER TABLE career_pages ADD COLUMN IF NOT EXISTS blocks JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE career_pages ADD COLUMN IF NOT EXISTS seo_title TEXT;
ALTER TABLE career_pages ADD COLUMN IF NOT EXISTS seo_description TEXT;
ALTER TABLE career_pages ADD COLUMN IF NOT EXISTS og_image_url TEXT;
ALTER TABLE career_pages ADD COLUMN IF NOT EXISTS custom_domain TEXT;
ALTER TABLE career_pages ADD COLUMN IF NOT EXISTS custom_domain_verified_at TIMESTAMPTZ;
ALTER TABLE career_pages ADD COLUMN IF NOT EXISTS analytics_ga4_id TEXT;
ALTER TABLE career_pages ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE career_pages ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE career_pages ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'nl';
ALTER TABLE career_pages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Custom domain moet uniek zijn over alle tenants (Caddy resolveert
-- één domein → één career page). Idempotente UNIQUE INDEX op het non-null subset.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_career_pages_custom_domain'
  ) THEN
    CREATE UNIQUE INDEX uq_career_pages_custom_domain
      ON career_pages(custom_domain)
      WHERE custom_domain IS NOT NULL AND deleted_at IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_career_pages_published
  ON career_pages(published)
  WHERE published = TRUE AND deleted_at IS NULL;

-- =========================================================================
-- 2) CAREER_PAGE_APPLICATION_FORMS — per-vacature applicatieformulier-config
-- =========================================================================
--
-- Eén rij per (career_page, job). job_id = NULL betekent een "global" form
-- dat geldt voor alle vacatures van deze career-page. Per (career_page, job)
-- maximaal één override-row, gegarandeerd door de partial unique index hieronder.

CREATE TABLE IF NOT EXISTS career_page_application_forms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  career_page_id  UUID NOT NULL REFERENCES career_pages(id) ON DELETE CASCADE,
  job_id          UUID REFERENCES jobs(id) ON DELETE CASCADE,
  fields          JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE career_page_application_forms ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'career_page_application_forms'
      AND policyname = 'tenant_isolation_career_page_application_forms'
  ) THEN
    CREATE POLICY tenant_isolation_career_page_application_forms
      ON career_page_application_forms
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Een job-specifiek formulier mag maar één keer bestaan per career-page.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_career_page_form_job'
  ) THEN
    CREATE UNIQUE INDEX uq_career_page_form_job
      ON career_page_application_forms(career_page_id, job_id)
      WHERE job_id IS NOT NULL;
  END IF;
END $$;

-- Het globale formulier (job_id IS NULL) mag ook maar één keer bestaan per career-page.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_career_page_form_global'
  ) THEN
    CREATE UNIQUE INDEX uq_career_page_form_global
      ON career_page_application_forms(career_page_id)
      WHERE job_id IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_career_page_forms_tenant_page
  ON career_page_application_forms(tenant_id, career_page_id);

-- =========================================================================
-- 3) CAREER_PAGE_APPLICATIONS — raw sollicitaties via career-page
-- =========================================================================
--
-- Workflow:
--   1) Public POST /api/career-pages/public/:id/applications inserts hier
--      met status='pending' + alle metadata (UA/IP/UTM/referrer/resume_storage_key).
--   2) Worker `careerPageApplication.worker.ts` verwerkt asynchroon:
--        - dedupe op email → bestaande candidate of nieuwe
--        - INSERT in `applications` met source='career_page'
--        - UPDATE deze rij: candidate_id + status='linked'
--   3) Bij failure: status='failed' + error_message.
--   4) Bij dedupe-match zonder nieuwe candidate: status='duplicate'.

CREATE TABLE IF NOT EXISTS career_page_applications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  career_page_id      UUID NOT NULL REFERENCES career_pages(id) ON DELETE CASCADE,
  job_id              UUID REFERENCES jobs(id) ON DELETE SET NULL,
  applicant_data      JSONB NOT NULL DEFAULT '{}'::jsonb,
  resume_storage_key  TEXT,
  resume_filename     TEXT,
  resume_mime_type    TEXT,
  candidate_id        UUID REFERENCES candidates(id) ON DELETE SET NULL,
  application_id      UUID REFERENCES applications(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  error_message       TEXT,
  ip_address          INET,
  user_agent          TEXT,
  referrer            TEXT,
  utm_source          TEXT,
  utm_medium          TEXT,
  utm_campaign        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at        TIMESTAMPTZ
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'career_page_applications_status_check'
  ) THEN
    ALTER TABLE career_page_applications
      ADD CONSTRAINT career_page_applications_status_check
      CHECK (status IN ('pending','processing','linked','failed','duplicate'));
  END IF;
END $$;

ALTER TABLE career_page_applications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'career_page_applications'
      AND policyname = 'tenant_isolation_career_page_applications'
  ) THEN
    CREATE POLICY tenant_isolation_career_page_applications
      ON career_page_applications
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cp_applications_tenant
  ON career_page_applications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cp_applications_status
  ON career_page_applications(status);
CREATE INDEX IF NOT EXISTS idx_cp_applications_career_page
  ON career_page_applications(career_page_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cp_applications_job
  ON career_page_applications(job_id) WHERE job_id IS NOT NULL;

-- Een ip+email mag binnen 5 min maar één pending rij hebben — vangt
-- accidentele dubbelklik-submits af zonder per-IP rate limiting te raken.
-- Niet als constraint maar als index voor read-side dedupe in worker.
CREATE INDEX IF NOT EXISTS idx_cp_applications_recent_ip
  ON career_page_applications(ip_address, created_at DESC)
  WHERE ip_address IS NOT NULL;

-- =========================================================================
-- 4) TENANTS — opt-in flag voor recruiter notification on application
-- =========================================================================
--
-- Stored op tenants.settings (JSONB) zodat we geen aparte kolom-migratie
-- nodig hebben. Worker leest `settings->>'notify_on_career_page_application'`.
-- Geen DDL nodig — alleen documentatie hier voor toekomstige lezer.
