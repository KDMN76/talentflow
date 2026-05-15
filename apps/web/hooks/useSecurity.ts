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
  Role,
  CreateRoleInput,
  UpdateRoleInput,
  RoleAssignment,
  AssignRoleInput,
  SecuritySettings,
  IpAllowlistEntry,
  ExtAuditEvent,
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
    mutationFn: async ({ code }: { code: string }): Promise<{ ok: true }> => {
      await api.post("/auth/2fa/disable", { code });
      return { ok: true };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security", "2fa"] }),
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
      const { data } = await api.post<RoleAssignment>(
        `/admin/users/${input.user_id}/roles`,
        { role_id: input.role_id, expires_at: input.expires_at ?? null }
      );
      return data;
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

export function useAuditEvents(filters: ExtAuditFilters = {}) {
  return useInfiniteQuery({
    queryKey: ["security", "audit", "events", filters],
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: AuditEventsPage) =>
      lastPage.cursor.next_cursor ?? undefined,
    queryFn: async ({ pageParam }): Promise<AuditEventsPage> => {
      const { data } = await api.get<AuditEventsPage>(
        "/compliance/audit-events",
        { params: { ...filters, cursor: pageParam } }
      );
      return data;
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
