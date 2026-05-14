"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ── Types ───────────────────────────────────────────────────────────────────

export interface Webhook {
  id: string;
  name: string;
  description?: string | null;
  url: string;
  events: string[];
  active: boolean;
  secret?: string;
  failure_count?: number;
  last_delivered_at?: string | null;
  last_failure_at?: string | null;
  created_at: string;
}

export type DeliveryStatus =
  | "pending"
  | "delivering"
  | "succeeded"
  | "failed"
  | "dead";

export interface WebhookDelivery {
  id: string;
  subscription_id: string;
  event_type: string;
  event_id: string | null;
  status: DeliveryStatus;
  attempt: number;
  response_status: number | null;
  duration_ms: number | null;
  error_message: string | null;
  created_at: string;
  delivered_at: string | null;
  next_retry_at: string | null;
}

export interface WebhookDeliveryDetail extends WebhookDelivery {
  payload: Record<string, unknown>;
  request_url: string;
  request_headers: Record<string, string> | null;
  request_body: string | null;
  response_headers: Record<string, string> | null;
  response_body: string | null;
}

export interface DeliveryFilters {
  subscription_id?: string;
  event_type?: string;
  status?: DeliveryStatus;
  from?: string;
  to?: string;
  limit?: number;
}

export interface TestWebhookResult {
  status: number | null;
  duration_ms: number;
  error: string | null;
  signature: string;
  response_body: string | null;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const WEBHOOK_EVENTS = [
  { value: "candidate.created", label: "Kandidaat aangemaakt" },
  { value: "candidate.updated", label: "Kandidaat bijgewerkt" },
  { value: "candidate.deleted", label: "Kandidaat verwijderd" },
  { value: "candidate.stage_changed", label: "Fase gewijzigd" },
  { value: "job.created", label: "Vacature aangemaakt" },
  { value: "job.updated", label: "Vacature bijgewerkt" },
  { value: "job.filled", label: "Vacature gevuld" },
  { value: "job.closed", label: "Vacature gesloten" },
  { value: "application.created", label: "Nieuwe sollicitatie" },
  { value: "application.rejected", label: "Sollicitatie afgewezen" },
  { value: "application.hired", label: "Kandidaat aangenomen" },
  { value: "interview.scheduled", label: "Interview gepland" },
  { value: "interview.completed", label: "Interview afgerond" },
  { value: "communication.sent", label: "Bericht verstuurd" },
  { value: "communication.received", label: "Bericht ontvangen" },
];

// ── Mock data ──────────────────────────────────────────────────────────────

const MOCK_WEBHOOKS: Webhook[] = [
  {
    id: "wh-1",
    name: "Slack notificaties",
    description: "Stuur belangrijke recruitment-events naar #recruiting",
    url: "https://hooks.slack.com/services/T0/B0/abc",
    events: ["candidate.created", "job.filled", "application.hired"],
    active: true,
    secret: "whsec_demo_slack_x".padEnd(40, "0"),
    failure_count: 0,
    last_delivered_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    last_failure_at: null,
    created_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  },
  {
    id: "wh-2",
    name: "HRM systeem sync",
    description: "Sync hires naar legacy HRM voor onboarding",
    url: "https://hrm.bedrijf.nl/webhook/talentflow",
    events: ["application.hired", "candidate.stage_changed"],
    active: true,
    secret: "whsec_demo_hrm_y".padEnd(40, "0"),
    failure_count: 7,
    last_delivered_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    last_failure_at: new Date(Date.now() - 4 * 3_600_000).toISOString(),
    created_at: new Date(Date.now() - 60 * 86_400_000).toISOString(),
  },
  {
    id: "wh-3",
    name: "Analytics pipeline",
    description: "Disabled — wordt vervangen door direct DB-export",
    url: "https://analytics.intern/ingest",
    events: ["*"],
    active: false,
    secret: "whsec_demo_analytics".padEnd(40, "0"),
    failure_count: 0,
    last_delivered_at: null,
    last_failure_at: null,
    created_at: new Date(Date.now() - 90 * 86_400_000).toISOString(),
  },
];

let mockWebhooks = [...MOCK_WEBHOOKS];

function buildMockDeliveries(): WebhookDelivery[] {
  const types = WEBHOOK_EVENTS.map((e) => e.value);
  const statuses: DeliveryStatus[] = [
    "succeeded",
    "succeeded",
    "succeeded",
    "succeeded",
    "succeeded",
    "succeeded",
    "succeeded",
    "succeeded",
    "failed",
    "failed",
    "dead",
    "pending",
  ];
  const out: WebhookDelivery[] = [];
  for (let i = 0; i < 50; i++) {
    const status = statuses[i % statuses.length];
    const sub = mockWebhooks[i % mockWebhooks.length];
    const respStatus =
      status === "succeeded"
        ? 200
        : status === "failed"
        ? 500 + (i % 4)
        : status === "dead"
        ? 503
        : null;
    out.push({
      id: `del-${i + 1}`,
      subscription_id: sub.id,
      event_type: types[i % types.length],
      event_id: `${i.toString(16).padStart(8, "0")}-0000-0000-0000-000000000000`,
      status,
      attempt: status === "dead" ? 5 : status === "failed" ? 2 : 1,
      response_status: respStatus,
      duration_ms: status === "pending" ? null : 80 + (i * 13) % 400,
      error_message:
        status === "succeeded" || status === "pending"
          ? null
          : status === "dead"
          ? "Max retries exceeded"
          : `HTTP ${respStatus}`,
      created_at: new Date(Date.now() - i * 1_800_000).toISOString(),
      delivered_at:
        status === "pending"
          ? null
          : new Date(Date.now() - i * 1_800_000 + 2_000).toISOString(),
      next_retry_at:
        status === "failed"
          ? new Date(Date.now() + 5 * 60_000).toISOString()
          : null,
    });
  }
  return out;
}

let mockDeliveries = buildMockDeliveries();

// ── Subscription queries / mutations ───────────────────────────────────────

export function useWebhooks() {
  return useQuery({
    queryKey: ["webhooks"],
    queryFn: async () => {
      try {
        const { data } = await api.get<Webhook[]>("/webhooks/subscriptions");
        return Array.isArray(data) ? data : [];
      } catch {
        return [...mockWebhooks];
      }
    },
  });
}

export const useWebhookSubscriptions = useWebhooks;

export function useCreateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      name: string;
      url: string;
      events: string[];
      description?: string;
    }): Promise<Webhook> => {
      try {
        const { data } = await api.post<Webhook>("/webhooks/subscriptions", payload);
        return data;
      } catch {
        const newWebhook: Webhook = {
          id: `wh-${Date.now()}`,
          name: payload.name,
          description: payload.description ?? null,
          url: payload.url,
          events: payload.events,
          active: true,
          secret: `whsec_${Math.random().toString(16).slice(2, 12).padEnd(10, "0")}`,
          failure_count: 0,
          last_delivered_at: null,
          last_failure_at: null,
          created_at: new Date().toISOString(),
        };
        mockWebhooks.unshift(newWebhook);
        return newWebhook;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });
}

export const useCreateSubscription = useCreateWebhook;

export function useUpdateWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<Pick<Webhook, "name" | "url" | "events" | "active" | "description">>;
    }): Promise<Webhook> => {
      try {
        const { data } = await api.patch<Webhook>(
          `/webhooks/subscriptions/${input.id}`,
          input.patch
        );
        return data;
      } catch {
        const idx = mockWebhooks.findIndex((w) => w.id === input.id);
        if (idx === -1) throw new Error("Niet gevonden");
        mockWebhooks[idx] = { ...mockWebhooks[idx], ...input.patch };
        return mockWebhooks[idx];
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });
}

export const useUpdateSubscription = useUpdateWebhook;

export function useDeleteWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      try {
        await api.delete(`/webhooks/subscriptions/${id}`);
      } catch {
        mockWebhooks = mockWebhooks.filter((w) => w.id !== id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });
}

export const useDeleteSubscription = useDeleteWebhook;

export function useToggleWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<Webhook> => {
      try {
        const { data } = await api.patch<Webhook>(
          `/webhooks/subscriptions/${id}/toggle`
        );
        return data;
      } catch {
        const idx = mockWebhooks.findIndex((w) => w.id === id);
        if (idx === -1) throw new Error("Webhook niet gevonden");
        mockWebhooks[idx] = { ...mockWebhooks[idx], active: !mockWebhooks[idx].active };
        return mockWebhooks[idx];
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });
}

export function useRotateWebhookSecret() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ id: string; secret: string }> => {
      try {
        const { data } = await api.post<{ id: string; secret: string }>(
          `/webhooks/subscriptions/${id}/rotate-secret`
        );
        return data;
      } catch {
        const idx = mockWebhooks.findIndex((w) => w.id === id);
        const newSecret = `whsec_${Math.random().toString(16).slice(2, 12).padEnd(10, "0")}`;
        if (idx !== -1) {
          mockWebhooks[idx] = { ...mockWebhooks[idx], secret: newSecret };
        }
        return { id, secret: newSecret };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });
}

// ── Delivery queries / mutations ──────────────────────────────────────────

export function useWebhookDeliveries(filters: DeliveryFilters = {}) {
  return useQuery({
    queryKey: ["webhook-deliveries", filters],
    queryFn: async () => {
      try {
        const { data } = await api.get<WebhookDelivery[]>("/webhooks/deliveries", {
          params: filters,
        });
        return Array.isArray(data) ? data : [];
      } catch {
        let list = [...mockDeliveries];
        if (filters.subscription_id) {
          list = list.filter((d) => d.subscription_id === filters.subscription_id);
        }
        if (filters.event_type) {
          list = list.filter((d) => d.event_type === filters.event_type);
        }
        if (filters.status) {
          list = list.filter((d) => d.status === filters.status);
        }
        if (filters.limit) {
          list = list.slice(0, filters.limit);
        }
        return list;
      }
    },
  });
}

export function useDeliveryDetails(id: string | null) {
  return useQuery({
    queryKey: ["webhook-delivery", id],
    enabled: !!id,
    queryFn: async (): Promise<WebhookDeliveryDetail | null> => {
      if (!id) return null;
      try {
        const { data } = await api.get<WebhookDeliveryDetail>(
          `/webhooks/deliveries/${id}`
        );
        return data;
      } catch {
        const base = mockDeliveries.find((d) => d.id === id);
        if (!base) return null;
        return {
          ...base,
          payload: {
            entity_id: base.event_id,
            sample: true,
            timestamp: base.created_at,
          },
          request_url: "https://hooks.example.com/incoming",
          request_headers: {
            "Content-Type": "application/json",
            "X-TalentFlow-Event": base.event_type,
            "X-TalentFlow-Signature": "sha256=mock_signature_here",
          },
          request_body: JSON.stringify(
            { event: base.event_type, delivery_id: base.id, data: { entity_id: base.event_id } },
            null,
            2
          ),
          response_headers:
            base.status === "pending"
              ? null
              : { "Content-Type": "text/plain", "Server": "nginx" },
          response_body:
            base.status === "succeeded"
              ? "OK"
              : base.status === "pending"
              ? null
              : `Internal error: receiver returned ${base.response_status}`,
        };
      }
    },
  });
}

export function useRetryDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      try {
        const { data } = await api.post<{ delivery_id: string }>(
          `/webhooks/deliveries/${id}/retry`
        );
        return data;
      } catch {
        const idx = mockDeliveries.findIndex((d) => d.id === id);
        if (idx !== -1) {
          mockDeliveries[idx] = {
            ...mockDeliveries[idx],
            status: "pending",
            attempt: Math.min(mockDeliveries[idx].attempt + 1, 5),
            error_message: null,
          };
        }
        return { delivery_id: id };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhook-deliveries"] });
    },
  });
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: async (input: {
      url: string;
      event_type: string;
      payload?: Record<string, unknown>;
    }): Promise<TestWebhookResult> => {
      try {
        const { data } = await api.post<TestWebhookResult>("/webhooks/test", input);
        return data;
      } catch {
        // Pure client-side mock: fake een 200 OK response na ~120ms delay.
        await new Promise((r) => setTimeout(r, 120));
        return {
          status: 200,
          duration_ms: 120,
          error: null,
          signature: `sha256=${Math.random().toString(16).slice(2)}`,
          response_body: "OK (mocked)",
        };
      }
    },
  });
}

export function useWebhookEventTypes() {
  return useQuery({
    queryKey: ["webhook-event-types"],
    queryFn: async (): Promise<string[]> => {
      try {
        const { data } = await api.get<{ event_types: string[] }>(
          "/webhooks/event-types"
        );
        return data.event_types;
      } catch {
        return WEBHOOK_EVENTS.map((e) => e.value);
      }
    },
  });
}
