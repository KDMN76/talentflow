"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
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
      const { data } = await api.get<{
        data: Array<TalentReactivationAlert & { reason?: string | null }>;
      }>("/matching/reactivation-alerts", {
        params: Object.keys(params).length > 0 ? params : undefined,
      });
      // API-DTO levert één vlak `reason: string | null`; de UI (AlertRow/
      // ReasonBadge) leest `reasons: ReactivationReason[]` — normaliseer,
      // anders crasht `alert.reasons.map` zodra er alerts bestaan.
      return (data.data ?? []).map((raw) => ({
        ...raw,
        reasons: Array.isArray(raw.reasons)
          ? raw.reasons
          : raw.reason
            ? [
                {
                  type: "high_score_uncontacted" as const,
                  label: raw.reason,
                },
              ]
            : [],
      }));
    },
    staleTime: 30_000,
  });
}

// ─── Stats (badge counter) ──────────────────────────────────────────────────

export function useReactivationStats() {
  return useQuery({
    queryKey: ["reactivation-alerts", "stats"],
    queryFn: async (): Promise<ReactivationStats> => {
      // Endpoint geeft het stats-object plat terug (geen {data}-wrapper).
      const { data } = await api.get<ReactivationStats>(
        "/matching/reactivation-alerts/stats"
      );
      return data;
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
      const { data } = await api.post<{ data: TalentReactivationAlert }>(
        `/matching/reactivation-alerts/${alertId}/acknowledge`
      );
      return data.data;
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
      const { data } = await api.post<{ data: TalentReactivationAlert }>(
        `/matching/reactivation-alerts/${alertId}/dismiss`
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reactivation-alerts"] });
    },
  });
}
