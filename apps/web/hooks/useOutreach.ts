"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { unwrapData, unwrapList } from "@/lib/apiEnvelope";
import type {
  CandidateSignal,
  OutreachChannel,
  OutreachMessage,
  OutreachQuota,
  OutreachStatus,
  ReplyCategory,
  ReplyClassification,
  SignalType,
} from "@/lib/types/outreach";

/**
 * Sprint Q4.5 — React-Query hooks for outreach (drafts, replies, signals,
 * quotas).
 *
 * Backend contract (Agent XXX):
 *   GET    /api/outreach/messages                  ?status&candidate_id&direction&cursor
 *   POST   /api/outreach/messages/draft
 *   POST   /api/outreach/messages/:id/approve
 *   POST   /api/outreach/messages/:id/reject
 *   POST   /api/outreach/messages/:id/regenerate
 *   GET    /api/outreach/quotas
 *   PATCH  /api/outreach/quotas/:recruiterId/:channel
 *   GET    /api/outreach/replies                   ?category&unreviewed=true&cursor
 *   GET    /api/outreach/signals                   ?signal_type&unreviewed=true&cursor
 *   POST   /api/outreach/signals/:id/dismiss
 *   POST   /api/outreach/signals/:id/draft-reactivation  body { sequence_id }
 */

export type {
  CandidateSignal,
  OutreachChannel,
  OutreachMessage,
  OutreachQuota,
  OutreachStatus,
  ReplyCategory,
  ReplyClassification,
  SignalType,
} from "@/lib/types/outreach";

// ─── Messages ────────────────────────────────────────────────────────────────

export interface MessageFilters {
  status?: OutreachStatus;
  candidate_id?: string;
  direction?: "outbound" | "inbound";
}

export function useOutreachMessages(filters: MessageFilters = {}) {
  return useQuery({
    queryKey: ["outreach", "messages", filters],
    queryFn: async (): Promise<OutreachMessage[]> => {
      const { data } = await api.get<unknown>("/outreach/messages", {
        params: filters,
      });
      return unwrapList<OutreachMessage>(data);
    },
  });
}

export interface DraftMessageInput {
  candidate_id: string;
  channel: OutreachChannel;
  step_id?: string;
  signals?: Record<string, string>;
  hint?: string;
}

export function useDraftMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DraftMessageInput): Promise<OutreachMessage> => {
      const { data } = await api.post<OutreachMessage>(
        "/outreach/messages/draft",
        input
      );
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach"] }),
  });
}

export function useApproveMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<OutreachMessage> => {
      const { data } = await api.post<OutreachMessage>(
        `/outreach/messages/${id}/approve`
      );
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach"] }),
  });
}

export function useRejectMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      reason,
    }: {
      id: string;
      reason: string;
    }): Promise<OutreachMessage> => {
      const { data } = await api.post<OutreachMessage>(
        `/outreach/messages/${id}/reject`,
        { reason }
      );
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach"] }),
  });
}

export interface RegenerateMessageInput {
  id: string;
  hint?: string;
  body_override?: string;
}

export function useRegenerateMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegenerateMessageInput): Promise<OutreachMessage> => {
      const { data } = await api.post<OutreachMessage>(
        `/outreach/messages/${input.id}/regenerate`,
        { hint: input.hint, body_override: input.body_override }
      );
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach"] }),
  });
}

// ─── Quotas ──────────────────────────────────────────────────────────────────

export function useOutreachQuotas() {
  return useQuery({
    queryKey: ["outreach", "quotas"],
    queryFn: async (): Promise<OutreachQuota[]> => {
      const { data } = await api.get<unknown>("/outreach/quotas");
      return unwrapList<OutreachQuota>(data);
    },
  });
}

export interface UpdateQuotaInput {
  recruiterId: string;
  channel: OutreachChannel;
  daily_limit?: number;
  weekly_limit?: number;
}

export function useUpdateQuota() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateQuotaInput): Promise<OutreachQuota> => {
      const { data } = await api.patch<OutreachQuota>(
        `/outreach/quotas/${input.recruiterId}/${input.channel}`,
        { daily_limit: input.daily_limit, weekly_limit: input.weekly_limit }
      );
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach", "quotas"] }),
  });
}

// ─── Replies ─────────────────────────────────────────────────────────────────

export interface ReplyFilters {
  category?: ReplyCategory;
  unreviewed?: boolean;
}

export function useReplies(filters: ReplyFilters = {}) {
  return useQuery({
    queryKey: ["outreach", "replies", filters],
    queryFn: async (): Promise<ReplyClassification[]> => {
      const { data } = await api.get<unknown>("/outreach/replies", {
        params: filters,
      });
      return unwrapList<ReplyClassification>(data);
    },
  });
}

// ─── Signals ─────────────────────────────────────────────────────────────────

export interface SignalFilters {
  signal_type?: SignalType;
  unreviewed?: boolean;
}

export function useSignals(filters: SignalFilters = {}) {
  return useQuery({
    queryKey: ["outreach", "signals", filters],
    queryFn: async (): Promise<CandidateSignal[]> => {
      const { data } = await api.get<unknown>("/outreach/signals", {
        params: filters,
      });
      return unwrapList<CandidateSignal>(data);
    },
  });
}

export function useDismissSignal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.post(`/outreach/signals/${id}/dismiss`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach", "signals"] }),
  });
}

export function useDraftReactivation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      signalId,
      sequenceId,
    }: {
      signalId: string;
      sequenceId: string;
    }): Promise<{ id: string }> => {
      const { data } = await api.post<unknown>(
        `/outreach/signals/${signalId}/draft-reactivation`,
        { sequence_id: sequenceId }
      );
      return unwrapData<{ id: string }>(data);
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["outreach", "signals"] }),
  });
}
