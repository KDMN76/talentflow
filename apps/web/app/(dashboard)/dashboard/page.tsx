"use client";

import { Briefcase, Users, FileText, TrendingUp, Activity, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { ReactivationAlertsWidget } from "@/components/matching/ReactivationAlertsWidget";
import { mockDashboardStats, mockActivityFeed, mockJobs } from "@/lib/mockData";
import { formatRelativeDate, getInitials } from "@/lib/utils";
import { api } from "@/lib/api";

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK_DATA === "true";

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
  }>;
  topJobs: Array<{
    id: string;
    title: string;
    status: string;
    application_count: number;
  }>;
}

export default function DashboardPage() {
  const mockStats: ApiDashboardStats = {
    openJobs: mockDashboardStats.open_jobs,
    candidatesThisMonth: mockDashboardStats.candidates_this_month,
    applicationsThisWeek: mockDashboardStats.applications_this_week,
    hiredThisMonth: 0,
    recentActivity: mockActivityFeed.map((item) => ({
      id: item.id,
      entity_type: item.type,
      entity_id: "",
      action: item.message,
      payload: {},
      created_at: item.timestamp,
      user_name: item.candidate_name ?? null,
    })),
    topJobs: mockJobs
      .filter((j) => j.status === "open")
      .slice(0, 5)
      .map((j) => ({
        id: j.id,
        title: j.title,
        status: j.status,
        application_count: j.application_count,
      })),
  };

  const { data: apiStats, isLoading } = useQuery<ApiDashboardStats>({
    queryKey: ["dashboard", "stats"],
    queryFn: async () => {
      if (USE_MOCK) return mockStats;
      try {
        const { data } = await api.get<ApiDashboardStats>("/dashboard/stats");
        return data;
      } catch {
        return mockStats;
      }
    },
  });

  if (isLoading || !apiStats) {
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

  const stats = apiStats!;

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        title="Dashboard"
        description="Welkom terug! Hier is een overzicht van vandaag."
      />

      {/* Stats row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard
          title="Openstaande vacatures"
          value={stats.openJobs}
          description="actief op dit moment"
          icon={Briefcase}
          iconColor="text-indigo-600"
          iconBg="bg-indigo-50 dark:bg-indigo-950/50"
        />
        <StatsCard
          title="Kandidaten deze maand"
          value={stats.candidatesThisMonth}
          description="nieuw binnengekomen"
          icon={Users}
          iconColor="text-violet-600"
          iconBg="bg-violet-50 dark:bg-violet-950/50"
        />
        <StatsCard
          title="Sollicitaties deze week"
          value={stats.applicationsThisWeek}
          description="actieve sollicitaties"
          icon={FileText}
          iconColor="text-blue-600"
          iconBg="bg-blue-50 dark:bg-blue-950/50"
        />
        <StatsCard
          title="Aangenomen deze maand"
          value={stats.hiredThisMonth}
          description="succesvolle plaatsingen"
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
              Recente activiteit
            </CardTitle>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Activity className="h-3.5 w-3.5" />
              Live
            </div>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {stats.recentActivity.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Nog geen activiteit
              </p>
            )}
            {stats.recentActivity.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-4 py-4 first:pt-0 last:pb-0"
              >
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
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {item.action}
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
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Top jobs */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="text-base font-semibold">
              Top vacatures
            </CardTitle>
            <Button variant="ghost" size="sm" asChild className="text-xs">
              <Link href="/jobs">
                Alle
                <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {stats.topJobs.length === 0 && (
              <div className="text-center py-6 text-sm text-muted-foreground">
                Geen vacatures
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
                    {job.application_count} sollicitanten
                  </p>
                </div>
                {job.status === "open" && (
                  <Badge variant="success" className="shrink-0">
                    Open
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
