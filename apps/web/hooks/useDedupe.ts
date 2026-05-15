"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Candidate } from "@talentflow/shared";
import { api } from "@/lib/api";
import type { DedupeMatch, MergeInput } from "@/lib/types/atsExtensions";

/**
 * Find dedupe candidates for a single candidate. The dialog uses this to
 * decide whether to render the "Duplicaten" badge in the header.
 */
export function useDuplicatesForCandidate(candidateId: string | null) {
  return useQuery({
    queryKey: ["candidate-duplicates", candidateId],
    queryFn: async (): Promise<DedupeMatch[]> => {
      if (!candidateId) return [];
      const { data } = await api.get<{ data: DedupeMatch[] }>(
        `/candidates/${candidateId}/duplicates`
      );
      return data.data;
    },
    enabled: !!candidateId,
  });
}

/**
 * Merge two candidate records. The surviving record (`primary_id`) keeps
 * its identity; the duplicate is soft-deleted server-side.
 */
export function useMergeCandidates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: MergeInput): Promise<Candidate> => {
      const { data } = await api.post<Candidate>("/candidates/merge", input);
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      queryClient.invalidateQueries({
        queryKey: ["candidate-duplicates", variables.primary_id],
      });
    },
  });
}
