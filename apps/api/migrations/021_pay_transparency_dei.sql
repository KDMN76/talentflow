-- 021_pay_transparency_dei.sql
-- Sprint Q3.6 (Agent III) — Pay Transparency Directive 2026 + DEI funnel +
-- pay-equity rapportage.
--
-- EU Directive 2023/970 (in werking 2026) verplicht:
--   * Salarisbandbreedte in vacatures.
--   * Gender pay-gap rapportage voor werkgevers met >= 100 medewerkers.
--   * Geen vragen naar huidig salaris bij sollicitatie.
--   * Recht op informatie over compensation-criteria.
--
-- Deze migratie voegt vier dingen toe:
--   1. `jobs` extra pay-transparency-velden + `salary_band_disclosed` (computed).
--   2. `tenant_pay_settings` — per tenant flags + reporting threshold.
--   3. `pay_equity_snapshots` — kwartaal rapport per tenant + categorie.
--   4. `dei_funnel_snapshots` — anonieme demographic-funnel per stage/periode.
--
-- Privacy-by-design:
--   * `by_gender`, `by_age_bracket`, `by_nationality` zijn JSONB met
--     k-anonymity ≥ 5. Groepen kleiner dan 5 worden in 'other' gebucketed
--     of weggelaten (geforceerd in de service-laag — DB houdt het format
--     vrij voor terugwerkende kracht).
--   * Geen kandidaat-id's in snapshots. Alleen aggregate counts/medians.
--
-- Idempotent. Volgt KDMN-conventies: IF NOT EXISTS, DO $$ guards,
-- snake_case, RLS via app.tenant_id setting.

-- =========================================================================
-- A) JOBS — pay-transparency-velden
-- =========================================================================

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS pay_transparency_required BOOLEAN DEFAULT TRUE;

-- `salary_band_disclosed` is een GENERATED column zodat de waarde altijd
-- consistent is met salary_min/salary_max — geen kans op drift via UPDATEs
-- die de flag vergeten. STORED zodat bestaande indexen op de flag blijven
-- werken zonder hertelling.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'jobs'
      AND column_name = 'salary_band_disclosed'
  ) THEN
    ALTER TABLE jobs
      ADD COLUMN salary_band_disclosed BOOLEAN
        GENERATED ALWAYS AS (
          salary_min IS NOT NULL AND salary_max IS NOT NULL
        ) STORED;
  END IF;
END $$;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS compensation_criteria TEXT;

COMMENT ON COLUMN jobs.pay_transparency_required IS
  'Default TRUE: vacature MOET salary_min/max bevatten voor publish; tenant kan dit per job override-en als directive niet van toepassing is';
COMMENT ON COLUMN jobs.salary_band_disclosed IS
  'GENERATED ALWAYS — TRUE wanneer salary_min EN salary_max beide gezet zijn (Pay Transparency Directive 2026)';
COMMENT ON COLUMN jobs.compensation_criteria IS
  'Vrije tekst toelichting op de criteria die het salarisrange bepalen (verplicht onder Pay Transparency Directive art. 6)';

CREATE INDEX IF NOT EXISTS idx_jobs_salary_band_disclosed
  ON jobs(tenant_id, salary_band_disclosed)
  WHERE deleted_at IS NULL;

-- =========================================================================
-- B) TENANT PAY SETTINGS — per tenant transparancy/equity-config
-- =========================================================================

CREATE TABLE IF NOT EXISTS tenant_pay_settings (
  tenant_id                          UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  pay_transparency_enforced          BOOLEAN NOT NULL DEFAULT TRUE,
  prohibit_current_salary_questions  BOOLEAN NOT NULL DEFAULT TRUE,
  reporting_threshold                INTEGER NOT NULL DEFAULT 100,
  default_currency                   TEXT NOT NULL DEFAULT 'EUR',
  benchmark_data_consent             BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at                         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                         TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_pay_settings_threshold_check'
  ) THEN
    ALTER TABLE tenant_pay_settings
      ADD CONSTRAINT tenant_pay_settings_threshold_check
      CHECK (reporting_threshold > 0 AND reporting_threshold <= 100000);
  END IF;
END $$;

ALTER TABLE tenant_pay_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tenant_pay_settings'
      AND policyname = 'tenant_isolation_tenant_pay_settings'
  ) THEN
    CREATE POLICY tenant_isolation_tenant_pay_settings ON tenant_pay_settings
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Backfill: voor elke bestaande tenant zonder rij maken we de default-rij aan
-- zodat de directive-defaults onmiddellijk aktief zijn voor alle tenants.
INSERT INTO tenant_pay_settings (tenant_id)
SELECT t.id
  FROM tenants t
  LEFT JOIN tenant_pay_settings tps ON tps.tenant_id = t.id
 WHERE tps.tenant_id IS NULL
ON CONFLICT (tenant_id) DO NOTHING;

-- =========================================================================
-- C) PAY EQUITY SNAPSHOTS — kwartaal-rapporten
-- =========================================================================

CREATE TABLE IF NOT EXISTS pay_equity_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  job_category    TEXT NOT NULL DEFAULT 'all',
  total_offers    INTEGER NOT NULL,
  median_salary   NUMERIC(12,2),
  by_gender       JSONB NOT NULL DEFAULT '{}'::jsonb,
  by_age_bracket  JSONB NOT NULL DEFAULT '{}'::jsonb,
  pay_gap_pct     NUMERIC(5,2),
  ai_explanation  TEXT,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pay_equity_snapshots_period_check'
  ) THEN
    ALTER TABLE pay_equity_snapshots
      ADD CONSTRAINT pay_equity_snapshots_period_check
      CHECK (period_end >= period_start);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pay_equity_snapshots_total_offers_check'
  ) THEN
    ALTER TABLE pay_equity_snapshots
      ADD CONSTRAINT pay_equity_snapshots_total_offers_check
      CHECK (total_offers >= 0);
  END IF;
END $$;

ALTER TABLE pay_equity_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pay_equity_snapshots'
      AND policyname = 'tenant_isolation_pay_equity_snapshots'
  ) THEN
    CREATE POLICY tenant_isolation_pay_equity_snapshots ON pay_equity_snapshots
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pay_equity_snapshots_tenant_period
  ON pay_equity_snapshots(tenant_id, period_end DESC);

CREATE INDEX IF NOT EXISTS idx_pay_equity_snapshots_tenant_category
  ON pay_equity_snapshots(tenant_id, job_category, period_end DESC);

-- =========================================================================
-- D) DEI FUNNEL SNAPSHOTS — per stage anonieme demographic-funnel
-- =========================================================================

CREATE TABLE IF NOT EXISTS dei_funnel_snapshots (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_start                DATE NOT NULL,
  period_end                  DATE NOT NULL,
  stage_name                  TEXT NOT NULL,
  stage_position              INTEGER NOT NULL DEFAULT 0,
  total                       INTEGER NOT NULL,
  by_gender                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  by_age_bracket              JSONB NOT NULL DEFAULT '{}'::jsonb,
  by_nationality              JSONB NOT NULL DEFAULT '{}'::jsonb,
  drop_off_from_previous_pct  NUMERIC(5,2),
  bias_indicator              NUMERIC(5,2),
  computed_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dei_funnel_snapshots_period_check'
  ) THEN
    ALTER TABLE dei_funnel_snapshots
      ADD CONSTRAINT dei_funnel_snapshots_period_check
      CHECK (period_end >= period_start);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dei_funnel_snapshots_total_check'
  ) THEN
    ALTER TABLE dei_funnel_snapshots
      ADD CONSTRAINT dei_funnel_snapshots_total_check
      CHECK (total >= 0);
  END IF;
END $$;

ALTER TABLE dei_funnel_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dei_funnel_snapshots'
      AND policyname = 'tenant_isolation_dei_funnel_snapshots'
  ) THEN
    CREATE POLICY tenant_isolation_dei_funnel_snapshots ON dei_funnel_snapshots
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dei_funnel_snapshots_tenant_period
  ON dei_funnel_snapshots(tenant_id, period_end DESC);

CREATE INDEX IF NOT EXISTS idx_dei_funnel_snapshots_tenant_stage_period
  ON dei_funnel_snapshots(tenant_id, stage_name, period_end DESC);
