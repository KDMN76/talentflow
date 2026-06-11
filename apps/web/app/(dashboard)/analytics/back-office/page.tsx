"use client";

/**
 * Sprint Q4.4 — Bureau-overzicht (analytics).
 *
 * - 4 KPI-cards.
 * - Forecast 6 maanden (line chart, expected vs pipeline).
 * - Marge per klant of per recruiter (bar chart).
 * - Commissie per recruiter MTD (bar chart).
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Briefcase,
  Coins,
  RefreshCcw,
  TrendingUp,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  useCommissionRecords,
  useContracts,
  useInvoices,
  useMarginReport,
  useRecomputeForecast,
  useRevenueForecast,
} from "@/hooks/useBackOffice";
import { useToast } from "@/components/ui/use-toast";
import type { MarginGroupBy } from "@/lib/types/backOffice";

function formatMoney(amount: number, currency = "EUR"): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatMonth(value: string): string {
  const d = new Date(value + "-01");
  return d.toLocaleDateString("nl-NL", {
    month: "short",
    year: "2-digit",
  });
}

export default function BackOfficeAnalyticsPage() {
  const { t } = useTranslation("analytics");
  const { toast } = useToast();
  const [groupBy, setGroupBy] = useState<MarginGroupBy>("client");

  const { data: forecast, isLoading: forecastLoading } = useRevenueForecast(6);
  const { data: marginRows, isLoading: marginLoading } =
    useMarginReport(groupBy);
  const { data: contracts } = useContracts();
  const { data: invoices } = useInvoices();
  const { data: commissionRecords } = useCommissionRecords();

  const recompute = useRecomputeForecast();

  const kpi = useMemo(() => {
    const activeContracts = (contracts ?? []).filter(
      (c) => c.status === "active"
    ).length;

    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();

    const mtdRevenue = (invoices ?? [])
      .filter((i) => {
        if (!i.issued_date) return false;
        const d = new Date(i.issued_date);
        return d.getMonth() === month && d.getFullYear() === year;
      })
      .reduce((s, i) => s + i.subtotal_amount, 0);

    const mtdMargin = (marginRows ?? []).reduce(
      (s, r) => s + r.margin_amount,
      0
    );

    const projectedNext = forecast?.[1]?.expected_revenue ?? 0;

    return {
      activeContracts,
      mtdRevenue,
      mtdMargin,
      projectedNext,
    };
  }, [contracts, invoices, marginRows, forecast]);

  const commissionByRecruiter = useMemo(() => {
    if (!commissionRecords) return [];
    const map = new Map<string, { name: string; total: number }>();
    const now = new Date();
    for (const r of commissionRecords) {
      if (!r.period_start) continue;
      const d = new Date(r.period_start);
      if (
        d.getMonth() !== now.getMonth() ||
        d.getFullYear() !== now.getFullYear()
      ) {
        // Fall through: include latest 30 days.
        const diffDays = (now.getTime() - d.getTime()) / 86_400_000;
        if (diffDays > 30) continue;
      }
      const key = r.recruiter_id;
      const cur = map.get(key) ?? {
        name: r.recruiter_name ?? key,
        total: 0,
      };
      cur.total += r.commission_amount;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [commissionRecords]);

  const handleRecompute = async () => {
    try {
      await recompute.mutateAsync();
      toast({ title: t("backOffice.toasts.recomputed") });
    } catch {
      toast({
        title: t("backOffice.toasts.recomputeFailed"),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("backOffice.header.title")}
        description={t("backOffice.header.description")}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={handleRecompute}
            disabled={recompute.isPending}
          >
            <RefreshCcw
              className={
                recompute.isPending
                  ? "mr-1.5 h-3.5 w-3.5 animate-spin"
                  : "mr-1.5 h-3.5 w-3.5"
              }
            />
            {t("backOffice.header.recompute")}
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Briefcase className="h-4 w-4" />}
          label={t("backOffice.kpi.activeContracts")}
          value={`${kpi.activeContracts}`}
          accent="indigo"
        />
        <KpiCard
          icon={<Coins className="h-4 w-4" />}
          label={t("backOffice.kpi.mtdRevenue")}
          value={formatMoney(kpi.mtdRevenue)}
          accent="emerald"
        />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          label={t("backOffice.kpi.mtdMargin")}
          value={formatMoney(kpi.mtdMargin)}
          accent="emerald"
        />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          label={t("backOffice.kpi.projectedNext")}
          value={formatMoney(kpi.projectedNext)}
          accent="purple"
        />
      </div>

      {/* Forecast line chart */}
      <Card className="border-0 shadow-sm">
        <CardContent className="space-y-4 p-6">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t("backOffice.forecast.title")}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t("backOffice.forecast.description")}
            </p>
          </div>
          {forecastLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={(forecast ?? []).map((m) => ({
                    month: formatMonth(m.forecast_month),
                    [t("backOffice.forecast.series.expected")]:
                      m.expected_revenue,
                    [t("backOffice.forecast.series.pipeline")]:
                      m.pipeline_revenue,
                    [t("backOffice.forecast.series.total")]:
                      m.expected_revenue + m.pipeline_revenue,
                  }))}
                >
                  <CartesianGrid stroke="#e4e4e7" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="month"
                    stroke="#71717a"
                    style={{ fontSize: 11 }}
                  />
                  <YAxis
                    stroke="#71717a"
                    style={{ fontSize: 11 }}
                    tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(v: unknown) => formatMoney(typeof v === "number" ? v : 0)}
                    labelStyle={{ fontSize: 12, fontWeight: 600 }}
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #e4e4e7",
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey={t("backOffice.forecast.series.expected")}
                    stroke="#6366f1"
                    strokeWidth={2.5}
                    dot={{ r: 4 }}
                  />
                  <Line
                    type="monotone"
                    dataKey={t("backOffice.forecast.series.pipeline")}
                    stroke="#a855f7"
                    strokeWidth={2.5}
                    strokeDasharray="5 5"
                    dot={{ r: 4 }}
                  />
                  <Line
                    type="monotone"
                    dataKey={t("backOffice.forecast.series.total")}
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Margin chart */}
      <Card className="border-0 shadow-sm">
        <CardContent className="space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {groupBy === "client"
                  ? t("backOffice.margin.titleClient")
                  : t("backOffice.margin.titleRecruiter")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t("backOffice.margin.top", {
                  count: Math.min(10, marginRows?.length ?? 0),
                })}
                {groupBy === "client"
                  ? t("backOffice.margin.descriptionClient")
                  : t("backOffice.margin.descriptionRecruiter")}
              </p>
            </div>
            <Tabs
              value={groupBy}
              onValueChange={(v) => setGroupBy(v as MarginGroupBy)}
            >
              <TabsList>
                <TabsTrigger value="client">
                  {t("backOffice.margin.perClient")}
                </TabsTrigger>
                <TabsTrigger value="recruiter">
                  {t("backOffice.margin.perRecruiter")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {marginLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : !marginRows || marginRows.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              {t("backOffice.margin.empty")}
            </div>
          ) : (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[...marginRows]
                    .sort((a, b) => b.margin_amount - a.margin_amount)
                    .slice(0, 10)
                    .map((r) => ({
                      name: r.group_name,
                      Omzet: r.total_revenue,
                      Marge: r.margin_amount,
                      "Marge %": r.margin_pct,
                    }))}
                  margin={{ top: 5, right: 10, bottom: 60, left: 10 }}
                >
                  <CartesianGrid stroke="#e4e4e7" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    stroke="#71717a"
                    style={{ fontSize: 11 }}
                    angle={-25}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis
                    stroke="#71717a"
                    style={{ fontSize: 11 }}
                    tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(v: unknown) => formatMoney(typeof v === "number" ? v : 0)}
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #e4e4e7",
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="Omzet"
                    fill="#c4b5fd"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="Marge"
                    fill="#6366f1"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Commission per recruiter MTD */}
      <Card className="border-0 shadow-sm">
        <CardContent className="space-y-4 p-6">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              <Users className="h-4 w-4 text-indigo-500" />
              Commissie per recruiter — MTD
            </h3>
            <p className="text-xs text-muted-foreground">
              Verdiende commissie deze maand, alle statussen.
            </p>
          </div>
          {commissionByRecruiter.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              Nog geen commissie geboekt deze maand.
            </div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={commissionByRecruiter.map((r) => ({
                    name: r.name,
                    Commissie: r.total,
                  }))}
                  margin={{ top: 5, right: 24, left: 10, bottom: 5 }}
                >
                  <CartesianGrid stroke="#e4e4e7" strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    stroke="#71717a"
                    style={{ fontSize: 11 }}
                    tickFormatter={(v) => `€${(v / 1000).toFixed(1)}k`}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    stroke="#71717a"
                    style={{ fontSize: 11 }}
                    width={120}
                  />
                  <Tooltip
                    formatter={(v: unknown) => formatMoney(typeof v === "number" ? v : 0)}
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #e4e4e7",
                      fontSize: 12,
                    }}
                  />
                  <Bar
                    dataKey="Commissie"
                    fill="#10b981"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: "indigo" | "emerald" | "amber" | "purple";
}) {
  const accentClass: Record<typeof accent, string> = {
    indigo: "text-indigo-600 dark:text-indigo-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    purple: "text-purple-600 dark:text-purple-400",
  };
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5">
        <div
          className={`flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider ${accentClass[accent]}`}
        >
          {icon}
          {label}
        </div>
        <p className="mt-1.5 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
