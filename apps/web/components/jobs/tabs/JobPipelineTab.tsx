"use client";

import { ChevronRight, Kanban } from "lucide-react";
import { KanbanBoard } from "@/components/pipeline/KanbanBoard";
import { Skeleton } from "@/components/ui/skeleton";
import { useApplications, usePipelineStages } from "@/hooks/usePipeline";
import { useJobFunnel } from "@/hooks/useJobDetail";
import { cn } from "@/lib/utils";

/**
 * Pipeline tab — kanban board + inline stage-conversion badges.
 *
 * Composition strategy: instead of duplicating the kanban-rendering logic from
 * the original `/jobs/[id]/pipeline/page.tsx`, we mount the existing
 * `<KanbanBoard>` and overlay conversion-rate chevrons in a separate row above
 * it. This keeps the dnd-kit logic in a single canonical location.
 */
export function JobPipelineTab({ jobId }: { jobId: string }) {
  const { data: stages, isLoading: stagesLoading } = usePipelineStages(jobId);
  const { data: applications, isLoading: appsLoading } = useApplications(jobId);
  const { data: funnel } = useJobFunnel(jobId);

  const isLoading = stagesLoading || appsLoading;

  if (isLoading) {
    return (
      <div className="flex gap-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="w-72 space-y-3">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
        ))}
      </div>
    );
  }

  if (!stages || stages.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-center">
        <div>
          <Kanban className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Geen pipeline ingesteld
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Voeg fasen toe aan deze vacature om te beginnen.
          </p>
        </div>
      </div>
    );
  }

  // Build a stage-id → conversion-pct map for the chevron badges.
  const conversionByStage = new Map<string, number | null>(
    (funnel?.stages ?? []).map((s) => [s.stage_id, s.conversion_to_next_pct])
  );

  return (
    <div className="space-y-4">
      {/* Stage conversion badges — aligned over the kanban columns. */}
      <div className="flex gap-5 overflow-x-auto pb-2">
        {stages.map((stage, i) => {
          const conv = conversionByStage.get(stage.id);
          const isLast = i === stages.length - 1;
          return (
            <div key={`conv-${stage.id}`} className="w-72 shrink-0 flex items-center gap-3">
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ background: stage.color }}
                />
                <span className="text-xs font-medium text-muted-foreground truncate">
                  {stage.name}
                </span>
              </div>
              {!isLast && conv != null && (
                <div className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground shrink-0">
                  <ChevronRight className="h-3 w-3" />
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5",
                      conv >= 70
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : conv >= 40
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                    )}
                  >
                    {conv}%
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <KanbanBoard
        stages={stages}
        applications={applications ?? []}
        jobId={jobId}
      />
    </div>
  );
}
