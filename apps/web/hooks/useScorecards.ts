"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { mockScorecards, mockScorecardTemplates } from "@/lib/mockData";
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
      try {
        const { data } = await api.get<{ data: Scorecard[] }>(
          `/applications/${applicationId}/scorecards`
        );
        return data.data;
      } catch {
        return [...(mockScorecards[applicationId] ?? [])];
      }
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
      try {
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
      } catch {
        // Filter mock by job_id/stage_id when present, otherwise return all.
        return mockScorecardTemplates.filter((t) => {
          if (opts?.jobId && t.job_id && t.job_id !== opts.jobId) return false;
          if (opts?.stageId && t.stage_id && t.stage_id !== opts.stageId) return false;
          return true;
        });
      }
    },
  });
}

export function useCreateScorecard(applicationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ScorecardInput): Promise<Scorecard> => {
      try {
        const { data } = await api.post<Scorecard>(
          `/applications/${applicationId}/scorecards`,
          input
        );
        return data;
      } catch {
        const now = new Date().toISOString();
        const newRow: Scorecard = {
          id: `sc-${Date.now()}`,
          tenant_id: "tenant-1",
          application_id: applicationId,
          template_id: input.template_id ?? null,
          user_id: "user-1",
          user_name: "Kaan Duman",
          interview_date: now,
          criteria: input.criteria,
          overall_score: input.overall_score,
          recommendation: input.recommendation,
          notes: input.notes ?? null,
          created_at: now,
          updated_at: now,
        };
        if (!mockScorecards[applicationId]) mockScorecards[applicationId] = [];
        mockScorecards[applicationId].unshift(newRow);
        return newRow;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scorecards", applicationId] });
    },
  });
}
