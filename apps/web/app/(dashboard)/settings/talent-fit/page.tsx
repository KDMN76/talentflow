"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Brain,
  CheckCircle2,
  ChevronRight,
  Info,
  Loader2,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/layout/PageHeader";
import { AIBadge } from "@/components/matching/AIBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { useTalentFitModel, useTrainTalentFit } from "@/hooks/useTalentFit";
import { useCurrentUser } from "@/hooks/useUsers";
import type { TalentFitHistoryPoint, TalentFitModelInfo } from "@/lib/types/matching";
import { cn } from "@/lib/utils";

/**
 * Admin page for the Talent Fit Model.
 *
 * Surfaces:
 *  - Whether an active model exists (or the "not enough data" fallback).
 *  - Sample composition (hires + rejects) and validation metrics
 *    (precision@1, recall@10, AUC).
 *  - A line chart of precision_at_1 over training history (Recharts).
 *  - A "Train opnieuw" CTA (admin-only) that calls POST /train and
 *    optimistically refreshes metrics.
 *  - A plain-Dutch explanation of how the model works (EU AI Act art. 13:
 *    transparency about logic and significance).
 */

const MIN_HIRES = 20;
const MIN_REJECTS = 20;

export default function TalentFitSettingsPage() {
  const { toast } = useToast();
  const { data: model, isLoading, isError, error } = useTalentFitModel();
  const train = useTrainTalentFit();
  const { data: currentUser } = useCurrentUser();

  const isAdmin =
    currentUser?.role === "admin" || currentUser?.role === "super_admin";

  const handleTrain = async () => {
    try {
      await train.mutateAsync();
      toast({
        title: "Talent Fit Model getraind",
        description: "Het model is opnieuw getraind met je laatste data.",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Training mislukt",
        description:
          "Het model kon niet opnieuw getraind worden. Probeer het opnieuw of bekijk de logs.",
      });
    }
  };

  return (
    <div className="max-w-4xl space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Link href="/settings" className="hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" />
          Instellingen
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">Talent Fit Model</span>
      </div>

      <PageHeader
        title="Talent Fit Model"
        description="Een per-bureau model dat leert van je historische hires en rejects om kandidaten te rangschikken op fit-score."
        actions={
          isAdmin && model?.has_active_model ? (
            <Button
              onClick={handleTrain}
              disabled={train.isPending}
              className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
            >
              {train.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="mr-2 h-4 w-4" />
              )}
              Train opnieuw
            </Button>
          ) : null
        }
      />

      {isLoading ? (
        <ModelStatusSkeleton />
      ) : isError ? (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-rose-500" />
              Kon model-info niet laden
            </CardTitle>
            <CardDescription>
              {error instanceof Error ? error.message : "Probeer het opnieuw."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : !model || !model.has_active_model ? (
        <NotEnoughDataCard model={model} isAdmin={isAdmin} onTrain={handleTrain} isTraining={train.isPending} />
      ) : (
        <>
          <ModelStatusCard model={model} />
          <MetricsCard model={model} />
          <PerformanceChartCard history={model.history ?? []} />
        </>
      )}

      <HowItWorksCard />
    </div>
  );
}

// ─── Status / metrics ──────────────────────────────────────────────────────

function ModelStatusCard({ model }: { model: TalentFitModelInfo }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          Actief model
          <AIBadge label="Per-tenant model getraind op je historische hires en rejects." />
        </CardTitle>
        <CardDescription>
          Laatst getraind {formatDate(model.trained_at)}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Samples" value={String(model.trained_on)} accent="indigo" />
          <StatTile
            label="Hires"
            value={String(model.hires)}
            accent="emerald"
            sub={`${MIN_HIRES} minimum`}
          />
          <StatTile
            label="Rejects"
            value={String(model.rejects)}
            accent="rose"
            sub={`${MIN_REJECTS} minimum`}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function MetricsCard({ model }: { model: TalentFitModelInfo }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-500" />
          Validatie-metrics
        </CardTitle>
        <CardDescription>
          Gemeten op een held-out splits van je eigen historie. Hoger is beter.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricTile
            label="Precision @ 1"
            value={model.precision_at_1}
            description="Van de #1 ranked kandidaten per vacature, % dat daadwerkelijk gehired werd."
          />
          <MetricTile
            label="Recall @ 10"
            value={model.recall_at_10}
            description="Van alle eventuele hires, % dat in de top-10 ranked verscheen."
          />
          <MetricTile
            label="ROC-AUC"
            value={model.auc}
            description="Waarschijnlijkheid dat het model een willekeurige hire hoger scoort dan een willekeurige reject."
          />
        </div>
      </CardContent>
    </Card>
  );
}

function PerformanceChartCard({
  history,
}: {
  history: TalentFitHistoryPoint[];
}) {
  if (history.length === 0) return null;

  const data = history.map((p) => ({
    label: shortDate(p.trained_at),
    precision_at_1: Math.round(p.precision_at_1 * 100),
    auc: Math.round(p.auc * 100),
  }));

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Performance over tijd</CardTitle>
        <CardDescription>
          Precision@1 (paars) en AUC (indigo) per training-run.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                className="fill-zinc-500"
                stroke="currentColor"
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 11 }}
                className="fill-zinc-500"
                stroke="currentColor"
                tickFormatter={(v) => `${v}%`}
              />
              <RTooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid rgb(228 228 231)",
                }}
                formatter={(value, name) => {
                  const num =
                    typeof value === "number"
                      ? value
                      : Number(value ?? 0);
                  const label =
                    name === "precision_at_1" ? "Precision @ 1" : "AUC";
                  return [`${num}%`, label];
                }}
              />
              <Line
                type="monotone"
                dataKey="precision_at_1"
                stroke="#a855f7"
                strokeWidth={2}
                dot={{ r: 3, fill: "#a855f7" }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="auc"
                stroke="#6366f1"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={{ r: 3, fill: "#6366f1" }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── No-data fallback ──────────────────────────────────────────────────────

interface NotEnoughDataProps {
  model: TalentFitModelInfo | undefined;
  isAdmin: boolean;
  onTrain: () => Promise<void> | void;
  isTraining: boolean;
}

function NotEnoughDataCard({ model, isAdmin, onTrain, isTraining }: NotEnoughDataProps) {
  const hires = model?.hires ?? 0;
  const rejects = model?.rejects ?? 0;
  const hiresPct = Math.min(100, Math.round((hires / MIN_HIRES) * 100));
  const rejectsPct = Math.min(100, Math.round((rejects / MIN_REJECTS) * 100));

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-500" />
          Nog niet genoeg historische data
        </CardTitle>
        <CardDescription>
          Het Talent Fit Model heeft minimaal{" "}
          <span className="font-semibold">{MIN_HIRES} hires</span> en{" "}
          <span className="font-semibold">{MIN_REJECTS} rejects</span> nodig
          om betrouwbaar te trainen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress label="Hires" current={hires} target={MIN_HIRES} pct={hiresPct} tone="emerald" />
        <Progress label="Rejects" current={rejects} target={MIN_REJECTS} pct={rejectsPct} tone="rose" />

        <p className="text-xs text-muted-foreground italic flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
          Tot er voldoende data is, gebruikt TalentFlow alleen de cosine-score
          (profiel ↔ vacature) voor matching. Markeer kandidaten als
          &quot;Aangenomen&quot; of &quot;Afgewezen&quot; in de pipeline om
          training-data op te bouwen.
        </p>

        {isAdmin && (
          <div className="pt-2">
            <Button
              onClick={() => onTrain()}
              disabled={isTraining || (hires < MIN_HIRES && rejects < MIN_REJECTS)}
              variant="outline"
            >
              {isTraining ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="mr-2 h-4 w-4" />
              )}
              Probeer toch te trainen
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Explanation ───────────────────────────────────────────────────────────

function HowItWorksCard() {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="h-4 w-4 text-indigo-500" />
          Hoe werkt het Talent Fit Model?
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
          Het Talent Fit Model is een per-bureau gradient-boosted classifier
          die leert van je eigen historische hires en rejects. Voor elke
          (vacature, kandidaat) combinatie produceert het een
          <span className="font-semibold"> fit-score </span> tussen 0 en 1: de
          ingeschatte kans dat deze kandidaat door jouw bureau zou worden
          aangenomen voor deze rol. De fit-score wordt vervolgens gemixt met
          de generieke cosine-similarity (profiel ↔ vacature) tot een
          <span className="font-semibold"> combined-score </span> waarop je
          match-lijst gerangschikt wordt. Het model traint automatisch
          maandelijks of zodra je 10 nieuwe hires/rejects hebt geregistreerd.
          Recruiters behouden altijd het finale oordeel — fit-score is een
          hulpmiddel, geen beslissing.
        </p>
        <div className="rounded-md border border-purple-100 dark:border-purple-900/50 bg-purple-50/60 dark:bg-purple-950/20 px-3 py-2 flex items-start gap-2">
          <Sparkles className="h-3.5 w-3.5 text-purple-500 mt-0.5 shrink-0" />
          <p className="text-[11px] italic text-zinc-600 dark:text-zinc-400 leading-snug">
            Voorspellingen zijn gegenereerd door een geautomatiseerd
            beslissings-ondersteunend systeem (EU AI Act art. 13). De
            recruiter behoudt het finale oordeel.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

const TONE_BG: Record<string, string> = {
  indigo: "bg-indigo-50 dark:bg-indigo-950/30",
  emerald: "bg-emerald-50 dark:bg-emerald-950/30",
  rose: "bg-rose-50 dark:bg-rose-950/30",
};
const TONE_TXT: Record<string, string> = {
  indigo: "text-indigo-700 dark:text-indigo-300",
  emerald: "text-emerald-700 dark:text-emerald-300",
  rose: "text-rose-700 dark:text-rose-300",
};

function StatTile({
  label,
  value,
  accent,
  sub,
}: {
  label: string;
  value: string;
  accent: "indigo" | "emerald" | "rose";
  sub?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border p-4", TONE_BG[accent])}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-1 text-2xl font-bold leading-none", TONE_TXT[accent])}>
        {value}
      </p>
      {sub && (
        <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>
      )}
    </div>
  );
}

function MetricTile({
  label,
  value,
  description,
}: {
  label: string;
  value: number;
  description: string;
}) {
  const pct = Math.round(value * 100);
  const tone =
    pct >= 75
      ? "text-emerald-600 dark:text-emerald-400"
      : pct >= 60
      ? "text-amber-600 dark:text-amber-400"
      : "text-zinc-600 dark:text-zinc-400";
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <Badge
          variant="secondary"
          className={cn(
            "tabular-nums text-[10px] font-bold border-0",
            pct >= 75
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
              : pct >= 60
              ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
              : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          )}
        >
          {pct}%
        </Badge>
      </div>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums leading-none", tone)}>
        {value.toFixed(2)}
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground leading-snug">
        {description}
      </p>
    </div>
  );
}

function Progress({
  label,
  current,
  target,
  pct,
  tone,
}: {
  label: string;
  current: number;
  target: number;
  pct: number;
  tone: "emerald" | "rose";
}) {
  const fill =
    tone === "emerald" ? "bg-emerald-500" : "bg-rose-500";
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">
          {label}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {current} / {target}
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className={cn("h-full rounded-full transition-all", fill)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ModelStatusSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
  });
}
