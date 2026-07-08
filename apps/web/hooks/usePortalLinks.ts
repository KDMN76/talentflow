"use client";

/**
 * usePortalLinks — recruiter-side hooks voor klantportaal-beheer.
 *
 * Contract met de API (apps/api modules/portal):
 *   GET    /portals                       → { data: ApiPortalLink[] }
 *   POST   /portals                       → ApiPortalLink (flat, 201)
 *   GET    /portals/:id                   → { data: ApiPortalLink }
 *   PATCH  /portals/:id                   → { data: ApiPortalLink }
 *   DELETE /portals/:id                   → { message }
 *   POST   /portals/:id/rotate-token      → { data: { token } }
 *   GET    /portals/:id/activity          → { data: ApiPortalActivity[] }
 *   GET    /portals/:id/feedback          → { data: PortalFeedbackItem[] }
 *   POST   /portals/:id/verify-domain     → { data: DomainVerification }
 *
 * De API praat in `notify_email` / `custom_domain_verified_at`; de UI werkt
 * met `notification_email` / `custom_domain_status`. De normalizers hieronder
 * vertalen in beide richtingen zodat de pagina's één stabiele shape zien.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

/* ------------------------------------------------------------------ */
/*  Types (UI-shape)                                                  */
/* ------------------------------------------------------------------ */

export interface PortalLinkPermissions {
  view_candidates: boolean;
  view_resumes: boolean;
  view_ai_scores: boolean;
  view_contact_info: boolean;
  accept_reject: boolean;
  comment: boolean;
  download_cv: boolean;
  view_pipeline_history: boolean;
}

export type PortalNotificationFrequency = "realtime" | "daily" | "weekly" | "off";

export type PortalCustomDomainStatus = "none" | "pending" | "verified" | "failed";

export interface PortalLinkBranding {
  primary_color?: string | null;
  accent_color?: string | null;
  logo_url?: string | null;
  brand_name?: string | null;
  dns_verification_token?: string | null;
}

export interface PortalLink {
  id: string;
  job_id: string;
  job_title?: string;
  token: string;
  client_name: string | null;
  permissions: PortalLinkPermissions;
  notification_email: string | null;
  notification_frequency: PortalNotificationFrequency;
  custom_domain: string | null;
  custom_domain_status: PortalCustomDomainStatus;
  custom_domain_txt_record: string | null;
  branding: PortalLinkBranding | null;
  expires_at: string | null;
  is_active: boolean;
  view_count: number;
  last_viewed_at: string | null;
  last_activity_at: string | null;
  created_at: string;
}

export type PortalActivityActionType =
  | "viewed_portal"
  | "viewed_candidate"
  | "approved_candidate"
  | "rejected_candidate"
  | "doubted_candidate"
  | "commented"
  | "general_comment"
  | "downloaded_cv";

export interface PortalActivityEvent {
  id: string;
  portal_link_id: string;
  action_type: PortalActivityActionType;
  candidate_id?: string;
  candidate_name?: string;
  actor_name?: string;
  metadata?: Record<string, string | number | boolean | null>;
  created_at: string;
}

/** Alias — de detailpagina gebruikt deze naam. */
export type PortalActivity = PortalActivityEvent;

export type PortalFeedbackAction = "approved" | "rejected" | "doubt" | "commented";

export interface PortalFeedbackItem {
  id: string;
  application_id: string | null;
  candidate_id: string | null;
  candidate_name: string | null;
  action: PortalFeedbackAction;
  comment: string | null;
  client_name: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/*  Normalizers (API-shape → UI-shape)                                */
/* ------------------------------------------------------------------ */

const DEFAULT_PERMISSIONS: PortalLinkPermissions = {
  view_candidates: true,
  view_resumes: false,
  view_ai_scores: false,
  view_contact_info: false,
  accept_reject: false,
  comment: false,
  download_cv: false,
  view_pipeline_history: false,
};

function normalizePermissions(raw: unknown): PortalLinkPermissions {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PERMISSIONS };
  const r = raw as Record<string, unknown>;
  const result = { ...DEFAULT_PERMISSIONS };
  for (const key of Object.keys(result) as Array<keyof PortalLinkPermissions>) {
    if (typeof r[key] === "boolean") result[key] = r[key] as boolean;
  }
  return result;
}

function unwrapData<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "data" in (payload as object)) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function normalizePortalLink(raw: Record<string, unknown>): PortalLink {
  const str = (k: string): string | null =>
    typeof raw[k] === "string" ? (raw[k] as string) : null;

  const branding =
    raw.branding && typeof raw.branding === "object"
      ? (raw.branding as PortalLinkBranding)
      : null;

  const customDomain = str("custom_domain");
  const verifiedAt = str("custom_domain_verified_at");
  const expiresAt = str("expires_at");
  const deletedAt = str("deleted_at");

  const status: PortalCustomDomainStatus = !customDomain
    ? "none"
    : verifiedAt
    ? "verified"
    : "pending";

  const frequency = str("notification_frequency");

  return {
    id: String(raw.id ?? ""),
    job_id: String(raw.job_id ?? ""),
    job_title: str("job_title") ?? undefined,
    token: String(raw.token ?? ""),
    client_name: str("client_name"),
    permissions: normalizePermissions(raw.permissions),
    notification_email: str("notify_email") ?? str("notification_email"),
    notification_frequency:
      frequency === "daily" || frequency === "weekly" || frequency === "off"
        ? frequency
        : "realtime",
    custom_domain: customDomain,
    custom_domain_status: status,
    custom_domain_txt_record: branding?.dns_verification_token ?? null,
    branding,
    expires_at: expiresAt,
    is_active:
      !deletedAt && (!expiresAt || new Date(expiresAt).getTime() > Date.now()),
    view_count: typeof raw.view_count === "number" ? (raw.view_count as number) : 0,
    last_viewed_at: str("last_viewed_at"),
    last_activity_at: str("last_viewed_at"),
    created_at: String(raw.created_at ?? ""),
  };
}

/** API activity-actions → UI-actietypes voor de feed. */
function normalizeActivityAction(action: unknown): PortalActivityActionType {
  switch (action) {
    case "viewed_candidate":
    case "viewed_resume":
    case "viewed_pipeline_history":
      return "viewed_candidate";
    case "accepted":
    case "approved":
      return "approved_candidate";
    case "rejected":
      return "rejected_candidate";
    case "doubted":
      return "doubted_candidate";
    case "commented":
      return "commented";
    case "general_comment":
      return "general_comment";
    case "downloaded_cv":
      return "downloaded_cv";
    default:
      return "viewed_portal";
  }
}

function normalizeActivityEvent(raw: Record<string, unknown>): PortalActivityEvent {
  const payload =
    raw.payload && typeof raw.payload === "object"
      ? (raw.payload as Record<string, string | number | boolean | null>)
      : undefined;
  return {
    id: String(raw.id ?? ""),
    portal_link_id: String(raw.portal_link_id ?? ""),
    action_type: normalizeActivityAction(raw.action ?? raw.action_type),
    candidate_id:
      typeof raw.candidate_id === "string" ? (raw.candidate_id as string) : undefined,
    candidate_name:
      typeof raw.candidate_name === "string"
        ? (raw.candidate_name as string)
        : undefined,
    actor_name:
      typeof payload?.client_name === "string" ? payload.client_name : undefined,
    metadata: payload,
    created_at: String(raw.created_at ?? ""),
  };
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
      const { data } = await api.get<unknown>("/portals", {
        params: filters.job_id ? { job_id: filters.job_id } : undefined,
      });
      let links = unwrapData<Record<string, unknown>[]>(data).map(normalizePortalLink);
      if (filters.status === "active") links = links.filter((l) => l.is_active);
      if (filters.status === "expired") links = links.filter((l) => !l.is_active);
      return links;
    },
  });
}

export function usePortalLink(id: string | undefined) {
  return useQuery({
    queryKey: ["portal-link", id],
    queryFn: async () => {
      if (!id) throw new Error("missing id");
      const { data } = await api.get<unknown>(`/portals/${id}`);
      return normalizePortalLink(unwrapData<Record<string, unknown>>(data));
    },
    enabled: !!id,
  });
}

export function usePortalActivity(id: string | undefined) {
  return useQuery({
    queryKey: ["portal-activity", id],
    queryFn: async () => {
      if (!id) return [] as PortalActivityEvent[];
      const { data } = await api.get<unknown>(`/portals/${id}/activity`);
      return unwrapData<Record<string, unknown>[]>(data).map(normalizeActivityEvent);
    },
    enabled: !!id,
  });
}

/** Gast-feedback (shortlist-beoordelingen + opmerkingen) per portal-link. */
export function usePortalLinkFeedback(id: string | undefined) {
  return useQuery({
    queryKey: ["portal-feedback", id],
    queryFn: async () => {
      if (!id) return [] as PortalFeedbackItem[];
      const { data } = await api.get<unknown>(`/portals/${id}/feedback`);
      return unwrapData<PortalFeedbackItem[]>(data);
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
  expires_at?: string | null;
}

export function useCreatePortalLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreatePortalLinkPayload): Promise<PortalLink> => {
      const { data } = await api.post<unknown>("/portals", {
        job_id: payload.job_id,
        client_name: payload.client_name ?? null,
        permissions: payload.permissions,
        expires_at: payload.expires_at ?? null,
        notify_email: payload.notification_email ?? null,
        notification_frequency: payload.notification_frequency,
      });
      return normalizePortalLink(unwrapData<Record<string, unknown>>(data));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-links"] });
    },
  });
}

export interface UpdatePortalLinkPayload {
  client_name?: string | null;
  permissions?: PortalLinkPermissions;
  notification_email?: string | null;
  notification_frequency?: PortalNotificationFrequency;
  custom_domain?: string | null;
  expires_at?: string | null;
}

export function useUpdatePortalLink(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: UpdatePortalLinkPayload): Promise<PortalLink> => {
      // UI-veldnamen → API-veldnamen
      const body: Record<string, unknown> = {};
      if (patch.client_name !== undefined) body.client_name = patch.client_name;
      if (patch.permissions !== undefined) body.permissions = patch.permissions;
      if (patch.notification_email !== undefined)
        body.notify_email = patch.notification_email;
      if (patch.notification_frequency !== undefined)
        body.notification_frequency = patch.notification_frequency;
      if (patch.custom_domain !== undefined) body.custom_domain = patch.custom_domain;
      if (patch.expires_at !== undefined) body.expires_at = patch.expires_at;

      const { data } = await api.patch<unknown>(`/portals/${id}`, body);
      return normalizePortalLink(unwrapData<Record<string, unknown>>(data));
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
      const { data } = await api.post<unknown>(`/portals/${id}/rotate-token`);
      return unwrapData<{ token: string }>(data);
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
  txt_record_host?: string;
}

export function useVerifyCustomDomain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<VerifyDomainResult> => {
      const { data } = await api.post<unknown>(`/portals/${id}/verify-domain`);
      const result = unwrapData<{
        verified?: boolean;
        verification_token?: string;
        required_records?: { txt?: { host?: string; value?: string } };
      }>(data);
      return {
        verified: Boolean(result?.verified),
        txt_record_expected:
          result?.required_records?.txt?.value ?? result?.verification_token ?? "",
        txt_record_host: result?.required_records?.txt?.host,
      };
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["portal-link", id] });
      queryClient.invalidateQueries({ queryKey: ["portal-links"] });
    },
  });
}
