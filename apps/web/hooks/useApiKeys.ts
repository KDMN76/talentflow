"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type ApiKeyStatus = "active" | "revoked" | "expired";

export interface ApiKey {
  id: string;
  name: string;
  description?: string | null;
  key_prefix: string;
  scopes: string[];
  /** Legacy alias — gespiegeld op `scopes` voor backwards-compat met oude UI. */
  permissions: string[];
  rate_limit_per_minute: number;
  allowed_ips: string[] | null;
  expires_at: string | null;
  last_used_at: string | null;
  usage_count: number;
  revoked_at: string | null;
  created_at: string;
  status: ApiKeyStatus;
}

export interface CreatedApiKey extends ApiKey {
  full_key: string;
}

export interface ApiScope {
  key: string;
  label: string;
  group: string;
}

export interface ApiKeyUsage {
  id: string;
  api_key_id: string;
  method: string;
  path: string;
  status_code: number;
  ip_address: string | null;
  user_agent: string | null;
  duration_ms: number | null;
  error_code: string | null;
  created_at: string;
}

export interface UsageStats {
  total: number;
  last_24h: number;
  last_7d: number;
  errors_24h: number;
  avg_duration_ms: number | null;
  top_endpoints: Array<{ path: string; count: number }>;
  by_status: Array<{ status_code: number; count: number }>;
  daily: Array<{ date: string; count: number }>;
}

export interface CreateApiKeyPayload {
  name: string;
  description?: string;
  scopes: string[];
  rate_limit_per_minute?: number;
  allowed_ips?: string[] | null;
  expires_at?: string | null;
}

export interface UpdateApiKeyPayload {
  name?: string;
  description?: string | null;
  scopes?: string[];
  rate_limit_per_minute?: number;
  allowed_ips?: string[] | null;
  expires_at?: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Hooks
// ────────────────────────────────────────────────────────────────────────────

export function useApiScopes() {
  return useQuery({
    queryKey: ["api-keys", "scopes"],
    queryFn: async () => {
      const { data } = await api.get<ApiScope[]>("/api-keys/scopes");
      return data;
    },
    staleTime: 1000 * 60 * 60,
  });
}

export function useApiKeys() {
  return useQuery({
    queryKey: ["api-keys"],
    queryFn: async () => {
      const { data } = await api.get<ApiKey[] | { data: ApiKey[] }>("/api-keys");
      const list = Array.isArray(data) ? data : data.data;
      // Backfill voor legacy-API: zorg dat permissions == scopes als eerste
      // niet aanwezig is.
      return list.map((k) => ({
        ...k,
        scopes: k.scopes ?? k.permissions ?? [],
        permissions: k.permissions ?? k.scopes ?? [],
      }));
    },
  });
}

export function useApiKey(id: string | undefined) {
  return useQuery({
    queryKey: ["api-keys", id],
    queryFn: async () => {
      if (!id) return null;
      const { data } = await api.get<ApiKey[]>("/api-keys");
      const list = Array.isArray(data) ? data : (data as { data: ApiKey[] }).data;
      return list.find((k) => k.id === id) ?? null;
    },
    enabled: !!id,
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateApiKeyPayload): Promise<CreatedApiKey> => {
      const body = {
        ...payload,
        // Legacy-API ondersteunt nog `permissions`. Sturen we mee zodat oude
        // backends niet stuk gaan tijdens migratie.
        permissions: payload.scopes,
      };
      const { data } = await api.post<CreatedApiKey>("/api-keys", body);
      return {
        ...data,
        permissions: data.permissions ?? data.scopes ?? [],
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
}

export function useUpdateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: UpdateApiKeyPayload }) => {
      const { data } = await api.patch<ApiKey>(`/api-keys/${id}`, payload);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

export function useRotateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ key: string; record: ApiKey }> => {
      const { data } = await api.post<{ key: string; record: ApiKey }>(
        `/api-keys/${id}/rotate`,
        {}
      );
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api-keys/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

export function useApiKeyUsage(id: string | undefined, limit = 100) {
  return useQuery({
    queryKey: ["api-keys", id, "usage", limit],
    queryFn: async () => {
      if (!id) return [];
      const { data } = await api.get<ApiKeyUsage[]>(`/api-keys/${id}/usage`, {
        params: { limit },
      });
      return data;
    },
    enabled: !!id,
  });
}

export function useApiKeyStats(id: string | undefined) {
  return useQuery({
    queryKey: ["api-keys", id, "stats"],
    queryFn: async () => {
      if (!id) return null;
      const { data } = await api.get<UsageStats>(`/api-keys/${id}/stats`);
      return data;
    },
    enabled: !!id,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Playground
// ────────────────────────────────────────────────────────────────────────────

export interface ExecuteApiCallPayload {
  method: string;
  path: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
}

export interface ExecuteApiCallResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  raw?: string;
  duration_ms: number;
  method: string;
  path: string;
}

export function useExecuteApiCall() {
  return useMutation<ExecuteApiCallResult, Error, ExecuteApiCallPayload>({
    mutationFn: async (payload) => {
      const { data } = await api.post<ExecuteApiCallResult>("/api-explorer/run", payload);
      return data;
    },
  });
}
