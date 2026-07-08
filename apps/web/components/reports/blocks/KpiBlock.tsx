"use client";

import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KpiBlock as KpiBlockConfig, KpiResult } from "@/lib/types/reports";

export interface KpiBlockProps {
  title?: string;
  config: KpiBlockConfig;
  result?: KpiResult;
  /** When true, this is being rendered "live" inside a builder canvas without
   * a result yet. We show a placeholder instead. */
  placeholder?: boolean;
}

function formatValue(value: number, unit?: string): string {
  if (unit === "days") return `${Math.round(value)} dgn`;
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (unit === "EUR")
    return new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(value);
  return new Intl.NumberFormat("nl-NL").format(Math.round(value));
}

export function KpiBlock({ title, config, result, placeholder }: KpiBlockProps) {
  const value = result?.value ?? 0;
  const unit = result?.metric_unit;
  const change = result?.comparison_delta_pct ?? null;
  const compare = result?.comparison_value ?? null;
  const label = title || result?.metric_label || config.metric.label;

  const trend: "up" | "down" | "flat" =
    change === null || Math.abs(change) < 0.1
      ? "flat"
      : change > 0
      ? "up"
      : "down";

  // For "lower-is-better" metrics (time-to-hire), invert color logic.
  const lowerIsBetter = unit === "days";
  const isPositive =
    trend === "flat"
      ? false
      : lowerIsBetter
      ? trend === "down"
      : trend === "up";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      {label && (
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      )}
      {placeholder || !result ? (
        <p className="text-3xl font-bold text-zinc-300 dark:text-zinc-700">—</p>
      ) : (
        <p className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          {formatValue(value, unit)}
        </p>
      )}
      {!placeholder && result && change !== null && compare !== null && (
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
              trend === "flat"
                ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                : isPositive
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400"
            )}
          >
            {trend === "up" ? (
              <ArrowUp className="h-3 w-3" />
            ) : trend === "down" ? (
              <ArrowDown className="h-3 w-3" />
            ) : (
              <Minus className="h-3 w-3" />
            )}
            {Math.abs(change).toFixed(1)}%
          </span>
          <span className="text-xs text-muted-foreground">
            vs. {formatValue(compare, unit)} (vorig)
          </span>
        </div>
      )}
    </div>
  );
}
