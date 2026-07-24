"use client";

import { Briefcase, Users, FileText, TrendingUp, Activity, ArrowRight, Download } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { ReactivationAlertsWidget } from "@/components/matching/ReactivationAlertsWidget";
import { useToast } from "@/components/ui/use-toast";
import { formatRelativeDate, getInitials } from "@/lib/utils";
import { downloadCsv } from "@/lib/downloadHelper";
import { api } from "@/lib/api";
import { activityHref, activityLine } from "@/hooks/useActivity";

function getActivityIcon(type: string) {
  switch (type) {
    case "application":
      return "bg-blue-100 text-blue-600";
    case "stage_change":
      return "bg-purple-100 text-purple-600";
    case "hire":
      return "bg-emerald-100 text-emerald-600";
    case "job_posted":
      return "bg-indigo-100 text-indigo-600";
    default:
      return "bg-zinc-100 text-zinc-600";
  }
}

interface ApiDashboardStats {
  openJobs: number;
  candidatesThisMonth: number;
  applicationsThisWeek: number;
  hiredThisMonth: number;
  recentActivity: Array<{
    id: string;
    entity_type: string;
    entity_id: string;
    action: string;
    payload: Record<string, unknown>;
    created_at: string;
    user_name: string | null;
    app_candidate_id?: string | null;
    app_job_id?: string | null;
  }>;
  topJobs: Array<{
    id: string;
    title: string;
    status: string;
    application_count: number;
  }>;
}

const EMPTY_STATS: ApiDashboardStats = {
  openJobs: 0,
  candidatesThisMonth: 0,
  applicationsThisWeek: 0,
  hiredThisMonth: 0,
  recentActivity: [],
  topJobs: [],
};

export default function DashboardPage() {
  const { t } = useTranslation("dashboard");
  const { toast } = useToast();
  const { data: apiStats, isLoading, isError, error } = useQuery<ApiDashboardStats>({
    queryKey: ["dashboard", "stats"],
    queryFn: async () => {
      const { data } = await api.get<ApiDashboardStats>("/dashboard/stats");
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-8 animate-fade-in">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Skeleton className="lg:col-span-2 h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-8 animate-fade-in">
        <PageHeader title={t("title")} description={t("subtitle")} />
        <Card className="border-0 shadow-sm">
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium text-rose-600">
              {t("error.loadFailed")}
            </p>
            {error instanceof Error && (
              <p className="mt-1 text-xs text-muted-foreground">
                {error.message}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const stats = apiStats ?? EMPTY_STATS;

  const handleExportCsv = () => {
    const rows: Array<[string, string, string | number]> = [
      [t("export.kpiSection"), t("kpi.openJobs.title"), stats.openJobs],
      [t("export.kpiSection"), t("kpi.candidatesThisMonth.title"), stats.candidatesThisMonth],
      [t("export.kpiSection"), t("kpi.applicationsThisWeek.title"), stats.applicationsThisWeek],
      [t("export.kpiSection"), t("kpi.hiredThisMonth.title"), stats.hiredThisMonth],
      ...stats.topJobs.map(
        (j) =>
          [t("export.topJobSection"), j.title, j.application_count] as [string, string, number]
      ),
    ];
    downloadCsv(
      `${t("export.filenamePrefix")}-${new Date().toISOString().slice(0, 10)}.csv`,
      [t("export.colSection"), t("export.colItem"), t("export.colValue")],
      rows
    );
    toast({ title: t("export.success") });
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button variant="outline" size="sm" onClick={handleExportCsv}>
            <Download className="mr-1.5 h-4 w-4" />
            {t("export.button")}
          </Button>
        }
      />

      {/* Stats row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard
          title={t("kpi.openJobs.title")}
          value={stats.openJobs}
          description={t("kpi.openJobs.description")}
          hint={t("kpi.openJobs.hint")}
          icon={Briefcase}
          iconColor="text-indigo-600"
          iconBg="bg-indigo-50 dark:bg-indigo-950/50"
        />
        <StatsCard
          title={t("kpi.candidatesThisMonth.title")}
          value={stats.candidatesThisMonth}
          description={t("kpi.candidatesThisMonth.description")}
          hint={t("kpi.candidatesThisMonth.hint")}
          icon={Users}
          iconColor="text-violet-600"
          iconBg="bg-violet-50 dark:bg-violet-950/50"
        />
        <StatsCard
          title={t("kpi.applicationsThisWeek.title")}
          value={stats.applicationsThisWeek}
          description={t("kpi.applicationsThisWeek.description")}
          hint={t("kpi.applicationsThisWeek.hint")}
          icon={FileText}
          iconColor="text-blue-600"
          iconBg="bg-blue-50 dark:bg-blue-950/50"
        />
        <StatsCard
          title={t("kpi.hiredThisMonth.title")}
          value={stats.hiredThisMonth}
          description={t("kpi.hiredThisMonth.description")}
          hint={t("kpi.hiredThisMonth.hint")}
          icon={TrendingUp}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50 dark:bg-emerald-950/50"
        />
      </div>

      {/* Reactivation alerts widget — shown directly under the stat row so
          recruiters see "warm" candidates before browsing activity / jobs. */}
      <ReactivationAlertsWidget variant="dashboard" />

      {/* Two-column section */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Activity feed */}
        <Card className="lg:col-span-2 border-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="text-base font-semibold">
              {t("recentActivity.title")}
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Activity className="h-3.5 w-3.5" />
                {t("recentActivity.live")}
              </div>
              <Button variant="ghost" size="sm" asChild className="text-xs">
                <Link href="/activity">
                  {t("recentActivity.viewAll")}
                  <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {stats.recentActivity.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {t("recentActivity.empty")}
              </p>
            )}
            {stats.recentActivity.slice(0, 6).map((item) => {
              const href = activityHref(item);
              const rowClass =
                "flex items-start gap-4 py-4 first:pt-0 last:pb-0";
              const inner = (
                <>
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${getActivityIcon(item.entity_type)}`}
                  >
                    {item.user_name ? (
                      getInitials(item.user_name)
                    ) : (
                      <Briefcase className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* Leesbare zin i.p.v. de ruwe actie-code (bv. 'resume_parsed'). */}
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                      {activityLine(item, t)}
                    </p>
                    {item.user_name && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.user_name}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatRelativeDate(item.created_at)}
                  </span>
                </>
              );
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
          </CardContent>
        </Card>

        {/* Top jobs */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="text-base font-semibold">
              {t("topJobs.title")}
            </CardTitle>
            <Button variant="ghost" size="sm" asChild className="text-xs">
              <Link href="/jobs">
                {t("topJobs.viewAll")}
                <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {stats.topJobs.length === 0 && (
              <div className="text-center py-6 text-sm text-muted-foreground">
                {t("topJobs.empty")}
              </div>
            )}
            {stats.topJobs.map((job) => (
              <Link
                key={job.id}
                href={`/jobs/${job.id}`}
                className="flex items-center gap-3 rounded-lg p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/50">
                  <Briefcase className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate group-hover:text-indigo-600 transition-colors">
                    {job.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("topJobs.applicants", { count: job.application_count })}
                  </p>
                </div>
                {job.status === "open" && (
                  <Badge variant="success" className="shrink-0">
                    {t("topJobs.statusOpen")}
                  </Badge>
                )}
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
