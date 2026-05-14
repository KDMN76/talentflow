"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
} from "react";
import { CandidateCard } from "./CandidateCard";
import type { HMReview } from "@/hooks/useHiringManager";
import { cn } from "@/lib/utils";

export type Decision = "approve" | "reject" | "later";

export interface SwipeDeckProps {
  candidates: HMReview[];
  onDecision: (candidateId: string, decision: Decision) => void;
  /** When set, renders an empty-state inside the deck area. */
  emptyState?: React.ReactNode;
}

export interface SwipeDeckHandle {
  /** Programmatically swipe the top card (used by HmActionButtons). */
  flick: (decision: Decision) => void;
}

const SWIPE_THRESHOLD = 100; // px before commit
const FLICK_DISTANCE = 800; // off-screen target

/**
 * Native pointer-events deck. Pragmatic: the task is one full-screen deck, so
 * an extra dnd-kit dependency is not worth its weight. We track the active
 * pointer-id, animate translate via inline style during drag, then commit by
 * setting a transition + extreme translate.
 *
 * Touch + mouse both supported through PointerEvents (covered by every
 * browser TalentFlow targets).
 */
export const SwipeDeck = forwardRef<SwipeDeckHandle, SwipeDeckProps>(
  function SwipeDeck({ candidates, onDecision, emptyState }, ref) {
    const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
    /** When set, the top card is animating off-screen. We delay onDecision
     * until the transition end so the next card slides in cleanly. */
    const [committing, setCommitting] = useState<{
      decision: Decision;
      target: { x: number; y: number };
    } | null>(null);

    const cardRef = useRef<HTMLDivElement | null>(null);
    const pointerIdRef = useRef<number | null>(null);
    const startRef = useRef<{ x: number; y: number; t: number } | null>(null);

    const top = candidates[0];
    const second = candidates[1];
    const third = candidates[2];

    const reset = useCallback(() => {
      setDrag(null);
      pointerIdRef.current = null;
      startRef.current = null;
    }, []);

    const commit = useCallback(
      (decision: Decision) => {
        if (!top || committing) return;
        const target =
          decision === "approve"
            ? { x: FLICK_DISTANCE, y: -120 }
            : decision === "reject"
              ? { x: -FLICK_DISTANCE, y: -60 }
              : { x: 0, y: -FLICK_DISTANCE };
        setCommitting({ decision, target });
      },
      [top, committing]
    );

    useImperativeHandle(ref, () => ({ flick: commit }), [commit]);

    // --- Pointer handlers ---------------------------------------------------

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (committing || !top) return;
      // Ignore right-clicks
      if (e.button !== undefined && e.button !== 0) return;
      pointerIdRef.current = e.pointerId;
      startRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
      setDrag({ x: 0, y: 0 });
      try {
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      } catch {
        /* ignore — older browsers */
      }
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (committing) return;
      if (pointerIdRef.current !== e.pointerId) return;
      const start = startRef.current;
      if (!start) return;
      setDrag({ x: e.clientX - start.x, y: e.clientY - start.y });
    };

    const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
      if (pointerIdRef.current !== e.pointerId) return;
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (committing) {
        reset();
        return;
      }
      const d = drag;
      reset();
      if (!d) return;
      // Decide direction by dominant axis once threshold passed.
      const absX = Math.abs(d.x);
      const absY = Math.abs(d.y);
      if (absX < SWIPE_THRESHOLD && absY < SWIPE_THRESHOLD) {
        return; // snap-back
      }
      if (absY > absX && d.y < 0) {
        commit("later"); // up = later
      } else if (d.x > 0) {
        commit("approve"); // right = approve
      } else {
        commit("reject"); // left = reject
      }
    };

    // After the commit-transition fires we propagate the decision.
    const onTopTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
      // Only react to the transform transition, not nested ones.
      if (e.propertyName !== "transform" || !committing || !top) return;
      const candidateId = top.application_id;
      const decision = committing.decision;
      setCommitting(null);
      onDecision(candidateId, decision);
    };

    // Reset committing state if the candidates list changes underneath us
    // (e.g. external invalidation finishes mid-animation).
    useEffect(() => {
      if (!top) {
        setCommitting(null);
        reset();
      }
    }, [top, reset]);

    if (!top) {
      return (
        <div className="flex min-h-[420px] w-full items-center justify-center px-4">
          {emptyState ?? (
            <p className="text-sm text-muted-foreground">Geen kandidaten.</p>
          )}
        </div>
      );
    }

    // --- Visual styles ------------------------------------------------------
    const tx = committing ? committing.target.x : drag?.x ?? 0;
    const ty = committing ? committing.target.y : drag?.y ?? 0;
    const rot = (tx / 20).toFixed(2); // gentle tilt while dragging

    const overlayOpacity = Math.min(1, Math.max(Math.abs(tx), Math.abs(ty)) / 160);
    const overlayColor =
      Math.abs(ty) > Math.abs(tx) && ty < 0
        ? "blue"
        : tx > 0
          ? "green"
          : tx < 0
            ? "red"
            : null;

    return (
      <div className="relative mx-auto w-full max-w-md select-none">
        <div className="relative h-[560px]">
          {/* Third card (deepest in stack) */}
          {third && (
            <div
              className="absolute inset-x-0 top-0 z-0 origin-top scale-[0.92] opacity-50 pointer-events-none"
              style={{ transform: "translateY(28px) scale(0.92)" }}
              aria-hidden
            >
              <CandidateCard candidate={third} dim />
            </div>
          )}

          {/* Second card */}
          {second && (
            <div
              className="absolute inset-x-0 top-0 z-10 origin-top scale-[0.96] opacity-80 pointer-events-none"
              style={{ transform: "translateY(14px) scale(0.96)" }}
              aria-hidden
            >
              <CandidateCard candidate={second} dim />
            </div>
          )}

          {/* Top card – draggable */}
          <div
            ref={cardRef}
            role="article"
            aria-label={`Kandidaat ${top.candidate_name}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onTransitionEnd={onTopTransitionEnd}
            className={cn(
              "absolute inset-x-0 top-0 z-20 touch-none cursor-grab active:cursor-grabbing",
              committing && "cursor-default"
            )}
            style={{
              transform: `translate(${tx}px, ${ty}px) rotate(${rot}deg)`,
              transition: committing
                ? "transform 320ms cubic-bezier(0.4, 0.0, 0.2, 1)"
                : drag
                  ? "none"
                  : "transform 220ms cubic-bezier(0.4, 0.0, 0.2, 1)",
              willChange: "transform",
            }}
          >
            <div className="relative">
              <CandidateCard candidate={top} />

              {/* Direction overlay */}
              {overlayColor && (
                <div
                  className={cn(
                    "pointer-events-none absolute inset-0 flex items-center justify-center rounded-3xl",
                    overlayColor === "green" &&
                      "bg-gradient-to-br from-emerald-400/40 to-emerald-600/50",
                    overlayColor === "red" &&
                      "bg-gradient-to-br from-rose-400/40 to-rose-600/50",
                    overlayColor === "blue" &&
                      "bg-gradient-to-br from-sky-400/40 to-sky-600/50"
                  )}
                  style={{ opacity: overlayOpacity }}
                  aria-hidden
                >
                  <span
                    className={cn(
                      "rounded-2xl border-4 px-4 py-2 text-2xl font-extrabold uppercase tracking-widest backdrop-blur-sm",
                      overlayColor === "green" && "border-emerald-600 text-emerald-700 bg-white/70",
                      overlayColor === "red" && "border-rose-600 text-rose-700 bg-white/70",
                      overlayColor === "blue" && "border-sky-600 text-sky-700 bg-white/70"
                    )}
                  >
                    {overlayColor === "green"
                      ? "Geschikt"
                      : overlayColor === "red"
                        ? "Afwijzen"
                        : "Later"}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
);
