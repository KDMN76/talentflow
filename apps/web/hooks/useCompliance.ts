"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  RetentionPolicy,
  RetentionPolicyInput,
  DsarRequest,
  DsarRequestInput,
  DsarStatus,
  DsarRequestType,
  AuditEvent,
  AuditAction,
} from "@/lib/mockData";
import type {
  DEIFunnelReport,
  DEIFunnelSnapshot,
  PayEquityReport,
  PayEquitySnapshot,
  TenantPaySettings,
} from "@/lib/types/skills";

// ─── Types re-exported for callers ──────────────────────────────────────────

export type {
  RetentionPolicy,
  RetentionPolicyInput,
  DsarRequest,
  DsarRequestInput,
  DsarStatus,
  DsarRequestType,
  AuditEvent,
  AuditAction,
};

export interface DsarFilters {
  status?: DsarStatus | "all";
  request_type?: DsarRequestType | "all";
  from?: string;
  to?: string;
}

export interface AuditFilters {
  entity_type?: string;
  action?: AuditAction | "all";
  user_id?: string;
  search?: string;
  from?: string;
  to?: string;
}

// ─── Retention policies ──────────────────────────────────────────────────────

export function useRetentionPolicies() {
  return useQuery({
    queryKey: ["compliance", "retention-policies"],
    queryFn: async (): Promise<RetentionPolicy[]> => {
      const { data } = await api.get<{ data: RetentionPolicy[] }>(
        "/compliance/retention-policies"
      );
      return data.data;
    },
  });
}

export function useCreateRetentionPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RetentionPolicyInput): Promise<RetentionPolicy> => {
      const { data } = await api.post<RetentionPolicy>(
        "/compliance/retention-policies",
        input
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["compliance", "retention-policies"],
      });
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

export function useUpdateRetentionPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: Partial<RetentionPolicyInput> & { id: string }): Promise<RetentionPolicy> => {
      const { data } = await api.patch<RetentionPolicy>(
        `/compliance/retention-policies/${id}`,
        patch
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["compliance", "retention-policies"],
      });
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

export function useDeleteRetentionPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/compliance/retention-policies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["compliance", "retention-policies"],
      });
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

export function usePreviewRetentionPolicy() {
  return useMutation({
    mutationFn: async (
      id: string
    ): Promise<{ affected_count: number; sample_names: string[] }> => {
      const { data } = await api.get<{
        affected_count: number;
        sample_names: string[];
      }>(`/compliance/retention-policies/${id}/preview`);
      return data;
    },
  });
}

// ─── DSAR requests ───────────────────────────────────────────────────────────

export function useDsarRequests(filters: DsarFilters = {}) {
  return useQuery({
    queryKey: ["compliance", "dsar-requests", filters],
    queryFn: async (): Promise<DsarRequest[]> => {
      const { data } = await api.get<{ data: DsarRequest[] }>(
        "/compliance/dsar-requests",
        { params: filters }
      );
      return data.data;
    },
  });
}

export function useCreateDsarRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DsarRequestInput): Promise<DsarRequest> => {
      const { data } = await api.post<DsarRequest>(
        "/compliance/dsar-requests",
        input
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance", "dsar-requests"] });
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

export function useUpdateDsarRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: Partial<DsarRequest> & { id: string }): Promise<DsarRequest> => {
      const { data } = await api.patch<DsarRequest>(
        `/compliance/dsar-requests/${id}`,
        patch
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance", "dsar-requests"] });
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

export function useFulfillDsarRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      notes,
    }: {
      id: string;
      notes?: string;
    }): Promise<DsarRequest> => {
      const { data } = await api.patch<DsarRequest>(
        `/compliance/dsar-requests/${id}`,
        { status: "fulfilled", notes }
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance", "dsar-requests"] });
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

export function useDsarExportUrl() {
  return useMutation({
    mutationFn: async (id: string): Promise<{ url: string }> => {
      const { data } = await api.get<{ url: string }>(
        `/compliance/dsar-requests/${id}/export`
      );
      return data;
    },
  });
}

// ─── Candidate-level GDPR actions ────────────────────────────────────────────

export function useAnonymizeCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (candidateId: string): Promise<{ ok: true }> => {
      await api.post(`/candidates/${candidateId}/anonymize`);
      return { ok: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

export function useGenerateSelfServiceToken() {
  return useMutation({
    mutationFn: async (
      candidateId: string
    ): Promise<{ token: string; url: string }> => {
      const { data } = await api.post<{ token: string; url: string }>(
        `/candidates/${candidateId}/self-service-token`
      );
      return data;
    },
  });
}

export function useExcludeFromRetention() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      candidateId,
      reason,
    }: {
      candidateId: string;
      reason: string;
    }): Promise<{ ok: true }> => {
      await api.post(`/candidates/${candidateId}/retention-exclude`, { reason });
      return { ok: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

export function useBulkConsentRequest() {
  return useMutation({
    mutationFn: async (
      candidateIds: string[]
    ): Promise<{ sent: number }> => {
      const { data } = await api.post<{ sent: number }>(
        "/compliance/bulk-consent-request",
        { candidate_ids: candidateIds }
      );
      return data;
    },
  });
}

// ─── Audit-trail ─────────────────────────────────────────────────────────────

export function useAuditEvents(filters: AuditFilters = {}) {
  return useQuery({
    queryKey: ["compliance", "audit-events", filters],
    queryFn: async (): Promise<AuditEvent[]> => {
      const { data } = await api.get<{ data: AuditEvent[] }>(
        "/compliance/audit-events",
        { params: filters }
      );
      return data.data;
    },
  });
}

// ─── Pay Transparency settings ───────────────────────────────────────────────

export type { TenantPaySettings, PayEquityReport, PayEquitySnapshot, DEIFunnelReport, DEIFunnelSnapshot };

export function usePaySettings() {
  return useQuery({
    queryKey: ["compliance", "pay-settings"],
    queryFn: async (): Promise<TenantPaySettings> => {
      const { data } = await api.get<TenantPaySettings>(
        "/compliance/pay-settings"
      );
      return data;
    },
  });
}

export function useUpdatePaySettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      patch: Partial<TenantPaySettings>
    ): Promise<TenantPaySettings> => {
      const { data } = await api.patch<TenantPaySettings>(
        "/compliance/pay-settings",
        patch
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance", "pay-settings"] });
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

// ─── Pay Equity report ──────────────────────────────────────────────────────

export interface PayEquityFilters {
  from: string;
  to: string;
  job_category?: string | null;
}

export function usePayEquityReport(filters: PayEquityFilters | null) {
  return useQuery({
    queryKey: ["compliance", "pay-equity", filters],
    enabled: !!filters,
    queryFn: async (): Promise<PayEquityReport> => {
      const { data } = await api.post<PayEquityReport>(
        "/compliance/pay-equity",
        filters
      );
      return data;
    },
  });
}

export function usePayEquitySnapshots() {
  return useQuery({
    queryKey: ["compliance", "pay-equity-snapshots"],
    queryFn: async (): Promise<PayEquitySnapshot[]> => {
      const { data } = await api.get<{ data: PayEquitySnapshot[] }>(
        "/compliance/pay-equity/snapshots"
      );
      return data.data;
    },
  });
}

// ─── DEI funnel ─────────────────────────────────────────────────────────────

export interface DEIFunnelFilters {
  from: string;
  to: string;
}

export function useDeiFunnelReport(filters: DEIFunnelFilters | null) {
  return useQuery({
    queryKey: ["compliance", "dei-funnel", filters],
    enabled: !!filters,
    queryFn: async (): Promise<DEIFunnelReport> => {
      const { data } = await api.post<DEIFunnelReport>(
        "/compliance/dei-funnel",
        filters
      );
      return data;
    },
  });
}

export function useDeiFunnelSnapshots() {
  return useQuery({
    queryKey: ["compliance", "dei-funnel-snapshots"],
    queryFn: async (): Promise<DEIFunnelSnapshot[]> => {
      const { data } = await api.get<{ data: DEIFunnelSnapshot[] }>(
        "/compliance/dei-funnel/snapshots"
      );
      return data.data;
    },
  });
}
