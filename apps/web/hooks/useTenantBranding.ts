"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { mockTenantBranding, type TenantBranding } from "@/lib/mockData";

export type { TenantBranding };

let mockBrandingStore: TenantBranding = { ...mockTenantBranding };

export function useTenantBranding() {
  return useQuery({
    queryKey: ["tenant-branding"],
    queryFn: async () => {
      try {
        const { data } = await api.get<TenantBranding>("/tenants/branding");
        return data;
      } catch {
        return { ...mockBrandingStore };
      }
    },
  });
}

export function useUpdateTenantBranding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<TenantBranding>) => {
      try {
        const { data } = await api.put<TenantBranding>("/tenants/branding", payload);
        return data;
      } catch {
        mockBrandingStore = { ...mockBrandingStore, ...payload };
        return { ...mockBrandingStore };
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["tenant-branding"], data);
    },
  });
}
