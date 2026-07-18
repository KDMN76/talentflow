-- =========================================================================
-- 057_guest_portal_token_hash.sql
--
-- Security-fix: guest_portal_links sloeg de raw guest-portal-token
-- PLAINTEXT op (kolom `token`) — zelfde bug-klasse als candidate_self_tokens
-- vóór migratie 055 (zie 055_candidate_self_token_hash.sql). Een DB-lek gaf
-- direct bruikbare white-label klantportaal-links (kandidaat-PII, shortlist,
-- feedback-acties).
--
-- Deze migratie voegt `token_hash` toe (sha256 hex van de raw token). De
-- service zoekt voortaan op sha256(token); de raw token zit enkel nog in de
-- eenmalig getoonde/gedeelde portal-URL (bij aanmaak of rotate-secret).
--
-- Bestaande plaintext-tokens kunnen niet retro-actief gehasht worden (we
-- kennen de raw waarde niet meer buiten de plaintext-kolom), dus we
-- invalideren ze door expires_at in het verleden te zetten. Recruiters met
-- een nog-geldige oude link roteren simpelweg het secret opnieuw.
--
-- Idempotent (IF NOT EXISTS), geen DROP.
-- =========================================================================

ALTER TABLE guest_portal_links
  ADD COLUMN IF NOT EXISTS token_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_portal_links_token_hash
  ON guest_portal_links (token_hash);

-- Nieuwe/geroteerde rijen bewaren alléén de hash, niet de raw token. NULL is
-- toegestaan onder de bestaande UNIQUE-constraint op `token`, dus de
-- NOT NULL moet weg.
ALTER TABLE guest_portal_links
  ALTER COLUMN token DROP NOT NULL;

-- Invalideer bestaande plaintext-tokens (kunnen niet gehasht worden).
UPDATE guest_portal_links
   SET expires_at = now() - interval '1 day'
 WHERE token_hash IS NULL;
