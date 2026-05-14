-- 004_email_templates.sql
-- Email-templates, email-threads en uitbreiding van communications voor
-- threading + reply-detection via Resend (plus-addressing).
-- Volgt KDMN-conventie: idempotent (IF NOT EXISTS / DO $$ guards),
-- snake_case, UUID PKs, RLS-stijl uit 001_init.sql.

-- =========================================================================
-- 1) EMAIL_TEMPLATES — herbruikbare e-mailtemplates per tenant
-- =========================================================================

CREATE TABLE IF NOT EXISTS email_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body_html       TEXT NOT NULL,
  body_text       TEXT,
  merge_variables TEXT[] DEFAULT '{}',
  category        TEXT,
  created_by      UUID REFERENCES users(id),
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Defensieve ADD COLUMNs voor het geval de tabel ooit zonder is aangemaakt.
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS body_text       TEXT;
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS merge_variables TEXT[] DEFAULT '{}';
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS category        TEXT;
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS created_by      UUID REFERENCES users(id);
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ;
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ DEFAULT now();

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'email_templates'
      AND policyname = 'tenant_isolation_email_templates'
  ) THEN
    CREATE POLICY tenant_isolation_email_templates ON email_templates
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_templates_tenant_category
  ON email_templates(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_email_templates_tenant_active
  ON email_templates(tenant_id) WHERE deleted_at IS NULL;

-- =========================================================================
-- 2) EMAIL_THREADS — gegroepeerde conversaties per kandidaat
-- =========================================================================

CREATE TABLE IF NOT EXISTS email_threads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id    UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  subject         TEXT,
  last_message_at TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE email_threads ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'email_threads'
      AND policyname = 'tenant_isolation_email_threads'
  ) THEN
    CREATE POLICY tenant_isolation_email_threads ON email_threads
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_threads_candidate
  ON email_threads(candidate_id);
CREATE INDEX IF NOT EXISTS idx_email_threads_tenant_last_message
  ON email_threads(tenant_id, last_message_at DESC);

-- =========================================================================
-- 3) COMMUNICATIONS — uitbreiden voor email-threading + reply-detection
-- =========================================================================
-- De communications-tabel wordt momenteel impliciet aangemaakt door eerdere
-- runtime-flows. We voegen kolommen idempotent toe en zorgen dat indexen
-- aangemaakt worden zodra de tabel bestaat.

-- Defensief: maak de tabel aan als die nog niet bestaat.
CREATE TABLE IF NOT EXISTS communications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL,
  direction    TEXT NOT NULL,
  subject      TEXT,
  body         TEXT,
  status       TEXT NOT NULL DEFAULT 'sent',
  sent_at      TIMESTAMPTZ DEFAULT now(),
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE communications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'communications'
      AND policyname = 'tenant_isolation_communications'
  ) THEN
    CREATE POLICY tenant_isolation_communications ON communications
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- Threading + reply-detection kolommen.
ALTER TABLE communications ADD COLUMN IF NOT EXISTS message_id    TEXT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS in_reply_to   TEXT;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS thread_id     UUID
  REFERENCES email_threads(id) ON DELETE SET NULL;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS template_id   UUID
  REFERENCES email_templates(id) ON DELETE SET NULL;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Indexen voor threading + provider-lookup.
CREATE INDEX IF NOT EXISTS idx_communications_thread
  ON communications(thread_id);
CREATE INDEX IF NOT EXISTS idx_communications_tenant_message_id
  ON communications(tenant_id, message_id);
CREATE INDEX IF NOT EXISTS idx_communications_tenant_candidate
  ON communications(tenant_id, candidate_id);
CREATE INDEX IF NOT EXISTS idx_communications_in_reply_to
  ON communications(in_reply_to);
