import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  mockSimilarHiresByCandidate,
  mockSimilarHiresByJob,
  mockTalentFitModel,
  mockTalentFitPredictions,
} from "@/lib/mockData";
import type {
  SimilarHireDetail,
  TalentFitModelInfo,
  TalentFitPrediction,
} from "@/lib/types/matching";

/**
 * Hook contracts for the Talent Fit Model slice (Q3.3).
 *
 * Endpoints (owned by Agents YY + ZZ on the backend):
 *   GET  /api/matching/talent-fit/model
 *   POST /api/matching/talent-fit/train
 *   GET  /api/matching/talent-fit/predict?job_id&candidate_id
 *   GET  /api/matching/candidates/:candidateId/similar-hires?job_id=&limit=
 *   GET  /api/matching/jobs/:jobId/similar-hires?limit=
 *
 * Each hook follows the project-wide try/catch + mock-fallback convention so
 * the recruiter UI keeps rendering when the API is unavailable in dev.
 */

const TALENT_FIT_KEY = ["matching", "talent-fit"] as const;

// ─── Model status ──────────────────────────────────────────────────────────

export function useTalentFitModel() {
  return useQuery({
    queryKey: [...TALENT_FIT_KEY, "model"],
    queryFn: async (): Promise<TalentFitModelInfo> => {
      try {
        const { data } = await api.get<{ data: TalentFitModelInfo }>(
          "/matching/talent-fit/model"
        );
        return data.data;
      } catch {
        return mockTalentFitModel;
      }
    },
    // Status only changes on training events, so a 5-minute stale window is
    // fine. Settings page re-fetches on focus.
    staleTime: 5 * 60_000,
  });
}

// ─── Train model (admin) ───────────────────────────────────────────────────

interface TrainResult {
  model: TalentFitModelInfo;
}

export function useTrainTalentFit() {
  const queryClient = useQueryClient();
  return useMutation<TalentFitModelInfo, Error, void>({
    mutationFn: async () => {
      try {
        const { data } = await api.post<{ data: TrainResult }>(
          "/matching/talent-fit/train"
        );
        return data.data.model;
      } catch {
        // Synthetic "newly trained" mock: bump trained_on + flip metrics
        // marginally so the admin UI can demonstrate a re-train round-trip.
        const now = new Date().toISOString();
        const trainedOn = mockTalentFitModel.trained_on + 3;
        const refreshed: TalentFitModelInfo = {
          ...mockTalentFitModel,
          id: `tfm-mock-${Date.now()}`,
          trained_at: now,
          trained_on: trainedOn,
          hires: mockTalentFitModel.hires + 1,
          rejects: mockTalentFitModel.rejects + 2,
          precision_at_1: Math.min(
            0.95,
            mockTalentFitModel.precision_at_1 + 0.01
          ),
          recall_at_10: Math.min(0.95, mockTalentFitModel.recall_at_10 + 0.005),
          auc: Math.min(0.95, mockTalentFitModel.auc + 0.005),
          history: [
            ...(mockTalentFitModel.history ?? []),
            {
              trained_at: now,
              precision_at_1: Math.min(
                0.95,
                mockTalentFitModel.precision_at_1 + 0.01
              ),
              recall_at_10: Math.min(
                0.95,
                mockTalentFitModel.recall_at_10 + 0.005
              ),
              auc: Math.min(0.95, mockTalentFitModel.auc + 0.005),
              trained_on: trainedOn,
            },
          ],
        };
        return refreshed;
      }
    },
    onSuccess: (model) => {
      queryClient.setQueryData([...TALENT_FIT_KEY, "model"], model);
      // Recompute matches: the new model affects fit_score on every list.
      queryClient.invalidateQueries({ queryKey: ["matching", "job"] });
      queryClient.invalidateQueries({ queryKey: ["matching", "candidate"] });
    },
  });
}

// ─── Per-pair Talent Fit prediction ────────────────────────────────────────

export function useTalentFitPrediction(
  jobId: string | null,
  candidateId: string | null
) {
  return useQuery({
    queryKey: [...TALENT_FIT_KEY, "predict", jobId, candidateId],
    queryFn: async (): Promise<TalentFitPrediction | null> => {
      if (!jobId || !candidateId) return null;
      try {
        const { data } = await api.get<{ data: TalentFitPrediction }>(
          `/matching/talent-fit/predict`,
          { params: { job_id: jobId, candidate_id: candidateId } }
        );
        return data.data;
      } catch {
        return mockTalentFitPredictions[`${jobId}:${candidateId}`] ?? null;
      }
    },
    enabled: !!jobId && !!candidateId,
    staleTime: 60_000,
  });
}

// ─── Similar past hires (candidate-scoped) ─────────────────────────────────

export function useSimilarHires(
  candidateId: string | null,
  jobId?: string | null,
  limit = 5
) {
  return useQuery({
    queryKey: [
      ...TALENT_FIT_KEY,
      "similar-hires",
      "candidate",
      candidateId,
      jobId ?? null,
      limit,
    ],
    queryFn: async (): Promise<SimilarHireDetail[]> => {
      if (!candidateId) return [];
      try {
        const { data } = await api.get<{ data: SimilarHireDetail[] }>(
          `/matching/candidates/${candidateId}/similar-hires`,
          { params: { job_id: jobId ?? undefined, limit } }
        );
        return data.data;
      } catch {
        const all = mockSimilarHiresByCandidate[candidateId] ?? [];
        return all.slice(0, limit);
      }
    },
    enabled: !!candidateId,
    staleTime: 60_000,
  });
}

// ─── Similar past hires (job-scoped) ───────────────────────────────────────

export function useSimilarHiresForJob(jobId: string | null, limit = 5) {
  return useQuery({
    queryKey: [...TALENT_FIT_KEY, "similar-hires", "job", jobId, limit],
    queryFn: async (): Promise<SimilarHireDetail[]> => {
      if (!jobId) return [];
      try {
        const { data } = await api.get<{ data: SimilarHireDetail[] }>(
          `/matching/jobs/${jobId}/similar-hires`,
          { params: { limit } }
        );
        return data.data;
      } catch {
        const all = mockSimilarHiresByJob[jobId] ?? [];
        return all.slice(0, limit);
      }
    },
    enabled: !!jobId,
    staleTime: 60_000,
  });
}
