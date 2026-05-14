"use client";

import {
  Briefcase,
  Users,
  Clock,
  UserCheck,
  TrendingUp,
  Users2,
  BarChart3,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
  CartesianGrid,
} from "recharts";

import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn, getInitials } from "@/lib/utils";

import {
  useAnalyticsOverview,
  useAnalyticsFunnel,
  useAnalyticsRecruiterStats,
  useAnalyticsSourceBreakdown,
  useAnalyticsTimeToHireTrend,
  useAnalyticsApplicationsTrend,
} from "@/hooks/useAnalytics";

// ─── Constants ────────────────────────────────────────────────────────────────

const PIE_COLORS = ["#6366f1", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b"];

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string | number;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
}

function KpiCard({ label, value, icon: Icon, iconBg, iconColor }: KpiCardProps) {
  return (
    <Card className="border shadow-sm hover:shadow-md transition-shadow duration-200">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground leading-tight">
              {label}
            </p>
            <p className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              {value}
            </p>
          </div>
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
              iconBg
            )}
          >
            <Icon className={cn("h-5 w-5", iconColor)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Skeleton loaders ─────────────────────────────────────────────────────────

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  );
}

function RecruitersSkeleton() {
  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-3">
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TrendsSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; name: string }>;
  label?: string;
  formatter?: (value: number) => [string, string];
}

function CustomTooltip({ active, payload, label, formatter }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const [formattedValue, formattedName] = formatter
    ? formatter(payload[0].value)
    : [String(payload[0].value), payload[0].name];
  return (
    <div className="rounded-lg border bg-white px-3 py-2 shadow-lg text-sm dark:bg-zinc-900 dark:border-zinc-700">
      {label && (
        <p className="font-medium text-zinc-700 dark:text-zinc-300 mb-1">{label}</p>
      )}
      <p className="text-zinc-900 dark:text-zinc-100 font-semibold">
        {formattedValue}{" "}
        <span className="font-normal text-muted-foreground text-xs">
          {formattedName}
        </span>
      </p>
    </div>
  );
}

// ─── Tab: Overzicht ───────────────────────────────────────────────────────────

function OverviewTab() {
  const { data: overview, isLoading: loadingOverview } = useAnalyticsOverview();
  const { data: funnel, isLoading: loadingFunnel } = useAnalyticsFunnel();
  const { data: sources, isLoading: loadingSources } = useAnalyticsSourceBreakdown();

  const isLoading = loadingOverview || loadingFunnel || loadingSources;

  if (isLoading) return <OverviewSkeleton />;

  const conversionRate =
    funnel && funnel.length >= 2
      ? ((funnel[funnel.length - 1].count / funnel[0].count) * 100).toFixed(1)
      : "0.0";

  return (
    <div className="space-y-6">
      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Open vacatures"
          value={overview?.open_jobs ?? 0}
          icon={Briefcase}
          iconBg="bg-indigo-50 dark:bg-indigo-950/50"
          iconColor="text-indigo-600 dark:text-indigo-400"
        />
        <KpiCard
          label="Kandidaten deze maand"
          value={overview?.applications_this_month ?? 0}
          icon={Users}
          iconBg="bg-violet-50 dark:bg-violet-950/50"
          iconColor="text-violet-600 dark:text-violet-400"
        />
        <KpiCard
          label="Gem. time-to-hire"
          value={`${overview?.avg_time_to_hire_days ?? 0} dgn`}
          icon={Clock}
          iconBg="bg-blue-50 dark:bg-blue-950/50"
          iconColor="text-blue-600 dark:text-blue-400"
        />
        <KpiCard
          label="Aangenomen"
          value={overview?.hired_this_month ?? 0}
          icon={UserCheck}
          iconBg="bg-emerald-50 dark:bg-emerald-950/50"
          iconColor="text-emerald-600 dark:text-emerald-400"
        />
        <KpiCard
          label="Actieve recruiters"
          value={overview?.active_recruiters ?? 0}
          icon={Users2}
          iconBg="bg-amber-50 dark:bg-amber-950/50"
          iconColor="text-amber-600 dark:text-amber-400"
        />
        <KpiCard
          label="Conversieratio"
          value={`${conversionRate}%`}
          icon={TrendingUp}
          iconBg="bg-rose-50 dark:bg-rose-950/50"
          iconColor="text-rose-600 dark:text-rose-400"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Pipeline funnel — horizontal bar */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-indigo-500" />
              Pipeline Funnel
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={funnel}
                layout="vertical"
                margin={{ top: 4, right: 20, left: 0, bottom: 4 }}
              >
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: "#71717a" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="stage_name"
                  width={148}
                  tick={{ fontSize: 11, fill: "#71717a" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  content={
                    <CustomTooltip
                      formatter={(v) => [String(v), "kandidaten"]}
                    />
                  }
                  cursor={{ fill: "#f4f4f5" }}
                />
                <Bar
                  dataKey="count"
                  fill="#6366f1"
                  radius={[0, 4, 4, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Source breakdown — pie */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-purple-500" />
              Kandidaatbronnen
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 flex flex-col items-center">
            <ResponsiveContainer width="100%" height={230}>
              <PieChart>
                <Pie
                  data={sources}
                  dataKey="percentage"
                  nameKey="source"
                  cx="50%"
                  cy="50%"
                  outerRadius={88}
                  label={(props) => {
                    const p = props as unknown as { source: string; percentage: number };
                    return `${p.source} ${p.percentage}%`;
                  }}
                  labelLine={{ stroke: "#d4d4d8", strokeWidth: 1 }}
                >
                  {sources?.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={PIE_COLORS[index % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => [
                    `${value ?? 0}%`,
                    "aandeel",
                  ]}
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid #e4e4e7",
                    fontSize: "12px",
                  }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => (
                    <span style={{ fontSize: 12, color: "#71717a" }}>
                      {value}
                    </span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Tab: Recruiters ──────────────────────────────────────────────────────────

function RecruitersTab() {
  const { data: recruiters, isLoading } = useAnalyticsRecruiterStats();

  if (isLoading) return <RecruitersSkeleton />;

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Users2 className="h-4 w-4 text-indigo-500" />
          Recruiter prestaties
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-zinc-50/60 dark:bg-zinc-800/40">
                <th className="py-3 pl-6 pr-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Recruiter
                </th>
                <th className="py-3 px-4 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Open vacatures
                </th>
                <th className="py-3 px-4 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Sollicitaties
                </th>
                <th className="py-3 px-4 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Aangenomen
                </th>
                <th className="py-3 pl-4 pr-6 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Gem. days
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recruiters?.map((r) => (
                <tr
                  key={r.recruiter_id}
                  className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30 transition-colors"
                >
                  <td className="py-4 pl-6 pr-4">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-xs font-semibold">
                          {getInitials(r.recruiter_name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {r.recruiter_name}
                      </span>
                    </div>
                  </td>
                  <td className="py-4 px-4 text-center">
                    <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-semibold text-xs">
                      {r.open_jobs}
                    </span>
                  </td>
                  <td className="py-4 px-4 text-center font-medium text-zinc-700 dark:text-zinc-300">
                    {r.applications_this_month}
                  </td>
                  <td className="py-4 px-4 text-center">
                    <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-semibold text-xs">
                      {r.hires_this_month}
                    </span>
                  </td>
                  <td className="py-4 pl-4 pr-6 text-center">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        r.avg_time_to_hire_days <= 20
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                          : r.avg_time_to_hire_days <= 25
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                          : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                      )}
                    >
                      {r.avg_time_to_hire_days} dgn
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Tab: Trends ──────────────────────────────────────────────────────────────

function TrendsTab() {
  const { data: timeToHire, isLoading: loadingTTH } =
    useAnalyticsTimeToHireTrend();
  const { data: appsTrend, isLoading: loadingApps } =
    useAnalyticsApplicationsTrend();

  const isLoading = loadingTTH || loadingApps;

  if (isLoading) return <TrendsSkeleton />;

  return (
    <div className="space-y-6">
      {/* Time-to-hire line chart */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-indigo-500" />
            Time-to-Hire Trend
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart
              data={timeToHire}
              margin={{ top: 8, right: 20, left: 0, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: "#71717a" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 40]}
                tick={{ fontSize: 11, fill: "#71717a" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v}d`}
              />
              <Tooltip
                formatter={(v) => [`${v ?? 0} dagen`, "Gem. time-to-hire"]}
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid #e4e4e7",
                  fontSize: "12px",
                }}
              />
              <Line
                type="monotone"
                dataKey="avg_days"
                stroke="#6366f1"
                strokeWidth={2}
                dot={{ fill: "#6366f1", r: 4, strokeWidth: 0 }}
                activeDot={{ r: 6, strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Applications per week bar chart */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-purple-500" />
            Sollicitaties per Week
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={appsTrend}
              margin={{ top: 8, right: 20, left: 0, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 11, fill: "#71717a" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#71717a" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(v) => [String(v ?? 0), "sollicitaties"]}
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid #e4e4e7",
                  fontSize: "12px",
                }}
                cursor={{ fill: "#f4f4f5" }}
              />
              <Bar
                dataKey="count"
                fill="#8b5cf6"
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        title="Analytiek"
        description="Inzicht in je recruitmentprestaties"
      />

      <Tabs defaultValue="overzicht" className="space-y-6">
        <TabsList className="bg-zinc-100/80 dark:bg-zinc-800/60 border border-border shadow-none h-10">
          <TabsTrigger
            value="overzicht"
            className="data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-900 data-[state=active]:shadow-sm px-5"
          >
            Overzicht
          </TabsTrigger>
          <TabsTrigger
            value="recruiters"
            className="data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-900 data-[state=active]:shadow-sm px-5"
          >
            Recruiters
          </TabsTrigger>
          <TabsTrigger
            value="trends"
            className="data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-900 data-[state=active]:shadow-sm px-5"
          >
            Trends
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overzicht">
          <OverviewTab />
        </TabsContent>

        <TabsContent value="recruiters">
          <RecruitersTab />
        </TabsContent>

        <TabsContent value="trends">
          <TrendsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
