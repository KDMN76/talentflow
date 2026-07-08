"use client";

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Briefcase,
  Users,
  Clock,
  UserCheck,
  TrendingUp,
  Users2,
  BarChart3,
  Search,
  Calendar,
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
import { Input } from "@/components/ui/input";
import { HelpHint } from "@/components/ui/HelpHint";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, getInitials } from "@/lib/utils";
import { useTenantUsers } from "@/hooks/useUsers";
import { AiBiasTab } from "@/components/analytics/AiBiasTab";

import {
  useAnalyticsOverview,
  useAnalyticsFunnel,
  useAnalyticsRecruiterStats,
  useAnalyticsSourceBreakdown,
  useAnalyticsTimeToHireTrend,
  useAnalyticsApplicationsTrend,
  type AnalyticsFilters,
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
  helpText?: string;
}

function KpiCard({ label, value, icon: Icon, iconBg, iconColor, helpText }: KpiCardProps) {
  return (
    <Card className="border shadow-sm hover:shadow-md transition-shadow duration-200">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <p className="text-xs font-medium text-muted-foreground leading-tight">
                {label}
              </p>
              {helpText && <HelpHint text={helpText} />}
            </div>
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

function OverviewTab({ filters }: { filters: AnalyticsFilters }) {
  const { t } = useTranslation("analytics");
  const { data: overview, isLoading: loadingOverview } = useAnalyticsOverview(filters);
  const { data: funnel, isLoading: loadingFunnel } = useAnalyticsFunnel(filters);
  const { data: sources, isLoading: loadingSources } = useAnalyticsSourceBreakdown(filters);

  const isLoading = loadingOverview || loadingFunnel || loadingSources;

  if (isLoading) return <OverviewSkeleton />;

  // Guard tegen deling door nul: zonder kandidaten is funnel[0].count 0 →
  // 0/0 = NaN → "NaN%" in de UI. Toon dan 0.0%.
  const firstStageCount = funnel?.[0]?.count ?? 0;
  const conversionRate =
    funnel && funnel.length >= 2 && firstStageCount > 0
      ? ((funnel[funnel.length - 1].count / firstStageCount) * 100).toFixed(1)
      : "0.0";

  return (
    <div className="space-y-6">
      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label={t("overview.kpi.openJobs")}
          value={overview?.open_jobs ?? 0}
          helpText={t("overview.hint.openJobs")}
          icon={Briefcase}
          iconBg="bg-indigo-50 dark:bg-indigo-950/50"
          iconColor="text-indigo-600 dark:text-indigo-400"
        />
        <KpiCard
          label={t("overview.kpi.applicationsThisMonth")}
          value={overview?.applications_this_month ?? 0}
          helpText={t("overview.hint.applicationsThisMonth")}
          icon={Users}
          iconBg="bg-violet-50 dark:bg-violet-950/50"
          iconColor="text-violet-600 dark:text-violet-400"
        />
        <KpiCard
          label={t("overview.kpi.avgTimeToHire")}
          value={`${overview?.avg_time_to_hire_days ?? 0} ${t("overview.days")}`}
          helpText={t("overview.hint.avgTimeToHire")}
          icon={Clock}
          iconBg="bg-blue-50 dark:bg-blue-950/50"
          iconColor="text-blue-600 dark:text-blue-400"
        />
        <KpiCard
          label={t("overview.kpi.hired")}
          value={overview?.hired_this_month ?? 0}
          helpText={t("overview.hint.hired")}
          icon={UserCheck}
          iconBg="bg-emerald-50 dark:bg-emerald-950/50"
          iconColor="text-emerald-600 dark:text-emerald-400"
        />
        <KpiCard
          label={t("overview.kpi.activeRecruiters")}
          value={overview?.active_recruiters ?? 0}
          helpText={t("overview.hint.activeRecruiters")}
          icon={Users2}
          iconBg="bg-amber-50 dark:bg-amber-950/50"
          iconColor="text-amber-600 dark:text-amber-400"
        />
        <KpiCard
          label={t("overview.kpi.conversionRate")}
          value={`${conversionRate}%`}
          helpText={t("overview.hint.conversionRate")}
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
              {t("overview.funnel.title")}
              <HelpHint text={t("overview.funnel.hint")} />
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
                      formatter={(v) => [String(v), t("overview.funnel.tooltip")]}
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
              {t("overview.sources.title")}
              <HelpHint text={t("overview.sources.hint")} />
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
                    t("overview.sources.tooltip"),
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

function RecruitersTab({ filters }: { filters: AnalyticsFilters }) {
  const { t } = useTranslation("analytics");
  const { data: recruiters, isLoading } = useAnalyticsRecruiterStats(filters);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recruiters ?? [];
    return (recruiters ?? []).filter((r) =>
      r.recruiter_name.toLowerCase().includes(q)
    );
  }, [recruiters, search]);

  if (isLoading) return <RecruitersSkeleton />;

  return (
    <Card className="border shadow-sm">
      <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Users2 className="h-4 w-4 text-indigo-500" />
          {t("recruiters.title")}
        </CardTitle>
        <div className="relative w-full sm:max-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("recruiters.searchPlaceholder")}
            className="h-9 pl-9"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-zinc-50/60 dark:bg-zinc-800/40">
                <th className="py-3 pl-6 pr-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("recruiters.columns.recruiter")}
                </th>
                <th className="py-3 px-4 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("recruiters.columns.openJobs")}
                </th>
                <th className="py-3 px-4 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("recruiters.columns.applications")}
                </th>
                <th className="py-3 px-4 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("recruiters.columns.hired")}
                </th>
                <th className="py-3 pl-4 pr-6 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("recruiters.columns.avgDays")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    {t("recruiters.empty")}
                  </td>
                </tr>
              )}
              {filtered.map((r) => (
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
                      {r.avg_time_to_hire_days} {t("recruiters.days")}
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

function TrendsTab({ filters }: { filters: AnalyticsFilters }) {
  const { t } = useTranslation("analytics");
  // Trends houden hun eigen tijdvenster; alleen de recruiter-scope volgt het filter.
  const trendFilters = { recruiterId: filters.recruiterId };
  const { data: timeToHire, isLoading: loadingTTH } =
    useAnalyticsTimeToHireTrend(trendFilters);
  const { data: appsTrend, isLoading: loadingApps } =
    useAnalyticsApplicationsTrend(trendFilters);

  const isLoading = loadingTTH || loadingApps;

  if (isLoading) return <TrendsSkeleton />;

  return (
    <div className="space-y-6">
      {/* Time-to-hire line chart */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-indigo-500" />
            {t("trends.timeToHire.title")}
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
                formatter={(v) => [
                  `${v ?? 0} ${t("trends.timeToHire.tooltipUnit")}`,
                  t("trends.timeToHire.tooltipLabel"),
                ]}
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
            {t("trends.applications.title")}
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
                formatter={(v) => [
                  String(v ?? 0),
                  t("trends.applications.tooltipUnit"),
                ]}
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

const PERIOD_PRESETS = ["month", "3months", "6months", "year", "all"] as const;
type PeriodPreset = (typeof PERIOD_PRESETS)[number];

function presetToFrom(preset: PeriodPreset): string | null {
  const now = new Date();
  switch (preset) {
    case "month":
      return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    case "3months":
      return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).toISOString();
    case "6months":
      return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()).toISOString();
    case "year":
      return new Date(now.getFullYear(), 0, 1).toISOString();
    case "all":
      return new Date(0).toISOString();
  }
}

export default function AnalyticsPage() {
  const { t } = useTranslation("analytics");
  const [period, setPeriod] = useState<PeriodPreset>("month");
  const [recruiterId, setRecruiterId] = useState<string>("all");
  const { data: recruiters } = useTenantUsers();

  const filters: AnalyticsFilters = useMemo(
    () => ({
      from: presetToFrom(period),
      to: null,
      recruiterId: recruiterId === "all" ? null : recruiterId,
    }),
    [period, recruiterId]
  );

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        title={t("header.title")}
        description={t("header.description")}
      />

      {/* Filterbalk: periode + recruiter (server-side). Momentopname-KPI's
          (open vacatures nu) blijven 'huidig'. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodPreset)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_PRESETS.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`filters.period.${p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Select value={recruiterId} onValueChange={setRecruiterId}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.allRecruiters")}</SelectItem>
              {(recruiters ?? []).map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="overzicht" className="space-y-6">
        <TabsList className="bg-zinc-100/80 dark:bg-zinc-800/60 border border-border shadow-none h-10">
          <TabsTrigger
            value="overzicht"
            className="data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-900 data-[state=active]:shadow-sm px-5"
          >
            {t("tabs.overview")}
          </TabsTrigger>
          <TabsTrigger
            value="recruiters"
            className="data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-900 data-[state=active]:shadow-sm px-5"
          >
            {t("tabs.recruiters")}
          </TabsTrigger>
          <TabsTrigger
            value="trends"
            className="data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-900 data-[state=active]:shadow-sm px-5"
          >
            {t("tabs.trends")}
          </TabsTrigger>
          <TabsTrigger
            value="ai-bias"
            className="data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-900 data-[state=active]:shadow-sm px-5"
          >
            {t("tabs.aiBias")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overzicht">
          <OverviewTab filters={filters} />
        </TabsContent>

        <TabsContent value="recruiters">
          <RecruitersTab filters={filters} />
        </TabsContent>

        <TabsContent value="trends">
          <TrendsTab filters={filters} />
        </TabsContent>

        <TabsContent value="ai-bias">
          {/* Q4.6 — EU AI Act bias-monitoring: 4/5-regel, AI-gebruik,
              match-score-verdeling. Volgt het periode-filter (recruiter-
              filter is hier niet van toepassing: bias meet je bureau-breed). */}
          <AiBiasTab filters={{ from: filters.from, to: filters.to }} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
