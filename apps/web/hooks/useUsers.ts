"use client";

/**
 * useUsers — current-user + tenant-users hooks.
 *
 * Backend contracts:
 *   GET /api/users/me  → TenantUser
 *   GET /api/users     → { data: TenantUser[]; meta: {...} } (admin-only)
 */

import { useQuery } from "@tanstack/react-query";
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
  };
}

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
