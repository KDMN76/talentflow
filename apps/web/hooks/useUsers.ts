"use client";

/**
 * useUsers — current-user + tenant-users hooks.
 *
 * Backend contracts:
 *   GET /api/users/me  → TenantUser
 *   GET /api/users     → { data: TenantUser[]; meta: {...} } (admin-only)
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface TenantUser {
  id: string;
  email: string;
  name: string;
  role: string;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
}

interface CurrentUser extends TenantUser {
  tenant_id?: string;
  tenant?: {
    id: string;
    name: string;
    plan?: string;
    /** Tenant-instellingen-JSON (o.a. `timezone`). */
    settings?: { timezone?: string; [key: string]: unknown } | null;
  };
  /** Eigen UI-taalvoorkeur; null = erf de tenant-default. */
  language?: string | null;
  /** Tenant-brede default-taal (tenants.default_language). */
  tenant_default_language?: string | null;
}

/** Rollen die uitgenodigd kunnen worden (spiegelt de API-inviteSchema-enum). */
export type InviteRole = "admin" | "recruiter" | "hiring_manager" | "viewer";

export function useCurrentUser() {
  return useQuery({
    queryKey: ["users", "me"],
    queryFn: async (): Promise<CurrentUser> => {
      const { data } = await api.get<CurrentUser>("/users/me");
      return data;
    },
    staleTime: 60_000 * 5,
  });
}

export function useTenantUsers() {
  return useQuery({
    queryKey: ["users", "tenant"],
    queryFn: async (): Promise<TenantUser[]> => {
      const { data } = await api.get<{ data: TenantUser[] }>("/users", {
        params: { limit: 100 },
      });
      return data.data;
    },
    staleTime: 60_000,
  });
}

/**
 * Eigen wachtwoord wijzigen. `current_password` wordt server-side geverifieerd
 * (PATCH /users/me → 400 INVALID_CURRENT_PASSWORD bij mismatch).
 */
export function useChangePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { current_password: string; password: string }) => {
      const { data } = await api.patch("/users/me", payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users", "me"] });
    },
  });
}

/** Teamlid uitnodigen (admin/super_admin only) — POST /users/invite. */
export function useInviteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { email: string; name: string; role: InviteRole }) => {
      const { data } = await api.post("/users/invite", payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users", "tenant"] });
    },
  });
}

/** Organisatiegegevens bijwerken — PATCH /tenants/current (timezone in settings). */
export function useUpdateTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { name?: string; settings?: Record<string, unknown> }) => {
      const { data } = await api.patch("/tenants/current", payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users", "me"] });
    },
  });
}
