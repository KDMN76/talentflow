"use client";

/**
 * Tenant-branding hooks — gekoppeld aan de echte API (Sprint white-label).
 *
 * Shape volgt apps/api/src/modules/tenants/branding.service.ts (snake_case,
 * zelfde veldnamen als de DB): brand_name en email_footer — NIET de oude
 * mockData-velden brand_name_override / email_footer_html.
 *
 * Endpoints:
 *   GET    /tenants/branding        → { data: TenantBranding | null }
 *   PUT    /tenants/branding        → partial upsert (undefined = niet aanraken,
 *                                     null = expliciet wissen)
 *   POST   /tenants/branding/logo   → multipart (veld `logo`, PNG/JPG/SVG ≤ 1MB)
 *   DELETE /tenants/branding/logo   → verwijdert geüpload logo + storage-object
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface TenantBranding {
  tenant_id: string;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  brand_name: string | null;
  email_footer: string | null;
  updated_at: string;
}

/** Alleen de bewerkbare velden; logo_url wordt via de upload-endpoints beheerd. */
export type TenantBrandingInput = Partial<
  Pick<
    TenantBranding,
    | "logo_url"
    | "favicon_url"
    | "primary_color"
    | "accent_color"
    | "brand_name"
    | "email_footer"
  >
>;

export const TENANT_BRANDING_QUERY_KEY = ["tenant-branding"] as const;

export function useTenantBranding() {
  return useQuery({
    queryKey: TENANT_BRANDING_QUERY_KEY,
    queryFn: async (): Promise<TenantBranding | null> => {
      const { data } = await api.get<{ data: TenantBranding | null }>(
        "/tenants/branding"
      );
      return data.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateTenantBranding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: TenantBrandingInput) => {
      const { data } = await api.put<{ data: TenantBranding }>(
        "/tenants/branding",
        payload
      );
      return data.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(TENANT_BRANDING_QUERY_KEY, data);
    },
  });
}

/**
 * Multipart logo-upload. Server valideert magic bytes + SVG-scrub en geeft
 * bij afwijzing een { error: { code, message } }-body terug (zie
 * brandingLogo.service.ts).
 */
export function useUploadTenantLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("logo", file);
      const { data } = await api.post<{ data: TenantBranding }>(
        "/tenants/branding/logo",
        form,
        // Override de default application/json van de axios-instance zodat
        // de browser de multipart-boundary zet.
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      return data.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(TENANT_BRANDING_QUERY_KEY, data);
    },
  });
}

export function useDeleteTenantLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.delete<{ data: TenantBranding | null }>(
        "/tenants/branding/logo"
      );
      return data.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(TENANT_BRANDING_QUERY_KEY, data);
    },
  });
}
