"use client";

import {
  ArrowRight,
  BarChart3,
  Briefcase,
  CheckCircle2,
  Clock,
  Globe,
  XCircle,
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
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useComparableJobs,
  useJobFunnel,
  useJobSourcing,
} from "@/hooks/useJobDetail";

const FUNNEL_COLORS = [
  "#6366f1", // indigo-500
  "#8b5cf6", // violet-500
  "#a855f7", // purple-500
  "#d946ef", // fuchsia-500
  "#ec4899", // pink-500
  "#f43f5e", // rose-500
];

function formatDays(days: number | null): string {
  if (days === null) return "—";
  if (days === 1) return "1 dag";
  return `${days} dagen`;
}

function formatCurrencyCents(cents: number): string {
  if (cents === 0) return "—";
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export interface JobPerformanceTabProps {
  jobId: string;
}

export function JobPerformanceTab({ jobId }: JobPerformanceTabProps) {
  const { data: funnel, isLoading: funnelLoading } = useJobFunnel(jobId);
  const { data: sourcing, isLoading: sourcingLoading } = useJobSourcing(jobId);
  const { data: comparable, isLoading: comparableLoading } =
    useComparableJobs(jobId);

  const funnelChart = (funnel?.stages ?? []).map((s, i) => ({
    name: s.name,
    count: s.count,
    fill: FUNNEL_COLORS[i % FUNNEL_COLORS.length],
  }));

  const totalSourced = (sourcing ?? []).reduce(
    (sum, s) => sum + s.candidates,
    0
  );

  return (
    <div className="space-y-6">
      {/* Funnel chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-indigo-500" />
            Funnel — kandidaten per fase
          </CardTitle>
          <CardDescription>
            Conversie tussen pipeline-stages voor deze vacature.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {funnelLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : !funnel || funnel.stages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Geen funnel-data beschikbaar.
            </div>
          ) : (
            <>
              <div className="h-56 w-full">
                <ResponsiveContainer>
                  <BarChart
                    data={funnelChart}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="rgb(228 228 231 / 0.5)"
                    />
                    <XAxis
                      dataKey="name"
                      stroke="rgb(113 113 122)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="rgb(113 113 122)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      cursor={{ fill: "rgb(228 228 231 / 0.3)" }}
                      contentStyle={{
                        background: "white",
                        border: "1px solid rgb(228 228 231)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                      {funnelChart.map((entry, idx) => (
                        <Cell key={idx} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Conversion arrows row */}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {funnel.stages
                  .filter((s) => s.conversion_to_next_pct !== null)
                  .map((s) => (
                    <div
                      key={s.stage_id}
                      className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-1 dark:bg-zinc-800"
                    >
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">
                        {s.name}
                      </span>
                      <ArrowRight className="h-3 w-3" />
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                        {Math.round(s.conversion_to_next_pct ?? 0)}%
                      </span>
                    </div>
                  ))}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
                <div className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
                  <Briefcase className="h-3.5 w-3.5 text-indigo-500" />
                  <div>
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {funnel.total}
                    </div>
                    <div className="text-muted-foreground">Totaal in funnel</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  <div>
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {funnel.hired}
                    </div>
                    <div className="text-muted-foreground">Aangenomen</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
                  <XCircle className="h-3.5 w-3.5 text-red-500" />
                  <div>
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {funnel.dropped}
                    </div>
                    <div className="text-muted-foreground">Afgewezen</div>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Sourcing ROI */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-purple-500" />
            Source ROI
          </CardTitle>
          <CardDescription>
            Welke kanalen leveren kandidaten op — en met welke hire-conversie.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sourcingLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (sourcing?.length ?? 0) === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Nog geen kandidaten via een gekoppelde bron.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Bron</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Kandidaten
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Hires</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Conversie
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Cost-per-hire
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(sourcing ?? []).map((s) => {
                    const sharePct =
                      totalSourced > 0
                        ? Math.round((s.candidates / totalSourced) * 100)
                        : 0;
                    return (
                      <tr key={s.source}>
                        <td className="px-3 py-3">
                          <div className="font-medium text-zinc-900 dark:text-zinc-100">
                            {s.source}
                          </div>
                          <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                            <div
                              className="h-full bg-indigo-500"
                              style={{ width: `${sharePct}%` }}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                          {s.candidates}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                          {s.hires}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <span
                            className={
                              s.conversion_pct >= 10
                                ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                : "text-zinc-700 dark:text-zinc-300"
                            }
                          >
                            {s.conversion_pct.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                          {formatCurrencyCents(s.cost_per_hire_cents)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Comparable jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-emerald-500" />
            Vergelijkbare vacatures
          </CardTitle>
          <CardDescription>
            Historische jobs met overlappende skills — nuttig voor velocity-voorspelling.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {comparableLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (comparable?.length ?? 0) === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Geen vergelijkbare vacatures gevonden.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {(comparable ?? []).map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-950/40">
                    <Briefcase className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {c.title}
                      </span>
                      {c.filled ? (
                        <Badge
                          variant="outline"
                          className="bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300"
                        >
                          Vervuld
                        </Badge>
                      ) : (
                        <Badge variant="outline">Open</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.client ?? "Onbekende klant"} · {c.total_candidates}{" "}
                      kandidaten · Time-to-fill {formatDays(c.days_to_fill)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                      {Math.round(c.similarity_score)}%
                    </div>
                    <div className="text-xs text-muted-foreground">match</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
