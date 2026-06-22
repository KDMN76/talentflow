"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Database,
  Search,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CategoryBadge,
  CategoryFilter,
} from "@/components/skills/SkillProfileEditor";
import { AIBadge } from "@/components/matching/AIBadge";
import {
  useDemandSupply,
  useEscoSearch,
  useTrendingSkills,
} from "@/hooks/useSkills";
import { cn } from "@/lib/utils";
import type { EscoCategory } from "@/lib/types/skills";

const SERIES_COLORS = ["#6366f1", "#a855f7", "#06b6d4", "#10b981", "#f59e0b", "#ef4444"];

export default function SkillsPage() {
  const { t } = useTranslation("miscInbox");
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("skills.header.title")}
        description={t("skills.header.description")}
      />

      <Tabs defaultValue="trending" className="space-y-4">
        <TabsList className="bg-muted/50 p-1">
          <TabsTrigger value="trending" className="gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            {t("skills.tabs.trending")}
          </TabsTrigger>
          <TabsTrigger value="demand" className="gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            {t("skills.tabs.demand")}
          </TabsTrigger>
          <TabsTrigger value="database" className="gap-1.5">
            <Database className="h-3.5 w-3.5" />
            {t("skills.tabs.database")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trending" className="mt-4">
          <TrendingTab />
        </TabsContent>
        <TabsContent value="demand" className="mt-4">
          <DemandSupplyTab />
        </TabsContent>
        <TabsContent value="database" className="mt-4">
          <DatabaseTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Trending tab ────────────────────────────────────────────────────────────

function TrendingTab() {
  const { t } = useTranslation("miscInbox");
  const [category, setCategory] = useState<EscoCategory | "all">("all");
  const { data: trending, isLoading } = useTrendingSkills({ category, limit: 20 });

  // Build merged line-chart data over 8 weeks. We pivot by week_start.
  const chartData = useMemo(() => {
    if (!trending || trending.length === 0 || !trending[0].series?.length)
      return [];
    const weeks = trending[0].series.map((p) => p.week_start);
    return weeks.map((w, i) => {
      const row: Record<string, string | number> = {
        week: new Date(w).toLocaleDateString("nl-NL", {
          day: "2-digit",
          month: "short",
        }),
      };
      trending.slice(0, 5).forEach((t) => {
        row[t.preferred_label] = t.series[i]?.demand ?? 0;
      });
      return row;
    });
  }, [trending]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <CategoryFilter value={category} onChange={setCategory} />
          <Badge variant="secondary" className="gap-1">
            <Sparkles className="h-3 w-3" />
            {t("skills.trending.top5InChart")}
          </Badge>
        </div>
        <AIBadge label={t("skills.trending.aiBadge")} />
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("skills.trending.chartTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : !trending || trending.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {t("skills.trending.noTrending")}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
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
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #e4e4e7",
                    fontSize: 12,
                  }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 11 }}
                />
                {trending.slice(0, 5).map((t, i) => (
                  <Line
                    key={t.esco_id}
                    type="monotone"
                    dataKey={t.preferred_label}
                    stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("skills.trending.tableTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <div className="divide-y divide-border">
              <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold bg-muted/30">
                <span className="col-span-5">{t("skills.trending.columns.skill")}</span>
                <span className="col-span-2 text-right">{t("skills.trending.columns.growth")}</span>
                <span className="col-span-2 text-right">{t("skills.trending.columns.demand")}</span>
                <span className="col-span-2 text-right">{t("skills.trending.columns.supply")}</span>
                <span className="col-span-1 text-right">{t("skills.trending.columns.gap")}</span>
              </div>
              {(trending ?? []).map((t) => {
                const gap = t.current_demand - t.current_supply;
                return (
                  <div
                    key={t.esco_id}
                    className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center hover:bg-zinc-50/40 dark:hover:bg-zinc-800/30"
                  >
                    <div className="col-span-5 flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium truncate">
                        {t.preferred_label}
                      </span>
                      <CategoryBadge category={t.category} />
                    </div>
                    <span
                      className={cn(
                        "col-span-2 text-right text-sm font-semibold tabular-nums",
                        t.growth_pct >= 30
                          ? "text-emerald-600 dark:text-emerald-400"
                          : t.growth_pct >= 15
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-zinc-600 dark:text-zinc-400"
                      )}
                    >
                      +{t.growth_pct}%
                    </span>
                    <span className="col-span-2 text-right text-sm tabular-nums">
                      {t.current_demand}
                    </span>
                    <span className="col-span-2 text-right text-sm tabular-nums text-muted-foreground">
                      {t.current_supply}
                    </span>
                    <span
                      className={cn(
                        "col-span-1 text-right text-sm font-semibold tabular-nums",
                        gap > 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-emerald-600 dark:text-emerald-400"
                      )}
                    >
                      {gap > 0 ? `+${gap}` : gap}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Demand vs supply tab ────────────────────────────────────────────────────

function DemandSupplyTab() {
  const { t } = useTranslation("miscInbox");
  const { data, isLoading } = useDemandSupply();

  const categoryLabel = (category: EscoCategory) =>
    t(`skills.category.${category}`, { defaultValue: category });

  const chartData = useMemo(
    () =>
      (data?.per_category ?? []).map((b) => ({
        category: categoryLabel(b.category),
        Demand: b.demand,
        Supply: b.supply,
        gap: b.gap,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, t]
  );

  return (
    <div className="space-y-5">
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            {t("skills.demand.chartTitle")}
            <AIBadge label={t("skills.demand.aiBadge")} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis
                  dataKey="category"
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
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #e4e4e7",
                    fontSize: 12,
                  }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Demand" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell
                      key={`d-${i}`}
                      fill={entry.gap > 0 ? "#ef4444" : "#6366f1"}
                    />
                  ))}
                </Bar>
                <Bar dataKey="Supply" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell
                      key={`s-${i}`}
                      fill={entry.gap < 0 ? "#10b981" : "#a78bfa"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold bg-muted/30">
              <span className="col-span-4">{t("skills.demand.columns.category")}</span>
              <span className="col-span-3 text-right">{t("skills.demand.columns.demand")}</span>
              <span className="col-span-3 text-right">{t("skills.demand.columns.supply")}</span>
              <span className="col-span-2 text-right">{t("skills.demand.columns.gap")}</span>
            </div>
            {(data?.per_category ?? []).map((b) => (
              <div
                key={b.category}
                className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center"
              >
                <span className="col-span-4 text-sm font-medium">
                  {categoryLabel(b.category)}
                </span>
                <span className="col-span-3 text-right text-sm tabular-nums">
                  {b.demand}
                </span>
                <span className="col-span-3 text-right text-sm tabular-nums text-muted-foreground">
                  {b.supply}
                </span>
                <span
                  className={cn(
                    "col-span-2 text-right text-sm font-semibold tabular-nums",
                    b.gap > 0
                      ? "text-red-600 dark:text-red-400"
                      : "text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  {b.gap > 0 ? `+${b.gap}` : b.gap}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Database tab ────────────────────────────────────────────────────────────

function DatabaseTab() {
  const { t } = useTranslation("miscInbox");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<EscoCategory | "all">("all");
  const { data, isLoading } = useEscoSearch({ q: query, category, limit: 100 });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("skills.database.searchPlaceholder")}
            className="pl-9"
          />
        </div>
        <CategoryFilter value={category} onChange={setCategory} />
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-32 w-full" />
            </div>
          ) : !data || data.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {t("skills.database.empty")}
            </p>
          ) : (
            <div className="divide-y divide-border">
              {data.map((s) => (
                <div
                  key={s.id}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-zinc-50/40 dark:hover:bg-zinc-800/30"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {s.preferred_label}
                      </span>
                      <CategoryBadge category={s.category} />
                      {s.alt_labels.length > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          ({s.alt_labels.join(", ")})
                        </span>
                      )}
                    </div>
                    {s.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {s.description}
                      </p>
                    )}
                  </div>
                  <Badge
                    variant="secondary"
                    className="shrink-0 bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border-0"
                  >
                    {t("skills.database.candidates", { count: s.candidate_count ?? 0 })}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
