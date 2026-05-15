"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
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
 */

const TALENT_FIT_KEY = ["matching", "talent-fit"] as const;

// ─── Model status ──────────────────────────────────────────────────────────

export function useTalentFitModel() {
  return useQuery({
    queryKey: [...TALENT_FIT_KEY, "model"],
    queryFn: async (): Promise<TalentFitModelInfo> => {
      const { data } = await api.get<{ data: TalentFitModelInfo }>(
        "/matching/talent-fit/model"
      );
      return data.data;
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
      const { data } = await api.post<{ data: TrainResult }>(
        "/matching/talent-fit/train"
      );
      return data.data.model;
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
      const { data } = await api.get<{ data: TalentFitPrediction }>(
        `/matching/talent-fit/predict`,
        { params: { job_id: jobId, candidate_id: candidateId } }
      );
      return data.data;
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
      const { data } = await api.get<{ data: SimilarHireDetail[] }>(
        `/matching/candidates/${candidateId}/similar-hires`,
        { params: { job_id: jobId ?? undefined, limit } }
      );
      return data.data;
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
      const { data } = await api.get<{ data: SimilarHireDetail[] }>(
        `/matching/jobs/${jobId}/similar-hires`,
        { params: { limit } }
      );
      return data.data;
    },
    enabled: !!jobId,
    staleTime: 60_000,
  });
}
