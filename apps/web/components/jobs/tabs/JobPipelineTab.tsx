"use client";

import { Kanban } from "lucide-react";
import { KanbanBoard } from "@/components/pipeline/KanbanBoard";
import { Skeleton } from "@/components/ui/skeleton";
import { useApplications, usePipelineStages } from "@/hooks/usePipeline";

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

  return (
    <div className="space-y-4">
      <KanbanBoard
        stages={stages}
        applications={applications ?? []}
        jobId={jobId}
      />
    </div>
  );
}
