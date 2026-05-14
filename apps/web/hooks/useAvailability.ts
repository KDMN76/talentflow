"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { mockTeamMembers, mockUserAvailability } from "@/lib/mockData";
import type {
  AvailabilityOverride,
  RecurringHours,
  UserAvailability,
} from "@/lib/types/interviews";

const DEFAULT_HOURS: RecurringHours[] = [
  { weekday: "monday", start: "09:00", end: "17:00" },
  { weekday: "tuesday", start: "09:00", end: "17:00" },
  { weekday: "wednesday", start: "09:00", end: "17:00" },
  { weekday: "thursday", start: "09:00", end: "17:00" },
  { weekday: "friday", start: "09:00", end: "17:00" },
];

export function useAvailability(userId: string | null) {
  return useQuery({
    queryKey: ["user-availability", userId],
    queryFn: async (): Promise<UserAvailability | null> => {
      if (!userId) return null;
      try {
        const { data } = await api.get<UserAvailability>(
          `/interviews/availability/${userId}`
        );
        return data;
      } catch {
        if (mockUserAvailability[userId]) return mockUserAvailability[userId];
        const u = mockTeamMembers.find((m) => m.id === userId);
        return {
          user_id: userId,
          user_name: u?.name ?? "Onbekend",
          timezone: "Europe/Amsterdam",
          recurring_hours: DEFAULT_HOURS,
          overrides: [],
        };
      }
    },
    enabled: !!userId,
  });
}

export function useSetAvailability(userId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    UserAvailability,
    Error,
    {
      timezone?: string;
      recurring_hours?: RecurringHours[];
      overrides?: AvailabilityOverride[];
    }
  >({
    mutationFn: async (input) => {
      try {
        const { data } = await api.put<UserAvailability>(
          `/interviews/availability/${userId}`,
          input
        );
        return data;
      } catch {
        const existing = mockUserAvailability[userId] ?? {
          user_id: userId,
          user_name:
            mockTeamMembers.find((m) => m.id === userId)?.name ?? "Onbekend",
          timezone: "Europe/Amsterdam",
          recurring_hours: DEFAULT_HOURS,
          overrides: [],
        };
        const next: UserAvailability = {
          ...existing,
          timezone: input.timezone ?? existing.timezone,
          recurring_hours: input.recurring_hours ?? existing.recurring_hours,
          overrides: input.overrides ?? existing.overrides,
        };
        mockUserAvailability[userId] = next;
        return next;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-availability", userId] });
    },
  });
}

export function useAddAvailabilityOverride(userId: string) {
  const queryClient = useQueryClient();
  return useMutation<UserAvailability, Error, AvailabilityOverride>({
    mutationFn: async (override) => {
      try {
        const { data } = await api.post<UserAvailability>(
          `/interviews/availability/${userId}/override`,
          override
        );
        return data;
      } catch {
        const existing =
          mockUserAvailability[userId] ??
          ({
            user_id: userId,
            user_name:
              mockTeamMembers.find((m) => m.id === userId)?.name ?? "Onbekend",
            timezone: "Europe/Amsterdam",
            recurring_hours: DEFAULT_HOURS,
            overrides: [],
          } as UserAvailability);
        const overrides = [
          ...existing.overrides.filter((o) => o.date !== override.date),
          override,
        ];
        mockUserAvailability[userId] = { ...existing, overrides };
        return mockUserAvailability[userId];
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-availability", userId] });
    },
  });
}
