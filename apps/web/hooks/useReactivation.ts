import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  mockReactivationAlerts,
  mockReactivationStats,
} from "@/lib/mockData";
import type {
  ReactivationFilters,
  ReactivationStats,
  TalentReactivationAlert,
} from "@/lib/types/reactivation";

/**
 * Hook contracts for the Talent Reactivation feature (Sprint Q3.2).
 *
 * Endpoints (owned by Agent VV on the backend):
 *   GET   /api/matching/reactivation-alerts
 *   POST  /api/matching/reactivation-alerts/:id/acknowledge
 *   POST  /api/matching/reactivation-alerts/:id/dismiss
 *   GET   /api/matching/reactivation-alerts/stats
 *
 * The list-hook accepts optional filters (job_id, status, score range).
 * The stats-hook is used by the sidebar badge-counter and the dashboard
 * widget — it polls every 60s so newly-surfaced matches appear without a
 * full reload.
 */

// ─── List ───────────────────────────────────────────────────────────────────

export function useReactivationAlerts(filters?: ReactivationFilters) {
  return useQuery({
    queryKey: ["reactivation-alerts", filters ?? {}],
    queryFn: async (): Promise<TalentReactivationAlert[]> => {
      try {
        const params: Record<string, string | number> = {};
        if (filters?.job_id) params.job_id = filters.job_id;
        if (filters?.status && filters.status !== "all") {
          // Backend exposes a single boolean `acknowledged` flag — translate.
          if (filters.status === "new") params.acknowledged = "false";
          else params.acknowledged = "true";
        }
        if (typeof filters?.min_score === "number") {
          params.min_score = filters.min_score;
        }
        if (typeof filters?.max_score === "number") {
          params.max_score = filters.max_score;
        }
        const { data } = await api.get<{ data: TalentReactivationAlert[] }>(
          "/matching/reactivation-alerts",
          { params: Object.keys(params).length > 0 ? params : undefined }
        );
        return data.data;
      } catch {
        return applyAlertFilters(mockReactivationAlerts, filters);
      }
    },
    staleTime: 30_000,
  });
}

// ─── Stats (badge counter) ──────────────────────────────────────────────────

export function useReactivationStats() {
  return useQuery({
    queryKey: ["reactivation-alerts", "stats"],
    queryFn: async (): Promise<ReactivationStats> => {
      try {
        const { data } = await api.get<{ data: ReactivationStats }>(
          "/matching/reactivation-alerts/stats"
        );
        return data.data;
      } catch {
        // Compute live from current mock-store so acknowledge/dismiss
        // updates the badge.
        const unacknowledged = mockReactivationAlerts.filter(
          (a) => a.status === "new"
        ).length;
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const this_week = mockReactivationAlerts.filter(
          (a) => new Date(a.created_at).getTime() >= weekAgo
        ).length;
        return {
          unacknowledged: unacknowledged || mockReactivationStats.unacknowledged,
          this_week: this_week || mockReactivationStats.this_week,
        };
      }
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

// ─── Acknowledge ────────────────────────────────────────────────────────────

export function useAcknowledgeAlert() {
  const queryClient = useQueryClient();
  return useMutation<TalentReactivationAlert, Error, string>({
    mutationFn: async (alertId) => {
      try {
        const { data } = await api.post<{ data: TalentReactivationAlert }>(
          `/matching/reactivation-alerts/${alertId}/acknowledge`
        );
        return data.data;
      } catch {
        return mutateAlertStatus(alertId, "acknowledged");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reactivation-alerts"] });
    },
  });
}

// ─── Dismiss ────────────────────────────────────────────────────────────────

export function useDismissAlert() {
  const queryClient = useQueryClient();
  return useMutation<TalentReactivationAlert, Error, string>({
    mutationFn: async (alertId) => {
      try {
        const { data } = await api.post<{ data: TalentReactivationAlert }>(
          `/matching/reactivation-alerts/${alertId}/dismiss`
        );
        return data.data;
      } catch {
        return mutateAlertStatus(alertId, "dismissed");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reactivation-alerts"] });
    },
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function applyAlertFilters(
  alerts: TalentReactivationAlert[],
  filters?: ReactivationFilters
): TalentReactivationAlert[] {
  let result = [...alerts];
  if (filters?.job_id) {
    result = result.filter((a) => a.job_id === filters.job_id);
  }
  if (filters?.status && filters.status !== "all") {
    result = result.filter((a) => a.status === filters.status);
  }
  if (typeof filters?.min_score === "number") {
    result = result.filter((a) => a.match_percent >= filters.min_score!);
  }
  if (typeof filters?.max_score === "number") {
    result = result.filter((a) => a.match_percent <= filters.max_score!);
  }
  result.sort((a, b) => b.match_percent - a.match_percent);
  return result;
}

function mutateAlertStatus(
  alertId: string,
  next: "acknowledged" | "dismissed"
): TalentReactivationAlert {
  const idx = mockReactivationAlerts.findIndex((a) => a.id === alertId);
  if (idx === -1) {
    throw new Error("Reactivation-alert niet gevonden");
  }
  const acted_at = new Date().toISOString();
  mockReactivationAlerts[idx] = {
    ...mockReactivationAlerts[idx],
    status: next,
    acted_by_id: "user-1",
    acted_by_name: "Emma Bakker",
    acted_at,
  };
  return mockReactivationAlerts[idx];
}
