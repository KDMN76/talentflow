-- 049_report_embed_expiry.sql
-- Reports: optionele vervaldatum op embed-tokens.
--
-- De service (reports.service.ts) filtert publieke embed-lookups op
--   embed_expires_at IS NULL OR embed_expires_at > now()
-- zodat gedeelde read-only links automatisch kunnen verlopen. NULL betekent
-- "geen expiry" (token blijft geldig tot handmatige revoke).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS embed_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN reports.embed_expires_at IS
  'Optionele vervaldatum van het embed-token; NULL = geen expiry.';
