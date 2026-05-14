"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  mockJobBoardCatalog,
  mockJobBoardIntegrations,
  mockJobPostings,
} from "@/lib/mockData";
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
 *
 * Every endpoint falls back to in-memory mock state so the UI is fully
 * demoable without the API. Mutations also progress applicants_count on
 * "posted" rows each tick so the demo feels live.
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

// ─── Mock state ──────────────────────────────────────────────────────────────

let mockIntegrations: JobBoardIntegration[] = [...mockJobBoardIntegrations];
let mockPostings: JobPosting[] = [...mockJobPostings];

function syncIntegrations() {
  mockJobBoardIntegrations.length = 0;
  mockJobBoardIntegrations.push(...mockIntegrations);
}

function syncPostings() {
  mockJobPostings.length = 0;
  mockJobPostings.push(...mockPostings);
}

/**
 * Tick used by polling queries so the demo shows live progression:
 *   - queued → posted after ~12s
 *   - posted rows get +1 applicant on roughly half of polls
 */
function progressMockPostings(): void {
  const now = Date.now();
  mockPostings = mockPostings.map((p) => {
    if (p.status === "queued") {
      const ageMs = now - new Date(p.created_at).getTime();
      if (ageMs > 12_000) {
        return {
          ...p,
          status: "posted" as const,
          external_id: p.external_id ?? `mock-${Math.floor(Math.random() * 1_000_000)}`,
          external_url: p.external_url ?? `https://demo.${p.board_id}.example/${p.id}`,
          posted_at: new Date(now).toISOString(),
          expires_at: new Date(now + 30 * 24 * 3600 * 1000).toISOString(),
          last_polled_at: new Date(now).toISOString(),
        };
      }
      return p;
    }
    if (p.status === "posted" && Math.random() < 0.45) {
      return { ...p, applicants_count: p.applicants_count + 1, last_polled_at: new Date(now).toISOString() };
    }
    return p;
  });
  syncPostings();
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useJobBoardCatalog() {
  return useQuery({
    queryKey: ["job-boards", "catalog"],
    queryFn: async (): Promise<JobBoardCatalogEntry[]> => {
      try {
        const { data } = await api.get<JobBoardCatalogEntry[]>(
          "/job-boards/catalog"
        );
        return data;
      } catch {
        return [...mockJobBoardCatalog];
      }
    },
    staleTime: 60_000,
  });
}

export function useJobBoardIntegrations() {
  return useQuery({
    queryKey: ["job-boards", "integrations"],
    queryFn: async (): Promise<JobBoardIntegration[]> => {
      try {
        const { data } = await api.get<JobBoardIntegration[]>(
          "/job-boards/integrations"
        );
        return data;
      } catch {
        return [...mockIntegrations];
      }
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
      try {
        const { data } = await api.get<{ items: JobPosting[]; next_cursor: string | null }>(
          "/job-boards/postings",
          { params: filters }
        );
        return data.items;
      } catch {
        progressMockPostings();
        return mockPostings.filter((p) => {
          if (filters.job_id && p.job_id !== filters.job_id) return false;
          if (filters.status && p.status !== filters.status) return false;
          return true;
        });
      }
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
      try {
        const { data } = await api.get<JobPosting & { events: PostingStatusEvent[] }>(
          `/job-boards/postings/${id}`
        );
        return data;
      } catch {
        progressMockPostings();
        const found = mockPostings.find((p) => p.id === id);
        if (!found) throw new Error("Posting niet gevonden");
        const events: PostingStatusEvent[] = [
          {
            id: `evt-${id}-created`,
            event: "created",
            payload: { source: "talentflow" },
            created_at: found.created_at,
          },
        ];
        if (found.posted_at) {
          events.push({
            id: `evt-${id}-posted`,
            event: "posted",
            payload: { external_id: found.external_id },
            created_at: found.posted_at,
          });
        }
        if (found.error_message) {
          events.push({
            id: `evt-${id}-failed`,
            event: "failed",
            payload: { reason: found.error_message },
            created_at: found.created_at,
          });
        }
        if (found.retracted_at) {
          events.push({
            id: `evt-${id}-retracted`,
            event: "retracted",
            payload: {},
            created_at: found.retracted_at,
          });
        }
        return { ...found, events };
      }
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
      try {
        const { data } = await api.get<{ rows: CostPerHireRow[] }>(
          "/job-boards/cost-per-hire",
          { params: jobId ? { job_id: jobId } : {} }
        );
        return data.rows;
      } catch {
        return computeMockCostPerHire(jobId);
      }
    },
  });
}

function computeMockCostPerHire(jobId?: string): CostPerHireRow[] {
  const filtered = jobId ? mockPostings.filter((p) => p.job_id === jobId) : mockPostings;
  const byBoard = new Map<string, { postings: number; cost: number }>();
  for (const p of filtered) {
    const cur = byBoard.get(p.board_id) ?? { postings: 0, cost: 0 };
    cur.postings += 1;
    cur.cost += p.cost_amount ?? 0;
    byBoard.set(p.board_id, cur);
  }
  // Synthetic hires distribution: ~7% of applicants converted, weighted to
  // whichever board has the most applicants per board so the demo shows
  // sensible CPH spread.
  const applicantsPerBoard = new Map<string, number>();
  for (const p of filtered) {
    applicantsPerBoard.set(
      p.board_id,
      (applicantsPerBoard.get(p.board_id) ?? 0) + p.applicants_count
    );
  }
  const rows: CostPerHireRow[] = [];
  for (const [board_id, agg] of byBoard.entries()) {
    const apps = applicantsPerBoard.get(board_id) ?? 0;
    const hires = Math.max(0, Math.round(apps * 0.07));
    rows.push({
      board_id,
      postings: agg.postings,
      hires,
      total_cost: agg.cost,
      currency: "EUR",
      cost_per_hire: hires > 0 ? Math.round(agg.cost / hires) : null,
    });
  }
  return rows.sort((a, b) => (a.cost_per_hire ?? Infinity) - (b.cost_per_hire ?? Infinity));
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
      try {
        const { data } = await api.post<JobBoardIntegration>(
          `/job-boards/integrations/${boardId}/connect`,
          payload ?? {}
        );
        return data;
      } catch {
        const catalogEntry = mockJobBoardCatalog.find((b) => b.id === boardId);
        const existing = mockIntegrations.find((i) => i.board_id === boardId);
        const now = new Date().toISOString();
        if (existing) {
          existing.status = "connected";
          existing.connected_at = now;
          existing.last_polled_at = now;
          existing.last_error = null;
          existing.settings = { ...existing.settings, ...(payload ?? {}) };
          syncIntegrations();
          return existing;
        }
        const created: JobBoardIntegration = {
          id: `jbi-${boardId}-${Date.now()}`,
          board_id: boardId,
          display_name: catalogEntry?.display_name ?? boardId,
          status: "connected",
          connected_at: now,
          last_polled_at: now,
          last_error: null,
          settings: payload ?? {},
        };
        mockIntegrations = [...mockIntegrations, created];
        syncIntegrations();
        return created;
      }
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
      try {
        await api.delete(`/job-boards/integrations/${boardId}`);
      } catch {
        mockIntegrations = mockIntegrations.filter((i) => i.board_id !== boardId);
        syncIntegrations();
      }
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
      try {
        const { data } = await api.post<JobPosting[]>("/job-boards/postings", {
          job_id: input.job_id,
          board_ids: input.board_ids,
        });
        return data;
      } catch {
        const now = new Date().toISOString();
        const created: JobPosting[] = input.board_ids.map((board_id, idx) => ({
          id: `jbp-${Date.now()}-${idx}`,
          job_id: input.job_id,
          job_title: input.job_title,
          board_id,
          status: "queued",
          external_id: null,
          external_url: null,
          cost_amount: null,
          cost_currency: "EUR",
          applicants_count: 0,
          posted_at: null,
          expires_at: null,
          retracted_at: null,
          last_polled_at: null,
          error_message: null,
          created_at: now,
        }));
        mockPostings = [...created, ...mockPostings];
        syncPostings();
        return created;
      }
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
      try {
        await api.delete(`/job-boards/postings/${id}`);
      } catch {
        const now = new Date().toISOString();
        mockPostings = mockPostings.map((p) =>
          p.id === id ? { ...p, status: "retracted" as const, retracted_at: now } : p
        );
        syncPostings();
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-boards"] });
    },
  });
}
