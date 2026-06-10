"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  Building2,
  CalendarClock,
  Coins,
  MapPin,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useJobMatches } from "@/hooks/useMatching";
import { useTalentFitModel } from "@/hooks/useTalentFit";
import { cn, getInitials } from "@/lib/utils";
import type { JobDetail as Job } from "@talentflow/contracts";
import type {
  JobFunnelResponse,
  JobHealthBreakdown,
} from "@/lib/types/jobDetail";

// ─── Helpers ────────────────────────────────────────────────────────────────

const STATUS_COPY: Record<string, { label: string; cls: string }> = {
  draft: {
    label: "Concept",
    cls: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  open: {
    label: "Gepubliceerd",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
  },
  filled: {
    label: "Gevuld",
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
  },
  closed: {
    label: "Gesloten",
    cls: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
  },
  archived: {
    label: "Gearchiveerd",
    cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  },
};

const REMOTE_COPY: Record<string, string> = {
  onsite: "Op kantoor",
  hybrid: "Hybride",
  remote: "Remote",
};

const CONTRACT_COPY: Record<string, string> = {
  fulltime: "Fulltime",
  parttime: "Parttime",
  contract: "Contract",
  freelance: "Freelance",
  internship: "Stage",
};

/**
 * Deterministic colour from a string — used to give the client logo placeholder
 * a stable hue based on `job_reference`. Avoids the "every job is purple" UI.
 */
function hashColor(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = input.charCodeAt(i) + ((hash << 5) - hash);
  }
  const palette = [
    "from-indigo-400 to-purple-500",
    "from-amber-400 to-orange-500",
    "from-emerald-400 to-teal-500",
    "from-rose-400 to-pink-500",
    "from-sky-400 to-blue-500",
    "from-fuchsia-400 to-pink-500",
    "from-lime-400 to-emerald-500",
    "from-cyan-400 to-sky-500",
  ];
  return palette[Math.abs(hash) % palette.length];
}

function formatSalary(job: Job): string | null {
  const { salary_min, salary_max, currency, salary_frequency } = job;
  if (salary_min == null && salary_max == null) return null;

  const cur = currency ?? "EUR";
  const symbol = cur === "EUR" ? "€" : cur + " ";
  const fmt = (n: number) => `${symbol}${(n / 1000).toFixed(0)}k`;

  let range: string;
  if (salary_min != null && salary_max != null) {
    range = `${fmt(salary_min)}–${fmt(salary_max)}`;
  } else {
    range = fmt((salary_max ?? salary_min) as number);
  }

  if (salary_frequency === "monthly") return `${range} per maand`;
  if (salary_frequency === "hourly") return `${range} per uur`;
  return range; // yearly is the default — no suffix needed for compactness.
}

function formatDateNL(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function healthColor(score: number): string {
  if (score >= 70)
    return "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/60";
  if (score >= 40)
    return "bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/60";
  return "bg-red-100 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900/60";
}

/**
 * Heuristic mapping from funnel stages to the 5-bucket counters bar.
 * "Offered" = stage with name containing "Aanbod"/"Offered"/"Aangeboden".
 * "Hired" = stage named "Aangenomen"/"Hired" + total hired count.
 */
function bucketsFromFunnel(funnel: JobFunnelResponse | null | undefined) {
  if (!funnel) {
    return { nieuw: 0, inFunnel: 0, offered: 0, hired: 0, dropped: 0 };
  }
  const { stages, hired, dropped } = funnel;
  const nieuw = stages[0]?.count ?? 0;

  const offeredStage = stages.find((s) =>
    /(aanbod|aangeboden|offer)/i.test(s.name)
  );
  const offered = offeredStage?.count ?? 0;

  const hiredStage = stages.find((s) =>
    /(aangenomen|hired)/i.test(s.name)
  );
  // `?? 0`: de funnel-endpoint levert (nog) geen top-level `hired`/`dropped`
  // (zie ROADMAP "Funnel-endpoint mist hired/dropped/total"), dus zonder coerce
  // werd dit `count + undefined = NaN` → "Aangenomen: NaN" in de UI.
  const hiredTotal = (hiredStage?.count ?? 0) + (hired ?? 0);

  const middleStages = stages.filter(
    (s) => s !== stages[0] && s !== offeredStage && s !== hiredStage
  );
  const inFunnel = middleStages.reduce((sum, s) => sum + s.count, 0);

  return {
    nieuw,
    inFunnel,
    offered,
    hired: hiredTotal,
    dropped: dropped ?? 0,
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export interface JobDetailHeaderProps {
  job: Job;
  health: JobHealthBreakdown | null | undefined;
  funnel: JobFunnelResponse | null | undefined;
  isHealthLoading?: boolean;
  isFunnelLoading?: boolean;
}

export function JobDetailHeader({
  job,
  health,
  funnel,
  isHealthLoading,
  isFunnelLoading,
}: JobDetailHeaderProps) {
  const [healthOpen, setHealthOpen] = useState(false);

  const status = STATUS_COPY[job.status] ?? STATUS_COPY.draft;
  const remoteLabel = job.remote_type ? REMOTE_COPY[job.remote_type] ?? job.remote_type : null;
  const contractLabel = job.contract_type
    ? CONTRACT_COPY[job.contract_type] ?? job.contract_type
    : null;
  const salary = formatSalary(job);

  // Sub-fase 2C: `job.client` / `job.owner_name` waren fantoom-velden zonder
  // DB-grond. Tot er een Clients/CRM-module is (zie ROADMAP) tonen we de
  // afdeling als "card title" en de recruiter als enige eigenaar.
  const clientName = job.department ?? "—";
  const logoGradient = hashColor(job.job_reference ?? job.id);
  const logoInitials = getInitials(clientName);

  const ownerName = job.recruiter_name;
  const ownerInitials = getInitials(ownerName);

  const buckets = bucketsFromFunnel(funnel ?? null);

  // Pipeline progress dots: 5 dots, filled on relative funnel-position.
  const dotState = (() => {
    if (!funnel || funnel.stages.length === 0) {
      return [false, false, false, false, false];
    }
    return Array.from({ length: 5 }, (_, i) => {
      // Map dot i (0..4) to a stage by ratio. Mark filled if any application
      // has reached that relative stage.
      const ratio = funnel.stages.length === 1 ? 1 : i / 4;
      const stageIdx = Math.min(
        funnel.stages.length - 1,
        Math.round(ratio * (funnel.stages.length - 1))
      );
      // "Filled" = at least one application has reached or passed this stage.
      const reachedCount = funnel.stages
        .slice(stageIdx)
        .reduce((sum, s) => sum + s.count, 0);
      return reachedCount > 0;
    });
  })();

  const dotTooltip = (i: number) => {
    if (!funnel || funnel.stages.length === 0) return "Nog geen pipeline-data";
    const ratio = funnel.stages.length === 1 ? 1 : i / 4;
    const stageIdx = Math.min(
      funnel.stages.length - 1,
      Math.round(ratio * (funnel.stages.length - 1))
    );
    const stage = funnel.stages[stageIdx];
    return `${stage.name} — ${stage.count} ${stage.count === 1 ? "kandidaat" : "kandidaten"}`;
  };

  return (
    <>
      <div className="rounded-xl border border-border bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
        {/* ── Title row ─────────────────────────────────────────────────── */}
        <div className="px-5 pt-5 pb-4 sm:px-6">
          <div className="flex items-start gap-4">
            <Avatar className="h-12 w-12 shrink-0 rounded-xl">
              <AvatarFallback
                className={cn(
                  "rounded-xl bg-gradient-to-br text-white text-sm font-bold",
                  logoGradient
                )}
              >
                {logoInitials}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                  {job.title}
                </h1>
                <span
                  className={cn(
                    "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                    status.cls
                  )}
                >
                  {status.label}
                </span>
                <TalentFitActiveBadge jobId={job.id} />
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />
                  {clientName}
                </span>
                {job.location && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" />
                    {job.location}
                    {remoteLabel && (
                      <Badge
                        variant="secondary"
                        className="ml-1.5 text-[10px] px-1.5 py-0 font-medium"
                      >
                        {remoteLabel}
                      </Badge>
                    )}
                  </span>
                )}
                {salary && (
                  <span className="inline-flex items-center gap-1.5">
                    <Coins className="h-3.5 w-3.5" />
                    {salary}
                  </span>
                )}
                {contractLabel && (
                  <span className="inline-flex items-center gap-1.5">
                    {contractLabel}
                  </span>
                )}
              </div>
            </div>

            {/* Right-hand: reference + owner */}
            <div className="hidden sm:flex flex-col items-end gap-2 shrink-0">
              {job.job_reference && (
                <span className="font-mono text-[11px] text-muted-foreground bg-zinc-50 dark:bg-zinc-800 px-2 py-0.5 rounded">
                  {job.job_reference}
                </span>
              )}
              {ownerName && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Eigenaar
                  </span>
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-[10px] font-semibold">
                      {ownerInitials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200 hidden lg:inline">
                    {ownerName}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-border bg-zinc-50/50 dark:bg-zinc-800/30 px-5 py-4 sm:px-6">
          {/* ── Pipeline dots ─────────────────────────────────────────── */}
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Pipeline
            </span>
            <div className="flex items-center gap-1.5">
              {dotState.map((filled, i) => (
                <TooltipProvider key={i} delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className={cn(
                          "h-2.5 w-2.5 rounded-full transition-colors",
                          filled
                            ? "bg-indigo-500"
                            : "bg-zinc-200 dark:bg-zinc-700"
                        )}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      {dotTooltip(i)}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
            </div>
            {funnel && (
              <span className="text-xs text-muted-foreground ml-2">
                {funnel.total} {funnel.total === 1 ? "kandidaat" : "kandidaten"} actief
              </span>
            )}
          </div>

          {/* ── Counters bar ──────────────────────────────────────────── */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
            <CounterCell
              label="Nieuw"
              value={buckets.nieuw}
              isLoading={isFunnelLoading}
              tone="indigo"
            />
            <CounterCell
              label="In funnel"
              value={buckets.inFunnel}
              isLoading={isFunnelLoading}
              tone="blue"
            />
            <CounterCell
              label="Aangeboden"
              value={buckets.offered}
              isLoading={isFunnelLoading}
              tone="amber"
            />
            <CounterCell
              label="Aangenomen"
              value={buckets.hired}
              isLoading={isFunnelLoading}
              tone="emerald"
            />
            <CounterCell
              label="Afgewezen"
              value={buckets.dropped}
              isLoading={isFunnelLoading}
              tone="zinc"
            />
          </div>

          {/* ── Health / days / predicted close ───────────────────────── */}
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 pt-3 border-t border-border/60">
            {/* Health */}
            <div className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Health:</span>
              {isHealthLoading ? (
                <Skeleton className="h-6 w-14" />
              ) : health ? (
                <button
                  type="button"
                  onClick={() => setHealthOpen(true)}
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset transition-shadow hover:shadow-sm",
                    healthColor(health.score)
                  )}
                  aria-label="Open health-breakdown"
                >
                  {health.score}/100
                </button>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>

            {/* Days open */}
            <div className="flex items-center gap-2">
              <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Open sinds:</span>
              {isHealthLoading ? (
                <Skeleton className="h-4 w-16" />
              ) : (
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  {health?.days_open ?? 0}{" "}
                  {(health?.days_open ?? 0) === 1 ? "dag" : "dagen"}
                </span>
              )}
            </div>

            {/* Predicted close */}
            <div className="flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Verwachte afronding:
              </span>
              {isHealthLoading ? (
                <Skeleton className="h-4 w-24" />
              ) : (
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  {formatDateNL(health?.predicted_close_date) ?? "—"}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Health breakdown dialog ─────────────────────────────────────── */}
      <Dialog open={healthOpen} onOpenChange={setHealthOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Health-breakdown</DialogTitle>
            <DialogDescription>
              Geaggregeerde score op basis van doorlooptijd, drop-off en
              recruiter-activiteit. Hoger is gezonder.
            </DialogDescription>
          </DialogHeader>
          {health ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Totaal</span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset",
                    healthColor(health.score)
                  )}
                >
                  {health.score}/100
                </span>
              </div>
              <div className="space-y-3">
                {health.components.map((comp) => (
                  <div key={comp.key}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-zinc-700 dark:text-zinc-200">
                        {comp.label}
                      </span>
                      <span className="text-muted-foreground">
                        {comp.score}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          comp.score >= 70
                            ? "bg-emerald-500"
                            : comp.score >= 40
                            ? "bg-amber-500"
                            : "bg-red-500"
                        )}
                        style={{ width: `${comp.score}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {comp.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Health-data nog niet beschikbaar.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface CounterCellProps {
  label: string;
  value: number;
  isLoading?: boolean;
  tone: "indigo" | "blue" | "amber" | "emerald" | "zinc";
}

const TONE_COLORS: Record<CounterCellProps["tone"], string> = {
  indigo: "text-indigo-700 dark:text-indigo-300",
  blue: "text-blue-700 dark:text-blue-300",
  amber: "text-amber-700 dark:text-amber-300",
  emerald: "text-emerald-700 dark:text-emerald-300",
  zinc: "text-zinc-600 dark:text-zinc-400",
};

function CounterCell({ label, value, isLoading, tone }: CounterCellProps) {
  return (
    <div className="rounded-lg bg-white dark:bg-zinc-900 px-3 py-2 ring-1 ring-inset ring-zinc-200/70 dark:ring-zinc-700/50">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {isLoading ? (
        <Skeleton className="mt-1 h-6 w-10" />
      ) : (
        <p className={cn("mt-0.5 text-xl font-bold leading-none", TONE_COLORS[tone])}>
          {value}
        </p>
      )}
    </div>
  );
}

// ─── Talent Fit active badge (Q3.3) ─────────────────────────────────────────

/**
 * Tiny pill in the job-detail header that surfaces "Talent Fit Model actief"
 * when the tenant has a trained model AND there is at least one match for
 * this job that came back with `has_active_model=true`. The combination
 * avoids showing a stale badge for jobs with zero matches.
 *
 * Tooltip exposes the model's precision so recruiters can quickly see how
 * confident they should be in the fit-driven ranking.
 */
function TalentFitActiveBadge({ jobId }: { jobId: string }) {
  const { data: model } = useTalentFitModel();
  const { data: matches } = useJobMatches(jobId);

  const hasMatches = (matches ?? []).some((m) => m.has_active_model === true);
  if (!model?.has_active_model || !hasMatches) return null;

  const precision = Math.round(model.precision_at_1 * 100);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/settings/talent-fit"
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              "border border-purple-200 bg-purple-50 text-purple-700",
              "hover:bg-purple-100 transition-colors",
              "dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900/60",
              "dark:hover:bg-purple-950/60"
            )}
          >
            <Sparkles className="h-3 w-3" />
            Talent Fit actief
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          Talent Fit Model rangschikt deze matches op basis van jouw
          historische hires. Precision @ 1: {precision}%. Klik voor details.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
