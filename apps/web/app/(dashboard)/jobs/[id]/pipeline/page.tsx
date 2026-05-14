"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Users, Kanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/PageHeader";
import { KanbanBoard } from "@/components/pipeline/KanbanBoard";
import { useJob } from "@/hooks/useJobs";
import { usePipelineStages, useApplications } from "@/hooks/usePipeline";

export default function PipelinePage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.id as string;

  const { data: job, isLoading: jobLoading } = useJob(jobId);
  const { data: stages, isLoading: stagesLoading } =
    usePipelineStages(jobId);
  const { data: applications, isLoading: appsLoading } =
    useApplications(jobId);

  const isLoading = jobLoading || stagesLoading || appsLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="flex gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="w-72 space-y-3">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.back()}
        className="text-muted-foreground hover:text-foreground -ml-2"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Terug
      </Button>

      <PageHeader
        title={`Pipeline — ${job?.title ?? "..."}`}
        description={`${applications?.length ?? 0} actieve sollicitanten · ${stages?.length ?? 0} fasen`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/jobs/${jobId}`}>
                <Users className="mr-2 h-3.5 w-3.5" />
                Details
              </Link>
            </Button>
          </div>
        }
      />

      {/* Pipeline legend */}
      {stages && stages.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {stages.map((stage) => (
            <div key={stage.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: stage.color }}
              />
              {stage.name}
            </div>
          ))}
        </div>
      )}

      {/* Kanban board */}
      {stages && applications ? (
        <KanbanBoard
          stages={stages}
          applications={applications}
          jobId={jobId}
        />
      ) : (
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
      )}
    </div>
  );
}
