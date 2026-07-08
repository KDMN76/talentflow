"use client";

/**
 * "AI & Bias"-sectie op het analytics-dashboard (Sprint Q4.6 — EU AI Act
 * bias-monitoring). Drie blokken, allemaal op echte data:
 *
 * 1. Adverse impact (EEOC 4/5-regel) per geslacht / leeftijdsgroep /
 *    nationaliteit — groepen < 30 worden onderdrukt (onvoldoende data).
 * 2. AI-gebruik per maand uit het append-only ai_events-register.
 * 3. Verdeling van AI-match-scores (histogram, 10%-buckets).
 */

import { useTranslation } from "react-i18next";
import { Bot, Scale, SlidersHorizontal } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { HelpHint } from "@/components/ui/HelpHint";
import { cn } from "@/lib/utils";
import {
  useAnalyticsAdverseImpact,
  useAnalyticsAiUsageTrend,
  useAnalyticsMatchScoreDistribution,
  type AdverseImpactGroup,
  type AnalyticsFilters,
} from "@/hooks/useAnalytics";

const FEATURE_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#06b6d4",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#84cc16",
];

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// ─── Adverse impact ───────────────────────────────────────────────────────────

function ImpactRatioBadge({ group }: { group: AdverseImpactGroup }) {
  const { t } = useTranslation("analytics");

  if (group.insufficient_data) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {t("aiBias.adverseImpact.insufficientBadge")}
      </span>
    );
  }
  if (group.impact_ratio === null || group.passes_four_fifths === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        group.passes_four_fifths
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
          : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
      )}
    >
      {group.impact_ratio.toFixed(2)}{" "}
      {group.passes_four_fifths
        ? t("aiBias.adverseImpact.pass")
        : t("aiBias.adverseImpact.fail")}
    </span>
  );
}

function AdverseImpactCard({ filters }: { filters: AnalyticsFilters }) {
  const { t } = useTranslation("analytics");
  const { data, isLoading } = useAnalyticsAdverseImpact(filters);

  const groupLabel = (group: string): string =>
    t(`aiBias.adverseImpact.group.${group}`, { defaultValue: group });

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Scale className="h-4 w-4 text-indigo-500" />
          {t("aiBias.adverseImpact.title")}
          <HelpHint
            text={t("aiBias.adverseImpact.hint", {
              min: data?.min_group_size ?? 30,
            })}
          />
        </CardTitle>
        {data && (
          <p className="text-xs text-muted-foreground">
            {t("aiBias.adverseImpact.basis", {
              count: data.total_applications,
            })}
          </p>
        )}
      </CardHeader>
      <CardContent className="pt-2">
        {isLoading || !data ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : data.total_applications === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("aiBias.adverseImpact.empty")}
          </p>
        ) : (
          <div className="space-y-5">
            {data.dimensions.map((dim) => {
              const hasReference = dim.groups.some((g) => g.is_reference);
              return (
                <div key={dim.dimension}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t(`aiBias.adverseImpact.dimension.${dim.dimension}`)}
                  </p>
                  {!hasReference && (
                    <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">
                      {t("aiBias.adverseImpact.noReference", {
                        min: data.min_group_size,
                      })}
                    </p>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left">
                          <th className="py-1.5 pr-3 text-xs font-semibold text-muted-foreground">
                            {t("aiBias.adverseImpact.columns.group")}
                          </th>
                          <th className="py-1.5 px-3 text-right text-xs font-semibold text-muted-foreground">
                            {t("aiBias.adverseImpact.columns.total")}
                          </th>
                          <th className="py-1.5 px-3 text-right text-xs font-semibold text-muted-foreground">
                            {t("aiBias.adverseImpact.columns.selected")}
                          </th>
                          <th className="py-1.5 px-3 text-right text-xs font-semibold text-muted-foreground">
                            {t("aiBias.adverseImpact.columns.selectionRate")}
                          </th>
                          <th className="py-1.5 pl-3 text-right text-xs font-semibold text-muted-foreground">
                            {t("aiBias.adverseImpact.columns.impactRatio")}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {dim.groups.map((g) => (
                          <tr key={g.group}>
                            <td className="py-2 pr-3">
                              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                {groupLabel(g.group)}
                              </span>
                              {g.is_reference && (
                                <Badge
                                  variant="secondary"
                                  className="ml-2 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                                >
                                  {t("aiBias.adverseImpact.referenceBadge")}
                                </Badge>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right text-zinc-700 dark:text-zinc-300">
                              {g.insufficient_data ? (
                                <span title={t("aiBias.adverseImpact.insufficientHint", { min: data.min_group_size })}>
                                  {g.total}
                                </span>
                              ) : (
                                g.total
                              )}
                            </td>
                            <td className="py-2 px-3 text-right text-zinc-700 dark:text-zinc-300">
                              {g.insufficient_data ? "—" : g.selected}
                            </td>
                            <td className="py-2 px-3 text-right text-zinc-700 dark:text-zinc-300">
                              {g.insufficient_data ? "—" : pct(g.selection_rate)}
                            </td>
                            <td className="py-2 pl-3 text-right">
                              <ImpactRatioBadge group={g} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── AI usage per month ──────────────────────────────────────────────────────

function AiUsageCard({ filters }: { filters: AnalyticsFilters }) {
  const { t } = useTranslation("analytics");
  const { data, isLoading } = useAnalyticsAiUsageTrend(filters);

  const chartData = (data?.months ?? []).map((m) => ({
    month_label: m.month_label,
    ...m.by_feature,
  }));

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Bot className="h-4 w-4 text-violet-500" />
          {t("aiBias.aiUsage.title")}
          <HelpHint text={t("aiBias.aiUsage.hint")} />
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <Skeleton className="h-60 rounded-xl" />
        ) : !data || data.months.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("aiBias.aiUsage.empty")}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={chartData}
              margin={{ top: 8, right: 20, left: 0, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
              <XAxis
                dataKey="month_label"
                tick={{ fontSize: 11, fill: "#71717a" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#71717a" }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid #e4e4e7",
                  fontSize: "12px",
                }}
                cursor={{ fill: "#f4f4f5" }}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                formatter={(value) => (
                  <span style={{ fontSize: 12, color: "#71717a" }}>{value}</span>
                )}
              />
              {data.features.map((feature, i) => (
                <Bar
                  key={feature}
                  dataKey={feature}
                  stackId="usage"
                  fill={FEATURE_COLORS[i % FEATURE_COLORS.length]}
                  maxBarSize={40}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Match score distribution ────────────────────────────────────────────────

function MatchScoreCard({ filters }: { filters: AnalyticsFilters }) {
  const { t } = useTranslation("analytics");
  const { data, isLoading } = useAnalyticsMatchScoreDistribution(filters);

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-cyan-500" />
          {t("aiBias.matchScores.title")}
          <HelpHint text={t("aiBias.matchScores.hint")} />
        </CardTitle>
        {data && data.total > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("aiBias.matchScores.total")}:{" "}
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">
              {data.total.toLocaleString("nl-NL")}
            </span>
            {" · "}
            {t("aiBias.matchScores.avg")}:{" "}
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">
              {data.avg_score_pct}%
            </span>
          </p>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <Skeleton className="h-60 rounded-xl" />
        ) : !data || data.total === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("aiBias.matchScores.empty")}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={data.buckets}
              margin={{ top: 8, right: 20, left: 0, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
              <XAxis
                dataKey="bucket"
                tick={{ fontSize: 11, fill: "#71717a" }}
                axisLine={false}
                tickLine={false}
                label={{
                  value: t("aiBias.matchScores.axisLabel"),
                  position: "insideBottom",
                  offset: -2,
                  fontSize: 11,
                  fill: "#a1a1aa",
                }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#71717a" }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                formatter={(v) => [
                  String(v ?? 0),
                  t("aiBias.matchScores.tooltipUnit"),
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
                fill="#06b6d4"
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Tab ─────────────────────────────────────────────────────────────────────

export function AiBiasTab({ filters }: { filters: AnalyticsFilters }) {
  const { t } = useTranslation("analytics");

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">{t("aiBias.intro")}</p>
      <AdverseImpactCard filters={filters} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <AiUsageCard filters={filters} />
        <MatchScoreCard filters={filters} />
      </div>
    </div>
  );
}
