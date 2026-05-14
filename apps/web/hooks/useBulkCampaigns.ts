import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  mockBulkCampaigns,
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

// Module-local copy used as the mock-fallback store.
let mockState: BulkCampaign[] = [...mockBulkCampaigns];

function syncMock() {
  mockBulkCampaigns.length = 0;
  mockBulkCampaigns.push(...mockState);
}

// ─── Queries ────────────────────────────────────────────────────────────────

export function useBulkCampaigns() {
  return useQuery({
    queryKey: ["bulk-campaigns"],
    queryFn: async (): Promise<BulkCampaign[]> => {
      try {
        const { data } = await api.get<BulkCampaign[]>(
          "/communications/bulk-campaigns"
        );
        return data;
      } catch {
        return [...mockState];
      }
    },
  });
}

export function useBulkCampaign(id: string | undefined) {
  return useQuery({
    queryKey: ["bulk-campaigns", id ?? "none"],
    enabled: !!id,
    queryFn: async (): Promise<BulkCampaign> => {
      if (!id) throw new Error("Geen campagne-ID");
      try {
        const { data } = await api.get<BulkCampaign>(
          `/communications/bulk-campaigns/${id}`
        );
        return data;
      } catch {
        const found = mockState.find((c) => c.id === id);
        if (!found) throw new Error("Campagne niet gevonden");
        return found;
      }
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
      try {
        const { data } = await api.post<BulkCampaign>(
          "/communications/bulk-campaign",
          input
        );
        return data;
      } catch {
        // Build a mock running campaign to give a believable demo experience.
        const eligible = 50 + Math.floor(Math.random() * 100);
        const skipped = Math.floor(eligible * 0.08);
        const created: BulkCampaign = {
          id: `camp-${Date.now()}`,
          tenant_id: "tenant-1",
          name: input.name,
          subject: input.subject,
          body_html: input.body_html,
          template_id: input.template_id ?? null,
          provider: input.provider,
          mailbox_integration_id: input.mailbox_integration_id ?? null,
          status: "running",
          eligible_count: eligible,
          skipped_count: skipped,
          sent_count: 0,
          failed_count: 0,
          audience: input.audience,
          failures: [],
          created_by: "user-1",
          created_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          completed_at: null,
        };
        mockState = [created, ...mockState];
        syncMock();
        return created;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bulk-campaigns"] });
    },
  });
}
