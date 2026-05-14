"use client";

import { Sparkles } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Visual marker placed next to any AI-generated value (match-percent, score,
 * explanation snippet). Surface-level enforcement of EU AI Act Art. 50
 * transparency: the user can hover or focus to see exactly what is generated
 * and that final judgement remains with the recruiter.
 */
export interface AIBadgeProps {
  /** Optional className override for the icon-wrapper (sizing, colour). */
  className?: string;
  /** Override the default disclosure tooltip text. */
  label?: string;
}

const DEFAULT_LABEL =
  "Door AI gegenereerd — recruiter behoudt het finale oordeel.";

export function AIBadge({ className, label = DEFAULT_LABEL }: AIBadgeProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-label={label}
            className={cn(
              "inline-flex items-center justify-center rounded-md",
              "bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400",
              "border border-purple-100 dark:border-purple-900/50",
              "h-5 w-5 shrink-0 cursor-help",
              "focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-offset-1",
              className
            )}
          >
            <Sparkles className="h-3 w-3" aria-hidden="true" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
