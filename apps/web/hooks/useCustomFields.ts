"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  CreateCustomFieldInput,
  CustomFieldDefinition,
  CustomFieldEntityType,
} from "@/lib/types/atsExtensions";

const QUERY_KEY = "custom-fields";

export function useCustomFields(entity_type: CustomFieldEntityType) {
  return useQuery({
    queryKey: [QUERY_KEY, entity_type],
    queryFn: async (): Promise<CustomFieldDefinition[]> => {
      const { data } = await api.get<{ data: CustomFieldDefinition[] }>(
        "/custom-fields",
        { params: { entity_type } }
      );
      return data.data;
    },
  });
}

export function useCreateCustomField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: CreateCustomFieldInput
    ): Promise<CustomFieldDefinition> => {
      const { data } = await api.post<CustomFieldDefinition>(
        "/custom-fields",
        input
      );
      return data;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({
        queryKey: [QUERY_KEY, row.entity_type ?? "candidate"],
      });
    },
  });
}

export function useUpdateCustomField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: { id: string } & Partial<CreateCustomFieldInput>): Promise<CustomFieldDefinition> => {
      const { data } = await api.patch<CustomFieldDefinition>(
        `/custom-fields/${id}`,
        patch
      );
      return data;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({
        queryKey: [QUERY_KEY, row.entity_type ?? "candidate"],
      });
    },
  });
}

export function useDeleteCustomField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/custom-fields/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });
}

export function useReorderCustomFields() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      entity_type,
      orderedIds,
    }: {
      entity_type: CustomFieldEntityType;
      orderedIds: string[];
    }): Promise<void> => {
      await api.post("/custom-fields/reorder", { entity_type, orderedIds });
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, vars.entity_type] });
    },
  });
}
