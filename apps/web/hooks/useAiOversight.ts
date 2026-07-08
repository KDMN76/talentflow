"use client";

/**
 * EU AI Act — human-oversight-gate + kandidaat-AI-transparantie (Sprint Q4.6).
 *
 * Hooks voor:
 *  - de recruiter-review-wachtrij van AI-actievoorstellen
 *    (GET /compliance/ai-proposals + POST /compliance/ai-proposals/:id/decision)
 *  - de kandidaat-AI-samenvatting (GET /compliance/candidates/:id/ai-summary)
 *  - de retentie-status van de AI-logging (GET /compliance/ai-retention-status)
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AiProposalStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "failed";

export interface AiActionProposal {
  id: string;
  source: string;
  source_id: string | null;
  action_type: string;
  action_config: Record<string, unknown>;
  trigger_event: string | null;
  entity_type: string;
  entity_id: string;
  candidate_id: string | null;
  job_id: string | null;
  reason: string | null;
  status: AiProposalStatus;
  proposed_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
  // Denormalisaties uit de list-query (voor de review-UI):
  candidate_name: string | null;
  job_title: string | null;
  workflow_name: string | null;
  target_stage_name: string | null;
}

export interface AiProposalDecisionInput {
  id: string;
  decision: "approve" | "reject";
  note?: string | null;
}

export interface AiProposalDecisionResult {
  proposal: AiActionProposal;
  executed: boolean;
}

export interface CandidateAiSummaryEntry {
  feature: string;
  category: string;
  event_count: number;
  first_used_at: string;
  last_used_at: string;
  models: string[];
}

export interface CandidateAiSummary {
  candidate_id: string;
  entries: CandidateAiSummaryEntry[];
  has_ai_processing: boolean;
  generated_at: string;
}

export interface AiRetentionStatus {
  minimum_retention_months: number;
  oldest_event_at: string | null;
  newest_event_at: string | null;
  total_events: number;
  months_covered: number;
  worm_protected: boolean;
  compliant: boolean;
  generated_at: string;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useAiProposals(status?: AiProposalStatus) {
  return useQuery({
    queryKey: ["compliance", "ai-proposals", status ?? "all"],
    queryFn: async (): Promise<AiActionProposal[]> => {
      const { data } = await api.get<{ data: AiActionProposal[] }>(
        "/compliance/ai-proposals",
        { params: status ? { status } : undefined }
      );
      return data.data;
    },
    // De wachtrij wordt gevoed door de workflow-runner — ververs periodiek
    // zodat een openstaand scherm nieuwe voorstellen vanzelf oppikt.
    refetchInterval: 60_000,
  });
}

export function useDecideAiProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: AiProposalDecisionInput
    ): Promise<AiProposalDecisionResult> => {
      const { data } = await api.post<{ data: AiProposalDecisionResult }>(
        `/compliance/ai-proposals/${input.id}/decision`,
        { decision: input.decision, note: input.note ?? null }
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance", "ai-proposals"] });
      // Een goedgekeurd voorstel verplaatst de sollicitatie — pipeline en
      // kandidaat-detail kunnen verouderd zijn.
      queryClient.invalidateQueries({ queryKey: ["pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      queryClient.invalidateQueries({ queryKey: ["compliance", "audit-events"] });
    },
  });
}

export function useCandidateAiSummary(candidateId: string | undefined) {
  return useQuery({
    queryKey: ["compliance", "candidate-ai-summary", candidateId],
    queryFn: async (): Promise<CandidateAiSummary> => {
      const { data } = await api.get<{ data: CandidateAiSummary }>(
        `/compliance/candidates/${candidateId}/ai-summary`
      );
      return data.data;
    },
    enabled: !!candidateId,
  });
}

export function useAiRetentionStatus() {
  return useQuery({
    queryKey: ["compliance", "ai-retention-status"],
    queryFn: async (): Promise<AiRetentionStatus> => {
      const { data } = await api.get<{ data: AiRetentionStatus }>(
        "/compliance/ai-retention-status"
      );
      return data.data;
    },
  });
}
