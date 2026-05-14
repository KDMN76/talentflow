"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { mockSavedSearches } from "@/lib/mockData";
import type {
  CreateSavedSearchInput,
  SavedSearch,
  SavedSearchEntityType,
} from "@/lib/types/atsExtensions";

const QUERY_KEY = "saved-searches";

/**
 * List saved searches for an entity-type. Falls back to in-memory mock data
 * when the API is unreachable so dev-mode dropdowns stay populated.
 */
export function useSavedSearches(entity_type: SavedSearchEntityType = "candidates") {
  return useQuery({
    queryKey: [QUERY_KEY, entity_type],
    queryFn: async (): Promise<SavedSearch[]> => {
      try {
        const { data } = await api.get<{ data: SavedSearch[] }>(
          "/saved-searches",
          { params: { entity_type } }
        );
        return data.data;
      } catch {
        return mockSavedSearches.filter((s) => s.entity_type === entity_type);
      }
    },
  });
}

export function useCreateSavedSearch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSavedSearchInput): Promise<SavedSearch> => {
      try {
        const { data } = await api.post<SavedSearch>("/saved-searches", input);
        return data;
      } catch {
        const now = new Date().toISOString();
        const newRow: SavedSearch = {
          id: `ss-${Date.now()}`,
          tenant_id: "tenant-1",
          user_id: "user-1",
          entity_type: input.entity_type,
          name: input.name,
          query: input.query,
          filters: input.filters ?? null,
          created_at: now,
          updated_at: now,
        };
        mockSavedSearches.unshift(newRow);
        return newRow;
      }
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, row.entity_type] });
    },
  });
}

export function useDeleteSavedSearch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      try {
        await api.delete(`/saved-searches/${id}`);
      } catch {
        const idx = mockSavedSearches.findIndex((s) => s.id === id);
        if (idx !== -1) mockSavedSearches.splice(idx, 1);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });
}
