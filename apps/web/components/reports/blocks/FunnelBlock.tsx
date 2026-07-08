"use client";

import { cn } from "@/lib/utils";
import type { FunnelBlock as FunnelBlockConfig, FunnelResult } from "@/lib/types/reports";

export interface FunnelBlockProps {
  title?: string;
  config: FunnelBlockConfig;
  result?: FunnelResult;
  placeholder?: boolean;
}

/**
 * Vertical funnel — each stage is a horizontal bar whose width is proportional
 * to the count relative to the first stage. Step-conversion (vs. previous
 * stage) appears between bars; the backend's conversion_pct is relative to the
 * FIRST stage and is shown as the overall number at the bottom.
 */
export function FunnelBlock({ title, config, result, placeholder }: FunnelBlockProps) {
  const renderStages = result?.stages ?? [];
  const max = renderStages[0]?.count || 1;
  const lastStage = renderStages[renderStages.length - 1];
  const overallPct =
    lastStage && renderStages[0] && renderStages[0].count > 0
      ? (lastStage.count / renderStages[0].count) * 100
      : null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      {title && (
        <p className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </p>
      )}
      {placeholder || !result ? (
        <div className="space-y-2">
          {(config.stages ?? ["Stage 1", "Stage 2", "Stage 3"]).map((s, i) => (
            <div
              key={i}
              className="flex h-9 items-center rounded-md bg-zinc-100 px-3 text-xs text-muted-foreground dark:bg-zinc-800"
              style={{ width: `${100 - i * 12}%` }}
            >
              {s}
            </div>
          ))}
        </div>
      ) : renderStages.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          Geen data in de gekozen periode
        </div>
      ) : (
        <div className="space-y-1">
          {renderStages.map((stage, i) => {
            const pct = (stage.count / max) * 100;
            const prev = i > 0 ? renderStages[i - 1] : null;
            const stepConversion =
              prev && prev.count > 0 ? stage.count / prev.count : null;
            return (
              <div key={i}>
                {i > 0 && stepConversion !== null && (
                  <div className="flex justify-center py-1">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        stepConversion >= 0.5
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                          : stepConversion >= 0.2
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
                          : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400"
                      )}
                    >
                      ↓ {(stepConversion * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div
                    className="relative h-10 rounded-md bg-gradient-to-r from-indigo-500 to-purple-500"
                    style={{ width: `${pct}%`, minWidth: "120px" }}
                  >
                    <span className="absolute inset-0 flex items-center px-3 text-sm font-medium text-white">
                      {stage.stage}
                    </span>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {new Intl.NumberFormat("nl-NL").format(stage.count)}
                  </span>
                </div>
              </div>
            );
          })}
          {overallPct !== null && (
            <div className="mt-4 border-t border-zinc-100 pt-3 text-xs text-muted-foreground dark:border-zinc-800">
              Totale conversie:{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {overallPct.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
