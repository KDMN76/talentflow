-- 018_interview_recordings.sql
-- Sprint Q3.4 — AI Interview Suite (Agent CCC).
--
-- Voegt twee tabellen toe rond `interviews` (Agent BBB / migratie 017):
--   1. interview_recordings        — audio-uploads + Whisper-transcript +
--                                    Claude-samenvatting (privacy-first:
--                                    consent_given is verplicht TRUE bij
--                                    insert via service-laag).
--   2. interview_calendar_events   — link tussen een interview-row en de
--                                    Google Calendar / Outlook Calendar
--                                    event-IDs van de uitgenodigde
--                                    interviewers. Maakt 2-way sync mogelijk
--                                    (lokale wijzigingen → remote update;
--                                    remote cancel → interview-status
--                                    bijwerken).
--
-- Conventies (consistent met 014/016):
--   - Idempotent (IF NOT EXISTS / DO $$ guards op constraints / RLS / index).
--   - RLS via current_setting('app.tenant_id', true)::uuid.
--   - Snake_case kolommen, UUID PK met gen_random_uuid().

-- =========================================================================
-- A) INTERVIEW_RECORDINGS — audio-uploads + transcript + AI-samenvatting
-- =========================================================================

CREATE TABLE IF NOT EXISTS interview_recordings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  interview_id          UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  filename              TEXT NOT NULL,
  storage_key           TEXT NOT NULL,
  mime_type             TEXT,
  duration_seconds      INTEGER,
  size_bytes            BIGINT,
  -- Transcriptie (Whisper)
  transcript_text       TEXT,
  transcript_language   TEXT,
  transcription_status  TEXT NOT NULL DEFAULT 'pending',
  transcription_error   TEXT,
  -- AI samenvatting (Claude)
  ai_summary            TEXT,
  ai_strengths          TEXT[],
  ai_concerns           TEXT[],
  ai_recommendation     TEXT,
  ai_status             TEXT DEFAULT 'pending',
  -- Privacy / GDPR
  consent_given         BOOLEAN NOT NULL DEFAULT FALSE,
  consent_at            TIMESTAMPTZ,
  uploaded_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  transcribed_at        TIMESTAMPTZ,
  ai_processed_at       TIMESTAMPTZ
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'interview_recordings_transcription_status_check'
  ) THEN
    ALTER TABLE interview_recordings
      ADD CONSTRAINT interview_recordings_transcription_status_check
      CHECK (transcription_status IN ('pending','processing','done','failed','skipped'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'interview_recordings_ai_status_check'
  ) THEN
    ALTER TABLE interview_recordings
      ADD CONSTRAINT interview_recordings_ai_status_check
      CHECK (ai_status IN ('pending','processing','done','failed','skipped'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'interview_recordings_recommendation_check'
  ) THEN
    ALTER TABLE interview_recordings
      ADD CONSTRAINT interview_recordings_recommendation_check
      CHECK (
        ai_recommendation IS NULL
        OR ai_recommendation IN ('strong_yes','yes','neutral','no','strong_no')
      );
  END IF;
END $$;

ALTER TABLE interview_recordings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'interview_recordings'
      AND policyname = 'tenant_isolation_interview_recordings'
  ) THEN
    CREATE POLICY tenant_isolation_interview_recordings ON interview_recordings
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_interview_recordings_tenant_interview
  ON interview_recordings(tenant_id, interview_id);

-- Worker pollt op pending rows; index versnelt de "wat moet getranscribeerd worden"-query.
CREATE INDEX IF NOT EXISTS idx_interview_recordings_transcription_status
  ON interview_recordings(transcription_status)
  WHERE transcription_status IN ('pending','processing');

CREATE INDEX IF NOT EXISTS idx_interview_recordings_uploaded_at
  ON interview_recordings(tenant_id, uploaded_at DESC);

-- =========================================================================
-- B) INTERVIEW_CALENDAR_EVENTS — link tussen interview-row en remote event
-- =========================================================================
--
-- Per (interview, interviewer, provider) één rij. Service-laag bouwt deze
-- bij `createCalendarEventForInterview` en gebruikt het `external_event_id`
-- bij update/delete. `last_synced_at` wordt gerefreshed door de polling
-- worker (incoming changes) en bij outgoing updates.

CREATE TABLE IF NOT EXISTS interview_calendar_events (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  interview_id             UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mailbox_integration_id   UUID REFERENCES mailbox_integrations(id) ON DELETE SET NULL,
  provider                 TEXT NOT NULL,
  external_event_id        TEXT NOT NULL,
  external_calendar_id     TEXT,
  last_synced_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  status                   TEXT NOT NULL DEFAULT 'synced',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'interview_calendar_events_provider_check'
  ) THEN
    ALTER TABLE interview_calendar_events
      ADD CONSTRAINT interview_calendar_events_provider_check
      CHECK (provider IN ('google','outlook'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'interview_calendar_events_status_check'
  ) THEN
    ALTER TABLE interview_calendar_events
      ADD CONSTRAINT interview_calendar_events_status_check
      CHECK (status IN ('synced','out_of_sync','deleted'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'interview_calendar_events_unique_per_user_provider'
  ) THEN
    ALTER TABLE interview_calendar_events
      ADD CONSTRAINT interview_calendar_events_unique_per_user_provider
      UNIQUE (interview_id, user_id, provider);
  END IF;
END $$;

ALTER TABLE interview_calendar_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'interview_calendar_events'
      AND policyname = 'tenant_isolation_interview_calendar_events'
  ) THEN
    CREATE POLICY tenant_isolation_interview_calendar_events ON interview_calendar_events
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_interview_calendar_events_tenant_interview
  ON interview_calendar_events(tenant_id, interview_id);

CREATE INDEX IF NOT EXISTS idx_interview_calendar_events_integration
  ON interview_calendar_events(mailbox_integration_id, status)
  WHERE mailbox_integration_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_interview_calendar_events_external_id
  ON interview_calendar_events(provider, external_event_id);
