"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  mockNurtureEnrollments,
  mockNurtureSequences,
  mockNurtureSteps,
} from "@/lib/mockData";
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

let mockSeqs: NurtureSequence[] = [...mockNurtureSequences];
let mockSteps: NurtureStep[] = [...mockNurtureSteps];
let mockEnrolls: NurtureEnrollment[] = [...mockNurtureEnrollments];

function syncSeqs() {
  mockNurtureSequences.length = 0;
  mockNurtureSequences.push(...mockSeqs);
}
function syncSteps() {
  mockNurtureSteps.length = 0;
  mockNurtureSteps.push(...mockSteps);
}
function syncEnrolls() {
  mockNurtureEnrollments.length = 0;
  mockNurtureEnrollments.push(...mockEnrolls);
}

function recountSteps(sequenceId: string): void {
  const total = mockSteps.filter((s) => s.sequence_id === sequenceId).length;
  const idx = mockSeqs.findIndex((s) => s.id === sequenceId);
  if (idx !== -1) {
    mockSeqs[idx] = { ...mockSeqs[idx], total_steps: total };
    syncSeqs();
  }
}

// ─── Sequences ───────────────────────────────────────────────────────────────

export function useSequences(filters: { active?: boolean } = {}) {
  return useQuery({
    queryKey: ["nurture", "sequences", filters],
    queryFn: async (): Promise<NurtureSequence[]> => {
      try {
        const { data } = await api.get<{ items: NurtureSequence[] }>(
          "/nurture/sequences",
          { params: filters }
        );
        return data.items;
      } catch {
        return mockSeqs.filter((s) => {
          if (filters.active !== undefined && s.active !== filters.active)
            return false;
          return true;
        });
      }
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
      try {
        const { data } = await api.get<{
          sequence: NurtureSequence;
          steps: NurtureStep[];
        }>(`/nurture/sequences/${id}`);
        return data;
      } catch {
        const seq = mockSeqs.find((s) => s.id === id);
        if (!seq) throw new Error("Sequence niet gevonden");
        const steps = mockSteps
          .filter((s) => s.sequence_id === id)
          .sort((a, b) => a.step_order - b.step_order);
        return { sequence: seq, steps };
      }
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
      try {
        const { data } = await api.post<NurtureSequence>(
          "/nurture/sequences",
          input
        );
        return data;
      } catch {
        const created: NurtureSequence = {
          id: `seq-${Date.now()}`,
          name: input.name,
          description: input.description ?? null,
          active: true,
          total_steps: 0,
          created_at: new Date().toISOString(),
        };
        mockSeqs = [created, ...mockSeqs];
        syncSeqs();
        return created;
      }
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
      try {
        const { data } = await api.patch<NurtureSequence>(
          `/nurture/sequences/${id}`,
          patch
        );
        return data;
      } catch {
        const idx = mockSeqs.findIndex((s) => s.id === id);
        if (idx === -1) throw new Error("Sequence niet gevonden");
        mockSeqs[idx] = { ...mockSeqs[idx], ...patch };
        syncSeqs();
        return mockSeqs[idx];
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nurture"] }),
  });
}

export function useArchiveSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      try {
        await api.post(`/nurture/sequences/${id}/archive`);
      } catch {
        const idx = mockSeqs.findIndex((s) => s.id === id);
        if (idx !== -1) {
          mockSeqs[idx] = { ...mockSeqs[idx], active: false };
          syncSeqs();
        }
      }
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
      try {
        const { data } = await api.post<NurtureStep>(
          `/nurture/sequences/${input.sequenceId}/steps`,
          input
        );
        return data;
      } catch {
        const created: NurtureStep = {
          id: `step-${Date.now()}`,
          sequence_id: input.sequenceId,
          step_order: input.step_order,
          channel: input.channel,
          delay_days: input.delay_days,
          ai_personalize: input.ai_personalize,
          template_subject: input.template_subject,
          template_body: input.template_body,
          stop_on_reply: input.stop_on_reply,
        };
        mockSteps = [...mockSteps, created];
        syncSteps();
        recountSteps(input.sequenceId);
        return created;
      }
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
      try {
        const { data } = await api.patch<NurtureStep>(
          `/nurture/sequences/${sequenceId}/steps/${stepId}`,
          patch
        );
        return data;
      } catch {
        const idx = mockSteps.findIndex((s) => s.id === stepId);
        if (idx === -1) throw new Error("Stap niet gevonden");
        mockSteps[idx] = { ...mockSteps[idx], ...patch };
        syncSteps();
        return mockSteps[idx];
      }
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
      try {
        const { data } = await api.post<{ items: NurtureStep[] }>(
          `/nurture/sequences/${sequenceId}/steps/reorder`,
          { ordered_ids: orderedIds }
        );
        return data.items;
      } catch {
        mockSteps = mockSteps.map((s) => {
          if (s.sequence_id !== sequenceId) return s;
          const idx = orderedIds.indexOf(s.id);
          if (idx === -1) return s;
          return { ...s, step_order: idx + 1 };
        });
        syncSteps();
        return mockSteps.filter((s) => s.sequence_id === sequenceId);
      }
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
      try {
        await api.delete(`/nurture/sequences/${sequenceId}/steps/${stepId}`);
      } catch {
        mockSteps = mockSteps.filter((s) => s.id !== stepId);
        // Re-number remaining steps in the sequence.
        const remaining = mockSteps
          .filter((s) => s.sequence_id === sequenceId)
          .sort((a, b) => a.step_order - b.step_order);
        remaining.forEach((s, i) => {
          const idx = mockSteps.findIndex((x) => x.id === s.id);
          if (idx !== -1) mockSteps[idx] = { ...mockSteps[idx], step_order: i + 1 };
        });
        syncSteps();
        recountSteps(sequenceId);
      }
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
      try {
        const { data } = await api.get<{ items: NurtureEnrollment[] }>(
          "/nurture/enrollments",
          { params: filters }
        );
        return data.items;
      } catch {
        return mockEnrolls
          .filter((e) => {
            if (filters.candidate_id && e.candidate_id !== filters.candidate_id)
              return false;
            if (filters.sequence_id && e.sequence_id !== filters.sequence_id)
              return false;
            if (filters.status && e.status !== filters.status) return false;
            return true;
          })
          .sort((a, b) => b.enrolled_at.localeCompare(a.enrolled_at));
      }
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
      try {
        const { data } = await api.post<NurtureEnrollment>(
          "/nurture/enrollments",
          input
        );
        return data;
      } catch {
        const seq = mockSeqs.find((s) => s.id === input.sequence_id);
        const created: NurtureEnrollment = {
          id: `enr-${Date.now()}`,
          candidate_id: input.candidate_id,
          finding_id: input.finding_id ?? null,
          sequence_id: input.sequence_id,
          sequence_name: seq?.name,
          status: "pending_approval",
          current_step_order: 1,
          next_send_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          enrolled_at: new Date().toISOString(),
          stopped_at: null,
          stopped_reason: null,
        };
        mockEnrolls = [created, ...mockEnrolls];
        syncEnrolls();
        return created;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nurture"] }),
  });
}

export function usePauseEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      try {
        await api.post(`/nurture/enrollments/${id}/pause`);
      } catch {
        const idx = mockEnrolls.findIndex((e) => e.id === id);
        if (idx !== -1) {
          mockEnrolls[idx] = { ...mockEnrolls[idx], status: "paused" };
          syncEnrolls();
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nurture"] }),
  });
}

export function useResumeEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      try {
        await api.post(`/nurture/enrollments/${id}/resume`);
      } catch {
        const idx = mockEnrolls.findIndex((e) => e.id === id);
        if (idx !== -1) {
          mockEnrolls[idx] = { ...mockEnrolls[idx], status: "active" };
          syncEnrolls();
        }
      }
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
      try {
        await api.post(`/nurture/enrollments/${id}/stop`, { reason });
      } catch {
        const idx = mockEnrolls.findIndex((e) => e.id === id);
        if (idx !== -1) {
          mockEnrolls[idx] = {
            ...mockEnrolls[idx],
            status: "stopped",
            stopped_at: new Date().toISOString(),
            stopped_reason: reason,
          };
          syncEnrolls();
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nurture"] }),
  });
}
