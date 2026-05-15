"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  Scorecard,
  ScorecardInput,
  ScorecardTemplate,
} from "@/lib/types/atsExtensions";

export function useScorecardsForApplication(applicationId: string | null) {
  return useQuery({
    queryKey: ["scorecards", applicationId],
    queryFn: async (): Promise<Scorecard[]> => {
      if (!applicationId) return [];
      const { data } = await api.get<{ data: Scorecard[] }>(
        `/applications/${applicationId}/scorecards`
      );
      return data.data;
    },
    enabled: !!applicationId,
  });
}

export function useScorecardTemplates(opts?: {
  jobId?: string | null;
  stageId?: string | null;
}) {
  return useQuery({
    queryKey: ["scorecard-templates", opts?.jobId ?? null, opts?.stageId ?? null],
    queryFn: async (): Promise<ScorecardTemplate[]> => {
      const { data } = await api.get<{ data: ScorecardTemplate[] }>(
        "/scorecards/templates",
        {
          params: {
            job_id: opts?.jobId ?? undefined,
            stage_id: opts?.stageId ?? undefined,
          },
        }
      );
      return data.data;
    },
  });
}

export function useCreateScorecard(applicationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ScorecardInput): Promise<Scorecard> => {
      const { data } = await api.post<Scorecard>(
        `/applications/${applicationId}/scorecards`,
        input
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scorecards", applicationId] });
    },
  });
}
