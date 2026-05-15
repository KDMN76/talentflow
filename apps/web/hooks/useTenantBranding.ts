"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { TenantBranding } from "@/lib/mockData";

export type { TenantBranding };

export function useTenantBranding() {
  return useQuery({
    queryKey: ["tenant-branding"],
    queryFn: async () => {
      const { data } = await api.get<TenantBranding>("/tenants/branding");
      return data;
    },
  });
}

export function useUpdateTenantBranding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<TenantBranding>) => {
      const { data } = await api.put<TenantBranding>("/tenants/branding", payload);
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["tenant-branding"], data);
    },
  });
}
