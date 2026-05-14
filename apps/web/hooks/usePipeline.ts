"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { mockStages, mockApplications, type PipelineStage, type Application } from "@/lib/mockData";

export function usePipelineStages(jobId: string) {
  return useQuery({
    queryKey: ["pipeline", "stages", jobId],
    queryFn: async () => {
      try {
        const { data } = await api.get<PipelineStage[]>(`/pipeline/jobs/${jobId}/stages`);
        return data;
      } catch {
        return mockStages.filter((s) => s.job_id === jobId).sort((a, b) => a.position - b.position);
      }
    },
    enabled: !!jobId,
  });
}

export function useApplications(jobId: string) {
  return useQuery({
    queryKey: ["pipeline", "applications", jobId],
    queryFn: async () => {
      try {
        const { data } = await api.get<{
          stages: Array<{ stage: PipelineStage; applications: Application[] }>;
          unassigned: Application[];
        }>(`/pipeline/jobs/${jobId}/applications`);
        const flat: Application[] = [];
        for (const group of data.stages) flat.push(...group.applications);
        flat.push(...data.unassigned);
        return flat;
      } catch {
        return mockApplications.filter((a) => a.job_id === jobId);
      }
    },
    enabled: !!jobId,
  });
}

export function useMoveApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ applicationId, stageId }: { applicationId: string; stageId: string; jobId: string }) => {
      try {
        const { data } = await api.patch<Application>(`/pipeline/applications/${applicationId}`, { stage_id: stageId });
        return data;
      } catch {
        const idx = mockApplications.findIndex((a) => a.id === applicationId);
        if (idx !== -1) {
          mockApplications[idx] = { ...mockApplications[idx], stage_id: stageId };
          return mockApplications[idx];
        }
        throw new Error("Sollicitatie niet gevonden");
      }
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
