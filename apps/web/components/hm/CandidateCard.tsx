"use client";

import { Briefcase, Sparkles, Star, ExternalLink } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { HMReview } from "@/hooks/useHiringManager";
import { cn, formatRelativeDate, getInitials } from "@/lib/utils";

interface CandidateCardProps {
  candidate: HMReview;
  /** Visual: when not the top card we render with reduced opacity / scale handled by parent. */
  dim?: boolean;
}

function scoreToColor(score: number): string {
  if (score >= 85) return "from-emerald-500 to-emerald-600 text-white";
  if (score >= 70) return "from-amber-400 to-amber-500 text-white";
  return "from-rose-500 to-rose-600 text-white";
}

function scoreLabel(score: number): string {
  if (score >= 85) return "Sterke match";
  if (score >= 70) return "Redelijke match";
  return "Twijfel";
}

/**
 * Mobile-first candidate card for the swipe-deck. Designed for thumb-reach:
 * generous padding, large typography, 48px+ tap-targets.
 */
export function CandidateCard({ candidate, dim }: CandidateCardProps) {
  const score = candidate.ai_score ?? 0;

  return (
    <div
      className={cn(
        "relative w-full rounded-3xl bg-card shadow-2xl ring-1 ring-zinc-200 dark:ring-zinc-800 overflow-hidden",
        "transition-opacity",
        dim && "opacity-60"
      )}
    >
      {/* Top section: avatar + name + position */}
      <div className="bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-indigo-950/40 dark:via-zinc-900 dark:to-purple-950/40 px-6 pt-6 pb-5">
        <div className="flex items-start gap-4">
          <Avatar className="h-20 w-20 ring-4 ring-white dark:ring-zinc-900 shadow-md shrink-0">
            <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-purple-600 text-2xl font-semibold text-white">
              {getInitials(candidate.candidate_name)}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0 pt-1">
            <h2 className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-100 truncate">
              {candidate.candidate_name}
            </h2>
            {candidate.candidate_position && (
              <p className="mt-0.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 truncate">
                {candidate.candidate_position}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {formatRelativeDate(candidate.applied_at)} aangemeld
            </p>
          </div>
        </div>

        {/* AI score — large badge */}
        {candidate.ai_score !== null && (
          <div className="mt-5 flex items-center gap-3">
            <div
              className={cn(
                "flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br shadow-md",
                scoreToColor(score)
              )}
            >
              <div className="flex flex-col items-center leading-none">
                <span className="text-2xl font-extrabold tabular-nums">{score}</span>
                <span className="text-[9px] font-semibold tracking-widest opacity-90">
                  AI
                </span>
              </div>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-400">
                <Sparkles className="h-3.5 w-3.5" />
                {scoreLabel(score)}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                AI-beoordeling op basis van CV en vereisten
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Job + stage bar */}
      <div className="flex items-center justify-between gap-3 border-y border-border bg-zinc-50 dark:bg-zinc-800/40 px-6 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <Briefcase className="h-4 w-4 text-indigo-600 shrink-0" />
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 truncate">
            {candidate.job_title}
          </span>
        </div>
        <span className="shrink-0 rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
          {candidate.stage_name}
        </span>
      </div>

      {/* Body */}
      <div className="space-y-4 px-6 py-5">
        {/* AI-summary (3 lines max via line-clamp via custom CSS) */}
        {candidate.ai_summary && (
          <p
            className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {candidate.ai_summary}
          </p>
        )}

        {/* Top-3 skills with bars */}
        {candidate.top_skills && candidate.top_skills.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              Top 3 skills
            </h3>
            <div className="space-y-2">
              {candidate.top_skills.slice(0, 3).map((s) => (
                <div key={s.name}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      {s.name}
                    </span>
                    <span className="text-xs font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
                      {s.score}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"
                      style={{ width: `${Math.max(0, Math.min(100, s.score))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Skill chips fallback when no top_skills */}
        {(!candidate.top_skills || candidate.top_skills.length === 0) &&
          candidate.skills &&
          candidate.skills.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {candidate.skills.slice(0, 6).map((skill) => (
                <Badge key={skill} variant="secondary" className="font-normal">
                  {skill}
                </Badge>
              ))}
            </div>
          )}

        {/* Full-detail link */}
        <CandidateDetailDialog candidate={candidate} />
      </div>
    </div>
  );
}

/**
 * "Bekijk volledig" — opens a modal with the full candidate-detail. Mobile uses
 * full-screen sheet styling via `max-w-[95vw]` and tall content.
 */
function CandidateDetailDialog({ candidate }: { candidate: HMReview }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="w-full min-h-[44px] gap-2 text-sm"
          type="button"
        >
          <ExternalLink className="h-4 w-4" />
          Bekijk volledig profiel
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
                {getInitials(candidate.candidate_name)}
              </AvatarFallback>
            </Avatar>
            <span>{candidate.candidate_name}</span>
          </DialogTitle>
          <DialogDescription>
            {candidate.candidate_position ?? candidate.job_title} —{" "}
            {candidate.candidate_email}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {candidate.ai_score !== null && (
            <div className="flex items-center gap-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 p-3">
              <Star className="h-5 w-5 text-amber-500" />
              <div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  AI-score: {candidate.ai_score}/100
                </p>
                <p className="text-xs text-muted-foreground">
                  {scoreLabel(candidate.ai_score)}
                </p>
              </div>
            </div>
          )}

          {candidate.ai_summary && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">
                AI-samenvatting
              </h4>
              <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                {candidate.ai_summary}
              </p>
            </div>
          )}

          {candidate.top_skills && candidate.top_skills.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
                Skills met AI-score
              </h4>
              <div className="space-y-2">
                {candidate.top_skills.map((s) => (
                  <div
                    key={s.name}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-sm">{s.name}</span>
                    <span className="text-xs font-semibold text-indigo-600">
                      {s.score}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {candidate.skills && candidate.skills.length > 0 && (
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
                Alle skills
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {candidate.skills.map((skill) => (
                  <Badge key={skill} variant="secondary" className="font-normal">
                    {skill}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">
              Pipeline: <span className="font-semibold">{candidate.job_title}</span>{" "}
              — fase{" "}
              <span className="font-semibold">{candidate.stage_name}</span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Aangemeld {formatRelativeDate(candidate.applied_at)}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
