-- 053_availability_override_range.sql
-- Voegt een optionele einddatum toe aan interviewer-availability overrides,
-- zodat één override-rij een PERIODE kan blokkeren (datum van — datum t/m)
-- i.p.v. één losse dag.
--
-- Semantiek:
--   - date_override      = startdatum (van).
--   - date_override_end  = einddatum (t/m), inclusief.
--   - date_override_end IS NULL  => single-day override (t/m == van).
--
-- Volledig backwards-compatible: bestaande rijen houden date_override_end = NULL
-- en gedragen zich exact als voorheen (één dag). Idempotent via
-- ADD COLUMN IF NOT EXISTS.

ALTER TABLE interviewer_availability
  ADD COLUMN IF NOT EXISTS date_override_end DATE;

-- Guard: t/m mag niet vóór van liggen. Idempotente DO-block (conventie gelijk
-- aan 017_interviews.sql).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'interviewer_availability_override_range_check'
  ) THEN
    ALTER TABLE interviewer_availability
      ADD CONSTRAINT interviewer_availability_override_range_check
      CHECK (
        date_override_end IS NULL
        OR (date_override IS NOT NULL AND date_override_end >= date_override)
      );
  END IF;
END $$;
