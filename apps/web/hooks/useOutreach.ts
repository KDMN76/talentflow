"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  mockCandidateSignals,
  mockOutreachMessages,
  mockOutreachQuotas,
  mockReplyClassifications,
} from "@/lib/mockData";
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

// ─── Mock state ──────────────────────────────────────────────────────────────

let mockMessages: OutreachMessage[] = [...mockOutreachMessages];
let mockClassifications: ReplyClassification[] = [...mockReplyClassifications];
let mockSignals: CandidateSignal[] = [...mockCandidateSignals];
let mockQuotas: OutreachQuota[] = [...mockOutreachQuotas];

function syncMessages() {
  mockOutreachMessages.length = 0;
  mockOutreachMessages.push(...mockMessages);
}
function syncClassifications() {
  mockReplyClassifications.length = 0;
  mockReplyClassifications.push(...mockClassifications);
}
function syncSignals() {
  mockCandidateSignals.length = 0;
  mockCandidateSignals.push(...mockSignals);
}
function syncQuotas() {
  mockOutreachQuotas.length = 0;
  mockOutreachQuotas.push(...mockQuotas);
}

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
      try {
        const { data } = await api.get<{ items: OutreachMessage[] }>(
          "/outreach/messages",
          { params: filters }
        );
        return data.items;
      } catch {
        return mockMessages
          .filter((m) => {
            if (filters.status && m.status !== filters.status) return false;
            if (filters.candidate_id && m.candidate_id !== filters.candidate_id)
              return false;
            if (filters.direction && m.direction !== filters.direction)
              return false;
            return true;
          })
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
      }
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
      try {
        const { data } = await api.post<OutreachMessage>(
          "/outreach/messages/draft",
          input
        );
        return data;
      } catch {
        const created: OutreachMessage = {
          id: `msg-${Date.now()}`,
          enrollment_id: null,
          step_id: input.step_id ?? null,
          candidate_id: input.candidate_id,
          channel: input.channel,
          direction: "outbound",
          status: "drafted",
          subject: "AI-conceptbericht",
          body_text: input.hint
            ? `Concept met instructie: "${input.hint}"\n\nHi,\n\nKorte vraag — ben je open voor een rol?\n\nGroet,\nEmma`
            : "Hi,\n\nKorte vraag — ben je open voor een rol?\n\nGroet,\nEmma",
          personalization_signals: input.signals ?? {},
          scheduled_for: null,
          sent_at: null,
          approved_by: null,
          approved_at: null,
          rejected_by: null,
          rejected_at: null,
          rejection_reason: null,
          reply_message_id: null,
          error_message: null,
          created_at: new Date().toISOString(),
        };
        mockMessages = [created, ...mockMessages];
        syncMessages();
        return created;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach"] }),
  });
}

export function useApproveMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<OutreachMessage> => {
      try {
        const { data } = await api.post<OutreachMessage>(
          `/outreach/messages/${id}/approve`
        );
        return data;
      } catch {
        const idx = mockMessages.findIndex((m) => m.id === id);
        if (idx === -1) throw new Error("Bericht niet gevonden");
        const now = new Date().toISOString();
        mockMessages[idx] = {
          ...mockMessages[idx],
          status: "approved",
          approved_by: "user-1",
          approved_at: now,
        };
        syncMessages();
        return mockMessages[idx];
      }
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
      try {
        const { data } = await api.post<OutreachMessage>(
          `/outreach/messages/${id}/reject`,
          { reason }
        );
        return data;
      } catch {
        const idx = mockMessages.findIndex((m) => m.id === id);
        if (idx === -1) throw new Error("Bericht niet gevonden");
        const now = new Date().toISOString();
        mockMessages[idx] = {
          ...mockMessages[idx],
          status: "rejected_by_recruiter",
          rejected_by: "user-1",
          rejected_at: now,
          rejection_reason: reason,
        };
        syncMessages();
        return mockMessages[idx];
      }
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
      try {
        const { data } = await api.post<OutreachMessage>(
          `/outreach/messages/${input.id}/regenerate`,
          { hint: input.hint, body_override: input.body_override }
        );
        return data;
      } catch {
        const idx = mockMessages.findIndex((m) => m.id === input.id);
        if (idx === -1) throw new Error("Bericht niet gevonden");
        const base = mockMessages[idx];
        const newBody =
          input.body_override ??
          (input.hint
            ? `[Herzien met instructie: "${input.hint}"]\n\n${base.body_text}`
            : `[Opnieuw gegenereerd]\n\n${base.body_text}`);
        mockMessages[idx] = {
          ...base,
          body_text: newBody,
          status: "drafted",
          created_at: new Date().toISOString(),
        };
        syncMessages();
        return mockMessages[idx];
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach"] }),
  });
}

// ─── Quotas ──────────────────────────────────────────────────────────────────

export function useOutreachQuotas() {
  return useQuery({
    queryKey: ["outreach", "quotas"],
    queryFn: async (): Promise<OutreachQuota[]> => {
      try {
        const { data } = await api.get<{ items: OutreachQuota[] }>(
          "/outreach/quotas"
        );
        return data.items;
      } catch {
        return [...mockQuotas];
      }
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
      try {
        const { data } = await api.patch<OutreachQuota>(
          `/outreach/quotas/${input.recruiterId}/${input.channel}`,
          { daily_limit: input.daily_limit, weekly_limit: input.weekly_limit }
        );
        return data;
      } catch {
        const idx = mockQuotas.findIndex(
          (q) => q.recruiter_id === input.recruiterId && q.channel === input.channel
        );
        if (idx === -1) throw new Error("Quota niet gevonden");
        mockQuotas[idx] = {
          ...mockQuotas[idx],
          daily_limit: input.daily_limit ?? mockQuotas[idx].daily_limit,
          weekly_limit: input.weekly_limit ?? mockQuotas[idx].weekly_limit,
        };
        syncQuotas();
        return mockQuotas[idx];
      }
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
    queryFn: async (): Promise<
      Array<{
        classification: ReplyClassification;
        reply: OutreachMessage | null;
        original: OutreachMessage | null;
      }>
    > => {
      try {
        const { data } = await api.get<{
          items: Array<{
            classification: ReplyClassification;
            reply: OutreachMessage | null;
            original: OutreachMessage | null;
          }>;
        }>("/outreach/replies", { params: filters });
        return data.items;
      } catch {
        return mockClassifications
          .filter((c) => {
            if (filters.category && c.category !== filters.category) return false;
            return true;
          })
          .map((c) => {
            const reply =
              mockMessages.find((m) => m.id === c.message_id) ?? null;
            const original = reply?.reply_message_id
              ? mockMessages.find((m) => m.id === reply.reply_message_id) ?? null
              : reply
                ? mockMessages.find(
                    (m) => m.reply_message_id === reply.id
                  ) ?? null
                : null;
            return { classification: c, reply, original };
          });
      }
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
      try {
        const { data } = await api.get<{ items: CandidateSignal[] }>(
          "/outreach/signals",
          { params: filters }
        );
        return data.items;
      } catch {
        return mockSignals
          .filter((s) => {
            if (filters.signal_type && s.signal_type !== filters.signal_type)
              return false;
            if (filters.unreviewed && s.reviewed) return false;
            return true;
          })
          .sort((a, b) => b.detected_at.localeCompare(a.detected_at));
      }
    },
  });
}

export function useDismissSignal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      try {
        await api.post(`/outreach/signals/${id}/dismiss`);
      } catch {
        const idx = mockSignals.findIndex((s) => s.id === id);
        if (idx !== -1) {
          mockSignals[idx] = {
            ...mockSignals[idx],
            reviewed: true,
            triggered_action: "dismissed",
          };
          syncSignals();
        }
      }
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
    }): Promise<{ enrollment_id: string }> => {
      try {
        const { data } = await api.post<{ enrollment_id: string }>(
          `/outreach/signals/${signalId}/draft-reactivation`,
          { sequence_id: sequenceId }
        );
        return data;
      } catch {
        const idx = mockSignals.findIndex((s) => s.id === signalId);
        if (idx !== -1) {
          mockSignals[idx] = {
            ...mockSignals[idx],
            reviewed: true,
            triggered_action: `drafted_reactivation:${sequenceId}`,
          };
          syncSignals();
        }
        return { enrollment_id: `enr-${Date.now()}` };
      }
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["outreach", "signals"] }),
  });
}
