"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  AgentAction,
  AgentBrief,
  AgentFinding,
  AgentRun,
  AgentRunStatus,
  FindingStatus,
} from "@/lib/types/sourcing";

/**
 * Sprint Q4.5 — React-Query hooks for the agentic AI sourcing module.
 *
 * Backend contract (Agent WWW):
 *   GET    /api/sourcing/briefs                       ?job_id&active&cursor
 *   POST   /api/sourcing/briefs
 *   GET    /api/sourcing/briefs/:id
 *   PATCH  /api/sourcing/briefs/:id
 *   POST   /api/sourcing/briefs/:id/archive
 *   POST   /api/sourcing/briefs/:id/runs
 *   GET    /api/sourcing/runs                          ?status&brief_id&cursor
 *   GET    /api/sourcing/runs/:id                      + reasoning_log + actions
 *   POST   /api/sourcing/runs/:id/cancel
 *   GET    /api/sourcing/runs/:id/findings             ?status&cursor
 *   POST   /api/sourcing/findings/:id/approve          body { note? }
 *   POST   /api/sourcing/findings/:id/reject           body { reason }
 *   POST   /api/sourcing/findings/bulk-approve
 *   POST   /api/sourcing/findings/bulk-reject
 *   GET    /api/sourcing/actions/:runId
 */

export type {
  AgentBrief,
  AgentRun,
  AgentFinding,
  AgentAction,
  AgentRunStatus,
  AgentRunTrigger,
  FindingStatus,
} from "@/lib/types/sourcing";

// ─── Briefs ──────────────────────────────────────────────────────────────────

export interface BriefFilters {
  job_id?: string;
  active?: boolean;
}

export function useAgentBriefs(filters: BriefFilters = {}) {
  return useQuery({
    queryKey: ["sourcing", "briefs", filters],
    queryFn: async (): Promise<AgentBrief[]> => {
      const { data } = await api.get<{ items: AgentBrief[] }>(
        "/sourcing/briefs",
        { params: filters }
      );
      return data.items;
    },
  });
}

export function useAgentBrief(id: string | undefined) {
  return useQuery({
    queryKey: ["sourcing", "brief", id ?? "none"],
    enabled: !!id,
    queryFn: async (): Promise<AgentBrief> => {
      if (!id) throw new Error("Geen brief-ID");
      const { data } = await api.get<AgentBrief>(`/sourcing/briefs/${id}`);
      return data;
    },
  });
}

export interface CreateBriefInput {
  job_id: string;
  brief_text: string;
  must_have: string[];
  nice_to_have: string[];
  exclusions: string[];
  target_count: number;
  search_locations: string[];
  language_preferences: string[];
}

export function useCreateBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBriefInput): Promise<AgentBrief> => {
      const { data } = await api.post<AgentBrief>("/sourcing/briefs", input);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sourcing", "briefs"] });
    },
  });
}

export function useUpdateBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<CreateBriefInput>;
    }): Promise<AgentBrief> => {
      const { data } = await api.patch<AgentBrief>(
        `/sourcing/briefs/${id}`,
        patch
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sourcing", "briefs"] });
    },
  });
}

export function useArchiveBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.post(`/sourcing/briefs/${id}/archive`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sourcing", "briefs"] });
    },
  });
}

// ─── Runs ────────────────────────────────────────────────────────────────────

export interface RunFilters {
  status?: AgentRunStatus;
  brief_id?: string;
}

export function useAgentRuns(filters: RunFilters = {}) {
  return useQuery({
    queryKey: ["sourcing", "runs", filters],
    queryFn: async (): Promise<AgentRun[]> => {
      const { data } = await api.get<{ items: AgentRun[] }>(
        "/sourcing/runs",
        { params: filters }
      );
      return data.items;
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (
        Array.isArray(data) &&
        data.some((r) => r.status === "queued" || r.status === "running")
      ) {
        return 5_000;
      }
      return false;
    },
  });
}

export function useAgentRun(id: string | undefined) {
  return useQuery({
    queryKey: ["sourcing", "run", id ?? "none"],
    enabled: !!id,
    queryFn: async (): Promise<AgentRun> => {
      if (!id) throw new Error("Geen run-ID");
      const { data } = await api.get<AgentRun>(`/sourcing/runs/${id}`);
      return data;
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && (data.status === "queued" || data.status === "running")) {
        return 5_000;
      }
      return false;
    },
  });
}

export interface StartRunInput {
  briefId: string;
  trigger?: AgentRun["trigger"];
}

export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StartRunInput): Promise<AgentRun> => {
      const { data } = await api.post<AgentRun>(
        `/sourcing/briefs/${input.briefId}/runs`,
        { trigger: input.trigger ?? "manual" }
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sourcing"] });
    },
  });
}

export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.post(`/sourcing/runs/${id}/cancel`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sourcing"] });
    },
  });
}

// ─── Findings ────────────────────────────────────────────────────────────────

export interface FindingFilters {
  status?: FindingStatus;
  brief_id?: string;
}

export function useAgentFindings(
  runId: string | undefined,
  filters: FindingFilters = {}
) {
  return useQuery({
    queryKey: ["sourcing", "findings", runId ?? "all", filters],
    queryFn: async (): Promise<AgentFinding[]> => {
      if (runId) {
        const { data } = await api.get<{ items: AgentFinding[] }>(
          `/sourcing/runs/${runId}/findings`,
          { params: filters }
        );
        return data.items;
      }
      // Cross-run inbox.
      const { data } = await api.get<{ items: AgentFinding[] }>(
        `/sourcing/findings`,
        { params: filters }
      );
      return data.items;
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      // Refresh while we expect new findings to arrive.
      if (Array.isArray(data) && data.length === 0 && runId) return 5_000;
      return false;
    },
  });
}

export function useApproveFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      note,
    }: {
      id: string;
      note?: string;
    }): Promise<AgentFinding> => {
      const { data } = await api.post<AgentFinding>(
        `/sourcing/findings/${id}/approve`,
        { note }
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sourcing"] });
    },
  });
}

export function useRejectFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      reason,
    }: {
      id: string;
      reason: string;
    }): Promise<AgentFinding> => {
      const { data } = await api.post<AgentFinding>(
        `/sourcing/findings/${id}/reject`,
        { reason }
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sourcing"] });
    },
  });
}

export function useBulkApproveFindings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ids,
      note,
    }: {
      ids: string[];
      note?: string;
    }): Promise<{ approved: number }> => {
      const { data } = await api.post<{ approved: number }>(
        "/sourcing/findings/bulk-approve",
        { ids, note }
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sourcing"] });
    },
  });
}

export function useBulkRejectFindings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ids,
      reason,
    }: {
      ids: string[];
      reason: string;
    }): Promise<{ rejected: number }> => {
      const { data } = await api.post<{ rejected: number }>(
        "/sourcing/findings/bulk-reject",
        { ids, reason }
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sourcing"] });
    },
  });
}

// ─── Actions / Audit ─────────────────────────────────────────────────────────

export function useAgentActions(runId: string | undefined) {
  return useQuery({
    queryKey: ["sourcing", "actions", runId ?? "all"],
    queryFn: async (): Promise<AgentAction[]> => {
      if (runId) {
        const { data } = await api.get<{ items: AgentAction[] }>(
          `/sourcing/actions/${runId}`
        );
        return data.items;
      }
      const { data } = await api.get<{ items: AgentAction[] }>(
        "/sourcing/actions"
      );
      return data.items;
    },
  });
}
