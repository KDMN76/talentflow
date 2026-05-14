"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  Users,
} from "lucide-react";
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
import { AIBadge } from "@/components/matching/AIBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeiFunnelReport, useDeiFunnelSnapshots } from "@/hooks/useCompliance";
import { cn } from "@/lib/utils";
import type { DeiBiasLevel, DeiFunnelStage } from "@/lib/types/skills";

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  return {
    from: start.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
}

const BIAS_COPY: Record<
  DeiBiasLevel,
  { label: string; cls: string; icon: JSX.Element }
> = {
  low: {
    label: "Laag",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/50",
    icon: <Info className="h-3 w-3" />,
  },
  medium: {
    label: "Middel",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-900/50",
    icon: <AlertTriangle className="h-3 w-3" />,
  },
  high: {
    label: "Hoog",
    cls: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-red-200 dark:border-red-900/50",
    icon: <AlertCircle className="h-3 w-3" />,
  },
};

const ALERT_CLS = {
  info: "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/30 dark:text-blue-200 dark:border-blue-900/50",
  warning:
    "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900/50",
  critical:
    "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/30 dark:text-red-200 dark:border-red-900/50",
};

export function DEIFunnelViewer() {
  const [range, setRange] = useState(defaultRange);
  const { data, isLoading } = useDeiFunnelReport(range);
  const { data: snapshots } = useDeiFunnelSnapshots();

  // Build a stacked chart per stage with gender breakdown.
  const chartData = useMemo(() => {
    if (!data) return [];
    return data.stages.map((s) => {
      const findCount = (label: string) =>
        s.breakdown.gender.find((g) => g.label === label)?.count ?? 0;
      return {
        stage: s.stage_name,
        Man: findCount("Man"),
        Vrouw: findCount("Vrouw"),
        "Non-binair": findCount("Non-binair"),
        total: s.total,
      };
    });
  }, [data]);

  return (
    <div className="space-y-5">
      {/* Date range */}
      <Card className="border-0 shadow-sm">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <Label className="text-xs">Van</Label>
            <Input
              type="date"
              value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className="w-44"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tot</Label>
            <Input
              type="date"
              value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className="w-44"
            />
          </div>
        </CardContent>
      </Card>

      {/* Alerts */}
      {data && data.alerts.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-500" />
              Bias-alerts ({data.alerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.alerts.map((a, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-md border px-3 py-2.5 text-sm",
                  ALERT_CLS[a.severity]
                )}
              >
                <p className="font-semibold">{a.stage_name}</p>
                <p className="text-xs leading-relaxed mt-0.5">{a.message}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Funnel + chart */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-indigo-500" />
            Funnel: gender-breakdown per stage
            <AIBadge label="Demografische breakdown per stage. Groepen <5 worden niet getoond om herleiding te voorkomen." />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis
                  dataKey="stage"
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
                <Bar dataKey="Man" stackId="g" fill="#6366f1" />
                <Bar dataKey="Vrouw" stackId="g" fill="#a855f7" />
                <Bar dataKey="Non-binair" stackId="g" fill="#06b6d4" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Stage cards */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {(data?.stages ?? []).map((stage, i, arr) => (
          <StageCard key={stage.stage_id} stage={stage} previous={arr[i - 1]} />
        ))}
      </div>

      {/* Disclosure */}
      <Card className="border-0 shadow-sm bg-indigo-50/30 dark:bg-indigo-950/20">
        <CardContent className="p-4 text-xs space-y-1.5">
          <p className="flex items-center gap-1.5 font-semibold text-indigo-700 dark:text-indigo-300">
            <Info className="h-3.5 w-3.5" />
            Anonimiteit & AI-transparantie
          </p>
          <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Statistieken zijn anoniem geaggregeerd. Groepen kleiner dan{" "}
            <strong>{data?.k_anonymity_threshold ?? 5} personen</strong> worden
            samengevoegd of gemarkeerd als &ldquo;k&lt;5&rdquo; om herleiding te
            voorkomen. Bias-scores zijn AI-gegenereerd op basis van afwijkingen
            van de pool-baseline; recruiter behoudt het finale oordeel.
          </p>
        </CardContent>
      </Card>

      {/* Snapshots */}
      {snapshots && snapshots.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Eerdere rapporten</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {snapshots.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between px-4 py-2.5"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {s.from} → {s.to}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Berekend op{" "}
                      {new Date(s.computed_at).toLocaleDateString("nl-NL")}
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className={
                      s.total_alerts > 0
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-0"
                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-0"
                    }
                  >
                    {s.total_alerts} alerts
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StageCard({
  stage,
  previous,
}: {
  stage: DeiFunnelStage;
  previous?: DeiFunnelStage;
}) {
  const cfg = BIAS_COPY[stage.bias_level];
  const dropPct =
    previous && previous.total > 0
      ? Math.round((1 - stage.total / previous.total) * 100)
      : null;
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">{stage.stage_name}</CardTitle>
          <Badge variant="secondary" className={cn("gap-1 border", cfg.cls)}>
            {cfg.icon}
            Bias: {cfg.label} ({stage.bias_score})
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-bold tabular-nums">{stage.total}</span>
          <span className="text-xs text-muted-foreground">kandidaten</span>
          {dropPct !== null && (
            <span
              className={cn(
                "ml-auto text-xs font-semibold",
                dropPct > 30
                  ? "text-red-600 dark:text-red-400"
                  : dropPct > 15
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400"
              )}
            >
              -{dropPct}% drop
            </span>
          )}
        </div>

        <BreakdownRow title="Gender" rows={stage.breakdown.gender} colors={["#6366f1", "#a855f7", "#06b6d4"]} />
        <BreakdownRow title="Leeftijd" rows={stage.breakdown.age_bracket} colors={["#10b981", "#06b6d4", "#6366f1", "#f59e0b"]} />
        <BreakdownRow title="Nationaliteit" rows={stage.breakdown.nationality} colors={["#6366f1", "#a855f7", "#f59e0b"]} />
      </CardContent>
    </Card>
  );
}

function BreakdownRow({
  title,
  rows,
  colors,
}: {
  title: string;
  rows: { label: string; count: number; pct: number; suppressed: boolean }[];
  colors: string[];
}) {
  const visibleTotal = rows
    .filter((r) => !r.suppressed)
    .reduce((sum, r) => sum + r.pct, 0);
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
        {title}
      </p>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        {rows.map((r, i) => {
          if (r.suppressed) return null;
          const pct = visibleTotal === 0 ? 0 : (r.pct / visibleTotal) * 100;
          return (
            <span
              key={r.label}
              className="h-full"
              style={{ width: `${pct}%`, backgroundColor: colors[i % colors.length] }}
              title={`${r.label}: ${r.count} (${r.pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
        {rows.map((r, i) => (
          <span key={r.label} className="flex items-center gap-1">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: r.suppressed ? "#a1a1aa" : colors[i % colors.length],
              }}
            />
            {r.label}:{" "}
            {r.suppressed ? (
              <span className="italic">k&lt;5</span>
            ) : (
              <span className="tabular-nums">
                {r.count} ({r.pct.toFixed(1)}%)
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
