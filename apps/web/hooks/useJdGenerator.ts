"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  JdDraft,
  JdDraftListFilters,
  JdDraftPublishOverrides,
  JdDraftPublishResponse,
  JdGeneratorInput,
} from "@/lib/types/jdGenerator";

/**
 * De jd-drafts-endpoints zijn qua envelope inconsistent: de LIST geeft
 * `{data:[...]}`, maar single/create/select/regenerate/publish geven de
 * payload UNWRAPPED terug. Deze helper is tolerant voor beide vormen —
 * `{data: X}` → X, anders de payload zelf — zodat de wizard (draft openen,
 * variant kiezen, publiceren) niet op `undefined` crasht. (Envelope netjes
 * standaardiseren staat als P2 in ROADMAP.)
 */
function pickData<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

/**
 * Hook contracts for the AI vacaturetekst-generator (Sprint Q3.2).
 *
 * Endpoints (owned by Agent VV on the backend):
 *   POST   /api/jobs/jd-drafts                          → JdDraft
 *   GET    /api/jobs/jd-drafts                          → JdDraft[]
 *   GET    /api/jobs/jd-drafts/:id                      → JdDraft
 *   POST   /api/jobs/jd-drafts/:id/select-variant
 *   POST   /api/jobs/jd-drafts/:id/regenerate
 *   POST   /api/jobs/jd-drafts/:id/publish
 *   DELETE /api/jobs/jd-drafts/:id                      (discard)
 */

// ─── List ───────────────────────────────────────────────────────────────────

export function useJdDrafts(filters?: JdDraftListFilters) {
  return useQuery({
    queryKey: ["jd-drafts", filters ?? {}],
    queryFn: async (): Promise<JdDraft[]> => {
      const params: Record<string, string> = {};
      if (filters?.status && filters.status !== "all") params.status = filters.status;
      if (filters?.date_from) params.date_from = filters.date_from;
      if (filters?.date_to) params.date_to = filters.date_to;

      const { data } = await api.get<{ data: JdDraft[] }>(
        "/jobs/jd-drafts",
        { params: Object.keys(params).length > 0 ? params : undefined }
      );
      return data.data;
    },
    staleTime: 30_000,
  });
}

// ─── Single draft ───────────────────────────────────────────────────────────

export function useJdDraft(id: string | null | undefined) {
  return useQuery({
    queryKey: ["jd-drafts", id],
    queryFn: async (): Promise<JdDraft> => {
      const { data } = await api.get(`/jobs/jd-drafts/${id}`);
      return pickData<JdDraft>(data);
    },
    enabled: !!id,
    staleTime: 30_000,
  });
}

// ─── Create — generate 3 variants from input ────────────────────────────────

export function useCreateJdDraft() {
  const queryClient = useQueryClient();
  return useMutation<JdDraft, Error, JdGeneratorInput>({
    mutationFn: async (input) => {
      const { data } = await api.post("/jobs/jd-drafts", input);
      return pickData<JdDraft>(data);
    },
    onSuccess: (draft) => {
      queryClient.setQueryData(["jd-drafts", draft.id], draft);
      queryClient.invalidateQueries({ queryKey: ["jd-drafts"] });
    },
  });
}

// ─── Select winning variant ─────────────────────────────────────────────────

export function useSelectVariant(draftId: string) {
  const queryClient = useQueryClient();
  return useMutation<JdDraft, Error, { variant_id: string }>({
    mutationFn: async ({ variant_id }) => {
      const { data } = await api.post(
        `/jobs/jd-drafts/${draftId}/select-variant`,
        { variant_id }
      );
      return pickData<JdDraft>(data);
    },
    onSuccess: (draft) => {
      queryClient.setQueryData(["jd-drafts", draft.id], draft);
      queryClient.invalidateQueries({ queryKey: ["jd-drafts"] });
    },
  });
}

// ─── Regenerate one variant ─────────────────────────────────────────────────

export function useRegenerateVariant(draftId: string) {
  const queryClient = useQueryClient();
  return useMutation<JdDraft, Error, { variant_id: string }>({
    mutationFn: async ({ variant_id }) => {
      const { data } = await api.post(
        `/jobs/jd-drafts/${draftId}/regenerate`,
        { variant_id }
      );
      return pickData<JdDraft>(data);
    },
    onSuccess: (draft) => {
      queryClient.setQueryData(["jd-drafts", draft.id], draft);
    },
  });
}

// ─── Publish ────────────────────────────────────────────────────────────────

export function usePublishJdDraft(draftId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    JdDraftPublishResponse,
    Error,
    { overrides?: JdDraftPublishOverrides }
  >({
    mutationFn: async ({ overrides }) => {
      const { data } = await api.post(
        `/jobs/jd-drafts/${draftId}/publish`,
        { overrides: overrides ?? {} }
      );
      return pickData<JdDraftPublishResponse>(data);
    },
    onSuccess: (resp) => {
      queryClient.setQueryData(["jd-drafts", resp.draft.id], resp.draft);
      queryClient.invalidateQueries({ queryKey: ["jd-drafts"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

// ─── Discard ────────────────────────────────────────────────────────────────

export function useDiscardJdDraft() {
  const queryClient = useQueryClient();
  return useMutation<{ id: string }, Error, string>({
    mutationFn: async (draftId) => {
      await api.delete(`/jobs/jd-drafts/${draftId}`);
      return { id: draftId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jd-drafts"] });
    },
  });
}
