"use client";

import { Check, X, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Decision } from "./SwipeDeck";

interface HmActionButtonsProps {
  onAction: (decision: Decision) => void;
  disabled?: boolean;
}

/**
 * Three big tap-targets (64px) directly under the deck. Designed to be
 * thumb-reachable on mobile — primary action (approve) is on the right since
 * most users are right-handed, mirroring swipe-direction.
 */
export function HmActionButtons({ onAction, disabled }: HmActionButtonsProps) {
  return (
    <div className="flex items-center justify-center gap-6 py-2">
      <ActionButton
        kind="reject"
        label="Afwijzen"
        Icon={X}
        onClick={() => onAction("reject")}
        disabled={disabled}
      />
      <ActionButton
        kind="later"
        label="Later"
        Icon={Clock}
        onClick={() => onAction("later")}
        disabled={disabled}
      />
      <ActionButton
        kind="approve"
        label="Geschikt"
        Icon={Check}
        onClick={() => onAction("approve")}
        disabled={disabled}
      />
    </div>
  );
}

function ActionButton({
  kind,
  label,
  Icon,
  onClick,
  disabled,
}: {
  kind: "reject" | "later" | "approve";
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
}) {
  const tone =
    kind === "reject"
      ? "bg-white text-rose-600 ring-2 ring-rose-200 hover:bg-rose-50 active:bg-rose-100 dark:bg-zinc-900 dark:ring-rose-900 dark:hover:bg-rose-950/50"
      : kind === "approve"
        ? "bg-white text-emerald-600 ring-2 ring-emerald-200 hover:bg-emerald-50 active:bg-emerald-100 dark:bg-zinc-900 dark:ring-emerald-900 dark:hover:bg-emerald-950/50"
        : "bg-white text-sky-600 ring-2 ring-sky-200 hover:bg-sky-50 active:bg-sky-100 dark:bg-zinc-900 dark:ring-sky-900 dark:hover:bg-sky-950/50";

  const size = kind === "later" ? "h-14 w-14" : "h-16 w-16";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "group flex flex-col items-center gap-1 disabled:opacity-50",
        "min-h-[48px]"
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-full shadow-lg transition-transform group-active:scale-95",
          size,
          tone
        )}
      >
        <Icon
          className={cn(
            kind === "later" ? "h-6 w-6" : "h-7 w-7",
            "stroke-[2.5]"
          )}
        />
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </button>
  );
}
