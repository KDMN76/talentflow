-- 032_omni_channel_inbox.sql
-- Sprint Q4.6 — WhatsApp Business + omni-channel inbox (Agent AAAA).
--
-- Tables introduced:
--   - voice_integrations           : per-tenant Twilio VoIP integration
--   - voice_calls                  : inbound + outbound call log
--   - unified_threads              : one thread per candidate across all channels
--
-- Adds new columns to `communications` so every channel-writer
-- (email worker, WhatsApp writer, voice writer, LinkedIn outreach) can
-- contribute to a unified per-candidate inbox view.
--
-- All idempotent. RLS via `current_setting('app.tenant_id')`. KDMN-style
-- DO $$ guards on policies and constraints.

-- =========================================================================
-- A) voice_integrations — per-tenant Twilio integration (singleton per tenant)
-- =========================================================================

CREATE TABLE IF NOT EXISTS voice_integrations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider                 TEXT NOT NULL DEFAULT 'twilio',
  status                   TEXT NOT NULL DEFAULT 'disconnected',
  account_sid              TEXT,
  auth_token_encrypted     BYTEA,
  phone_number             TEXT,
  webhook_secret_encrypted BYTEA,
  connected_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  connected_at             TIMESTAMPTZ,
  last_error               TEXT,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'voice_integrations_provider_check'
  ) THEN
    ALTER TABLE voice_integrations
      ADD CONSTRAINT voice_integrations_provider_check
      CHECK (provider IN ('twilio'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'voice_integrations_status_check'
  ) THEN
    ALTER TABLE voice_integrations
      ADD CONSTRAINT voice_integrations_status_check
      CHECK (status IN ('connected','disconnected','error'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'voice_integrations_tenant_unique'
  ) THEN
    ALTER TABLE voice_integrations
      ADD CONSTRAINT voice_integrations_tenant_unique
      UNIQUE (tenant_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_voice_integrations_tenant
  ON voice_integrations (tenant_id);

ALTER TABLE voice_integrations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'voice_integrations' AND policyname = 'tenant_isolation_voice_integrations'
  ) THEN
    CREATE POLICY tenant_isolation_voice_integrations ON voice_integrations
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- B) voice_calls — inbound + outbound call records
-- =========================================================================

CREATE TABLE IF NOT EXISTS voice_calls (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_id              UUID REFERENCES voice_integrations(id) ON DELETE SET NULL,
  candidate_id                UUID REFERENCES candidates(id) ON DELETE SET NULL,
  direction                   TEXT NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'queued',
  from_number                 TEXT,
  to_number                   TEXT,
  external_sid                TEXT,
  duration_seconds            INTEGER NOT NULL DEFAULT 0,
  recording_url               TEXT,
  recording_duration_seconds  INTEGER,
  transcription_text          TEXT,
  transcription_status        TEXT,
  voicemail                   BOOLEAN NOT NULL DEFAULT FALSE,
  notes                       TEXT,
  initiated_by                UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at                  TIMESTAMPTZ,
  answered_at                 TIMESTAMPTZ,
  ended_at                    TIMESTAMPTZ,
  communication_id            UUID,
  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'voice_calls_direction_check'
  ) THEN
    ALTER TABLE voice_calls
      ADD CONSTRAINT voice_calls_direction_check
      CHECK (direction IN ('inbound','outbound'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'voice_calls_status_check'
  ) THEN
    ALTER TABLE voice_calls
      ADD CONSTRAINT voice_calls_status_check
      CHECK (status IN (
        'queued','ringing','in_progress','completed',
        'busy','no_answer','failed','canceled','voicemail'
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'voice_calls_transcription_status_check'
  ) THEN
    ALTER TABLE voice_calls
      ADD CONSTRAINT voice_calls_transcription_status_check
      CHECK (transcription_status IS NULL OR transcription_status IN ('pending','done','failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_voice_calls_tenant_created
  ON voice_calls (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_voice_calls_tenant_candidate
  ON voice_calls (tenant_id, candidate_id);
CREATE INDEX IF NOT EXISTS idx_voice_calls_tenant_status
  ON voice_calls (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_voice_calls_tenant_external_sid
  ON voice_calls (tenant_id, external_sid);

ALTER TABLE voice_calls ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'voice_calls' AND policyname = 'tenant_isolation_voice_calls'
  ) THEN
    CREATE POLICY tenant_isolation_voice_calls ON voice_calls
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- C) communications — extend with omni-channel inbox fields
-- =========================================================================
-- The base table is created in 004_email_templates.sql (defensive CREATE
-- TABLE IF NOT EXISTS). Here we extend it with thread + UX columns. All
-- ADD COLUMN clauses are idempotent.

ALTER TABLE communications ADD COLUMN IF NOT EXISTS unified_thread_id   UUID;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS unread_for_user_ids UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE communications ADD COLUMN IF NOT EXISTS pinned              BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS archived_at         TIMESTAMPTZ;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS preview             TEXT;

CREATE INDEX IF NOT EXISTS idx_communications_unified_thread
  ON communications (tenant_id, unified_thread_id);
CREATE INDEX IF NOT EXISTS idx_communications_candidate_recent
  ON communications (tenant_id, candidate_id, created_at DESC);

-- =========================================================================
-- D) unified_threads — one per candidate (across ALL channels)
-- =========================================================================

CREATE TABLE IF NOT EXISTS unified_threads (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id                 UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  last_message_at              TIMESTAMPTZ,
  last_channel                 TEXT,
  last_message_preview         TEXT,
  unread_count_for_assignee    INTEGER NOT NULL DEFAULT 0,
  assignee_user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  pinned                       BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at                  TIMESTAMPTZ,
  labels                       JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata                     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unified_threads_tenant_candidate_unique'
  ) THEN
    ALTER TABLE unified_threads
      ADD CONSTRAINT unified_threads_tenant_candidate_unique
      UNIQUE (tenant_id, candidate_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_unified_threads_tenant_last_message
  ON unified_threads (tenant_id, last_message_at DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS idx_unified_threads_tenant_assignee
  ON unified_threads (tenant_id, assignee_user_id);
CREATE INDEX IF NOT EXISTS idx_unified_threads_tenant_pinned
  ON unified_threads (tenant_id, pinned)
  WHERE pinned = TRUE;
CREATE INDEX IF NOT EXISTS idx_unified_threads_tenant_archived
  ON unified_threads (tenant_id, archived_at);

ALTER TABLE unified_threads ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'unified_threads' AND policyname = 'tenant_isolation_unified_threads'
  ) THEN
    CREATE POLICY tenant_isolation_unified_threads ON unified_threads
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
