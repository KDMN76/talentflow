-- 042_tenant_email_settings.sql
-- Per-tenant e-mailinstellingen (roadmap 5.1 + SaaS-afzendernaam).
-- (Hernoemd van 041: dat nummer is al in gebruik door 041_password_reset_tokens.sql.)
--
-- Drie use-cases:
--   1) Per-tenant afzendernaam: elke tenant kan zijn eigen display-naam
--      instellen ("IT Proposal <no-reply@send.kdmn.nl>"). Het ADRES blijft
--      het globale geverifieerde Resend-domein (RESEND_FROM); alleen de
--      display-naam is per tenant.
--   2) Eigen SMTP per tenant: klanten zonder Outlook/Gmail-integratie kunnen
--      hun eigen SMTP-server koppelen. Het wachtwoord staat AES-256-GCM-
--      versleuteld in `smtp_pass_encrypted` (zie src/lib/encryption.ts) en
--      verlaat de API nooit in responses.
--   3) Per-tenant Reply-To: inbound reply-threading (RESEND_REPLY_DOMAIN)
--      staat bewust uit, dus antwoorden van kandidaten bouncen. Met een
--      per-tenant `reply_to` (bv. info@itproposal.be) komen antwoorden
--      direct bij het bureau binnen. Heeft in het verzendpad voorrang op
--      de plus-addressing Reply-To.
--
-- Kolommen bewust ruim (VARCHAR(500)+) — smal is een bug die wacht.
-- Volledig idempotent: herhaald draaien is een no-op.

CREATE TABLE IF NOT EXISTS tenant_email_settings (
  tenant_id           UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Display-naam voor de globale Resend-afzender. NULL = "TalentFlow" (global default).
  from_name           VARCHAR(500),
  -- Reply-To adres van het bureau zelf (bv. info@itproposal.be). NULL = geen
  -- override → bestaand gedrag (plus-addressing of geen Reply-To).
  reply_to            VARCHAR(500),
  -- SMTP-transport (optioneel). smtp_enabled=true → worker verstuurt via SMTP.
  smtp_enabled        BOOLEAN NOT NULL DEFAULT false,
  smtp_host           VARCHAR(500),
  smtp_port           INTEGER,
  smtp_secure         BOOLEAN NOT NULL DEFAULT true,
  smtp_user           VARCHAR(500),
  -- AES-256-GCM blob: [12B IV][16B tag][ciphertext] — zie src/lib/encryption.ts.
  smtp_pass_encrypted BYTEA,
  -- From-adres voor SMTP-verzending (bv. no-reply@klantdomein.nl).
  smtp_from           VARCHAR(500),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotente kolom-guard: mocht de tabel al bestaan uit een eerdere run
-- (vóór de reply_to-toevoeging), voeg de kolom dan alsnog toe.
ALTER TABLE tenant_email_settings ADD COLUMN IF NOT EXISTS reply_to VARCHAR(500);

-- Poort-sanity (NULL toegestaan; default wordt in code afgeleid van smtp_secure).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_email_settings_smtp_port_check'
  ) THEN
    ALTER TABLE tenant_email_settings
      ADD CONSTRAINT tenant_email_settings_smtp_port_check
      CHECK (smtp_port IS NULL OR (smtp_port >= 1 AND smtp_port <= 65535));
  END IF;
END $$;

-- RLS conform het geharde patroon uit 036/037: ENABLE + FORCE, policy met
-- USING én WITH CHECK op app.tenant_id.
ALTER TABLE tenant_email_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_email_settings FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tenant_email_settings'
      AND policyname = 'tenant_isolation_tenant_email_settings'
  ) THEN
    CREATE POLICY tenant_isolation_tenant_email_settings ON tenant_email_settings
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
