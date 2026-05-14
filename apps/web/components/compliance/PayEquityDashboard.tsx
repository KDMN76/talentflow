"use client";

import { useMemo, useState } from "react";
import { Download, EyeOff, Info, Scale } from "lucide-react";
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
import { AIBadge } from "@/components/matching/AIBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  usePayEquityReport,
  usePayEquitySnapshots,
} from "@/hooks/useCompliance";
import type { PayBucket } from "@/lib/types/skills";
import { cn } from "@/lib/utils";

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const quarter = Math.floor(now.getMonth() / 3);
  const start = new Date(now.getFullYear(), quarter * 3, 1);
  const end = new Date(now.getFullYear(), quarter * 3 + 3, 0);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

function eur(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function gapColor(pct: number): { cls: string; label: string } {
  if (pct < 5)
    return {
      cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/50",
      label: "Conform",
    };
  if (pct < 15)
    return {
      cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-900/50",
      label: "Aandacht",
    };
  return {
    cls: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-red-200 dark:border-red-900/50",
    label: "Kritiek",
  };
}

export function PayEquityDashboard() {
  const [range, setRange] = useState(defaultRange);
  const { data: report, isLoading } = usePayEquityReport(range);
  const { data: snapshots } = usePayEquitySnapshots();
  const { toast } = useToast();

  const handleSnapshot = () => {
    toast({
      title: "Snapshot gegenereerd",
      description:
        "PDF-export is een placeholder — backend (III) levert pdf-render in volgende sprint.",
    });
  };

  const genderChart = useMemo(() => buildChart(report?.by_gender ?? []), [report]);
  const ageChart = useMemo(() => buildChart(report?.by_age_bracket ?? []), [report]);

  const cfg = report ? gapColor(report.pay_gap_pct) : null;

  return (
    <div className="space-y-5">
      {/* Filters */}
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
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSnapshot}
              className="gap-2"
            >
              <Download className="h-3.5 w-3.5" />
              Genereer snapshot (PDF)
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* KPIs + disclosure */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Scale className="h-4 w-4 text-indigo-500" />
              Pay-gap analyse
              <AIBadge label="Gap berekend op median basissalaris. K-anonymity ≥ 5: groepen kleiner dan 5 worden niet getoond." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading || !report ? (
              <Skeleton className="h-28 w-full" />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <KpiCard
                  label="Ongecorrigeerde gap"
                  value={`${report.pay_gap_pct.toFixed(1)}%`}
                  badge={cfg?.label}
                  badgeCls={cfg?.cls}
                />
                <KpiCard
                  label="Gecorrigeerd"
                  value={`${report.adjusted_pay_gap_pct.toFixed(1)}%`}
                  hint="Gecontroleerd voor functie & senioriteit"
                />
                <KpiCard
                  label="Records"
                  value={String(report.total_records)}
                  hint={`Periode ${range.from} → ${range.to}`}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-indigo-50/30 dark:bg-indigo-950/20">
          <CardContent className="p-4 text-xs space-y-2">
            <p className="flex items-center gap-1.5 font-semibold text-indigo-700 dark:text-indigo-300">
              <Info className="h-3.5 w-3.5" />
              EU Pay Transparency Directive
            </p>
            <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Statistieken zijn anoniem geaggregeerd. Groepen met minder dan{" "}
              <strong>{report?.k_anonymity_threshold ?? 5} personen</strong>{" "}
              worden samengevoegd of verborgen om herleiding te voorkomen.
              Recruiter behoudt het finale oordeel over individuele besluiten.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Median salaris per gender
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-56 w-full" />
            ) : genderChart.length === 0 ? (
              <SuppressedNotice />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={genderChart} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} tickFormatter={(v) => `€${v / 1000}k`} />
                  <Tooltip
                    formatter={(value) =>
                      typeof value === "number" ? eur(value) : String(value)
                    }
                    contentStyle={{ borderRadius: 8, border: "1px solid #e4e4e7", fontSize: 12 }}
                  />
                  <Bar dataKey="median" radius={[4, 4, 0, 0]}>
                    {genderChart.map((_, i) => (
                      <Cell key={i} fill={["#6366f1", "#a855f7", "#06b6d4"][i % 3]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Median salaris per leeftijd</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-56 w-full" />
            ) : ageChart.length === 0 ? (
              <SuppressedNotice />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={ageChart} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} tickFormatter={(v) => `€${v / 1000}k`} />
                  <Tooltip
                    formatter={(value) =>
                      typeof value === "number" ? eur(value) : String(value)
                    }
                    contentStyle={{ borderRadius: 8, border: "1px solid #e4e4e7", fontSize: 12 }}
                  />
                  <Bar dataKey="median" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detailed table */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Detailcijfers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <BucketTable title="Per gender" rows={report?.by_gender ?? []} />
          <BucketTable title="Per leeftijd" rows={report?.by_age_bracket ?? []} />
          <BucketTable title="Per nationaliteit" rows={report?.by_nationality ?? []} />
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
              {snapshots.map((s) => {
                const sCfg = gapColor(s.pay_gap_pct);
                return (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-2 px-4 py-2.5"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {s.from} → {s.to}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Berekend op {new Date(s.computed_at).toLocaleDateString("nl-NL")}
                      </p>
                    </div>
                    <Badge variant="secondary" className={cn("border", sCfg.cls)}>
                      {s.pay_gap_pct.toFixed(1)}% gap
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function buildChart(rows: PayBucket[]) {
  return rows
    .filter((r) => !r.suppressed && r.median_salary !== null)
    .map((r) => ({ label: r.group_label, median: r.median_salary }));
}

function KpiCard({
  label,
  value,
  hint,
  badge,
  badgeCls,
}: {
  label: string;
  value: string;
  hint?: string;
  badge?: string;
  badgeCls?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          {value}
        </span>
        {badge && (
          <Badge variant="secondary" className={cn("border", badgeCls)}>
            {badge}
          </Badge>
        )}
      </div>
      {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function SuppressedNotice() {
  return (
    <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 text-center">
      <EyeOff className="h-6 w-6 text-muted-foreground" />
      <p className="text-xs text-muted-foreground max-w-[260px]">
        Te weinig records om bruikbare statistieken te tonen — k-anonymity
        ondergrens niet behaald.
      </p>
    </div>
  );
}

function BucketTable({ title, rows }: { title: string; rows: PayBucket[] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
        {title}
      </p>
      <div className="rounded-md border border-border/60 overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/40">
          <span className="col-span-5">Groep</span>
          <span className="col-span-3 text-right">Aantal</span>
          <span className="col-span-4 text-right">Median</span>
        </div>
        {rows.map((r, i) => (
          <div
            key={`${title}-${i}`}
            className="grid grid-cols-12 gap-2 px-3 py-2 text-sm items-center border-t border-border/40"
          >
            <span className="col-span-5 truncate">{r.group_label}</span>
            <span className="col-span-3 text-right tabular-nums">
              {r.suppressed ? <span className="italic text-muted-foreground">verborgen</span> : r.count}
            </span>
            <span className="col-span-4 text-right tabular-nums">
              {r.suppressed ? (
                <span className="italic text-muted-foreground">k&lt;5</span>
              ) : (
                eur(r.median_salary)
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
