-- 056_crm_contacts_org_nullable.sql
-- crm_contacts.organization_id was NOT NULL (migratie 034), maar zowel de
-- create/update-service (apps/api/src/modules/crm/contacts.service.ts) als het
-- controller-schema (contacts.controller.ts) staan een NULL/ontbrekende
-- organisatie expliciet toe (`organization_id: z.string().uuid().optional().nullable()`
-- en `data.organization_id ?? null`). Een contact zónder organisatie insert'te
-- daardoor NULL in een NOT NULL-kolom → 23502 (not-null violation) → onbedoelde
-- 500 i.p.v. een succesvolle create.
--
-- De kleinste correcte fix die met de bestaande code-intentie strookt: de kolom
-- nullable maken (een contact MAG los van een organisatie bestaan). De FK naar
-- organizations blijft ongewijzigd (ON DELETE CASCADE) — bij een NULL-waarde is
-- er simpelweg geen gekoppelde organisatie.
--
-- Idempotent: DROP NOT NULL op een reeds-nullable kolom is een no-op.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'crm_contacts'
      AND column_name = 'organization_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE crm_contacts ALTER COLUMN organization_id DROP NOT NULL;
  END IF;
END $$;
