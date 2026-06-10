-- 035_refresh_token_rotation.sql
-- Fase 0.5 — refresh-token-rotatie met reuse-detectie.
--
-- Een refresh-token wordt single-use: bij elke /auth/refresh wordt de
-- aangeboden token gemarkeerd als geroteerd (rotated_at) en vervangen door een
-- nieuwe (replaced_by_hash). Wordt een al-geroteerde token nogmaals
-- aangeboden, dan is dat een diefstal-/replay-signaal en worden ALLE
-- refresh-tokens van die gebruiker ingetrokken.
--
-- Geroteerde rijen blijven bewaard tot hun oorspronkelijke expiry (nodig vóór
-- de detectie) en worden door de bestaande expiry-cleanup verwijderd.
-- Idempotent.

ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replaced_by_hash TEXT;

COMMENT ON COLUMN refresh_tokens.rotated_at IS
  'Moment waarop deze token is ingewisseld voor een opvolger. NULL = nog actief. Niet-NULL + opnieuw aangeboden = reuse → alle sessies van de user intrekken.';
COMMENT ON COLUMN refresh_tokens.replaced_by_hash IS
  'token_hash van de opvolger (audit-spoor van de rotatieketen).';
