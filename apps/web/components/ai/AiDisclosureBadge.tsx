"use client";

import { Bot } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AI_DISCLOSURE } from "@/lib/aiDisclosure";
import { cn } from "@/lib/utils";

/**
 * Sprint Q4.5 — EU AI Act art. 13 transparency badge.
 *
 * Surfaces the standard disclosure string `AI_DISCLOSURE` on every page that
 * drives AI behaviour (sourcing agent, outreach drafts, reply classification,
 * sequence builder, signals).
 *
 * Variant `pill` is the default — sits next to the page title.
 * Variant `banner` is the bigger inline notice for top-of-page warnings.
 */
interface AiDisclosureBadgeProps {
  className?: string;
  variant?: "pill" | "banner";
}

export function AiDisclosureBadge({
  className,
  variant = "pill",
}: AiDisclosureBadgeProps) {
  if (variant === "banner") {
    return (
      <div
        className={cn(
          "flex items-start gap-2.5 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200",
          className
        )}
        role="note"
        aria-label="AI Act transparantie"
      >
        <Bot className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
        <p className="leading-relaxed">
          <span className="font-semibold">AI Act art. 13:</span> {AI_DISCLOSURE}
        </p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex h-6 cursor-help items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 text-[11px] font-medium text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300",
              className
            )}
            tabIndex={0}
            aria-label="AI ondersteund — meer info"
          >
            <Bot className="h-3 w-3" />
            AI ondersteund
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          {AI_DISCLOSURE}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
