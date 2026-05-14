"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Star,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useScorecardTemplates } from "@/hooks/useScorecards";
import type { HMReview } from "@/hooks/useHiringManager";
import { cn, getInitials } from "@/lib/utils";
import type {
  ScorecardCriterion,
  ScorecardInput,
  ScorecardRecommendation,
} from "@/lib/types/atsExtensions";

const RECOMMENDATIONS: Array<{
  value: ScorecardRecommendation;
  label: string;
  emoji: string;
  tone: string;
}> = [
  {
    value: "strong_yes",
    label: "Strong Yes",
    emoji: "🔥",
    tone: "border-emerald-600 bg-emerald-600 text-white",
  },
  {
    value: "yes",
    label: "Yes",
    emoji: "✅",
    tone: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  {
    value: "neutral",
    label: "Neutraal",
    emoji: "🤔",
    tone: "border-zinc-300 bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300",
  },
  {
    value: "no",
    label: "No",
    emoji: "👎",
    tone: "border-rose-300 bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  },
  {
    value: "strong_no",
    label: "Strong No",
    emoji: "🚫",
    tone: "border-rose-700 bg-rose-600 text-white",
  },
];

interface InlineScorecardProps {
  /** When null, the sheet is hidden. */
  candidate: HMReview | null;
  /** Called when sheet is dismissed without submission. */
  onCancel: () => void;
  /** Called with the assembled ScorecardInput; the parent handles persistence
   * + advancing the deck. */
  onSubmit: (input: ScorecardInput) => Promise<void> | void;
  /** When true, submit-button shows spinner and inputs disabled. */
  submitting?: boolean;
}

/**
 * Mobile bottom-sheet / desktop side-panel scorecard. Touch-optimised:
 *  - 5 large round score-buttons (48px) per criterion
 *  - "Volgende criterium" pager so the HM walks one criterium at a time
 *  - Recommendation as 5 emoji-tiles (44px tap-targets)
 *  - Sticky submit on bottom
 *
 * Differs from the desktop ScorecardForm (Q1.2) which shows all criteria at
 * once. Here we step through, plus we render the recommendation step-by-step.
 */
export function InlineScorecard({
  candidate,
  onCancel,
  onSubmit,
  submitting,
}: InlineScorecardProps) {
  const open = !!candidate;
  const templates = useScorecardTemplates({
    jobId: candidate?.job_id ?? null,
    stageId: candidate?.stage_id ?? null,
  });
  const tmpls = templates.data ?? [];

  const [templateId, setTemplateId] = useState<string>("");
  const [criteria, setCriteria] = useState<ScorecardCriterion[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [recommendation, setRecommendation] = useState<ScorecardRecommendation>("yes");
  const [notes, setNotes] = useState("");

  // Reset whenever a new candidate opens.
  useEffect(() => {
    if (!candidate) return;
    setStepIndex(0);
    setRecommendation("yes");
    setNotes("");
  }, [candidate?.application_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Default-select first template once they load.
  useEffect(() => {
    if (templateId === "" && tmpls.length > 0) {
      setTemplateId(tmpls[0].id);
    }
  }, [tmpls, templateId]);

  // Build criteria scaffold whenever template changes.
  useEffect(() => {
    const tmpl = tmpls.find((t) => t.id === templateId);
    if (!tmpl) {
      setCriteria([]);
      return;
    }
    setCriteria(
      tmpl.criteria.map((c) => ({
        key: c.key,
        label: c.label,
        description: c.description ?? null,
        score: null,
      }))
    );
    setStepIndex(0);
  }, [templateId, tmpls]);

  const totalSteps = criteria.length + 1; // criteria + final recommendation step
  const onLastStep = stepIndex >= criteria.length;
  const overallScore = useMemo(() => {
    const scored = criteria.filter(
      (c): c is ScorecardCriterion & { score: number } => c.score != null
    );
    if (scored.length === 0) return 0;
    return Number(
      (scored.reduce((sum, c) => sum + c.score, 0) / scored.length).toFixed(2)
    );
  }, [criteria]);
  const allScored = criteria.length > 0 && criteria.every((c) => c.score != null);

  const setScore = (key: string, score: number) => {
    setCriteria((cur) => cur.map((c) => (c.key === key ? { ...c, score } : c)));
    // Auto-advance after a brief delay for tactile feel.
    setTimeout(() => {
      setStepIndex((idx) => Math.min(idx + 1, criteria.length));
    }, 180);
  };

  const goPrev = () => setStepIndex((i) => Math.max(0, i - 1));
  const goNext = () => setStepIndex((i) => Math.min(totalSteps - 1, i + 1));

  const handleSubmit = async () => {
    if (!allScored || !candidate) return;
    const input: ScorecardInput = {
      template_id: templateId || null,
      criteria: criteria.map((c) => ({
        key: c.key,
        label: c.label,
        score: c.score,
      })),
      overall_score: overallScore,
      recommendation,
      notes: notes.trim() || null,
    };
    await onSubmit(input);
  };

  if (!open || !candidate) return null;

  // Progress bar fill
  const completed = criteria.filter((c) => c.score != null).length;
  const progress = Math.round(
    ((completed + (onLastStep ? 1 : 0)) / totalSteps) * 100
  );

  const currentCrit = !onLastStep ? criteria[stepIndex] : null;

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Scorecard invullen"
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
    >
      {/* Overlay */}
      <button
        type="button"
        aria-label="Sluiten"
        onClick={onCancel}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* Sheet — bottom-sheet on mobile, centered modal on desktop. Uses
          dvh so it adapts to the on-screen keyboard. */}
      <div
        className={cn(
          "relative z-10 w-full max-h-[92dvh] overflow-hidden bg-background shadow-2xl flex flex-col",
          "rounded-t-3xl sm:rounded-3xl sm:max-w-xl sm:m-4",
          "animate-in slide-in-from-bottom-8 sm:slide-in-from-bottom-0 sm:fade-in-0 duration-300"
        )}
      >
        {/* Drag-handle (mobile) */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-1">
          <div className="h-1.5 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <Avatar className="h-10 w-10 shrink-0">
            <AvatarFallback className="bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-semibold">
              {getInitials(candidate.candidate_name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              Scorecard — {candidate.candidate_name}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {candidate.job_title}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Sluiten"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Progress */}
        <div className="px-5 py-2">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-widest text-muted-foreground">
            <span>
              Stap {Math.min(stepIndex + 1, totalSteps)} van {totalSteps}
            </span>
            <span>{progress}%</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-indigo-500 transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {tmpls.length === 0 && templates.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Templates laden…
            </p>
          ) : tmpls.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Geen scorecard-template gevonden voor deze fase.
            </p>
          ) : (
            <>
              {/* Template chooser — compact, only when multiple */}
              {tmpls.length > 1 && (
                <div className="mb-4">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                    Template
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {tmpls.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTemplateId(t.id)}
                        className={cn(
                          "rounded-full px-3 py-1.5 text-xs font-medium transition-colors min-h-[36px]",
                          templateId === t.id
                            ? "bg-indigo-600 text-white"
                            : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                        )}
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Per-criterion step */}
              {currentCrit && (
                <div className="space-y-4 py-2">
                  <div>
                    <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                      {currentCrit.label}
                    </h3>
                    {currentCrit.description && (
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {currentCrit.description}
                      </p>
                    )}
                  </div>

                  <ScoreScale
                    value={currentCrit.score}
                    onChange={(v) => setScore(currentCrit.key, v)}
                  />

                  {/* Crit-pager */}
                  <div className="flex items-center justify-between gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={goPrev}
                      disabled={stepIndex === 0}
                      className="min-h-[44px] gap-1.5"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Vorige
                    </Button>
                    <Button
                      type="button"
                      onClick={goNext}
                      disabled={currentCrit.score == null}
                      className="min-h-[44px] gap-1.5 bg-indigo-600 hover:bg-indigo-700"
                    >
                      Volgende
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Final step — recommendation + notes */}
              {onLastStep && (
                <div className="space-y-5 py-2">
                  <div className="flex items-center justify-between rounded-xl bg-gradient-to-br from-indigo-50 to-emerald-50 p-4 dark:from-indigo-950/40 dark:to-emerald-950/40">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                        Gemiddelde score
                      </p>
                      <p className="mt-0.5 flex items-baseline gap-1.5">
                        <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
                        <span className="text-3xl font-extrabold tabular-nums text-indigo-700 dark:text-indigo-300">
                          {overallScore.toFixed(2)}
                        </span>
                        <span className="text-sm text-muted-foreground">/ 5</span>
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setStepIndex(0)}
                      className="text-xs text-muted-foreground"
                    >
                      Bewerken
                    </Button>
                  </div>

                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                      Aanbeveling
                    </p>
                    <div className="grid grid-cols-5 gap-1.5">
                      {RECOMMENDATIONS.map((r) => {
                        const selected = recommendation === r.value;
                        return (
                          <button
                            key={r.value}
                            type="button"
                            onClick={() => setRecommendation(r.value)}
                            aria-pressed={selected}
                            className={cn(
                              "flex flex-col items-center justify-center gap-0.5 rounded-xl border-2 p-2 min-h-[64px] text-[10px] font-bold uppercase tracking-wide transition-all",
                              selected
                                ? r.tone + " shadow-md scale-[1.04]"
                                : "border-border bg-background text-muted-foreground hover:border-indigo-300"
                            )}
                          >
                            <span className="text-2xl leading-none">{r.emoji}</span>
                            <span className="leading-tight">{r.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="hm-notes"
                      className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground"
                    >
                      Notities (optioneel)
                    </label>
                    <textarea
                      id="hm-notes"
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Korte motivatie van je beoordeling…"
                      className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 resize-none"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Sticky submit */}
        {tmpls.length > 0 && (
          <div className="border-t border-border bg-background/95 backdrop-blur px-5 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={!allScored || submitting}
              className="w-full min-h-[52px] gap-2 bg-gradient-to-r from-emerald-500 to-emerald-600 text-base font-semibold hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Check className="h-5 w-5" />
              )}
              {submitting
                ? "Bezig met opslaan…"
                : allScored
                  ? "Scorecard opslaan & doorgaan"
                  : `Nog ${criteria.filter((c) => c.score == null).length} criterium te scoren`}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreScale({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number) => void;
}) {
  const labels: Record<number, string> = {
    1: "Onvoldoende",
    2: "Matig",
    3: "Voldoende",
    4: "Goed",
    5: "Uitstekend",
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5].map((n) => {
          const selected = value === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              aria-label={`Score ${n}: ${labels[n]}`}
              aria-pressed={selected}
              className={cn(
                "h-14 w-full rounded-2xl border-2 text-xl font-extrabold transition-all min-h-[56px]",
                selected
                  ? "border-indigo-600 bg-indigo-600 text-white shadow-md scale-[1.04]"
                  : "border-border bg-background text-zinc-700 hover:border-indigo-300 dark:text-zinc-300"
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      <p className="text-center text-xs font-medium text-muted-foreground">
        {value == null ? "Tik op een score" : `${value}/5 — ${labels[value]}`}
      </p>
    </div>
  );
}
