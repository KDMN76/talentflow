-- 034_crm_tables.sql
-- CRM-module: de tabellen die de bestaande UI + routes + services al verwachten
-- (organizations / crm_contacts / crm_deals) maar die in geen enkele migratie
-- bestonden — elke CRM-actie gaf daardoor 42P01 / "CRM_NOT_PROVISIONED".
--
-- Kolommen zijn 1-op-1 afgeleid uit de service-queries
-- (apps/api/src/modules/crm/*.service.ts). NB: de service gebruikt
-- `organizations` (niet `crm_organizations`) — we volgen de code.
--
-- Idempotent. RLS in moderne stijl: USING + WITH CHECK (zie migratie 032).

-- =========================================================================
-- A) organizations — klant-/prospect-bedrijven
-- =========================================================================

CREATE TABLE IF NOT EXISTS organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  industry    TEXT,
  website     TEXT,
  notes       TEXT,
  type        TEXT NOT NULL DEFAULT 'prospect',  -- client | prospect | partner
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_organizations_tenant
  ON organizations (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_tenant_name
  ON organizations (tenant_id, name) WHERE deleted_at IS NULL;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'organizations' AND policyname = 'tenant_isolation_organizations'
  ) THEN
    CREATE POLICY tenant_isolation_organizations ON organizations
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- B) crm_contacts — contactpersonen bij een organisatie
-- =========================================================================

CREATE TABLE IF NOT EXISTS crm_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  role            TEXT,
  linkedin_url    TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_tenant
  ON crm_contacts (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_contacts_org
  ON crm_contacts (tenant_id, organization_id) WHERE deleted_at IS NULL;

ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'crm_contacts' AND policyname = 'tenant_isolation_crm_contacts'
  ) THEN
    CREATE POLICY tenant_isolation_crm_contacts ON crm_contacts
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- C) crm_deals — sales-pipeline (gekoppeld aan organisatie/vacature/recruiter)
-- =========================================================================

CREATE TABLE IF NOT EXISTS crm_deals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id     UUID REFERENCES organizations(id) ON DELETE SET NULL,
  job_id              UUID REFERENCES jobs(id) ON DELETE SET NULL,
  recruiter_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  stage               TEXT NOT NULL DEFAULT 'prospect',
  value_eur           NUMERIC(12,2),
  expected_close_date DATE,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_deals_stage_check'
  ) THEN
    ALTER TABLE crm_deals
      ADD CONSTRAINT crm_deals_stage_check
      CHECK (stage IN ('prospect', 'offerte', 'onderhandeling', 'gewonnen', 'verloren'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_crm_deals_tenant
  ON crm_deals (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_deals_stage
  ON crm_deals (tenant_id, stage) WHERE deleted_at IS NULL;

ALTER TABLE crm_deals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'crm_deals' AND policyname = 'tenant_isolation_crm_deals'
  ) THEN
    CREATE POLICY tenant_isolation_crm_deals ON crm_deals
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
