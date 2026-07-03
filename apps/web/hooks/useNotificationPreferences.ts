"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  NotificationPreferences,
  NotificationPreferencesUpdate,
} from "@talentflow/contracts";

/**
 * Notificatie-voorkeuren — geconsolideerd object op
 * `GET/PUT /api/notifications/preferences`.
 *
 * Wire-shape is `NotificationPreferencesSchema` uit @talentflow/contracts:
 * `{ push_enabled, events{}, quiet_hours_start, quiet_hours_end, timezone }`.
 * De API mapt dit server-side naar de per-rij-tabel; de frontend hoeft
 * alleen dit ene object te kennen.
 */

const QUERY_KEY = "notification-preferences";

export function useNotificationPreferences() {
  return useQuery({
    queryKey: [QUERY_KEY],
    queryFn: async (): Promise<NotificationPreferences> => {
      const { data } = await api.get<NotificationPreferences>(
        "/notifications/preferences"
      );
      return data;
    },
  });
}

export function useSaveNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: NotificationPreferencesUpdate
    ): Promise<NotificationPreferences> => {
      const { data } = await api.put<NotificationPreferences>(
        "/notifications/preferences",
        input
      );
      return data;
    },
    onSuccess: (saved) => {
      // PUT geeft de volledige opgeslagen staat terug — cache direct
      // bijwerken zodat een refetch niet nodig is.
      queryClient.setQueryData([QUERY_KEY], saved);
    },
  });
}
