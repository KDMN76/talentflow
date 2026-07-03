"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TenantEmailSettings {
  tenant_id: string;
  from_name: string | null;
  reply_to: string | null;
  smtp_enabled: boolean;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: boolean;
  smtp_user: string | null;
  smtp_from: string | null;
  /** Afgeleid op de server — het wachtwoord zelf komt nooit terug. */
  smtp_pass_set: boolean;
  updated_at: string | null;
  /** Globaal geverifieerd afzender-adres (voor de preview). */
  global_from_address: string;
}

export interface TenantEmailSettingsInput {
  from_name?: string | null;
  reply_to?: string | null;
  smtp_enabled?: boolean;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_secure?: boolean;
  smtp_user?: string | null;
  /** Write-only: weglaten = ongewijzigd, "" of null = wissen. */
  smtp_pass?: string | null;
  smtp_from?: string | null;
}

export interface TestEmailResult {
  sent: boolean;
  to: string;
  provider: "resend" | "smtp";
  mocked: boolean;
  messageId: string;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

export function useTenantEmailSettings() {
  return useQuery({
    queryKey: ["tenant-email-settings"],
    queryFn: async () => {
      const { data } = await api.get<{ data: TenantEmailSettings }>(
        "/tenants/email-settings"
      );
      return data.data;
    },
  });
}

export function useUpdateTenantEmailSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: TenantEmailSettingsInput) => {
      const { data } = await api.put<{ data: TenantEmailSettings }>(
        "/tenants/email-settings",
        payload
      );
      return data.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["tenant-email-settings"], data);
    },
  });
}

export function useSendTestEmail() {
  return useMutation({
    mutationFn: async (): Promise<TestEmailResult> => {
      const { data } = await api.post<{ data: TestEmailResult }>(
        "/tenants/email-settings/test",
        {}
      );
      return data.data;
    },
  });
}
