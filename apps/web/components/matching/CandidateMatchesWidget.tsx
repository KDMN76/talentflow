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
import { useCandidateMatches } from "@/hooks/useMatching";
import type { CandidateMatch } from "@/lib/types/matching";

/**
 * "Vacature-matches" widget on the candidate profile page. Shows top-N open
 * vacatures ranked for this candidate.
 */
export interface CandidateMatchesWidgetProps {
  candidateId: string;
  candidateName: string;
  /** Maximum rows to render (default 3 — fits the candidate profile sidebar). */
  limit?: number;
}

export function CandidateMatchesWidget({
  candidateId,
  candidateName,
  limit = 3,
}: CandidateMatchesWidgetProps) {
  const { data, isLoading } = useCandidateMatches(candidateId);
  const [selected, setSelected] = useState<CandidateMatch | null>(null);

  const matches = data ?? [];
  const visible = matches.slice(0, limit);
  const overflow = matches.length - visible.length;

  return (
    <>
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            Vacature-matches
          </CardTitle>
          <CardDescription>
            Vacatures uit je portefeuille die het beste aansluiten bij dit
            kandidaat-profiel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-xl" />
              ))}
            </div>
          ) : matches.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-8 text-center">
              <Sparkles className="h-5 w-5 mx-auto text-muted-foreground/60" />
              <p className="mt-2 text-xs text-muted-foreground">
                Nog geen vacature-matches berekend voor deze kandidaat.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {visible.map((m) => (
                  <MatchCard
                    key={m.job_id}
                    match={m}
                    mode="candidate-view"
                    onExplain={(match) => setSelected(match as CandidateMatch)}
                  />
                ))}
              </div>
              {overflow > 0 && (
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  + {overflow} meer
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
          jobId={selected.job_id}
          candidateId={candidateId}
          jobTitle={selected.job_title}
          candidateName={candidateName}
        />
      )}
    </>
  );
}
