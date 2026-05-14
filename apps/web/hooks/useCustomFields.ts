"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { mockCustomFieldDefinitions } from "@/lib/mockData";
import type {
  CreateCustomFieldInput,
  CustomFieldDefinition,
  CustomFieldEntityType,
} from "@/lib/types/atsExtensions";

const QUERY_KEY = "custom-fields";

function nextPosition(entity_type: CustomFieldEntityType): number {
  const list = mockCustomFieldDefinitions[entity_type] ?? [];
  return list.reduce((max, f) => Math.max(max, f.position), 0) + 1;
}

export function useCustomFields(entity_type: CustomFieldEntityType) {
  return useQuery({
    queryKey: [QUERY_KEY, entity_type],
    queryFn: async (): Promise<CustomFieldDefinition[]> => {
      try {
        const { data } = await api.get<{ data: CustomFieldDefinition[] }>(
          "/custom-fields",
          { params: { entity_type } }
        );
        return data.data;
      } catch {
        return [...(mockCustomFieldDefinitions[entity_type] ?? [])].sort(
          (a, b) => a.position - b.position
        );
      }
    },
  });
}

export function useCreateCustomField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: CreateCustomFieldInput
    ): Promise<CustomFieldDefinition> => {
      try {
        const { data } = await api.post<CustomFieldDefinition>(
          "/custom-fields",
          input
        );
        return data;
      } catch {
        const newRow: CustomFieldDefinition = {
          id: `cf-${Date.now()}`,
          tenant_id: "tenant-1",
          entity_type: input.entity_type,
          key: input.key,
          label: input.label,
          field_type: input.field_type,
          options: input.options,
          required: input.required ?? false,
          position: input.position ?? nextPosition(input.entity_type),
          deleted_at: null,
        };
        if (!mockCustomFieldDefinitions[input.entity_type]) {
          mockCustomFieldDefinitions[input.entity_type] = [];
        }
        mockCustomFieldDefinitions[input.entity_type].push(newRow);
        return newRow;
      }
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
      try {
        const { data } = await api.patch<CustomFieldDefinition>(
          `/custom-fields/${id}`,
          patch
        );
        return data;
      } catch {
        for (const list of Object.values(mockCustomFieldDefinitions)) {
          const idx = list.findIndex((f) => f.id === id);
          if (idx !== -1) {
            list[idx] = {
              ...list[idx],
              ...(patch as Partial<CustomFieldDefinition>),
            };
            return list[idx];
          }
        }
        throw new Error("Custom field niet gevonden");
      }
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
      try {
        await api.delete(`/custom-fields/${id}`);
      } catch {
        for (const list of Object.values(mockCustomFieldDefinitions)) {
          const idx = list.findIndex((f) => f.id === id);
          if (idx !== -1) {
            list.splice(idx, 1);
            return;
          }
        }
      }
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
      try {
        await api.post("/custom-fields/reorder", { entity_type, orderedIds });
      } catch {
        const list = mockCustomFieldDefinitions[entity_type] ?? [];
        orderedIds.forEach((id, index) => {
          const idx = list.findIndex((f) => f.id === id);
          if (idx !== -1) list[idx] = { ...list[idx], position: index + 1 };
        });
      }
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, vars.entity_type] });
    },
  });
}
