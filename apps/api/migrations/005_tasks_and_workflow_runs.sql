-- 005_tasks_and_workflow_runs.sql
-- Tasks-tabel + workflows + workflow_runs (defensief: workflows en
-- workflow_runs bestaan nog niet in 001-003, dus hier idempotent aanmaken).
-- Volgt KDMN-conventie: idempotent (IF NOT EXISTS / DO $$ guards),
-- snake_case, RLS-stijl uit 001_init.sql.

-- =========================================================================
-- 1) WORKFLOWS — automatiseringsregels (trigger + conditions + actions)
-- =========================================================================
-- workflows.service.ts referenceert deze tabel maar er is geen migration die
-- 'm aanmaakt. Defensief hier neergezet zodat een verse DB werkt.

CREATE TABLE IF NOT EXISTS workflows (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  trigger      TEXT NOT NULL,
  conditions   JSONB DEFAULT '[]',
  actions      JSONB DEFAULT '[]',
  active       BOOLEAN DEFAULT TRUE,
  run_count    INTEGER DEFAULT 0,
  last_run_at  TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'workflows' AND policyname = 'tenant_isolation_workflows'
  ) THEN
    CREATE POLICY tenant_isolation_workflows ON workflows
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workflows_tenant_trigger
  ON workflows(tenant_id, trigger)
  WHERE deleted_at IS NULL AND active = TRUE;

-- =========================================================================
-- 2) WORKFLOW_RUNS — execution log per workflow trigger
-- =========================================================================

CREATE TABLE IF NOT EXISTS workflow_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id   UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  trigger_event TEXT NOT NULL,
  entity_id     UUID,
  status        TEXT NOT NULL DEFAULT 'success',
  error         TEXT,
  ran_at        TIMESTAMPTZ DEFAULT now()
);

-- Defensieve CHECK voor status (idempotent).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workflow_runs_status_check'
  ) THEN
    ALTER TABLE workflow_runs
      ADD CONSTRAINT workflow_runs_status_check
      CHECK (status IN ('success', 'failed', 'skipped'));
  END IF;
END $$;

ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'workflow_runs' AND policyname = 'tenant_isolation_workflow_runs'
  ) THEN
    CREATE POLICY tenant_isolation_workflow_runs ON workflow_runs
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow
  ON workflow_runs(workflow_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_tenant_event
  ON workflow_runs(tenant_id, trigger_event, ran_at DESC);

-- =========================================================================
-- 3) TASKS — taken / reminders, kan gekoppeld zijn aan candidate of job
-- =========================================================================

CREATE TABLE IF NOT EXISTS tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  assignee_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  candidate_id UUID REFERENCES candidates(id) ON DELETE SET NULL,
  job_id       UUID REFERENCES jobs(id) ON DELETE SET NULL,
  due_date     TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'open',
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Defensieve CHECK voor status (idempotent — DO-block zodat re-runs niet falen).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_status_check'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_status_check
      CHECK (status IN ('open', 'done', 'cancelled'));
  END IF;
END $$;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'tasks' AND policyname = 'tenant_isolation_tasks'
  ) THEN
    CREATE POLICY tenant_isolation_tasks ON tasks
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status
  ON tasks(tenant_id, assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_candidate
  ON tasks(candidate_id) WHERE candidate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_job
  ON tasks(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_due_date
  ON tasks(tenant_id, due_date) WHERE status = 'open' AND due_date IS NOT NULL;
