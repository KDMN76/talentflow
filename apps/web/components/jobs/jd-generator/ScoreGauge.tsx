"use client";

import { cn } from "@/lib/utils";

/**
 * Compact circular gauge for clarity / inclusivity scores in the variant
 * comparison view. Identical visual language as `JobAISuiteTab` but smaller
 * (60×60) so three of them fit side-by-side per variant column.
 */
export interface ScoreGaugeProps {
  label: string;
  value: number;
  /** Override default size (px). */
  size?: number;
}

export function ScoreGauge({ label, value, size = 60 }: ScoreGaugeProps) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = c - (clamped / 100) * c;

  const tone =
    value >= 70
      ? "text-emerald-600 dark:text-emerald-400"
      : value >= 40
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";
  const ring =
    value >= 70
      ? "stroke-emerald-500"
      : value >= 40
      ? "stroke-amber-500"
      : "stroke-red-500";

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          className="-rotate-90"
          aria-hidden="true"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            className="fill-none stroke-zinc-200 dark:stroke-zinc-700"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            className={cn("fill-none transition-[stroke-dashoffset]", ring)}
          />
        </svg>
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center text-sm font-bold",
            tone
          )}
        >
          {Math.round(clamped)}
        </div>
      </div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
