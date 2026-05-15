"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  AdminPortalLink as PortalLinkData,
  PortalActivityEvent,
  AdminPortalLinkPermissions as Perms,
  PortalNotificationFrequency as Freq,
  PortalCustomDomainStatus as DomainStatus,
} from "@/lib/mockData";

/**
 * The permission-set is intentionally rich (8 toggles) so portal-owners can
 * give clients exactly the access they need — view-only, full review, or any
 * curated mix in between.  Backend (Agent EE) accepts the same shape.
 *
 * Aligned with FF's klant-side portal: same 8 permission keys are exposed to
 * the public `/portal/<token>` page, so toggling one flag flows end-to-end.
 */
export type PortalLinkPermissions = Perms;
export type PortalNotificationFrequency = Freq;
export type PortalCustomDomainStatus = DomainStatus;
export type PortalLink = PortalLinkData;
export type PortalActivity = PortalActivityEvent;

/**
 * Legacy shape used only by the old `/portal/[token]` page (FF-side).
 * Kept for backwards compatibility while FF migrates to the new schema.
 */
export interface LegacyPortalPermissions {
  view: boolean;
  comment: boolean;
  approve: boolean;
  reject: boolean;
}

export interface PortalAccess {
  job: { id: string; title: string; description: string };
  client_name: string | null;
  permissions: LegacyPortalPermissions;
  applications: Array<{
    id: string;
    candidate_name: string;
    candidate_email: string;
    ai_score: number | null;
    stage_name: string;
    applied_at: string;
    skills: string[];
  }>;
}

/* ------------------------------------------------------------------ */
/*  Filter shapes                                                     */
/* ------------------------------------------------------------------ */

export interface PortalLinkFilters {
  job_id?: string;
  status?: "all" | "active" | "expired";
}

/* ------------------------------------------------------------------ */
/*  Queries                                                           */
/* ------------------------------------------------------------------ */

export function usePortalLinks(filters: PortalLinkFilters = {}) {
  return useQuery({
    queryKey: ["portal-links", filters],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (filters.job_id) params.job_id = filters.job_id;
      if (filters.status && filters.status !== "all") params.status = filters.status;

      const { data } = await api.get<{ data: PortalLink[] } | PortalLink[]>(
        "/portals",
        { params: Object.keys(params).length ? params : undefined }
      );
      return Array.isArray(data) ? data : data.data;
    },
  });
}

export function usePortalLink(id: string | undefined) {
  return useQuery({
    queryKey: ["portal-link", id],
    queryFn: async () => {
      if (!id) throw new Error("missing id");
      const { data } = await api.get<PortalLink>(`/portals/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function usePortalActivity(id: string | undefined) {
  return useQuery({
    queryKey: ["portal-activity", id],
    queryFn: async () => {
      if (!id) return [] as PortalActivity[];
      const { data } = await api.get<{ data: PortalActivity[] } | PortalActivity[]>(
        `/portals/${id}/activity`
      );
      return Array.isArray(data) ? data : data.data;
    },
    enabled: !!id,
  });
}

/* ------------------------------------------------------------------ */
/*  Mutations                                                         */
/* ------------------------------------------------------------------ */

export interface CreatePortalLinkPayload {
  job_id: string;
  client_name?: string | null;
  permissions: PortalLinkPermissions;
  notification_email?: string | null;
  notification_frequency?: PortalNotificationFrequency;
  custom_domain?: string | null;
  branding?: { primary_color?: string; logo_url?: string | null } | null;
  expires_at?: string | null;
}

export function useCreatePortalLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreatePortalLinkPayload): Promise<PortalLink> => {
      const { data } = await api.post<PortalLink>("/portals", payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-links"] });
    },
  });
}

export function useUpdatePortalLink(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<PortalLink>): Promise<PortalLink> => {
      const { data } = await api.patch<PortalLink>(`/portals/${id}`, patch);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-links"] });
      queryClient.invalidateQueries({ queryKey: ["portal-link", id] });
    },
  });
}

export function useDeletePortalLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/portals/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-links"] });
    },
  });
}

export function useRotatePortalToken(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ token: string }> => {
      const { data } = await api.post<{ token: string }>(`/portals/${id}/rotate-token`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-links"] });
      queryClient.invalidateQueries({ queryKey: ["portal-link", id] });
    },
  });
}

export interface VerifyDomainResult {
  verified: boolean;
  txt_record_expected: string;
}

export function useVerifyCustomDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<VerifyDomainResult> => {
      const { data } = await api.post<VerifyDomainResult>(
        `/portals/${id}/verify-domain`
      );
      return data;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["portal-link", id] });
      queryClient.invalidateQueries({ queryKey: ["portal-links"] });
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Public klant-side endpoints (FF — read-only, kept intact)         */
/* ------------------------------------------------------------------ */

export function usePortalAccess(token: string) {
  return useQuery({
    queryKey: ["portal-access", token],
    queryFn: async () => {
      const { data } = await api.get<PortalAccess>(`/portals/access/${token}`, {
        headers: { Authorization: "" },
      });
      return data;
    },
    enabled: !!token,
    retry: false,
  });
}

export function useSubmitFeedback(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      application_id: string;
      action: "approve" | "reject" | "comment";
      comment?: string;
      client_name?: string;
    }) => {
      const { data } = await api.post(`/portals/access/${token}/feedback`, payload, {
        headers: { Authorization: "" },
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-access", token] });
    },
  });
}
