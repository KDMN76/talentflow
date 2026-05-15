"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  AvailabilityOverride,
  RecurringHours,
  UserAvailability,
} from "@/lib/types/interviews";

export function useAvailability(userId: string | null) {
  return useQuery({
    queryKey: ["user-availability", userId],
    queryFn: async (): Promise<UserAvailability | null> => {
      if (!userId) return null;
      const { data } = await api.get<UserAvailability>(
        `/interviews/availability/${userId}`
      );
      return data;
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
      const { data } = await api.put<UserAvailability>(
        `/interviews/availability/${userId}`,
        input
      );
      return data;
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
      const { data } = await api.post<UserAvailability>(
        `/interviews/availability/${userId}/override`,
        override
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-availability", userId] });
    },
  });
}
