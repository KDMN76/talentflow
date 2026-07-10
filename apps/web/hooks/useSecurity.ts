"use client";

/**
 * useSecurity — central hooks voor Sprint Q4.2 (Enterprise security).
 *
 * Backend contracts:
 *   SSO/2FA (Agent NNN)         — /api/admin/sso/* + /api/auth/2fa/*
 *   RBAC + audit + IP (Agent OOO) — /api/admin/roles + /api/admin/security + /api/compliance/audit-events
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  SamlConfig,
  ScimToken,
  ScimTokenGenerated,
  SsoTestResult,
  TwoFactorStatus,
  TwoFactorSetupChallenge,
  TwoFactorTenantPolicy,
  Role,
  CreateRoleInput,
  UpdateRoleInput,
  RoleAssignment,
  AssignRoleInput,
  SecuritySettings,
  IpAllowlistEntry,
  ExtAuditEvent,
  ExtAuditCategory,
  ExtAuditFilters,
  AuditEventsPage,
  PermissionGrant,
  UserPermissionMatrix,
} from "@/lib/types/security";

// ─── SSO/SAML ───────────────────────────────────────────────────────────────

export function useSsoConfig() {
  return useQuery({
    queryKey: ["security", "sso", "config"],
    queryFn: async (): Promise<SamlConfig | null> => {
      const { data } = await api.get<SamlConfig>("/admin/sso/config");
      return data;
    },
  });
}

export function useUpdateSsoConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<SamlConfig>): Promise<SamlConfig> => {
      const { data } = await api.put<SamlConfig>("/admin/sso/config", patch);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["security", "sso"] });
      qc.invalidateQueries({ queryKey: ["security", "audit"] });
    },
  });
}

export function useTestSso() {
  return useMutation({
    mutationFn: async (): Promise<SsoTestResult> => {
      const { data } = await api.post<SsoTestResult>("/admin/sso/test", {});
      return data;
    },
  });
}

export function useDisableSso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ ok: true }> => {
      await api.delete("/admin/sso/config");
      return { ok: true };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security", "sso"] }),
  });
}

// ─── SCIM ───────────────────────────────────────────────────────────────────

export function useScimToken() {
  return useQuery({
    queryKey: ["security", "scim"],
    queryFn: async (): Promise<ScimToken> => {
      const { data } = await api.get<ScimToken>("/admin/sso/scim");
      return data;
    },
  });
}

export function useGenerateScimToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<ScimTokenGenerated> => {
      const { data } = await api.post<ScimTokenGenerated>(
        "/admin/sso/scim/token",
        {}
      );
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security", "scim"] }),
  });
}

// ─── 2FA ────────────────────────────────────────────────────────────────────

export function useTwoFactorStatus() {
  return useQuery({
    queryKey: ["security", "2fa", "status"],
    queryFn: async (): Promise<TwoFactorStatus> => {
      const { data } = await api.get<TwoFactorStatus>("/auth/2fa/status");
      return data;
    },
  });
}

export function useSetup2fa() {
  return useMutation({
    mutationFn: async (): Promise<TwoFactorSetupChallenge> => {
      const { data } = await api.post<TwoFactorSetupChallenge>(
        "/auth/2fa/setup",
        {}
      );
      return data;
    },
  });
}

export function useVerify2fa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ code }: { code: string }): Promise<{ ok: true }> => {
      await api.post("/auth/2fa/verify-setup", { code });
      return { ok: true };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security", "2fa"] }),
  });
}

export function useDisable2fa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      code,
      password,
    }: {
      code: string;
      password: string;
    }): Promise<{ ok: true }> => {
      await api.post("/auth/2fa/disable", { code, password });
      return { ok: true };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security", "2fa"] }),
  });
}

export function useTwoFactorPolicy(enabled = true) {
  return useQuery({
    queryKey: ["security", "2fa", "policy"],
    enabled,
    queryFn: async (): Promise<TwoFactorTenantPolicy> => {
      const { data } = await api.get<TwoFactorTenantPolicy>("/auth/2fa/policy");
      return data;
    },
  });
}

export function useUpdateTwoFactorPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      patch: Partial<
        Pick<
          TwoFactorTenantPolicy,
          "required_for_all" | "required_for_roles" | "grace_period_days"
        >
      >
    ): Promise<TwoFactorTenantPolicy> => {
      const { data } = await api.put<TwoFactorTenantPolicy>(
        "/auth/2fa/policy",
        patch
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["security", "2fa"] });
      qc.invalidateQueries({ queryKey: ["security", "settings"] });
    },
  });
}

export function useRegenerateBackupCodes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      code,
    }: {
      code: string;
    }): Promise<{ backup_codes: string[] }> => {
      const { data } = await api.post<{ backup_codes: string[] }>(
        "/auth/2fa/backup-codes/regenerate",
        { code }
      );
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security", "2fa"] }),
  });
}

// ─── Roles + permissions ────────────────────────────────────────────────────

export function useRoles() {
  return useQuery({
    queryKey: ["security", "roles"],
    queryFn: async (): Promise<Role[]> => {
      const { data } = await api.get<{ data: Role[] }>("/roles");
      return data.data;
    },
  });
}

export function useRole(id: string | undefined) {
  return useQuery({
    queryKey: ["security", "roles", id],
    enabled: !!id,
    queryFn: async (): Promise<Role | null> => {
      if (!id) return null;
      const { data } = await api.get<Role>(`/roles/${id}`);
      return data;
    },
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRoleInput): Promise<Role> => {
      const { data } = await api.post<Role>("/admin/roles", input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security", "roles"] }),
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: UpdateRoleInput & { id: string }): Promise<Role> => {
      const { data } = await api.patch<Role>(`/admin/roles/${id}`, patch);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security", "roles"] }),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ ok: true }> => {
      await api.delete(`/admin/roles/${id}`);
      return { ok: true };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security", "roles"] }),
  });
}

// ─── Role assignments ───────────────────────────────────────────────────────

export function useUserRoles(userId: string | undefined) {
  return useQuery({
    queryKey: ["security", "user-roles", userId],
    enabled: !!userId,
    queryFn: async (): Promise<RoleAssignment[]> => {
      if (!userId) return [];
      const { data } = await api.get<{ data: RoleAssignment[] }>(
        `/admin/users/${userId}/roles`
      );
      return data.data;
    },
  });
}

export function useRoleAssignments(roleId: string | undefined) {
  return useQuery({
    queryKey: ["security", "role-assignments", roleId],
    enabled: !!roleId,
    queryFn: async (): Promise<RoleAssignment[]> => {
      if (!roleId) return [];
      const { data } = await api.get<{ data: RoleAssignment[] }>(
        `/admin/roles/${roleId}/assignments`
      );
      return data.data;
    },
  });
}

export function useAssignRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AssignRoleInput): Promise<RoleAssignment> => {
      // Backend-zod (roles.controller assignBodySchema) eist `role_key`
      // (verplicht) + optioneel `expires_at` als non-null string. `null`
      // meesturen faalt de validatie → laat 'm weg als er geen datum is.
      const { data } = await api.post<{ data: RoleAssignment }>(
        `/admin/users/${input.user_id}/roles`,
        {
          role_key: input.role_key,
          ...(input.expires_at ? { expires_at: input.expires_at } : {}),
        }
      );
      return data.data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["security", "user-roles", data.user_id] });
      qc.invalidateQueries({
        queryKey: ["security", "role-assignments", data.role_id],
      });
      qc.invalidateQueries({ queryKey: ["security", "roles"] });
    },
  });
}

export function useUnassignRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assignmentId: string): Promise<{ ok: true }> => {
      await api.delete(`/admin/role-assignments/${assignmentId}`);
      return { ok: true };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["security", "user-roles"] });
      qc.invalidateQueries({ queryKey: ["security", "role-assignments"] });
      qc.invalidateQueries({ queryKey: ["security", "roles"] });
    },
  });
}

// ─── Security settings (IP-allowlist + password policy + 2FA-policy) ───────

export function useSecuritySettings() {
  return useQuery({
    queryKey: ["security", "settings"],
    queryFn: async (): Promise<SecuritySettings> => {
      const { data } = await api.get<SecuritySettings>("/admin/security");
      return data;
    },
  });
}

export function useUpdateSecuritySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      patch: Partial<SecuritySettings>
    ): Promise<SecuritySettings> => {
      const { data } = await api.patch<SecuritySettings>(
        "/admin/security",
        patch
      );
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security", "settings"] }),
  });
}

// Backend accepteert alleen FULL REPLACEMENT van `ip_allowlist` (string[]).
// Frontend prefetcht de huidige lijst, mergt client-side en PATCHt het hele
// veld. De rijkere `IpAllowlistEntry`-metadata (label, added_at) wordt enkel
// in de UI getoond — niet gepersisteerd tot het backend-schema uitgebreid is.
async function fetchCurrentAllowlistCidrs(): Promise<string[]> {
  const { data } = await api.get<SecuritySettings>("/admin/security");
  return (data.ip_allowlist ?? []).map((e) => e.cidr);
}

export function useAddIpAllowlistEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry: {
      cidr: string;
      label?: string;
    }): Promise<SecuritySettings> => {
      const current = await fetchCurrentAllowlistCidrs();
      const merged = current.includes(entry.cidr) ? current : [...current, entry.cidr];
      const { data } = await api.patch<SecuritySettings>("/admin/security", {
        ip_allowlist: merged,
      });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security", "settings"] }),
  });
}

export function useRemoveIpAllowlistEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cidr: string): Promise<SecuritySettings> => {
      const current = await fetchCurrentAllowlistCidrs();
      const filtered = current.filter((c) => c !== cidr);
      const { data } = await api.patch<SecuritySettings>("/admin/security", {
        ip_allowlist: filtered,
      });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security", "settings"] }),
  });
}

export interface IpVerificationResult {
  ip: string;
  matches: boolean;
  matched_entry: IpAllowlistEntry | null;
}

export function useVerifyIp() {
  return useMutation({
    mutationFn: async (ip: string): Promise<IpVerificationResult> => {
      const { data } = await api.post<IpVerificationResult>(
        "/admin/security/ip-verify",
        { ip }
      );
      return data;
    },
  });
}

export function useCurrentIp() {
  return useQuery({
    queryKey: ["security", "current-ip"],
    queryFn: async (): Promise<string> => {
      const { data } = await api.get<{ ip: string }>("/admin/security/current-ip");
      return data.ip;
    },
    staleTime: 60_000,
  });
}

// ─── Audit-events (ext) ─────────────────────────────────────────────────────

// De WORM-audit-API levert een platte event-shape (`created_at`, `user_name`,
// `diff_summary`, geen `category`/`label`/`worm_hash`) en pagineert cursor-based
// via `meta.next_cursor` — niet de `{ data, cursor }`-envelope die de viewer
// verwacht. We leiden category + label af en normaliseren naar `AuditEventsPage`
// zodat de pagina niet crasht op `cursor.total` / een afwijkende event-shape.

function deriveAuditCategory(action: string): ExtAuditCategory {
  const a = (action ?? "").toLowerCase();
  if (
    a.includes("login") ||
    a.includes("logout") ||
    a.includes("logged_in") ||
    a.includes("logged_out") ||
    a.startsWith("auth") ||
    a.includes("2fa") ||
    a.includes("password")
  )
    return "auth";
  if (a.includes("consent")) return "consent";
  if (a.includes("export") || a.includes("download")) return "exports";
  if (
    a.includes("ai") ||
    a.includes("match") ||
    a.includes("talent_fit") ||
    a.includes("embedding") ||
    a.includes("dei_funnel") ||
    a.includes("pay_equity") ||
    a.includes("monitoring")
  )
    return "ai";
  if (
    a.includes("email") ||
    a.includes("whatsapp") ||
    a.includes("sms") ||
    a.includes("communication") ||
    a.includes("message") ||
    a.includes("call")
  )
    return "communications";
  if (
    a.includes("role") ||
    a.includes("permission") ||
    a.includes("sso") ||
    a.includes("scim") ||
    a.includes("api_key") ||
    a.includes("ip_") ||
    a.includes("security")
  )
    return "security";
  if (a.includes("settings") || a.startsWith("admin")) return "admin";
  if (a.includes("view") || a.includes("access") || a.includes("read"))
    return "access";
  return "writes";
}

function humanizeAction(action: string): string {
  if (!action) return "Onbekende actie";
  return action
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeExtAuditEvent(raw: unknown): ExtAuditEvent {
  const r = (raw ?? {}) as Record<string, unknown>;
  const asRecord = (v: unknown) =>
    v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  const action = (r.action as string) ?? "unknown";
  return {
    id: (r.id as string) ?? "",
    tenant_id: (r.tenant_id as string) ?? "",
    occurred_at:
      (r.occurred_at as string) ?? (r.created_at as string) ?? "",
    action,
    category:
      (r.category as ExtAuditCategory) ?? deriveAuditCategory(action),
    label: (r.label as string) ?? (r.diff_summary as string) ?? humanizeAction(action),
    actor_id: (r.actor_id as string) ?? (r.user_id as string) ?? null,
    actor_name:
      (r.actor_name as string) ?? (r.user_name as string) ?? "systeem",
    actor_email: (r.actor_email as string) ?? null,
    actor_role: (r.actor_role as string) ?? null,
    entity_type: (r.entity_type as string) ?? "",
    entity_id: (r.entity_id as string) ?? "",
    entity_label:
      (r.entity_label as string) ?? (r.related_entity_name as string) ?? null,
    ip_address: (r.ip_address as string) ?? null,
    user_agent: (r.user_agent as string) ?? null,
    request_id: (r.request_id as string) ?? "",
    before: asRecord(r.before),
    after: asRecord(r.after),
    metadata: asRecord(r.metadata),
    worm_hash: (r.worm_hash as string) ?? "",
  };
}

function normalizeAuditEventsPage(raw: unknown): AuditEventsPage {
  const body = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(body.data) ? (body.data as unknown[]) : [];
  const meta = (body.meta ?? {}) as Record<string, unknown>;
  const cursor = (body.cursor ?? {}) as Record<string, unknown>;
  const nextCursor =
    (cursor.next_cursor as string | null | undefined) ??
    (meta.next_cursor as string | null | undefined) ??
    null;
  const total =
    typeof cursor.total === "number"
      ? cursor.total
      : typeof meta.total === "number"
        ? (meta.total as number)
        : 0;
  return {
    data: list.map(normalizeExtAuditEvent),
    cursor: { next_cursor: nextCursor ?? null, total },
  };
}

export function useAuditEvents(filters: ExtAuditFilters = {}) {
  return useInfiniteQuery({
    queryKey: ["security", "audit", "events", filters],
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: AuditEventsPage) =>
      lastPage.cursor?.next_cursor ?? undefined,
    queryFn: async ({ pageParam }): Promise<AuditEventsPage> => {
      const { data } = await api.get<unknown>("/compliance/audit-events", {
        params: { ...filters, cursor: pageParam },
      });
      return normalizeAuditEventsPage(data);
    },
  });
}

export function useEntityAuditHistory(
  entityType: string | undefined,
  entityId: string | undefined
) {
  return useQuery({
    queryKey: ["security", "audit", "entity", entityType, entityId],
    enabled: !!entityType && !!entityId,
    queryFn: async (): Promise<ExtAuditEvent[]> => {
      const { data } = await api.get<{ data: ExtAuditEvent[] }>(
        `/compliance/audit-events/entity/${entityType}/${entityId}`
      );
      return data.data;
    },
  });
}

export function useExportAuditTrail() {
  return useMutation({
    mutationFn: async (params: {
      filters: ExtAuditFilters;
      format: "csv" | "ndjson";
    }): Promise<{ job_id: string; estimated_rows: number }> => {
      const { data } = await api.post<{
        job_id: string;
        estimated_rows: number;
      }>("/compliance/audit-events/export", params);
      return data;
    },
  });
}

export function useAuditActions() {
  return useQuery({
    queryKey: ["security", "audit", "actions"],
    queryFn: async (): Promise<string[]> => {
      const { data } = await api.get<{ data: string[] }>(
        "/compliance/audit-events/actions"
      );
      return data.data;
    },
    staleTime: 60_000 * 60,
  });
}

// ─── Permission matrix (current user) ───────────────────────────────────────

export function usePermissions() {
  return useQuery({
    queryKey: ["security", "permissions", "me"],
    queryFn: async (): Promise<UserPermissionMatrix> => {
      const { data } = await api.get<UserPermissionMatrix>("/permissions");
      return data;
    },
    staleTime: 60_000 * 5,
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Effectieve permissions berekenen voor een rol (incl. inheritance).
 * Pure helper — geen hook.
 */
export function effectivePermissions(
  role: Role,
  allRoles: Role[]
): PermissionGrant[] {
  const seen = new Set<string>();
  const acc: Record<string, Set<string>> = {};
  function merge(perms: PermissionGrant[]) {
    for (const p of perms) {
      if (!acc[p.resource]) acc[p.resource] = new Set();
      for (const a of p.actions) acc[p.resource].add(a);
    }
  }
  function walk(r: Role) {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    if (r.inherits_from_role_id) {
      const parent = allRoles.find((x) => x.id === r.inherits_from_role_id);
      if (parent) walk(parent);
    }
    merge(r.permissions);
  }
  walk(role);
  return Object.entries(acc).map(([resource, actions]) => ({
    resource: resource as PermissionGrant["resource"],
    actions: Array.from(actions) as PermissionGrant["actions"],
  }));
}

/** Validate CIDR-format. Returns null on valid, else error-message. */
export function validateCidr(input: string): string | null {
  const m = input.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/);
  if (!m) return "Ongeldig formaat. Gebruik bv. 10.0.0.0/24 of 91.98.232.104.";
  const [, a, b, c, d, bits] = m;
  for (const n of [a, b, c, d]) {
    const v = parseInt(n, 10);
    if (v < 0 || v > 255) return "Octet buiten bereik (0–255).";
  }
  if (bits !== undefined) {
    const v = parseInt(bits, 10);
    if (v < 0 || v > 32) return "Prefix moet tussen 0 en 32 zijn.";
  }
  return null;
}
