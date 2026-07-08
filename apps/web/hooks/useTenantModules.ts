"use client";

/**
 * Per-tenant module-zichtbaarheid (feature-flags) — hoort bij API migration 050.
 *
 * Backend contracts (apps/api/src/modules/tenants/moduleFlags.controller.ts):
 *   GET /api/tenants/modules → { data: { modules: ModuleFlags, module_keys: [...] } }
 *   PUT /api/tenants/modules → idem (admin-only; partial patch van bekende keys)
 *
 * Kern (dashboard, vacatures, kandidaten, pipeline, inbox, instellingen) is
 * bewust géén module-key en dus niet uitschakelbaar.
 *
 * Cache-strategie: stevige staleTime (5 min) — flags veranderen vrijwel
 * nooit en de Sidebar rendert op elke navigatie. Zolang de query nog laadt
 * geeft `useModuleFlags` `undefined` terug; consumers (Sidebar) tonen dan
 * alles (nette fallback, geen flikkerende menu-items).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const MODULE_KEYS = [
  "recruit_to_cash",
  "outreach",
  "sourcing_ai",
  "voice",
  "whatsapp",
  "job_boards",
  "career_pages",
  "portals",
  "reports_analytics",
  "compliance_plus",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ModuleFlags = Record<ModuleKey, boolean>;

interface ModulesResponse {
  data: {
    modules: ModuleFlags;
    module_keys: ModuleKey[];
  };
}

export const TENANT_MODULES_QUERY_KEY = ["tenant-modules"] as const;

export function useTenantModules() {
  return useQuery({
    queryKey: TENANT_MODULES_QUERY_KEY,
    queryFn: async (): Promise<ModuleFlags> => {
      const { data } = await api.get<ModulesResponse>("/tenants/modules");
      return data.data.modules;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    // Flags zijn niet kritisch — bij een falende call tonen consumers
    // gewoon alles; 1 stille retry is genoeg.
    retry: 1,
  });
}

/**
 * Convenience: `undefined` zolang de flags laden/falen (→ alles tonen),
 * daarna de effectieve map.
 */
export function useModuleFlags(): ModuleFlags | undefined {
  const { data } = useTenantModules();
  return data;
}

export function useUpdateTenantModules() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<ModuleFlags>): Promise<ModuleFlags> => {
      const { data } = await api.put<ModulesResponse>("/tenants/modules", patch);
      return data.data.modules;
    },
    onSuccess: (modules) => {
      queryClient.setQueryData(TENANT_MODULES_QUERY_KEY, modules);
    },
  });
}
