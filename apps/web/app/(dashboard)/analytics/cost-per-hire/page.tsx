"use client";

/**
 * Sprint Q4.3 — Cost-per-Hire dashboard.
 *
 * - Header KPIs: total spend, total hires, blended CPH
 * - Recharts horizontal bar chart of CPH per board (ascending)
 * - Sortable per-board breakdown table
 * - Filter: per-job dropdown
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Coins,
  Inbox,
  TrendingDown,
  Trophy,
  UserCheck,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useCostPerHire, useJobBoardCatalog } from "@/hooks/useJobBoards";
import { useJobs } from "@/hooks/useJobs";
import type { CostPerHireRow } from "@/lib/types/jobBoards";

type SortKey = "board" | "postings" | "hires" | "total_cost" | "cost_per_hire";
type SortDir = "asc" | "desc";

function formatEuro(amount: number, currency = "EUR"): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function brandInitials(name: string): string {
  return name
    .split(/[\s-]+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const BAR_COLORS = ["#6366f1", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ec4899", "#3b82f6", "#22c55e"];

export default function CostPerHirePage() {
  const { t } = useTranslation("analytics");
  const [jobFilter, setJobFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("cost_per_hire");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const { data: jobs } = useJobs("all");
  const { data: catalog } = useJobBoardCatalog();
  const { data: rows, isLoading } = useCostPerHire(
    jobFilter === "all" ? undefined : jobFilter
  );

  const boardName = (id: string) =>
    (catalog ?? []).find((b) => b.id === id)?.display_name ?? id;

  const sortedRows = useMemo<CostPerHireRow[]>(() => {
    const list = (rows ?? []).slice();
    list.sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (sortKey === "board") {
        av = boardName(a.board_id);
        bv = boardName(b.board_id);
      } else if (sortKey === "cost_per_hire") {
        // null CPH (no hires yet) sinks to bottom regardless of direction
        av = a.cost_per_hire ?? Number.MAX_SAFE_INTEGER;
        bv = b.cost_per_hire ?? Number.MAX_SAFE_INTEGER;
      } else {
        av = a[sortKey];
        bv = b[sortKey];
      }
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, sortDir, catalog]);

  const chartData = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => r.cost_per_hire !== null)
        .slice()
        .sort((a, b) => (a.cost_per_hire ?? 0) - (b.cost_per_hire ?? 0))
        .map((r) => ({
          board: boardName(r.board_id),
          cph: r.cost_per_hire ?? 0,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, catalog]
  );

  const totalSpend = (rows ?? []).reduce((s, r) => s + r.total_cost, 0);
  const totalHires = (rows ?? []).reduce((s, r) => s + r.hires, 0);
  const blendedCph = totalHires > 0 ? Math.round(totalSpend / totalHires) : null;
  const cheapest =
    chartData.length > 0
      ? chartData.reduce((best, cur) => (cur.cph < best.cph ? cur : best), chartData[0])
      : null;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "board" ? "asc" : "desc");
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("costPerHire.header.title")}
        description={t("costPerHire.header.description")}
      />

      {/* Filter */}
      <Card className="border-0 shadow-sm">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {t("costPerHire.filter.jobLabel")}
            </Label>
            <Select value={jobFilter} onValueChange={setJobFilter}>
              <SelectTrigger className="h-9 w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("costPerHire.filter.allJobs")}</SelectItem>
                {(jobs ?? []).map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.title}
                    {j.location ? ` — ${j.location}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="ml-auto text-xs text-muted-foreground">
            {t("costPerHire.filter.boardCount", { count: (rows ?? []).length })}
          </p>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t("costPerHire.kpi.totalSpend")}
          value={formatEuro(totalSpend)}
          icon={<Coins className="h-5 w-5" />}
          gradient="from-amber-500 to-orange-600"
        />
        <KpiCard
          label={t("costPerHire.kpi.totalHires")}
          value={String(totalHires)}
          icon={<UserCheck className="h-5 w-5" />}
          gradient="from-emerald-500 to-teal-600"
        />
        <KpiCard
          label={t("costPerHire.kpi.blendedCph")}
          value={blendedCph !== null ? formatEuro(blendedCph) : "—"}
          icon={<TrendingDown className="h-5 w-5" />}
          gradient="from-indigo-500 to-purple-600"
        />
        <KpiCard
          label={t("costPerHire.kpi.cheapestChannel")}
          value={cheapest ? `${cheapest.board}` : "—"}
          subValue={cheapest ? formatEuro(cheapest.cph) : undefined}
          icon={<Trophy className="h-5 w-5" />}
          gradient="from-rose-500 to-pink-600"
        />
      </div>

      {/* Empty state */}
      {!isLoading && (rows ?? []).length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
              <Inbox className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t("costPerHire.empty.title")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("costPerHire.empty.description")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Chart */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">
                {t("costPerHire.chart.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              {isLoading ? (
                <Skeleton className="h-72 rounded-lg" />
              ) : chartData.length === 0 ? (
                <p className="py-10 text-center text-xs text-muted-foreground">
                  {t("costPerHire.chart.empty")}
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(220, chartData.length * 44)}>
                  <BarChart
                    data={chartData}
                    layout="vertical"
                    margin={{ top: 8, right: 24, left: 0, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" horizontal={false} />
                    <XAxis
                      type="number"
                      tickFormatter={(v) => formatEuro(Number(v))}
                      tick={{ fontSize: 11, fill: "#71717a" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="board"
                      width={140}
                      tick={{ fontSize: 11, fill: "#71717a" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(v) => [formatEuro(Number(v)), t("costPerHire.chart.tooltip")]}
                      contentStyle={{
                        borderRadius: "8px",
                        border: "1px solid #e4e4e7",
                        fontSize: "12px",
                      }}
                      cursor={{ fill: "#f4f4f5" }}
                    />
                    <Bar dataKey="cph" radius={[0, 4, 4, 0]} maxBarSize={26}>
                      {chartData.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={BAR_COLORS[index % BAR_COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Table */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">
                {t("costPerHire.table.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-zinc-50/60 dark:bg-zinc-800/40">
                      <SortableTh
                        active={sortKey === "board"}
                        dir={sortDir}
                        onClick={() => toggleSort("board")}
                        align="left"
                      >
                        {t("costPerHire.table.columns.board")}
                      </SortableTh>
                      <SortableTh
                        active={sortKey === "postings"}
                        dir={sortDir}
                        onClick={() => toggleSort("postings")}
                        align="right"
                      >
                        {t("costPerHire.table.columns.postings")}
                      </SortableTh>
                      <SortableTh
                        active={sortKey === "hires"}
                        dir={sortDir}
                        onClick={() => toggleSort("hires")}
                        align="right"
                      >
                        {t("costPerHire.table.columns.hires")}
                      </SortableTh>
                      <SortableTh
                        active={sortKey === "total_cost"}
                        dir={sortDir}
                        onClick={() => toggleSort("total_cost")}
                        align="right"
                      >
                        {t("costPerHire.table.columns.totalCost")}
                      </SortableTh>
                      <SortableTh
                        active={sortKey === "cost_per_hire"}
                        dir={sortDir}
                        onClick={() => toggleSort("cost_per_hire")}
                        align="right"
                      >
                        {t("costPerHire.table.columns.cph")}
                      </SortableTh>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {isLoading
                      ? [1, 2, 3].map((i) => (
                          <tr key={i}>
                            <td colSpan={5} className="px-5 py-3">
                              <Skeleton className="h-6 w-full" />
                            </td>
                          </tr>
                        ))
                      : sortedRows.map((row) => (
                          <tr
                            key={row.board_id}
                            className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30"
                          >
                            <td className="py-3 pl-5 pr-4">
                              <div className="flex items-center gap-2">
                                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-indigo-100 to-purple-100 text-[10px] font-bold text-indigo-700 dark:from-indigo-950/40 dark:to-purple-950/40 dark:text-indigo-300">
                                  {brandInitials(boardName(row.board_id))}
                                </span>
                                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                  {boardName(row.board_id)}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right text-zinc-700 dark:text-zinc-300">
                              {row.postings}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="inline-flex items-center justify-center h-6 min-w-[32px] rounded-full bg-emerald-50 px-2 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                {row.hires}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right text-zinc-700 dark:text-zinc-300">
                              {formatEuro(row.total_cost, row.currency)}
                            </td>
                            <td className="py-3 pl-4 pr-5 text-right">
                              {row.cost_per_hire === null ? (
                                <span className="text-xs text-muted-foreground">
                                  {t("costPerHire.table.noHires")}
                                </span>
                              ) : (
                                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                                  {formatEuro(row.cost_per_hire, row.currency)}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  subValue,
  icon,
  gradient,
}: {
  label: string;
  value: string;
  subValue?: string;
  icon: React.ReactNode;
  gradient: string;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="flex items-center gap-4 p-5">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} text-white shadow-sm`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="truncate text-xl font-bold text-zinc-900 dark:text-zinc-100">
            {value}
          </p>
          {subValue && (
            <p className="text-xs text-muted-foreground">{subValue}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SortableTh({
  children,
  active,
  dir,
  onClick,
  align,
}: {
  children: React.ReactNode;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align: "left" | "right";
}) {
  const ArrowIcon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      onClick={onClick}
      className={`cursor-pointer select-none py-3 ${
        align === "left" ? "pl-5 pr-4 text-left" : "pl-4 pr-5 text-right"
      } text-[11px] font-semibold uppercase tracking-wider transition-colors hover:text-zinc-900 dark:hover:text-zinc-100 ${
        active
          ? "text-indigo-600 dark:text-indigo-400"
          : "text-muted-foreground"
      }`}
    >
      <span
        className={`inline-flex items-center gap-1 ${
          align === "right" ? "flex-row-reverse" : ""
        }`}
      >
        {children}
        <ArrowIcon className="h-3 w-3" />
      </span>
    </th>
  );
}
