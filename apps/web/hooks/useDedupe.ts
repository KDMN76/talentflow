import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Candidate } from "@talentflow/shared";
import { api } from "@/lib/api";
import { mockCandidates, mockDuplicates } from "@/lib/mockData";
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
      try {
        const { data } = await api.get<{ data: DedupeMatch[] }>(
          `/candidates/${candidateId}/duplicates`
        );
        return data.data;
      } catch {
        return mockDuplicates[candidateId] ?? [];
      }
    },
    enabled: !!candidateId,
  });
}

/**
 * Merge two candidate records. The surviving record (`primary_id`) keeps
 * its identity; the duplicate is soft-deleted server-side. Mock-fallback
 * mirrors that by removing the duplicate from `mockCandidates`.
 */
export function useMergeCandidates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: MergeInput): Promise<Candidate> => {
      try {
        const { data } = await api.post<Candidate>("/candidates/merge", input);
        return data;
      } catch {
        const primaryIdx = mockCandidates.findIndex((c) => c.id === input.primary_id);
        const dupIdx = mockCandidates.findIndex((c) => c.id === input.duplicate_id);
        if (primaryIdx === -1) throw new Error("Primaire kandidaat niet gevonden");

        const primary = mockCandidates[primaryIdx];
        const dup = dupIdx !== -1 ? mockCandidates[dupIdx] : null;

        // Apply per-field choices: when source = "duplicate", overwrite the
        // primary's field with the duplicate's value (when present).
        if (dup) {
          const merged: Record<string, unknown> = { ...(primary as unknown as Record<string, unknown>) };
          for (const choice of input.choices) {
            if (choice.source === "duplicate") {
              const dupRec = dup as unknown as Record<string, unknown>;
              if (choice.field in dupRec) {
                merged[choice.field] = dupRec[choice.field];
              }
            }
          }
          mockCandidates[primaryIdx] = merged as unknown as Candidate;
        }

        // Remove duplicate + clear its dedupe entry.
        if (dupIdx !== -1) mockCandidates.splice(dupIdx, 1);
        delete mockDuplicates[input.duplicate_id];
        if (mockDuplicates[input.primary_id]) {
          mockDuplicates[input.primary_id] = mockDuplicates[input.primary_id].filter(
            (m) => m.matched_candidate_id !== input.duplicate_id
          );
          if (mockDuplicates[input.primary_id].length === 0) {
            delete mockDuplicates[input.primary_id];
          }
        }

        return mockCandidates[primaryIdx];
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      queryClient.invalidateQueries({
        queryKey: ["candidate-duplicates", variables.primary_id],
      });
    },
  });
}
