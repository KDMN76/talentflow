"use client";

/**
 * Sprint Q4.6 — React-Query hooks for voice (Twilio) integration + calls.
 *
 * Backend contract (Agent AAAA):
 *   GET    /api/voice/integration
 *   POST   /api/voice/integration/connect    body { account_sid, auth_token, phone_number }
 *   DELETE /api/voice/integration
 *   GET    /api/voice/calls                  ?candidate_id&direction&status&cursor
 *   GET    /api/voice/calls/:id
 *   POST   /api/voice/calls                  body { candidate_id }
 *   POST   /api/voice/calls/:id/end
 *   POST   /api/voice/calls/:id/notes        body { notes }
 *   POST   /api/voice/calls/:id/transcribe
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CallStatus, VoiceCall, VoiceIntegration } from "@/lib/types/voice";

export type { CallStatus, VoiceCall, VoiceIntegration } from "@/lib/types/voice";

// ─── Integration ─────────────────────────────────────────────────────────────

export interface VoiceIntegrationState {
  /** Gekoppelde Twilio-integratie van de tenant, of null. */
  integration: VoiceIntegration | null;
  /**
   * Kan Voice in deze omgeving echt gebruikt worden? False in productie
   * zonder live Twilio-configuratie — de UI toont dan een eerlijke
   * "Voice is niet geactiveerd"-staat.
   */
  serviceActive: boolean;
}

export function useVoiceIntegration() {
  return useQuery({
    queryKey: ["voice", "integration"],
    queryFn: async (): Promise<VoiceIntegrationState> => {
      // Backend-shape: { data: VoiceIntegration | null, service_active: boolean }
      const { data } = await api.get<{
        data: VoiceIntegration | null;
        service_active?: boolean;
      }>("/voice/integration");
      return {
        integration: data.data ?? null,
        serviceActive: data.service_active ?? true,
      };
    },
  });
}

export function useConnectVoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      account_sid: string;
      auth_token: string;
      phone_number: string;
    }): Promise<VoiceIntegration> => {
      const { data } = await api.post<{ data: VoiceIntegration }>(
        "/voice/integration/connect",
        input
      );
      return data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["voice"] }),
  });
}

export function useDisconnectVoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      await api.delete("/voice/integration");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["voice"] }),
  });
}

// ─── Calls ───────────────────────────────────────────────────────────────────

export interface VoiceCallFilters {
  candidate_id?: string;
  direction?: "inbound" | "outbound";
  status?: CallStatus;
}

export function useVoiceCalls(filters: VoiceCallFilters = {}) {
  return useQuery({
    queryKey: ["voice", "calls", filters],
    queryFn: async (): Promise<VoiceCall[]> => {
      // Backend-shape: { data: VoiceCall[], next_cursor } — niet { items }.
      const { data } = await api.get<{ data: VoiceCall[] }>("/voice/calls", {
        params: filters,
      });
      return data.data ?? [];
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (
        Array.isArray(data) &&
        data.some(
          (c) =>
            c.status === "queued" ||
            c.status === "ringing" ||
            c.status === "in_progress" ||
            c.transcription_status === "pending"
        )
      ) {
        return 1_500;
      }
      return false;
    },
  });
}

export function useVoiceCall(callId: string | undefined) {
  return useQuery({
    queryKey: ["voice", "call", callId ?? "none"],
    enabled: !!callId,
    queryFn: async (): Promise<VoiceCall> => {
      if (!callId) throw new Error("Geen call-ID");
      const { data } = await api.get<{ data: VoiceCall }>(
        `/voice/calls/${callId}`
      );
      return data.data;
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (
        data &&
        (data.status === "queued" ||
          data.status === "ringing" ||
          data.status === "in_progress" ||
          data.transcription_status === "pending")
      ) {
        return 1_500;
      }
      return false;
    },
  });
}

export function useInitiateCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      candidate_id: string;
      candidate_name?: string;
    }): Promise<VoiceCall> => {
      const { data } = await api.post<{ data: VoiceCall }>("/voice/calls", {
        candidate_id: input.candidate_id,
      });
      return data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["voice"] }),
  });
}

export function useEndCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (callId: string): Promise<void> => {
      await api.post(`/voice/calls/${callId}/end`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["voice"] }),
  });
}

export function useCallNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { callId: string; notes: string }): Promise<void> => {
      await api.post(`/voice/calls/${input.callId}/notes`, {
        notes: input.notes,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["voice"] }),
  });
}

export function useRequestTranscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (callId: string): Promise<void> => {
      await api.post(`/voice/calls/${callId}/transcribe`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["voice"] }),
  });
}
