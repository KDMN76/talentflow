import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { mockApplications, mockCandidates } from "@/lib/mockData";
import type {
  BulkActionInput,
  BulkActionResult,
} from "@/lib/types/atsExtensions";

/**
 * Generic bulk-action mutation. The API consolidates archive/tag/source/move
 * into a single endpoint that takes an `action` discriminator.
 *
 * Mock-fallback mutates the in-memory `mockCandidates` table (and pipeline
 * `mockApplications` for stage-changes) so dev-mode reflects the change.
 */
function applyMockBulkAction(input: BulkActionInput): BulkActionResult {
  let affected = 0;
  for (const id of input.ids) {
    const idx = mockCandidates.findIndex((c) => c.id === id);
    if (idx === -1) continue;

    const cur = mockCandidates[idx];
    switch (input.action) {
      case "archive": {
        mockCandidates[idx] = {
          ...cur,
          deleted_at: new Date().toISOString(),
        };
        affected++;
        break;
      }
      case "add_tag": {
        const tag = (input.payload?.tag as string | undefined) ?? "";
        if (!tag) break;
        const tags = Array.from(new Set([...(cur.tags ?? []), tag]));
        mockCandidates[idx] = { ...cur, tags };
        affected++;
        break;
      }
      case "remove_tag": {
        const tag = (input.payload?.tag as string | undefined) ?? "";
        if (!tag) break;
        mockCandidates[idx] = {
          ...cur,
          tags: (cur.tags ?? []).filter((t) => t !== tag),
        };
        affected++;
        break;
      }
      case "change_source": {
        const source = (input.payload?.source as string | undefined) ?? "";
        if (!source) break;
        mockCandidates[idx] = { ...cur, source };
        affected++;
        break;
      }
      case "move_to_stage": {
        // For pipeline-context bulk actions: ids may refer to applications.
        const stage_id = input.payload?.stage_id as string | undefined;
        if (!stage_id) break;
        for (const appId of input.ids) {
          const aIdx = mockApplications.findIndex((a) => a.id === appId);
          if (aIdx !== -1) {
            mockApplications[aIdx] = { ...mockApplications[aIdx], stage_id };
            affected++;
          }
        }
        break;
      }
    }
  }
  return { affected, failed: input.ids.length - affected };
}

export function useBulkAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkActionInput): Promise<BulkActionResult> => {
      try {
        const { data } = await api.post<BulkActionResult>(
          "/candidates/bulk-actions",
          input
        );
        return data;
      } catch {
        return applyMockBulkAction(input);
      }
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
