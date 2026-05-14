"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { mockJdDrafts, mockJobs, type Job } from "@/lib/mockData";
import type {
  JdDraft,
  JdDraftListFilters,
  JdDraftPublishOverrides,
  JdDraftPublishResponse,
  JdGeneratorInput,
} from "@/lib/types/jdGenerator";

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
 *
 * Each hook follows the same try/catch + mock-fallback pattern used by the
 * rest of the app, so the wizard degrades gracefully in dev mode.
 */

const JD_AI_DISCLOSURE =
  "Deze vacaturetekst is gegenereerd door AI op basis van jouw briefing. " +
  "De recruiter behoudt het finale oordeel en kan elke variant bewerken " +
  "vóór publicatie.";

// ─── List ───────────────────────────────────────────────────────────────────

export function useJdDrafts(filters?: JdDraftListFilters) {
  return useQuery({
    queryKey: ["jd-drafts", filters ?? {}],
    queryFn: async (): Promise<JdDraft[]> => {
      try {
        const params: Record<string, string> = {};
        if (filters?.status && filters.status !== "all") params.status = filters.status;
        if (filters?.date_from) params.date_from = filters.date_from;
        if (filters?.date_to) params.date_to = filters.date_to;

        const { data } = await api.get<{ data: JdDraft[] }>(
          "/jobs/jd-drafts",
          { params: Object.keys(params).length > 0 ? params : undefined }
        );
        return data.data;
      } catch {
        return applyDraftFilters(mockJdDrafts, filters);
      }
    },
    staleTime: 30_000,
  });
}

// ─── Single draft ───────────────────────────────────────────────────────────

export function useJdDraft(id: string | null | undefined) {
  return useQuery({
    queryKey: ["jd-drafts", id],
    queryFn: async (): Promise<JdDraft> => {
      try {
        const { data } = await api.get<{ data: JdDraft }>(
          `/jobs/jd-drafts/${id}`
        );
        return data.data;
      } catch {
        const draft = mockJdDrafts.find((d) => d.id === id);
        if (!draft) throw new Error("JD-draft niet gevonden");
        return draft;
      }
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
      try {
        const { data } = await api.post<{ data: JdDraft }>(
          "/jobs/jd-drafts",
          input
        );
        return data.data;
      } catch {
        return synthesiseDraft(input);
      }
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
      try {
        const { data } = await api.post<{ data: JdDraft }>(
          `/jobs/jd-drafts/${draftId}/select-variant`,
          { variant_id }
        );
        return data.data;
      } catch {
        const draft = mockJdDrafts.find((d) => d.id === draftId);
        if (!draft) throw new Error("JD-draft niet gevonden");
        draft.selected_variant_id = variant_id;
        draft.updated_at = new Date().toISOString();
        return { ...draft };
      }
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
      try {
        const { data } = await api.post<{ data: JdDraft }>(
          `/jobs/jd-drafts/${draftId}/regenerate`,
          { variant_id }
        );
        return data.data;
      } catch {
        const draft = mockJdDrafts.find((d) => d.id === draftId);
        if (!draft) throw new Error("JD-draft niet gevonden");
        const idx = draft.variants.findIndex((v) => v.id === variant_id);
        if (idx === -1) return { ...draft };
        // Replace variant with a freshly synthesised one.
        const fresh = synthesiseSingleVariant(draft.input, idx + 100);
        draft.variants[idx] = fresh;
        draft.updated_at = new Date().toISOString();
        // If the regenerated variant was selected, drop the selection.
        if (draft.selected_variant_id === variant_id) {
          draft.selected_variant_id = null;
        }
        return { ...draft };
      }
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
      try {
        const { data } = await api.post<{ data: JdDraftPublishResponse }>(
          `/jobs/jd-drafts/${draftId}/publish`,
          { overrides: overrides ?? {} }
        );
        return data.data;
      } catch {
        const draft = mockJdDrafts.find((d) => d.id === draftId);
        if (!draft) throw new Error("JD-draft niet gevonden");
        const variant = draft.variants.find(
          (v) => v.id === draft.selected_variant_id
        );
        if (!variant) {
          throw new Error("Selecteer eerst een variant voordat je publiceert");
        }

        const newJob: Job = {
          id: `job-${Date.now()}`,
          tenant_id: "tenant-1",
          title: overrides?.title ?? variant.title,
          department: overrides?.department ?? "—",
          location: overrides?.location ?? "Amsterdam",
          description: overrides?.description ?? variant.description,
          requirements: overrides?.requirements ?? draft.input.must_haves,
          status: "draft",
          recruiter_id: "user-1",
          recruiter_name: "Emma Bakker",
          application_count: 0,
          employment_type: overrides?.employment_type,
          salary_min: overrides?.salary_min ?? null,
          salary_max: overrides?.salary_max ?? null,
          experience_level: overrides?.experience_level ?? draft.input.level,
          remote_type: overrides?.remote_type,
          currency: overrides?.currency ?? "EUR",
          salary_frequency: overrides?.salary_frequency ?? "yearly",
          open_date: overrides?.open_date ?? null,
          close_date: overrides?.close_date ?? null,
          client: overrides?.client ?? null,
          job_reference: overrides?.job_reference ?? null,
          headcount: overrides?.headcount ?? 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        mockJobs.unshift(newJob);

        draft.status = "published";
        draft.published_job_id = newJob.id;
        draft.updated_at = new Date().toISOString();

        return {
          draft: { ...draft },
          job: { id: newJob.id, title: newJob.title },
        };
      }
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
      try {
        await api.delete(`/jobs/jd-drafts/${draftId}`);
        return { id: draftId };
      } catch {
        const draft = mockJdDrafts.find((d) => d.id === draftId);
        if (draft) {
          draft.status = "discarded";
          draft.updated_at = new Date().toISOString();
        }
        return { id: draftId };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jd-drafts"] });
    },
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function applyDraftFilters(
  drafts: JdDraft[],
  filters?: JdDraftListFilters
): JdDraft[] {
  let result = [...drafts];
  if (filters?.status && filters.status !== "all") {
    result = result.filter((d) => d.status === filters.status);
  }
  if (filters?.date_from) {
    const from = new Date(filters.date_from + "T00:00:00").getTime();
    result = result.filter((d) => new Date(d.created_at).getTime() >= from);
  }
  if (filters?.date_to) {
    const to = new Date(filters.date_to + "T23:59:59").getTime();
    result = result.filter((d) => new Date(d.created_at).getTime() <= to);
  }
  result.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  return result;
}

/**
 * Synthesise a fresh draft with 3 variants from the user's input. Used as a
 * mock-fallback when the backend is unreachable. The variants vary by tone so
 * the recruiter still has a meaningful comparison view in dev mode.
 */
function synthesiseDraft(input: JdGeneratorInput): JdDraft {
  const id = `jd-draft-${Date.now()}`;
  const now = new Date().toISOString();
  const draft: JdDraft = {
    id,
    tenant_id: "tenant-1",
    role: input.role,
    input,
    variants: [
      synthesiseSingleVariant(input, 1),
      synthesiseSingleVariant(input, 2),
      synthesiseSingleVariant(input, 3),
    ],
    selected_variant_id: null,
    status: "draft",
    published_job_id: null,
    ai_disclosure: JD_AI_DISCLOSURE,
    created_at: now,
    updated_at: now,
  };
  mockJdDrafts.unshift(draft);
  return draft;
}

function synthesiseSingleVariant(
  input: JdGeneratorInput,
  seed: number
): JdDraft["variants"][number] {
  // Three deterministic flavours so the comparison view shows variety.
  const flavour = seed % 3;
  const titlePrefix =
    input.level === "junior"
      ? "Junior"
      : input.level === "medior"
      ? "Medior"
      : input.level === "senior"
      ? "Senior"
      : input.level === "lead"
      ? "Lead"
      : "Director";
  const titleSuffix =
    flavour === 0 ? "" : flavour === 1 ? " — bouw mee aan ons platform" : " (impact-rol)";
  const title = `${titlePrefix} ${input.role}${titleSuffix}`;

  const skillsList = input.key_skills.map((s) => `- ${s}`).join("\n") || "- —";
  const mustList =
    input.must_haves.map((s) => `- ${s}`).join("\n") || "- (geen)";
  const niceList =
    input.nice_to_haves.length > 0
      ? input.nice_to_haves.map((s) => `- ${s}`).join("\n")
      : null;

  const description =
    flavour === 0
      ? `## Wat ga je doen?\nJe komt in een ${titlePrefix.toLowerCase()}-rol als ${input.role}. ${input.company_context ?? ""}\n\n## Vereisten\n${mustList}\n\n## Skills\n${skillsList}${niceList ? `\n\n## Pré\n${niceList}` : ""}`
      : flavour === 1
      ? `## Word jij onze nieuwe ${input.role}?\nIn deze rol werk je samen met een team dat impact maakt. ${input.company_context ?? ""}\n\n## Wat je meebrengt\n${mustList}\n\n## Skills die we waarderen\n${skillsList}${niceList ? `\n\n## Bonus\n${niceList}` : ""}`
      : `## Functieomschrijving\nWij zoeken een ${input.role}. ${input.company_context ?? ""}\n\n## Vereiste kwalificaties\n${mustList}\n\n## Kernvaardigheden\n${skillsList}${niceList ? `\n\n## Pré\n${niceList}` : ""}`;

  return {
    id: `var-${Date.now()}-${seed}`,
    title,
    description,
    bias_flags: [],
    clarity_score: 70 + ((seed * 7) % 25),
    inclusivity_score: 65 + ((seed * 11) % 30),
    word_count: description.split(/\s+/).filter(Boolean).length,
  };
}
