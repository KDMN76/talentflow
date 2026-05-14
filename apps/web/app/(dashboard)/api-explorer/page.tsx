"use client";

import { useMemo, useState, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  Play,
  Search,
  Code2,
  Save,
  Trash2,
  Bookmark,
  BookmarkPlus,
  Terminal,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  useOpenApiSpec,
  flattenSpec,
  groupByTag,
  type FlatEndpoint,
} from "@/hooks/useOpenApiSpec";
import { useApiKeys, useExecuteApiCall } from "@/hooks/useApiKeys";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  POST: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  PUT: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  PATCH: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  DELETE: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  OPTIONS: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  HEAD: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const STATUS_COLORS = (status: number): string => {
  if (status >= 200 && status < 300) return "bg-emerald-500 text-white";
  if (status >= 300 && status < 400) return "bg-blue-500 text-white";
  if (status >= 400 && status < 500) return "bg-amber-500 text-white";
  if (status >= 500) return "bg-red-500 text-white";
  return "bg-zinc-500 text-white";
};

interface SnippetForm {
  method: string;
  path: string;
  pathParams: Record<string, string>;
  queryParams: Array<{ key: string; value: string }>;
  headers: Array<{ key: string; value: string }>;
  body: string;
}

interface SavedSnippet extends SnippetForm {
  id: string;
  name: string;
  savedAt: string;
}

const SNIPPETS_KEY = "talentflow:api-explorer:snippets";

function loadSnippets(): SavedSnippet[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SNIPPETS_KEY);
    return raw ? (JSON.parse(raw) as SavedSnippet[]) : [];
  } catch {
    return [];
  }
}

function saveSnippets(snippets: SavedSnippet[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SNIPPETS_KEY, JSON.stringify(snippets));
}

function pathParamNames(path: string): string[] {
  // OpenAPI: {id}; Express-stijl: :id. Ondersteun beide.
  const out = new Set<string>();
  const reBrace = /\{([^}]+)\}/g;
  const reColon = /\/:([a-zA-Z_][\w]*)/g;
  let m: RegExpExecArray | null;
  while ((m = reBrace.exec(path))) out.add(m[1]);
  while ((m = reColon.exec(path))) out.add(m[1]);
  return [...out];
}

function applyPathParams(path: string, params: Record<string, string>): string {
  return path
    .replace(/\{([^}]+)\}/g, (_, name) => params[name] ?? `{${name}}`)
    .replace(/\/:([a-zA-Z_][\w]*)/g, (_, name) =>
      params[name] ? `/${params[name]}` : `/:${name}`
    );
}

function formatJson(value: unknown): string {
  try {
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildCurl(
  method: string,
  fullUrl: string,
  headers: Array<{ key: string; value: string }>,
  body: string
): string {
  const parts: string[] = [`curl -X ${method.toUpperCase()} "${fullUrl}"`];
  for (const { key, value } of headers) {
    if (key) parts.push(`  -H "${key}: ${value.replace(/"/g, '\\"')}"`);
  }
  if (body && method.toUpperCase() !== "GET") {
    const cleaned = body.replace(/'/g, "'\\''");
    parts.push(`  -d '${cleaned}'`);
  }
  return parts.join(" \\\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────────

export default function ApiExplorerPage() {
  const { toast } = useToast();
  const { data: spec, isLoading: specLoading } = useOpenApiSpec();
  const { data: apiKeys } = useApiKeys();
  const execute = useExecuteApiCall();

  const endpoints = useMemo(() => flattenSpec(spec ?? null), [spec]);
  const grouped = useMemo(() => groupByTag(endpoints), [endpoints]);

  const [search, setSearch] = useState("");
  const [expandedTags, setExpandedTags] = useState<Set<string>>(
    new Set(Object.keys(grouped).slice(0, 3))
  );
  const [selected, setSelected] = useState<FlatEndpoint | null>(null);

  // Houdt expandedTags actueel bij eerste laad.
  useEffect(() => {
    if (expandedTags.size === 0 && Object.keys(grouped).length > 0) {
      setExpandedTags(new Set(Object.keys(grouped).slice(0, 3)));
    }
  }, [grouped, expandedTags.size]);

  // Form state
  const [pathParams, setPathParams] = useState<Record<string, string>>({});
  const [queryParams, setQueryParams] = useState<Array<{ key: string; value: string }>>([]);
  const [headers, setHeaders] = useState<Array<{ key: string; value: string }>>([
    { key: "X-Request-Id", value: "" },
  ]);
  const [authMode, setAuthMode] = useState<"jwt" | "apikey">("jwt");
  const [selectedKeyId, setSelectedKeyId] = useState<string>("");
  const [body, setBody] = useState<string>("");

  // Response state
  const [response, setResponse] = useState<{
    status: number;
    duration_ms: number;
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
    method: string;
    path: string;
  } | null>(null);
  const [showResponseHeaders, setShowResponseHeaders] = useState(false);

  // Modals
  const [curlOpen, setCurlOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [snippetName, setSnippetName] = useState("");
  const [snippets, setSnippets] = useState<SavedSnippet[]>([]);

  useEffect(() => {
    setSnippets(loadSnippets());
  }, []);

  // Filter endpoints
  const filteredGrouped = useMemo(() => {
    if (!search) return grouped;
    const q = search.toLowerCase();
    const out: Record<string, FlatEndpoint[]> = {};
    for (const [tag, list] of Object.entries(grouped)) {
      const filtered = list.filter(
        (e) =>
          e.path.toLowerCase().includes(q) ||
          e.summary.toLowerCase().includes(q) ||
          e.methodUpper.toLowerCase().includes(q)
      );
      if (filtered.length > 0) out[tag] = filtered;
    }
    return out;
  }, [grouped, search]);

  // Initial body example uit spec
  function selectEndpoint(e: FlatEndpoint) {
    setSelected(e);
    const params: Record<string, string> = {};
    for (const name of pathParamNames(e.path)) params[name] = "";
    setPathParams(params);

    const qs: Array<{ key: string; value: string }> = [];
    for (const p of e.parameters.filter((pp) => pp.in === "query")) {
      qs.push({ key: p.name, value: "" });
    }
    setQueryParams(qs);

    // Body example
    const example =
      e.operation.requestBody?.content?.["application/json"]?.example ??
      e.operation.requestBody?.content?.["application/json"]?.schema;
    setBody(example ? formatJson(example) : "");
    setResponse(null);
  }

  function toggleTag(tag: string) {
    setExpandedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  function buildHeadersForExecute(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const { key, value } of headers) {
      if (key && value) out[key] = value;
    }
    if (authMode === "apikey" && selectedKeyId) {
      const meta = apiKeys?.find((k) => k.id === selectedKeyId);
      if (meta) {
        out["X-API-Key"] = `[redacted:${meta.key_prefix}]`; // alleen voor cURL display
      }
    }
    return out;
  }

  async function handleRun() {
    if (!selected) return;
    const finalPath = applyPathParams(selected.path, pathParams);
    const queryRecord: Record<string, string> = {};
    for (const { key, value } of queryParams) {
      if (key && value) queryRecord[key] = value;
    }

    // Echte API-key voor execution sturen we naar de server-proxy. Server
    // gebruikt zijn eigen JWT-context als geen X-API-Key meegegeven wordt.
    // (De UI heeft de plain-key niet — alleen prefix. Daarom geven we hier
    // alleen aanvullende headers door, niet de key zelf.)
    const userHeaders: Record<string, string> = {};
    for (const { key, value } of headers) {
      if (key && value) userHeaders[key] = value;
    }

    let parsedBody: unknown = undefined;
    if (body.trim().length > 0 && selected.methodUpper !== "GET") {
      try {
        parsedBody = JSON.parse(body);
      } catch {
        toast({
          title: "Body is geen geldig JSON",
          description: "Controleer de body editor.",
          variant: "destructive",
        });
        return;
      }
    }

    try {
      const result = await execute.mutateAsync({
        method: selected.methodUpper,
        path: finalPath,
        headers: userHeaders,
        query: queryRecord,
        body: parsedBody,
      });
      setResponse(result);
    } catch (err) {
      toast({
        title: "Request mislukt",
        description: err instanceof Error ? err.message : "Onbekende fout",
        variant: "destructive",
      });
    }
  }

  function handleCopyResponseBody() {
    if (!response) return;
    navigator.clipboard.writeText(formatJson(response.body));
    toast({ title: "Gekopieerd", description: "Response body is gekopieerd." });
  }

  function handleSaveSnippet() {
    if (!selected || !snippetName.trim()) return;
    const snippet: SavedSnippet = {
      id: `snip-${Date.now()}`,
      name: snippetName.trim(),
      method: selected.methodUpper,
      path: selected.path,
      pathParams,
      queryParams,
      headers,
      body,
      savedAt: new Date().toISOString(),
    };
    const updated = [snippet, ...snippets];
    setSnippets(updated);
    saveSnippets(updated);
    setSnippetName("");
    setSaveOpen(false);
    toast({ title: "Snippet opgeslagen", description: snippet.name });
  }

  function loadSnippet(s: SavedSnippet) {
    const endpoint = endpoints.find(
      (e) => e.methodUpper === s.method && e.path === s.path
    );
    if (endpoint) setSelected(endpoint);
    setPathParams(s.pathParams);
    setQueryParams(s.queryParams);
    setHeaders(s.headers);
    setBody(s.body);
    toast({ title: "Snippet geladen", description: s.name });
  }

  function deleteSnippet(id: string) {
    const updated = snippets.filter((s) => s.id !== id);
    setSnippets(updated);
    saveSnippets(updated);
  }

  const fullUrl = selected
    ? (() => {
        const baseURL = process.env.NEXT_PUBLIC_API_URL ?? "https://api.talentflow.app/api";
        const apiRoot = baseURL.endsWith("/api") ? baseURL.slice(0, -4) : baseURL;
        const finalPath = applyPathParams(selected.path, pathParams);
        const qs = queryParams
          .filter((q) => q.key && q.value)
          .map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value)}`)
          .join("&");
        return `${apiRoot}${finalPath}${qs ? `?${qs}` : ""}`;
      })()
    : "";

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title="API Playground"
        description="Probeer endpoints uit met je eigen API-keys, debug responses en deel snippets."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* ─── LEFT: endpoint tree ─────────────────────────────────────── */}
        <aside className="space-y-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-3 space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Zoek endpoint..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
              <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-1">
                {specLoading ? (
                  <div className="py-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" /> Spec laden...
                  </div>
                ) : Object.keys(filteredGrouped).length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    Geen endpoints gevonden
                  </div>
                ) : (
                  Object.entries(filteredGrouped).map(([tag, list]) => {
                    const isExpanded = expandedTags.has(tag);
                    return (
                      <div key={tag} className="space-y-0.5">
                        <button
                          type="button"
                          onClick={() => toggleTag(tag)}
                          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                          {tag}
                          <span className="ml-auto text-[10px] text-muted-foreground font-normal">
                            {list.length}
                          </span>
                        </button>
                        {isExpanded && (
                          <div className="ml-3 border-l border-border pl-2 space-y-0.5">
                            {list.map((e) => {
                              const isSel =
                                selected?.id === e.id;
                              return (
                                <button
                                  key={e.id}
                                  type="button"
                                  onClick={() => selectEndpoint(e)}
                                  className={cn(
                                    "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/50",
                                    isSel && "bg-indigo-50 dark:bg-indigo-950/40"
                                  )}
                                  title={e.summary}
                                >
                                  <span
                                    className={cn(
                                      "shrink-0 rounded px-1 py-0.5 text-[9px] font-bold w-12 text-center",
                                      METHOD_COLORS[e.methodUpper] ?? METHOD_COLORS.GET
                                    )}
                                  >
                                    {e.methodUpper}
                                  </span>
                                  <span className="font-mono text-[11px] truncate text-zinc-700 dark:text-zinc-300">
                                    {e.path}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>

          {/* Snippets */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Bookmark className="h-3 w-3" />
                Bewaarde snippets
              </CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-3 space-y-1">
              {snippets.length === 0 ? (
                <p className="px-2 py-3 text-[11px] text-muted-foreground">
                  Nog geen snippets bewaard.
                </p>
              ) : (
                snippets.map((s) => (
                  <div
                    key={s.id}
                    className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    <button
                      type="button"
                      onClick={() => loadSnippet(s)}
                      className="flex flex-1 items-center gap-2 text-left text-xs min-w-0"
                    >
                      <span
                        className={cn(
                          "shrink-0 rounded px-1 py-0.5 text-[9px] font-bold w-10 text-center",
                          METHOD_COLORS[s.method] ?? METHOD_COLORS.GET
                        )}
                      >
                        {s.method}
                      </span>
                      <span className="truncate font-medium text-zinc-700 dark:text-zinc-300">
                        {s.name}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSnippet(s.id)}
                      className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-destructive"
                      title="Verwijderen"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </aside>

        {/* ─── RIGHT: form + response ────────────────────────────────────── */}
        <div className="space-y-4">
          {!selected ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="py-16 text-center">
                <Terminal className="h-10 w-10 mx-auto text-zinc-300 dark:text-zinc-700 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Kies een endpoint links om te beginnen.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Request card */}
              <Card className="border-0 shadow-sm">
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "shrink-0 rounded px-2 py-0.5 text-[10px] font-bold",
                          METHOD_COLORS[selected.methodUpper] ?? METHOD_COLORS.GET
                        )}
                      >
                        {selected.methodUpper}
                      </span>
                      <code className="font-mono text-xs text-zinc-700 dark:text-zinc-300 truncate">
                        {selected.path}
                      </code>
                    </div>
                    <CardTitle className="text-base">{selected.summary}</CardTitle>
                    {selected.description && (
                      <CardDescription className="text-xs">
                        {selected.description}
                      </CardDescription>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSaveOpen(true)}
                      className="gap-1.5"
                    >
                      <BookmarkPlus className="h-3.5 w-3.5" /> Snippet
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCurlOpen(true)}
                      className="gap-1.5"
                    >
                      <Code2 className="h-3.5 w-3.5" /> cURL
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleRun}
                      disabled={execute.isPending}
                      className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 border-0"
                    >
                      {execute.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      Run
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Path params */}
                  {Object.keys(pathParams).length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                        Path parameters
                      </Label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {Object.keys(pathParams).map((name) => (
                          <div key={name} className="space-y-1">
                            <Label htmlFor={`pp-${name}`} className="text-xs font-mono">
                              {name}
                            </Label>
                            <Input
                              id={`pp-${name}`}
                              value={pathParams[name]}
                              onChange={(e) =>
                                setPathParams({ ...pathParams, [name]: e.target.value })
                              }
                              placeholder={`waarde voor ${name}`}
                              className="h-9 text-xs font-mono"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Query params */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                        Query parameters
                      </Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-xs h-7"
                        onClick={() =>
                          setQueryParams([...queryParams, { key: "", value: "" }])
                        }
                      >
                        + Toevoegen
                      </Button>
                    </div>
                    {queryParams.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">Geen query params.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {queryParams.map((q, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <Input
                              placeholder="key"
                              value={q.key}
                              onChange={(e) => {
                                const next = [...queryParams];
                                next[idx] = { ...q, key: e.target.value };
                                setQueryParams(next);
                              }}
                              className="h-8 text-xs font-mono w-1/3"
                            />
                            <Input
                              placeholder="value"
                              value={q.value}
                              onChange={(e) => {
                                const next = [...queryParams];
                                next[idx] = { ...q, value: e.target.value };
                                setQueryParams(next);
                              }}
                              className="h-8 text-xs font-mono flex-1"
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setQueryParams(queryParams.filter((_, i) => i !== idx))
                              }
                              className="h-8 w-8 p-0 text-zinc-400 hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Auth */}
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Authenticatie
                    </Label>
                    <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2">
                      <Select value={authMode} onValueChange={(v) => setAuthMode(v as "jwt" | "apikey")}>
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="jwt">Eigen sessie (JWT)</SelectItem>
                          <SelectItem value="apikey">API-sleutel</SelectItem>
                        </SelectContent>
                      </Select>
                      {authMode === "apikey" && (
                        <Select value={selectedKeyId} onValueChange={setSelectedKeyId}>
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue placeholder="Kies API-sleutel" />
                          </SelectTrigger>
                          <SelectContent>
                            {(apiKeys ?? [])
                              .filter((k) => k.status === "active")
                              .map((k) => (
                                <SelectItem key={k.id} value={k.id}>
                                  <span className="flex items-center gap-2">
                                    <span className="font-medium">{k.name}</span>
                                    <span className="text-[10px] text-muted-foreground font-mono">
                                      {k.key_prefix}
                                    </span>
                                  </span>
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    {authMode === "apikey" && selectedKeyId && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400">
                        Let op: server-proxy gebruikt jouw sessie. De plain key is alleen zichtbaar in de gegenereerde cURL.
                      </p>
                    )}
                  </div>

                  {/* Headers */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                        Headers
                      </Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-xs h-7"
                        onClick={() => setHeaders([...headers, { key: "", value: "" }])}
                      >
                        + Toevoegen
                      </Button>
                    </div>
                    <div className="space-y-1.5">
                      {headers.map((h, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <Input
                            placeholder="header"
                            value={h.key}
                            onChange={(e) => {
                              const next = [...headers];
                              next[idx] = { ...h, key: e.target.value };
                              setHeaders(next);
                            }}
                            className="h-8 text-xs font-mono w-1/3"
                          />
                          <Input
                            placeholder="value"
                            value={h.value}
                            onChange={(e) => {
                              const next = [...headers];
                              next[idx] = { ...h, value: e.target.value };
                              setHeaders(next);
                            }}
                            className="h-8 text-xs font-mono flex-1"
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setHeaders(headers.filter((_, i) => i !== idx))}
                            className="h-8 w-8 p-0 text-zinc-400 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Body */}
                  {selected.methodUpper !== "GET" && (
                    <div className="space-y-2">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                        Request body (JSON)
                      </Label>
                      <textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder='{"key":"value"}'
                        rows={8}
                        className="w-full font-mono text-xs rounded-lg border border-input bg-background px-3 py-2 ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                        spellCheck={false}
                      />
                    </div>
                  )}

                  <div className="rounded-md bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs font-mono text-zinc-600 dark:text-zinc-400 break-all">
                    <span className="opacity-60">{selected.methodUpper}</span> {fullUrl}
                  </div>
                </CardContent>
              </Card>

              {/* Response card */}
              <Card className="border-0 shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-base">Response</CardTitle>
                    {response && (
                      <>
                        <span
                          className={cn(
                            "rounded-md px-2 py-0.5 text-xs font-bold",
                            STATUS_COLORS(response.status)
                          )}
                        >
                          {response.status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {response.duration_ms} ms
                        </span>
                      </>
                    )}
                  </div>
                  {response && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCopyResponseBody}
                      className="gap-1.5"
                    >
                      <Copy className="h-3.5 w-3.5" /> Kopieer body
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {!response ? (
                    <p className="text-sm text-muted-foreground py-4 italic">
                      Voer een request uit om hier de response te zien.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => setShowResponseHeaders(!showResponseHeaders)}
                        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-zinc-700 dark:hover:text-zinc-300"
                      >
                        {showResponseHeaders ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                        Headers ({Object.keys(response.headers).length})
                      </button>
                      {showResponseHeaders && (
                        <pre className="rounded-md bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-[11px] font-mono text-zinc-600 dark:text-zinc-400 max-h-40 overflow-auto">
                          {Object.entries(response.headers)
                            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v ?? ""}`)
                            .join("\n")}
                        </pre>
                      )}
                      <div>
                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                          Body
                        </Label>
                        <pre className="mt-1 rounded-md bg-zinc-950 text-zinc-100 dark:bg-zinc-900 px-4 py-3 text-xs font-mono max-h-[420px] overflow-auto">
                          {formatJson(response.body)}
                        </pre>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* cURL modal */}
      <Dialog open={curlOpen} onOpenChange={setCurlOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>cURL command</DialogTitle>
          </DialogHeader>
          <pre className="rounded-md bg-zinc-950 text-zinc-100 px-4 py-3 text-xs font-mono overflow-auto whitespace-pre-wrap">
            {selected
              ? buildCurl(
                  selected.methodUpper,
                  fullUrl,
                  buildHeadersForExecute()
                    ? Object.entries(buildHeadersForExecute()).map(([k, v]) => ({
                        key: k,
                        value: v,
                      }))
                    : [],
                  body
                )
              : ""}
          </pre>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (!selected) return;
                navigator.clipboard.writeText(
                  buildCurl(
                    selected.methodUpper,
                    fullUrl,
                    Object.entries(buildHeadersForExecute()).map(([k, v]) => ({
                      key: k,
                      value: v,
                    })),
                    body
                  )
                );
                toast({ title: "cURL gekopieerd" });
              }}
            >
              <Copy className="mr-2 h-4 w-4" /> Kopieer
            </Button>
            <DialogClose asChild>
              <Button>Sluiten</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save snippet modal */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Snippet bewaren</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="snip-name">Naam</Label>
            <Input
              id="snip-name"
              value={snippetName}
              onChange={(e) => setSnippetName(e.target.value)}
              placeholder="Bijv. Lijst kandidaten — debug"
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Annuleren</Button>
            </DialogClose>
            <Button
              disabled={!snippetName.trim()}
              onClick={handleSaveSnippet}
              className="bg-indigo-600 hover:bg-indigo-700 border-0"
            >
              <Save className="mr-2 h-4 w-4" /> Opslaan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
