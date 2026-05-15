"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  type BulkCampaign,
  type BulkCampaignInput,
} from "@/lib/mockData";

/**
 * React-Query hooks for bulk e-mail campaigns.
 *
 * Backend contract (Agent SS):
 *   POST /api/communications/bulk-campaign         → BulkCampaign
 *   GET  /api/communications/bulk-campaigns        → BulkCampaign[]
 *   GET  /api/communications/bulk-campaigns/:id    → BulkCampaign (with progress)
 */

export type { BulkCampaign, BulkCampaignInput } from "@/lib/mockData";

// ─── Queries ────────────────────────────────────────────────────────────────

export function useBulkCampaigns() {
  return useQuery({
    queryKey: ["bulk-campaigns"],
    queryFn: async (): Promise<BulkCampaign[]> => {
      const { data } = await api.get<BulkCampaign[]>(
        "/communications/bulk-campaigns"
      );
      return data;
    },
  });
}

export function useBulkCampaign(id: string | undefined) {
  return useQuery({
    queryKey: ["bulk-campaigns", id ?? "none"],
    enabled: !!id,
    queryFn: async (): Promise<BulkCampaign> => {
      if (!id) throw new Error("Geen campagne-ID");
      const { data } = await api.get<BulkCampaign>(
        `/communications/bulk-campaigns/${id}`
      );
      return data;
    },
    // Poll while running so the progress bar updates live.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && (data.status === "running" || data.status === "queued")) {
        return 4000;
      }
      return false;
    },
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useCreateBulkCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkCampaignInput): Promise<BulkCampaign> => {
      const { data } = await api.post<BulkCampaign>(
        "/communications/bulk-campaign",
        input
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bulk-campaigns"] });
    },
  });
}
