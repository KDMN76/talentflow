"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { JobHealthSchema } from "@talentflow/contracts";
import { api } from "@/lib/api";
import type {
  BiasCheckResult,
  ComparableJob,
  JobAttachment,
  JobFunnelResponse,
  JobHealthBreakdown,
  JobNote,
  JobSourcingItem,
  JobTeamMember,
  JobTeamRole,
} from "@/lib/types/jobDetail";

/**
 * Hook contracts for the job-detail redesign (Slice 4.5).
 *
 * Endpoints (owned by Agent S on the backend):
 *   GET    /api/jobs/:id/team
 *   POST   /api/jobs/:id/team           { user_id, role }
 *   DELETE /api/jobs/:id/team/:userId
 *   GET    /api/jobs/:id/notes
 *   POST   /api/jobs/:id/notes          { body, mentions[] }
 *   DELETE /api/jobs/:id/notes/:noteId
 *   GET    /api/jobs/:id/attachments
 *   POST   /api/jobs/:id/attachments    multipart 'file'
 *   DELETE /api/jobs/:id/attachments/:attachmentId
 *   GET    /api/jobs/:id/health
 *   GET    /api/jobs/:id/funnel
 *   GET    /api/jobs/:id/comparable
 *   GET    /api/jobs/:id/sourcing
 *   GET    /api/jobs/:id/bias-check
 */

// ─── Team ───────────────────────────────────────────────────────────────────

export function useJobTeam(jobId: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "team"],
    queryFn: async (): Promise<JobTeamMember[]> => {
      const { data } = await api.get<{ data: JobTeamMember[] }>(
        `/jobs/${jobId}/team`
      );
      return data.data;
    },
    enabled: !!jobId,
  });
}

export function useAddJobTeamMember(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    JobTeamMember,
    Error,
    { user_id: string; role: JobTeamRole | string }
  >({
    mutationFn: async ({ user_id, role }) => {
      const { data } = await api.post<JobTeamMember>(`/jobs/${jobId}/team`, {
        user_id,
        role,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs", jobId, "team"] });
    },
  });
}

export function useRemoveJobTeamMember(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { userId: string }>({
    mutationFn: async ({ userId }) => {
      await api.delete(`/jobs/${jobId}/team/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs", jobId, "team"] });
    },
  });
}

// ─── Notes ──────────────────────────────────────────────────────────────────

export function useJobNotes(jobId: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "notes"],
    queryFn: async (): Promise<JobNote[]> => {
      const { data } = await api.get<{ data: JobNote[] }>(
        `/jobs/${jobId}/notes`
      );
      return data.data;
    },
    enabled: !!jobId,
  });
}

export function useCreateJobNote(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    JobNote,
    Error,
    { body: string; mentions?: string[] }
  >({
    mutationFn: async ({ body, mentions = [] }) => {
      const { data } = await api.post<JobNote>(`/jobs/${jobId}/notes`, {
        body,
        mentions,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs", jobId, "notes"] });
    },
  });
}

export function useDeleteJobNote(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { noteId: string }>({
    mutationFn: async ({ noteId }) => {
      await api.delete(`/jobs/${jobId}/notes/${noteId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs", jobId, "notes"] });
    },
  });
}

// ─── Attachments ────────────────────────────────────────────────────────────

export function useJobAttachments(jobId: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "attachments"],
    queryFn: async (): Promise<JobAttachment[]> => {
      const { data } = await api.get<{ data: JobAttachment[] }>(
        `/jobs/${jobId}/attachments`
      );
      return data.data;
    },
    enabled: !!jobId,
  });
}

export function useUploadJobAttachment(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation<JobAttachment, Error, File>({
    mutationFn: async (file) => {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post<JobAttachment>(
        `/jobs/${jobId}/attachments`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["jobs", jobId, "attachments"],
      });
    },
  });
}

export function useDeleteJobAttachment(jobId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { attachmentId: string }>({
    mutationFn: async ({ attachmentId }) => {
      await api.delete(`/jobs/${jobId}/attachments/${attachmentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["jobs", jobId, "attachments"],
      });
    },
  });
}

// ─── Health ─────────────────────────────────────────────────────────────────

export function useJobHealth(jobId: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "health"],
    queryFn: async (): Promise<JobHealthBreakdown | null> => {
      const { data } = await api.get(`/jobs/${jobId}/health`);
      // Runtime-valideren tegen het gedeelde contract. Een afwijkende shape
      // (bv. ontbrekende `components`) levert nu een query-error op die de UI
      // netjes als "Health-data nog niet beschikbaar" toont, in plaats van een
      // witte pagina door `health.components.map` op undefined.
      return JobHealthSchema.parse(data);
    },
    enabled: !!jobId,
    staleTime: 60_000,
  });
}

// ─── Funnel ─────────────────────────────────────────────────────────────────

export function useJobFunnel(jobId: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "funnel"],
    queryFn: async (): Promise<JobFunnelResponse | null> => {
      // API levert {stages:[{stage_id,stage_name,position,count,
      // conversion_rate_from_previous}],total,hired,dropped} — map naar de
      // UI-shape. Let op de shift-semantiek: `conversion_to_next_pct` van
      // stage i = `conversion_rate_from_previous` van stage i+1 (de laatste
      // stage heeft geen volgende → null).
      const { data } = await api.get<{
        stages: Array<{
          stage_id: string;
          stage_name: string;
          position: number;
          count: number;
          conversion_rate_from_previous: number | null;
        }>;
        total?: number;
        hired?: number;
        dropped?: number;
      }>(`/jobs/${jobId}/funnel`);

      const rawStages = data.stages ?? [];
      return {
        job_id: jobId,
        stages: rawStages.map((s, i) => ({
          stage_id: s.stage_id,
          name: s.stage_name,
          position: s.position,
          count: s.count,
          conversion_to_next_pct:
            i < rawStages.length - 1
              ? rawStages[i + 1].conversion_rate_from_previous
              : null,
        })),
        total: data.total ?? 0,
        hired: data.hired ?? 0,
        dropped: data.dropped ?? 0,
        computed_at: new Date().toISOString(),
      };
    },
    enabled: !!jobId,
    staleTime: 30_000,
  });
}

// ─── Comparable jobs ────────────────────────────────────────────────────────

export function useComparableJobs(jobId: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "comparable"],
    queryFn: async (): Promise<ComparableJob[]> => {
      // API levert { job_id, title, status, candidates_total, days_to_fill,
      // similarity_score(0..1 Jaccard) }. Map naar de UI-shape (ComparableJob),
      // anders leest de tab velden die niet bestaan (id/filled/total_candidates)
      // en doet `Math.round(similarity_score)` op een 0..1-waarde → altijd 0%.
      const { data } = await api.get<{
        data: Array<{
          job_id: string;
          title: string;
          status: string;
          candidates_total: number;
          days_to_fill: number | null;
          similarity_score: number;
        }>;
      }>(`/jobs/${jobId}/comparable`);
      return (data.data ?? []).map((c) => ({
        id: c.job_id,
        title: c.title,
        client: null,
        similarity_score: (c.similarity_score ?? 0) * 100,
        filled: c.status === "filled",
        days_to_fill: c.days_to_fill ?? null,
        total_candidates: c.candidates_total ?? 0,
        closed_at: null,
      }));
    },
    enabled: !!jobId,
    staleTime: 5 * 60_000,
  });
}

// ─── Sourcing ROI ───────────────────────────────────────────────────────────

export function useJobSourcing(jobId: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "sourcing"],
    queryFn: async (): Promise<JobSourcingItem[]> => {
      // API levert per rij { source, count, conversion_to_hire } — map naar de UI-shape,
      // anders leest de tab `s.conversion_pct.toFixed()` → crash.
      const { data } = await api.get<{ data: Array<Record<string, unknown>> }>(
        `/jobs/${jobId}/sourcing`
      );
      return (data.data ?? []).map((s) => ({
        source: String(s.source ?? ""),
        candidates: (s.count as number) ?? 0,
        hires: (s.hired_count as number) ?? 0,
        conversion_pct: (s.conversion_to_hire as number) ?? 0,
        cost_per_hire_cents: (s.cost_per_hire_cents as number) ?? 0,
      }));
    },
    enabled: !!jobId,
    staleTime: 60_000,
  });
}

// ─── Bias check ─────────────────────────────────────────────────────────────

export function useJobBiasCheck(jobId: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "bias-check"],
    queryFn: async (): Promise<BiasCheckResult | null> => {
      // API levert { bias_flags:[{type,text,suggestion}], clarity_score, inclusivity_score, computed_at }.
      // Normaliseer naar de UI-shape (BiasCheckResult) — anders leest de tab `data.flags.length` → crash.
      const { data } = await api.get<Record<string, unknown>>(
        `/jobs/${jobId}/bias-check`
      );
      // Keys = de echte API-enum (jobBiasCheck.service.ts):
      // gendered_language | age_indicator | unrealistic_requirement |
      // exclusionary | jargon. Oude keys (gender_coded/age_coded/…) matchten
      // nooit → label viel terug op de rauwe snake_case enum.
      const flagLabels: Record<string, string> = {
        gendered_language: "Gender-gekleurde taal",
        age_indicator: "Leeftijdsindicatie",
        unrealistic_requirement: "Onrealistische eis",
        exclusionary: "Uitsluitende taal",
        jargon: "Jargon",
      };
      const rawFlags = (data.bias_flags as Array<Record<string, string>>) ?? [];
      return {
        job_id: jobId,
        clarity_score: (data.clarity_score as number) ?? 0,
        inclusivity_score: (data.inclusivity_score as number) ?? 0,
        flags: rawFlags.map((f) => ({
          type: f.type,
          label: flagLabels[f.type] ?? f.type,
          excerpt: f.text ?? "",
          suggestion: f.suggestion ?? "",
          severity: "medium" as const,
        })),
        ai_disclosure:
          (data.ai_disclosure as string) ??
          "Door AI gegenereerd — de recruiter behoudt het finale oordeel.",
        computed_at: (data.computed_at as string) ?? new Date().toISOString(),
      };
    },
    enabled: !!jobId,
    staleTime: 5 * 60_000,
  });
}

// ─── Sourcing suggestions (boolean searches) ────────────────────────────────

export function useJobSourcingSuggestions(jobId: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "sourcing-suggestions"],
    queryFn: async (): Promise<string[]> => {
      const { data } = await api.get<{ data: string[] }>(
        `/jobs/${jobId}/sourcing-suggestions`
      );
      return data.data;
    },
    enabled: !!jobId,
    staleTime: 5 * 60_000,
  });
}
