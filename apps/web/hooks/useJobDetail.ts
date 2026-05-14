"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  mockBiasCheck,
  mockComparableJobs,
  mockJobAttachments,
  mockJobFunnel,
  mockJobHealth,
  mockJobNotes,
  mockJobSourcing,
  mockJobTeam,
  mockSourcingSuggestions,
  mockTeamMembers,
} from "@/lib/mockData";
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
 *
 * Each hook follows the same try/catch + mock-fallback pattern used by the
 * other modules so the recruiter UI degrades gracefully in dev mode.
 */

// ─── Team ───────────────────────────────────────────────────────────────────

export function useJobTeam(jobId: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "team"],
    queryFn: async (): Promise<JobTeamMember[]> => {
      try {
        const { data } = await api.get<{ data: JobTeamMember[] }>(
          `/jobs/${jobId}/team`
        );
        return data.data;
      } catch {
        return mockJobTeam[jobId] ?? [];
      }
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
      try {
        const { data } = await api.post<JobTeamMember>(`/jobs/${jobId}/team`, {
          user_id,
          role,
        });
        return data;
      } catch {
        const teammate = mockTeamMembers.find((u) => u.id === user_id);
        const member: JobTeamMember = {
          id: `team-${jobId}-${Date.now()}`,
          job_id: jobId,
          user_id,
          user_name: teammate?.name ?? "Onbekend",
          user_email: teammate?.email ?? "",
          role,
          added_at: new Date().toISOString(),
        };
        const list = mockJobTeam[jobId] ?? (mockJobTeam[jobId] = []);
        // Prevent duplicates in mock-mode.
        if (!list.some((m) => m.user_id === user_id)) list.push(member);
        return member;
      }
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
      try {
        await api.delete(`/jobs/${jobId}/team/${userId}`);
      } catch {
        const list = mockJobTeam[jobId];
        if (list) {
          const idx = list.findIndex((m) => m.user_id === userId);
          if (idx !== -1) list.splice(idx, 1);
        }
      }
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
      try {
        const { data } = await api.get<{ data: JobNote[] }>(
          `/jobs/${jobId}/notes`
        );
        return data.data;
      } catch {
        return [...(mockJobNotes[jobId] ?? [])].sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      }
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
      try {
        const { data } = await api.post<JobNote>(`/jobs/${jobId}/notes`, {
          body,
          mentions,
        });
        return data;
      } catch {
        // Best-effort author resolution: in real life we'd read this from
        // the JWT-derived user context. For mock-mode we attribute the note
        // to the current mockUser ("Emma Bakker").
        const note: JobNote = {
          id: `note-${jobId}-${Date.now()}`,
          job_id: jobId,
          author_id: "user-1",
          author_name: "Emma Bakker",
          body,
          mentions,
          created_at: new Date().toISOString(),
        };
        const list = mockJobNotes[jobId] ?? (mockJobNotes[jobId] = []);
        list.unshift(note);
        return note;
      }
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
      try {
        await api.delete(`/jobs/${jobId}/notes/${noteId}`);
      } catch {
        const list = mockJobNotes[jobId];
        if (list) {
          const idx = list.findIndex((n) => n.id === noteId);
          if (idx !== -1) list.splice(idx, 1);
        }
      }
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
      try {
        const { data } = await api.get<{ data: JobAttachment[] }>(
          `/jobs/${jobId}/attachments`
        );
        return data.data;
      } catch {
        return [...(mockJobAttachments[jobId] ?? [])];
      }
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
      try {
        const { data } = await api.post<JobAttachment>(
          `/jobs/${jobId}/attachments`,
          fd,
          { headers: { "Content-Type": "multipart/form-data" } }
        );
        return data;
      } catch {
        const attachment: JobAttachment = {
          id: `att-${jobId}-${Date.now()}`,
          job_id: jobId,
          filename: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
          storage_url: URL.createObjectURL(file),
          uploaded_by_id: "user-1",
          uploaded_by_name: "Emma Bakker",
          created_at: new Date().toISOString(),
        };
        const list =
          mockJobAttachments[jobId] ?? (mockJobAttachments[jobId] = []);
        list.unshift(attachment);
        return attachment;
      }
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
      try {
        await api.delete(`/jobs/${jobId}/attachments/${attachmentId}`);
      } catch {
        const list = mockJobAttachments[jobId];
        if (list) {
          const idx = list.findIndex((a) => a.id === attachmentId);
          if (idx !== -1) list.splice(idx, 1);
        }
      }
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
      try {
        const { data } = await api.get<JobHealthBreakdown>(
          `/jobs/${jobId}/health`
        );
        return data;
      } catch {
        return mockJobHealth[jobId] ?? null;
      }
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
      try {
        const { data } = await api.get<JobFunnelResponse>(
          `/jobs/${jobId}/funnel`
        );
        return data;
      } catch {
        return mockJobFunnel[jobId] ?? null;
      }
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
      try {
        const { data } = await api.get<{ data: ComparableJob[] }>(
          `/jobs/${jobId}/comparable`
        );
        return data.data;
      } catch {
        return mockComparableJobs[jobId] ?? [];
      }
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
      try {
        const { data } = await api.get<{ data: JobSourcingItem[] }>(
          `/jobs/${jobId}/sourcing`
        );
        return data.data;
      } catch {
        return mockJobSourcing[jobId] ?? [];
      }
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
      try {
        const { data } = await api.get<BiasCheckResult>(
          `/jobs/${jobId}/bias-check`
        );
        return data;
      } catch {
        return mockBiasCheck[jobId] ?? null;
      }
    },
    enabled: !!jobId,
    staleTime: 5 * 60_000,
  });
}

// ─── Sourcing suggestions (boolean searches) ────────────────────────────────
//
// Stand-in for a future `/api/jobs/:id/sourcing-suggestions` endpoint. Lives
// in the same hook file because it's surfaced in the AI Suite tab alongside
// the other AI products.

export function useJobSourcingSuggestions(jobId: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "sourcing-suggestions"],
    queryFn: async (): Promise<string[]> => {
      try {
        const { data } = await api.get<{ data: string[] }>(
          `/jobs/${jobId}/sourcing-suggestions`
        );
        return data.data;
      } catch {
        return mockSourcingSuggestions[jobId] ?? [];
      }
    },
    enabled: !!jobId,
    staleTime: 5 * 60_000,
  });
}
