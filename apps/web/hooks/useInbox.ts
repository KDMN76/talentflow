"use client";

/**
 * Sprint Q4.6 — React-Query hooks for the unified omni-channel inbox.
 *
 * Backend contract (Agent AAAA):
 *   GET    /api/inbox/threads                ?unread&channel&assignee_user_id&pinned&archived&q&cursor
 *   GET    /api/inbox/threads/:id
 *   GET    /api/inbox/threads/:id/timeline   ?before&limit
 *   POST   /api/inbox/threads/:id/read
 *   POST   /api/inbox/threads/:id/assign     body { user_id }
 *   POST   /api/inbox/threads/:id/pin
 *   POST   /api/inbox/threads/:id/unpin
 *   POST   /api/inbox/threads/:id/archive
 *   POST   /api/inbox/threads/:id/unarchive
 *   POST   /api/inbox/threads/:id/labels     body { label }
 *   DELETE /api/inbox/threads/:id/labels/:label
 *
 * Mock-mode behaviour:
 *   - useInboxThreads polls every 10s.
 *   - Every ~12s a new inbound message is added to one of the existing threads
 *     (round-robin), advancing last_message_at, last_message_preview and
 *     unread_count_for_assignee.
 *   - useThreadTimeline polls every 6s while the thread is open.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  mockUnifiedThreads,
  mockTimelineEvents,
} from "@/lib/mockData";
import type {
  ChannelType,
  UnifiedThread,
  TimelineEvent,
} from "@/lib/types/inbox";

export type {
  ChannelType,
  UnifiedThread,
  TimelineEvent,
} from "@/lib/types/inbox";

// ─── Mock state ──────────────────────────────────────────────────────────────

let mockThreads: UnifiedThread[] = [...mockUnifiedThreads];
const mockTimelines: Record<string, TimelineEvent[]> = Object.fromEntries(
  Object.entries(mockTimelineEvents).map(([k, v]) => [k, [...v]])
);

function syncThreads() {
  mockUnifiedThreads.length = 0;
  mockUnifiedThreads.push(...mockThreads);
}

const MOCK_INBOUND_MESSAGES: { channel: ChannelType; preview: string; body: string }[] = [
  { channel: "whatsapp", preview: "Kun je een korte update geven over de status?", body: "Hoi! Kun je een korte update geven over de status van mijn sollicitatie?" },
  { channel: "email", preview: "Re: vervolg — wanneer hoor ik wat?", body: "Beste recruiter,\n\nIk wilde even informeren wanneer ik feedback kan verwachten.\n\nMet vriendelijke groet" },
  { channel: "linkedin_inmail", preview: "Interesse in een gesprek?", body: "Hi! Ik zag jullie profiel en zou graag een keer kennismaken." },
  { channel: "sms", preview: "Bedankt voor de terugbel-afspraak", body: "Bedankt voor de terugbel-afspraak — tot dan!" },
  { channel: "voice", preview: "Voicemail — 28s", body: "Voicemail van 28 seconden. Transcriptie volgt." },
  { channel: "whatsapp", preview: "Nog 1 korte vraag over de rol…", body: "Nog 1 korte vraag — werken jullie remote of hybride?" },
];

let mockProgressionTickCounter = 0;
let lastProgressionTime = 0;

/** Advances mock-state: ~once every ≥12s a new inbound message appears. */
function progressMockInbox() {
  const now = Date.now();
  if (now - lastProgressionTime < 12_000) return;
  lastProgressionTime = now;

  if (mockThreads.length === 0) return;

  const target = mockThreads[mockProgressionTickCounter % mockThreads.length];
  mockProgressionTickCounter += 1;

  const msg = MOCK_INBOUND_MESSAGES[mockProgressionTickCounter % MOCK_INBOUND_MESSAGES.length];
  const nowIso = new Date(now).toISOString();

  // Update thread
  const idx = mockThreads.indexOf(target);
  if (idx >= 0) {
    mockThreads[idx] = {
      ...target,
      last_message_at: nowIso,
      last_channel: msg.channel,
      last_message_preview: msg.preview,
      unread_count_for_assignee: target.unread_count_for_assignee + 1,
      archived_at: null,
      updated_at: nowIso,
    };
  }

  // Append to timeline if we already have one
  const existingTl = mockTimelines[target.id];
  const event: TimelineEvent = {
    id: `te-${target.id}-${mockProgressionTickCounter}`,
    channel: msg.channel,
    direction: "inbound",
    timestamp: nowIso,
    sender_name: target.candidate_name ?? "Onbekende kandidaat",
    preview: msg.preview,
    body: msg.body,
    attachments: [],
    metadata: { auto_generated: true },
  };
  if (existingTl) {
    existingTl.push(event);
  } else {
    mockTimelines[target.id] = [event];
  }
  syncThreads();
}

// ─── Threads list ────────────────────────────────────────────────────────────

export interface InboxFilters {
  unread?: boolean;
  channel?: ChannelType;
  assignee_user_id?: string;
  pinned?: boolean;
  archived?: boolean;
  q?: string;
}

export function useInboxThreads(filters: InboxFilters = {}) {
  return useQuery({
    queryKey: ["inbox", "threads", filters],
    queryFn: async (): Promise<UnifiedThread[]> => {
      try {
        const { data } = await api.get<{ items: UnifiedThread[] }>(
          "/inbox/threads",
          { params: filters }
        );
        return data.items;
      } catch {
        progressMockInbox();
        const q = (filters.q ?? "").toLowerCase();
        return mockThreads
          .filter((t) => {
            if (filters.unread && t.unread_count_for_assignee === 0) return false;
            if (filters.channel && t.last_channel !== filters.channel) return false;
            if (
              filters.assignee_user_id &&
              t.assignee_user_id !== filters.assignee_user_id
            )
              return false;
            if (filters.pinned !== undefined && t.pinned !== filters.pinned)
              return false;
            const isArchived = t.archived_at !== null;
            if (filters.archived !== undefined && isArchived !== filters.archived)
              return false;
            // Hide archived from default views unless explicitly requested
            if (filters.archived === undefined && isArchived) return false;
            if (
              q &&
              !(t.candidate_name ?? "").toLowerCase().includes(q) &&
              !t.last_message_preview.toLowerCase().includes(q) &&
              !t.labels.some((l) => l.toLowerCase().includes(q))
            )
              return false;
            return true;
          })
          .sort((a, b) => {
            // Pinned first, then by last_message_at desc
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            return b.last_message_at.localeCompare(a.last_message_at);
          });
      }
    },
    refetchInterval: 10_000,
  });
}

export function useInboxThread(threadId: string | undefined) {
  return useQuery({
    queryKey: ["inbox", "thread", threadId ?? "none"],
    enabled: !!threadId,
    queryFn: async (): Promise<UnifiedThread> => {
      if (!threadId) throw new Error("Geen thread-ID");
      try {
        const { data } = await api.get<UnifiedThread>(
          `/inbox/threads/${threadId}`
        );
        return data;
      } catch {
        const found = mockThreads.find((t) => t.id === threadId);
        if (!found) throw new Error("Thread niet gevonden");
        return found;
      }
    },
  });
}

export function useThreadTimeline(threadId: string | undefined) {
  return useQuery({
    queryKey: ["inbox", "thread", threadId ?? "none", "timeline"],
    enabled: !!threadId,
    queryFn: async (): Promise<TimelineEvent[]> => {
      if (!threadId) throw new Error("Geen thread-ID");
      try {
        const { data } = await api.get<{ items: TimelineEvent[] }>(
          `/inbox/threads/${threadId}/timeline`
        );
        return data.items;
      } catch {
        progressMockInbox();
        const events = mockTimelines[threadId] ?? [];
        return [...events].sort((a, b) =>
          b.timestamp.localeCompare(a.timestamp)
        );
      }
    },
    refetchInterval: 6_000,
  });
}

// ─── Thread actions ──────────────────────────────────────────────────────────

export function useMarkThreadRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (threadId: string): Promise<void> => {
      try {
        await api.post(`/inbox/threads/${threadId}/read`);
      } catch {
        const idx = mockThreads.findIndex((t) => t.id === threadId);
        if (idx >= 0) {
          mockThreads[idx] = { ...mockThreads[idx], unread_count_for_assignee: 0 };
          syncThreads();
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }),
  });
}

export function useAssignThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      threadId: string;
      user_id: string;
      user_name?: string;
    }): Promise<void> => {
      try {
        await api.post(`/inbox/threads/${input.threadId}/assign`, {
          user_id: input.user_id,
        });
      } catch {
        const idx = mockThreads.findIndex((t) => t.id === input.threadId);
        if (idx >= 0) {
          mockThreads[idx] = {
            ...mockThreads[idx],
            assignee_user_id: input.user_id,
            assignee_name: input.user_name ?? mockThreads[idx].assignee_name,
          };
          syncThreads();
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }),
  });
}

export function usePinThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      threadId: string;
      pinned: boolean;
    }): Promise<void> => {
      const url = `/inbox/threads/${input.threadId}/${input.pinned ? "pin" : "unpin"}`;
      try {
        await api.post(url);
      } catch {
        const idx = mockThreads.findIndex((t) => t.id === input.threadId);
        if (idx >= 0) {
          mockThreads[idx] = { ...mockThreads[idx], pinned: input.pinned };
          syncThreads();
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }),
  });
}

export function useArchiveThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      threadId: string;
      archived: boolean;
    }): Promise<void> => {
      const url = `/inbox/threads/${input.threadId}/${input.archived ? "archive" : "unarchive"}`;
      try {
        await api.post(url);
      } catch {
        const idx = mockThreads.findIndex((t) => t.id === input.threadId);
        if (idx >= 0) {
          mockThreads[idx] = {
            ...mockThreads[idx],
            archived_at: input.archived ? new Date().toISOString() : null,
          };
          syncThreads();
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }),
  });
}

export function useThreadLabels() {
  const qc = useQueryClient();
  const addLabel = useMutation({
    mutationFn: async (input: { threadId: string; label: string }): Promise<void> => {
      try {
        await api.post(`/inbox/threads/${input.threadId}/labels`, {
          label: input.label,
        });
      } catch {
        const idx = mockThreads.findIndex((t) => t.id === input.threadId);
        if (idx >= 0 && !mockThreads[idx].labels.includes(input.label)) {
          mockThreads[idx] = {
            ...mockThreads[idx],
            labels: [...mockThreads[idx].labels, input.label],
          };
          syncThreads();
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }),
  });

  const removeLabel = useMutation({
    mutationFn: async (input: { threadId: string; label: string }): Promise<void> => {
      try {
        await api.delete(
          `/inbox/threads/${input.threadId}/labels/${encodeURIComponent(
            input.label
          )}`
        );
      } catch {
        const idx = mockThreads.findIndex((t) => t.id === input.threadId);
        if (idx >= 0) {
          mockThreads[idx] = {
            ...mockThreads[idx],
            labels: mockThreads[idx].labels.filter((l) => l !== input.label),
          };
          syncThreads();
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }),
  });

  return { addLabel, removeLabel };
}
