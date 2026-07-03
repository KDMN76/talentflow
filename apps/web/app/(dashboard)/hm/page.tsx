"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Clock, CloudOff, Sparkles, Undo2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  useHmCandidatesToReview,
  useHmDecision,
  useHmStats,
  type HMReview,
} from "@/hooks/useHiringManager";
import { SwipeDeck, type Decision, type SwipeDeckHandle } from "@/components/hm/SwipeDeck";
import { HmActionButtons } from "@/components/hm/HmActionButtons";
import { InlineScorecard } from "@/components/hm/InlineScorecard";
import { HmBottomNav } from "@/components/hm/HmBottomNav";
import { PushPermissionShim } from "@/components/hm/PushPermissionShim";
import type { ScorecardInput } from "@/lib/types/atsExtensions";
import { cn } from "@/lib/utils";

const UNDO_WINDOW_MS = 5000;

interface PendingDecision {
  candidate: HMReview;
  decision: Decision;
  scheduledAt: number;
  scorecard?: ScorecardInput;
}

export default function HiringManagerPage() {
  const { t } = useTranslation("hm");
  const { data: queue, isLoading, isError, refetch } = useHmCandidatesToReview();
  const { data: stats } = useHmStats();
  const decisionMutation = useHmDecision();
  const { toast } = useToast();

  const deckRef = useRef<SwipeDeckHandle>(null);

  /** Local stack: lets us reorder (later) and remove without waiting for
   * server invalidation. Seeded from the query-result. */
  const [stack, setStack] = useState<HMReview[]>([]);
  const [seeded, setSeeded] = useState(false);

  /** Undo timers — keyed by application_id. */
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /** Pending (undoable) decisions — used to allow restoring on undo. */
  const [pending, setPending] = useState<PendingDecision[]>([]);

  /** Candidate currently being scored after an "approve". */
  const [scoring, setScoring] = useState<HMReview | null>(null);
  const [submittingScorecard, setSubmittingScorecard] = useState(false);

  // Initial seed.
  useEffect(() => {
    if (!seeded && queue) {
      setStack([...queue]);
      setSeeded(true);
    }
  }, [queue, seeded]);

  // When the upstream query refreshes (e.g. after invalidate), merge in any
  // brand-new candidates so newly-pushed apps appear on the deck.
  useEffect(() => {
    if (!seeded || !queue) return;
    setStack((prev) => {
      const known = new Set(prev.map((c) => c.application_id));
      const removed = new Set(
        pending.map((p) => p.candidate.application_id)
      );
      const additions = queue.filter(
        (c) => !known.has(c.application_id) && !removed.has(c.application_id)
      );
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
  }, [queue, seeded, pending]);

  // Cleanup any pending timers on unmount.
  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
    };
  }, []);

  const remaining = stack.length;

  // ------------------------------------------------------------------------
  // Decision flow
  // ------------------------------------------------------------------------

  /**
   * Voert de beslissing echt door op de backend. Retourneert `false` bij een
   * mislukte write — de aanroeper zet de kandidaat dan terug op de stapel
   * zodat de swipe NIET stilletjes verloren gaat.
   */
  const commitDecision = useCallback(
    async (input: PendingDecision): Promise<boolean> => {
      try {
        await decisionMutation.mutateAsync({
          candidateId: input.candidate.application_id,
          decision: input.decision,
          scorecard: input.scorecard,
          stageId: input.candidate.stage_id ?? null,
        });
        return true;
      } catch {
        toast({
          variant: "destructive",
          title: t("review.toasts.syncFailed.title"),
          description: t("review.toasts.syncFailed.description"),
        });
        return false;
      }
    },
    [decisionMutation, toast, t]
  );

  const undoDecision = useCallback(
    (applicationId: string) => {
      const timer = timersRef.current.get(applicationId);
      if (timer) {
        clearTimeout(timer);
        timersRef.current.delete(applicationId);
      }
      setPending((prev) => {
        const entry = prev.find(
          (p) => p.candidate.application_id === applicationId
        );
        if (entry) {
          // Put the candidate back on top.
          setStack((s) => [entry.candidate, ...s]);
          toast({
            title: t("review.toasts.undone.title"),
            description: t("review.toasts.undone.description", {
              name: entry.candidate.candidate_name,
            }),
          });
        }
        return prev.filter((p) => p.candidate.application_id !== applicationId);
      });
    },
    [toast, t]
  );

  /** Schedule an undo-able action: pop the candidate now, fire the API after
   * the undo window expires. Used for "reject". */
  const scheduleUndoableDecision = useCallback(
    (candidate: HMReview, decision: Decision) => {
      const entry: PendingDecision = {
        candidate,
        decision,
        scheduledAt: Date.now(),
      };
      setPending((prev) => [...prev, entry]);

      const timer = setTimeout(() => {
        timersRef.current.delete(candidate.application_id);
        setPending((prev) =>
          prev.filter(
            (p) => p.candidate.application_id !== candidate.application_id
          )
        );
        void commitDecision(entry).then((ok) => {
          if (!ok) {
            // Write mislukt — kandidaat terug op de stapel, beslissing niet
            // doorgevoerd.
            setStack((s) => [entry.candidate, ...s]);
          }
        });
      }, UNDO_WINDOW_MS);

      timersRef.current.set(candidate.application_id, timer);
    },
    [commitDecision]
  );

  /** Called by SwipeDeck (gesture) and HmActionButtons (button). Single
   * funnel for all decisions. */
  const handleDecision = useCallback(
    (candidateId: string, decision: Decision) => {
      const candidate = stack.find((c) => c.application_id === candidateId);
      if (!candidate) return;

      if (decision === "approve") {
        // Pop top, open scorecard sheet. We commit the approve once the
        // sheet submits (or skip path).
        setStack((s) =>
          s.filter((c) => c.application_id !== candidateId)
        );
        setScoring(candidate);
        return;
      }

      if (decision === "later") {
        // Move to bottom of stack with a `last_skipped_at` timestamp.
        setStack((s) => {
          const without = s.filter(
            (c) => c.application_id !== candidateId
          );
          return [
            ...without,
            { ...candidate, last_skipped_at: new Date().toISOString() },
          ];
        });
        // Backend bijwerken zodat deadlines kloppen; bij een mislukte write
        // gaat de kandidaat terug naar boven en vervalt de "later"-melding.
        void commitDecision({
          candidate,
          decision: "later",
          scheduledAt: Date.now(),
        }).then((ok) => {
          if (!ok) {
            setStack((s) => [
              candidate,
              ...s.filter((c) => c.application_id !== candidate.application_id),
            ]);
          }
        });
        toast({
          title: t("review.toasts.later.title"),
          description: t("review.toasts.later.description", {
            name: candidate.candidate_name,
          }),
        });
        return;
      }

      // reject — undoable
      setStack((s) => s.filter((c) => c.application_id !== candidateId));
      scheduleUndoableDecision(candidate, "reject");
      toast({
        title: t("review.toasts.rejected.title"),
        description: t("review.toasts.rejected.description", {
          name: candidate.candidate_name,
        }),
        action: (
          <button
            type="button"
            onClick={() => undoDecision(candidate.application_id)}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50"
          >
            <Undo2 className="h-3.5 w-3.5" />
            {t("review.undoButton")}
          </button>
        ),
      });
    },
    [stack, scheduleUndoableDecision, commitDecision, toast, undoDecision, t]
  );

  /** Called from HmActionButtons. Triggers the deck animation, which then
   * fires onDeckDecision via its onTransitionEnd. */
  const onButtonAction = useCallback((decision: Decision) => {
    deckRef.current?.flick(decision);
  }, []);

  const handleScorecardSubmit = useCallback(
    async (input: ScorecardInput) => {
      if (!scoring) return;
      setSubmittingScorecard(true);
      try {
        const ok = await commitDecision({
          candidate: scoring,
          decision: "approve",
          scheduledAt: Date.now(),
          scorecard: input,
        });
        if (!ok) {
          // Write mislukt: sheet blijft open zodat de HM opnieuw kan
          // versturen — de fout-toast is al getoond door commitDecision.
          return;
        }
        toast({
          title: t("review.toasts.approved.title"),
          description: t("review.toasts.approved.description", {
            name: scoring.candidate_name,
          }),
        });
        setScoring(null);
      } finally {
        setSubmittingScorecard(false);
      }
    },
    [scoring, commitDecision, toast, t]
  );

  const handleScorecardCancel = useCallback(() => {
    if (!scoring) return;
    // User backed out — put candidate back on the deck.
    setStack((s) => [scoring, ...s]);
    setScoring(null);
  }, [scoring]);

  const counterText = useMemo(
    () => t("review.counter", { count: remaining }),
    [remaining, t]
  );

  return (
    <>
      <div className="space-y-5 pb-28 lg:pb-0 animate-fade-in">
        <PageHeader
          title={t("review.header.title")}
          description={t("review.header.description")}
          actions={
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400">
              <Sparkles className="h-3.5 w-3.5" />
              {counterText}
            </span>
          }
        />

        <PushPermissionShim />

        {/* Mini-stats row */}
        {stats && (
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <MiniStat
              label={t("review.stats.toReview")}
              value={stats.to_review}
              tone="indigo"
            />
            <MiniStat
              label={t("review.stats.scorecardsOpen")}
              value={stats.scorecards_due_today + stats.scorecards_overdue}
              tone={stats.scorecards_overdue > 0 ? "rose" : "amber"}
            />
            <MiniStat
              label={t("review.stats.approvedToday")}
              value={stats.approved_today}
              tone="emerald"
            />
          </div>
        )}

        {/* Deck */}
        <div className="relative">
          {isLoading && stack.length === 0 ? (
            <div className="mx-auto w-full max-w-md">
              <Skeleton className="h-[560px] w-full rounded-3xl" />
            </div>
          ) : isError && stack.length === 0 ? (
            <ErrorState onRetry={() => refetch()} />
          ) : remaining === 0 ? (
            <EmptyState />
          ) : (
            <>
              <SwipeDeck
                ref={deckRef}
                candidates={stack}
                onDecision={handleDecision}
              />
              <div className="mt-5">
                <HmActionButtons
                  onAction={onButtonAction}
                  disabled={submittingScorecard}
                />
              </div>
              <p className="mt-3 text-center text-[11px] uppercase tracking-widest text-muted-foreground">
                {t("review.tip")}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Inline scorecard sheet */}
      <InlineScorecard
        candidate={scoring}
        onCancel={handleScorecardCancel}
        onSubmit={handleScorecardSubmit}
        submitting={submittingScorecard}
      />

      <HmBottomNav />
    </>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function EmptyState() {
  const { t } = useTranslation("hm");
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/50">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
        </div>
        <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
          {t("review.empty.title")}
        </h3>
        <p className="text-sm text-muted-foreground max-w-xs">
          {t("review.empty.description")}
        </p>
      </CardContent>
    </Card>
  );
}

/** Eerlijke fout-staat: de wachtrij kon niet geladen worden. */
function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation("hm");
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/50">
          <CloudOff className="h-8 w-8 text-amber-600" />
        </div>
        <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
          {t("review.loadError.title")}
        </h3>
        <p className="text-sm text-muted-foreground max-w-xs">
          {t("review.loadError.description")}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          {t("review.loadError.retry")}
        </button>
      </CardContent>
    </Card>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "indigo" | "amber" | "rose" | "emerald";
}) {
  const toneClass =
    tone === "indigo"
      ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
      : tone === "amber"
        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
        : tone === "rose"
          ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
          : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  return (
    <div
      className={cn(
        "rounded-2xl px-3 py-2.5 flex flex-col items-start",
        toneClass
      )}
    >
      <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">
        {label}
      </span>
      <span className="text-2xl font-extrabold tabular-nums leading-none mt-1 inline-flex items-center gap-1">
        {tone === "indigo" && <Clock className="h-4 w-4" />}
        {value}
      </span>
    </div>
  );
}
