"use client";

import { useState } from "react";
import Link from "next/link";
import { Briefcase, History, Sparkles, Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AIBadge } from "@/components/matching/AIBadge";
import { SimilarHiresModal } from "@/components/matching/SimilarHiresModal";
import { cn, getInitials } from "@/lib/utils";
import type { CandidateMatch, JobMatch } from "@/lib/types/matching";

/**
 * A single match-row, used in two contexts:
 *
 *  - `mode="job-view"`     → on a job detail, lists candidates ranked for the job
 *  - `mode="candidate-view"` → on a candidate profile, lists jobs ranked for the candidate
 *
 * The card surfaces the match-percent prominently with a colour-coded gauge
 * (>=80 emerald, >=60 amber, <60 zinc) and an AI-disclosure badge as required
 * by EU AI Act Art. 50.
 */

export type MatchMode = "job-view" | "candidate-view";

export interface MatchCardProps {
  match: JobMatch | CandidateMatch;
  mode: MatchMode;
  /** Triggered when the recruiter clicks "Waarom?" — opens the explanation dialog. */
  onExplain?: (match: JobMatch | CandidateMatch) => void;
  /**
   * Q3.3 — when the parent context already knows the job-id (e.g. a job-detail
   * page), pass it so the SimilarHiresModal can scope to that job. Ignored on
   * candidate-view rows where the job is encoded in the row itself.
   */
  jobId?: string;
  /**
   * Q3.3 — total hires the tenant's Talent Fit model was trained on. Drives
   * the tooltip copy on the fit-badge ("Voorspelling op basis van X eerdere
   * hires bij jouw bureau."). Optional; falls back to a generic copy.
   */
  trainedOnHires?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface ScoreTone {
  /** Tailwind classes for the gauge ring. */
  ring: string;
  /** Tailwind classes for the percent label inside the ring. */
  text: string;
  /** Tailwind classes for a small accent badge (e.g. "Sterke match"). */
  badge: string;
  /** Short NL label describing the match strength. */
  label: string;
}

function getScoreTone(percent: number): ScoreTone {
  if (percent >= 80) {
    return {
      ring: "stroke-emerald-500",
      text: "text-emerald-600 dark:text-emerald-400",
      badge:
        "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900",
      label: "Sterke match",
    };
  }
  if (percent >= 60) {
    return {
      ring: "stroke-amber-500",
      text: "text-amber-600 dark:text-amber-400",
      badge:
        "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900",
      label: "Redelijke match",
    };
  }
  return {
    ring: "stroke-zinc-400",
    text: "text-zinc-600 dark:text-zinc-400",
    badge:
      "bg-zinc-50 text-zinc-700 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-800",
    label: "Lage match",
  };
}

// ─── Score gauge (circular progress) ────────────────────────────────────────

interface ScoreGaugeProps {
  percent: number;
  tone: ScoreTone;
}

function ScoreGauge({ percent, tone }: ScoreGaugeProps) {
  const SIZE = 56;
  const STROKE = 5;
  const RADIUS = (SIZE - STROKE) / 2;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE;

  return (
    <div
      className="relative shrink-0"
      style={{ width: SIZE, height: SIZE }}
      role="img"
      aria-label={`Match score ${Math.round(clamped)} procent`}
    >
      <svg width={SIZE} height={SIZE} className="-rotate-90">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          className="stroke-zinc-200 dark:stroke-zinc-700 fill-none"
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          className={cn("fill-none transition-all duration-500", tone.ring)}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={cn("text-sm font-bold", tone.text)}>
          {Math.round(clamped)}%
        </span>
      </div>
    </div>
  );
}

// ─── MatchCard ──────────────────────────────────────────────────────────────

export function MatchCard({
  match,
  mode,
  onExplain,
  jobId,
  trainedOnHires,
}: MatchCardProps) {
  const tone = getScoreTone(match.match_percent);

  const isJobView = mode === "job-view";
  const jobMatch = isJobView ? (match as JobMatch) : null;
  const candidateMatch = !isJobView ? (match as CandidateMatch) : null;

  const title = isJobView
    ? jobMatch!.candidate_name
    : candidateMatch!.job_title;
  const subtitle = isJobView
    ? jobMatch!.candidate_position ?? "Geen functie bekend"
    : `Status: ${formatJobStatus(candidateMatch!.job_status)}`;
  const href = isJobView
    ? `/candidates/${jobMatch!.candidate_id}`
    : `/jobs/${candidateMatch!.job_id}`;

  // ── Talent Fit awareness (Q3.3) ──────────────────────────────────────
  // Only `JobMatch` rows carry fit fields today. `CandidateMatch` keeps the
  // pure-cosine UI until the API extension lands for that side as well.
  const hasFit =
    !!jobMatch &&
    jobMatch.has_active_model === true &&
    jobMatch.fit_score !== null &&
    jobMatch.fit_score !== undefined;
  const cosinePct = jobMatch
    ? Math.round((jobMatch.cosine_score ?? jobMatch.score ?? 0) * 100)
    : null;
  const fitPct = hasFit ? Math.round((jobMatch!.fit_score as number) * 100) : null;
  const similarHireCount = jobMatch?.similar_hire_count ?? 0;

  const [showDetails, setShowDetails] = useState(false);
  const [similarOpen, setSimilarOpen] = useState(false);

  const targetCandidateId = jobMatch?.candidate_id ?? "";
  const targetCandidateName = jobMatch?.candidate_name ?? "";
  // Prefer the jobId prop (job-view passes it explicitly), fall back to the
  // candidate-view's row jobId if we ever support fit there.
  const similarJobId =
    jobId ?? (candidateMatch ? candidateMatch.job_id : undefined);

  return (
    <div
      className={cn(
        "group flex flex-col gap-3 rounded-xl border border-border bg-card p-4",
        "transition-all hover:border-indigo-200 hover:shadow-sm",
        "dark:hover:border-indigo-900/60"
      )}
    >
      {/* Top row: avatar/icon + identity + gauge */}
      <div className="flex items-start gap-3">
        {isJobView ? (
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-sm font-bold">
              {getInitials(jobMatch!.candidate_name)}
            </AvatarFallback>
          </Avatar>
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 text-white">
            <Briefcase className="h-4 w-4" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Link
              href={href}
              className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors truncate"
            >
              {title}
            </Link>
            <AIBadge />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground truncate">
            {subtitle}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn("text-[10px] font-medium uppercase tracking-wide", tone.badge)}
            >
              {tone.label}
            </Badge>
            {hasFit && cosinePct !== null && fitPct !== null && (
              <DualScoreBadge
                cosinePct={cosinePct}
                fitPct={fitPct}
                trainedOnHires={trainedOnHires}
                expanded={showDetails}
                onToggle={() => setShowDetails((v) => !v)}
              />
            )}
            {similarHireCount > 0 && (
              <button
                type="button"
                onClick={() => setSimilarOpen(true)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5",
                  "text-[10px] font-semibold transition-colors",
                  "border-emerald-200 bg-emerald-50 text-emerald-700",
                  "hover:bg-emerald-100",
                  "dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900",
                  "dark:hover:bg-emerald-950/50"
                )}
                aria-label={`Toon ${similarHireCount} vergelijkbare past-hires`}
              >
                <Users className="h-3 w-3" />
                Lijkt op {similarHireCount} hire
                {similarHireCount === 1 ? "" : "s"}
              </button>
            )}
          </div>
        </div>

        <ScoreGauge percent={match.match_percent} tone={tone} />
      </div>

      {/* Dual-score expanded detail */}
      {hasFit && showDetails && cosinePct !== null && fitPct !== null && (
        <div className="rounded-lg border border-border bg-zinc-50/60 dark:bg-zinc-800/30 p-3 text-xs space-y-2">
          <ScoreBar
            label="Cosine (profiel ↔ vacature)"
            percent={cosinePct}
            colorClass="bg-zinc-400"
          />
          <ScoreBar
            label="Talent Fit (jouw historische hires)"
            percent={fitPct}
            colorClass="bg-purple-500"
          />
          <ScoreBar
            label="Combined (gerangschikt op)"
            percent={match.match_percent}
            colorClass="bg-indigo-500"
            emphasis
          />
          <p className="text-[11px] text-muted-foreground italic pt-1 flex items-start gap-1.5">
            <Sparkles className="h-3 w-3 mt-0.5 text-purple-500 shrink-0" />
            <span>
              {trainedOnHires
                ? `Voorspelling op basis van ${trainedOnHires} eerdere hires bij jouw bureau.`
                : "Voorspelling op basis van de historische hires van jouw bureau."}
            </span>
          </p>
        </div>
      )}

      {/* AI snippet */}
      {match.ai_explanation && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed line-clamp-2">
          {match.ai_explanation}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
          onClick={() => onExplain?.(match)}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Waarom?
        </Button>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-8 text-xs text-muted-foreground hover:text-foreground"
        >
          <Link href={href}>
            {isJobView ? "Bekijk profiel" : "Bekijk vacature"}
          </Link>
        </Button>
      </div>

      {/* Similar past-hires modal */}
      {jobMatch && (
        <SimilarHiresModal
          open={similarOpen}
          onOpenChange={setSimilarOpen}
          candidateId={targetCandidateId}
          candidateName={targetCandidateName}
          jobId={similarJobId}
        />
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface DualScoreBadgeProps {
  cosinePct: number;
  fitPct: number;
  trainedOnHires?: number;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Compact 2-row pill that surfaces both the embedding cosine score (grijs) and
 * the learned Talent Fit score (paars/sparkle). Clicking expands the details
 * panel below the card.
 */
function DualScoreBadge({
  cosinePct,
  fitPct,
  trainedOnHires,
  expanded,
  onToggle,
}: DualScoreBadgeProps) {
  const fitTooltip = trainedOnHires
    ? `Voorspelling op basis van ${trainedOnHires} eerdere hires bij jouw bureau.`
    : "Voorspelling op basis van de historische hires van jouw bureau.";

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label="Toon score-breakdown"
            className={cn(
              "inline-flex flex-col items-stretch overflow-hidden rounded-md border text-[10px] font-semibold leading-tight",
              "border-purple-200 dark:border-purple-900/60",
              "transition-shadow hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
            )}
          >
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              <History className="h-2.5 w-2.5" />
              Cosine {cosinePct}%
            </span>
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300">
              <Sparkles className="h-2.5 w-2.5" />
              Fit {fitPct}%
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {fitTooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface ScoreBarProps {
  label: string;
  percent: number;
  colorClass: string;
  emphasis?: boolean;
}

function ScoreBar({ label, percent, colorClass, emphasis }: ScoreBarProps) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span
          className={cn(
            "text-zinc-600 dark:text-zinc-400",
            emphasis && "font-semibold text-zinc-900 dark:text-zinc-100"
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            "tabular-nums font-medium text-zinc-700 dark:text-zinc-200",
            emphasis && "font-bold"
          )}
        >
          {percent}%
        </span>
      </div>
      <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div
          className={cn("h-full rounded-full", colorClass)}
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatJobStatus(status: string): string {
  const map: Record<string, string> = {
    draft: "Concept",
    open: "Open",
    filled: "Gevuld",
    closed: "Gesloten",
    archived: "Gearchiveerd",
  };
  return map[status] ?? status;
}
