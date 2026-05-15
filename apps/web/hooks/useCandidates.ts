"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Candidate,
  CandidateResume,
  CandidateSkill,
  CreateCandidateInput,
  CreateCandidateSkillInput,
  PipelineTemplate,
  UpdateCandidateInput,
} from "@talentflow/shared";
import { api } from "@/lib/api";

// ─── Candidate (collection / item) ──────────────────────────────────────────

export function useCandidates(search?: string) {
  return useQuery({
    queryKey: ["candidates", search],
    queryFn: async () => {
      const { data } = await api.get<{ data: Candidate[] }>("/candidates", { params: { search } });
      return data.data;
    },
  });
}

export function useCandidate(id: string) {
  return useQuery({
    queryKey: ["candidates", id],
    queryFn: async (): Promise<Candidate & { applications?: unknown[] }> => {
      const { data } = await api.get<Candidate & { applications: unknown[] }>(`/candidates/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (candidate: CreateCandidateInput): Promise<Candidate> => {
      const { data } = await api.post<Candidate>("/candidates", candidate);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
    },
  });
}

export function useUpdateCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<UpdateCandidateInput> & { id: string }): Promise<Candidate> => {
      const { data } = await api.patch<Candidate>(`/candidates/${id}`, updates);
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      queryClient.invalidateQueries({ queryKey: ["candidates", variables.id] });
    },
  });
}

// ─── Candidate skills ───────────────────────────────────────────────────────

export function useCandidateSkills(candidateId: string) {
  return useQuery({
    queryKey: ["candidates", candidateId, "skills"],
    queryFn: async (): Promise<CandidateSkill[]> => {
      const { data } = await api.get<{ data: CandidateSkill[] }>(
        `/candidates/${candidateId}/skills`
      );
      return data.data;
    },
    enabled: !!candidateId,
  });
}

export function useAddCandidateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      candidateId,
      ...input
    }: CreateCandidateSkillInput & { candidateId: string }): Promise<CandidateSkill> => {
      const { data } = await api.post<CandidateSkill>(
        `/candidates/${candidateId}/skills`,
        input
      );
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["candidates", variables.candidateId, "skills"],
      });
      queryClient.invalidateQueries({
        queryKey: ["candidates", variables.candidateId],
      });
    },
  });
}

export function useDeleteCandidateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      candidateId,
      skillId,
    }: {
      candidateId: string;
      skillId: string;
    }): Promise<void> => {
      await api.delete(`/candidates/${candidateId}/skills/${skillId}`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["candidates", variables.candidateId, "skills"],
      });
      queryClient.invalidateQueries({
        queryKey: ["candidates", variables.candidateId],
      });
    },
  });
}

// ─── Candidate resumes ──────────────────────────────────────────────────────

/**
 * Returns all resumes for the given candidate.
 *
 * Auto-polls every 3 seconds while at least one resume is in `pending` or
 * `processing` state, and stops as soon as the queue is drained — so the UI
 * reflects AI-parsing progress without manual refresh, and idle candidates
 * don't waste requests.
 */
export function useCandidateResumes(candidateId: string) {
  return useQuery({
    queryKey: ["candidate-resumes", candidateId],
    queryFn: async (): Promise<CandidateResume[]> => {
      const { data } = await api.get<{ data: CandidateResume[] }>(
        `/candidates/${candidateId}/resumes`
      );
      return data.data;
    },
    enabled: !!candidateId,
    refetchInterval: (query) => {
      const data = query.state.data as CandidateResume[] | undefined;
      if (!data || data.length === 0) return false;
      const stillRunning = data.some(
        (r) => r.parse_status === "pending" || r.parse_status === "processing"
      );
      return stillRunning ? 3000 : false;
    },
    refetchIntervalInBackground: false,
  });
}

/**
 * Upload one or more resume files for a candidate.
 *
 * Accepts either a `FormData` (already containing `files` entries) or an
 * array of `File` objects, which is converted internally.
 */
export function useUploadCandidateResumes(candidateId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: File[] | FormData): Promise<CandidateResume[]> => {
      const formData =
        input instanceof FormData
          ? input
          : (() => {
              const fd = new FormData();
              input.forEach((file) => fd.append("files", file));
              return fd;
            })();

      const { data } = await api.post<{ data: CandidateResume[] }>(
        `/candidates/${candidateId}/resumes`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["candidate-resumes", candidateId] });
      queryClient.invalidateQueries({ queryKey: ["candidates", candidateId] });
    },
  });
}

/**
 * Delete a single resume from a candidate.
 */
export function useDeleteCandidateResume(candidateId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (resumeId: string): Promise<void> => {
      await api.delete(`/candidates/${candidateId}/resumes/${resumeId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["candidate-resumes", candidateId] });
      queryClient.invalidateQueries({ queryKey: ["candidates", candidateId] });
    },
  });
}

/**
 * Mark a resume as the candidate's primary CV. Only one resume per candidate
 * may be primary at a time — the API enforces this server-side.
 */
export function useSetPrimaryResume(candidateId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (resumeId: string): Promise<void> => {
      await api.patch(`/candidates/${candidateId}/resumes/${resumeId}/primary`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["candidate-resumes", candidateId] });
      queryClient.invalidateQueries({ queryKey: ["candidates", candidateId] });
    },
  });
}

// ─── Pipeline templates ─────────────────────────────────────────────────────

export function usePipelineTemplates() {
  return useQuery({
    queryKey: ["candidates", "pipeline-templates"],
    queryFn: async (): Promise<PipelineTemplate[]> => {
      const { data } = await api.get<{ data: PipelineTemplate[] }>(
        "/candidates/pipeline-templates"
      );
      return data.data;
    },
  });
}
