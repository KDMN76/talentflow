"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Key,
  RefreshCw,
  Trash2,
  Loader2,
  Activity,
  Save,
  Filter,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  useApiKey,
  useApiKeyStats,
  useApiKeyUsage,
  useApiScopes,
  useRevokeApiKey,
  useRotateApiKey,
  useUpdateApiKey,
} from "@/hooks/useApiKeys";

const STATUS_LABEL: Record<string, string> = {
  active: "Actief",
  revoked: "Ingetrokken",
  expired: "Verlopen",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("nl-NL", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function STATUS_COLOR(code: number): string {
  if (code >= 200 && code < 300) return "text-emerald-600 dark:text-emerald-400";
  if (code >= 400 && code < 500) return "text-amber-600 dark:text-amber-400";
  if (code >= 500) return "text-red-600 dark:text-red-400";
  return "text-zinc-600 dark:text-zinc-400";
}

export default function ApiKeyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const id = params.id;

  const { data: apiKey, isLoading } = useApiKey(id);
  const { data: usage, isLoading: usageLoading } = useApiKeyUsage(id, 100);
  const { data: stats } = useApiKeyStats(id);
  const { data: scopes } = useApiScopes();

  const updateMutation = useUpdateApiKey();
  const rotateMutation = useRotateApiKey();
  const revokeMutation = useRevokeApiKey();

  // Settings form state
  const [editName, setEditName] = useState<string>("");
  const [editDescription, setEditDescription] = useState<string>("");
  const [editScopes, setEditScopes] = useState<string[]>([]);
  const [editRateLimit, setEditRateLimit] = useState<number>(100);
  const [editAllowedIps, setEditAllowedIps] = useState<string>("");
  const [edited, setEdited] = useState(false);

  const [methodFilter, setMethodFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const [revokeOpen, setRevokeOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);

  // Hydrate form when data arrives — useEffect omdat we state setten als
  // sideeffect (geen pure derived value).
  useEffect(() => {
    if (apiKey && !edited) {
      setEditName(apiKey.name);
      setEditDescription(apiKey.description ?? "");
      setEditScopes(apiKey.scopes);
      setEditRateLimit(apiKey.rate_limit_per_minute);
      setEditAllowedIps((apiKey.allowed_ips ?? []).join(", "));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey?.id, apiKey?.name, apiKey?.scopes?.length]);

  const filteredUsage = useMemo(() => {
    let list = usage ?? [];
    if (methodFilter) list = list.filter((l) => l.method === methodFilter);
    if (statusFilter) {
      const range = parseInt(statusFilter[0], 10);
      list = list.filter((l) => Math.floor(l.status_code / 100) === range);
    }
    return list;
  }, [usage, methodFilter, statusFilter]);

  const dailyMax = useMemo(
    () =>
      stats?.daily?.length
        ? Math.max(...stats.daily.map((d) => d.count), 1)
        : 1,
    [stats]
  );

  async function handleSave() {
    if (!apiKey) return;
    const ips = editAllowedIps
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await updateMutation.mutateAsync({
        id: apiKey.id,
        payload: {
          name: editName,
          description: editDescription || null,
          scopes: editScopes,
          rate_limit_per_minute: editRateLimit,
          allowed_ips: ips.length > 0 ? ips : null,
        },
      });
      toast({ title: "Bijgewerkt" });
      setEdited(false);
    } catch {
      toast({ title: "Bijwerken mislukt", variant: "destructive" });
    }
  }

  async function handleRotate() {
    if (!apiKey) return;
    try {
      const res = await rotateMutation.mutateAsync(apiKey.id);
      setRotatedKey(res.key);
      setRotateOpen(false);
    } catch {
      toast({ title: "Roteren mislukt", variant: "destructive" });
    }
  }

  async function handleRevoke() {
    if (!apiKey) return;
    try {
      await revokeMutation.mutateAsync(apiKey.id);
      toast({ title: "Sleutel ingetrokken" });
      router.push("/api-keys");
    } catch {
      toast({ title: "Intrekken mislukt", variant: "destructive" });
    }
  }

  if (isLoading) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
        Sleutel laden...
      </div>
    );
  }

  if (!apiKey) {
    return (
      <div className="py-12 text-center">
        <AlertTriangle className="h-10 w-10 mx-auto text-zinc-300 mb-3" />
        <p className="text-sm text-muted-foreground mb-4">Sleutel niet gevonden.</p>
        <Link href="/api-keys">
          <Button variant="outline" size="sm">Terug naar API-sleutels</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link href="/api-keys" className="hover:text-zinc-700 dark:hover:text-zinc-300">
          API-sleutels
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-zinc-700 dark:text-zinc-300">{apiKey.name}</span>
      </div>

      <PageHeader
        title={apiKey.name}
        description={apiKey.description ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/api-keys">
              <Button variant="outline" size="sm" className="gap-1.5">
                <ArrowLeft className="h-3.5 w-3.5" />
                Terug
              </Button>
            </Link>
            {apiKey.status === "active" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRotateOpen(true)}
                  className="gap-1.5"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Roteren
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRevokeOpen(true)}
                  className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Intrekken
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* Status banner */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-indigo-600" />
            <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
              {apiKey.key_prefix}
            </code>
          </div>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            Status: {STATUS_LABEL[apiKey.status]}
          </span>
          <span className="text-muted-foreground">
            Aangemaakt: {formatDate(apiKey.created_at)}
          </span>
          {apiKey.expires_at && (
            <span className="text-muted-foreground">
              Verloopt: {formatDate(apiKey.expires_at)}
            </span>
          )}
          <span className="text-muted-foreground">
            Limit: {apiKey.rate_limit_per_minute}/min
          </span>
        </CardContent>
      </Card>

      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings" className="gap-1.5">Instellingen</TabsTrigger>
          <TabsTrigger value="usage" className="gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            Gebruik
          </TabsTrigger>
          <TabsTrigger value="logs" className="gap-1.5">Logs</TabsTrigger>
        </TabsList>

        {/* Settings tab */}
        <TabsContent value="settings" className="mt-4 space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Algemeen</CardTitle>
              <CardDescription>Naam, beschrijving en rate-limit aanpassen.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Naam</Label>
                <Input
                  value={editName}
                  onChange={(e) => {
                    setEditName(e.target.value);
                    setEdited(true);
                  }}
                  disabled={apiKey.status !== "active"}
                />
              </div>
              <div className="space-y-2">
                <Label>Omschrijving</Label>
                <textarea
                  value={editDescription}
                  onChange={(e) => {
                    setEditDescription(e.target.value);
                    setEdited(true);
                  }}
                  rows={3}
                  disabled={apiKey.status !== "active"}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Rate limit (per minuut)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10000}
                    value={editRateLimit}
                    onChange={(e) => {
                      setEditRateLimit(parseInt(e.target.value, 10) || 100);
                      setEdited(true);
                    }}
                    disabled={apiKey.status !== "active"}
                  />
                </div>
                <div className="space-y-2">
                  <Label>IP-allowlist</Label>
                  <Input
                    value={editAllowedIps}
                    onChange={(e) => {
                      setEditAllowedIps(e.target.value);
                      setEdited(true);
                    }}
                    placeholder="91.98.232.104, 81.20.10.10"
                    disabled={apiKey.status !== "active"}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Scopes</CardTitle>
              <CardDescription>Welke acties deze sleutel mag uitvoeren.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {(scopes ?? []).map((s) => {
                  const checked = editScopes.includes(s.key);
                  const danger = s.key === "*";
                  return (
                    <label
                      key={s.key}
                      className={cn(
                        "flex items-center gap-2.5 cursor-pointer rounded-md px-3 py-2 border",
                        apiKey.status !== "active" && "opacity-60 cursor-not-allowed",
                        checked
                          ? danger
                            ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700"
                            : "border-indigo-300 bg-indigo-50 dark:bg-indigo-950/30 dark:border-indigo-700"
                          : "border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                      )}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded accent-indigo-600"
                        checked={checked}
                        disabled={apiKey.status !== "active"}
                        onChange={() => {
                          setEdited(true);
                          setEditScopes(
                            checked
                              ? editScopes.filter((x) => x !== s.key)
                              : [...editScopes, s.key]
                          );
                        }}
                      />
                      <span className="text-sm flex-1">{s.label}</span>
                      <code className="text-[10px] text-muted-foreground font-mono">
                        {s.key}
                      </code>
                    </label>
                  );
                })}
              </div>
              <div className="flex justify-end mt-4">
                <Button
                  onClick={handleSave}
                  disabled={!edited || updateMutation.isPending || apiKey.status !== "active"}
                  className="bg-indigo-600 hover:bg-indigo-700 border-0"
                >
                  {updateMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Wijzigingen opslaan
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Usage tab */}
        <TabsContent value="usage" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Totaal" value={stats?.total ?? 0} />
            <StatCard label="Laatste 24u" value={stats?.last_24h ?? 0} />
            <StatCard label="Laatste 7 dagen" value={stats?.last_7d ?? 0} />
            <StatCard
              label="Errors (24u)"
              value={stats?.errors_24h ?? 0}
              accent={(stats?.errors_24h ?? 0) > 0 ? "text-amber-600" : "text-emerald-600"}
            />
          </div>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Activiteit (laatste 7 dagen)</CardTitle>
            </CardHeader>
            <CardContent>
              {!stats?.daily?.length ? (
                <p className="text-xs text-muted-foreground italic py-8 text-center">
                  Nog geen data.
                </p>
              ) : (
                <div className="flex items-end gap-2 h-32">
                  {stats.daily.map((d) => (
                    <div key={d.date} className="flex-1 flex flex-col items-center gap-1.5">
                      <div className="flex-1 w-full flex items-end">
                        <div
                          className="w-full bg-gradient-to-t from-indigo-500 to-purple-500 rounded-t-md min-h-[4px]"
                          style={{
                            height: `${(d.count / dailyMax) * 100}%`,
                          }}
                          title={`${d.count} requests op ${d.date}`}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {d.date.slice(5)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Top 10 endpoints</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!stats?.top_endpoints?.length ? (
                <p className="text-xs text-muted-foreground italic py-8 text-center">
                  Geen calls in de afgelopen 7 dagen.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {stats.top_endpoints.map((row) => {
                    const max = stats.top_endpoints[0]?.count ?? 1;
                    const pct = (row.count / max) * 100;
                    return (
                      <div key={row.path} className="px-5 py-2.5 relative">
                        <div
                          className="absolute inset-y-0 left-0 bg-indigo-50 dark:bg-indigo-950/30"
                          style={{ width: `${pct}%` }}
                        />
                        <div className="relative flex items-center justify-between text-xs">
                          <code className="font-mono truncate">{row.path}</code>
                          <span className="font-semibold tabular-nums ml-3">
                            {row.count.toLocaleString("nl-NL")}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logs tab */}
        <TabsContent value="logs" className="mt-4 space-y-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-3 flex items-center gap-2 flex-wrap">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select
                value={methodFilter}
                onChange={(e) => setMethodFilter(e.target.value)}
                className="text-xs h-8 rounded-md border border-input bg-background px-2"
              >
                <option value="">Alle methods</option>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PATCH">PATCH</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-xs h-8 rounded-md border border-input bg-background px-2"
              >
                <option value="">Alle statussen</option>
                <option value="2">2xx — succes</option>
                <option value="4">4xx — client error</option>
                <option value="5">5xx — server error</option>
              </select>
              <span className="text-xs text-muted-foreground ml-auto">
                {filteredUsage.length} resultaten
              </span>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              {usageLoading ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
                  Logs laden...
                </div>
              ) : filteredUsage.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  Geen logs voor deze filters.
                </div>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-50 dark:bg-zinc-900 text-left">
                      <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-2">Tijd</th>
                        <th className="px-4 py-2">Method</th>
                        <th className="px-4 py-2">Path</th>
                        <th className="px-4 py-2">Status</th>
                        <th className="px-4 py-2">Duur</th>
                        <th className="px-4 py-2">IP</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredUsage.map((log) => (
                        <tr key={log.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                          <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                            {formatDate(log.created_at)}
                          </td>
                          <td className="px-4 py-2">
                            <Badge
                              variant="secondary"
                              className="text-[10px] px-1.5 py-0 border-0 bg-zinc-100 dark:bg-zinc-800"
                            >
                              {log.method}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 font-mono truncate max-w-xs">{log.path}</td>
                          <td className={cn("px-4 py-2 font-semibold", STATUS_COLOR(log.status_code))}>
                            {log.status_code}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground tabular-nums">
                            {log.duration_ms ? `${log.duration_ms} ms` : "—"}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground font-mono">
                            {log.ip_address ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Rotated key dialog */}
      <AlertDialog open={!!rotatedKey} onOpenChange={(open) => !open && setRotatedKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sleutel geroteerd</AlertDialogTitle>
            <AlertDialogDescription>
              De oude sleutel is direct ongeldig. Kopieer de nieuwe sleutel — je
              ziet hem niet meer terug.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-2 my-2">
            <Input readOnly value={rotatedKey ?? ""} className="font-mono text-xs" />
            <Button
              variant="outline"
              onClick={() => {
                if (rotatedKey) {
                  navigator.clipboard.writeText(rotatedKey);
                  toast({ title: "Gekopieerd" });
                }
              }}
            >
              Kopieer
            </Button>
          </div>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setRotatedKey(null)}>Sluiten</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm rotate */}
      <AlertDialog open={rotateOpen} onOpenChange={setRotateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sleutel roteren?</AlertDialogTitle>
            <AlertDialogDescription>
              De huidige sleutel wordt direct ongeldig. Update je integratie met
              de nieuwe sleutel om 401-fouten te voorkomen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction onClick={handleRotate}>
              {rotateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Roteer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm revoke */}
      <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sleutel intrekken?</AlertDialogTitle>
            <AlertDialogDescription>
              Deze actie is permanent. De sleutel werkt direct niet meer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              className="bg-destructive hover:bg-destructive/90"
            >
              Intrekken
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className={cn("text-2xl font-bold mt-1", accent ?? "text-zinc-900 dark:text-zinc-100")}>
          {value.toLocaleString("nl-NL")}
        </p>
      </CardContent>
    </Card>
  );
}
