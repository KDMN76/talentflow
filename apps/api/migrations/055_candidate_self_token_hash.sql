-- =========================================================================
-- 055_candidate_self_token_hash.sql
--
-- Security-fix: candidate_self_tokens sloeg de raw token PLAINTEXT op
-- (kolom `token`), terwijl alle andere token-tabellen (041 password_reset,
-- 046 data_export) alléén de sha256-hash bewaren. Een DB-lek gaf dus
-- direct bruikbare self-service-links.
--
-- Deze migratie voegt `token_hash` toe (sha256 hex van de raw token). De
-- service zoekt voortaan op sha256(token); de raw token zit enkel nog in
-- de /profile/<token>-URL die de kandidaat gebruikt.
--
-- Bestaande plaintext-tokens kunnen niet retro-actief gehasht worden
-- (we kennen de raw waarde niet meer buiten de plaintext-kolom), dus we
-- invalideren ze door expires_at in het verleden te zetten. Kandidaten met
-- een nog-geldige oude link vragen simpelweg een nieuwe aan.
--
-- Idempotent (IF NOT EXISTS), geen DROP.
-- =========================================================================

ALTER TABLE candidate_self_tokens
  ADD COLUMN IF NOT EXISTS token_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_self_tokens_hash
  ON candidate_self_tokens (token_hash);

-- Nieuwe rijen bewaren alléén de hash, niet de raw token. NULL is toegestaan
-- onder de bestaande UNIQUE-constraint op `token`, dus de NOT NULL moet weg.
ALTER TABLE candidate_self_tokens
  ALTER COLUMN token DROP NOT NULL;

-- Invalideer bestaande plaintext-tokens (kunnen niet gehasht worden).
UPDATE candidate_self_tokens
   SET expires_at = now() - interval '1 day'
 WHERE token_hash IS NULL;
