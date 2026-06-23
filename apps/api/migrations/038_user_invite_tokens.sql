-- =========================================================================
-- 038_user_invite_tokens.sql
--
-- Single-use invite tokens voor de admin-invite onboarding-flow.
--
-- Achtergrond: inviteUser() mailde voorheen een plaintext temp-wachtwoord en
-- maakte de user is_active=false, maar NIETS zette is_active=true → elke
-- uitgenodigde gebruiker zat permanent buitengesloten (login weigert inactieve
-- users met 403). De nieuwe flow geeft een gehashte, kortlevende invite-token
-- uit; /accept-invite zet het wachtwoord én flipt is_active=true.
--
-- Gemodelleerd op whatsapp_optin_tokens (031_whatsapp.sql): hash opgeslagen,
-- raw alleen in de mail; lookup gebeurt op token_hash via auth_context (de hash
-- is de enige sleutel, geen tenant-context). Idempotent (IF NOT EXISTS / DO).
-- =========================================================================

CREATE TABLE IF NOT EXISTS user_invite_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_invite_tokens_hash_unique'
  ) THEN
    ALTER TABLE user_invite_tokens
      ADD CONSTRAINT user_invite_tokens_hash_unique UNIQUE (token_hash);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_invite_tokens_tenant_user
  ON user_invite_tokens (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_invite_tokens_expires
  ON user_invite_tokens (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE user_invite_tokens ENABLE ROW LEVEL SECURITY;
-- De accept-invite route zoekt op token_hash via withAuthTx({authContext:true})
-- ZONDER app.tenant_id (de hash is de enige sleutel). Daarom krijgt de policy
-- meteen de auth_context-carve-out + fail-closed nullif-wrapping uit migratie
-- 037, zodat deze tabel cutover-ready is: onder de toekomstige non-owner-rol
-- blijft de hash-lookup (read) werken, terwijl WITH CHECK op writes strikt
-- tenant-gebonden blijft (de consume/activate draaien binnen withTenant).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_invite_tokens'
      AND policyname = 'tenant_isolation_user_invite_tokens'
  ) THEN
    CREATE POLICY tenant_isolation_user_invite_tokens ON user_invite_tokens
      USING (
        nullif(current_setting('app.tenant_id', true), '')::uuid = tenant_id
        OR nullif(current_setting('app.auth_context', true), '') = 'on'
      )
      WITH CHECK (
        nullif(current_setting('app.tenant_id', true), '')::uuid = tenant_id
      );
  END IF;
END $$;
