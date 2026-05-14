"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  mockRetentionPolicies,
  mockDsarRequests,
  mockAuditEvents,
  type RetentionPolicy,
  type RetentionPolicyInput,
  type DsarRequest,
  type DsarRequestInput,
  type DsarStatus,
  type DsarRequestType,
  type AuditEvent,
  type AuditAction,
} from "@/lib/mockData";
import {
  buildMockDEIFunnelReport,
  buildMockPayEquityReport,
  getMockDEIFunnelSnapshots,
  getMockPayEquitySnapshots,
  getMockPaySettings,
  setMockPaySettings,
} from "@/lib/mockSkills";
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

// ─── Local mock-store helpers ────────────────────────────────────────────────
//
// We import the mock arrays as `let`-style references so we can mutate them in
// the dev fallback path without losing identity for downstream readers.

let policiesStore = [...mockRetentionPolicies];
let dsarStore = [...mockDsarRequests];
let auditStore = [...mockAuditEvents];

function pushAudit(event: Omit<AuditEvent, "id" | "timestamp">) {
  const evt: AuditEvent = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    ...event,
  };
  auditStore.unshift(evt);
}

// ─── Retention policies ──────────────────────────────────────────────────────

export function useRetentionPolicies() {
  return useQuery({
    queryKey: ["compliance", "retention-policies"],
    queryFn: async (): Promise<RetentionPolicy[]> => {
      try {
        const { data } = await api.get<{ data: RetentionPolicy[] }>(
          "/compliance/retention-policies"
        );
        return data.data;
      } catch {
        return [...policiesStore];
      }
    },
  });
}

export function useCreateRetentionPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RetentionPolicyInput): Promise<RetentionPolicy> => {
      try {
        const { data } = await api.post<RetentionPolicy>(
          "/compliance/retention-policies",
          input
        );
        return data;
      } catch {
        const policy: RetentionPolicy = {
          id: `pol-${Date.now()}`,
          tenant_id: "tenant-1",
          ...input,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        policiesStore.unshift(policy);
        pushAudit({
          action: "retention_policy.created",
          entity_type: "retention_policy",
          entity_id: policy.id,
          actor_name: "Jij",
          actor_email: "kaan@talentflow.nl",
          ip_address: "10.0.0.5",
          before: null,
          after: policy as unknown as Record<string, unknown>,
        });
        return policy;
      }
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
      try {
        const { data } = await api.patch<RetentionPolicy>(
          `/compliance/retention-policies/${id}`,
          patch
        );
        return data;
      } catch {
        const idx = policiesStore.findIndex((p) => p.id === id);
        if (idx === -1) throw new Error("Beleid niet gevonden");
        const before = policiesStore[idx];
        const after: RetentionPolicy = {
          ...before,
          ...(patch as Partial<RetentionPolicy>),
          updated_at: new Date().toISOString(),
        };
        policiesStore[idx] = after;
        pushAudit({
          action: "retention_policy.updated",
          entity_type: "retention_policy",
          entity_id: id,
          actor_name: "Jij",
          actor_email: "kaan@talentflow.nl",
          ip_address: "10.0.0.5",
          before: before as unknown as Record<string, unknown>,
          after: after as unknown as Record<string, unknown>,
        });
        return after;
      }
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
      try {
        await api.delete(`/compliance/retention-policies/${id}`);
      } catch {
        const idx = policiesStore.findIndex((p) => p.id === id);
        if (idx !== -1) {
          const before = policiesStore[idx];
          policiesStore = policiesStore.filter((p) => p.id !== id);
          pushAudit({
            action: "retention_policy.deleted",
            entity_type: "retention_policy",
            entity_id: id,
            actor_name: "Jij",
            actor_email: "kaan@talentflow.nl",
            ip_address: "10.0.0.5",
            before: before as unknown as Record<string, unknown>,
            after: null,
          });
        }
      }
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
      try {
        const { data } = await api.get<{
          affected_count: number;
          sample_names: string[];
        }>(`/compliance/retention-policies/${id}/preview`);
        return data;
      } catch {
        const policy = policiesStore.find((p) => p.id === id);
        if (!policy) return { affected_count: 0, sample_names: [] };
        // Mock: simulate a count proportional to retention window
        const count = Math.max(0, 24 - policy.retention_months);
        return {
          affected_count: count,
          sample_names: [
            "Sophie van den Berg",
            "Thomas Janssen",
            "Aisha El Hamdouchi",
          ].slice(0, Math.min(3, count)),
        };
      }
    },
  });
}

// ─── DSAR requests ───────────────────────────────────────────────────────────

export function useDsarRequests(filters: DsarFilters = {}) {
  return useQuery({
    queryKey: ["compliance", "dsar-requests", filters],
    queryFn: async (): Promise<DsarRequest[]> => {
      try {
        const { data } = await api.get<{ data: DsarRequest[] }>(
          "/compliance/dsar-requests",
          { params: filters }
        );
        return data.data;
      } catch {
        return dsarStore.filter((d) => {
          if (filters.status && filters.status !== "all" && d.status !== filters.status)
            return false;
          if (
            filters.request_type &&
            filters.request_type !== "all" &&
            d.request_type !== filters.request_type
          )
            return false;
          if (filters.from && d.created_at < filters.from) return false;
          if (filters.to && d.created_at > filters.to) return false;
          return true;
        });
      }
    },
  });
}

export function useCreateDsarRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DsarRequestInput): Promise<DsarRequest> => {
      try {
        const { data } = await api.post<DsarRequest>(
          "/compliance/dsar-requests",
          input
        );
        return data;
      } catch {
        const now = new Date();
        const due = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const req: DsarRequest = {
          id: `dsar-${Date.now()}`,
          tenant_id: "tenant-1",
          candidate_id: input.candidate_id ?? null,
          candidate_name: input.candidate_name ?? null,
          request_type: input.request_type,
          requester_email: input.requester_email,
          status: "pending",
          notes: input.notes ?? null,
          fulfilled_at: null,
          export_url: null,
          due_at: due.toISOString(),
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        };
        dsarStore.unshift(req);
        pushAudit({
          action: "dsar.created",
          entity_type: "dsar_request",
          entity_id: req.id,
          actor_name: "Jij",
          actor_email: "kaan@talentflow.nl",
          ip_address: "10.0.0.5",
          before: null,
          after: req as unknown as Record<string, unknown>,
        });
        return req;
      }
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
      try {
        const { data } = await api.patch<DsarRequest>(
          `/compliance/dsar-requests/${id}`,
          patch
        );
        return data;
      } catch {
        const idx = dsarStore.findIndex((d) => d.id === id);
        if (idx === -1) throw new Error("DSAR-verzoek niet gevonden");
        const before = dsarStore[idx];
        const after: DsarRequest = {
          ...before,
          ...patch,
          updated_at: new Date().toISOString(),
        };
        dsarStore[idx] = after;
        pushAudit({
          action: "dsar.updated",
          entity_type: "dsar_request",
          entity_id: id,
          actor_name: "Jij",
          actor_email: "kaan@talentflow.nl",
          ip_address: "10.0.0.5",
          before: before as unknown as Record<string, unknown>,
          after: after as unknown as Record<string, unknown>,
        });
        return after;
      }
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
      try {
        const { data } = await api.patch<DsarRequest>(
          `/compliance/dsar-requests/${id}`,
          { status: "fulfilled", notes }
        );
        return data;
      } catch {
        const idx = dsarStore.findIndex((d) => d.id === id);
        if (idx === -1) throw new Error("DSAR-verzoek niet gevonden");
        const before = dsarStore[idx];
        const after: DsarRequest = {
          ...before,
          status: "fulfilled",
          notes: notes ?? before.notes,
          fulfilled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          export_url:
            before.request_type === "export" || before.request_type === "access"
              ? `https://files.talentflow.nl/dsar/${id}.zip`
              : before.export_url,
        };
        dsarStore[idx] = after;
        pushAudit({
          action: "dsar.fulfilled",
          entity_type: "dsar_request",
          entity_id: id,
          actor_name: "Jij",
          actor_email: "kaan@talentflow.nl",
          ip_address: "10.0.0.5",
          before: before as unknown as Record<string, unknown>,
          after: after as unknown as Record<string, unknown>,
        });
        return after;
      }
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
      try {
        const { data } = await api.get<{ url: string }>(
          `/compliance/dsar-requests/${id}/export`
        );
        return data;
      } catch {
        const req = dsarStore.find((d) => d.id === id);
        return {
          url:
            req?.export_url ??
            `https://files.talentflow.nl/dsar/${id}.zip?token=mock`,
        };
      }
    },
  });
}

// ─── Candidate-level GDPR actions ────────────────────────────────────────────

export function useAnonymizeCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (candidateId: string): Promise<{ ok: true }> => {
      try {
        await api.post(`/candidates/${candidateId}/anonymize`);
        return { ok: true };
      } catch {
        pushAudit({
          action: "candidate.anonymized",
          entity_type: "candidate",
          entity_id: candidateId,
          actor_name: "Jij",
          actor_email: "kaan@talentflow.nl",
          ip_address: "10.0.0.5",
          before: { name: "(verborgen)" },
          after: { name: "Geanonimiseerd" },
        });
        return { ok: true };
      }
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
      try {
        const { data } = await api.post<{ token: string; url: string }>(
          `/candidates/${candidateId}/self-service-token`
        );
        return data;
      } catch {
        const token = `tok_${candidateId}_${Date.now().toString(36)}`;
        return {
          token,
          url: `${
            typeof window !== "undefined" ? window.location.origin : ""
          }/portal/self-service?token=${token}`,
        };
      }
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
      try {
        await api.post(`/candidates/${candidateId}/retention-exclude`, { reason });
        return { ok: true };
      } catch {
        pushAudit({
          action: "candidate.retention_excluded",
          entity_type: "candidate",
          entity_id: candidateId,
          actor_name: "Jij",
          actor_email: "kaan@talentflow.nl",
          ip_address: "10.0.0.5",
          before: { retention_excluded: false },
          after: { retention_excluded: true, reason },
        });
        return { ok: true };
      }
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
      try {
        const { data } = await api.post<{ sent: number }>(
          "/compliance/bulk-consent-request",
          { candidate_ids: candidateIds }
        );
        return data;
      } catch {
        candidateIds.forEach((id) => {
          pushAudit({
            action: "consent.requested",
            entity_type: "candidate",
            entity_id: id,
            actor_name: "Jij",
            actor_email: "kaan@talentflow.nl",
            ip_address: "10.0.0.5",
            before: null,
            after: { channel: "email" },
          });
        });
        return { sent: candidateIds.length };
      }
    },
  });
}

// ─── Audit-trail ─────────────────────────────────────────────────────────────

export function useAuditEvents(filters: AuditFilters = {}) {
  return useQuery({
    queryKey: ["compliance", "audit-events", filters],
    queryFn: async (): Promise<AuditEvent[]> => {
      try {
        const { data } = await api.get<{ data: AuditEvent[] }>(
          "/compliance/audit-events",
          { params: filters }
        );
        return data.data;
      } catch {
        const search = filters.search?.toLowerCase().trim();
        return auditStore
          .filter((e) => {
            if (filters.entity_type && e.entity_type !== filters.entity_type)
              return false;
            if (
              filters.action &&
              filters.action !== "all" &&
              e.action !== filters.action
            )
              return false;
            if (filters.user_id && e.actor_email !== filters.user_id) return false;
            if (filters.from && e.timestamp < filters.from) return false;
            if (filters.to && e.timestamp > filters.to) return false;
            if (search) {
              const hay =
                `${e.action} ${e.entity_type} ${e.entity_id} ${e.actor_name ?? ""} ${e.actor_email ?? ""}`.toLowerCase();
              if (!hay.includes(search)) return false;
            }
            return true;
          })
          .slice(0, 200);
      }
    },
  });
}

// ─── Pay Transparency settings ───────────────────────────────────────────────

export type { TenantPaySettings, PayEquityReport, PayEquitySnapshot, DEIFunnelReport, DEIFunnelSnapshot };

export function usePaySettings() {
  return useQuery({
    queryKey: ["compliance", "pay-settings"],
    queryFn: async (): Promise<TenantPaySettings> => {
      try {
        const { data } = await api.get<TenantPaySettings>(
          "/compliance/pay-settings"
        );
        return data;
      } catch {
        return getMockPaySettings();
      }
    },
  });
}

export function useUpdatePaySettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      patch: Partial<TenantPaySettings>
    ): Promise<TenantPaySettings> => {
      try {
        const { data } = await api.patch<TenantPaySettings>(
          "/compliance/pay-settings",
          patch
        );
        return data;
      } catch {
        const next = setMockPaySettings(patch);
        pushAudit({
          action: "retention_policy.updated",
          entity_type: "pay_settings",
          entity_id: next.tenant_id,
          actor_name: "Jij",
          actor_email: "kaan@talentflow.nl",
          ip_address: "10.0.0.5",
          before: null,
          after: next as unknown as Record<string, unknown>,
        });
        return next;
      }
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
      try {
        const { data } = await api.post<PayEquityReport>(
          "/compliance/pay-equity",
          filters
        );
        return data;
      } catch {
        return buildMockPayEquityReport(
          filters!.from,
          filters!.to,
          filters!.job_category ?? null
        );
      }
    },
  });
}

export function usePayEquitySnapshots() {
  return useQuery({
    queryKey: ["compliance", "pay-equity-snapshots"],
    queryFn: async (): Promise<PayEquitySnapshot[]> => {
      try {
        const { data } = await api.get<{ data: PayEquitySnapshot[] }>(
          "/compliance/pay-equity/snapshots"
        );
        return data.data;
      } catch {
        return getMockPayEquitySnapshots();
      }
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
      try {
        const { data } = await api.post<DEIFunnelReport>(
          "/compliance/dei-funnel",
          filters
        );
        return data;
      } catch {
        return buildMockDEIFunnelReport(filters!.from, filters!.to);
      }
    },
  });
}

export function useDeiFunnelSnapshots() {
  return useQuery({
    queryKey: ["compliance", "dei-funnel-snapshots"],
    queryFn: async (): Promise<DEIFunnelSnapshot[]> => {
      try {
        const { data } = await api.get<{ data: DEIFunnelSnapshot[] }>(
          "/compliance/dei-funnel/snapshots"
        );
        return data.data;
      } catch {
        return getMockDEIFunnelSnapshots();
      }
    },
  });
}
