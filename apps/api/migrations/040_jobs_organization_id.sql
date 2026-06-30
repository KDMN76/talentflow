-- 040_jobs_organization_id.sql
-- Sectie 4 P2 — koppel een vacature aan een klant/organisatie (CRM).
--
-- Hiermee kan de pipeline op klant gefilterd worden en kunnen plaatsingscijfers
-- per klant rechtstreeks uit de jobs↔organizations-relatie komen (i.p.v. alleen
-- via CRM-deals). Idempotent: veilig om opnieuw te draaien.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_tenant_organization
  ON jobs (tenant_id, organization_id) WHERE deleted_at IS NULL;
