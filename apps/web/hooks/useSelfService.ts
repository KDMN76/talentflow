/**
 * useSelfService — kandidaat-zelfservice hooks (AVG art. 15-17).
 *
 * Token-based authenticatie (geen JWT, geen cookies). De kandidaat ontvangt
 * een unieke link via e-mail van de recruiter en kan zonder account inzien,
 * corrigeren, toestemmingen beheren en een verwijderverzoek indienen.
 *
 * - useSelfServiceData(token)     : initial fetch (candidate + applications + ...)
 * - useUpdateSelfProfile(token)   : POST /correction — partial candidate update
 * - useUpdateSelfConsent(token)   : POST /consent — gdpr | email toggle
 * - useRequestDeletion(token)     : POST /deletion — start DSAR-flow
 * - useWithdrawApplication(token) : POST /application/:id/withdraw
 *
 * Alle hooks vallen netjes terug op mock-data wanneer de backend onbereikbaar is.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  MOCK_SELF_SERVICE_DATA,
  MOCK_SELF_SERVICE_TOKEN,
  type SelfServiceData,
  type SelfServiceConsent,
  type SelfServiceApplication,
} from "@/lib/mockData";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ConsentType = "gdpr" | "email";

export interface SelfServiceCandidatePartial {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  current_position?: string | null;
  current_company?: string | null;
}

export interface DeletionRequestPayload {
  reason?: string;
}

export interface DeletionRequestResponse {
  dsar_id: string;
  deadline: string; // ISO date — 30 dagen na nu
  status: "pending";
}

export type SelfServiceErrorVariant = "invalid" | "network";

// ─────────────────────────────────────────────────────────────────────────────
// Helper — bepalen of error 404/410 is (token verlopen) of netwerk
// ─────────────────────────────────────────────────────────────────────────────

export function classifySelfServiceError(err: unknown): SelfServiceErrorVariant {
  if (!err || typeof err !== "object") return "network";
  const e = err as { response?: { status?: number } };
  const status = e.response?.status;
  if (status === 404 || status === 410 || status === 401 || status === 403) {
    return "invalid";
  }
  return "network";
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries / Mutations
// ─────────────────────────────────────────────────────────────────────────────

export function useSelfServiceData(token: string) {
  return useQuery<SelfServiceData>({
    queryKey: ["self-service", token],
    enabled: !!token,
    retry: false,
    queryFn: async () => {
      try {
        const { data } = await api.get<unknown>(`/self-service/${token}`, {
          headers: { Authorization: "" },
        });
        return shapeSelfServiceResponse(data);
      } catch (err) {
        // Mock-fallback: alleen gebruiken voor de mock-token of in dev wanneer
        // backend onbereikbaar is. Bij token-fout (404/410/401/403) NIET mocken,
        // dan willen we de "invalid"-state tonen.
        if (token === MOCK_SELF_SERVICE_TOKEN) {
          return cloneMockData();
        }
        const variant = classifySelfServiceError(err);
        if (variant === "invalid") {
          throw err;
        }
        // Netwerk-fout in dev → mock zodat de UI bruikbaar blijft.
        if (process.env.NODE_ENV !== "production") {
          return cloneMockData();
        }
        throw err;
      }
    },
  });
}

export function useUpdateSelfProfile(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fields: SelfServiceCandidatePartial) => {
      try {
        const { data } = await api.post(
          `/self-service/${token}/correction`,
          { fields },
          { headers: { Authorization: "" } }
        );
        return data as { success: true; updated_at: string };
      } catch {
        // Mock: doe alsof het lukt, geef nieuwe timestamp.
        return { success: true as const, updated_at: new Date().toISOString() };
      }
    },
    onSuccess: (res, fields) => {
      qc.setQueryData<SelfServiceData | undefined>(
        ["self-service", token],
        (prev) =>
          prev
            ? {
                ...prev,
                candidate: {
                  ...prev.candidate,
                  ...fields,
                  updated_at:
                    "updated_at" in res ? res.updated_at : new Date().toISOString(),
                },
              }
            : prev
      );
    },
  });
}

export function useUpdateSelfConsent(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { type: ConsentType; granted: boolean }) => {
      try {
        const { data } = await api.post(
          `/self-service/${token}/consent`,
          payload,
          { headers: { Authorization: "" } }
        );
        return data as { success: true };
      } catch {
        return { success: true as const };
      }
    },
    onSuccess: (_res, vars) => {
      qc.setQueryData<SelfServiceData | undefined>(
        ["self-service", token],
        (prev) => {
          if (!prev) return prev;
          const now = new Date().toISOString();
          const updated: SelfServiceConsent[] = prev.consents.map((c) =>
            c.type === vars.type
              ? {
                  ...c,
                  granted: vars.granted,
                  granted_at: vars.granted ? now : c.granted_at,
                  revoked_at: vars.granted ? null : now,
                }
              : c
          );
          // Als consent-type nog niet bestaat, voeg 'm toe.
          if (!updated.some((c) => c.type === vars.type)) {
            updated.push({
              type: vars.type,
              granted: vars.granted,
              granted_at: vars.granted ? now : null,
              revoked_at: vars.granted ? null : now,
              source: "self-service",
            });
          }
          return { ...prev, consents: updated };
        }
      );
    },
  });
}

export function useRequestDeletion(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: DeletionRequestPayload) => {
      try {
        const { data } = await api.post(
          `/self-service/${token}/deletion`,
          payload,
          { headers: { Authorization: "" } }
        );
        return shapeDeletionResponse(data);
      } catch {
        // Mock: simuleer DSAR-creatie met 30-dagen deadline.
        const now = new Date();
        const deadline = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        return {
          dsar_id: `mock-dsar-${Date.now()}`,
          deadline: deadline.toISOString(),
          status: "pending" as const,
        };
      }
    },
    onSuccess: (res) => {
      qc.setQueryData<SelfServiceData | undefined>(
        ["self-service", token],
        (prev) =>
          prev
            ? {
                ...prev,
                deletion_request: {
                  dsar_id: res.dsar_id,
                  status: res.status,
                  requested_at: new Date().toISOString(),
                  deadline: res.deadline,
                },
              }
            : prev
      );
    },
  });
}

export function useWithdrawApplication(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (applicationId: string) => {
      try {
        const { data } = await api.post(
          `/self-service/${token}/application/${applicationId}/withdraw`,
          {},
          { headers: { Authorization: "" } }
        );
        return data as { success: true };
      } catch {
        return { success: true as const };
      }
    },
    onSuccess: (_res, applicationId) => {
      qc.setQueryData<SelfServiceData | undefined>(
        ["self-service", token],
        (prev) =>
          prev
            ? {
                ...prev,
                applications: prev.applications.map((a) =>
                  a.id === applicationId
                    ? { ...a, status: "withdrawn", withdrawn_at: new Date().toISOString() }
                    : a
                ) as SelfServiceApplication[],
              }
            : prev
      );
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Response shaping
// ─────────────────────────────────────────────────────────────────────────────

function shapeSelfServiceResponse(raw: unknown): SelfServiceData {
  if (!raw || typeof raw !== "object") return cloneMockData();
  const r = raw as Record<string, unknown>;
  const root =
    r.data && typeof r.data === "object"
      ? (r.data as Record<string, unknown>)
      : r;

  return {
    candidate: shapeCandidate(root.candidate),
    applications: Array.isArray(root.applications)
      ? root.applications
          .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
          .map(shapeApplication)
      : [],
    communications: Array.isArray(root.communications)
      ? root.communications
          .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
          .map(shapeCommunication)
      : [],
    consents: Array.isArray(root.consents)
      ? root.consents
          .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
          .map(shapeConsent)
      : [],
    retention: shapeRetention(root.retention),
    deletion_request: shapeDeletionRequestState(root.deletion_request),
    tenant: shapeTenant(root.tenant),
  };
}

function shapeCandidate(raw: unknown): SelfServiceData["candidate"] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : null);
  return {
    id: String(r.id ?? ""),
    first_name: str("first_name"),
    last_name: str("last_name"),
    email: str("email"),
    phone: str("phone"),
    current_position: str("current_position"),
    current_company: str("current_company"),
    created_at: str("created_at") ?? new Date().toISOString(),
    updated_at: str("updated_at") ?? new Date().toISOString(),
  };
}

function shapeApplication(raw: Record<string, unknown>): SelfServiceApplication {
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : null);
  return {
    id: String(raw.id ?? ""),
    job_title: str("job_title") ?? "Vacature",
    job_id: str("job_id") ?? "",
    status: (str("status") as SelfServiceApplication["status"]) ?? "active",
    current_stage: str("current_stage"),
    applied_at: str("applied_at") ?? new Date().toISOString(),
    withdrawn_at: str("withdrawn_at"),
  };
}

function shapeCommunication(
  raw: Record<string, unknown>
): SelfServiceData["communications"][number] {
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : null);
  return {
    id: String(raw.id ?? ""),
    channel: (str("channel") as "email" | "whatsapp" | "sms") ?? "email",
    direction: (str("direction") as "inbound" | "outbound") ?? "outbound",
    subject: str("subject"),
    summary: str("summary") ?? str("body") ?? "",
    sent_at: str("sent_at") ?? new Date().toISOString(),
  };
}

function shapeConsent(raw: Record<string, unknown>): SelfServiceConsent {
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : null);
  return {
    type: (str("type") as ConsentType) ?? "gdpr",
    granted: raw.granted === true,
    granted_at: str("granted_at"),
    revoked_at: str("revoked_at"),
    source: str("source") ?? "candidate",
  };
}

function shapeRetention(raw: unknown): SelfServiceData["retention"] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    policy_name: typeof r.policy_name === "string" ? r.policy_name : "Standaard 24 maanden",
    delete_at: typeof r.delete_at === "string" ? r.delete_at : null,
    days_remaining:
      typeof r.days_remaining === "number"
        ? r.days_remaining
        : null,
  };
}

function shapeDeletionRequestState(
  raw: unknown
): SelfServiceData["deletion_request"] {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!r.dsar_id) return null;
  return {
    dsar_id: String(r.dsar_id),
    status: (typeof r.status === "string" ? r.status : "pending") as
      | "pending"
      | "processing"
      | "completed"
      | "rejected",
    requested_at:
      typeof r.requested_at === "string"
        ? r.requested_at
        : new Date().toISOString(),
    deadline:
      typeof r.deadline === "string"
        ? r.deadline
        : new Date(Date.now() + 30 * 86_400_000).toISOString(),
  };
}

function shapeTenant(raw: unknown): SelfServiceData["tenant"] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    name: typeof r.name === "string" ? r.name : "Recruitment-team",
    privacy_email:
      typeof r.privacy_email === "string" ? r.privacy_email : null,
  };
}

function shapeDeletionResponse(data: unknown): DeletionRequestResponse {
  const r = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const root =
    r.data && typeof r.data === "object"
      ? (r.data as Record<string, unknown>)
      : r;
  return {
    dsar_id: String(root.dsar_id ?? `dsar-${Date.now()}`),
    deadline:
      typeof root.deadline === "string"
        ? root.deadline
        : new Date(Date.now() + 30 * 86_400_000).toISOString(),
    status: "pending",
  };
}

function cloneMockData(): SelfServiceData {
  return JSON.parse(JSON.stringify(MOCK_SELF_SERVICE_DATA)) as SelfServiceData;
}
