-- 045_tenant_branding_logo.sql
-- White-label branding: echte logo-upload via de storage-laag (MinIO/S3 of
-- local disk) in plaats van een handmatige externe URL.
--
--   logo_storage_key : logische key in de FileStorage-abstractie
--                      (tenants/<tenantId>/branding/logo_<uuid>.<ext>).
--                      NULL = geen geupload logo (logo_url kan dan nog steeds
--                      een externe URL zijn die via PUT /tenants/branding is gezet).
--   logo_mime        : content-type van het geuploade bestand
--                      (image/png | image/jpeg | image/svg+xml) — nodig om het
--                      publieke serve-endpoint het juiste Content-Type + de
--                      SVG-CSP-headers te laten zetten.
--
-- Idempotent: IF NOT EXISTS-guards, her-runs in dev zijn veilig.

ALTER TABLE tenant_branding
  ADD COLUMN IF NOT EXISTS logo_storage_key TEXT;

ALTER TABLE tenant_branding
  ADD COLUMN IF NOT EXISTS logo_mime TEXT;

-- Alleen mimes die de upload-validatie toestaat.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_branding_logo_mime_check'
  ) THEN
    ALTER TABLE tenant_branding
      ADD CONSTRAINT tenant_branding_logo_mime_check
      CHECK (logo_mime IS NULL OR logo_mime IN ('image/png', 'image/jpeg', 'image/svg+xml'));
  END IF;
END $$;
