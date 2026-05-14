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
// Mock-data
// ────────────────────────────────────────────────────────────────────────────

const MOCK_SCOPES: ApiScope[] = [
  { key: "candidates:read", label: "Kandidaten lezen", group: "Kandidaten" },
  { key: "candidates:write", label: "Kandidaten beheren", group: "Kandidaten" },
  { key: "jobs:read", label: "Vacatures lezen", group: "Vacatures" },
  { key: "jobs:write", label: "Vacatures beheren", group: "Vacatures" },
  { key: "pipeline:read", label: "Pipeline lezen", group: "Pipeline" },
  { key: "pipeline:write", label: "Pipeline beheren", group: "Pipeline" },
  { key: "communications:read", label: "Berichten lezen", group: "Communicatie" },
  { key: "communications:write", label: "Berichten versturen", group: "Communicatie" },
  { key: "webhooks:manage", label: "Webhooks beheren", group: "Integraties" },
  { key: "reports:read", label: "Rapporten lezen", group: "Rapporten" },
  { key: "reports:write", label: "Rapporten beheren", group: "Rapporten" },
  { key: "analytics:read", label: "Analytics lezen", group: "Rapporten" },
  { key: "crm:read", label: "CRM lezen", group: "CRM" },
  { key: "crm:write", label: "CRM beheren", group: "CRM" },
  { key: "*", label: "Volledige toegang (admin)", group: "Admin" },
];

const MOCK_KEYS: ApiKey[] = [
  {
    id: "key-1",
    name: "Productie integratie",
    description: "Hoofdintegratie met intern HR-platform.",
    key_prefix: "tf_live_a8f23bcd...x9f2",
    scopes: ["*"],
    permissions: ["*"],
    rate_limit_per_minute: 1000,
    allowed_ips: null,
    expires_at: null,
    last_used_at: "2026-05-07T14:00:00Z",
    usage_count: 12_482,
    revoked_at: null,
    created_at: "2026-01-10T10:00:00Z",
    status: "active",
  },
  {
    id: "key-2",
    name: "Job board sync (read-only)",
    description: "Externe scrape die vacatures binnenhaalt.",
    key_prefix: "tf_live_c4e9112f...m7q1",
    scopes: ["jobs:read", "candidates:read"],
    permissions: ["jobs:read", "candidates:read"],
    rate_limit_per_minute: 200,
    allowed_ips: ["91.98.232.104"],
    expires_at: "2026-12-31T23:59:59Z",
    last_used_at: "2026-05-08T08:30:00Z",
    usage_count: 4_205,
    revoked_at: null,
    created_at: "2026-02-20T09:00:00Z",
    status: "active",
  },
  {
    id: "key-3",
    name: "Legacy webhook key",
    description: "Oude integratie — vervangen door key-1.",
    key_prefix: "tf_live_77a2bb9e...zz03",
    scopes: ["webhooks:manage"],
    permissions: ["webhooks:manage"],
    rate_limit_per_minute: 100,
    allowed_ips: null,
    expires_at: null,
    last_used_at: "2026-04-01T12:00:00Z",
    usage_count: 89,
    revoked_at: "2026-04-15T08:00:00Z",
    created_at: "2025-11-01T09:00:00Z",
    status: "revoked",
  },
];

let mockKeys: ApiKey[] = [...MOCK_KEYS];

function randomBase62(len: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function makeMockUsageLog(keyId: string, count = 50): ApiKeyUsage[] {
  const PATHS = [
    { method: "GET", path: "/api/candidates" },
    { method: "GET", path: "/api/candidates/abc-123" },
    { method: "POST", path: "/api/candidates" },
    { method: "GET", path: "/api/jobs" },
    { method: "PATCH", path: "/api/jobs/x-77" },
    { method: "GET", path: "/api/pipeline" },
    { method: "POST", path: "/api/communications/email" },
    { method: "GET", path: "/api/analytics/funnel" },
  ];
  const STATUS = [200, 200, 200, 200, 201, 204, 400, 404, 422, 500];
  const out: ApiKeyUsage[] = [];
  for (let i = 0; i < count; i++) {
    const def = PATHS[i % PATHS.length];
    const ts = new Date(Date.now() - i * 1000 * 60 * 30).toISOString();
    out.push({
      id: `log-${keyId}-${i}`,
      api_key_id: keyId,
      method: def.method,
      path: def.path,
      status_code: STATUS[i % STATUS.length],
      ip_address: "91.98.232.104",
      user_agent: "TalentFlow-Integration/1.0",
      duration_ms: 30 + Math.floor(Math.random() * 250),
      error_code: null,
      created_at: ts,
    });
  }
  return out;
}

function makeMockStats(keyId: string): UsageStats {
  const log = makeMockUsageLog(keyId, 200);
  const last24 = log.filter(
    (l) => new Date(l.created_at).getTime() > Date.now() - 24 * 3600 * 1000
  );
  const errors24 = last24.filter((l) => l.status_code >= 400);
  const byPath = new Map<string, number>();
  for (const l of log) byPath.set(l.path, (byPath.get(l.path) ?? 0) + 1);
  const byStatus = new Map<number, number>();
  for (const l of log) byStatus.set(l.status_code, (byStatus.get(l.status_code) ?? 0) + 1);

  // Daily — laatste 7 dagen
  const daily: Array<{ date: string; count: number }> = [];
  for (let d = 6; d >= 0; d--) {
    const date = new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10);
    daily.push({ date, count: 50 + Math.floor(Math.random() * 250) });
  }

  return {
    total: log.length,
    last_24h: last24.length,
    last_7d: log.length,
    errors_24h: errors24.length,
    avg_duration_ms: 142,
    top_endpoints: [...byPath.entries()]
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    by_status: [...byStatus.entries()].map(([status_code, count]) => ({ status_code, count })),
    daily,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Hooks
// ────────────────────────────────────────────────────────────────────────────

export function useApiScopes() {
  return useQuery({
    queryKey: ["api-keys", "scopes"],
    queryFn: async () => {
      try {
        const { data } = await api.get<ApiScope[]>("/api-keys/scopes");
        return data;
      } catch {
        return MOCK_SCOPES;
      }
    },
    staleTime: 1000 * 60 * 60,
  });
}

export function useApiKeys() {
  return useQuery({
    queryKey: ["api-keys"],
    queryFn: async () => {
      try {
        const { data } = await api.get<ApiKey[] | { data: ApiKey[] }>("/api-keys");
        const list = Array.isArray(data) ? data : data.data;
        // Backfill voor legacy-API: zorg dat permissions == scopes als eerste
        // niet aanwezig is.
        return list.map((k) => ({
          ...k,
          scopes: k.scopes ?? k.permissions ?? [],
          permissions: k.permissions ?? k.scopes ?? [],
        }));
      } catch {
        return [...mockKeys];
      }
    },
  });
}

export function useApiKey(id: string | undefined) {
  return useQuery({
    queryKey: ["api-keys", id],
    queryFn: async () => {
      if (!id) return null;
      try {
        const { data } = await api.get<ApiKey[]>("/api-keys");
        const list = Array.isArray(data) ? data : (data as { data: ApiKey[] }).data;
        return list.find((k) => k.id === id) ?? null;
      } catch {
        return mockKeys.find((k) => k.id === id) ?? null;
      }
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
      try {
        const { data } = await api.post<CreatedApiKey>("/api-keys", body);
        return {
          ...data,
          permissions: data.permissions ?? data.scopes ?? [],
        };
      } catch {
        const id = `key-${Date.now()}`;
        const random = randomBase62(40);
        const full_key = `tf_live_${random}`;
        const prefix = `tf_live_${random.slice(0, 8)}...${random.slice(-4)}`;
        const newKey: CreatedApiKey = {
          id,
          name: payload.name,
          description: payload.description ?? null,
          key_prefix: prefix,
          scopes: payload.scopes,
          permissions: payload.scopes,
          rate_limit_per_minute: payload.rate_limit_per_minute ?? 100,
          allowed_ips: payload.allowed_ips ?? null,
          expires_at: payload.expires_at ?? null,
          last_used_at: null,
          usage_count: 0,
          revoked_at: null,
          created_at: new Date().toISOString(),
          status: "active",
          full_key,
        };
        mockKeys = [newKey, ...mockKeys];
        return newKey;
      }
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
      try {
        const { data } = await api.patch<ApiKey>(`/api-keys/${id}`, payload);
        return data;
      } catch {
        const idx = mockKeys.findIndex((k) => k.id === id);
        if (idx === -1) throw new Error("not_found");
        mockKeys[idx] = {
          ...mockKeys[idx],
          ...payload,
          scopes: payload.scopes ?? mockKeys[idx].scopes,
          permissions: payload.scopes ?? mockKeys[idx].permissions,
        };
        return mockKeys[idx];
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

export function useRotateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ key: string; record: ApiKey }> => {
      try {
        const { data } = await api.post<{ key: string; record: ApiKey }>(
          `/api-keys/${id}/rotate`,
          {}
        );
        return data;
      } catch {
        const random = randomBase62(40);
        const newKey = `tf_live_${random}`;
        const idx = mockKeys.findIndex((k) => k.id === id);
        if (idx !== -1) {
          mockKeys[idx] = {
            ...mockKeys[idx],
            key_prefix: `tf_live_${random.slice(0, 8)}...${random.slice(-4)}`,
            last_used_at: null,
            revoked_at: null,
            status: "active",
          };
        }
        return {
          key: newKey,
          record: mockKeys[idx] ?? {
            ...MOCK_KEYS[0],
            id,
          },
        };
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      try {
        await api.delete(`/api-keys/${id}`);
      } catch {
        mockKeys = mockKeys.map((k) =>
          k.id === id
            ? { ...k, status: "revoked" as const, revoked_at: new Date().toISOString() }
            : k
        );
        queryClient.setQueryData<ApiKey[]>(["api-keys"], (old) =>
          old
            ? old.map((k) =>
                k.id === id
                  ? { ...k, status: "revoked" as const, revoked_at: new Date().toISOString() }
                  : k
              )
            : []
        );
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });
}

export function useApiKeyUsage(id: string | undefined, limit = 100) {
  return useQuery({
    queryKey: ["api-keys", id, "usage", limit],
    queryFn: async () => {
      if (!id) return [];
      try {
        const { data } = await api.get<ApiKeyUsage[]>(`/api-keys/${id}/usage`, {
          params: { limit },
        });
        return data;
      } catch {
        return makeMockUsageLog(id, limit);
      }
    },
    enabled: !!id,
  });
}

export function useApiKeyStats(id: string | undefined) {
  return useQuery({
    queryKey: ["api-keys", id, "stats"],
    queryFn: async () => {
      if (!id) return null;
      try {
        const { data } = await api.get<UsageStats>(`/api-keys/${id}/stats`);
        return data;
      } catch {
        return makeMockStats(id);
      }
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
      try {
        const { data } = await api.post<ExecuteApiCallResult>("/api-explorer/run", payload);
        return data;
      } catch (err: unknown) {
        // Mock-fallback: simuleer 200/JSON met echo voor lokale UI demo.
        const body =
          payload.method === "GET"
            ? { items: [], note: "Mock-respons — backend offline" }
            : { ok: true, echoed: payload.body ?? null };
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body,
          duration_ms: 80 + Math.floor(Math.random() * 120),
          method: payload.method,
          path: payload.path,
        };
      }
    },
  });
}
