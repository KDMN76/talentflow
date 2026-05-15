"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ────────────────────────────────────────────────────────────────────────────
// OpenAPI types — kleine subset; we accepteren ook onbekende shapes
// ────────────────────────────────────────────────────────────────────────────

export interface OpenApiParameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: { type?: string; format?: string; enum?: string[] };
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: {
    description?: string;
    required?: boolean;
    content?: Record<string, { schema?: unknown; example?: unknown }>;
  };
  responses?: Record<string, { description?: string }>;
  security?: Array<Record<string, string[]>>;
}

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "options" | "head";

export interface OpenApiPathItem {
  parameters?: OpenApiParameter[];
  [method: string]: unknown;
}

export interface OpenApiSpec {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: Array<{ url: string; description?: string }>;
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, OpenApiPathItem>;
}

export interface FlatEndpoint {
  id: string;
  method: HttpMethod;
  methodUpper: string;
  path: string;
  tag: string;
  summary: string;
  description: string;
  operation: OpenApiOperation;
  parameters: OpenApiParameter[];
}

const HTTP_METHODS: HttpMethod[] = ["get", "post", "put", "patch", "delete", "options", "head"];

// ────────────────────────────────────────────────────────────────────────────
// Hooks
// ────────────────────────────────────────────────────────────────────────────

export function useOpenApiSpec() {
  return useQuery({
    queryKey: ["openapi-spec"],
    queryFn: async (): Promise<OpenApiSpec> => {
      const baseURL = api.defaults.baseURL ?? "http://localhost:4000/api";
      const apiRoot = baseURL.endsWith("/api") ? baseURL.slice(0, -4) : baseURL;
      const res = await fetch(`${apiRoot}/api-docs/openapi.json`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("openapi not ready");
      return (await res.json()) as OpenApiSpec;
    },
    staleTime: 1000 * 60 * 10,
  });
}

/**
 * Vlak de OpenAPI-spec uit naar één lijst van endpoints — handig voor
 * tree-rendering en zoeken in de UI.
 */
export function flattenSpec(spec: OpenApiSpec | undefined | null): FlatEndpoint[] {
  if (!spec || !spec.paths) return [];
  const out: FlatEndpoint[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    if (!item || typeof item !== "object") continue;
    const sharedParams = (item.parameters ?? []) as OpenApiParameter[];
    for (const method of HTTP_METHODS) {
      const op = (item as Record<string, unknown>)[method] as OpenApiOperation | undefined;
      if (!op) continue;
      out.push({
        id: `${method.toUpperCase()} ${path}`,
        method,
        methodUpper: method.toUpperCase(),
        path,
        tag: op.tags?.[0] ?? "Overig",
        summary: op.summary ?? `${method.toUpperCase()} ${path}`,
        description: op.description ?? "",
        operation: op,
        parameters: [...sharedParams, ...(op.parameters ?? [])],
      });
    }
  }
  return out.sort((a, b) => {
    if (a.tag !== b.tag) return a.tag.localeCompare(b.tag);
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    return a.methodUpper.localeCompare(b.methodUpper);
  });
}

export function groupByTag(endpoints: FlatEndpoint[]): Record<string, FlatEndpoint[]> {
  const out: Record<string, FlatEndpoint[]> = {};
  for (const e of endpoints) {
    if (!out[e.tag]) out[e.tag] = [];
    out[e.tag].push(e);
  }
  return out;
}
