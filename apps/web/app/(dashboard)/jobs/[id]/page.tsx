"use client";

import { useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, MoreHorizontal, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { JobDetailHeader } from "@/components/jobs/JobDetailHeader";
import { SaveAsTemplateButton } from "@/components/jobs/SaveAsTemplateButton";
import { JobAISuiteTab } from "@/components/jobs/tabs/JobAISuiteTab";
import { JobActiviteitTab } from "@/components/jobs/tabs/JobActiviteitTab";
import { JobOverzichtTab } from "@/components/jobs/tabs/JobOverzichtTab";
import { JobPerformanceTab } from "@/components/jobs/tabs/JobPerformanceTab";
import { JobPipelineTab } from "@/components/jobs/tabs/JobPipelineTab";
import { JobTeamTab } from "@/components/jobs/tabs/JobTeamTab";
import { JobDistributionTab } from "@/components/jobs/tabs/JobDistributionTab";
import { useJob } from "@/hooks/useJobs";
import { useDuplicateJob } from "@/hooks/useJobTemplates";
import { useToast } from "@/components/ui/use-toast";
import {
  useJobAttachments,
  useJobFunnel,
  useJobHealth,
  useJobNotes,
  useJobTeam,
} from "@/hooks/useJobDetail";

const VALID_TABS = [
  "pipeline",
  "overzicht",
  "ai-suite",
  "team",
  "activiteit",
  "performance",
  "distributie",
] as const;
type TabValue = (typeof VALID_TABS)[number];

function isValidTab(value: string | null): value is TabValue {
  return value !== null && (VALID_TABS as readonly string[]).includes(value);
}

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = params.id;

  const initialTab = isValidTab(searchParams.get("tab"))
    ? (searchParams.get("tab") as TabValue)
    : "pipeline";
  const [tab, setTab] = useState<TabValue>(initialTab);

  const { toast } = useToast();
  const duplicateJob = useDuplicateJob();

  const { data: job, isLoading: jobLoading } = useJob(jobId);
  const { data: health, isLoading: healthLoading } = useJobHealth(jobId);
  const { data: funnel, isLoading: funnelLoading } = useJobFunnel(jobId);
  const { data: team } = useJobTeam(jobId);
  const { data: notes } = useJobNotes(jobId);
  const { data: attachments } = useJobAttachments(jobId);

  const handleTabChange = (next: string) => {
    if (!isValidTab(next)) return;
    setTab(next);
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("tab", next);
    router.replace(`/jobs/${jobId}?${sp.toString()}`, { scroll: false });
  };

  if (jobLoading || !job) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-10 w-full max-w-2xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  const teamCount = team?.length ?? 0;
  const activityCount = (notes?.length ?? 0) + (attachments?.length ?? 0);
  // Sub-fase 2C: JobDetail bevat geen application_count (alleen per-stage
  // counts via funnel / stages). Fallback: som van stage-counts, of 0.
  const pipelineCount =
    funnel?.total ??
    job.stages.reduce((sum, s) => sum + s.application_count, 0);

  const handleDuplicate = async () => {
    try {
      const newJob = await duplicateJob.mutateAsync({ jobId });
      toast({
        title: "Vacature gedupliceerd",
        description: `"${newJob.title}" aangemaakt als concept.`,
      });
      router.push(`/jobs/${newJob.id}`);
    } catch {
      toast({
        variant: "destructive",
        title: "Fout",
        description: "Kon vacature niet dupliceren.",
      });
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/jobs")}
          className="-ml-2"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Terug naar vacatures
        </Button>

        <div className="flex items-center gap-2">
          <SaveAsTemplateButton job={job} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 w-9 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={handleDuplicate}
                disabled={duplicateJob.isPending}
                className="cursor-pointer"
              >
                {duplicateJob.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                Dupliceren
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <JobDetailHeader
        job={job}
        health={health}
        funnel={funnel}
        isHealthLoading={healthLoading}
        isFunnelLoading={funnelLoading}
      />

      <Tabs value={tab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="w-full overflow-x-auto justify-start gap-1">
          <TabsTrigger value="pipeline">
            Pipeline
            {pipelineCount > 0 && (
              <span className="ml-1.5 rounded-full bg-zinc-100 px-1.5 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">
                {pipelineCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="overzicht">Overzicht</TabsTrigger>
          <TabsTrigger value="ai-suite">AI Suite</TabsTrigger>
          <TabsTrigger value="team">
            Team
            {teamCount > 0 && (
              <span className="ml-1.5 rounded-full bg-zinc-100 px-1.5 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">
                {teamCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="activiteit">
            Activiteit
            {activityCount > 0 && (
              <span className="ml-1.5 rounded-full bg-zinc-100 px-1.5 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">
                {activityCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="distributie">Distributie</TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline" className="space-y-4">
          <JobPipelineTab jobId={jobId} />
        </TabsContent>
        <TabsContent value="overzicht" className="space-y-4">
          <JobOverzichtTab job={job} />
        </TabsContent>
        <TabsContent value="ai-suite" className="space-y-4">
          <JobAISuiteTab jobId={jobId} jobTitle={job.title} />
        </TabsContent>
        <TabsContent value="team" className="space-y-4">
          <JobTeamTab jobId={jobId} />
        </TabsContent>
        <TabsContent value="activiteit" className="space-y-4">
          <JobActiviteitTab jobId={jobId} />
        </TabsContent>
        <TabsContent value="performance" className="space-y-4">
          <JobPerformanceTab jobId={jobId} />
        </TabsContent>
        <TabsContent value="distributie" className="space-y-4">
          <JobDistributionTab jobId={jobId} jobTitle={job.title} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
