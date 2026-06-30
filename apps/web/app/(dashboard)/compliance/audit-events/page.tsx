"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Clock,
  Download,
  FileSearch,
  Loader2,
  Pause,
  Play,
  Search,
  Shield,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  useAuditEvents,
  useExportAuditTrail,
  useAuditActions,
} from "@/hooks/useSecurity";
import {
  EXT_AUDIT_CATEGORY_LABELS,
  EXT_AUDIT_CATEGORY_COLORS,
  type ExtAuditEvent,
  type ExtAuditCategory,
  type ExtAuditFilters,
} from "@/lib/types/security";
import { cn } from "@/lib/utils";

const ENTITY_TYPES = [
  { value: "all", labelKey: "auditEvents.entityTypes.all" },
  { value: "user", labelKey: "auditEvents.entityTypes.user" },
  { value: "candidate", labelKey: "auditEvents.entityTypes.candidate" },
  { value: "role", labelKey: "auditEvents.entityTypes.role" },
  { value: "role_assignment", labelKey: "auditEvents.entityTypes.roleAssignment" },
  { value: "security_settings", labelKey: "auditEvents.entityTypes.securitySettings" },
  { value: "sso_config", labelKey: "auditEvents.entityTypes.ssoConfig" },
  { value: "scim_token", labelKey: "auditEvents.entityTypes.scimToken" },
  { value: "api_key", labelKey: "auditEvents.entityTypes.apiKey" },
];

function diffKeys(a: Record<string, unknown> | null, b: Record<string, unknown> | null): string[] {
  return Array.from(new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]));
}

function DiffViewer({
  before,
  after,
}: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}) {
  const { t } = useTranslation("miscHome");
  const keys = diffKeys(before, after);
  if (keys.length === 0) {
    return (
      <p className="text-xs italic text-muted-foreground">
        {t("auditEvents.diff.noChanges")}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted/40">
          <tr>
            <th className="px-2 py-1.5 text-left font-semibold">{t("auditEvents.diff.field")}</th>
            <th className="px-2 py-1.5 text-left font-semibold">{t("auditEvents.diff.before")}</th>
            <th className="px-2 py-1.5 text-left font-semibold">{t("auditEvents.diff.after")}</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const b = before?.[k];
            const a = after?.[k];
            const changed = JSON.stringify(b) !== JSON.stringify(a);
            return (
              <tr
                key={k}
                className={cn(
                  "border-t border-border",
                  changed && "bg-amber-50/40 dark:bg-amber-950/10"
                )}
              >
                <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground align-top">
                  {k}
                </td>
                <td className="px-2 py-1.5 font-mono text-[11px] text-red-600 dark:text-red-400 align-top">
                  {b === undefined ? "—" : JSON.stringify(b)}
                </td>
                <td className="px-2 py-1.5 font-mono text-[11px] text-emerald-600 dark:text-emerald-400 align-top">
                  {a === undefined ? "—" : JSON.stringify(a)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function AuditEventsPage() {
  const { t } = useTranslation("miscHome");
  const { toast } = useToast();
  const { data: actionsList } = useAuditActions();

  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState("all");
  const [actionPattern, setActionPattern] = useState("");
  const [category, setCategory] = useState<"all" | ExtAuditCategory>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [realtime, setRealtime] = useState(false);
  const [detail, setDetail] = useState<ExtAuditEvent | null>(null);

  const filters: ExtAuditFilters = useMemo(() => {
    const f: ExtAuditFilters = {};
    if (entityType !== "all") f.entity_type = entityType;
    if (actionPattern.trim()) f.action_pattern = actionPattern.trim();
    if (category !== "all") f.category = category;
    if (search.trim()) f.search = search.trim();
    if (from) f.from = new Date(from).toISOString();
    if (to) f.to = new Date(to + "T23:59:59").toISOString();
    return f;
  }, [search, entityType, actionPattern, category, from, to]);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
  } = useAuditEvents(filters);

  const exportMutation = useExportAuditTrail();

  // Realtime polling
  useEffect(() => {
    if (!realtime) return;
    const id = window.setInterval(() => {
      refetch();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [realtime, refetch]);

  const events: ExtAuditEvent[] = useMemo(
    () => data?.pages.flatMap((p) => p.data) ?? [],
    [data]
  );
  const total = data?.pages[0]?.cursor.total ?? 0;

  const handleExport = async () => {
    const result = await exportMutation.mutateAsync({
      filters,
      format: "csv",
    });
    toast({
      title: t("auditEvents.exportToast.title"),
      description: t("auditEvents.exportToast.description", {
        jobId: result.job_id,
        rows: result.estimated_rows,
      }),
    });
  };

  const resetFilters = () => {
    setSearch("");
    setEntityType("all");
    setActionPattern("");
    setCategory("all");
    setFrom("");
    setTo("");
  };

  const filtersActive =
    !!(search || entityType !== "all" || actionPattern || category !== "all" || from || to);

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title={t("auditEvents.header.title")}
        description={t("auditEvents.header.description")}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRealtime((r) => !r)}
              className={
                realtime
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40"
                  : ""
              }
            >
              {realtime ? (
                <Pause className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              {realtime
                ? t("auditEvents.realtime.on")
                : t("auditEvents.realtime.off")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={exportMutation.isPending}
            >
              {exportMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t("auditEvents.export")}
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2">
            <div className="lg:col-span-2 relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("auditEvents.filters.searchPlaceholder")}
                className="pl-9"
              />
            </div>
            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map((e) => (
                  <SelectItem key={e.value} value={e.value}>
                    {t(e.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={category}
              onValueChange={(v) =>
                setCategory(v as "all" | ExtAuditCategory)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={t("auditEvents.filters.allCategories")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("auditEvents.filters.allCategories")}</SelectItem>
                {(Object.keys(EXT_AUDIT_CATEGORY_LABELS) as ExtAuditCategory[]).map(
                  (c) => (
                    <SelectItem key={c} value={c}>
                      {EXT_AUDIT_CATEGORY_LABELS[c]}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
            <div className="relative">
              <Input
                list="action-list"
                value={actionPattern}
                onChange={(e) => setActionPattern(e.target.value)}
                placeholder={t("auditEvents.filters.actionPlaceholder")}
                className="font-mono text-xs"
              />
              <datalist id="action-list">
                {actionsList?.map((a) => <option key={a} value={a} />)}
              </datalist>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">{t("auditEvents.filters.from")}</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">{t("auditEvents.filters.until")}</Label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              {filtersActive && (
                <Button variant="outline" size="sm" onClick={resetFilters}>
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  {t("auditEvents.filters.clear")}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabel */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="border-b border-border bg-muted/30 px-4 py-2 flex items-center gap-2 text-xs">
          <Shield className="h-3.5 w-3.5 text-indigo-600" />
          <span className="font-semibold">{t("auditEvents.table.wormTrail")}</span>
          <span className="text-muted-foreground">
            {t("auditEvents.table.wormNote")}
          </span>
          <span className="ml-auto text-muted-foreground">
            {t("auditEvents.table.eventsCount", {
              shown: events.length,
              total,
            })}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-semibold w-44">{t("auditEvents.table.colTime")}</th>
                <th className="px-3 py-2 text-left font-semibold">{t("auditEvents.table.colAction")}</th>
                <th className="px-3 py-2 text-left font-semibold">{t("auditEvents.table.colEntity")}</th>
                <th className="px-3 py-2 text-left font-semibold">{t("auditEvents.table.colUser")}</th>
                <th className="px-3 py-2 text-left font-semibold">{t("auditEvents.table.colIp")}</th>
                <th className="px-3 py-2 text-right font-semibold w-24">{t("auditEvents.table.colDetails")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-12 text-center">
                    <Loader2 className="inline h-5 w-5 animate-spin text-muted-foreground" />
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-12">
                    <div className="flex flex-col items-center text-center">
                      <FileSearch className="h-10 w-10 text-zinc-300 mb-3" />
                      <p className="font-semibold">{t("auditEvents.table.emptyTitle")}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("auditEvents.table.emptyDescription")}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                events.map((e) => (
                  <tr
                    key={e.id}
                    className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/40 transition-colors"
                  >
                    <td className="px-3 py-2.5 align-top">
                      <div className="text-xs font-mono text-muted-foreground">
                        {new Date(e.occurred_at).toLocaleString("nl-NL", {
                          dateStyle: "short",
                          timeStyle: "medium",
                        })}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="space-y-0.5">
                        <Badge
                          className={cn(
                            "text-[10px] border-0",
                            EXT_AUDIT_CATEGORY_COLORS[e.category]
                          )}
                        >
                          {EXT_AUDIT_CATEGORY_LABELS[e.category]}
                        </Badge>
                        <div className="text-xs font-medium">{e.label}</div>
                        <div className="text-[10px] font-mono text-muted-foreground">
                          {e.action}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="text-xs font-medium">{e.entity_label ?? e.entity_type}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">
                        {e.entity_type}/{e.entity_id}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="text-xs">{e.actor_name}</div>
                      {e.actor_email && (
                        <div className="text-[10px] text-muted-foreground">
                          {e.actor_email}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {e.ip_address ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-top text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDetail(e)}
                      >
                        <Activity className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {hasNextPage && (
          <div className="border-t border-border p-3 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t("auditEvents.table.loadMore")}
            </Button>
          </div>
        )}
      </div>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-indigo-600" />
              {t("auditEvents.detail.title")}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t("auditEvents.detail.time")} value={new Date(detail.occurred_at).toLocaleString("nl-NL")} />
                <Field label={t("auditEvents.detail.action")} value={detail.label} mono />
                <Field label={t("auditEvents.detail.actionKey")} value={detail.action} mono />
                <Field
                  label={t("auditEvents.detail.category")}
                  value={EXT_AUDIT_CATEGORY_LABELS[detail.category]}
                />
                <Field label={t("auditEvents.detail.entity")} value={detail.entity_label ?? "—"} />
                <Field
                  label={t("auditEvents.detail.entityRef")}
                  value={`${detail.entity_type}/${detail.entity_id}`}
                  mono
                />
                <Field
                  label={t("auditEvents.detail.performedBy")}
                  value={`${detail.actor_name}${detail.actor_email ? ` (${detail.actor_email})` : ""}`}
                />
                <Field label={t("auditEvents.detail.role")} value={detail.actor_role ?? "—"} />
                <Field label={t("auditEvents.detail.ip")} value={detail.ip_address ?? "—"} mono />
                <Field label={t("auditEvents.detail.requestId")} value={detail.request_id} mono />
              </div>

              {detail.user_agent && (
                <div>
                  <Label className="text-[10px] uppercase text-muted-foreground">
                    {t("auditEvents.detail.userAgent")}
                  </Label>
                  <pre className="text-[11px] font-mono bg-zinc-50 dark:bg-zinc-900/50 rounded px-2 py-1.5 overflow-x-auto">
                    {detail.user_agent}
                  </pre>
                </div>
              )}

              <div>
                <Label className="text-[10px] uppercase text-muted-foreground flex items-center gap-1">
                  {t("auditEvents.detail.diff")}
                </Label>
                <DiffViewer before={detail.before} after={detail.after} />
              </div>

              {detail.metadata && Object.keys(detail.metadata).length > 0 && (
                <div>
                  <Label className="text-[10px] uppercase text-muted-foreground">
                    {t("auditEvents.detail.metadata")}
                  </Label>
                  <pre className="text-[11px] font-mono bg-zinc-50 dark:bg-zinc-900/50 rounded px-2 py-1.5 overflow-x-auto">
                    {JSON.stringify(detail.metadata, null, 2)}
                  </pre>
                </div>
              )}

              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[11px] text-muted-foreground">
                  {t("auditEvents.detail.wormSeal")}{" "}
                  <code className="font-mono text-[11px]">{detail.worm_hash}</code>
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className={cn("text-sm", mono && "font-mono text-xs")}>{value}</p>
    </div>
  );
}
