-- 047_2fa_replay_protection.sql
-- Sprint Q4.2 vervolg — TOTP replay-protectie.
--
-- Een TOTP-code is 30s (±window) geldig; zonder replay-guard kan een
-- afgekeken code binnen dat venster een tweede keer gebruikt worden.
-- We slaan de starttijd (ms epoch) op van de tijdstap waarop de laatst
-- geaccepteerde code matchte. De service weigert vervolgens elke code
-- waarvan de gematchte tijdstap <= last_totp_step is.
--
-- Idempotent. Volgt KDMN-conventies.

ALTER TABLE user_2fa_secrets
  ADD COLUMN IF NOT EXISTS last_totp_step BIGINT;

COMMENT ON COLUMN user_2fa_secrets.last_totp_step IS
  'Starttijd (ms epoch) van de RFC6238-tijdstap van de laatst geaccepteerde TOTP-code — replay-guard.';
