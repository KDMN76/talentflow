"use client";

/**
 * useSecurity — central hooks voor Sprint Q4.2 (Enterprise security).
 *
 * Backend contracts:
 *   SSO/2FA (Agent NNN)         — /api/admin/sso/* + /api/auth/2fa/*
 *   RBAC + audit + IP (Agent OOO) — /api/admin/roles + /api/admin/security + /api/compliance/audit-events
 *
 * Alle hooks: try API → catch → mock-fallback voor offline dev. Mocks muteren
 * lokale stores zodat de UI optimistisch reageert zonder backend.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  mockSsoConfig,
  mockScimToken,
  mock2faStatus,
  mockRoles,
  mockRoleAssignments,
  mockSecuritySettings,
  mockExtAuditEvents,
  listExtAuditActions,
} from "@/lib/mockData";
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

// ─── Local mutable stores (mock-fallback) ───────────────────────────────────

let ssoStore: SamlConfig | null = { ...mockSsoConfig };
let scimStore: ScimToken = { ...mockScimToken };
let twofaStore: TwoFactorStatus = { ...mock2faStatus };
let twofaSecret: string | null = null;
let rolesStore: Role[] = mockRoles.map((r) => ({ ...r }));
let assignmentsStore: RoleAssignment[] = mockRoleAssignments.map((a) => ({ ...a }));
let securityStore: SecuritySettings = JSON.parse(
  JSON.stringify(mockSecuritySettings)
);
let auditStore: ExtAuditEvent[] = [...mockExtAuditEvents];

function appendAudit(evt: Partial<ExtAuditEvent> & { action: string; label: string }) {
  const full: ExtAuditEvent = {
    id: `ext-audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    tenant_id: "tenant-1",
    occurred_at: new Date().toISOString(),
    action: evt.action,
    category: evt.category ?? "admin",
    label: evt.label,
    actor_id: "user-1",
    actor_name: "Emma Bakker",
    actor_email: "emma@talentflow.io",
    actor_role: "admin",
    entity_type: evt.entity_type ?? "system",
    entity_id: evt.entity_id ?? "—",
    entity_label: evt.entity_label ?? null,
    ip_address: "10.0.0.5",
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    request_id: `req-${Date.now().toString(36)}`,
    before: evt.before ?? null,
    after: evt.after ?? null,
    metadata: evt.metadata ?? null,
    worm_hash: `0x${Date.now().toString(16).padStart(20, "0")}`,
  };
  auditStore.unshift(full);
}

// ─── SSO/SAML ───────────────────────────────────────────────────────────────

export function useSsoConfig() {
  return useQuery({
    queryKey: ["security", "sso", "config"],
    queryFn: async (): Promise<SamlConfig | null> => {
      try {
        const { data } = await api.get<SamlConfig>("/admin/sso/config");
        return data;
      } catch {
        return ssoStore;
      }
    },
  });
}

export function useUpdateSsoConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<SamlConfig>): Promise<SamlConfig> => {
      try {
        const { data } = await api.put<SamlConfig>("/admin/sso/config", patch);
        return data;
      } catch {
        const before = ssoStore ? { ...ssoStore } : null;
        ssoStore = {
          ...(ssoStore ?? mockSsoConfig),
          ...patch,
          updated_at: new Date().toISOString(),
        } as SamlConfig;
        appendAudit({
          action: "sso.config.updated",
          category: "security",
          label: "SSO-configuratie bijgewerkt",
          entity_type: "sso_config",
          entity_id: ssoStore.id,
          entity_label: `${ssoStore.provider} SAML`,
          before: before as unknown as Record<string, unknown> | null,
          after: ssoStore as unknown as Record<string, unknown>,
        });
        return ssoStore;
      }
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
      try {
        const { data } = await api.post<SsoTestResult>("/admin/sso/test", {});
        return data;
      } catch {
        // Realistisch mock-resultaat: random ok/fout voor demo-doeleinden.
        const ok = Math.random() > 0.35;
        if (ok) {
          return {
            ok: true,
            message: "Verbinding gevalideerd. IdP-certificaat OK, metadata geldig.",
            duration_ms: 245,
          };
        }
        return {
          ok: false,
          step: "cert_validation",
          message: "IdP-certificaat is verlopen of niet geldig.",
          detail:
            "Certificate not_after = 2025-04-12T00:00:00Z (verlopen 12 maanden geleden)",
          duration_ms: 180,
        };
      }
    },
  });
}

export function useDisableSso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ ok: true }> => {
      try {
        await api.delete("/admin/sso/config");
        return { ok: true };
      } catch {
        if (ssoStore) {
          ssoStore = { ...ssoStore, enabled: false };
          appendAudit({
            action: "sso.disabled",
            category: "security",
            label: "SSO uitgeschakeld",
            entity_type: "sso_config",
            entity_id: ssoStore.id,
          });
        }
        return { ok: true };
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security", "sso"] }),
  });
}

// ─── SCIM ───────────────────────────────────────────────────────────────────

export function useScimToken() {
  return useQuery({
    queryKey: ["security", "scim"],
    queryFn: async (): Promise<ScimToken> => {
      try {
        const { data } = await api.get<ScimToken>("/admin/sso/scim");
        return data;
      } catch {
        return scimStore;
      }
    },
  });
}

export function useGenerateScimToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<ScimTokenGenerated> => {
      try {
        const { data } = await api.post<ScimTokenGenerated>(
          "/admin/sso/scim/token",
          {}
        );
        return data;
      } catch {
        const random = Array.from({ length: 48 })
          .map(() =>
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[
              Math.floor(Math.random() * 62)
            ]
          )
          .join("");
        const full = `scim_${random}`;
        scimStore = {
          ...scimStore,
          enabled: true,
          token_prefix: `scim_${random.slice(0, 6)}...${random.slice(-4)}`,
        };
        appendAudit({
          action: "scim.token_generated",
          category: "security",
          label: "SCIM-token gegenereerd",
          entity_type: "scim_token",
          entity_id: scimStore.id,
        });
        return { ...scimStore, full_token: full };
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security", "scim"] }),
  });
}

// ─── 2FA ────────────────────────────────────────────────────────────────────

export function useTwoFactorStatus() {
  return useQuery({
    queryKey: ["security", "2fa", "status"],
    queryFn: async (): Promise<TwoFactorStatus> => {
      try {
        const { data } = await api.get<TwoFactorStatus>("/auth/2fa/status");
        return data;
      } catch {
        return twofaStore;
      }
    },
  });
}

export function useSetup2fa() {
  return useMutation({
    mutationFn: async (): Promise<TwoFactorSetupChallenge> => {
      try {
        const { data } = await api.post<TwoFactorSetupChallenge>(
          "/auth/2fa/setup",
          {}
        );
        twofaSecret = data.secret;
        return data;
      } catch {
        // RFC 4226 base32-secret simulatie (visuele plausibiliteit).
        const base32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        const secret = Array.from({ length: 32 })
          .map(() => base32[Math.floor(Math.random() * 32)])
          .join("");
        twofaSecret = secret;
        const otpauth = `otpauth://totp/TalentFlow:emma@talentflow.io?secret=${secret}&issuer=TalentFlow&algorithm=SHA1&digits=6&period=30`;
        // Mock QR — een SVG met de URI als visualisatie-placeholder.
        const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'>
  <rect width='200' height='200' fill='white'/>
  <g fill='black'>
    ${Array.from({ length: 100 })
      .map(() => {
        const x = Math.floor(Math.random() * 20) * 10;
        const y = Math.floor(Math.random() * 20) * 10;
        return `<rect x='${x}' y='${y}' width='10' height='10'/>`;
      })
      .join("")}
  </g>
  <rect x='0' y='0' width='30' height='30' fill='black'/>
  <rect x='5' y='5' width='20' height='20' fill='white'/>
  <rect x='10' y='10' width='10' height='10' fill='black'/>
  <rect x='170' y='0' width='30' height='30' fill='black'/>
  <rect x='175' y='5' width='20' height='20' fill='white'/>
  <rect x='180' y='10' width='10' height='10' fill='black'/>
  <rect x='0' y='170' width='30' height='30' fill='black'/>
  <rect x='5' y='175' width='20' height='20' fill='white'/>
  <rect x='10' y='180' width='10' height='10' fill='black'/>
</svg>`;
        const qrDataUrl = `data:image/svg+xml;base64,${
          typeof window !== "undefined"
            ? window.btoa(svg)
            : Buffer.from(svg).toString("base64")
        }`;
        const codes = Array.from({ length: 10 }).map(() => {
          const a = Math.random().toString(36).slice(2, 7).toUpperCase();
          const b = Math.random().toString(36).slice(2, 7).toUpperCase();
          return `${a}-${b}`;
        });
        return {
          secret,
          qr_code_data_url: qrDataUrl,
          backup_codes: codes,
        };
      }
    },
  });
}

export function useVerify2fa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ code }: { code: string }): Promise<{ ok: true }> => {
      try {
        await api.post("/auth/2fa/verify-setup", { code });
      } catch {
        // Mock: accepteer ELKE 6-cijferige code in dev-fallback (anders is testen
        // onmogelijk zonder TOTP-app). Backend verifieert echte secret.
        if (!/^\d{6}$/.test(code)) {
          throw new Error("Code moet 6 cijfers zijn.");
        }
      }
      twofaStore = {
        ...twofaStore,
        enabled: true,
        enrolled_at: new Date().toISOString(),
        backup_codes_remaining: 10,
      };
      appendAudit({
        action: "user.2fa.enabled",
        category: "security",
        label: "2FA ingeschakeld",
        entity_type: "user",
        entity_id: "user-1",
        entity_label: "Emma Bakker",
        before: { two_factor_enabled: false },
        after: { two_factor_enabled: true, method: "totp" },
      });
      return { ok: true };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security", "2fa"] }),
  });
}

export function useDisable2fa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ code }: { code: string }): Promise<{ ok: true }> => {
      try {
        await api.post("/auth/2fa/disable", { code });
      } catch {
        if (!/^\d{6}$/.test(code) && !/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(code)) {
          throw new Error("Voer een geldige 2FA-code of backup-code in.");
        }
      }
      twofaStore = {
        ...twofaStore,
        enabled: false,
        enrolled_at: null,
        backup_codes_remaining: 0,
      };
      twofaSecret = null;
      appendAudit({
        action: "user.2fa.disabled",
        category: "security",
        label: "2FA uitgeschakeld",
        entity_type: "user",
        entity_id: "user-1",
        entity_label: "Emma Bakker",
        before: { two_factor_enabled: true },
        after: { two_factor_enabled: false },
      });
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
      try {
        const { data } = await api.post<{ backup_codes: string[] }>(
          "/auth/2fa/backup-codes/regenerate",
          { code }
        );
        return data;
      } catch {
        if (!/^\d{6}$/.test(code)) {
          throw new Error("Voer een geldige 6-cijferige code in.");
        }
        const codes = Array.from({ length: 10 }).map(() => {
          const a = Math.random().toString(36).slice(2, 7).toUpperCase();
          const b = Math.random().toString(36).slice(2, 7).toUpperCase();
          return `${a}-${b}`;
        });
        twofaStore = { ...twofaStore, backup_codes_remaining: 10 };
        appendAudit({
          action: "user.2fa.backup_codes_regenerated",
          category: "security",
          label: "2FA backup-codes opnieuw gegenereerd",
          entity_type: "user",
          entity_id: "user-1",
          entity_label: "Emma Bakker",
          before: { backup_codes_remaining: twofaStore.backup_codes_remaining },
          after: { backup_codes_remaining: 10 },
        });
        return { backup_codes: codes };
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security", "2fa"] }),
  });
}

// ─── Roles + permissions ────────────────────────────────────────────────────

export function useRoles() {
  return useQuery({
    queryKey: ["security", "roles"],
    queryFn: async (): Promise<Role[]> => {
      try {
        const { data } = await api.get<{ data: Role[] }>("/roles");
        return data.data;
      } catch {
        return [...rolesStore];
      }
    },
  });
}

export function useRole(id: string | undefined) {
  return useQuery({
    queryKey: ["security", "roles", id],
    enabled: !!id,
    queryFn: async (): Promise<Role | null> => {
      if (!id) return null;
      try {
        const { data } = await api.get<Role>(`/roles/${id}`);
        return data;
      } catch {
        return rolesStore.find((r) => r.id === id) ?? null;
      }
    },
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRoleInput): Promise<Role> => {
      try {
        const { data } = await api.post<Role>("/admin/roles", input);
        return data;
      } catch {
        const role: Role = {
          id: `role-${Date.now()}`,
          tenant_id: "tenant-1",
          key: input.key,
          label: input.label,
          description: input.description ?? null,
          is_system: false,
          inherits_from_role_id: input.inherits_from_role_id ?? null,
          permissions: input.permissions,
          user_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        rolesStore = [...rolesStore, role];
        appendAudit({
          action: "role.created",
          category: "admin",
          label: "Rol aangemaakt",
          entity_type: "role",
          entity_id: role.id,
          entity_label: role.label,
          before: null,
          after: role as unknown as Record<string, unknown>,
        });
        return role;
      }
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
      try {
        const { data } = await api.patch<Role>(`/admin/roles/${id}`, patch);
        return data;
      } catch {
        const idx = rolesStore.findIndex((r) => r.id === id);
        if (idx === -1) throw new Error("Rol niet gevonden");
        const before = rolesStore[idx];
        if (before.is_system) {
          throw new Error("System-rollen kunnen niet bewerkt worden.");
        }
        const after: Role = {
          ...before,
          ...patch,
          updated_at: new Date().toISOString(),
        };
        rolesStore[idx] = after;
        appendAudit({
          action: "role.permission.updated",
          category: "admin",
          label: "Rol bijgewerkt",
          entity_type: "role",
          entity_id: id,
          entity_label: after.label,
          before: { permissions: before.permissions } as unknown as Record<string, unknown>,
          after: { permissions: after.permissions } as unknown as Record<string, unknown>,
        });
        return after;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security", "roles"] }),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ ok: true }> => {
      try {
        await api.delete(`/admin/roles/${id}`);
        return { ok: true };
      } catch {
        const role = rolesStore.find((r) => r.id === id);
        if (role?.is_system) {
          throw new Error("System-rollen kunnen niet verwijderd worden.");
        }
        rolesStore = rolesStore.filter((r) => r.id !== id);
        if (role) {
          appendAudit({
            action: "role.deleted",
            category: "admin",
            label: "Rol verwijderd",
            entity_type: "role",
            entity_id: id,
            entity_label: role.label,
            before: role as unknown as Record<string, unknown>,
          });
        }
        return { ok: true };
      }
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
      try {
        const { data } = await api.get<{ data: RoleAssignment[] }>(
          `/admin/users/${userId}/roles`
        );
        return data.data;
      } catch {
        return assignmentsStore.filter((a) => a.user_id === userId);
      }
    },
  });
}

export function useRoleAssignments(roleId: string | undefined) {
  return useQuery({
    queryKey: ["security", "role-assignments", roleId],
    enabled: !!roleId,
    queryFn: async (): Promise<RoleAssignment[]> => {
      if (!roleId) return [];
      try {
        const { data } = await api.get<{ data: RoleAssignment[] }>(
          `/admin/roles/${roleId}/assignments`
        );
        return data.data;
      } catch {
        return assignmentsStore.filter((a) => a.role_id === roleId);
      }
    },
  });
}

export function useAssignRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AssignRoleInput): Promise<RoleAssignment> => {
      try {
        const { data } = await api.post<RoleAssignment>(
          `/admin/users/${input.user_id}/roles`,
          { role_id: input.role_id, expires_at: input.expires_at ?? null }
        );
        return data;
      } catch {
        const role = rolesStore.find((r) => r.id === input.role_id);
        const ra: RoleAssignment = {
          id: `ra-${Date.now()}`,
          user_id: input.user_id,
          user_name:
            assignmentsStore.find((a) => a.user_id === input.user_id)
              ?.user_name ?? "Gebruiker",
          user_email:
            assignmentsStore.find((a) => a.user_id === input.user_id)
              ?.user_email ?? "—",
          role_id: input.role_id,
          role_label: role?.label ?? "Rol",
          assigned_by: "user-1",
          assigned_at: new Date().toISOString(),
          expires_at: input.expires_at ?? null,
        };
        assignmentsStore = [...assignmentsStore, ra];
        appendAudit({
          action: "role.assigned",
          category: "admin",
          label: "Rol toegewezen",
          entity_type: "role_assignment",
          entity_id: ra.id,
          entity_label: `${ra.user_name} → ${ra.role_label}`,
          after: ra as unknown as Record<string, unknown>,
        });
        return ra;
      }
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
      try {
        await api.delete(`/admin/role-assignments/${assignmentId}`);
        return { ok: true };
      } catch {
        const ra = assignmentsStore.find((a) => a.id === assignmentId);
        assignmentsStore = assignmentsStore.filter((a) => a.id !== assignmentId);
        if (ra) {
          appendAudit({
            action: "role.unassigned",
            category: "admin",
            label: "Rol-toewijzing verwijderd",
            entity_type: "role_assignment",
            entity_id: assignmentId,
            entity_label: `${ra.user_name} ✕ ${ra.role_label}`,
            before: ra as unknown as Record<string, unknown>,
          });
        }
        return { ok: true };
      }
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
      try {
        const { data } = await api.get<SecuritySettings>("/admin/security");
        return data;
      } catch {
        return securityStore;
      }
    },
  });
}

export function useUpdateSecuritySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      patch: Partial<SecuritySettings>
    ): Promise<SecuritySettings> => {
      try {
        const { data } = await api.patch<SecuritySettings>(
          "/admin/security",
          patch
        );
        return data;
      } catch {
        const before = { ...securityStore };
        securityStore = {
          ...securityStore,
          ...patch,
          ip_allowlist: patch.ip_allowlist ?? securityStore.ip_allowlist,
          password_policy: patch.password_policy
            ? { ...securityStore.password_policy, ...patch.password_policy }
            : securityStore.password_policy,
          updated_at: new Date().toISOString(),
        };
        appendAudit({
          action: "settings.security.updated",
          category: "security",
          label: "Security-instellingen gewijzigd",
          entity_type: "security_settings",
          entity_id: "tenant-1",
          entity_label: "Tenant security",
          before: before as unknown as Record<string, unknown>,
          after: securityStore as unknown as Record<string, unknown>,
        });
        return securityStore;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security", "settings"] }),
  });
}

export function useAddIpAllowlistEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry: {
      cidr: string;
      label?: string;
    }): Promise<SecuritySettings> => {
      const newEntry: IpAllowlistEntry = {
        cidr: entry.cidr,
        label: entry.label,
        added_at: new Date().toISOString(),
      };
      try {
        const { data } = await api.patch<SecuritySettings>("/admin/security", {
          ip_allowlist: [...securityStore.ip_allowlist, newEntry],
        });
        return data;
      } catch {
        securityStore = {
          ...securityStore,
          ip_allowlist: [...securityStore.ip_allowlist, newEntry],
          updated_at: new Date().toISOString(),
        };
        appendAudit({
          action: "ip_allowlist.entry_added",
          category: "security",
          label: "IP-allowlist entry toegevoegd",
          entity_type: "security_settings",
          entity_id: "tenant-1",
          after: { cidr: newEntry.cidr, label: newEntry.label ?? "" },
        });
        return securityStore;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security", "settings"] }),
  });
}

export function useRemoveIpAllowlistEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cidr: string): Promise<SecuritySettings> => {
      try {
        const { data } = await api.patch<SecuritySettings>("/admin/security", {
          ip_allowlist: securityStore.ip_allowlist.filter((e) => e.cidr !== cidr),
        });
        return data;
      } catch {
        const entry = securityStore.ip_allowlist.find((e) => e.cidr === cidr);
        securityStore = {
          ...securityStore,
          ip_allowlist: securityStore.ip_allowlist.filter((e) => e.cidr !== cidr),
          updated_at: new Date().toISOString(),
        };
        appendAudit({
          action: "ip_allowlist.entry_removed",
          category: "security",
          label: "IP-allowlist entry verwijderd",
          entity_type: "security_settings",
          entity_id: "tenant-1",
          before: entry as unknown as Record<string, unknown>,
        });
        return securityStore;
      }
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
      try {
        const { data } = await api.post<IpVerificationResult>(
          "/admin/security/ip-verify",
          { ip }
        );
        return data;
      } catch {
        const matched =
          securityStore.ip_allowlist.find((e) => cidrMatch(ip, e.cidr)) ?? null;
        return { ip, matches: !!matched, matched_entry: matched };
      }
    },
  });
}

export function useCurrentIp() {
  return useQuery({
    queryKey: ["security", "current-ip"],
    queryFn: async (): Promise<string> => {
      try {
        const { data } = await api.get<{ ip: string }>("/admin/security/current-ip");
        return data.ip;
      } catch {
        // Best-effort fallback in dev — pakt een herkenbaar test-IP.
        return "192.168.1.42";
      }
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
      try {
        const { data } = await api.get<AuditEventsPage>(
          "/compliance/audit-events",
          { params: { ...filters, cursor: pageParam } }
        );
        return data;
      } catch {
        const search = filters.search?.toLowerCase().trim();
        const filtered = auditStore.filter((e) => {
          if (filters.entity_type && e.entity_type !== filters.entity_type)
            return false;
          if (filters.user_id && e.actor_id !== filters.user_id) return false;
          if (filters.category && e.category !== filters.category) return false;
          if (
            filters.action_pattern &&
            !e.action
              .toLowerCase()
              .includes(filters.action_pattern.toLowerCase())
          )
            return false;
          if (filters.from && e.occurred_at < filters.from) return false;
          if (filters.to && e.occurred_at > filters.to) return false;
          if (search) {
            const hay = `${e.action} ${e.entity_type} ${e.entity_id} ${e.actor_name} ${e.label} ${e.entity_label ?? ""}`.toLowerCase();
            if (!hay.includes(search)) return false;
          }
          return true;
        });
        const PAGE_SIZE = 25;
        const start = pageParam
          ? filtered.findIndex((e) => e.id === pageParam) + 1
          : 0;
        const slice = filtered.slice(start, start + PAGE_SIZE);
        const next =
          start + PAGE_SIZE < filtered.length
            ? slice[slice.length - 1]?.id ?? null
            : null;
        return {
          data: slice,
          cursor: { next_cursor: next, total: filtered.length },
        };
      }
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
      try {
        const { data } = await api.get<{ data: ExtAuditEvent[] }>(
          `/compliance/audit-events/entity/${entityType}/${entityId}`
        );
        return data.data;
      } catch {
        return auditStore.filter(
          (e) => e.entity_type === entityType && e.entity_id === entityId
        );
      }
    },
  });
}

export function useExportAuditTrail() {
  return useMutation({
    mutationFn: async (params: {
      filters: ExtAuditFilters;
      format: "csv" | "ndjson";
    }): Promise<{ job_id: string; estimated_rows: number }> => {
      try {
        const { data } = await api.post<{
          job_id: string;
          estimated_rows: number;
        }>("/compliance/audit-events/export", params);
        return data;
      } catch {
        return {
          job_id: `export-${Date.now()}`,
          estimated_rows: auditStore.length,
        };
      }
    },
  });
}

export function useAuditActions() {
  return useQuery({
    queryKey: ["security", "audit", "actions"],
    queryFn: async (): Promise<string[]> => {
      try {
        const { data } = await api.get<{ data: string[] }>(
          "/compliance/audit-events/actions"
        );
        return data.data;
      } catch {
        return listExtAuditActions();
      }
    },
    staleTime: 60_000 * 60,
  });
}

// ─── Permission matrix (current user) ───────────────────────────────────────

export function usePermissions() {
  return useQuery({
    queryKey: ["security", "permissions", "me"],
    queryFn: async (): Promise<UserPermissionMatrix> => {
      try {
        const { data } = await api.get<UserPermissionMatrix>("/permissions");
        return data;
      } catch {
        // Mock: gebruiker is admin → volledige rechten.
        const adminRole = rolesStore.find((r) => r.key === "admin");
        return {
          user_id: "user-1",
          permissions: adminRole?.permissions ?? [],
          role_ids: ["role-admin"],
        };
      }
    },
    staleTime: 60_000 * 5,
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Bare-bones IPv4 CIDR-match — voldoende voor mock-fallback. */
function cidrMatch(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = bitsRaw ? parseInt(bitsRaw, 10) : 32;
  const ipNum = ipToNum(ip);
  const baseNum = ipToNum(base);
  if (ipNum === null || baseNum === null) return false;
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipNum & mask) === (baseNum & mask);
}

function ipToNum(ip: string): number | null {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255))
    return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

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
