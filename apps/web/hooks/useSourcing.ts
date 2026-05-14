"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  mockAgentBriefs,
  mockAgentRuns,
  mockAgentFindings,
  mockAgentActions,
} from "@/lib/mockData";
import type {
  AgentBrief,
  AgentRun,
  AgentFinding,
  AgentAction,
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
 *
 * Every endpoint falls back to in-memory mock state so the UI is fully
 * demoable without the API. Mock progressor:
 *   - queued runs flip to running after ~4s (with reasoning_log entry)
 *   - running runs append a new reasoning_log entry every ~6s and flip to
 *     review_required after ~24s with 8 fresh findings
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

// ─── Mock state ──────────────────────────────────────────────────────────────

let mockBriefs: AgentBrief[] = [...mockAgentBriefs];
let mockRuns: AgentRun[] = [...mockAgentRuns];
let mockFindings: AgentFinding[] = [...mockAgentFindings];
let mockActions: AgentAction[] = [...mockAgentActions];

function syncBriefs() {
  mockAgentBriefs.length = 0;
  mockAgentBriefs.push(...mockBriefs);
}
function syncRuns() {
  mockAgentRuns.length = 0;
  mockAgentRuns.push(...mockRuns);
}
function syncFindings() {
  mockAgentFindings.length = 0;
  mockAgentFindings.push(...mockFindings);
}
function syncActions() {
  mockAgentActions.length = 0;
  mockAgentActions.push(...mockActions);
}

const REASONING_PROGRESSION: Array<{ step: string; reason: string }> = [
  { step: "search:linkedin", reason: "Initiële zoekopdracht uitgevoerd — 47 hits, 12 in scope." },
  { step: "score", reason: "Top 12 kandidaten gescoord op match-criteria." },
  { step: "expand", reason: "Synoniemen toegevoegd — query verbreed." },
  { step: "review_required", reason: "8 kandidaten klaar voor menselijke review." },
];

const SAMPLE_FINDING_NAMES = [
  "Lars Janssen",
  "Femke de Boer",
  "Mert Yıldız",
  "Sophia Andersson",
  "Lucas Martin",
  "Eva Nielsen",
  "Daan Visser",
  "Karim Hassan",
];

function progressMockRuns(): void {
  const now = Date.now();
  mockRuns = mockRuns.map((run) => {
    if (run.status === "queued") {
      const ageMs = now - new Date(run.created_at).getTime();
      if (ageMs > 4_000) {
        return {
          ...run,
          status: "running" as const,
          started_at: new Date(now).toISOString(),
          expansion_iteration: 1,
          current_query: { keywords: "draft", iteration: 1 },
          reasoning_log: [
            {
              ts: new Date(now).toISOString(),
              step: "plan",
              reason: "Run gestart — strategie opgesteld.",
            },
          ],
        };
      }
      return run;
    }
    if (run.status === "running") {
      const startedMs = run.started_at ? new Date(run.started_at).getTime() : now;
      const ageMs = now - startedMs;
      // Append a new reasoning_log entry every 6s based on iteration.
      const expectedEntries = Math.min(
        REASONING_PROGRESSION.length + 1, // +1 for the initial "plan" entry
        Math.floor(ageMs / 6_000) + 1
      );
      let nextLog = run.reasoning_log;
      while (nextLog.length < expectedEntries) {
        const idx = nextLog.length - 1; // 0-based into REASONING_PROGRESSION
        const entry = REASONING_PROGRESSION[idx];
        if (!entry) break;
        nextLog = [
          ...nextLog,
          {
            ts: new Date(startedMs + (idx + 1) * 6_000).toISOString(),
            step: entry.step,
            reason: entry.reason,
          },
        ];
      }
      // After 24s flip to review_required and append 8 new findings.
      if (ageMs > 24_000) {
        if (!mockFindings.some((f) => f.run_id === run.id && f.id.startsWith("find-auto-"))) {
          const created = SAMPLE_FINDING_NAMES.map((name, idx): AgentFinding => ({
            id: `find-auto-${run.id}-${idx}`,
            run_id: run.id,
            brief_id: run.brief_id,
            candidate_id: null,
            external_source: "linkedin",
            external_url: `https://linkedin.com/in/${name.toLowerCase().replace(/\s+/g, "-")}`,
            external_id: `auto-${run.id}-${idx}`,
            full_name: name,
            current_title: ["Senior Engineer", "Lead Engineer", "Staff Engineer"][idx % 3],
            current_company: ["Adyen", "Mollie", "Bunq", "ING"][idx % 4],
            location: ["Amsterdam", "Utrecht", "Rotterdam"][idx % 3],
            headline: `${name} — interessante match`,
            summary: "AI-gegenereerde samenvatting (mock).",
            skills: ["TypeScript", "React", "Node.js"].slice(0, 2 + (idx % 2)),
            languages: ["nl", "en"],
            match_score: 88 - idx * 3,
            match_reasoning:
              "Sterke match op kerncompetenties + relevante recente ervaring.",
            status: "pending_review",
            reviewed_at: null,
            reviewed_by: null,
            review_note: null,
            created_at: new Date(now).toISOString(),
          }));
          mockFindings = [...created, ...mockFindings];
          syncFindings();
        }
        return {
          ...run,
          status: "review_required" as const,
          finished_at: new Date(now).toISOString(),
          candidates_found: run.candidates_found + 8,
          expansion_iteration: REASONING_PROGRESSION.length,
          reasoning_log: nextLog,
        };
      }
      return { ...run, reasoning_log: nextLog };
    }
    return run;
  });
  syncRuns();
}

// ─── Briefs ──────────────────────────────────────────────────────────────────

export interface BriefFilters {
  job_id?: string;
  active?: boolean;
}

export function useAgentBriefs(filters: BriefFilters = {}) {
  return useQuery({
    queryKey: ["sourcing", "briefs", filters],
    queryFn: async (): Promise<AgentBrief[]> => {
      try {
        const { data } = await api.get<{ items: AgentBrief[] }>(
          "/sourcing/briefs",
          { params: filters }
        );
        return data.items;
      } catch {
        return mockBriefs.filter((b) => {
          if (filters.job_id && b.job_id !== filters.job_id) return false;
          if (filters.active !== undefined && b.active !== filters.active)
            return false;
          return true;
        });
      }
    },
  });
}

export function useAgentBrief(id: string | undefined) {
  return useQuery({
    queryKey: ["sourcing", "brief", id ?? "none"],
    enabled: !!id,
    queryFn: async (): Promise<AgentBrief> => {
      if (!id) throw new Error("Geen brief-ID");
      try {
        const { data } = await api.get<AgentBrief>(`/sourcing/briefs/${id}`);
        return data;
      } catch {
        const found = mockBriefs.find((b) => b.id === id);
        if (!found) throw new Error("Brief niet gevonden");
        return found;
      }
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
      try {
        const { data } = await api.post<AgentBrief>("/sourcing/briefs", input);
        return data;
      } catch {
        const created: AgentBrief = {
          id: `brief-${Date.now()}`,
          ...input,
          active: true,
          created_at: new Date().toISOString(),
        };
        mockBriefs = [created, ...mockBriefs];
        syncBriefs();
        return created;
      }
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
      try {
        const { data } = await api.patch<AgentBrief>(
          `/sourcing/briefs/${id}`,
          patch
        );
        return data;
      } catch {
        const idx = mockBriefs.findIndex((b) => b.id === id);
        if (idx === -1) throw new Error("Brief niet gevonden");
        mockBriefs[idx] = { ...mockBriefs[idx], ...patch };
        syncBriefs();
        return mockBriefs[idx];
      }
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
      try {
        await api.post(`/sourcing/briefs/${id}/archive`);
      } catch {
        const idx = mockBriefs.findIndex((b) => b.id === id);
        if (idx !== -1) {
          mockBriefs[idx] = { ...mockBriefs[idx], active: false };
          syncBriefs();
        }
      }
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
      try {
        const { data } = await api.get<{ items: AgentRun[] }>(
          "/sourcing/runs",
          { params: filters }
        );
        return data.items;
      } catch {
        progressMockRuns();
        return mockRuns
          .filter((r) => {
            if (filters.status && r.status !== filters.status) return false;
            if (filters.brief_id && r.brief_id !== filters.brief_id) return false;
            return true;
          })
          .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
      }
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
      try {
        const { data } = await api.get<AgentRun>(`/sourcing/runs/${id}`);
        return data;
      } catch {
        progressMockRuns();
        const found = mockRuns.find((r) => r.id === id);
        if (!found) throw new Error("Run niet gevonden");
        return found;
      }
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
      try {
        const { data } = await api.post<AgentRun>(
          `/sourcing/briefs/${input.briefId}/runs`,
          { trigger: input.trigger ?? "manual" }
        );
        return data;
      } catch {
        const created: AgentRun = {
          id: `run-${Date.now()}`,
          brief_id: input.briefId,
          status: "queued",
          trigger: input.trigger ?? "manual",
          started_at: null,
          finished_at: null,
          candidates_found: 0,
          candidates_approved: 0,
          candidates_rejected: 0,
          expansion_iteration: 0,
          current_query: null,
          reasoning_log: [],
          error_message: null,
          created_at: new Date().toISOString(),
        };
        mockRuns = [created, ...mockRuns];
        syncRuns();
        return created;
      }
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
      try {
        await api.post(`/sourcing/runs/${id}/cancel`);
      } catch {
        const idx = mockRuns.findIndex((r) => r.id === id);
        if (idx !== -1) {
          mockRuns[idx] = {
            ...mockRuns[idx],
            status: "cancelled",
            finished_at: new Date().toISOString(),
          };
          syncRuns();
        }
      }
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
      try {
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
      } catch {
        progressMockRuns();
        return mockFindings
          .filter((f) => {
            if (runId && f.run_id !== runId) return false;
            if (filters.status && f.status !== filters.status) return false;
            if (filters.brief_id && f.brief_id !== filters.brief_id) return false;
            return true;
          })
          .sort((a, b) => b.match_score - a.match_score);
      }
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
      try {
        const { data } = await api.post<AgentFinding>(
          `/sourcing/findings/${id}/approve`,
          { note }
        );
        return data;
      } catch {
        const idx = mockFindings.findIndex((f) => f.id === id);
        if (idx === -1) throw new Error("Finding niet gevonden");
        mockFindings[idx] = {
          ...mockFindings[idx],
          status: "approved",
          reviewed_at: new Date().toISOString(),
          reviewed_by: "user-1",
          review_note: note ?? null,
        };
        syncFindings();
        // Also bump run counters.
        const runIdx = mockRuns.findIndex(
          (r) => r.id === mockFindings[idx].run_id
        );
        if (runIdx !== -1) {
          mockRuns[runIdx] = {
            ...mockRuns[runIdx],
            candidates_approved: mockRuns[runIdx].candidates_approved + 1,
          };
          syncRuns();
        }
        return mockFindings[idx];
      }
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
      try {
        const { data } = await api.post<AgentFinding>(
          `/sourcing/findings/${id}/reject`,
          { reason }
        );
        return data;
      } catch {
        const idx = mockFindings.findIndex((f) => f.id === id);
        if (idx === -1) throw new Error("Finding niet gevonden");
        mockFindings[idx] = {
          ...mockFindings[idx],
          status: "rejected",
          reviewed_at: new Date().toISOString(),
          reviewed_by: "user-1",
          review_note: reason,
        };
        syncFindings();
        const runIdx = mockRuns.findIndex(
          (r) => r.id === mockFindings[idx].run_id
        );
        if (runIdx !== -1) {
          mockRuns[runIdx] = {
            ...mockRuns[runIdx],
            candidates_rejected: mockRuns[runIdx].candidates_rejected + 1,
          };
          syncRuns();
        }
        return mockFindings[idx];
      }
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
      try {
        const { data } = await api.post<{ approved: number }>(
          "/sourcing/findings/bulk-approve",
          { ids, note }
        );
        return data;
      } catch {
        let count = 0;
        const now = new Date().toISOString();
        mockFindings = mockFindings.map((f) => {
          if (ids.includes(f.id)) {
            count++;
            return {
              ...f,
              status: "approved",
              reviewed_at: now,
              reviewed_by: "user-1",
              review_note: note ?? null,
            };
          }
          return f;
        });
        syncFindings();
        return { approved: count };
      }
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
      try {
        const { data } = await api.post<{ rejected: number }>(
          "/sourcing/findings/bulk-reject",
          { ids, reason }
        );
        return data;
      } catch {
        let count = 0;
        const now = new Date().toISOString();
        mockFindings = mockFindings.map((f) => {
          if (ids.includes(f.id)) {
            count++;
            return {
              ...f,
              status: "rejected",
              reviewed_at: now,
              reviewed_by: "user-1",
              review_note: reason,
            };
          }
          return f;
        });
        syncFindings();
        return { rejected: count };
      }
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
      try {
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
      } catch {
        return mockActions
          .filter((a) => !runId || a.run_id === runId)
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
      }
    },
  });
}
