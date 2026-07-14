/**
 * Security types — Sprint Q4.2 (Enterprise security)
 *
 * Mirrors backend contracts van Agent NNN (SSO/2FA) + Agent OOO (RBAC + audit + IP).
 */

// ─── SSO / SAML ─────────────────────────────────────────────────────────────

export type SsoProvider = "okta" | "azure_ad" | "google_workspace" | "generic_saml";

export interface SamlAttributeMapping {
  email: string;
  first_name: string;
  last_name: string;
  /** Optional groep-claim — voor auto-role-mapping. */
  groups?: string;
}

export interface SamlConfig {
  id: string;
  tenant_id: string;
  enabled: boolean;
  provider: SsoProvider;
  /** SAML SSO entry-point van IdP. */
  entry_point: string;
  /** IdP issuer URL (entityID). */
  issuer: string;
  /** PEM-encoded X.509-cert van IdP. */
  idp_cert: string;
  attribute_mapping: SamlAttributeMapping;
  /** Maak users automatisch aan bij eerste login. */
  auto_create_users: boolean;
  /** Default-rol (stable role key, bv. "recruiter") voor nieuwe users (alleen bij auto_create_users). */
  default_role: string | null;
  /** SP entity-ID — door TalentFlow gegenereerd. */
  sp_entity_id: string;
  /** SP ACS URL (Assertion Consumer Service). */
  sp_acs_url: string;
  /** SP metadata-XML download URL. */
  sp_metadata_url: string;
  created_at: string;
  updated_at: string;
}

export interface SsoTestResult {
  ok: boolean;
  /** Stap waar het foutgaat — voor UX. */
  step?: "metadata_fetch" | "cert_validation" | "request_sign" | "response_parse";
  message: string;
  /** Raw error-detail — diagnostisch. */
  detail?: string;
  duration_ms?: number;
}

// ─── SCIM ───────────────────────────────────────────────────────────────────

export interface ScimToken {
  id: string;
  tenant_id: string;
  enabled: boolean;
  /** Endpoint URL waar SCIM-clients tegen praten. */
  endpoint_url: string;
  /** Token-prefix — full token is alleen zichtbaar bij genereren. */
  token_prefix: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface ScimTokenGenerated extends ScimToken {
  full_token: string;
}

// ─── 2FA ────────────────────────────────────────────────────────────────────

export interface TwoFactorStatus {
  enabled: boolean;
  enrolled_at: string | null;
  /** Aantal nog ongebruikte backup-codes. */
  backup_codes_remaining: number;
  /** Tenant-policy verplicht 2FA — banner als true en !enabled. */
  required_by_policy: boolean;
  /** Deadline voor verplichte enrollment (grace-period). */
  policy_grace_period_ends_at: string | null;
}

export interface TwoFactorSetupChallenge {
  /** TOTP-secret (Base32). */
  secret: string;
  /** otpauth://-URI als data-URL of pre-rendered QR (data:image/png;base64,...). */
  qr_code_data_url: string;
  /** 10 backup-codes — eenmalig zichtbaar. */
  backup_codes: string[];
}

/** Tenant 2FA-policy — GET/PUT /api/auth/2fa/policy (admin/owner only). */
export interface TwoFactorTenantPolicy {
  tenant_id: string;
  required_for_roles: string[];
  required_for_all: boolean;
  grace_period_days: number;
  created_at?: string;
  updated_at?: string;
}

// ─── Roles + permissions ────────────────────────────────────────────────────

export type RbacResource =
  | "candidates"
  | "jobs"
  | "applications"
  | "pipeline"
  | "interviews"
  | "communications"
  | "reports"
  | "analytics"
  | "billing"
  | "users"
  | "roles"
  | "settings"
  | "audit"
  | "integrations";

export type RbacAction = "read" | "create" | "update" | "delete" | "export" | "manage";

export interface PermissionGrant {
  resource: RbacResource;
  actions: RbacAction[];
}

export interface Role {
  id: string;
  tenant_id: string | null; // null voor system-rollen
  /** Stable key — bv. "admin", "recruiter". */
  key: string;
  label: string;
  description: string | null;
  /** Built-in rollen kun je niet bewerken/verwijderen. */
  is_system: boolean;
  /** Optionele inheritance van een andere rol. */
  inherits_from_role_id: string | null;
  permissions: PermissionGrant[];
  user_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateRoleInput {
  key: string;
  label: string;
  description?: string | null;
  inherits_from_role_id?: string | null;
  permissions: PermissionGrant[];
}

export interface UpdateRoleInput {
  label?: string;
  description?: string | null;
  inherits_from_role_id?: string | null;
  permissions?: PermissionGrant[];
}

export interface RoleAssignment {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  role_id: string;
  role_label: string;
  assigned_by: string | null;
  assigned_at: string;
  expires_at: string | null;
}

export interface AssignRoleInput {
  user_id: string;
  /** Stable role key (bv. "admin") — de backend eist `role_key`, geen role_id. */
  role_key: string;
  expires_at?: string | null;
}

export interface UserPermissionMatrix {
  user_id: string;
  /** Effective grants — geüniede over alle rollen + inheritance. */
  permissions: PermissionGrant[];
  /** Lijst van toegewezen rol-IDs. */
  role_ids: string[];
}

// ─── Security settings (IP-allowlist + password policy + 2FA-policy) ────────

export interface IpAllowlistEntry {
  cidr: string;
  label?: string;
  added_at: string;
}

export interface PasswordPolicy {
  min_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_number: boolean;
  require_symbol: boolean;
  /** Rotatie-interval in dagen, of null voor uit. */
  rotation_days: number | null;
}

export interface SecuritySettings {
  tenant_id: string;
  ip_allowlist_enabled: boolean;
  ip_allowlist: IpAllowlistEntry[];
  /** 2FA verplicht voor: "all" / "admins" / "none". */
  two_factor_policy: "all" | "admins" | "none";
  /** Roles waarvoor 2FA verplicht is — bovenop policy. */
  two_factor_required_role_ids: string[];
  two_factor_grace_period_days: number;
  password_policy: PasswordPolicy;
  /** Sessie-duur in minuten. */
  session_idle_timeout_minutes: number;
  updated_at: string;
}

// ─── Audit-events (uitgebreide WORM) ────────────────────────────────────────

/** Geclassificeerd per category, voor kleur-coding in viewer. */
export type ExtAuditCategory =
  | "auth"
  | "writes"
  | "access"
  | "exports"
  | "consent"
  | "ai"
  | "communications"
  | "security"
  | "admin";

export interface ExtAuditEvent {
  id: string;
  tenant_id: string;
  /** ISO timestamp — WORM. */
  occurred_at: string;
  /** Stable key, bv. "user.login.success", "role.assigned". */
  action: string;
  category: ExtAuditCategory;
  /** Human-leesbare omschrijving (NL). */
  label: string;

  actor_id: string | null;
  actor_name: string;
  actor_email: string | null;
  actor_role: string | null;

  entity_type: string;
  entity_id: string;
  entity_label: string | null;

  ip_address: string | null;
  user_agent: string | null;
  request_id: string;

  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;

  /** WORM-zegel — hash voor tamper-detection. */
  worm_hash: string;
}

export interface AuditEventsCursor {
  next_cursor: string | null;
  total: number;
}

export interface AuditEventsPage {
  data: ExtAuditEvent[];
  cursor: AuditEventsCursor;
}

export interface ExtAuditFilters {
  entity_type?: string;
  user_id?: string;
  action_pattern?: string;
  category?: ExtAuditCategory;
  search?: string;
  from?: string;
  to?: string;
  cursor?: string;
}

export interface AuditExportRequest {
  format: "csv" | "ndjson";
  filters: ExtAuditFilters;
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const RBAC_RESOURCES: Array<{ key: RbacResource; label: string }> = [
  { key: "candidates", label: "Kandidaten" },
  { key: "jobs", label: "Vacatures" },
  { key: "applications", label: "Sollicitaties" },
  { key: "pipeline", label: "Pipeline" },
  { key: "interviews", label: "Interviews" },
  { key: "communications", label: "Communicatie" },
  { key: "reports", label: "Rapporten" },
  { key: "analytics", label: "Analytics" },
  { key: "billing", label: "Facturatie" },
  { key: "users", label: "Gebruikers" },
  { key: "roles", label: "Rollen & rechten" },
  { key: "settings", label: "Instellingen" },
  { key: "audit", label: "Audit-log" },
  { key: "integrations", label: "Integraties" },
];

export const RBAC_ACTIONS: Array<{ key: RbacAction; label: string }> = [
  { key: "read", label: "Lezen" },
  { key: "create", label: "Aanmaken" },
  { key: "update", label: "Bewerken" },
  { key: "delete", label: "Verwijderen" },
  { key: "export", label: "Exporteren" },
  { key: "manage", label: "Beheren (volledig)" },
];

export const EXT_AUDIT_CATEGORY_LABELS: Record<ExtAuditCategory, string> = {
  auth: "Authenticatie",
  writes: "Wijzigingen",
  access: "Toegang",
  exports: "Exports",
  consent: "Toestemmingen",
  ai: "AI",
  communications: "Communicatie",
  security: "Security-config",
  admin: "Admin-acties",
};

export const EXT_AUDIT_CATEGORY_COLORS: Record<ExtAuditCategory, string> = {
  auth: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  writes:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300",
  access: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  exports:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  consent:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  ai: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300",
  communications:
    "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300",
  security: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  admin:
    "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
};
