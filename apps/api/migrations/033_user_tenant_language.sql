-- 033_user_tenant_language.sql
-- i18n Fase 1 — taalvoorkeur op twee niveaus (zie docs i18n-ontwerp):
--
--   - tenants.default_language : tenant-brede default (gezet bij onboarding).
--   - users.language           : individuele voorkeur; NULL = erf tenant-default.
--
-- Resolutie in de frontend: user → tenant → browser → 'nl'.
-- VARCHAR(50) i.p.v. iets smallers: ruim genoeg voor regio-varianten
-- ('en-GB', 'pt-BR') en conform de huisregel "smal is een bug die wacht".
-- Idempotent via IF NOT EXISTS.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS default_language VARCHAR(50) NOT NULL DEFAULT 'nl';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS language VARCHAR(50);

COMMENT ON COLUMN tenants.default_language IS
  'Tenant-brede UI-taal (ISO 639-1, evt. met regio). Gebruikt als fallback wanneer users.language NULL is.';
COMMENT ON COLUMN users.language IS
  'Individuele UI-taalvoorkeur. NULL = erf tenants.default_language.';
