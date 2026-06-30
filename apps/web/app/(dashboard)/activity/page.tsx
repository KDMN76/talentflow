"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, Briefcase, ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActivityLog } from "@/hooks/useActivity";
import { formatRelativeDate, formatDate, getInitials } from "@/lib/utils";

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
  const [page, setPage] = useState(1);
  const { data, isLoading } = useActivityLog(page, 25);

  const items = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("activityLog.title")}
        description={t("activityLog.subtitle", { count: meta?.total ?? 0 })}
      />

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
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30"
                >
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
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {item.action}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      {item.user_name && <span>{item.user_name}</span>}
                      {item.user_name && <span className="text-zinc-300 dark:text-zinc-600">·</span>}
                      <span className="capitalize">{item.entity_type.replace("_", " ")}</span>
                    </div>
                  </div>
                  <span
                    className="shrink-0 whitespace-nowrap text-xs text-muted-foreground"
                    title={formatDate(item.created_at)}
                  >
                    {formatRelativeDate(item.created_at)}
                  </span>
                </div>
              ))}
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
