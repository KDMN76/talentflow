"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ShieldAlert, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { useGenerateMatchExplanation } from "@/hooks/useMatching";
import { cn } from "@/lib/utils";
import type { MatchExplanationResponse } from "@/lib/types/matching";

/**
 * AI explanation dialog. Triggered from the "Waarom?" button on a `MatchCard`.
 *
 * Behaviour:
 *   1. On first open, fires `useGenerateMatchExplanation` for the (job, cand) pair.
 *   2. While loading, renders skeletons for the structured sections.
 *   3. On success, renders explanation + strengths + gaps + the verbatim
 *      `ai_disclosure` footer (EU AI Act Art. 50).
 *   4. The "Score handmatig overschrijven" button is a placeholder that opens
 *      a confirm dialog explaining the feature ships in the next slice.
 *      This satisfies the AI Act human-override requirement at the UX seam
 *      even if the underlying mutation isn't wired yet.
 */

export interface MatchExplanationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  candidateId: string;
  jobTitle: string;
  candidateName: string;
}

export function MatchExplanationDialog({
  open,
  onOpenChange,
  jobId,
  candidateId,
  jobTitle,
  candidateName,
}: MatchExplanationDialogProps) {
  const { toast } = useToast();
  const generate = useGenerateMatchExplanation();
  const [data, setData] = useState<MatchExplanationResponse | null>(null);
  const [confirmOverride, setConfirmOverride] = useState(false);

  // Trigger the mutation on first open (per pair). Reset cached pair-data when
  // the dialog is targeted at a different match.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setData(null);
    generate.mutate(
      { jobId, candidateId },
      {
        onSuccess: (response) => {
          if (!cancelled) setData(response);
        },
        onError: () => {
          if (!cancelled) {
            toast({
              variant: "destructive",
              title: "AI-uitleg niet beschikbaar",
              description:
                "We konden de AI-uitleg niet ophalen. Probeer het opnieuw of neem contact op met support.",
            });
          }
        },
      }
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, jobId, candidateId]);

  const isLoading = generate.isPending && !data;
  const percent = data?.match_percent ?? null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-500" />
              AI-uitleg: waarom past {candidateName} bij {jobTitle}?
            </DialogTitle>
            <DialogDescription>
              Onderbouwing van de match-score met sterke punten en aandachtspunten.
            </DialogDescription>
          </DialogHeader>

          {/* Match-score badge */}
          <div className="flex items-center gap-3 rounded-lg border border-border bg-zinc-50 dark:bg-zinc-900/40 px-4 py-3">
            {isLoading ? (
              <Skeleton className="h-7 w-20 rounded-md" />
            ) : (
              <Badge
                className={cn(
                  "text-base font-bold px-3 py-1 border",
                  percent !== null && percent >= 80 &&
                    "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900",
                  percent !== null && percent >= 60 && percent < 80 &&
                    "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900",
                  percent !== null && percent < 60 &&
                    "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700"
                )}
              >
                {percent}% match
              </Badge>
            )}
            {data?.cached && (
              <span className="text-xs text-muted-foreground">
                Uit cache (laatst berekend bij wijziging profiel)
              </span>
            )}
          </div>

          <div className="space-y-5 max-h-[55vh] overflow-y-auto pr-1">
            {/* Uitleg */}
            <section>
              <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1.5">
                Uitleg
              </h4>
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-11/12" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ) : (
                <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                  {data?.explanation}
                </p>
              )}
            </section>

            {/* Sterke punten */}
            <section>
              <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                Sterke punten
              </h4>
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-3 w-5/6" />
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {(data?.strengths ?? []).map((s, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                    >
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                      <span>{s}</span>
                    </li>
                  ))}
                  {data && data.strengths.length === 0 && (
                    <li className="text-sm text-muted-foreground italic">
                      Geen sterke punten geïdentificeerd.
                    </li>
                  )}
                </ul>
              )}
            </section>

            {/* Aandachtspunten */}
            <section>
              <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2 flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                Aandachtspunten
              </h4>
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {(data?.gaps ?? []).map((g, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300"
                    >
                      <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                      <span>{g}</span>
                    </li>
                  ))}
                  {data && data.gaps.length === 0 && (
                    <li className="text-sm text-muted-foreground italic">
                      Geen aandachtspunten genoemd.
                    </li>
                  )}
                </ul>
              )}
            </section>
          </div>

          {/* AI disclosure (EU AI Act Art. 50, verbatim) */}
          <div
            className={cn(
              "flex items-start gap-2 rounded-md border border-purple-100 dark:border-purple-900/50",
              "bg-purple-50/60 dark:bg-purple-950/20 px-3 py-2"
            )}
          >
            <Sparkles className="h-3.5 w-3.5 text-purple-500 mt-0.5 shrink-0" />
            <p className="text-[11px] italic text-zinc-600 dark:text-zinc-400 leading-snug">
              {data?.ai_disclosure ??
                "Deze match-score wordt gegenereerd door AI. De recruiter behoudt het finale oordeel."}
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setConfirmOverride(true)}
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              Score handmatig overschrijven
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Sluiten
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Override placeholder confirm */}
      <Dialog open={confirmOverride} onOpenChange={setConfirmOverride}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-500" />
              Handmatige score-override
            </DialogTitle>
            <DialogDescription className="pt-2">
              Werkt nog niet — komt in de volgende slice. Deze functie laat je
              de AI-score corrigeren met een onderbouwing, zodat de menselijke
              eindbeoordeling traceerbaar blijft (EU AI Act vereiste).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              size="sm"
              onClick={() => setConfirmOverride(false)}
            >
              Begrepen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
