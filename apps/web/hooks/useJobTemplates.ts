"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { mockJobTemplates, mockJobs, type Job } from "@/lib/mockData";
import type {
  CreateJobTemplateInput,
  JobTemplate,
} from "@/lib/types/atsExtensions";

const QUERY_KEY = "job-templates";

export function useJobTemplates() {
  return useQuery({
    queryKey: [QUERY_KEY],
    queryFn: async (): Promise<JobTemplate[]> => {
      try {
        const { data } = await api.get<{ data: JobTemplate[] }>("/job-templates");
        return data.data;
      } catch {
        return [...mockJobTemplates];
      }
    },
  });
}

export function useCreateJobTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateJobTemplateInput): Promise<JobTemplate> => {
      try {
        const { data } = await api.post<JobTemplate>("/job-templates", input);
        return data;
      } catch {
        const now = new Date().toISOString();
        const newRow: JobTemplate = {
          id: `tmpl-${Date.now()}`,
          tenant_id: "tenant-1",
          name: input.name,
          description: input.description ?? null,
          job_data: input.job_data,
          created_at: now,
          updated_at: now,
        };
        mockJobTemplates.unshift(newRow);
        return newRow;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });
}

export function useDeleteJobTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      try {
        await api.delete(`/job-templates/${id}`);
      } catch {
        const idx = mockJobTemplates.findIndex((t) => t.id === id);
        if (idx !== -1) mockJobTemplates.splice(idx, 1);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });
}

/**
 * Duplicate an existing job. Returns the freshly created job (with a new id).
 * Caller is expected to navigate to the new job's detail page.
 */
export function useDuplicateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      jobId,
      overrides,
    }: {
      jobId: string;
      overrides?: Record<string, unknown>;
    }): Promise<Job> => {
      try {
        const { data } = await api.post<Job>(`/jobs/${jobId}/duplicate`, {
          overrides,
        });
        return data;
      } catch {
        const source = mockJobs.find((j) => j.id === jobId);
        if (!source) throw new Error("Vacature niet gevonden");
        const now = new Date().toISOString();
        const cloned: Job = {
          ...source,
          ...(overrides as Partial<Job>),
          id: `job-${Date.now()}`,
          status: "draft",
          application_count: 0,
          created_at: now,
          updated_at: now,
          title: ((overrides?.title as string | undefined) ??
            `${source.title} (kopie)`),
        };
        mockJobs.unshift(cloned);
        return cloned;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

/**
 * Create a new job from a template, optionally overriding fields the user
 * tweaked on the wizard step before submit.
 */
export function useInstantiateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      templateId,
      overrides,
    }: {
      templateId: string;
      overrides?: Record<string, unknown>;
    }): Promise<Job> => {
      try {
        const { data } = await api.post<Job>(
          `/jobs/from-template/${templateId}`,
          { overrides }
        );
        return data;
      } catch {
        const tmpl = mockJobTemplates.find((t) => t.id === templateId);
        if (!tmpl) throw new Error("Template niet gevonden");
        const now = new Date().toISOString();
        const merged = { ...(tmpl.job_data as Record<string, unknown>), ...(overrides ?? {}) };
        const cloned: Job = {
          id: `job-${Date.now()}`,
          tenant_id: "tenant-1",
          title: (merged.title as string) ?? tmpl.name,
          department: (merged.department as string) ?? "—",
          location: (merged.location as string) ?? "—",
          description: (merged.description as string) ?? "",
          requirements: Array.isArray(merged.requirements)
            ? (merged.requirements as string[])
            : [],
          status: "draft",
          employment_type: (merged.employment_type as string) ?? "fulltime",
          salary_min: (merged.salary_min as number | null | undefined) ?? null,
          salary_max: (merged.salary_max as number | null | undefined) ?? null,
          recruiter_id: "user-1",
          recruiter_name: "Kaan Duman",
          application_count: 0,
          created_at: now,
          updated_at: now,
        };
        mockJobs.unshift(cloned);
        return cloned;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}
