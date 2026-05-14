"use client";

/**
 * useCareerPageBuilder — thin facade for the builder UI.
 *
 * Re-exports the existing `useCareerPage` and `useUpdateCareerPageBlocks`
 * with names that read more naturally inside the builder, plus a tiny
 * helper to merge the freshly-saved blocks back into the cached page so
 * the canvas stays in sync after a save.
 *
 * The actual mutation already implements try/catch with mock-fallback
 * (see hooks/useCareerPages.ts), so we don't duplicate that logic here.
 */

import { useQueryClient } from "@tanstack/react-query";
import {
  useCareerPage,
  useUpdateCareerPageBlocks,
  type CareerPage,
  type CareerPageBlock,
} from "./useCareerPages";

export function useCareerPageWithBlocks(id: string) {
  return useCareerPage(id);
}

export function useUpdateBuilderBlocks(id: string) {
  const mutation = useUpdateCareerPageBlocks(id);
  const queryClient = useQueryClient();

  return {
    ...mutation,
    saveBlocks: async (blocks: CareerPageBlock[]) => {
      const saved = await mutation.mutateAsync(blocks);
      // Optimistically reflect the saved blocks in the detail-cache so the
      // builder canvas stays consistent without waiting for a refetch.
      queryClient.setQueryData<CareerPage | undefined>(
        ["career-pages", id],
        (prev) => (prev ? { ...prev, blocks: saved } : prev)
      );
      return saved;
    },
  };
}
