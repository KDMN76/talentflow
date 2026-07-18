"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { unwrapData, unwrapList } from "@/lib/apiEnvelope";
import { type BulkCampaign } from "@/lib/mockData";

/**
 * React-Query hooks for bulk e-mail campaigns.
 *
 * Backend contract (Agent SS):
 *   POST /api/communications/bulk-campaign         → BulkCampaign
 *   GET  /api/communications/bulk-campaigns        → BulkCampaign[]
 *   GET  /api/communications/bulk-campaigns/:id    → BulkCampaign (with progress)
 */

export type { BulkCampaign, BulkCampaignInput } from "@/lib/mockData";

/**
 * Actual POST /communications/bulk-campaign request body — matches
 * `bulkCampaignSchema` in communications.controller.ts (`candidate_ids` +
 * `via`), NOT the wizard-facing `BulkCampaignInput` shape (`audience` +
 * `provider`). The caller (CampaignBuilder) resolves the audience filter to
 * an explicit candidate-ID list and maps provider → via before submitting.
 */
export interface CreateBulkCampaignRequest {
  subject: string;
  body_html: string;
  template_id?: string | null;
  via: "resend" | "mailbox_integration";
  mailbox_integration_id?: string | null;
  candidate_ids: string[];
}

/**
 * POST /communications/bulk-campaign response — the backend returns a
 * start-summary (`BulkCampaignStartResult` in bulkCampaign.service.ts), NOT
 * the full `BulkCampaign` row. Callers that need the full row (e.g. to show
 * a detail dialog) should follow up with `GET /bulk-campaigns/:id`.
 */
export interface BulkCampaignStartResult {
  campaign_id: string;
  total_eligible: number;
  total_skipped_consent: number;
}

// ─── Queries ────────────────────────────────────────────────────────────────

export function useBulkCampaigns() {
  return useQuery({
    queryKey: ["bulk-campaigns"],
    queryFn: async (): Promise<BulkCampaign[]> => {
      const { data } = await api.get<unknown>(
        "/communications/bulk-campaigns"
      );
      return unwrapList<BulkCampaign>(data);
    },
  });
}

export function useBulkCampaign(id: string | undefined) {
  return useQuery({
    queryKey: ["bulk-campaigns", id ?? "none"],
    enabled: !!id,
    queryFn: async (): Promise<BulkCampaign> => {
      if (!id) throw new Error("Geen campagne-ID");
      // Backend wikkelt in { data: campaign } — anders krijgt de UI het
      // wrapper-object i.p.v. de campagne zelf (envelope-drift).
      const { data } = await api.get<unknown>(
        `/communications/bulk-campaigns/${id}`
      );
      return unwrapData<BulkCampaign>(data);
    },
    // Poll while running so the progress bar updates live. "running" is the
    // only non-terminal status the backend sets (bulk_campaigns_status_check).
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && data.status === "running") {
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
    mutationFn: async (
      input: CreateBulkCampaignRequest
    ): Promise<BulkCampaignStartResult> => {
      const { data } = await api.post<unknown>(
        "/communications/bulk-campaign",
        input
      );
      return unwrapData<BulkCampaignStartResult>(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bulk-campaigns"] });
    },
  });
}
