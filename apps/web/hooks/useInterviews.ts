"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  AvailableSlot,
  AvailableSlotsRequest,
  Interview,
  InterviewFilters,
  InterviewStatus,
  ScheduleInterviewInput,
} from "@/lib/types/interviews";

/**
 * Sprint Q3.4 — Interview hooks.
 */

// ─── Listing ─────────────────────────────────────────────────────────────────

export function useInterviews(filters: InterviewFilters = {}) {
  return useQuery({
    queryKey: ["interviews", filters],
    queryFn: async (): Promise<Interview[]> => {
      const { data } = await api.get<{ data: Interview[] }>("/interviews", {
        params: filters,
      });
      return data.data;
    },
  });
}

export function useInterview(id: string | null) {
  return useQuery({
    queryKey: ["interview", id],
    queryFn: async (): Promise<Interview | null> => {
      if (!id) return null;
      const { data } = await api.get<Interview>(`/interviews/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export function useScheduleInterview() {
  const queryClient = useQueryClient();
  return useMutation<Interview, Error, ScheduleInterviewInput>({
    mutationFn: async (input) => {
      const { data } = await api.post<Interview>("/interviews", input);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["interviews"] });
    },
  });
}

export function useCancelInterview() {
  const queryClient = useQueryClient();
  return useMutation<Interview, Error, { id: string; reason?: string }>({
    mutationFn: async ({ id, reason }) => {
      const { data } = await api.patch<Interview>(`/interviews/${id}`, {
        status: "cancelled",
        notes_append: reason,
      });
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["interviews"] });
      queryClient.invalidateQueries({ queryKey: ["interview", data.id] });
    },
  });
}

export function useRescheduleInterview() {
  const queryClient = useQueryClient();
  return useMutation<
    Interview,
    Error,
    { id: string; scheduled_start: string; duration_minutes?: number }
  >({
    mutationFn: async ({ id, scheduled_start, duration_minutes }) => {
      const { data } = await api.patch<Interview>(`/interviews/${id}`, {
        scheduled_start,
        duration_minutes,
      });
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["interviews"] });
      queryClient.invalidateQueries({ queryKey: ["interview", data.id] });
    },
  });
}

export function useUpdateInterview() {
  const queryClient = useQueryClient();
  return useMutation<
    Interview,
    Error,
    { id: string; patch: Partial<Interview> }
  >({
    mutationFn: async ({ id, patch }) => {
      const { data } = await api.patch<Interview>(`/interviews/${id}`, patch);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["interviews"] });
      queryClient.invalidateQueries({ queryKey: ["interview", data.id] });
    },
  });
}

// ─── Status counts for tab badges ───────────────────────────────────────────
//
// NOTE: This hook has no API endpoint yet — it computes counts from the
// in-memory mock store. It has no try/catch and no silent fallback, so it is
// preserved as-is until a real endpoint exists.

export function useInterviewCountsByStatus() {
  return useQuery({
    queryKey: ["interviews", "counts-by-status"],
    queryFn: async (): Promise<Record<InterviewStatus | "all", number>> => {
      // Geen dedicated /interviews/counts endpoint — we listen alle interviews
      // van de tenant en aggregeren hier. Voor schaal (>1000 interviews) zou
      // een server-side aggregate-endpoint efficiënter zijn; los op zodra dat
      // pijn doet, niet eerder.
      const { data } = await api.get<{ data: Interview[] }>("/interviews");
      const interviews = data.data;
      const counts: Record<string, number> = { all: interviews.length };
      for (const iv of interviews) {
        counts[iv.status] = (counts[iv.status] ?? 0) + 1;
      }
      return counts as Record<InterviewStatus | "all", number>;
    },
    staleTime: 30_000,
  });
}

// ─── Available slots ─────────────────────────────────────────────────────────

export function useAvailableSlots(
  request: AvailableSlotsRequest | null,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ["interviews", "slots", request],
    queryFn: async (): Promise<AvailableSlot[]> => {
      if (!request) return [];
      const { data } = await api.post<{ data: AvailableSlot[] }>(
        "/interviews/availability/slots",
        request
      );
      return data.data;
    },
    enabled: options?.enabled !== false && !!request,
    staleTime: 30_000,
  });
}
