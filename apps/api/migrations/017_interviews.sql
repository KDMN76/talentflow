-- 017_interviews.sql
-- Sprint Q3.4 — AI Interview Suite (backend module).
--
-- Vier tabellen voor interview-scheduling, structured kits, interviewer-
-- availability en participant-tracking:
--   1) interview_kits             — herbruikbare question-sets per job/role
--   2) interviews                 — geplande interviews per applicatie
--   3) interview_participants     — interviewers + observer + candidate
--   4) interviewer_availability   — recurring working hours + date overrides
--
-- Conventies (gelijk aan 009_ats_completion.sql / 016_talent_fit_model.sql):
--   - Idempotent: CREATE TABLE IF NOT EXISTS, DO-block guards voor constraints
--     en policies, IF NOT EXISTS voor indexen.
--   - RLS via current_setting('app.tenant_id', true)::uuid.
--   - snake_case kolommen, TIMESTAMPTZ voor alle tijdvelden.
--   - FK ON DELETE-gedrag: applicatie/tenant cascade, stage/users SET NULL
--     waar de interview-row historisch waardevol blijft.

-- =========================================================================
-- 1) INTERVIEW_KITS — gestructureerde question-sets per job/role
-- =========================================================================
--
-- questions JSONB shape:
--   [{ id, text, category, suggested_followups?, evaluation_criteria?,
--      expected_duration_minutes? }]
--
-- job_id is nullable: NULL = global (tenant-wide) kit. Wanneer job_id gezet
-- is en de job verdwijnt, cascaden we de kit ook (kit hoort bij die job).
-- scorecard_template_id koppelt het kit aan een vooraf gedefinieerd
-- scorecard-criteria-set zodat interviewers structureel kunnen scoren.

CREATE TABLE IF NOT EXISTS interview_kits (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                        TEXT NOT NULL,
  description                 TEXT,
  job_id                      UUID REFERENCES jobs(id) ON DELETE CASCADE,
  questions                   JSONB NOT NULL DEFAULT '[]'::jsonb,
  scorecard_template_id       UUID REFERENCES scorecard_templates(id) ON DELETE SET NULL,
  estimated_duration_minutes  INTEGER NOT NULL DEFAULT 60,
  is_default                  BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at                  TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'interview_kits_duration_check'
  ) THEN
    ALTER TABLE interview_kits
      ADD CONSTRAINT interview_kits_duration_check
      CHECK (estimated_duration_minutes >= 5 AND estimated_duration_minutes <= 480);
  END IF;
END $$;

ALTER TABLE interview_kits ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'interview_kits'
      AND policyname = 'tenant_isolation_interview_kits'
  ) THEN
    CREATE POLICY tenant_isolation_interview_kits ON interview_kits
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_interview_kits_tenant_job
  ON interview_kits(tenant_id, job_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_interview_kits_tenant_default
  ON interview_kits(tenant_id, is_default) WHERE deleted_at IS NULL;

-- =========================================================================
-- 2) INTERVIEWS — geplande interview-sessions
-- =========================================================================
--
-- duration_minutes is GENERATED uit start/end zodat we nooit drift hebben.
-- meeting_provider check houdt enum strikt zonder extra ENUM-type
-- (consistency met `applications.stage` style elders).

CREATE TABLE IF NOT EXISTS interviews (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  application_id      UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  stage_id            UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  scheduled_start     TIMESTAMPTZ NOT NULL,
  scheduled_end       TIMESTAMPTZ NOT NULL,
  duration_minutes    INTEGER GENERATED ALWAYS AS
                        ((EXTRACT(EPOCH FROM (scheduled_end - scheduled_start)) / 60)::int) STORED,
  meeting_url         TEXT,
  meeting_provider    TEXT,
  location            TEXT,
  interview_kit_id    UUID REFERENCES interview_kits(id) ON DELETE SET NULL,
  notes               TEXT,
  status              TEXT NOT NULL DEFAULT 'scheduled',
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at        TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'interviews_status_check'
  ) THEN
    ALTER TABLE interviews
      ADD CONSTRAINT interviews_status_check
      CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show', 'rescheduled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'interviews_provider_check'
  ) THEN
    ALTER TABLE interviews
      ADD CONSTRAINT interviews_provider_check
      CHECK (
        meeting_provider IS NULL
        OR meeting_provider IN ('google_meet', 'teams', 'zoom', 'in_person', 'phone')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'interviews_time_order_check'
  ) THEN
    ALTER TABLE interviews
      ADD CONSTRAINT interviews_time_order_check
      CHECK (scheduled_end > scheduled_start);
  END IF;
END $$;

ALTER TABLE interviews ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'interviews'
      AND policyname = 'tenant_isolation_interviews'
  ) THEN
    CREATE POLICY tenant_isolation_interviews ON interviews
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_interviews_tenant_start
  ON interviews(tenant_id, scheduled_start);

CREATE INDEX IF NOT EXISTS idx_interviews_application
  ON interviews(application_id);

CREATE INDEX IF NOT EXISTS idx_interviews_status
  ON interviews(tenant_id, status);

-- =========================================================================
-- 3) INTERVIEW_PARTICIPANTS — interviewers + observers + candidate
-- =========================================================================
--
-- participant_type splitst de drie rollen. user_id is NULL voor candidate;
-- candidate_id is NULL voor interviewers/observers. attended logged
-- separately zodat no-show statistieken per rol mogelijk zijn.

CREATE TABLE IF NOT EXISTS interview_participants (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  interview_id          UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  participant_type      TEXT NOT NULL,
  user_id               UUID REFERENCES users(id) ON DELETE SET NULL,
  candidate_id          UUID REFERENCES candidates(id) ON DELETE SET NULL,
  email                 TEXT NOT NULL,
  attended              BOOLEAN,
  attendance_logged_at  TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'interview_participants_type_check'
  ) THEN
    ALTER TABLE interview_participants
      ADD CONSTRAINT interview_participants_type_check
      CHECK (participant_type IN ('candidate', 'interviewer', 'observer'));
  END IF;

  -- Een participant moet een user_id of een candidate_id hebben (XOR-ish
  -- via type): candidate-rij heeft candidate_id, interviewer/observer
  -- heeft user_id. Beide NULL = ongeldig.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'interview_participants_identity_check'
  ) THEN
    ALTER TABLE interview_participants
      ADD CONSTRAINT interview_participants_identity_check
      CHECK (
        (participant_type = 'candidate' AND candidate_id IS NOT NULL)
        OR (participant_type IN ('interviewer', 'observer') AND user_id IS NOT NULL)
      );
  END IF;
END $$;

ALTER TABLE interview_participants ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'interview_participants'
      AND policyname = 'tenant_isolation_interview_participants'
  ) THEN
    CREATE POLICY tenant_isolation_interview_participants ON interview_participants
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_interview_participants_interview
  ON interview_participants(interview_id);

CREATE INDEX IF NOT EXISTS idx_interview_participants_user
  ON interview_participants(tenant_id, user_id) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_interview_participants_candidate
  ON interview_participants(tenant_id, candidate_id) WHERE candidate_id IS NOT NULL;

-- =========================================================================
-- 4) INTERVIEWER_AVAILABILITY — recurring hours + date overrides
-- =========================================================================
--
-- Eén tabel doet dubbel werk:
--   - Recurring rij: weekday/start_time/end_time gezet, date_override NULL.
--   - Override rij: date_override gezet, blocked TRUE/FALSE; weekday/times
--     mogen NULL zijn (volle-dag-blok) of gezet (partial override).
--
-- Een CHECK forceert dat tenminste één van beide modi compleet is.

CREATE TABLE IF NOT EXISTS interviewer_availability (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday         INTEGER,
  start_time      TIME,
  end_time        TIME,
  date_override   DATE,
  blocked         BOOLEAN NOT NULL DEFAULT FALSE,
  reason          TEXT,
  timezone        TEXT NOT NULL DEFAULT 'Europe/Amsterdam',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'interviewer_availability_weekday_check'
  ) THEN
    ALTER TABLE interviewer_availability
      ADD CONSTRAINT interviewer_availability_weekday_check
      CHECK (weekday IS NULL OR (weekday BETWEEN 0 AND 6));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'interviewer_availability_mode_check'
  ) THEN
    ALTER TABLE interviewer_availability
      ADD CONSTRAINT interviewer_availability_mode_check
      CHECK (
        -- recurring: weekday + times moeten gezet zijn
        (date_override IS NULL AND weekday IS NOT NULL
          AND start_time IS NOT NULL AND end_time IS NOT NULL
          AND end_time > start_time)
        OR
        -- override: date_override gezet
        (date_override IS NOT NULL)
      );
  END IF;
END $$;

ALTER TABLE interviewer_availability ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'interviewer_availability'
      AND policyname = 'tenant_isolation_interviewer_availability'
  ) THEN
    CREATE POLICY tenant_isolation_interviewer_availability ON interviewer_availability
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_interviewer_availability_tenant_user
  ON interviewer_availability(tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_interviewer_availability_date_override
  ON interviewer_availability(tenant_id, user_id, date_override)
  WHERE date_override IS NOT NULL;
