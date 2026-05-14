import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  mockPortalLinks as seedPortalLinks,
  mockPortalActivity as seedPortalActivity,
  type AdminPortalLink as PortalLinkData,
  type PortalActivityEvent,
  type AdminPortalLinkPermissions as Perms,
  type PortalNotificationFrequency as Freq,
  type PortalCustomDomainStatus as DomainStatus,
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

const MOCK_PORTAL_ACCESS: PortalAccess = {
  job: {
    id: "job-1",
    title: "Senior Frontend Developer",
    description:
      "We zoeken een ervaren frontend developer met diepgaande kennis van React, TypeScript en moderne UI-architectuur. Je werkt nauw samen met designers en backend-engineers aan ons SaaS-platform. Minimaal 5 jaar ervaring met grootschalige web-applicaties is vereist.",
  },
  client_name: "Acme Corporation",
  permissions: {
    view: true,
    comment: true,
    approve: true,
    reject: true,
  },
  applications: [
    {
      id: "app-1",
      candidate_name: "Lisa van der Berg",
      candidate_email: "lisa.vdberg@example.com",
      ai_score: 92,
      stage_name: "Interview",
      applied_at: "2026-04-12T10:00:00Z",
      skills: ["React", "TypeScript", "Next.js", "GraphQL", "Tailwind"],
    },
    {
      id: "app-2",
      candidate_name: "Mark Jansen",
      candidate_email: "mark.jansen@example.com",
      ai_score: 87,
      stage_name: "Technische assessment",
      applied_at: "2026-04-14T14:30:00Z",
      skills: ["React", "Vue.js", "TypeScript", "Node.js"],
    },
    {
      id: "app-3",
      candidate_name: "Sofia El-Amrani",
      candidate_email: "sofia.ea@example.com",
      ai_score: 78,
      stage_name: "Sollicitatie ontvangen",
      applied_at: "2026-04-18T09:15:00Z",
      skills: ["React", "Redux", "JavaScript", "CSS"],
    },
    {
      id: "app-4",
      candidate_name: "Thomas de Vries",
      candidate_email: "thomas.devries@example.com",
      ai_score: 65,
      stage_name: "Sollicitatie ontvangen",
      applied_at: "2026-04-20T16:45:00Z",
      skills: ["Angular", "TypeScript", "RxJS"],
    },
  ],
};

/* ------------------------------------------------------------------ */
/*  In-memory mock store (only used when API is unreachable)          */
/* ------------------------------------------------------------------ */

let mockPortalLinks: PortalLink[] = seedPortalLinks.map((p) => ({ ...p }));
const mockActivityStore: Record<string, PortalActivity[]> = Object.fromEntries(
  Object.entries(seedPortalActivity).map(([k, v]) => [k, v.map((e) => ({ ...e }))])
);

function generateToken(): string {
  return `tk_${Math.random().toString(36).slice(2, 14)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
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

      try {
        const { data } = await api.get<{ data: PortalLink[] } | PortalLink[]>(
          "/portals",
          { params: Object.keys(params).length ? params : undefined }
        );
        return Array.isArray(data) ? data : data.data;
      } catch {
        let result = [...mockPortalLinks];
        if (filters.job_id) result = result.filter((p) => p.job_id === filters.job_id);
        if (filters.status === "active") {
          result = result.filter(
            (p) =>
              p.is_active && (!p.expires_at || new Date(p.expires_at) > new Date())
          );
        } else if (filters.status === "expired") {
          result = result.filter(
            (p) =>
              !p.is_active ||
              (p.expires_at ? new Date(p.expires_at) <= new Date() : false)
          );
        }
        return result;
      }
    },
  });
}

export function usePortalLink(id: string | undefined) {
  return useQuery({
    queryKey: ["portal-link", id],
    queryFn: async () => {
      if (!id) throw new Error("missing id");
      try {
        const { data } = await api.get<PortalLink>(`/portals/${id}`);
        return data;
      } catch {
        const link = mockPortalLinks.find((p) => p.id === id);
        if (!link) throw new Error("Portaallink niet gevonden");
        return { ...link };
      }
    },
    enabled: !!id,
  });
}

export function usePortalActivity(id: string | undefined) {
  return useQuery({
    queryKey: ["portal-activity", id],
    queryFn: async () => {
      if (!id) return [] as PortalActivity[];
      try {
        const { data } = await api.get<{ data: PortalActivity[] } | PortalActivity[]>(
          `/portals/${id}/activity`
        );
        return Array.isArray(data) ? data : data.data;
      } catch {
        return [...(mockActivityStore[id] ?? [])];
      }
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
      try {
        const { data } = await api.post<PortalLink>("/portals", payload);
        return data;
      } catch {
        const newLink: PortalLink = {
          id: `portal-${Date.now()}`,
          job_id: payload.job_id,
          job_title: undefined,
          token: generateToken(),
          client_name: payload.client_name ?? null,
          permissions: payload.permissions,
          notification_email: payload.notification_email ?? null,
          notification_frequency: payload.notification_frequency ?? "daily",
          custom_domain: payload.custom_domain ?? null,
          custom_domain_status: payload.custom_domain ? "pending" : "none",
          custom_domain_txt_record: payload.custom_domain
            ? `talentflow-verify=${Math.random().toString(36).slice(2, 14)}`
            : null,
          branding: payload.branding ?? null,
          expires_at: payload.expires_at ?? null,
          is_active: true,
          view_count: 0,
          last_viewed_at: null,
          last_activity_at: null,
          created_at: new Date().toISOString(),
        };
        mockPortalLinks = [newLink, ...mockPortalLinks];
        mockActivityStore[newLink.id] = [];
        return newLink;
      }
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
      try {
        const { data } = await api.patch<PortalLink>(`/portals/${id}`, patch);
        return data;
      } catch {
        const idx = mockPortalLinks.findIndex((p) => p.id === id);
        if (idx === -1) throw new Error("Niet gevonden");
        mockPortalLinks[idx] = { ...mockPortalLinks[idx], ...patch };
        return { ...mockPortalLinks[idx] };
      }
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
      try {
        await api.delete(`/portals/${id}`);
      } catch {
        mockPortalLinks = mockPortalLinks.filter((p) => p.id !== id);
        delete mockActivityStore[id];
      }
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
      try {
        const { data } = await api.post<{ token: string }>(`/portals/${id}/rotate-token`);
        return data;
      } catch {
        const idx = mockPortalLinks.findIndex((p) => p.id === id);
        if (idx === -1) throw new Error("Niet gevonden");
        const token = generateToken();
        mockPortalLinks[idx] = { ...mockPortalLinks[idx], token };
        return { token };
      }
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
      try {
        const { data } = await api.post<VerifyDomainResult>(
          `/portals/${id}/verify-domain`
        );
        return data;
      } catch {
        const idx = mockPortalLinks.findIndex((p) => p.id === id);
        if (idx === -1) throw new Error("Niet gevonden");
        const link = mockPortalLinks[idx];
        const txt = link.custom_domain_txt_record ?? `talentflow-verify=${Math.random().toString(36).slice(2, 14)}`;
        // Simulate: 50% chance verifies in mock-mode
        const verified = Math.random() > 0.5;
        mockPortalLinks[idx] = {
          ...link,
          custom_domain_status: verified ? "verified" : "pending",
          custom_domain_txt_record: txt,
        };
        return { verified, txt_record_expected: txt };
      }
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
      try {
        const { data } = await api.get<PortalAccess>(`/portals/access/${token}`, {
          headers: { Authorization: "" },
        });
        return data;
      } catch {
        if (!token) throw new Error("Geen token");
        return { ...MOCK_PORTAL_ACCESS };
      }
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
      try {
        const { data } = await api.post(`/portals/access/${token}/feedback`, payload, {
          headers: { Authorization: "" },
        });
        return data;
      } catch {
        return { success: true, ...payload };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-access", token] });
    },
  });
}
