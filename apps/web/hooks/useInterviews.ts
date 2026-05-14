"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  mockAvailableSlots,
  mockInterviews,
  mockTeamMembers,
} from "@/lib/mockData";
import type {
  AvailableSlot,
  AvailableSlotsRequest,
  Interview,
  InterviewFilters,
  InterviewParticipant,
  InterviewStatus,
  ScheduleInterviewInput,
} from "@/lib/types/interviews";

/**
 * Sprint Q3.4 — Interview hooks.
 *
 * Each hook follows the codebase's standard pattern: try the live API first,
 * fall back to the in-memory mock store on any network error so the UI keeps
 * functioning during local development and demo days.
 */

// ─── Listing ─────────────────────────────────────────────────────────────────

function applyFilters(rows: Interview[], filters: InterviewFilters): Interview[] {
  return rows.filter((iv) => {
    if (filters.status && filters.status !== "all" && iv.status !== filters.status) {
      return false;
    }
    if (filters.candidate_id && iv.candidate_id !== filters.candidate_id) {
      return false;
    }
    if (
      filters.interviewer_id &&
      !iv.participants.some(
        (p) =>
          p.user_id === filters.interviewer_id &&
          (p.role === "interviewer" || p.role === "hiring_manager")
      )
    ) {
      return false;
    }
    if (filters.from && new Date(iv.scheduled_start) < new Date(filters.from)) {
      return false;
    }
    if (filters.to && new Date(iv.scheduled_start) > new Date(filters.to)) {
      return false;
    }
    return true;
  });
}

export function useInterviews(filters: InterviewFilters = {}) {
  return useQuery({
    queryKey: ["interviews", filters],
    queryFn: async (): Promise<Interview[]> => {
      try {
        const { data } = await api.get<{ data: Interview[] }>("/interviews", {
          params: filters,
        });
        return data.data;
      } catch {
        return applyFilters(mockInterviews, filters).sort(
          (a, b) =>
            new Date(a.scheduled_start).getTime() -
            new Date(b.scheduled_start).getTime()
        );
      }
    },
  });
}

export function useInterview(id: string | null) {
  return useQuery({
    queryKey: ["interview", id],
    queryFn: async (): Promise<Interview | null> => {
      if (!id) return null;
      try {
        const { data } = await api.get<Interview>(`/interviews/${id}`);
        return data;
      } catch {
        return mockInterviews.find((iv) => iv.id === id) ?? null;
      }
    },
    enabled: !!id,
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export function useScheduleInterview() {
  const queryClient = useQueryClient();
  return useMutation<Interview, Error, ScheduleInterviewInput>({
    mutationFn: async (input) => {
      try {
        const { data } = await api.post<Interview>("/interviews", input);
        return data;
      } catch {
        // Resolve interviewer names from the team member directory so the
        // mocked row carries the same shape as a live response.
        const participants: InterviewParticipant[] = input.interviewer_ids.map(
          (uid, idx) => {
            const u = mockTeamMembers.find((m) => m.id === uid);
            return {
              id: `p-mock-${Date.now()}-${idx}`,
              user_id: uid,
              user_name: u?.name ?? "Onbekend",
              user_email: u?.email ?? "",
              role: "interviewer",
              rsvp: "pending",
            };
          }
        );
        const start = new Date(input.scheduled_start);
        const end = new Date(start.getTime() + input.duration_minutes * 60_000);
        const newRow: Interview = {
          id: `iv-mock-${Date.now()}`,
          tenant_id: "tenant-1",
          application_id: input.application_id,
          candidate_id: input.candidate_id,
          candidate_name: "—",
          job_id: input.job_id,
          job_title: "—",
          scheduled_start: start.toISOString(),
          scheduled_end: end.toISOString(),
          duration_minutes: input.duration_minutes,
          timezone: input.timezone,
          status: "scheduled",
          location_type: input.location_type,
          location_url: input.location_url ?? null,
          location_address: input.location_address ?? null,
          participants,
          kit_id: input.kit_id ?? null,
          kit_name: null,
          notes: input.notes ?? null,
          has_recording: false,
          scorecard_count: 0,
          created_by_id: "user-1",
          created_by_name: "Emma Bakker",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        mockInterviews.unshift(newRow);
        return newRow;
      }
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
      try {
        const { data } = await api.patch<Interview>(`/interviews/${id}`, {
          status: "cancelled",
          notes_append: reason,
        });
        return data;
      } catch {
        const iv = mockInterviews.find((i) => i.id === id);
        if (iv) {
          iv.status = "cancelled";
          if (reason) {
            iv.notes = iv.notes
              ? `${iv.notes}\n— Geannuleerd: ${reason}`
              : `Geannuleerd: ${reason}`;
          }
          iv.updated_at = new Date().toISOString();
          return iv;
        }
        throw new Error("Interview niet gevonden");
      }
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
      try {
        const { data } = await api.patch<Interview>(`/interviews/${id}`, {
          scheduled_start,
          duration_minutes,
        });
        return data;
      } catch {
        const iv = mockInterviews.find((i) => i.id === id);
        if (!iv) throw new Error("Interview niet gevonden");
        iv.scheduled_start = scheduled_start;
        const dur = duration_minutes ?? iv.duration_minutes;
        iv.duration_minutes = dur;
        iv.scheduled_end = new Date(
          new Date(scheduled_start).getTime() + dur * 60_000
        ).toISOString();
        iv.status = "scheduled";
        iv.updated_at = new Date().toISOString();
        return iv;
      }
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
      try {
        const { data } = await api.patch<Interview>(`/interviews/${id}`, patch);
        return data;
      } catch {
        const iv = mockInterviews.find((i) => i.id === id);
        if (!iv) throw new Error("Interview niet gevonden");
        Object.assign(iv, patch, { updated_at: new Date().toISOString() });
        return iv;
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["interviews"] });
      queryClient.invalidateQueries({ queryKey: ["interview", data.id] });
    },
  });
}

// ─── Status counts for tab badges ───────────────────────────────────────────

export function useInterviewCountsByStatus() {
  return useQuery({
    queryKey: ["interviews", "counts-by-status"],
    queryFn: async (): Promise<Record<InterviewStatus | "all", number>> => {
      const counts: Record<string, number> = { all: mockInterviews.length };
      for (const iv of mockInterviews) {
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
      try {
        const { data } = await api.post<{ data: AvailableSlot[] }>(
          "/interviews/availability/slots",
          request
        );
        return data.data;
      } catch {
        // Filter the deterministic mock-slot pool to only those slots within
        // the requested range that match the requested duration AND where
        // ALL of the requested interviewers are available (intersect).
        const from = new Date(request.from).getTime();
        const to = new Date(request.to).getTime();
        return mockAvailableSlots
          .filter((s) => {
            const t = new Date(s.start).getTime();
            return t >= from && t <= to;
          })
          .map((s) => ({
            ...s,
            duration_minutes: request.duration_minutes,
            end: new Date(
              new Date(s.start).getTime() + request.duration_minutes * 60_000
            ).toISOString(),
            // Compute the intersection between requested interviewers and
            // those reportedly available in this slot.
            available_interviewer_ids: request.interviewer_ids.filter((id) =>
              s.available_interviewer_ids.includes(id)
            ),
          }))
          .filter(
            (s) =>
              s.available_interviewer_ids.length === request.interviewer_ids.length
          );
      }
    },
    enabled: options?.enabled !== false && !!request,
    staleTime: 30_000,
  });
}
