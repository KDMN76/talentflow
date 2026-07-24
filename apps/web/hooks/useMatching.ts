"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  CandidateMatch,
  JobMatch,
  MatchExplanationResponse,
} from "@/lib/types/matching";

/**
 * Hook contracts for the AI matching slice (Slice 4).
 *
 * Endpoints (owned by Agents P + Q on the backend):
 *   GET    /api/matching/jobs/:jobId
 *   GET    /api/matching/candidates/:candidateId
 *   POST   /api/matching/jobs/:jobId/candidates/:candidateId/explanation
 */

// ─── Top-N kandidaten voor een vacature ─────────────────────────────────────

export function useJobMatches(jobId: string) {
  return useQuery({
    queryKey: ["matching", "job", jobId],
    queryFn: async (): Promise<JobMatch[]> => {
      const { data } = await api.get<{ data: JobMatch[] }>(
        `/matching/jobs/${jobId}`
      );
      return data.data;
    },
    enabled: !!jobId,
    // Match scores are recomputed server-side on candidate/job mutation, so a
    // 60s stale window is plenty for the recruiter UI.
    staleTime: 60_000,
  });
}

// ─── Top-N vacatures voor een kandidaat ─────────────────────────────────────

export function useCandidateMatches(candidateId: string) {
  return useQuery({
    queryKey: ["matching", "candidate", candidateId],
    queryFn: async (): Promise<CandidateMatch[]> => {
      const { data } = await api.get<{ data: CandidateMatch[] }>(
        `/matching/candidates/${candidateId}`
      );
      return data.data;
    },
    enabled: !!candidateId,
    staleTime: 60_000,
  });
}

// ─── AI-uitleg per (job, candidate) paar ────────────────────────────────────

interface ExplanationVars {
  jobId: string;
  candidateId: string;
}

/**
 * Mutation: trigger an AI-uitleg generatie voor een specifieke match. The
 * backend returns either a freshly generated or cached explanation; both come
 * back in the same shape (`cached: boolean` flag distinguishes them).
 *
 * UI-side: the dialog calls `mutate()` on first open and renders a skeleton
 * while pending.
 */
export function useGenerateMatchExplanation() {
  const queryClient = useQueryClient();
  return useMutation<MatchExplanationResponse, Error, ExplanationVars>({
    mutationFn: async ({ jobId, candidateId }) => {
      // Deze endpoint geeft de uitleg PLAT terug ({ explanation, strengths,
      // gaps, ... }) — geen { data: ... }-envelope (geverifieerd tegen
      // matching.controller.ts + het gedeelde MatchExplanationResponse-type).
      // Eerder stond hier `data.data`, wat undefined opleverde → het
      // "Waarom?"-paneel bleef leeg zonder foutmelding.
      const { data } = await api.post<MatchExplanationResponse>(
        `/matching/jobs/${jobId}/candidates/${candidateId}/explanation`
      );
      return data;
    },
    onSuccess: (_data, vars) => {
      // No list-level invalidation needed: explanation is per-pair and the
      // list query already shows ai_explanation snippets independently.
      queryClient.setQueryData(
        ["matching", "explanation", vars.jobId, vars.candidateId],
        _data
      );
    },
  });
}
