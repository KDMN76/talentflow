"use client";

/**
 * Sprint Q4.6 — WhatsApp Business quality-rating badge.
 *
 * Meta assigns each WABA number a green/yellow/red rating based on user feedback
 * (block-rate, complaints). Red rating → reduced messaging-limit; yellow →
 * warning. The tooltip explains why this matters.
 */

import { useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Rating = "green" | "yellow" | "red" | "unknown";

const RATING_THEME: Record<
  Rating,
  { label: string; dotClass: string; pillClass: string; description: string }
> = {
  green: {
    label: "Goede kwaliteit",
    dotClass: "bg-emerald-500 ring-emerald-200 dark:ring-emerald-900/50",
    pillClass:
      "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:ring-emerald-900/40",
    description:
      "Lage block-rate en weinig klachten. Je messaging-limiet kan opgeschaald worden naar 100K conversaties / 24h.",
  },
  yellow: {
    label: "Aandachtspunt",
    dotClass: "bg-amber-500 ring-amber-200 dark:ring-amber-900/50",
    pillClass:
      "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:ring-amber-900/40",
    description:
      "Verhoogde block-rate of klachten. Reduceer marketing-templates, verbeter targeting en wacht 7 dagen — Meta evalueert continu.",
  },
  red: {
    label: "Slechte kwaliteit",
    dotClass: "bg-red-500 ring-red-200 dark:ring-red-900/50",
    pillClass:
      "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/30 dark:text-red-400 dark:ring-red-900/40",
    description:
      "Hoge block-rate. Je messaging-limiet wordt verlaagd. Stop alle marketing tijdelijk en focus alleen op utility / authentication templates.",
  },
  unknown: {
    label: "Onbekend",
    dotClass: "bg-zinc-400 ring-zinc-200 dark:ring-zinc-700",
    pillClass:
      "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
    description:
      "Nog niet genoeg data — Meta heeft minstens ~1.000 berichten nodig om een rating toe te kennen.",
  },
};

export function QualityRatingBadge({
  rating,
  showLabel = true,
}: {
  rating: Rating;
  showLabel?: boolean;
}) {
  const t = RATING_THEME[rating];
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex items-center gap-1.5">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
          t.pillClass
        )}
      >
        <span
          className={cn(
            "inline-block h-2 w-2 rounded-full ring-2 ring-inset",
            t.dotClass
          )}
        />
        {showLabel && t.label}
      </span>
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((x) => !x)}
        className="rounded-full text-muted-foreground hover:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:hover:text-zinc-300"
        aria-label="Uitleg kwaliteits­rating"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute left-0 top-full z-30 mt-1.5 w-72 rounded-lg border border-border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-lg"
        >
          <p className="font-semibold text-zinc-900 dark:text-zinc-100">
            {t.label}
          </p>
          <p className="mt-1 text-muted-foreground">{t.description}</p>
        </div>
      )}
    </div>
  );
}

export function QualityRatingDot({
  rating,
  className,
}: {
  rating: Rating;
  className?: string;
}) {
  const t = RATING_THEME[rating];
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full ring-2 ring-inset",
        t.dotClass,
        className
      )}
      title={t.label}
      aria-label={t.label}
    />
  );
}
