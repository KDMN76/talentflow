-- =========================================================================
-- 041_password_reset_tokens.sql
--
-- Single-use wachtwoord-reset-tokens voor de forgot-password-flow.
--
-- Gemodelleerd op user_invite_tokens (038): alleen de sha256-hash wordt
-- opgeslagen, de raw token zit enkel in de reset-mail. Lookup gebeurt op
-- token_hash via auth_context (de hash is de enige sleutel, geen
-- tenant-context). TTL wordt door de service gezet (~1 uur). Idempotent
-- (IF NOT EXISTS / DO), geen DROP.
-- =========================================================================

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'password_reset_tokens_hash_unique'
  ) THEN
    ALTER TABLE password_reset_tokens
      ADD CONSTRAINT password_reset_tokens_hash_unique UNIQUE (token_hash);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_tenant_user
  ON password_reset_tokens (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires
  ON password_reset_tokens (expires_at)
  WHERE used_at IS NULL;

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
-- FORCE conform 036: zonder FORCE bypasst de table-owner de policies. (036
-- draaide eenmalig over toen-bestaande tabellen; nieuwe tabellen zetten het
-- zelf.) We repareren hier meteen dezelfde omissie in 038.
ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE user_invite_tokens FORCE ROW LEVEL SECURITY;
-- De reset-password route zoekt op token_hash via withAuthTx({authContext:true})
-- ZONDER app.tenant_id (de hash is de enige sleutel). Zelfde policy-vorm als
-- user_invite_tokens (038): auth_context-carve-out voor reads + fail-closed
-- nullif-wrapping (037), zodat de tabel cutover-ready is onder de toekomstige
-- non-owner-rol. WITH CHECK op writes blijft strikt tenant-gebonden (het
-- aanmaken en consumeren draait binnen withTenant).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'password_reset_tokens'
      AND policyname = 'tenant_isolation_password_reset_tokens'
  ) THEN
    CREATE POLICY tenant_isolation_password_reset_tokens ON password_reset_tokens
      USING (
        nullif(current_setting('app.tenant_id', true), '')::uuid = tenant_id
        OR nullif(current_setting('app.auth_context', true), '') = 'on'
      )
      WITH CHECK (
        nullif(current_setting('app.tenant_id', true), '')::uuid = tenant_id
      );
  END IF;
END $$;
