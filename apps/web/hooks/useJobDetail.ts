"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  BiasCheckResult,
  ComparableJob,
  JobAttachment,
  JobFunnelResponse,
  JobHealthBreakdown,
  JobNote,
  JobSourcingItem,
  JobTeamMember,
  JobTeamRole,
} from "@/lib/types/jobDetail";

/**
 * Hook contracts for the job-detail redesign (Slice 4.5).
 *
 * Endpoints (owned by Agent S on the backend):
 *   GET    /api/jobs/:id/team
 *   POST   /api/jobs/:id/team           { user_id, role }
 *   DELETE /api/jobs/:id/team/:userId
 *   GET    /api/jobs/:id/notes
 *   POST   /api/jobs/:id/notes          { body, mentions[] }
 *   DELETE /api/jobs/:id/notes/:noteId
 *   GET    /api/jobs/:id/attachments
 *   POST   /api/jobs/:id/attachments    multipart 'file'
 *   DELETE /api/jobs/:id/attachments/:attachmentId
 *   GET    /api/jobs/:id/health
 *   GET    /api/jobs/:id/funnel
 *   GET    /api/jobs/:id/comparable
 *   GET    /api/jobs/:id/sourcing
 *   GET    /api/jobs/:id/bias-check
 */

// ─── Team ───────────────────────────────────────────────────────────────────

export function useJobTeam(jobId: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "team"],
    queryFn: async (): Promise<JobTeamMember[]> => {
      const { data } = await api.get<{ data: JobTeamMember[] }>(
        `/jobs/${jobId}/team`
      );
      return data.data;
    },
    enabled: !!jobId,
  });
}

export function useAddJobTeamMember(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    JobTeamMember,
    Error,
    { user_id: string; role: JobTeamRole | string }
  >({
    mutationFn: async ({ user_id, role }) => {
      const { data } = await api.post<JobTeamMember>(`/jobs/${jobId}/team`, {
        user_id,
        role,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs", jobId, "team"] });
    },
  });
}

export function useRemoveJobTeamMember(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { userId: string }>({
    mutationFn: async ({ userId }) => {
      await api.delete(`/jobs/${jobId}/team/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs", jobId, "team"] });
    },
  });
}

// ─── Notes ──────────────────────────────────────────────────────────────────

export function useJobNotes(jobId: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "notes"],
    queryFn: async (): Promise<JobNote[]> => {
      const { data } = await api.get<{ data: JobNote[] }>(
        `/jobs/${jobId}/notes`
      );
      return data.data;
    },
    enabled: !!jobId,
  });
}

export function useCreateJobNote(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    JobNote,
    Error,
    { body: string; mentions?: string[] }
  >({
    mutationFn: async ({ body, mentions = [] }) => {
      const { data } = await api.post<JobNote>(`/jobs/${jobId}/notes`, {
        body,
        mentions,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs", jobId, "notes"] });
    },
  });
}

export function useDeleteJobNote(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { noteId: string }>({
    mutationFn: async ({ noteId }) => {
      await api.delete(`/jobs/${jobId}/notes/${noteId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs", jobId, "notes"] });
    },
  });
}

// ─── Attachments ────────────────────────────────────────────────────────────

export function useJobAttachments(jobId: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "attachments"],
    queryFn: async (): Promise<JobAttachment[]> => {
      const { data } = await api.get<{ data: JobAttachment[] }>(
        `/jobs/${jobId}/attachments`
      );
      return data.data;
    },
    enabled: !!jobId,
  });
}

export function useUploadJobAttachment(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation<JobAttachment, Error, File>({
    mutationFn: async (file) => {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post<JobAttachment>(
        `/jobs/${jobId}/attachments`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["jobs", jobId, "attachments"],
      });
    },
  });
}

export function useDeleteJobAttachment(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { attachmentId: string }>({
    mutationFn: async ({ attachmentId }) => {
      await api.delete(`/jobs/${jobId}/attachments/${attachmentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["jobs", jobId, "attachments"],
      });
    },
  });
}

// ─── Health ─────────────────────────────────────────────────────────────────

export function useJobHealth(jobId: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "health"],
    queryFn: async (): Promise<JobHealthBreakdown | null> => {
      const { data } = await api.get<JobHealthBreakdown>(
        `/jobs/${jobId}/health`
      );
      return data;
    },
    enabled: !!jobId,
    staleTime: 60_000,
  });
}

// ─── Funnel ─────────────────────────────────────────────────────────────────

export function useJobFunnel(jobId: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "funnel"],
    queryFn: async (): Promise<JobFunnelResponse | null> => {
      const { data } = await api.get<JobFunnelResponse>(
        `/jobs/${jobId}/funnel`
      );
      return data;
    },
    enabled: !!jobId,
    staleTime: 30_000,
  });
}

// ─── Comparable jobs ────────────────────────────────────────────────────────

export function useComparableJobs(jobId: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "comparable"],
    queryFn: async (): Promise<ComparableJob[]> => {
      const { data } = await api.get<{ data: ComparableJob[] }>(
        `/jobs/${jobId}/comparable`
      );
      return data.data;
    },
    enabled: !!jobId,
    staleTime: 5 * 60_000,
  });
}

// ─── Sourcing ROI ───────────────────────────────────────────────────────────

export function useJobSourcing(jobId: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "sourcing"],
    queryFn: async (): Promise<JobSourcingItem[]> => {
      const { data } = await api.get<{ data: JobSourcingItem[] }>(
        `/jobs/${jobId}/sourcing`
      );
      return data.data;
    },
    enabled: !!jobId,
    staleTime: 60_000,
  });
}

// ─── Bias check ─────────────────────────────────────────────────────────────

export function useJobBiasCheck(jobId: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "bias-check"],
    queryFn: async (): Promise<BiasCheckResult | null> => {
      const { data } = await api.get<BiasCheckResult>(
        `/jobs/${jobId}/bias-check`
      );
      return data;
    },
    enabled: !!jobId,
    staleTime: 5 * 60_000,
  });
}

// ─── Sourcing suggestions (boolean searches) ────────────────────────────────

export function useJobSourcingSuggestions(jobId: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "sourcing-suggestions"],
    queryFn: async (): Promise<string[]> => {
      const { data } = await api.get<{ data: string[] }>(
        `/jobs/${jobId}/sourcing-suggestions`
      );
      return data.data;
    },
    enabled: !!jobId,
    staleTime: 5 * 60_000,
  });
}
