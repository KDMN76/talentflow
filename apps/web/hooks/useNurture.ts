"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { unwrapData, unwrapList } from "@/lib/apiEnvelope";
import type {
  NurtureEnrollment,
  NurtureSequence,
  NurtureStep,
  OutreachChannel,
} from "@/lib/types/outreach";

/**
 * Sprint Q4.5 — React-Query hooks for nurture sequences + enrollments.
 *
 * Backend contract (Agent XXX):
 *   GET    /api/nurture/sequences                  ?active&cursor
 *   POST   /api/nurture/sequences
 *   GET    /api/nurture/sequences/:id              includes steps
 *   PATCH  /api/nurture/sequences/:id
 *   POST   /api/nurture/sequences/:id/archive
 *   POST   /api/nurture/sequences/:id/steps
 *   PATCH  /api/nurture/sequences/:id/steps/:stepId
 *   POST   /api/nurture/sequences/:id/steps/reorder
 *   DELETE /api/nurture/sequences/:id/steps/:stepId
 *   GET    /api/nurture/enrollments                ?candidate_id&sequence_id&status&cursor
 *   POST   /api/nurture/enrollments
 *   POST   /api/nurture/enrollments/:id/pause
 *   POST   /api/nurture/enrollments/:id/resume
 *   POST   /api/nurture/enrollments/:id/stop       body { reason }
 */

export type {
  NurtureEnrollment,
  NurtureSequence,
  NurtureStep,
} from "@/lib/types/outreach";

// ─── Sequences ───────────────────────────────────────────────────────────────

export function useSequences(filters: { active?: boolean } = {}) {
  return useQuery({
    queryKey: ["nurture", "sequences", filters],
    queryFn: async (): Promise<NurtureSequence[]> => {
      const { data } = await api.get<unknown>("/nurture/sequences", {
        params: filters,
      });
      return unwrapList<NurtureSequence>(data);
    },
  });
}

export function useSequence(id: string | undefined) {
  return useQuery({
    queryKey: ["nurture", "sequence", id ?? "none"],
    enabled: !!id,
    queryFn: async (): Promise<{
      sequence: NurtureSequence;
      steps: NurtureStep[];
    }> => {
      if (!id) throw new Error("Geen sequence-ID");
      // Backend geeft { data: { ...sequence, steps } } — de sequence-velden en
      // de steps zitten samen in het uitgepakte object.
      const { data } = await api.get<unknown>(`/nurture/sequences/${id}`);
      const seq = unwrapData<NurtureSequence & { steps?: NurtureStep[] }>(data);
      return { sequence: seq, steps: seq.steps ?? [] };
    },
  });
}

export interface CreateSequenceInput {
  name: string;
  description?: string;
}

export function useCreateSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSequenceInput): Promise<NurtureSequence> => {
      const { data } = await api.post<unknown>("/nurture/sequences", input);
      return unwrapData<NurtureSequence>(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nurture"] }),
  });
}

export function useUpdateSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<{ name: string; description: string | null; active: boolean }>;
    }): Promise<NurtureSequence> => {
      const { data } = await api.patch<unknown>(
        `/nurture/sequences/${id}`,
        patch
      );
      return unwrapData<NurtureSequence>(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nurture"] }),
  });
}

export function useArchiveSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.post(`/nurture/sequences/${id}/archive`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nurture"] }),
  });
}

// ─── Steps ───────────────────────────────────────────────────────────────────

export interface AddStepInput {
  sequenceId: string;
  step_order: number;
  channel: OutreachChannel;
  delay_days: number;
  ai_personalize: boolean;
  template_subject: string | null;
  template_body: string | null;
  stop_on_reply: boolean;
}

export function useAddStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddStepInput): Promise<NurtureStep> => {
      const { data } = await api.post<unknown>(
        `/nurture/sequences/${input.sequenceId}/steps`,
        input
      );
      return unwrapData<NurtureStep>(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nurture"] }),
  });
}

export function useUpdateStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sequenceId,
      stepId,
      patch,
    }: {
      sequenceId: string;
      stepId: string;
      patch: Partial<Omit<NurtureStep, "id" | "sequence_id">>;
    }): Promise<NurtureStep> => {
      const { data } = await api.patch<unknown>(
        `/nurture/sequences/${sequenceId}/steps/${stepId}`,
        patch
      );
      return unwrapData<NurtureStep>(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nurture"] }),
  });
}

export function useReorderSteps() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sequenceId,
      orderedIds,
    }: {
      sequenceId: string;
      orderedIds: string[];
    }): Promise<NurtureStep[]> => {
      const { data } = await api.post<unknown>(
        `/nurture/sequences/${sequenceId}/steps/reorder`,
        { ordered_ids: orderedIds }
      );
      return unwrapList<NurtureStep>(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nurture"] }),
  });
}

export function useDeleteStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sequenceId,
      stepId,
    }: {
      sequenceId: string;
      stepId: string;
    }): Promise<void> => {
      await api.delete(`/nurture/sequences/${sequenceId}/steps/${stepId}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nurture"] }),
  });
}

// ─── Enrollments ─────────────────────────────────────────────────────────────

export interface EnrollmentFilters {
  candidate_id?: string;
  sequence_id?: string;
  status?: NurtureEnrollment["status"];
}

export function useEnrollments(filters: EnrollmentFilters = {}) {
  return useQuery({
    queryKey: ["nurture", "enrollments", filters],
    queryFn: async (): Promise<NurtureEnrollment[]> => {
      const { data } = await api.get<unknown>("/nurture/enrollments", {
        params: filters,
      });
      return unwrapList<NurtureEnrollment>(data);
    },
  });
}

export interface EnrollCandidateInput {
  candidate_id: string;
  sequence_id: string;
  finding_id?: string;
}

export function useEnrollCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: EnrollCandidateInput): Promise<NurtureEnrollment> => {
      const { data } = await api.post<unknown>("/nurture/enrollments", input);
      return unwrapData<NurtureEnrollment>(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nurture"] }),
  });
}

export function usePauseEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.post(`/nurture/enrollments/${id}/pause`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nurture"] }),
  });
}

export function useResumeEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.post(`/nurture/enrollments/${id}/resume`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nurture"] }),
  });
}

export function useStopEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      reason,
    }: {
      id: string;
      reason: string;
    }): Promise<void> => {
      await api.post(`/nurture/enrollments/${id}/stop`, { reason });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nurture"] }),
  });
}
