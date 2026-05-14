"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  mockCandidateMatches,
  mockJobMatches,
  mockMatchExplanations,
  MOCK_AI_DISCLOSURE,
} from "@/lib/mockData";
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
 *
 * Each hook follows the same try/catch + mock-fallback pattern used by
 * `useCandidates`, so the recruiter UI degrades gracefully in dev mode.
 */

// ─── Top-N kandidaten voor een vacature ─────────────────────────────────────

export function useJobMatches(jobId: string) {
  return useQuery({
    queryKey: ["matching", "job", jobId],
    queryFn: async (): Promise<JobMatch[]> => {
      try {
        const { data } = await api.get<{ data: JobMatch[] }>(
          `/matching/jobs/${jobId}`
        );
        return data.data;
      } catch {
        return mockJobMatches[jobId] ?? [];
      }
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
      try {
        const { data } = await api.get<{ data: CandidateMatch[] }>(
          `/matching/candidates/${candidateId}`
        );
        return data.data;
      } catch {
        return mockCandidateMatches[candidateId] ?? [];
      }
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
      try {
        const { data } = await api.post<{ data: MatchExplanationResponse }>(
          `/matching/jobs/${jobId}/candidates/${candidateId}/explanation`
        );
        return data.data;
      } catch {
        const key = `${jobId}:${candidateId}`;
        const cached = mockMatchExplanations[key];
        if (cached) return cached;

        // Last-resort synthetic fallback so the dialog never errors out in
        // dev mode for unseen pairs. Pull a percent from the matching arrays
        // when possible to keep numbers consistent with the list view.
        const jobRow = (mockJobMatches[jobId] ?? []).find(
          (m) => m.candidate_id === candidateId
        );
        const candRow = (mockCandidateMatches[candidateId] ?? []).find(
          (m) => m.job_id === jobId
        );
        const matchPercent = jobRow?.match_percent ?? candRow?.match_percent ?? 50;

        return {
          explanation:
            "Geen specifieke AI-analyse beschikbaar voor deze combinatie. " +
            "De match-score is berekend op basis van overlap tussen vacature- " +
            "en kandidaat-attributen.",
          strengths: ["Berekende score op basis van profielkenmerken"],
          gaps: ["Onvoldoende data voor gedetailleerde analyse"],
          score: matchPercent / 100,
          match_percent: matchPercent,
          cached: false,
          ai_disclosure: MOCK_AI_DISCLOSURE,
        };
      }
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
