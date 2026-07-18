"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import Link from "next/link";
import {
  Key,
  Plus,
  Copy,
  RefreshCw,
  Trash2,
  ChevronRight,
  Check,
  Loader2,
  ShieldAlert,
  AlertTriangle,
  Clock,
  Activity,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";
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
  useApiKeys,
  useApiScopes,
  useCreateApiKey,
  useRevokeApiKey,
  useRotateApiKey,
  type ApiKey,
  type ApiScope,
} from "@/hooks/useApiKeys";

const STATUS_BADGE: Record<ApiKey["status"], { labelKey: string; className: string }> = {
  active: {
    labelKey: "status.active",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-0",
  },
  revoked: {
    labelKey: "status.revoked",
    className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 border-0",
  },
  expired: {
    labelKey: "status.expired",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-0",
  },
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" });
}

function relative(iso: string | null, t: TFunction): string {
  if (!iso) return t("relative.never");
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return t("relative.justNow");
  if (m < 60) return t("relative.minutesAgo", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("relative.hoursAgo", { n: h });
  const d = Math.floor(h / 24);
  if (d < 7) return t("relative.daysAgo", { n: d });
  const w = Math.floor(d / 7);
  if (w < 5) return t("relative.weeksAgo", { n: w });
  return formatDate(iso);
}

interface CreateState {
  step: 1 | 2 | 3;
  name: string;
  description: string;
  scopes: string[];
  rate_limit: number;
  allowed_ips: string;
  expires_at: string;
}

const INIT_CREATE: CreateState = {
  step: 1,
  name: "",
  description: "",
  scopes: [],
  rate_limit: 100,
  allowed_ips: "",
  expires_at: "",
};

export default function ApiKeysPage() {
  const { t } = useTranslation("apiKeys");
  const { toast } = useToast();
  const { data: keys, isLoading } = useApiKeys();
  const { data: scopes } = useApiScopes();
  const createMutation = useCreateApiKey();
  const rotateMutation = useRotateApiKey();
  const revokeMutation = useRevokeApiKey();

  const [createOpen, setCreateOpen] = useState(false);
  const [createState, setCreateState] = useState<CreateState>(INIT_CREATE);
  const [createdKey, setCreatedKey] = useState<{ name: string; key: string } | null>(null);

  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [rotateConfirmId, setRotateConfirmId] = useState<string | null>(null);
  const [showRotated, setShowRotated] = useState<{ name: string; key: string } | null>(null);

  // Group scopes
  const scopeGroups = useMemo(() => {
    const out: Record<string, ApiScope[]> = {};
    for (const s of scopes ?? []) {
      if (!out[s.group]) out[s.group] = [];
      out[s.group].push(s);
    }
    return out;
  }, [scopes]);

  function resetCreate() {
    setCreateState(INIT_CREATE);
  }

  async function handleCreate() {
    const allowedIpsList = createState.allowed_ips
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const result = await createMutation.mutateAsync({
        name: createState.name,
        description: createState.description || undefined,
        scopes: createState.scopes,
        rate_limit_per_minute: createState.rate_limit,
        allowed_ips: allowedIpsList.length > 0 ? allowedIpsList : null,
        expires_at: createState.expires_at
          ? new Date(createState.expires_at).toISOString()
          : null,
      });
      setCreatedKey({ name: result.name, key: result.full_key });
      setCreateOpen(false);
      resetCreate();
    } catch {
      toast({
        title: t("toasts.errorTitle"),
        description: t("toasts.createError"),
        variant: "destructive",
      });
    }
  }

  async function handleRotate() {
    if (!rotateConfirmId) return;
    const meta = keys?.find((k) => k.id === rotateConfirmId);
    try {
      const result = await rotateMutation.mutateAsync(rotateConfirmId);
      setShowRotated({ name: meta?.name ?? "Sleutel", key: result.key });
      setRotateConfirmId(null);
    } catch {
      toast({ title: t("toasts.rotateFailed"), variant: "destructive" });
    }
  }

  async function handleRevoke() {
    if (!revokeId) return;
    try {
      await revokeMutation.mutateAsync(revokeId);
      toast({ title: t("toasts.revoked") });
      setRevokeId(null);
    } catch {
      toast({ title: t("toasts.revokeFailed"), variant: "destructive" });
    }
  }

  function copyToClipboard(value: string) {
    navigator.clipboard.writeText(value);
    toast({ title: t("toasts.copied") });
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("header.title")}
        description={t("header.description")}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/api-explorer">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Activity className="h-3.5 w-3.5" />
                {t("header.playground")}
              </Button>
            </Link>
            <Button
              size="sm"
              onClick={() => {
                resetCreate();
                setCreateOpen(true);
              }}
              className="bg-indigo-600 hover:bg-indigo-700 border-0 gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("header.newKey")}
            </Button>
          </div>
        }
      />

      {/* Lijst */}
      <div className="space-y-3">
        {isLoading ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
              {t("list.loading")}
            </CardContent>
          </Card>
        ) : !keys || keys.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="py-12 text-center">
              <Key className="h-10 w-10 mx-auto text-zinc-300 dark:text-zinc-700 mb-3" />
              <p className="text-sm text-muted-foreground">
                {t("list.empty")}
              </p>
            </CardContent>
          </Card>
        ) : (
          keys.map((key) => (
            <Card key={key.id} className="border-0 shadow-sm">
              <CardContent className="p-5">
                <div className="flex flex-col lg:flex-row lg:items-start gap-4 justify-between">
                  <div className="min-w-0 flex-1 space-y-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/api-keys/${key.id}`}
                        className="text-base font-semibold text-zinc-900 dark:text-zinc-100 hover:text-indigo-600 dark:hover:text-indigo-400"
                      >
                        {key.name}
                      </Link>
                      <Badge className={STATUS_BADGE[key.status].className}>
                        {t(STATUS_BADGE[key.status].labelKey)}
                      </Badge>
                      {key.expires_at && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {t("list.expires", { date: formatDate(key.expires_at) })}
                        </span>
                      )}
                    </div>

                    {key.description && (
                      <p className="text-xs text-muted-foreground">{key.description}</p>
                    )}

                    <div className="flex items-center gap-2 text-xs">
                      <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
                        {key.key_prefix}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(key.key_prefix)}
                        className="text-muted-foreground hover:text-zinc-700"
                        title={t("list.copyPrefix")}
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {key.scopes.length === 0 ? (
                        <span className="text-[11px] text-muted-foreground italic">
                          {t("list.noScopes")}
                        </span>
                      ) : (
                        key.scopes.map((s) => (
                          <Badge
                            key={s}
                            variant="secondary"
                            className={cn(
                              "text-[10px] px-1.5 py-0 border-0",
                              s === "*"
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                                : "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
                            )}
                          >
                            {s}
                          </Badge>
                        ))
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{t("list.lastUsed", { value: relative(key.last_used_at, t) })}</span>
                      <span>{t("list.totalRequests", { total: key.usage_count.toLocaleString("nl-NL") })}</span>
                      <span>{t("list.limit", { limit: key.rate_limit_per_minute })}</span>
                      {key.allowed_ips && key.allowed_ips.length > 0 && (
                        <span>{t("list.ipAllowlist", { ips: key.allowed_ips.join(", ") })}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Link href={`/api-keys/${key.id}`}>
                      <Button size="sm" variant="outline" className="gap-1">
                        {t("list.details")}
                        <ChevronRight className="h-3 w-3" />
                      </Button>
                    </Link>
                    {key.status === "active" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRotateConfirmId(key.id)}
                          className="gap-1"
                        >
                          <RefreshCw className="h-3 w-3" />
                          {t("list.rotate")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRevokeId(key.id)}
                          className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive gap-1"
                        >
                          <Trash2 className="h-3 w-3" />
                          {t("list.revoke")}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* ─── Create modal (multi-step) ─────────────────────────────────── */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) resetCreate();
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("createDialog.title", { step: createState.step })}</DialogTitle>
            <DialogDescription>
              {createState.step === 1 && t("createDialog.step1Description")}
              {createState.step === 2 && t("createDialog.step2Description")}
              {createState.step === 3 && t("createDialog.step3Description")}
            </DialogDescription>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-2 pb-2">
            {[1, 2, 3].map((step) => (
              <div
                key={step}
                className={cn(
                  "flex-1 h-1.5 rounded-full",
                  createState.step >= step ? "bg-indigo-600" : "bg-zinc-200 dark:bg-zinc-700"
                )}
              />
            ))}
          </div>

          {createState.step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Naam</Label>
                <Input
                  value={createState.name}
                  onChange={(e) => setCreateState({ ...createState, name: e.target.value })}
                  placeholder="Bijv. Productie integratie"
                />
              </div>
              <div className="space-y-2">
                <Label>Omschrijving (optioneel)</Label>
                <textarea
                  value={createState.description}
                  onChange={(e) =>
                    setCreateState({ ...createState, description: e.target.value })
                  }
                  rows={3}
                  placeholder="Waar gebruik je deze sleutel voor?"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {createState.step === 2 && (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              {Object.entries(scopeGroups).map(([group, list]) => (
                <div key={group} className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {group}
                  </h4>
                  <div className="grid grid-cols-1 gap-1.5">
                    {list.map((s) => {
                      const checked = createState.scopes.includes(s.key);
                      const dangerScope = s.key === "*";
                      return (
                        <label
                          key={s.key}
                          className={cn(
                            "flex items-center gap-2.5 cursor-pointer rounded-md px-3 py-2 border transition-colors",
                            checked
                              ? dangerScope
                                ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700"
                                : "border-indigo-300 bg-indigo-50 dark:bg-indigo-950/30 dark:border-indigo-700"
                              : "border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800/50 hover:border-zinc-200 dark:hover:border-zinc-700"
                          )}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded accent-indigo-600"
                            checked={checked}
                            onChange={() => {
                              setCreateState({
                                ...createState,
                                scopes: checked
                                  ? createState.scopes.filter((x) => x !== s.key)
                                  : [...createState.scopes, s.key],
                              });
                            }}
                          />
                          <span className="text-sm flex-1 text-zinc-700 dark:text-zinc-300">
                            {s.label}
                            {dangerScope && (
                              <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                                <AlertTriangle className="h-3 w-3" />
                                volledige toegang
                              </span>
                            )}
                          </span>
                          <code className="text-[10px] text-muted-foreground font-mono">
                            {s.key}
                          </code>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {createState.step === 3 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Rate limit (per minuut)</Label>
                <Input
                  type="number"
                  min={1}
                  max={10000}
                  value={createState.rate_limit}
                  onChange={(e) =>
                    setCreateState({
                      ...createState,
                      rate_limit: parseInt(e.target.value, 10) || 100,
                    })
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  Standaard 100 req/min. Verhogen wanneer je grootschalige bulk-imports draait.
                </p>
              </div>
              <div className="space-y-2">
                <Label>IP-allowlist (optioneel)</Label>
                <Input
                  value={createState.allowed_ips}
                  onChange={(e) =>
                    setCreateState({ ...createState, allowed_ips: e.target.value })
                  }
                  placeholder="91.98.232.104, 81.20.10.10"
                />
                <p className="text-[11px] text-muted-foreground">
                  Komma-gescheiden lijst. Leeglaten = geen IP-restrictie.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Verloopdatum (optioneel)</Label>
                <Input
                  type="datetime-local"
                  value={createState.expires_at}
                  onChange={(e) =>
                    setCreateState({ ...createState, expires_at: e.target.value })
                  }
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">{t("createDialog.cancel")}</Button>
            </DialogClose>
            {createState.step > 1 && (
              <Button
                variant="outline"
                onClick={() =>
                  setCreateState({
                    ...createState,
                    step: (createState.step - 1) as 1 | 2 | 3,
                  })
                }
              >
                Vorige
              </Button>
            )}
            {createState.step < 3 ? (
              <Button
                onClick={() =>
                  setCreateState({
                    ...createState,
                    step: (createState.step + 1) as 1 | 2 | 3,
                  })
                }
                disabled={
                  (createState.step === 1 && !createState.name.trim()) ||
                  (createState.step === 2 && createState.scopes.length === 0)
                }
                className="bg-indigo-600 hover:bg-indigo-700 border-0"
              >
                Volgende
              </Button>
            ) : (
              <Button
                onClick={handleCreate}
                disabled={createMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-700 border-0"
              >
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Check className="mr-2 h-4 w-4" />
                Aanmaken
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Created modal (eenmalige weergave key) ──────────────────────── */}
      <Dialog open={!!createdKey} onOpenChange={(open) => !open && setCreatedKey(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-indigo-600" />
              Sleutel aangemaakt
            </DialogTitle>
            <DialogDescription>
              {createdKey?.name} — kopieer de sleutel nu, je ziet hem niet meer terug.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3 flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Bewaar deze sleutel veilig (in een password manager, niet in git).
                Bij verlies kun je de sleutel roteren — de oude wordt direct ongeldig.
              </p>
            </div>
            <div className="space-y-2">
              <Label>API-sleutel</Label>
              <div className="flex gap-2">
                <Input readOnly value={createdKey?.key ?? ""} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  onClick={() => copyToClipboard(createdKey?.key ?? "")}
                  className="shrink-0"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button onClick={() => setCreatedKey(null)} className="bg-indigo-600 hover:bg-indigo-700 border-0">
                Sluiten
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Rotated key modal ────────────────────────────────────────────── */}
      <Dialog open={!!showRotated} onOpenChange={(open) => !open && setShowRotated(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-indigo-600" />
              Sleutel geroteerd
            </DialogTitle>
            <DialogDescription>
              De oude sleutel is direct ongeldig geworden. Update je integratie.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3 flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Deze nieuwe sleutel zie je eenmalig. Kopieer hem nu.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Nieuwe API-sleutel</Label>
              <div className="flex gap-2">
                <Input readOnly value={showRotated?.key ?? ""} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  onClick={() => copyToClipboard(showRotated?.key ?? "")}
                  className="shrink-0"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button onClick={() => setShowRotated(null)}>Sluiten</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Confirm rotate ─────────────────────────────────────────────── */}
      <AlertDialog
        open={!!rotateConfirmId}
        onOpenChange={(open) => !open && setRotateConfirmId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmRotate.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmRotate.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("confirmRotate.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRotate}>
              {rotateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("confirmRotate.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Confirm revoke ─────────────────────────────────────────────── */}
      <AlertDialog open={!!revokeId} onOpenChange={(open) => !open && setRevokeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmRevoke.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmRevoke.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("confirmRevoke.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              className="bg-destructive hover:bg-destructive/90"
            >
              {revokeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("confirmRevoke.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
