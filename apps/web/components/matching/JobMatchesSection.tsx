"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MatchCard } from "@/components/matching/MatchCard";
import { MatchExplanationDialog } from "@/components/matching/MatchExplanationDialog";
import { useJobMatches } from "@/hooks/useMatching";
import { useTalentFitModel } from "@/hooks/useTalentFit";
import type { JobMatch } from "@/lib/types/matching";

/**
 * "AI-matches" card on the job detail page. Shows the top-N candidates ranked
 * by match-percent. Limits to 5 by default with a "Bekijk alle" hint when
 * more matches are available.
 */
export interface JobMatchesSectionProps {
  jobId: string;
  jobTitle: string;
  /** Maximum rows to render in the grid (default 5). */
  limit?: number;
}

export function JobMatchesSection({
  jobId,
  jobTitle,
  limit = 5,
}: JobMatchesSectionProps) {
  const { data, isLoading } = useJobMatches(jobId);
  const { data: model } = useTalentFitModel();
  const [selected, setSelected] = useState<JobMatch | null>(null);

  const matches = data ?? [];
  const visible = matches.slice(0, limit);
  const overflow = matches.length - visible.length;

  // Q3.3 — when every visible match comes from a tenant with an active
  // Talent Fit model, advertise that the ranking is fit-driven instead of
  // pure cosine. We require *all* (not "any") so we never lie about ranking.
  const allFitRanked =
    visible.length > 0 && visible.every((m) => m.has_active_model === true);

  const description = allFitRanked
    ? "Gerangschikt op Talent Fit (jouw historische hires)."
    : "Top kandidaten uit je database, gerangschikt op AI match-score.";

  return (
    <>
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-500" />
                AI-matches
              </CardTitle>
              <CardDescription className="mt-1">{description}</CardDescription>
            </div>
            {!isLoading && matches.length > 0 && (
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {matches.length} {matches.length === 1 ? "match" : "matches"}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-44 rounded-xl" />
              ))}
            </div>
          ) : matches.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-10 text-center">
              <Sparkles className="h-6 w-6 mx-auto text-muted-foreground/60" />
              <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Nog geen AI-matches berekend
              </p>
              <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
                Zodra er kandidaten in je database staan, scoort de AI ze
                automatisch tegen deze vacature.
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visible.map((m) => (
                  <MatchCard
                    key={m.candidate_id}
                    match={m}
                    mode="job-view"
                    onExplain={(match) => setSelected(match as JobMatch)}
                    jobId={jobId}
                    trainedOnHires={model?.hires}
                  />
                ))}
              </div>
              {overflow > 0 && (
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  + {overflow} meer matches —{" "}
                  <button
                    type="button"
                    className="text-indigo-600 hover:text-indigo-700 hover:underline dark:text-indigo-400"
                    onClick={() => {
                      // Future: navigate to a dedicated full-list view. For now
                      // this is a stub that surfaces overflow without losing UX.
                      window.dispatchEvent(
                        new CustomEvent("talentflow:show-all-matches", {
                          detail: { jobId },
                        })
                      );
                    }}
                  >
                    Bekijk alle
                  </button>
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {selected && (
        <MatchExplanationDialog
          open={!!selected}
          onOpenChange={(o) => {
            if (!o) setSelected(null);
          }}
          jobId={jobId}
          candidateId={selected.candidate_id}
          jobTitle={jobTitle}
          candidateName={selected.candidate_name}
        />
      )}
    </>
  );
}
