"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  CostPerHireRow,
  JobBoardCatalogEntry,
  JobBoardIntegration,
  JobPosting,
  PostingStatusEvent,
} from "@/lib/types/jobBoards";

/**
 * Sprint Q4.3 — React-Query hooks for the job-board distribution module.
 *
 * Backend contract (Agents QQQ + RRR):
 *   GET    /api/job-boards/integrations
 *   GET    /api/job-boards/catalog
 *   POST   /api/job-boards/integrations/:boardId/connect
 *   DELETE /api/job-boards/integrations/:boardId
 *   GET    /api/job-boards/postings?job_id&status&cursor&limit
 *   GET    /api/job-boards/postings/:id
 *   POST   /api/job-boards/postings        body { job_id, board_ids[] }
 *   DELETE /api/job-boards/postings/:id
 *   GET    /api/job-boards/cost-per-hire?job_id
 */

// Re-export types for callers that prefer to import from the hook.
export type {
  CostPerHireRow,
  JobBoardCatalogEntry,
  JobBoardIntegration,
  JobBoardIntegrationStatus,
  JobBoardRegion,
  JobPosting,
  JobPostingStatus,
  PostingStatusEvent,
} from "@/lib/types/jobBoards";

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useJobBoardCatalog() {
  return useQuery({
    queryKey: ["job-boards", "catalog"],
    queryFn: async (): Promise<JobBoardCatalogEntry[]> => {
      // Backend wikkelt in { data: [...] }; geef de array terug.
      const { data } = await api.get<{ data: JobBoardCatalogEntry[] }>(
        "/job-boards/catalog"
      );
      return data.data ?? [];
    },
    staleTime: 60_000,
  });
}

export function useJobBoardIntegrations() {
  return useQuery({
    queryKey: ["job-boards", "integrations"],
    queryFn: async (): Promise<JobBoardIntegration[]> => {
      // Backend wikkelt in { data: [...] }; geef de array terug.
      const { data } = await api.get<{ data: JobBoardIntegration[] }>(
        "/job-boards/integrations"
      );
      return data.data ?? [];
    },
  });
}

export interface JobPostingFilters {
  job_id?: string;
  status?: JobPosting["status"];
  cursor?: string;
  limit?: number;
}

export function useJobPostings(filters: JobPostingFilters = {}) {
  return useQuery({
    queryKey: ["job-boards", "postings", filters],
    queryFn: async (): Promise<JobPosting[]> => {
      const { data } = await api.get<{ data: JobPosting[]; next_cursor: string | null }>(
        "/job-boards/postings",
        { params: filters }
      );
      return data.data ?? [];
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (Array.isArray(data) && data.some((p) => p.status === "queued")) {
        return 15_000;
      }
      return false;
    },
  });
}

export function useJobPosting(id: string | undefined) {
  return useQuery({
    queryKey: ["job-boards", "posting", id ?? "none"],
    enabled: !!id,
    queryFn: async (): Promise<JobPosting & { events: PostingStatusEvent[] }> => {
      if (!id) throw new Error("Geen posting-ID");
      const { data } = await api.get<JobPosting & { events: PostingStatusEvent[] }>(
        `/job-boards/postings/${id}`
      );
      return data;
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && (data.status === "queued" || data.status === "posted")) {
        return 8_000;
      }
      return false;
    },
  });
}

export function useCostPerHire(jobId?: string) {
  return useQuery({
    queryKey: ["job-boards", "cost-per-hire", jobId ?? "all"],
    queryFn: async (): Promise<CostPerHireRow[]> => {
      const { data } = await api.get<{ rows: CostPerHireRow[] }>(
        "/job-boards/cost-per-hire",
        { params: jobId ? { job_id: jobId } : {} }
      );
      return data.rows;
    },
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export interface ConnectJobBoardInput {
  boardId: string;
  payload?: Record<string, unknown>;
}

export function useConnectJobBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ boardId, payload }: ConnectJobBoardInput): Promise<JobBoardIntegration> => {
      const { data } = await api.post<JobBoardIntegration>(
        `/job-boards/integrations/${boardId}/connect`,
        payload ?? {}
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-boards"] });
    },
  });
}

export function useDisconnectJobBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (boardId: string): Promise<void> => {
      await api.delete(`/job-boards/integrations/${boardId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-boards"] });
    },
  });
}

export interface CreatePostingsInput {
  job_id: string;
  job_title?: string;
  board_ids: string[];
}

export function useCreatePostings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePostingsInput): Promise<JobPosting[]> => {
      const { data } = await api.post<JobPosting[]>("/job-boards/postings", {
        job_id: input.job_id,
        board_ids: input.board_ids,
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-boards"] });
    },
  });
}

export function useRetractPosting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/job-boards/postings/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-boards"] });
    },
  });
}
