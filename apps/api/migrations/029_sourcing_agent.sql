-- 029_sourcing_agent.sql
-- Sprint Q4.5 — Agentic AI Sourcing (Agent WWW).
--
-- Tabellen voor de autonome sourcing-agent:
--   1) agent_briefs    — recruiter's natuurlijke-taal brief + parsed structure
--   2) agent_runs      — een uitvoering van de agent tegen een brief
--   3) agent_findings  — kandidaten die de agent surfacede (pre-approval)
--   4) agent_actions   — WORM action-log: élke autonome actie + reasoning + cost
--   5) agent_memory    — agent's source-of-truth memory (tenant/recruiter/brief scope)
--
-- EU AI Act art. 13 compliance:
--   - Elke AI-driven sourcing-beslissing wordt gelogd (agent_actions + ai_events)
--   - Override-able (recruiter approve/reject op elke finding)
--   - Explainable (reasoning, payload + reasoning_log op runs)
--
-- Append-only: agent_actions is WORM — UPDATE/DELETE wordt geblokkeerd via
-- de gedeelde `prevent_audit_mutation()` trigger uit migration 008.
--
-- Idempotent. RLS via `app.tenant_id` setting, snake_case.

-- =========================================================================
-- A) agent_briefs — recruiter input
-- =========================================================================

CREATE TABLE IF NOT EXISTS agent_briefs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id                UUID REFERENCES jobs(id) ON DELETE CASCADE,
  brief_text            TEXT NOT NULL,
  must_have             JSONB NOT NULL DEFAULT '[]'::jsonb,
  nice_to_have          JSONB NOT NULL DEFAULT '[]'::jsonb,
  exclusions            JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_count          INTEGER NOT NULL DEFAULT 25,
  search_locations      JSONB NOT NULL DEFAULT '[]'::jsonb,
  language_preferences  JSONB NOT NULL DEFAULT '["nl","en"]'::jsonb,
  active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE agent_briefs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'agent_briefs' AND policyname = 'tenant_isolation_agent_briefs'
  ) THEN
    CREATE POLICY tenant_isolation_agent_briefs ON agent_briefs
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_briefs_tenant_active
  ON agent_briefs(tenant_id, active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_briefs_tenant_job
  ON agent_briefs(tenant_id, job_id);

-- =========================================================================
-- B) agent_runs — agent uitvoeringen
-- =========================================================================

CREATE TABLE IF NOT EXISTS agent_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  brief_id             UUID NOT NULL REFERENCES agent_briefs(id) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'queued',
  trigger              TEXT NOT NULL DEFAULT 'manual',
  started_at           TIMESTAMPTZ,
  finished_at          TIMESTAMPTZ,
  candidates_found     INTEGER NOT NULL DEFAULT 0,
  candidates_approved  INTEGER NOT NULL DEFAULT 0,
  candidates_rejected  INTEGER NOT NULL DEFAULT 0,
  expansion_iteration  INTEGER NOT NULL DEFAULT 0,
  current_query        JSONB,
  reasoning_log        JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message        TEXT,
  created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_status_check'
  ) THEN
    ALTER TABLE agent_runs
      ADD CONSTRAINT agent_runs_status_check
      CHECK (status IN ('queued','running','review_required','completed','failed','cancelled'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_trigger_check'
  ) THEN
    ALTER TABLE agent_runs
      ADD CONSTRAINT agent_runs_trigger_check
      CHECK (trigger IN ('manual','scheduled','reactivation','expansion'));
  END IF;
END $$;

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'agent_runs' AND policyname = 'tenant_isolation_agent_runs'
  ) THEN
    CREATE POLICY tenant_isolation_agent_runs ON agent_runs
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_status
  ON agent_runs(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_brief
  ON agent_runs(tenant_id, brief_id, created_at DESC);

-- =========================================================================
-- C) agent_findings — surfaced candidates (pre-review)
-- =========================================================================

CREATE TABLE IF NOT EXISTS agent_findings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id            UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  brief_id          UUID NOT NULL REFERENCES agent_briefs(id) ON DELETE CASCADE,
  candidate_id      UUID,
  external_source   TEXT,
  external_url      TEXT,
  external_id       TEXT,
  full_name         TEXT,
  current_title     TEXT,
  current_company   TEXT,
  location          TEXT,
  headline          TEXT,
  summary           TEXT,
  skills            JSONB NOT NULL DEFAULT '[]'::jsonb,
  languages         JSONB NOT NULL DEFAULT '[]'::jsonb,
  match_score       NUMERIC(5,2),
  match_reasoning   TEXT,
  status            TEXT NOT NULL DEFAULT 'pending_review',
  reviewed_at       TIMESTAMPTZ,
  reviewed_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  review_note       TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_findings_status_check'
  ) THEN
    ALTER TABLE agent_findings
      ADD CONSTRAINT agent_findings_status_check
      CHECK (status IN ('pending_review','approved','rejected','contacted','dismissed'));
  END IF;
END $$;

-- Dedupe per run via een functional unique index (kan COALESCE binnen index).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE tablename = 'agent_findings'
       AND indexname = 'agent_findings_run_dedupe'
  ) THEN
    CREATE UNIQUE INDEX agent_findings_run_dedupe
      ON agent_findings (
        tenant_id,
        run_id,
        COALESCE(external_id, full_name || '|' || COALESCE(current_company, ''))
      );
  END IF;
END $$;

ALTER TABLE agent_findings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'agent_findings' AND policyname = 'tenant_isolation_agent_findings'
  ) THEN
    CREATE POLICY tenant_isolation_agent_findings ON agent_findings
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_findings_tenant_run
  ON agent_findings(tenant_id, run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_findings_tenant_status
  ON agent_findings(tenant_id, status, created_at DESC);
-- Sparse partial index — alleen wanneer candidate_id gekoppeld.
CREATE INDEX IF NOT EXISTS idx_agent_findings_tenant_candidate
  ON agent_findings(tenant_id, candidate_id)
  WHERE candidate_id IS NOT NULL;

-- =========================================================================
-- D) agent_actions — WORM action-log
-- =========================================================================
--
-- Append-only; UPDATE/DELETE worden geblokkeerd door de gedeelde trigger uit
-- migration 008 (`prevent_audit_mutation`).

CREATE TABLE IF NOT EXISTS agent_actions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id              UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  finding_id          UUID REFERENCES agent_findings(id) ON DELETE SET NULL,
  action              TEXT NOT NULL,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  reasoning           TEXT,
  ai_model            TEXT,
  prompt_tokens       INTEGER,
  completion_tokens   INTEGER,
  cost_usd            NUMERIC(10,4),
  requires_approval   BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE agent_actions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'agent_actions' AND policyname = 'tenant_isolation_agent_actions'
  ) THEN
    CREATE POLICY tenant_isolation_agent_actions ON agent_actions
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_actions_tenant_run
  ON agent_actions(tenant_id, run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_actions_tenant_action
  ON agent_actions(tenant_id, action, created_at DESC);

-- WORM-protectie — hergebruikt `prevent_audit_mutation()` uit migration 008.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'agent_actions_no_update') THEN
    CREATE TRIGGER agent_actions_no_update
      BEFORE UPDATE ON agent_actions
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'agent_actions_no_delete') THEN
    CREATE TRIGGER agent_actions_no_delete
      BEFORE DELETE ON agent_actions
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
  END IF;
END $$;

-- =========================================================================
-- E) agent_memory — agent's source-of-truth memory
-- =========================================================================

CREATE TABLE IF NOT EXISTS agent_memory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope       TEXT NOT NULL,
  scope_id    UUID,
  key         TEXT NOT NULL,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_memory_scope_check'
  ) THEN
    ALTER TABLE agent_memory
      ADD CONSTRAINT agent_memory_scope_check
      CHECK (scope IN ('tenant','recruiter','brief'));
  END IF;
END $$;

-- UNIQUE (tenant, scope, scope_id, key) — scope_id may be NULL (tenant-scope).
-- Postgres treats NULLs as distinct in UNIQUE — gebruik functionele expressie
-- met COALESCE op een sentinel-UUID zodat upserts deterministisch werken.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE tablename = 'agent_memory'
       AND indexname = 'agent_memory_unique_key'
  ) THEN
    CREATE UNIQUE INDEX agent_memory_unique_key
      ON agent_memory (
        tenant_id,
        scope,
        COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
        key
      );
  END IF;
END $$;

ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'agent_memory' AND policyname = 'tenant_isolation_agent_memory'
  ) THEN
    CREATE POLICY tenant_isolation_agent_memory ON agent_memory
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_memory_tenant_scope
  ON agent_memory(tenant_id, scope, scope_id);

-- =========================================================================
-- F) tenant_settings extension — sourcing_auto_close_days
-- =========================================================================
-- We hangen één losse kolom aan tenant_settings als die bestaat. Soft-add via
-- ADD COLUMN IF NOT EXISTS — geen verplichte default-policy, default 7 dagen
-- in de worker (configureerbaar per tenant).

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tenant_settings') THEN
    BEGIN
      ALTER TABLE tenant_settings
        ADD COLUMN IF NOT EXISTS sourcing_auto_close_days INTEGER NOT NULL DEFAULT 7;
    EXCEPTION WHEN OTHERS THEN
      -- Tabel bestaat maar kolomtoevoeging faalde — niet-blocking; worker
      -- valt terug op default 7 als de kolom niet leesbaar is.
      NULL;
    END;
  END IF;
END $$;
