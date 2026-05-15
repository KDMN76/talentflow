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
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
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
      const { data } = await api.get<{ items: UnifiedThread[] }>(
        "/inbox/threads",
        { params: filters }
      );
      return data.items;
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
      const { data } = await api.get<UnifiedThread>(
        `/inbox/threads/${threadId}`
      );
      return data;
    },
  });
}

export function useThreadTimeline(threadId: string | undefined) {
  return useQuery({
    queryKey: ["inbox", "thread", threadId ?? "none", "timeline"],
    enabled: !!threadId,
    queryFn: async (): Promise<TimelineEvent[]> => {
      if (!threadId) throw new Error("Geen thread-ID");
      const { data } = await api.get<{ items: TimelineEvent[] }>(
        `/inbox/threads/${threadId}/timeline`
      );
      return data.items;
    },
    refetchInterval: 6_000,
  });
}

// ─── Thread actions ──────────────────────────────────────────────────────────

export function useMarkThreadRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (threadId: string): Promise<void> => {
      await api.post(`/inbox/threads/${threadId}/read`);
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
      await api.post(`/inbox/threads/${input.threadId}/assign`, {
        user_id: input.user_id,
      });
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
      await api.post(url);
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
      await api.post(url);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }),
  });
}

export function useThreadLabels() {
  const qc = useQueryClient();
  const addLabel = useMutation({
    mutationFn: async (input: { threadId: string; label: string }): Promise<void> => {
      await api.post(`/inbox/threads/${input.threadId}/labels`, {
        label: input.label,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }),
  });

  const removeLabel = useMutation({
    mutationFn: async (input: { threadId: string; label: string }): Promise<void> => {
      await api.delete(
        `/inbox/threads/${input.threadId}/labels/${encodeURIComponent(
          input.label
        )}`
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbox"] }),
  });

  return { addLabel, removeLabel };
}
