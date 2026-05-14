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
// Mock-spec voor wanneer /api-docs/openapi.json offline is (Agent KKK levert
// die in dezelfde sprint — fallback voorkomt dat de page leeg is in dev).
// ────────────────────────────────────────────────────────────────────────────

const MOCK_SPEC: OpenApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "TalentFlow API",
    version: "1.0.0",
    description: "Volledige REST API voor TalentFlow — recruitment SaaS.",
  },
  servers: [
    { url: "https://api.talentflow.app", description: "Productie" },
    { url: "http://localhost:4000", description: "Lokaal" },
  ],
  tags: [
    { name: "Kandidaten" },
    { name: "Vacatures" },
    { name: "Pipeline" },
    { name: "Communicatie" },
    { name: "Webhooks" },
    { name: "Rapporten" },
  ],
  paths: {
    "/api/candidates": {
      get: {
        tags: ["Kandidaten"],
        summary: "Lijst kandidaten",
        description: "Geeft een gepagineerde lijst van kandidaten terug.",
        parameters: [
          { name: "search", in: "query", schema: { type: "string" } },
          { name: "stage", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { description: "OK" } },
      },
      post: {
        tags: ["Kandidaten"],
        summary: "Maak kandidaat aan",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              example: { full_name: "Jan Jansen", email: "jan@example.com" },
            },
          },
        },
        responses: { "201": { description: "Aangemaakt" } },
      },
    },
    "/api/candidates/{id}": {
      get: {
        tags: ["Kandidaten"],
        summary: "Haal kandidaat op",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "OK" } },
      },
      patch: {
        tags: ["Kandidaten"],
        summary: "Update kandidaat",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: { "application/json": { example: { full_name: "Jan J. Jansen" } } },
        },
        responses: { "200": { description: "Bijgewerkt" } },
      },
      delete: {
        tags: ["Kandidaten"],
        summary: "Verwijder kandidaat",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "204": { description: "Verwijderd" } },
      },
    },
    "/api/jobs": {
      get: {
        tags: ["Vacatures"],
        summary: "Lijst vacatures",
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/pipeline": {
      get: {
        tags: ["Pipeline"],
        summary: "Pipeline overzicht",
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/communications/email": {
      post: {
        tags: ["Communicatie"],
        summary: "Verstuur e-mail",
        requestBody: {
          content: {
            "application/json": {
              example: { to: "kandidaat@example.com", subject: "Hallo", body: "Test" },
            },
          },
        },
        responses: { "202": { description: "Geplaatst in queue" } },
      },
    },
    "/api/webhooks": {
      get: {
        tags: ["Webhooks"],
        summary: "Lijst webhooks",
        responses: { "200": { description: "OK" } },
      },
      post: {
        tags: ["Webhooks"],
        summary: "Maak webhook aan",
        requestBody: {
          content: {
            "application/json": {
              example: { name: "Slack notif", url: "https://hooks.slack.com/...", events: ["candidate.created"] },
            },
          },
        },
        responses: { "201": { description: "Aangemaakt" } },
      },
    },
    "/api/reports": {
      get: {
        tags: ["Rapporten"],
        summary: "Lijst rapporten",
        responses: { "200": { description: "OK" } },
      },
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Hooks
// ────────────────────────────────────────────────────────────────────────────

export function useOpenApiSpec() {
  return useQuery({
    queryKey: ["openapi-spec"],
    queryFn: async (): Promise<OpenApiSpec> => {
      const baseURL = api.defaults.baseURL ?? "http://localhost:4000/api";
      const apiRoot = baseURL.endsWith("/api") ? baseURL.slice(0, -4) : baseURL;
      try {
        const res = await fetch(`${apiRoot}/api-docs/openapi.json`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("openapi not ready");
        return (await res.json()) as OpenApiSpec;
      } catch {
        return MOCK_SPEC;
      }
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
