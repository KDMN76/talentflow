"use client";

/**
 * usePortal — client hooks voor de white-label klantportaal flow.
 *
 * - usePortalAccess(token)   : initial fetch (kandidaten + permissions + branding)
 * - usePortalBranding(token) : alleen branding (gebruikt door layout SSR-fetch)
 * - usePortalFeedback(token) : accept / reject / comment per kandidaat
 * - usePortalLogView(token)  : gedebounced logging van view-actie
 *
 * Alle hooks vallen netjes terug op mock-data wanneer de backend niet bereikbaar is.
 */

import { useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  MOCK_PORTAL_ACCESS_FULL,
  MOCK_PORTAL_BRANDING,
  type MockPortalAccess,
} from "@/lib/mockData";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PortalPermissions {
  view_candidates: boolean;
  view_resumes: boolean;
  view_ai_scores: boolean;
  view_contact_info: boolean;
  accept_reject: boolean;
  comment: boolean;
  download_cv: boolean;
  view_pipeline_history: boolean;
  // Legacy fields — sommige backend-versies leveren nog deze keys.
  view?: boolean;
  approve?: boolean;
  reject?: boolean;
}

export interface PortalBranding {
  brand_name: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  show_powered_by: boolean;
}

export interface PortalCommentThreadEntry {
  id: string;
  author: string | null;
  body: string;
  created_at: string;
}

export interface PortalApplication {
  id: string;
  candidate_id: string;
  candidate_name: string;
  candidate_email: string | null;
  candidate_phone: string | null;
  ai_score: number | null;
  stage_name: string | null;
  pipeline_history: Array<{ stage_name: string; entered_at: string }>;
  applied_at: string | null;
  skills: string[];
  resume_url: string | null;
  comments: PortalCommentThreadEntry[];
  client_feedback: "approve" | "reject" | "doubt" | null;
}

export interface PortalAccessData {
  job: { id: string; title: string; description: string | null };
  recruiter: { name: string; email: string | null } | null;
  client_name: string | null;
  permissions: PortalPermissions;
  branding: PortalBranding;
  applications: PortalApplication[];
  expires_at: string | null;
}

export type FeedbackAction = "approve" | "reject" | "doubt" | "comment";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PERMISSIONS: PortalPermissions = {
  view_candidates: true,
  view_resumes: false,
  view_ai_scores: false,
  view_contact_info: false,
  accept_reject: false,
  comment: false,
  download_cv: false,
  view_pipeline_history: false,
};

const DEFAULT_BRANDING: PortalBranding = {
  brand_name: null,
  logo_url: null,
  favicon_url: null,
  primary_color: "#6366f1",
  accent_color: "#8b5cf6",
  show_powered_by: true,
};

/** Normaliseer permissions van legacy backend-shapes naar de Q2.1-shape. */
export function normalizePermissions(raw: unknown): PortalPermissions {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PERMISSIONS };
  const r = raw as Record<string, unknown>;
  const bool = (k: string, fallback = false) =>
    typeof r[k] === "boolean" ? (r[k] as boolean) : fallback;

  // Legacy mapping: oude `approve`/`reject` → `accept_reject`
  const legacyAcceptReject = bool("approve") || bool("reject");

  return {
    view_candidates: bool("view_candidates", bool("view", true)),
    view_resumes: bool("view_resumes", false),
    view_ai_scores: bool("view_ai_scores", true),
    view_contact_info: bool("view_contact_info", true),
    accept_reject: bool("accept_reject", legacyAcceptReject),
    comment: bool("comment", false),
    download_cv: bool("download_cv", false),
    view_pipeline_history: bool("view_pipeline_history", false),
  };
}

export function normalizeBranding(raw: unknown): PortalBranding {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_BRANDING };
  const r = raw as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : null);
  return {
    brand_name: str("brand_name"),
    logo_url: str("logo_url"),
    favicon_url: str("favicon_url"),
    primary_color: str("primary_color") ?? DEFAULT_BRANDING.primary_color,
    accent_color: str("accent_color") ?? DEFAULT_BRANDING.accent_color,
    show_powered_by:
      typeof r["show_powered_by"] === "boolean"
        ? (r["show_powered_by"] as boolean)
        : true,
  };
}

function normalizeApplication(raw: Record<string, unknown>): PortalApplication {
  const arr = (k: string): string[] =>
    Array.isArray(raw[k]) ? ((raw[k] as unknown[]).filter((x) => typeof x === "string") as string[]) : [];

  return {
    id: String(raw.id ?? ""),
    candidate_id: String(raw.candidate_id ?? raw.id ?? ""),
    candidate_name: String(raw.candidate_name ?? "Onbekende kandidaat"),
    candidate_email: (raw.candidate_email as string | null) ?? null,
    candidate_phone: (raw.candidate_phone as string | null) ?? null,
    ai_score:
      typeof raw.ai_score === "number"
        ? (raw.ai_score as number)
        : raw.ai_score == null
        ? null
        : Number(raw.ai_score) || null,
    stage_name: (raw.stage_name as string | null) ?? null,
    pipeline_history: Array.isArray(raw.pipeline_history)
      ? ((raw.pipeline_history as unknown[]).filter(
          (x) => x && typeof x === "object"
        ) as PortalApplication["pipeline_history"])
      : [],
    applied_at: (raw.applied_at as string | null) ?? null,
    skills: arr("skills"),
    resume_url: (raw.resume_url as string | null) ?? null,
    comments: Array.isArray(raw.comments)
      ? ((raw.comments as unknown[]).filter(
          (x) => x && typeof x === "object"
        ) as PortalCommentThreadEntry[])
      : [],
    client_feedback:
      raw.client_feedback === "approve" ||
      raw.client_feedback === "reject" ||
      raw.client_feedback === "doubt"
        ? raw.client_feedback
        : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Server-side fetch (door layout) — geen react-query.
// ─────────────────────────────────────────────────────────────────────────────

const SERVER_API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
  "http://localhost:4000/api";

/**
 * Fetch branding op server-side (in layout). Faalt zonder errors — fallback naar
 * default branding zodat de portal-pagina altijd rendert (ook bij DB-/API-uitval).
 */
export async function fetchPortalBrandingServer(
  token: string
): Promise<PortalBranding> {
  if (!token) return { ...DEFAULT_BRANDING };
  try {
    const res = await fetch(`${SERVER_API_BASE}/portal/branding/${token}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error("branding fetch failed");
    const json = (await res.json()) as { branding?: unknown } | unknown;
    const branding =
      typeof json === "object" && json !== null && "branding" in json
        ? (json as { branding?: unknown }).branding
        : json;
    return normalizeBranding(branding);
  } catch {
    return { ...MOCK_PORTAL_BRANDING };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Client hooks
// ─────────────────────────────────────────────────────────────────────────────

export function usePortalAccess(token: string) {
  return useQuery<PortalAccessData>({
    queryKey: ["portal-access-v2", token],
    enabled: !!token,
    retry: false,
    queryFn: async () => {
      try {
        const { data } = await api.get<unknown>(`/portal/access/${token}`, {
          headers: { Authorization: "" },
        });
        return shapePortalResponse(data);
      } catch {
        // Probeer legacy endpoint /portals/access/:token (Q1 backend).
        try {
          const { data } = await api.get<unknown>(`/portals/access/${token}`, {
            headers: { Authorization: "" },
          });
          return shapePortalResponse(data);
        } catch {
          if (!token) throw new Error("Geen token");
          return mockAccessFor(token);
        }
      }
    },
  });
}

export function usePortalBranding(token: string) {
  return useQuery<PortalBranding>({
    queryKey: ["portal-branding", token],
    enabled: !!token,
    retry: false,
    queryFn: async () => {
      try {
        const { data } = await api.get<unknown>(`/portal/branding/${token}`, {
          headers: { Authorization: "" },
        });
        const branding =
          typeof data === "object" && data !== null && "branding" in data
            ? (data as { branding?: unknown }).branding
            : data;
        return normalizeBranding(branding);
      } catch {
        return { ...MOCK_PORTAL_BRANDING };
      }
    },
  });
}

export function usePortalFeedback(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      application_id: string;
      action: FeedbackAction;
      comment?: string;
      client_name?: string;
    }) => {
      try {
        const { data } = await api.post(
          `/portal/${token}/feedback`,
          payload,
          { headers: { Authorization: "" } }
        );
        return data;
      } catch {
        // Legacy endpoint
        try {
          const legacyAction =
            payload.action === "approve"
              ? "approve"
              : payload.action === "reject"
              ? "reject"
              : "comment";
          const { data } = await api.post(
            `/portals/access/${token}/feedback`,
            { ...payload, action: legacyAction },
            { headers: { Authorization: "" } }
          );
          return data;
        } catch {
          // Mock: imiteer success-response zodat UI optimistic update kan doen.
          return { success: true, ...payload };
        }
      }
    },
    onSuccess: (_, vars) => {
      // Optimistic cache-update voor de kandidaat zonder volledige refetch.
      queryClient.setQueryData<PortalAccessData | undefined>(
        ["portal-access-v2", token],
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            applications: prev.applications.map((a) =>
              a.id !== vars.application_id
                ? a
                : {
                    ...a,
                    client_feedback:
                      vars.action === "comment"
                        ? a.client_feedback
                        : (vars.action as PortalApplication["client_feedback"]),
                    comments:
                      vars.action === "comment" && vars.comment
                        ? [
                            ...a.comments,
                            {
                              id: `local-${Date.now()}`,
                              author: vars.client_name ?? null,
                              body: vars.comment,
                              created_at: new Date().toISOString(),
                            },
                          ]
                        : a.comments,
                  }
            ),
          };
        }
      );
    },
  });
}

/**
 * usePortalLogView — debounced logging van view-actie.
 * Stuurt per kandidaat hooguit één keer per 30s een log-event om backend niet te
 * spammen (intersection-observer kan vaak triggeren). Volledig fire-and-forget.
 */
export function usePortalLogView(token: string) {
  const lastLoggedRef = useRef<Map<string, number>>(new Map());

  return useCallback(
    (candidateId: string) => {
      if (!token || !candidateId) return;
      const now = Date.now();
      const prev = lastLoggedRef.current.get(candidateId) ?? 0;
      if (now - prev < 30_000) return;
      lastLoggedRef.current.set(candidateId, now);

      // Fire-and-forget — backend logt het, fout = stilletjes negeren.
      api
        .post(
          `/portal/${token}/log-view/${candidateId}`,
          {},
          { headers: { Authorization: "" } }
        )
        .catch(() => {
          // Geen retry — log-view is best-effort.
        });
    },
    [token]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Response shaping + mock fallback
// ─────────────────────────────────────────────────────────────────────────────

function shapePortalResponse(data: unknown): PortalAccessData {
  const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;

  // Sommige backends nesten alles onder { portal, applications, branding },
  // andere geven het flat terug. We handelen beide af.
  const portal =
    obj.portal && typeof obj.portal === "object"
      ? (obj.portal as Record<string, unknown>)
      : obj;

  const job = (obj.job ?? portal.job ?? {}) as Record<string, unknown>;
  const recruiter = (obj.recruiter ?? portal.recruiter ?? null) as
    | { name?: string; email?: string | null }
    | null;

  const apps = (obj.applications ?? portal.applications ?? []) as unknown[];

  return {
    job: {
      id: String(job.id ?? ""),
      title: String(job.title ?? "Vacature"),
      description: (job.description as string | null) ?? null,
    },
    recruiter:
      recruiter && typeof recruiter === "object" && recruiter.name
        ? {
            name: String(recruiter.name),
            email: (recruiter.email as string | null) ?? null,
          }
        : null,
    client_name: (obj.client_name ?? portal.client_name ?? null) as string | null,
    permissions: normalizePermissions(obj.permissions ?? portal.permissions),
    branding: normalizeBranding(obj.branding ?? portal.branding),
    applications: apps
      .filter((a) => a && typeof a === "object")
      .map((a) => normalizeApplication(a as Record<string, unknown>)),
    expires_at: (obj.expires_at ?? portal.expires_at ?? null) as string | null,
  };
}

function mockAccessFor(_token: string): PortalAccessData {
  return cloneMockAccess(MOCK_PORTAL_ACCESS_FULL);
}

function cloneMockAccess(src: MockPortalAccess): PortalAccessData {
  return {
    ...src,
    applications: src.applications.map((a) => ({
      ...a,
      pipeline_history: [...a.pipeline_history],
      skills: [...a.skills],
      comments: a.comments.map((c) => ({ ...c })),
    })),
    branding: { ...src.branding },
    permissions: { ...src.permissions },
  };
}

export const PORTAL_BRANDING_DEFAULTS = DEFAULT_BRANDING;
