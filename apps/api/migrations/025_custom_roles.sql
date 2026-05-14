-- 025_custom_roles.sql
-- Sprint Q4.2 (Agent OOO) — Enterprise security: custom rollen + multi-role
-- assignments + per-tenant security settings (IP-allowlist, password policy,
-- session timeout, login lockout).
--
-- Achtergrond:
--   De bestaande `users.role`-kolom is een enkele tekst-rol (system role:
--   admin / recruiter / hiring_manager / viewer / super_admin). Voor
--   enterprise-tenants is dat te grof — die willen rollen als
--   "Senior Recruiter US-team" met een eigen permission-matrix. Deze
--   migratie introduceert tenant-eigen custom-rollen, multi-role
--   assignments per user, en de tenant-brede security policy. Het oude
--   `role`-veld blijft bestaan als snelle default — `user_role_assignments`
--   is additief.
--
-- Idempotent. KDMN-conventies: IF NOT EXISTS, DO $$ guards, RLS via
-- app.tenant_id setting, snake_case, `created_at`/`updated_at` op alle tabellen.

-- =========================================================================
-- A) tenant_custom_roles — per-tenant rol-definities + permission-matrix
-- =========================================================================
--
-- `permissions` JSONB structuur:
--   {
--     "candidates": { "read": true, "write": true, "delete": false },
--     "jobs":       { "read": true, "write": true },
--     ...
--   }
-- Resources zijn gedefinieerd in src/lib/permissions.ts (PERMISSION_RESOURCES).
-- Acties zijn read|write|delete|admin. Alle ontbrekende keys = false (default-deny).
--
-- `inherits_from` verwijst naar een SYSTEM_ROLE-key (e.g. 'recruiter') waarvan
-- de basis-permissions worden overgenomen. Custom permissies stapelen erbovenop
-- (OR-logic). Geen recursive inheritance — alleen system → custom.

CREATE TABLE IF NOT EXISTS tenant_custom_roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,                  -- snake_case identifier, bv 'senior_recruiter'
  label           TEXT NOT NULL,                   -- 'Senior Recruiter'
  description     TEXT,
  permissions     JSONB NOT NULL DEFAULT '{}'::jsonb,
  inherits_from   TEXT,                            -- system-role key of NULL
  is_system       BOOLEAN NOT NULL DEFAULT FALSE,
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Key moet uniek zijn per tenant zodat we kunnen UPSERT-en op (tenant_id, key).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_custom_roles_tenant_key_unique'
  ) THEN
    ALTER TABLE tenant_custom_roles
      ADD CONSTRAINT tenant_custom_roles_tenant_key_unique
      UNIQUE (tenant_id, key);
  END IF;
END $$;

-- Snake-case-only key (idempotent CHECK).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_custom_roles_key_format'
  ) THEN
    ALTER TABLE tenant_custom_roles
      ADD CONSTRAINT tenant_custom_roles_key_format
      CHECK (key ~ '^[a-z][a-z0-9_]*$');
  END IF;
END $$;

ALTER TABLE tenant_custom_roles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tenant_custom_roles' AND policyname = 'tenant_isolation_custom_roles'
  ) THEN
    CREATE POLICY tenant_isolation_custom_roles ON tenant_custom_roles
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenant_custom_roles_tenant
  ON tenant_custom_roles (tenant_id);

-- =========================================================================
-- B) user_role_assignments — koppel users aan rollen (system OF custom)
-- =========================================================================
--
-- Multi-role: een user kan meerdere rol-assignments hebben. Permissions
-- worden gemerged met OR-logic in src/lib/permissions.ts.
--
-- Voor SYSTEM-rollen (admin/recruiter/...) is `role_id` NULL en `role_key`
-- gezet. Voor CUSTOM-rollen wijst `role_id` naar tenant_custom_roles.id en
-- is `role_key` ook gevuld (kopie van tenant_custom_roles.key) zodat
-- queries zonder JOIN ook kunnen filteren.
--
-- `expires_at` ondersteunt time-bound assignments (project-tijdelijke
-- toegang). Gevulde rij waarbij expires_at < now() telt niet mee in de
-- permission-matrix-build.

CREATE TABLE IF NOT EXISTS user_role_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id         UUID REFERENCES tenant_custom_roles(id) ON DELETE CASCADE,
  role_key        TEXT NOT NULL,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at      TIMESTAMPTZ
);

-- Geen dubbele assignment voor (user, custom-role). Voor system-rollen
-- (role_id IS NULL) gebruiken we (user_id, role_key) uniqueness.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'user_role_assignments_unique_custom'
  ) THEN
    CREATE UNIQUE INDEX user_role_assignments_unique_custom
      ON user_role_assignments (tenant_id, user_id, role_id)
      WHERE role_id IS NOT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'user_role_assignments_unique_system'
  ) THEN
    CREATE UNIQUE INDEX user_role_assignments_unique_system
      ON user_role_assignments (tenant_id, user_id, role_key)
      WHERE role_id IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_role_assignments_user
  ON user_role_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_user_role_assignments_tenant_user
  ON user_role_assignments (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_role_assignments_role
  ON user_role_assignments (role_id) WHERE role_id IS NOT NULL;

ALTER TABLE user_role_assignments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_role_assignments' AND policyname = 'tenant_isolation_role_assignments'
  ) THEN
    CREATE POLICY tenant_isolation_role_assignments ON user_role_assignments
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- C) tenant_security_settings — per-tenant security policy
-- =========================================================================
--
-- Eén rij per tenant (tenant_id is de primary key). Wordt lazy aangemaakt
-- bij eerste GET/PATCH via UPSERT. Defaults zijn industry-standard zonder
-- extreem te zijn — admins kunnen ze stricter zetten.

CREATE TABLE IF NOT EXISTS tenant_security_settings (
  tenant_id                       UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  ip_allowlist                    TEXT[] NOT NULL DEFAULT '{}',     -- CIDR ranges (IPv4/IPv6)
  ip_allowlist_enforced           BOOLEAN NOT NULL DEFAULT FALSE,
  session_timeout_minutes         INTEGER NOT NULL DEFAULT 1440,    -- 24u
  password_min_length             INTEGER NOT NULL DEFAULT 12,
  password_require_special        BOOLEAN NOT NULL DEFAULT TRUE,
  password_max_age_days           INTEGER,                           -- NULL = geen verloop
  failed_login_lockout_threshold  INTEGER NOT NULL DEFAULT 5,
  failed_login_lockout_minutes    INTEGER NOT NULL DEFAULT 30,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenant_security_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tenant_security_settings' AND policyname = 'tenant_isolation_security_settings'
  ) THEN
    CREATE POLICY tenant_isolation_security_settings ON tenant_security_settings
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- =========================================================================
-- D) updated_at trigger (gedeeld) voor de twee mutable tabellen
-- =========================================================================

CREATE OR REPLACE FUNCTION set_updated_at_timestamp() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'tenant_custom_roles_set_updated_at'
  ) THEN
    CREATE TRIGGER tenant_custom_roles_set_updated_at
      BEFORE UPDATE ON tenant_custom_roles
      FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'tenant_security_settings_set_updated_at'
  ) THEN
    CREATE TRIGGER tenant_security_settings_set_updated_at
      BEFORE UPDATE ON tenant_security_settings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();
  END IF;
END $$;
