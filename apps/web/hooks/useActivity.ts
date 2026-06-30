"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface ActivityItem {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  payload: Record<string, unknown>;
  created_at: string;
  user_name: string | null;
}

export interface ActivityPage {
  data: ActivityItem[];
  meta: { total: number; page: number; limit: number; pages: number };
}

/** Paginated volledige activiteitenfeed (GET /dashboard/activity). */
export function useActivityLog(page: number, limit = 25) {
  return useQuery<ActivityPage>({
    queryKey: ["activity-log", page, limit],
    queryFn: async () => {
      const { data } = await api.get<ActivityPage>("/dashboard/activity", {
        params: { page, limit },
      });
      return data;
    },
  });
}
