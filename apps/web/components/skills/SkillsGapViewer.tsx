"use client";

import { Check, X, Sparkles, AlertTriangle, ThumbsUp, Target } from "lucide-react";
import { AIBadge } from "@/components/matching/AIBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSkillsGap } from "@/hooks/useSkills";
import { cn } from "@/lib/utils";
import type {
  SkillsGapAnalysis,
  SkillsGapMatch,
  SkillsGapRecommendation,
} from "@/lib/types/skills";

const RECOMMENDATION_COPY: Record<
  SkillsGapRecommendation,
  { label: string; cls: string; icon: JSX.Element }
> = {
  strong_fit: {
    label: "Sterke match",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/50",
    icon: <ThumbsUp className="h-3 w-3" />,
  },
  good_fit: {
    label: "Goede match",
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-900/50",
    icon: <Target className="h-3 w-3" />,
  },
  partial_fit: {
    label: "Gedeeltelijk",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-900/50",
    icon: <AlertTriangle className="h-3 w-3" />,
  },
  weak_fit: {
    label: "Zwakke match",
    cls: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-red-200 dark:border-red-900/50",
    icon: <AlertTriangle className="h-3 w-3" />,
  },
};

function pctColor(pct: number): string {
  if (pct >= 85) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 70) return "text-blue-600 dark:text-blue-400";
  if (pct >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function pctRingColor(pct: number): string {
  if (pct >= 85) return "rgb(16 185 129)";
  if (pct >= 70) return "rgb(37 99 235)";
  if (pct >= 50) return "rgb(245 158 11)";
  return "rgb(220 38 38)";
}

function MatchGauge({ pct, size = "lg" }: { pct: number; size?: "sm" | "lg" }) {
  const dim = size === "lg" ? 96 : 56;
  const inner = size === "lg" ? 16 : 8;
  return (
    <div
      className="relative shrink-0"
      style={{ width: dim, height: dim }}
      aria-label={`Match: ${pct}%`}
    >
      <div
        className="h-full w-full rounded-full"
        style={{
          background: `conic-gradient(${pctRingColor(pct)} ${pct}%, rgb(228 228 231) ${pct}%)`,
        }}
      />
      <div
        className="absolute rounded-full bg-card flex items-center justify-center"
        style={{
          inset: inner / 2,
        }}
      >
        <span
          className={cn(
            "font-bold tabular-nums",
            size === "lg" ? "text-2xl" : "text-sm",
            pctColor(pct)
          )}
        >
          {pct}%
        </span>
      </div>
    </div>
  );
}

function ProficiencyBar({
  required,
  candidate,
}: {
  required: number;
  candidate: number | null;
}) {
  const reqPct = (required / 10) * 100;
  const candPct = ((candidate ?? 0) / 10) * 100;
  return (
    <div className="relative h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800">
      <div
        className="absolute top-0 left-0 h-full rounded-full bg-zinc-300 dark:bg-zinc-700"
        style={{ width: `${reqPct}%` }}
        aria-label={`Vereist niveau ${required}/10`}
      />
      {candidate !== null && (
        <div
          className={cn(
            "absolute top-0 left-0 h-full rounded-full",
            candidate >= required
              ? "bg-emerald-500"
              : "bg-amber-500"
          )}
          style={{ width: `${candPct}%` }}
          aria-label={`Kandidaat niveau ${candidate}/10`}
        />
      )}
    </div>
  );
}

function SkillRow({ match }: { match: SkillsGapMatch }) {
  return (
    <div className="space-y-1.5 rounded-md border border-border/60 bg-background px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {match.has_match ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <X className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
          )}
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
            {match.preferred_label}
          </span>
        </div>
        <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
          {match.candidate_proficiency ?? "–"} / {match.required_proficiency}
        </span>
      </div>
      <ProficiencyBar
        required={match.required_proficiency}
        candidate={match.candidate_proficiency}
      />
    </div>
  );
}

// ─── Compact variant ─────────────────────────────────────────────────────────

export interface SkillsGapViewerCompactProps {
  jobId: string;
  candidateId: string;
}

/** Pipeline-card mini-version: just the match-percentage badge + label. */
export function SkillsGapViewerCompact({
  jobId,
  candidateId,
}: SkillsGapViewerCompactProps) {
  const { data, isLoading } = useSkillsGap(jobId, candidateId);
  if (isLoading) return <Skeleton className="h-5 w-20" />;
  if (!data) return null;
  const cfg = RECOMMENDATION_COPY[data.recommendation];
  return (
    <div className="flex items-center gap-1.5">
      <MatchGauge pct={data.match_percentage} size="sm" />
      <Badge
        variant="secondary"
        className={cn("text-[10px] gap-1 border", cfg.cls)}
      >
        {cfg.icon}
        {cfg.label}
      </Badge>
    </div>
  );
}

// ─── Full viewer ─────────────────────────────────────────────────────────────

export interface SkillsGapViewerProps {
  jobId: string;
  candidateId: string;
  /** Hide outer card wrapper when embedded in another card. */
  unwrapped?: boolean;
}

export function SkillsGapViewer({
  jobId,
  candidateId,
  unwrapped,
}: SkillsGapViewerProps) {
  const { data, isLoading, error } = useSkillsGap(jobId, candidateId);

  const body = (
    <div className="space-y-5">
      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      )}
      {error && !data && (
        <p className="text-sm text-muted-foreground">
          Kon skills-gap niet laden.
        </p>
      )}
      {data && <SkillsGapViewerInner data={data} />}
    </div>
  );

  if (unwrapped) return body;
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="h-4 w-4 text-indigo-500" />
          Skills-gap
          <AIBadge label="Match-analyse op basis van ESCO-skills uit CV en vacature." />
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

function SkillsGapViewerInner({ data }: { data: SkillsGapAnalysis }) {
  const cfg = RECOMMENDATION_COPY[data.recommendation];
  return (
    <div className="space-y-5">
      {/* Header: gauge + recommendation */}
      <div className="flex items-center gap-4">
        <MatchGauge pct={data.match_percentage} />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Match-percentage
          </p>
          <Badge
            variant="secondary"
            className={cn("gap-1.5 border", cfg.cls)}
          >
            {cfg.icon}
            {cfg.label}
          </Badge>
          <p className="text-xs text-muted-foreground">
            {data.required.length} vereiste skills •{" "}
            {data.nice_to_have.length} nice-to-haves •{" "}
            {data.bonus_skills.length} bonus
          </p>
        </div>
      </div>

      {/* Required + nice-to-haves */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Vereist ({data.required.filter((r) => r.has_match).length}/
            {data.required.length})
          </p>
          {data.required.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              Geen vereiste skills geconfigureerd.
            </p>
          ) : (
            <div className="space-y-1.5">
              {data.required.map((m) => (
                <SkillRow key={m.esco_id} match={m} />
              ))}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Nice-to-have ({data.nice_to_have.filter((r) => r.has_match).length}/
            {data.nice_to_have.length})
          </p>
          {data.nice_to_have.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              Geen nice-to-haves.
            </p>
          ) : (
            <div className="space-y-1.5">
              {data.nice_to_have.map((m) => (
                <SkillRow key={m.esco_id} match={m} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bonus */}
      {data.bonus_skills.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" />
            Bonus skills (kandidaat heeft, niet gevraagd)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.bonus_skills.map((s) => (
              <Badge
                key={s.id}
                variant="secondary"
                className="bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border border-purple-100 dark:border-purple-900/50 gap-1"
              >
                {s.preferred_label}
                <span className="text-[10px] opacity-70 tabular-nums">
                  {s.proficiency}/10
                </span>
              </Badge>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground italic">
        Berekend op{" "}
        {new Date(data.computed_at).toLocaleString("nl-NL", {
          dateStyle: "short",
          timeStyle: "short",
        })}{" "}
        — recruiter behoudt het finale oordeel.
      </p>
    </div>
  );
}
