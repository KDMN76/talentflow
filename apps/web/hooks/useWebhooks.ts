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

// ── Subscription queries / mutations ───────────────────────────────────────

export function useWebhooks() {
  return useQuery({
    queryKey: ["webhooks"],
    queryFn: async () => {
      const { data } = await api.get<Webhook[]>("/webhooks/subscriptions");
      return Array.isArray(data) ? data : [];
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
      const { data } = await api.post<Webhook>("/webhooks/subscriptions", payload);
      return data;
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
      const { data } = await api.patch<Webhook>(
        `/webhooks/subscriptions/${input.id}`,
        input.patch
      );
      return data;
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
      await api.delete(`/webhooks/subscriptions/${id}`);
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
      const { data } = await api.patch<Webhook>(
        `/webhooks/subscriptions/${id}/toggle`
      );
      return data;
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
      const { data } = await api.post<{ id: string; secret: string }>(
        `/webhooks/subscriptions/${id}/rotate-secret`
      );
      return data;
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
      const { data } = await api.get<WebhookDelivery[]>("/webhooks/deliveries", {
        params: filters,
      });
      return Array.isArray(data) ? data : [];
    },
  });
}

export function useDeliveryDetails(id: string | null) {
  return useQuery({
    queryKey: ["webhook-delivery", id],
    enabled: !!id,
    queryFn: async (): Promise<WebhookDeliveryDetail | null> => {
      if (!id) return null;
      const { data } = await api.get<WebhookDeliveryDetail>(
        `/webhooks/deliveries/${id}`
      );
      return data;
    },
  });
}

export function useRetryDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<{ delivery_id: string }>(
        `/webhooks/deliveries/${id}/retry`
      );
      return data;
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
      const { data } = await api.post<TestWebhookResult>("/webhooks/test", input);
      return data;
    },
  });
}

export function useWebhookEventTypes() {
  return useQuery({
    queryKey: ["webhook-event-types"],
    queryFn: async (): Promise<string[]> => {
      const { data } = await api.get<{ event_types: string[] }>(
        "/webhooks/event-types"
      );
      return data.event_types;
    },
  });
}
