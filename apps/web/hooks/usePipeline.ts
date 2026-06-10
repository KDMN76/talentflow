"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PipelineStage, Application } from "@/lib/mockData";

export function usePipelineStages(jobId: string) {
  return useQuery({
    queryKey: ["pipeline", "stages", jobId],
    queryFn: async (): Promise<PipelineStage[]> => {
      // De API wikkelt de lijst in `{ data: [...] }`. Eerder retourneerde deze
      // hook het hele object, waardoor `stages` geen array was: de guard
      // `stages.length === 0` (undefined !== 0) liet het door en `stages.map`
      // crashte de vacature-detailpagina (JobPipelineTab) en de pipeline-pagina.
      const { data } = await api.get<{ data: PipelineStage[] }>(
        `/pipeline/jobs/${jobId}/stages`
      );
      return data.data;
    },
    enabled: !!jobId,
  });
}

export function useApplications(jobId: string) {
  return useQuery({
    queryKey: ["pipeline", "applications", jobId],
    queryFn: async () => {
      const { data } = await api.get<{
        stages: Array<{ stage: PipelineStage; applications: Application[] }>;
        unassigned: Application[];
      }>(`/pipeline/jobs/${jobId}/applications`);
      const flat: Application[] = [];
      for (const group of data.stages) flat.push(...group.applications);
      flat.push(...data.unassigned);
      return flat;
    },
    enabled: !!jobId,
  });
}

export function useMoveApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ applicationId, stageId }: { applicationId: string; stageId: string; jobId: string }) => {
      const { data } = await api.patch<Application>(`/pipeline/applications/${applicationId}`, { stage_id: stageId });
      return data;
    },
    onMutate: async ({ applicationId, stageId, jobId }) => {
      await queryClient.cancelQueries({ queryKey: ["pipeline", "applications", jobId] });
      const previousApplications = queryClient.getQueryData<Application[]>(["pipeline", "applications", jobId]);
      queryClient.setQueryData<Application[]>(
        ["pipeline", "applications", jobId],
        (old) => old?.map((app) => app.id === applicationId ? { ...app, stage_id: stageId } : app) ?? []
      );
      return { previousApplications };
    },
    onError: (_, variables, context) => {
      if (context?.previousApplications) {
        queryClient.setQueryData(["pipeline", "applications", variables.jobId], context.previousApplications);
      }
    },
    onSettled: (_, __, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline", "applications", variables.jobId] });
    },
  });
}
