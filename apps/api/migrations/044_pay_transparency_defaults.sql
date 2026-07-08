-- 044_pay_transparency_defaults.sql
-- Pay-Transparency-module afronding (EU 2023/970).
--
-- Voegt één kolom toe aan `tenant_pay_settings` (aangemaakt in 021):
--   * `default_salary_frequency` — de frequentie die JobForm voor-invult en
--     die de publiceer-gate als derde verplicht veld hanteert
--     (salary_min + salary_max + salary_frequency).
--
-- Waardes spiegelen de bestaande CHECK op `jobs.salary_frequency`
-- (007_job_detail_expansion.sql): monthly / annual / hourly.
--
-- RLS: tabel heeft al ENABLE (021) + FORCE/WITH CHECK via de generieke
-- hardening in 036/037 — kolom-toevoeging raakt policies niet. Voor de
-- zekerheid herhalen we de FORCE-guard conform het patroon van 042
-- (idempotent, no-op als 036 al gedraaid is).
--
-- Volledig idempotent: herhaald draaien is een no-op.

ALTER TABLE tenant_pay_settings
  ADD COLUMN IF NOT EXISTS default_salary_frequency TEXT NOT NULL DEFAULT 'monthly';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_pay_settings_default_salary_frequency_check'
  ) THEN
    ALTER TABLE tenant_pay_settings
      ADD CONSTRAINT tenant_pay_settings_default_salary_frequency_check
      CHECK (default_salary_frequency IN ('monthly', 'annual', 'hourly'));
  END IF;
END $$;

COMMENT ON COLUMN tenant_pay_settings.default_salary_frequency IS
  'Default salarisfrequentie voor nieuwe vacatures (monthly/annual/hourly) — Pay Transparency Directive 2023/970';

-- RLS-guard conform 036/042: FORCE zodat ook de tabel-eigenaar aan RLS
-- onderworpen is. Idempotent — herhaald FORCE'en is een no-op.
ALTER TABLE tenant_pay_settings FORCE ROW LEVEL SECURITY;
