"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Activity, Briefcase, ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  useActivityLog,
  activityHref,
  activityLine,
  activityExportParams,
  type ActivityItem,
  type ActivityFilters,
} from "@/hooks/useActivity";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/downloadHelper";
import { formatRelativeDate, formatDate, formatDateTime, getInitials } from "@/lib/utils";

// Entiteit-typen die in de activiteitenfeed voorkomen, met NL-labels.
const ENTITY_TYPE_LABELS: Record<string, string> = {
  candidate: "Kandidaat",
  job: "Vacature",
  application: "Sollicitatie",
  career_page: "Career page",
};

function activityColor(type: string): string {
  switch (type) {
    case "application":
      return "bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300";
    case "stage_change":
      return "bg-purple-100 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300";
    case "hire":
      return "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "job":
    case "job_posted":
      return "bg-indigo-100 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300";
    default:
      return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  }
}

export default function ActivityLogPage() {
  const { t } = useTranslation("dashboard");
  const { toast } = useToast();
  const [page, setPage] = useState(1);

  // Filters: pagina/entiteit, persoon, datumbereik.
  const [entityType, setEntityType] = useState("all");
  const [userId, setUserId] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filters: ActivityFilters = {
    entityType: entityType !== "all" ? entityType : undefined,
    userId: userId !== "all" ? userId : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };
  const hasActiveFilters =
    entityType !== "all" || userId !== "all" || !!dateFrom || !!dateTo;

  // Reset naar pagina 1 zodra een filter wijzigt.
  useEffect(() => {
    setPage(1);
  }, [entityType, userId, dateFrom, dateTo]);

  const { data, isLoading } = useActivityLog(page, 25, filters);

  const items = data?.data ?? [];
  const meta = data?.meta;

  // Persoon-opties: accumuleer {id → naam} uit geladen activiteiten. Rol-veilig
  // (geen admin-only /users-call) en blijft staan bij een actieve filter.
  const [people, setPeople] = useState<Record<string, string>>({});
  useEffect(() => {
    setPeople((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const it of items) {
        if (it.user_id && it.user_name && !next[it.user_id]) {
          next[it.user_id] = it.user_name;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [items]);

  const resetFilters = () => {
    setEntityType("all");
    setUserId("all");
    setDateFrom("");
    setDateTo("");
  };

  const handleExport = async () => {
    try {
      const { data: exportData } = await api.get<{ data: ActivityItem[] }>(
        "/dashboard/activity/export",
        { params: activityExportParams(filters) }
      );
      const rows = (exportData.data ?? []).map((a) => [
        formatDate(a.created_at),
        a.entity_type,
        a.action,
        a.user_name ?? "",
      ]);
      downloadCsv(
        `activiteitenlogboek-${new Date().toISOString().slice(0, 10)}.csv`,
        [
          t("activityLog.export.colDate"),
          t("activityLog.export.colType"),
          t("activityLog.export.colAction"),
          t("activityLog.export.colUser"),
        ],
        rows
      );
      toast({ title: t("activityLog.export.success") });
    } catch {
      toast({ variant: "destructive", title: t("activityLog.export.error") });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("activityLog.title")}
        description={t("activityLog.subtitle", { count: meta?.total ?? 0 })}
        actions={
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-1.5 h-4 w-4" />
            {t("activityLog.export.button")}
          </Button>
        }
      />

      {/* Filters: type / persoon / datumbereik */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Type</label>
          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle types</SelectItem>
              {Object.entries(ENTITY_TYPE_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Persoon</label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle personen</SelectItem>
              {Object.entries(people)
                .sort((a, b) => a[1].localeCompare(b[1], "nl"))
                .map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Van</label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-[150px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Tot</label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-[150px]"
          />
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <X className="mr-1 h-3.5 w-3.5" />
            Wissen
          </Button>
        )}
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-1/2" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
                <Activity className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("recentActivity.empty")}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((item) => {
                const href = activityHref(item);
                const rowClass =
                  "flex items-start gap-4 px-5 py-4 transition-colors hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30";
                const inner = (
                  <>
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${activityColor(item.entity_type)}`}
                    >
                      {item.user_name ? (
                        getInitials(item.user_name)
                      ) : (
                        <Briefcase className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                        {activityLine(item, t)}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        {item.user_name && <span>{item.user_name}</span>}
                        {item.user_name && <span className="text-zinc-300 dark:text-zinc-600">·</span>}
                        <span>{ENTITY_TYPE_LABELS[item.entity_type] ?? item.entity_type.replace("_", " ")}</span>
                      </div>
                    </div>
                    <span
                      className="shrink-0 whitespace-nowrap text-xs text-muted-foreground"
                      title={formatRelativeDate(item.created_at)}
                    >
                      {formatDateTime(item.created_at)}
                    </span>
                  </>
                );
                // Klikbaar wanneer we een doel hebben (kandidaat/vacature).
                return href ? (
                  <Link key={item.id} href={href} className={`${rowClass} group cursor-pointer`}>
                    {inner}
                  </Link>
                ) : (
                  <div key={item.id} className={rowClass}>
                    {inner}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {meta && meta.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {t("activityLog.pageOf", { page: meta.page, pages: meta.pages })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              {t("activityLog.prev")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= meta.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("activityLog.next")}
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
