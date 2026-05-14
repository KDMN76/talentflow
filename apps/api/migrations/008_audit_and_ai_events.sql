-- 008_audit_and_ai_events.sql
-- Sprint Q1.1 — Foundation hardening: observability + audit/AI-events.
--
-- Voegt twee append-only tabellen toe:
--   1) audit_events  — compliance-grade audit-trail van elke schrijfactie
--   2) ai_events     — AI-inference logging voor EU AI Act compliance
--
-- Beide tabellen zijn:
--   - Tenant-isolated via RLS (`app.tenant_id` setting, zoals 001_init.sql)
--   - WORM (Write-Once-Read-Many) — UPDATE en DELETE worden hard geweigerd
--     via een trigger. Append-only is de juridische eis voor audit-trails.
--
-- Het bestaande `activities`-table is GEEN vervanger: dat is een
-- user-facing feed (zichtbaar in UI, vrij wijzigbaar). `audit_events` is
-- onveranderlijk en bedoeld voor compliance / GDPR-export.

-- =========================================================================
-- A) AUDIT EVENTS — append-only schrijf-audit
-- =========================================================================

CREATE TABLE IF NOT EXISTS audit_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,         -- 'candidate.created', 'job.updated', 'consent.granted', etc.
  entity_type  TEXT NOT NULL,         -- 'candidate', 'job', 'application', 'consent', etc.
  entity_id    UUID,                  -- NULL toegestaan voor bulk-acties / niet-entiteitsacties
  before       JSONB,                 -- snapshot vóór mutatie (NULL bij create)
  after        JSONB,                 -- snapshot ná mutatie (NULL bij delete)
  ip_address   INET,
  user_agent   TEXT,
  request_id   TEXT,                  -- correlation-id (X-Request-Id of UUID)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'audit_events' AND policyname = 'tenant_isolation_audit_events'
  ) THEN
    CREATE POLICY tenant_isolation_audit_events ON audit_events
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- ─── Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_created
  ON audit_events(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_entity
  ON audit_events(tenant_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_action_created
  ON audit_events(tenant_id, action, created_at DESC);

-- =========================================================================
-- B) AI EVENTS — AI-inference log voor EU AI Act compliance
-- =========================================================================
--
-- Doel:
--   - Aantoonbare logging van élke AI-inference (welke feature, welk model,
--     hoeveel tokens, hoe snel, gefaald?) voor de tenant-admin om aan de
--     transparantie-plicht te voldoen.
--   - input_hash i.p.v. ruwe input — privacy-vriendelijk (we kunnen wél
--     uniek-hits aantonen, maar niet de letterlijke CV-tekst herstellen).
--   - cost_cents bereidt Q3 facturatie / credits voor.

CREATE TABLE IF NOT EXISTS ai_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  feature         TEXT NOT NULL,        -- 'resume_parser', 'match_explanation', 'embedding', 'jd_generator', 'bias_check'
  model           TEXT NOT NULL,        -- 'claude-opus-4-7', 'text-embedding-3-small', etc.
  provider        TEXT NOT NULL,        -- 'anthropic', 'openai'
  input_hash      TEXT NOT NULL,        -- SHA-256 van input (geen ruwe tekst voor privacy)
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  output_summary  TEXT,                 -- korte samenvatting van wat AI deed (max 200 chars, app-side getruncate)
  latency_ms      INTEGER,
  cost_cents      NUMERIC(10,4),        -- geschatte kosten (na release Q3 incl. credits)
  entity_type     TEXT,                 -- 'candidate', 'job', 'application'
  entity_id       UUID,
  cached          BOOLEAN NOT NULL DEFAULT FALSE, -- true als uit cache geserveerd
  status          TEXT NOT NULL DEFAULT 'success', -- 'success'|'failed'|'mocked'
  error           TEXT,                 -- bij status='failed'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_events_status_check'
  ) THEN
    ALTER TABLE ai_events
      ADD CONSTRAINT ai_events_status_check
      CHECK (status IN ('success', 'failed', 'mocked'));
  END IF;
END $$;

-- ─── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE ai_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ai_events' AND policyname = 'tenant_isolation_ai_events'
  ) THEN
    CREATE POLICY tenant_isolation_ai_events ON ai_events
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- ─── Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ai_events_tenant_created
  ON ai_events(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_events_tenant_feature_created
  ON ai_events(tenant_id, feature, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_events_tenant_entity
  ON ai_events(tenant_id, entity_type, entity_id);

-- =========================================================================
-- C) WORM-protectie — UPDATE/DELETE op audit_events en ai_events forbidden
-- =========================================================================
--
-- Eén shared trigger-functie voor beide tabellen. Idempotent — we maken de
-- functie aan met CREATE OR REPLACE en de triggers met een EXISTS-guard.

CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: UPDATE/DELETE is forbidden on %', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_events_no_update') THEN
    CREATE TRIGGER audit_events_no_update
      BEFORE UPDATE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_events_no_delete') THEN
    CREATE TRIGGER audit_events_no_delete
      BEFORE DELETE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ai_events_no_update') THEN
    CREATE TRIGGER ai_events_no_update
      BEFORE UPDATE ON ai_events
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ai_events_no_delete') THEN
    CREATE TRIGGER ai_events_no_delete
      BEFORE DELETE ON ai_events
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
  END IF;
END $$;
