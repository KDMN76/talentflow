"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  CreateSavedSearchInput,
  SavedSearch,
  SavedSearchEntityType,
} from "@/lib/types/atsExtensions";

const QUERY_KEY = "saved-searches";

/**
 * List saved searches for an entity-type.
 */
export function useSavedSearches(entity_type: SavedSearchEntityType = "candidates") {
  return useQuery({
    queryKey: [QUERY_KEY, entity_type],
    queryFn: async (): Promise<SavedSearch[]> => {
      const { data } = await api.get<{ data: SavedSearch[] }>(
        "/saved-searches",
        { params: { entity_type } }
      );
      return data.data;
    },
  });
}

export function useCreateSavedSearch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSavedSearchInput): Promise<SavedSearch> => {
      const { data } = await api.post<SavedSearch>("/saved-searches", input);
      return data;
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
      await api.delete(`/saved-searches/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });
}
