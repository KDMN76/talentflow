-- 028_billing_and_commissions.sql
-- Sprint Q4.4 — Temp/contract back-office (Agent UUU).
--
-- Tabellen voor het facturatie-, accounting-integratie-, commissie- en
-- forecasting-deel van de bureau back-office:
--   - invoices + invoice_lines           : factuur-beheer
--   - tenant_invoice_sequences           : per-tenant sequentiële invoice-nummering
--   - accounting_integrations            : per-tenant Exact/Twinfield/SnelStart koppeling
--   - commission_schemes / _assignments / _records : recruiter-commissies
--   - revenue_forecasts                  : nightly forecast snapshots
--
-- Coordineert met:
--   - Agent TTT (027_timesheets_and_contracts.sql) — wij refereren naar
--     `contracts(id)` voor `commission_assignments` en `invoices`.
--   - Agent VVV (web) — frontend consumeert de billing/accounting/commissions/
--     forecasting REST routes.
--
-- Idempotent. KDMN-conventies: IF NOT EXISTS, DO $$ guards, RLS via
-- `app.tenant_id` setting, snake_case, `created_at`/`updated_at` op alle tabellen.

-- =========================================================================
-- A) tenant_invoice_sequences — per-tenant counter voor invoice-nummers
-- =========================================================================
--
-- Eén rij per (tenant, year). De service-laag claimt een nieuw nummer met
-- `INSERT … ON CONFLICT DO UPDATE … RETURNING current_value` zodat we onder
-- concurrent inserts geen duplicate invoice_numbers kunnen krijgen. Het
-- `UNIQUE (tenant_id, invoice_number)` constraint op `invoices` is een
-- tweede vangnet.

CREATE TABLE IF NOT EXISTS tenant_invoice_sequences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  year            INTEGER NOT NULL,
  current_value   BIGINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_invoice_sequences_tenant_year_unique'
  ) THEN
    ALTER TABLE tenant_invoice_sequences
      ADD CONSTRAINT tenant_invoice_sequences_tenant_year_unique
      UNIQUE (tenant_id, year);
  END IF;
END $$;

ALTER TABLE tenant_invoice_sequences ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tenant_invoice_sequences'
      AND policyname = 'tenant_isolation_tenant_invoice_sequences'
  ) THEN
    CREATE POLICY tenant_isolation_tenant_invoice_sequences
      ON tenant_invoice_sequences
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- B) invoices — facturen (per tenant, sequential nummering)
-- =========================================================================

CREATE TABLE IF NOT EXISTS invoices (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_number                  TEXT NOT NULL,
  client_organization_id          UUID,
  contract_id                     UUID REFERENCES contracts(id) ON DELETE SET NULL,
  status                          TEXT NOT NULL DEFAULT 'draft',
  period_start                    DATE,
  period_end                      DATE,
  issued_date                     DATE,
  due_date                        DATE,
  paid_date                       DATE,
  subtotal_amount                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_rate                        NUMERIC(5,2) NOT NULL DEFAULT 21.00,
  vat_amount                      NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount                    NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency                        TEXT NOT NULL DEFAULT 'EUR',
  notes                           TEXT,
  pdf_storage_key                 TEXT,
  external_accounting_id          TEXT,
  external_accounting_provider    TEXT,
  external_synced_at              TIMESTAMPTZ,
  created_by                      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_status_check'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_status_check
      CHECK (status IN ('draft','sent','paid','overdue','void'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_external_provider_check'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_external_provider_check
      CHECK (
        external_accounting_provider IS NULL
        OR external_accounting_provider IN ('exact_online','twinfield','snelstart')
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_tenant_invoice_number_unique'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_tenant_invoice_number_unique
      UNIQUE (tenant_id, invoice_number);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status
  ON invoices (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_contract
  ON invoices (tenant_id, contract_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_client_org
  ON invoices (tenant_id, client_organization_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_due
  ON invoices (tenant_id, due_date)
  WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_created
  ON invoices (tenant_id, created_at DESC, id DESC);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'invoices' AND policyname = 'tenant_isolation_invoices'
  ) THEN
    CREATE POLICY tenant_isolation_invoices ON invoices
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- C) invoice_lines — factuurregels (per week of aggregaat)
-- =========================================================================

CREATE TABLE IF NOT EXISTS invoice_lines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id   UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description  TEXT NOT NULL,
  quantity     NUMERIC(10,3) NOT NULL DEFAULT 0,
  unit         TEXT NOT NULL DEFAULT 'hours',
  unit_price   NUMERIC(10,2) NOT NULL DEFAULT 0,
  line_total   NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_rate     NUMERIC(5,2),
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_lines_unit_check'
  ) THEN
    ALTER TABLE invoice_lines
      ADD CONSTRAINT invoice_lines_unit_check
      CHECK (unit IN ('hours','months','pcs','flat'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoice_lines_tenant_invoice
  ON invoice_lines (tenant_id, invoice_id);

ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'invoice_lines'
      AND policyname = 'tenant_isolation_invoice_lines'
  ) THEN
    CREATE POLICY tenant_isolation_invoice_lines ON invoice_lines
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- D) accounting_integrations — Exact Online / Twinfield / SnelStart koppels
-- =========================================================================

CREATE TABLE IF NOT EXISTS accounting_integrations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider                 TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'connected',
  display_name             TEXT,
  credentials_encrypted    BYTEA,
  settings                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_revenue_account  TEXT,
  default_vat_code         TEXT,
  connected_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  connected_at             TIMESTAMPTZ,
  last_synced_at           TIMESTAMPTZ,
  last_error               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounting_integrations_provider_check'
  ) THEN
    ALTER TABLE accounting_integrations
      ADD CONSTRAINT accounting_integrations_provider_check
      CHECK (provider IN ('exact_online','twinfield','snelstart'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounting_integrations_status_check'
  ) THEN
    ALTER TABLE accounting_integrations
      ADD CONSTRAINT accounting_integrations_status_check
      CHECK (status IN ('connected','disconnected','error'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounting_integrations_tenant_provider_unique'
  ) THEN
    ALTER TABLE accounting_integrations
      ADD CONSTRAINT accounting_integrations_tenant_provider_unique
      UNIQUE (tenant_id, provider);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_accounting_integrations_tenant_status
  ON accounting_integrations (tenant_id, status);

ALTER TABLE accounting_integrations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'accounting_integrations'
      AND policyname = 'tenant_isolation_accounting_integrations'
  ) THEN
    CREATE POLICY tenant_isolation_accounting_integrations ON accounting_integrations
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- E) commission_schemes — recruiter-commissieregels
-- =========================================================================

CREATE TABLE IF NOT EXISTS commission_schemes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL,
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commission_schemes_type_check'
  ) THEN
    ALTER TABLE commission_schemes
      ADD CONSTRAINT commission_schemes_type_check
      CHECK (type IN (
        'flat','percent_of_fee','percent_of_margin','tiered','recurring_monthly'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_commission_schemes_tenant_active
  ON commission_schemes (tenant_id, active);

ALTER TABLE commission_schemes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'commission_schemes'
      AND policyname = 'tenant_isolation_commission_schemes'
  ) THEN
    CREATE POLICY tenant_isolation_commission_schemes ON commission_schemes
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- F) commission_assignments — wie krijgt welke commissie op welk contract
-- =========================================================================

CREATE TABLE IF NOT EXISTS commission_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recruiter_id    UUID,
  contract_id     UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  scheme_id       UUID NOT NULL REFERENCES commission_schemes(id) ON DELETE RESTRICT,
  share_percent   NUMERIC(5,2) NOT NULL DEFAULT 100.00,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commission_assignments_share_check'
  ) THEN
    ALTER TABLE commission_assignments
      ADD CONSTRAINT commission_assignments_share_check
      CHECK (share_percent >= 0 AND share_percent <= 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_commission_assignments_tenant_contract
  ON commission_assignments (tenant_id, contract_id);
CREATE INDEX IF NOT EXISTS idx_commission_assignments_tenant_recruiter
  ON commission_assignments (tenant_id, recruiter_id);

ALTER TABLE commission_assignments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'commission_assignments'
      AND policyname = 'tenant_isolation_commission_assignments'
  ) THEN
    CREATE POLICY tenant_isolation_commission_assignments ON commission_assignments
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- G) commission_records — berekende commissie per (assignment, invoice)
-- =========================================================================

CREATE TABLE IF NOT EXISTS commission_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assignment_id       UUID NOT NULL REFERENCES commission_assignments(id) ON DELETE CASCADE,
  recruiter_id        UUID,
  contract_id         UUID,
  invoice_id          UUID REFERENCES invoices(id) ON DELETE SET NULL,
  base_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  commission_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  period_start        DATE,
  period_end          DATE,
  status              TEXT NOT NULL DEFAULT 'pending',
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commission_records_status_check'
  ) THEN
    ALTER TABLE commission_records
      ADD CONSTRAINT commission_records_status_check
      CHECK (status IN ('pending','approved','paid','disputed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_commission_records_tenant_status
  ON commission_records (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_commission_records_tenant_recruiter
  ON commission_records (tenant_id, recruiter_id);
CREATE INDEX IF NOT EXISTS idx_commission_records_tenant_invoice
  ON commission_records (tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_commission_records_tenant_created
  ON commission_records (tenant_id, created_at DESC, id DESC);

ALTER TABLE commission_records ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'commission_records'
      AND policyname = 'tenant_isolation_commission_records'
  ) THEN
    CREATE POLICY tenant_isolation_commission_records ON commission_records
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- H) revenue_forecasts — nightly snapshot van expected/pipeline revenue
-- =========================================================================

CREATE TABLE IF NOT EXISTS revenue_forecasts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  forecast_month      DATE NOT NULL,
  expected_revenue    NUMERIC(14,2) NOT NULL DEFAULT 0,
  pipeline_revenue    NUMERIC(14,2) NOT NULL DEFAULT 0,
  hires_in_pipeline   INTEGER NOT NULL DEFAULT 0,
  active_contracts    INTEGER NOT NULL DEFAULT 0,
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'revenue_forecasts_tenant_month_unique'
  ) THEN
    ALTER TABLE revenue_forecasts
      ADD CONSTRAINT revenue_forecasts_tenant_month_unique
      UNIQUE (tenant_id, forecast_month);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_revenue_forecasts_tenant_month
  ON revenue_forecasts (tenant_id, forecast_month);

ALTER TABLE revenue_forecasts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'revenue_forecasts'
      AND policyname = 'tenant_isolation_revenue_forecasts'
  ) THEN
    CREATE POLICY tenant_isolation_revenue_forecasts ON revenue_forecasts
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
