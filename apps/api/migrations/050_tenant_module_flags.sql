-- 050_tenant_module_flags.sql
-- Per-tenant module-zichtbaarheid (feature-flags) — roadmap Sectie 2
-- "Demo-tenant" + strategie Fase 0 "ontstapelen".
--
-- Eén rij per tenant met een JSONB-map van module-key → boolean:
--
--   { "recruit_to_cash": true, "outreach": false, ... }
--
-- Module-keys (groepsniveau, zie src/modules/tenants/moduleFlags.service.ts):
--   recruit_to_cash   contracts / timesheets / invoices / accounting /
--                     commissions / forecasting
--   outreach          outreach-campagnes / sequences / nurture
--   sourcing_ai       agentic AI-sourcing
--   voice             VoIP/telefonie (bevroren feature)
--   whatsapp          WhatsApp Business (bevroren feature)
--   job_boards        vacature-distributie
--   career_pages      career-page builder + publieke pagina's
--   portals           klantportalen (shortlists)
--   reports_analytics rapportbouwer + analytics-dashboards
--   compliance_plus   AVG-tools / AI-toezicht
--
-- Kern (dashboard, vacatures, kandidaten, pipeline, inbox, instellingen) is
-- bewust GEEN module-key — die is niet uitschakelbaar.
--
-- Default-semantiek (code, niet DB):
--   - Geen rij / ontbrekende key → module AAN, behalve `voice` en `whatsapp`
--     (bevroren features, default UIT voor nieuwe tenants).
--   - Bestaande tenants worden hieronder ge-grandfatherd met ALLES aan —
--     inclusief voice + whatsapp — zodat niemand iets ziet verdwijnen.
--
-- Volledig idempotent: herhaald draaien is een no-op.

CREATE TABLE IF NOT EXISTS tenant_module_settings (
  tenant_id  UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  modules    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Grandfather: alle op dit moment bestaande tenants krijgen expliciet ALLE
-- modules aan (ook voice/whatsapp). Nieuwe tenants krijgen géén rij en vallen
-- terug op de code-defaults (alles aan behalve voice/whatsapp).
-- Vóór de RLS-statements zodat de eerste run nooit door een policy geraakt
-- wordt; WHERE NOT EXISTS maakt her-runs een no-op.
INSERT INTO tenant_module_settings (tenant_id, modules)
SELECT t.id,
       '{
          "recruit_to_cash": true,
          "outreach": true,
          "sourcing_ai": true,
          "voice": true,
          "whatsapp": true,
          "job_boards": true,
          "career_pages": true,
          "portals": true,
          "reports_analytics": true,
          "compliance_plus": true
        }'::jsonb
  FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM tenant_module_settings s WHERE s.tenant_id = t.id
 )
ON CONFLICT (tenant_id) DO NOTHING;

-- RLS conform het geharde patroon uit 036/037 (zie ook 042): ENABLE + FORCE,
-- policy met USING én WITH CHECK op app.tenant_id.
ALTER TABLE tenant_module_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_module_settings FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tenant_module_settings'
      AND policyname = 'tenant_isolation_tenant_module_settings'
  ) THEN
    CREATE POLICY tenant_isolation_tenant_module_settings ON tenant_module_settings
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
