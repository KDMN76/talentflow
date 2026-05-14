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
 *
 * Mock-mode call progression (after useInitiateCall):
 *   queued → ringing@1s → in_progress@3s → completed@30s + recording_url.
 *   transcription_status: null → pending (on completed) → done@5s after pending.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { mockVoiceCalls, mockVoiceIntegration } from "@/lib/mockData";
import type { CallStatus, VoiceCall, VoiceIntegration } from "@/lib/types/voice";

export type { CallStatus, VoiceCall, VoiceIntegration } from "@/lib/types/voice";

// ─── Mock state ──────────────────────────────────────────────────────────────

let mockIntegration: VoiceIntegration = { ...mockVoiceIntegration };
let mockCalls: VoiceCall[] = [...mockVoiceCalls];

function syncCalls() {
  mockVoiceCalls.length = 0;
  mockVoiceCalls.push(...mockCalls);
}

/** Per-call clock: progresses queued → completed over 30s. */
const callStartTimes: Record<string, number> = {};
const transcriptionStartTimes: Record<string, number> = {};

function progressMockCalls() {
  const now = Date.now();
  for (const c of mockCalls) {
    if (
      c.status === "completed" ||
      c.status === "failed" ||
      c.status === "canceled" ||
      c.status === "no_answer" ||
      c.status === "busy" ||
      c.status === "voicemail"
    ) {
      // Maybe progress transcription
      if (c.transcription_status === "pending") {
        const start = transcriptionStartTimes[c.id];
        if (start && now - start >= 5_000) {
          c.transcription_status = "done";
          c.transcription_text =
            c.transcription_text ??
            "Recruiter: Hi, dankjewel voor het terugbellen. — Kandidaat: Geen probleem, ik ben benieuwd. — Recruiter: We bespreken de rol en volgende stappen. — Kandidaat: Klinkt goed, plan maar een gesprek in.";
        }
      }
      continue;
    }
    const start = callStartTimes[c.id];
    if (!start) continue;
    const elapsed = now - start;
    let newStatus: CallStatus = c.status;
    if (elapsed >= 30_000) {
      newStatus = "completed";
      c.duration_seconds = 27;
      c.answered_at = c.answered_at ?? new Date(start + 3_000).toISOString();
      c.ended_at = new Date(start + 30_000).toISOString();
      c.recording_url = `https://example.com/recordings/${c.id}.mp3`;
      c.transcription_status = "pending";
      transcriptionStartTimes[c.id] = now;
    } else if (elapsed >= 3_000) {
      newStatus = "in_progress";
      c.answered_at = c.answered_at ?? new Date(start + 3_000).toISOString();
    } else if (elapsed >= 1_000) {
      newStatus = "ringing";
    } else {
      newStatus = "queued";
    }
    c.status = newStatus;
  }
}

// ─── Integration ─────────────────────────────────────────────────────────────

export function useVoiceIntegration() {
  return useQuery({
    queryKey: ["voice", "integration"],
    queryFn: async (): Promise<VoiceIntegration> => {
      try {
        const { data } = await api.get<VoiceIntegration>("/voice/integration");
        return data;
      } catch {
        return { ...mockIntegration };
      }
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
      try {
        const { data } = await api.post<VoiceIntegration>(
          "/voice/integration/connect",
          input
        );
        return data;
      } catch {
        mockIntegration = {
          ...mockIntegration,
          status: "connected",
          account_sid: input.account_sid,
          phone_number: input.phone_number,
          connected_at: new Date().toISOString(),
          last_error: null,
        };
        return { ...mockIntegration };
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["voice"] }),
  });
}

export function useDisconnectVoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      try {
        await api.delete("/voice/integration");
      } catch {
        mockIntegration = {
          ...mockIntegration,
          status: "disconnected",
          account_sid: null,
          phone_number: null,
          connected_at: null,
        };
      }
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
      try {
        const { data } = await api.get<{ items: VoiceCall[] }>("/voice/calls", {
          params: filters,
        });
        return data.items;
      } catch {
        progressMockCalls();
        return mockCalls
          .filter((c) => {
            if (filters.candidate_id && c.candidate_id !== filters.candidate_id)
              return false;
            if (filters.direction && c.direction !== filters.direction) return false;
            if (filters.status && c.status !== filters.status) return false;
            return true;
          })
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
      }
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
      try {
        const { data } = await api.get<VoiceCall>(`/voice/calls/${callId}`);
        return data;
      } catch {
        progressMockCalls();
        const found = mockCalls.find((c) => c.id === callId);
        if (!found) throw new Error("Call niet gevonden");
        return found;
      }
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
      try {
        const { data } = await api.post<VoiceCall>("/voice/calls", {
          candidate_id: input.candidate_id,
        });
        return data;
      } catch {
        const now = Date.now();
        const id = `call-${now}`;
        const created: VoiceCall = {
          id,
          candidate_id: input.candidate_id,
          candidate_name: input.candidate_name,
          direction: "outbound",
          status: "queued",
          from_number: mockIntegration.phone_number ?? "+31 20 8080 808",
          to_number: "+31 6 0000 0000",
          duration_seconds: 0,
          recording_url: null,
          transcription_text: null,
          transcription_status: null,
          voicemail: false,
          notes: null,
          started_at: new Date(now).toISOString(),
          answered_at: null,
          ended_at: null,
          created_at: new Date(now).toISOString(),
        };
        callStartTimes[id] = now;
        mockCalls = [created, ...mockCalls];
        syncCalls();
        return created;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["voice"] }),
  });
}

export function useEndCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (callId: string): Promise<void> => {
      try {
        await api.post(`/voice/calls/${callId}/end`);
      } catch {
        const idx = mockCalls.findIndex((c) => c.id === callId);
        if (idx >= 0) {
          mockCalls[idx] = {
            ...mockCalls[idx],
            status: "completed",
            ended_at: new Date().toISOString(),
          };
          syncCalls();
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["voice"] }),
  });
}

export function useCallNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { callId: string; notes: string }): Promise<void> => {
      try {
        await api.post(`/voice/calls/${input.callId}/notes`, {
          notes: input.notes,
        });
      } catch {
        const idx = mockCalls.findIndex((c) => c.id === input.callId);
        if (idx >= 0) {
          mockCalls[idx] = { ...mockCalls[idx], notes: input.notes };
          syncCalls();
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["voice"] }),
  });
}

export function useRequestTranscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (callId: string): Promise<void> => {
      try {
        await api.post(`/voice/calls/${callId}/transcribe`);
      } catch {
        const idx = mockCalls.findIndex((c) => c.id === callId);
        if (idx >= 0) {
          mockCalls[idx] = { ...mockCalls[idx], transcription_status: "pending" };
          transcriptionStartTimes[callId] = Date.now();
          syncCalls();
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["voice"] }),
  });
}
