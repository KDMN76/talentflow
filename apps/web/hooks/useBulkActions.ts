"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  BulkActionInput,
  BulkActionResult,
} from "@/lib/types/atsExtensions";

/**
 * Generic bulk-action mutation. The API consolidates archive/tag/source/move
 * into a single endpoint that takes an `action` discriminator.
 */
export function useBulkAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkActionInput): Promise<BulkActionResult> => {
      const { data } = await api.post<BulkActionResult>(
        "/candidates/bulk-actions",
        input
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline"] });
    },
  });
}

export function useBulkArchive() {
  const bulk = useBulkAction();
  return {
    ...bulk,
    mutateAsync: (ids: string[]) =>
      bulk.mutateAsync({ ids, action: "archive" }),
  };
}

export function useBulkAddTag() {
  const bulk = useBulkAction();
  return {
    ...bulk,
    mutateAsync: ({ ids, tag }: { ids: string[]; tag: string }) =>
      bulk.mutateAsync({ ids, action: "add_tag", payload: { tag } }),
  };
}

export function useBulkChangeSource() {
  const bulk = useBulkAction();
  return {
    ...bulk,
    mutateAsync: ({ ids, source }: { ids: string[]; source: string }) =>
      bulk.mutateAsync({ ids, action: "change_source", payload: { source } }),
  };
}

export function useBulkMoveToStage() {
  const bulk = useBulkAction();
  return {
    ...bulk,
    mutateAsync: ({ ids, stage_id }: { ids: string[]; stage_id: string }) =>
      bulk.mutateAsync({ ids, action: "move_to_stage", payload: { stage_id } }),
  };
}

export function useBulkRemoveTag() {
  const bulk = useBulkAction();
  return {
    ...bulk,
    mutateAsync: ({ ids, tag }: { ids: string[]; tag: string }) =>
      bulk.mutateAsync({ ids, action: "remove_tag", payload: { tag } }),
  };
}
