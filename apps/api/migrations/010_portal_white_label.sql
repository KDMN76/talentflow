-- 010_portal_white_label.sql
-- Sprint Q2.1 — Klantportaal white-label + custom domains + notifications.
--
-- Voegt vier dingen toe:
--   1) `guest_portal_links` baseline (was alleen in code, niet in migrations)
--      + uitbreidingen voor custom-domain, branding, notification-config
--   2) `guest_portal_feedback` baseline (was alleen in code)
--   3) `portal_activity_log`        — recruiter-facing UI log van klantgedrag
--   4) `tenant_branding`            — per tenant white-label config
--   5) `pending_portal_notifications` — batch-queue voor daily/weekly mailings
--
-- Backwards-compat: bestaande service code refereert `guest_portal_links`
-- en `guest_portal_feedback`. Wij houden die naam aan; de spec noemt
-- `portal_links` maar dat is een naam-conflict — we zetten het via een
-- `portal_links` view OOK beschikbaar zodat nieuwe code beide kant op werkt.
--
-- Alle DDL is idempotent (IF NOT EXISTS / DO-block guards) zodat
-- her-runs in dev geen errors gooien.

-- =========================================================================
-- 0) BASELINE — guest_portal_links + guest_portal_feedback
--    (waren tot nu toe alleen in TS-service; we maken ze nu officieel)
-- =========================================================================

CREATE TABLE IF NOT EXISTS guest_portal_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  token           TEXT NOT NULL UNIQUE,
  client_name     TEXT,
  permissions     JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at      TIMESTAMPTZ,
  view_count      INTEGER NOT NULL DEFAULT 0,
  last_viewed_at  TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE guest_portal_links ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'guest_portal_links'
      AND policyname = 'tenant_isolation_guest_portal_links'
  ) THEN
    CREATE POLICY tenant_isolation_guest_portal_links ON guest_portal_links
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_guest_portal_links_tenant_job
  ON guest_portal_links(tenant_id, job_id);
CREATE INDEX IF NOT EXISTS idx_guest_portal_links_token
  ON guest_portal_links(token)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS guest_portal_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  portal_link_id  UUID NOT NULL REFERENCES guest_portal_links(id) ON DELETE CASCADE,
  application_id  UUID NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('approved','rejected','commented')),
  comment         TEXT,
  client_name     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE guest_portal_feedback ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'guest_portal_feedback'
      AND policyname = 'tenant_isolation_guest_portal_feedback'
  ) THEN
    CREATE POLICY tenant_isolation_guest_portal_feedback ON guest_portal_feedback
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_guest_portal_feedback_tenant_link
  ON guest_portal_feedback(tenant_id, portal_link_id, created_at DESC);

-- =========================================================================
-- 1) GUEST_PORTAL_LINKS — Q2.1 uitbreidingen
-- =========================================================================

ALTER TABLE guest_portal_links
  ADD COLUMN IF NOT EXISTS custom_domain TEXT;

-- Custom domain moet uniek zijn over alle tenants (Caddy resolveert
-- één domein → één portal). Idempotente UNIQUE INDEX op het non-null subset.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_guest_portal_links_custom_domain'
  ) THEN
    CREATE UNIQUE INDEX uq_guest_portal_links_custom_domain
      ON guest_portal_links(custom_domain)
      WHERE custom_domain IS NOT NULL AND deleted_at IS NULL;
  END IF;
END $$;

ALTER TABLE guest_portal_links
  ADD COLUMN IF NOT EXISTS custom_domain_verified_at TIMESTAMPTZ;

ALTER TABLE guest_portal_links
  ADD COLUMN IF NOT EXISTS branding JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE guest_portal_links
  ADD COLUMN IF NOT EXISTS notify_email TEXT;

ALTER TABLE guest_portal_links
  ADD COLUMN IF NOT EXISTS notification_frequency TEXT NOT NULL DEFAULT 'realtime';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'guest_portal_links_notification_frequency_check'
  ) THEN
    ALTER TABLE guest_portal_links
      ADD CONSTRAINT guest_portal_links_notification_frequency_check
      CHECK (notification_frequency IN ('realtime','daily','weekly','off'));
  END IF;
END $$;

ALTER TABLE guest_portal_links
  ADD COLUMN IF NOT EXISTS last_notification_at TIMESTAMPTZ;

-- Indexes voor de notification-cron worker.
CREATE INDEX IF NOT EXISTS idx_guest_portal_links_notify_freq
  ON guest_portal_links(notification_frequency)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_guest_portal_links_custom_domain_verified
  ON guest_portal_links(custom_domain)
  WHERE custom_domain IS NOT NULL
    AND custom_domain_verified_at IS NOT NULL
    AND deleted_at IS NULL;

-- Convenience view zodat nieuwe code naar `portal_links` mag schrijven
-- als alias voor `guest_portal_links`. View is updatable omdat we 1:1 mappen.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_views WHERE viewname = 'portal_links'
  ) THEN
    EXECUTE 'CREATE VIEW portal_links AS SELECT * FROM guest_portal_links';
  END IF;
END $$;

-- =========================================================================
-- 2) PORTAL_ACTIVITY_LOG — recruiter ziet wat klant doet in portaal
-- =========================================================================

CREATE TABLE IF NOT EXISTS portal_activity_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  portal_link_id UUID NOT NULL REFERENCES guest_portal_links(id) ON DELETE CASCADE,
  action         TEXT NOT NULL,
  candidate_id   UUID REFERENCES candidates(id) ON DELETE SET NULL,
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address     INET,
  user_agent     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'portal_activity_log_action_check'
  ) THEN
    ALTER TABLE portal_activity_log
      ADD CONSTRAINT portal_activity_log_action_check
      CHECK (action IN (
        'viewed_portal',
        'viewed_candidate',
        'accepted',
        'rejected',
        'commented',
        'downloaded_cv',
        'viewed_resume',
        'viewed_pipeline_history'
      ));
  END IF;
END $$;

ALTER TABLE portal_activity_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'portal_activity_log'
      AND policyname = 'tenant_isolation_portal_activity_log'
  ) THEN
    CREATE POLICY tenant_isolation_portal_activity_log ON portal_activity_log
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_portal_activity_log_tenant_link_created
  ON portal_activity_log(tenant_id, portal_link_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_portal_activity_log_link_action
  ON portal_activity_log(portal_link_id, action, created_at DESC);

-- =========================================================================
-- 3) TENANT_BRANDING — per tenant white-label config
-- =========================================================================

CREATE TABLE IF NOT EXISTS tenant_branding (
  tenant_id      UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  logo_url       TEXT,
  favicon_url    TEXT,
  primary_color  TEXT,
  accent_color   TEXT,
  brand_name     TEXT,
  email_footer   TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_branding_primary_color_hex_check'
  ) THEN
    ALTER TABLE tenant_branding
      ADD CONSTRAINT tenant_branding_primary_color_hex_check
      CHECK (primary_color IS NULL OR primary_color ~* '^#[0-9a-f]{6}$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_branding_accent_color_hex_check'
  ) THEN
    ALTER TABLE tenant_branding
      ADD CONSTRAINT tenant_branding_accent_color_hex_check
      CHECK (accent_color IS NULL OR accent_color ~* '^#[0-9a-f]{6}$');
  END IF;
END $$;

ALTER TABLE tenant_branding ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tenant_branding'
      AND policyname = 'tenant_isolation_tenant_branding'
  ) THEN
    CREATE POLICY tenant_isolation_tenant_branding ON tenant_branding
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- 4) PENDING_PORTAL_NOTIFICATIONS — batch-queue voor daily/weekly mail
-- =========================================================================
--
-- Bij elke nieuwe kandidaat in een job met een actief portaal en
-- frequency != 'realtime' inserten we hier een rij. De notification-cron
-- worker leest pending rows op gezette tijden, batched ze per portaal en
-- markeert ze sent_at.

CREATE TABLE IF NOT EXISTS pending_portal_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  portal_link_id  UUID NOT NULL REFERENCES guest_portal_links(id) ON DELETE CASCADE,
  candidate_id    UUID REFERENCES candidates(id) ON DELETE SET NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ
);

ALTER TABLE pending_portal_notifications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pending_portal_notifications'
      AND policyname = 'tenant_isolation_pending_portal_notifications'
  ) THEN
    CREATE POLICY tenant_isolation_pending_portal_notifications
      ON pending_portal_notifications
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pending_portal_notifications_link_pending
  ON pending_portal_notifications(portal_link_id, created_at)
  WHERE sent_at IS NULL;
