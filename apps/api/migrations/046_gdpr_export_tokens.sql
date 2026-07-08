-- =========================================================================
-- 046_gdpr_export_tokens.sql
--
-- Download-tokens voor GDPR data-exports (AVG art. 15).
--
-- Flow: admin genereert vanaf een DSAR-verzoek een download-link. De link
-- bevat een opaque token (32 bytes hex, alleen in de URL). At rest slaan we —
-- net als password_reset_tokens (041) — alléén de sha256-hash op (kolom
-- token_hash); de raw token zit enkel in de URL zodat een DB-lek geen
-- bruikbare links geeft. De publieke download-endpoint zoekt op sha256(token),
-- valideert expiry en download-limiet, bumpt de teller en streamt de ZIP.
--
-- Beveiliging:
--   - kort-levend: TTL wordt door de service gezet (24 uur);
--   - download-limiet (default 3) tegen link-doorsturen;
--   - RLS met auth_context-carve-out voor de token-lookup (de download
--     gebeurt zonder tenant-context; alle vervolg-queries lopen via
--     withTenant met de tenant_id uit de token-rij) — zelfde vorm als
--     password_reset_tokens (041), cutover-ready voor de non-owner-rol.
--
-- Idempotent (IF NOT EXISTS / DO-guards), geen DROP.
-- =========================================================================

CREATE TABLE IF NOT EXISTS data_export_tokens (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id       UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  dsar_id            UUID REFERENCES dsar_requests(id) ON DELETE SET NULL,
  token_hash         TEXT NOT NULL,
  expires_at         TIMESTAMPTZ NOT NULL,
  max_downloads      INTEGER NOT NULL DEFAULT 3,
  download_count     INTEGER NOT NULL DEFAULT 0,
  last_downloaded_at TIMESTAMPTZ,
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'data_export_tokens_token_hash_unique'
  ) THEN
    ALTER TABLE data_export_tokens
      ADD CONSTRAINT data_export_tokens_token_hash_unique UNIQUE (token_hash);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'data_export_tokens_max_downloads_check'
  ) THEN
    ALTER TABLE data_export_tokens
      ADD CONSTRAINT data_export_tokens_max_downloads_check
      CHECK (max_downloads BETWEEN 1 AND 20);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_data_export_tokens_tenant_candidate
  ON data_export_tokens (tenant_id, candidate_id);
CREATE INDEX IF NOT EXISTS idx_data_export_tokens_dsar
  ON data_export_tokens (dsar_id);
CREATE INDEX IF NOT EXISTS idx_data_export_tokens_expires
  ON data_export_tokens (expires_at);

ALTER TABLE data_export_tokens ENABLE ROW LEVEL SECURITY;
-- FORCE conform 036: zonder FORCE bypasst de table-owner de policies.
ALTER TABLE data_export_tokens FORCE ROW LEVEL SECURITY;

-- Zelfde policy-vorm als password_reset_tokens (041): auth_context-carve-out
-- voor de token-lookup (read zonder tenant-context) + fail-closed
-- nullif-wrapping (037). WITH CHECK op writes blijft strikt tenant-gebonden
-- (aanmaken en bumpen draait binnen withTenant).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'data_export_tokens'
      AND policyname = 'tenant_isolation_data_export_tokens'
  ) THEN
    CREATE POLICY tenant_isolation_data_export_tokens ON data_export_tokens
      USING (
        nullif(current_setting('app.tenant_id', true), '')::uuid = tenant_id
        OR nullif(current_setting('app.auth_context', true), '') = 'on'
      )
      WITH CHECK (
        nullif(current_setting('app.tenant_id', true), '')::uuid = tenant_id
      );
  END IF;
END $$;
