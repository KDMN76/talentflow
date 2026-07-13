"use client";

import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface HelpHintProps {
  /** Help text shown in the tooltip. */
  text: string;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  ariaLabel?: string;
  /**
   * Optionele klik-actie. Wanneer gezet wordt het (?)-icoon een echt klikdoel
   * (cursor-pointer) dat deze handler aanroept — gebruik dit als de tooltip-
   * tekst "klik voor …" belooft. Zonder deze prop blijft het gedrag hover-only
   * (backwards-compatible met alle bestaande gebruiksplekken).
   */
  onClick?: () => void;
}

/**
 * Small "(?)" help icon with a tooltip. Self-contained (includes its own
 * TooltipProvider, matching the codebase pattern where no root provider exists).
 * Use next to a label/heading: <HelpHint text="..." />.
 */
export function HelpHint({
  text,
  side = "top",
  className,
  ariaLabel,
  onClick,
}: HelpHintProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={ariaLabel ?? text}
            onClick={(e) => {
              if (onClick) {
                e.preventDefault();
                onClick();
              } else {
                e.preventDefault();
              }
            }}
            className={cn(
              "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              onClick ? "cursor-pointer" : "cursor-help",
              className
            )}
          >
            <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-xs text-xs leading-snug">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
