-- 030_outreach_and_nurture.sql
-- Sprint Q4.5 — Agentic AI Sourcing (Agent XXX).
--
-- Outreach orchestration: AI-drafted LinkedIn/email outreach, multi-channel
-- nurture sequences, reply classification, passive job-change monitoring.
--
-- Tables:
--   - nurture_sequences          : reusable recruiter-defined sequences
--   - nurture_steps              : ordered steps within a sequence
--   - nurture_enrollments        : per-candidate enrollment in a sequence
--   - outreach_messages          : individual outbound/inbound messages
--   - reply_classifications      : AI classification of inbound replies
--   - candidate_signals          : passive monitoring signals (job-change etc.)
--   - outreach_quotas            : per-recruiter daily/weekly send caps
--
-- Coordinates with:
--   - Agent WWW (029_sourcing_agent.sql) — we reference `agent_findings(id)`
--     in `nurture_enrollments.finding_id` (no FK — soft reference because WWW
--     migration may roll out separately).
--
-- Idempotent. KDMN conventions: IF NOT EXISTS, DO $$ guards, RLS via
-- `app.tenant_id` setting, snake_case, `created_at`/`updated_at`.

-- =========================================================================
-- A) nurture_sequences — reusable recruiter-defined sequence templates
-- =========================================================================

CREATE TABLE IF NOT EXISTS nurture_sequences (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  total_steps  INTEGER NOT NULL DEFAULT 0,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nurture_sequences_tenant_active
  ON nurture_sequences (tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_nurture_sequences_tenant_created
  ON nurture_sequences (tenant_id, created_at DESC, id DESC);

ALTER TABLE nurture_sequences ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'nurture_sequences' AND policyname = 'tenant_isolation_nurture_sequences'
  ) THEN
    CREATE POLICY tenant_isolation_nurture_sequences ON nurture_sequences
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- B) nurture_steps — ordered steps within a sequence
-- =========================================================================

CREATE TABLE IF NOT EXISTS nurture_steps (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sequence_id        UUID NOT NULL REFERENCES nurture_sequences(id) ON DELETE CASCADE,
  step_order         INTEGER NOT NULL,
  channel            TEXT NOT NULL,
  delay_days         INTEGER NOT NULL DEFAULT 0,
  ai_personalize     BOOLEAN NOT NULL DEFAULT TRUE,
  template_subject   TEXT,
  template_body      TEXT,
  stop_on_reply      BOOLEAN NOT NULL DEFAULT TRUE,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nurture_steps_channel_check'
  ) THEN
    ALTER TABLE nurture_steps
      ADD CONSTRAINT nurture_steps_channel_check
      CHECK (channel IN ('linkedin_inmail','linkedin_connection','email','sms','whatsapp'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nurture_steps_unique_order'
  ) THEN
    ALTER TABLE nurture_steps
      ADD CONSTRAINT nurture_steps_unique_order
      UNIQUE (tenant_id, sequence_id, step_order);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_nurture_steps_seq
  ON nurture_steps (sequence_id, step_order);

ALTER TABLE nurture_steps ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'nurture_steps' AND policyname = 'tenant_isolation_nurture_steps'
  ) THEN
    CREATE POLICY tenant_isolation_nurture_steps ON nurture_steps
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- C) nurture_enrollments — candidate enrolled in a sequence
-- =========================================================================

CREATE TABLE IF NOT EXISTS nurture_enrollments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id        UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  finding_id          UUID,
  sequence_id         UUID NOT NULL REFERENCES nurture_sequences(id) ON DELETE RESTRICT,
  status              TEXT NOT NULL DEFAULT 'pending_approval',
  current_step_order  INTEGER NOT NULL DEFAULT 0,
  next_send_at        TIMESTAMPTZ,
  enrolled_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  enrolled_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at          TIMESTAMPTZ,
  stopped_reason      TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nurture_enrollments_status_check'
  ) THEN
    ALTER TABLE nurture_enrollments
      ADD CONSTRAINT nurture_enrollments_status_check
      CHECK (status IN ('pending_approval','active','paused','stopped','completed','replied'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nurture_enrollments_unique_candidate_seq'
  ) THEN
    ALTER TABLE nurture_enrollments
      ADD CONSTRAINT nurture_enrollments_unique_candidate_seq
      UNIQUE (tenant_id, candidate_id, sequence_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_nurture_enrollments_tenant_status
  ON nurture_enrollments (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_nurture_enrollments_next_send
  ON nurture_enrollments (tenant_id, next_send_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_nurture_enrollments_candidate
  ON nurture_enrollments (tenant_id, candidate_id);

ALTER TABLE nurture_enrollments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'nurture_enrollments' AND policyname = 'tenant_isolation_nurture_enrollments'
  ) THEN
    CREATE POLICY tenant_isolation_nurture_enrollments ON nurture_enrollments
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- D) outreach_messages — individual outbound/inbound messages
-- =========================================================================

CREATE TABLE IF NOT EXISTS outreach_messages (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  enrollment_id            UUID REFERENCES nurture_enrollments(id) ON DELETE CASCADE,
  step_id                  UUID REFERENCES nurture_steps(id) ON DELETE SET NULL,
  candidate_id             UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  channel                  TEXT NOT NULL,
  direction                TEXT NOT NULL DEFAULT 'outbound',
  status                   TEXT NOT NULL DEFAULT 'drafted',
  subject                  TEXT,
  body_text                TEXT,
  body_html                TEXT,
  ai_model                 TEXT,
  prompt_tokens            INTEGER,
  completion_tokens        INTEGER,
  personalization_signals  JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for            TIMESTAMPTZ,
  sent_at                  TIMESTAMPTZ,
  external_id              TEXT,
  external_thread_id       TEXT,
  approved_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at              TIMESTAMPTZ,
  rejected_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  rejected_at              TIMESTAMPTZ,
  rejection_reason         TEXT,
  reply_message_id         UUID,
  error_message            TEXT,
  retry_count              INTEGER NOT NULL DEFAULT 0,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_messages_channel_check'
  ) THEN
    ALTER TABLE outreach_messages
      ADD CONSTRAINT outreach_messages_channel_check
      CHECK (channel IN ('linkedin_inmail','linkedin_connection','email','sms','whatsapp'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_messages_direction_check'
  ) THEN
    ALTER TABLE outreach_messages
      ADD CONSTRAINT outreach_messages_direction_check
      CHECK (direction IN ('outbound','inbound'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_messages_status_check'
  ) THEN
    ALTER TABLE outreach_messages
      ADD CONSTRAINT outreach_messages_status_check
      CHECK (status IN ('drafted','pending_approval','approved','sending','sent','failed','rejected_by_recruiter'));
  END IF;
END $$;

-- Append-only enforcement: once `sent_at` is set we forbid changes to
-- `sent_at`, `body_text`, `body_html`, `subject`. Compliance/audit reasons.
CREATE OR REPLACE FUNCTION outreach_messages_append_only()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.sent_at IS NOT NULL THEN
    IF NEW.sent_at IS DISTINCT FROM OLD.sent_at
       OR NEW.body_text IS DISTINCT FROM OLD.body_text
       OR NEW.body_html IS DISTINCT FROM OLD.body_html
       OR NEW.subject   IS DISTINCT FROM OLD.subject THEN
      RAISE EXCEPTION 'outreach_messages: append-only after sent_at is set'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'outreach_messages_append_only_tg'
  ) THEN
    CREATE TRIGGER outreach_messages_append_only_tg
      BEFORE UPDATE ON outreach_messages
      FOR EACH ROW
      EXECUTE FUNCTION outreach_messages_append_only();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_outreach_messages_tenant_status
  ON outreach_messages (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_tenant_candidate
  ON outreach_messages (tenant_id, candidate_id);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_enrollment
  ON outreach_messages (enrollment_id);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_thread
  ON outreach_messages (tenant_id, external_thread_id);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_tenant_created
  ON outreach_messages (tenant_id, created_at DESC, id DESC);

ALTER TABLE outreach_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'outreach_messages' AND policyname = 'tenant_isolation_outreach_messages'
  ) THEN
    CREATE POLICY tenant_isolation_outreach_messages ON outreach_messages
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- E) reply_classifications — AI classification of inbound replies
-- =========================================================================

CREATE TABLE IF NOT EXISTS reply_classifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id      UUID NOT NULL REFERENCES outreach_messages(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,
  sentiment       TEXT NOT NULL,
  next_action     TEXT NOT NULL,
  reasoning       TEXT,
  confidence      NUMERIC(4,3),
  ai_model        TEXT,
  classified_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reply_classifications_category_check'
  ) THEN
    ALTER TABLE reply_classifications
      ADD CONSTRAINT reply_classifications_category_check
      CHECK (category IN ('interested','not_now','not_interested','out_of_office','unsubscribe','spam','question','unknown'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reply_classifications_sentiment_check'
  ) THEN
    ALTER TABLE reply_classifications
      ADD CONSTRAINT reply_classifications_sentiment_check
      CHECK (sentiment IN ('positive','neutral','negative','mixed'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reply_classifications_next_action_check'
  ) THEN
    ALTER TABLE reply_classifications
      ADD CONSTRAINT reply_classifications_next_action_check
      CHECK (next_action IN ('schedule_call','send_followup','pause_sequence','remove_from_outreach','manual_review'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reply_classifications_confidence_check'
  ) THEN
    ALTER TABLE reply_classifications
      ADD CONSTRAINT reply_classifications_confidence_check
      CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reply_classifications_tenant_category
  ON reply_classifications (tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_reply_classifications_message
  ON reply_classifications (message_id);

ALTER TABLE reply_classifications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'reply_classifications' AND policyname = 'tenant_isolation_reply_classifications'
  ) THEN
    CREATE POLICY tenant_isolation_reply_classifications ON reply_classifications
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- F) candidate_signals — passive monitoring of existing candidates
-- =========================================================================

CREATE TABLE IF NOT EXISTS candidate_signals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id        UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  signal_type         TEXT NOT NULL,
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  source              TEXT,
  before_value        TEXT,
  after_value         TEXT,
  raw_payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed            BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,
  triggered_action    TEXT
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'candidate_signals_type_check'
  ) THEN
    ALTER TABLE candidate_signals
      ADD CONSTRAINT candidate_signals_type_check
      CHECK (signal_type IN ('job_change','title_change','company_growth','funding_round','linkedin_post','open_to_work_flag'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_candidate_signals_tenant_type
  ON candidate_signals (tenant_id, signal_type);
CREATE INDEX IF NOT EXISTS idx_candidate_signals_tenant_unreviewed
  ON candidate_signals (tenant_id, reviewed, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_candidate_signals_candidate
  ON candidate_signals (tenant_id, candidate_id);

ALTER TABLE candidate_signals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'candidate_signals' AND policyname = 'tenant_isolation_candidate_signals'
  ) THEN
    CREATE POLICY tenant_isolation_candidate_signals ON candidate_signals
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- G) outreach_quotas — anti-spam guard, per-recruiter daily/weekly caps
-- =========================================================================

CREATE TABLE IF NOT EXISTS outreach_quotas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recruiter_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel             TEXT NOT NULL,
  daily_limit         INTEGER NOT NULL DEFAULT 100,
  weekly_limit        INTEGER NOT NULL DEFAULT 500,
  current_day_count   INTEGER NOT NULL DEFAULT 0,
  current_week_count  INTEGER NOT NULL DEFAULT 0,
  reset_day_at        DATE,
  reset_week_at       DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_quotas_channel_check'
  ) THEN
    ALTER TABLE outreach_quotas
      ADD CONSTRAINT outreach_quotas_channel_check
      CHECK (channel IN ('linkedin_inmail','linkedin_connection','email','sms','whatsapp'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_quotas_unique'
  ) THEN
    ALTER TABLE outreach_quotas
      ADD CONSTRAINT outreach_quotas_unique
      UNIQUE (tenant_id, recruiter_id, channel);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_outreach_quotas_tenant_recruiter
  ON outreach_quotas (tenant_id, recruiter_id);

ALTER TABLE outreach_quotas ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'outreach_quotas' AND policyname = 'tenant_isolation_outreach_quotas'
  ) THEN
    CREATE POLICY tenant_isolation_outreach_quotas ON outreach_quotas
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
