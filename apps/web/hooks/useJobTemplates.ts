"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Job } from "@/lib/mockData";
import type {
  CreateJobTemplateInput,
  JobTemplate,
} from "@/lib/types/atsExtensions";

const QUERY_KEY = "job-templates";

export function useJobTemplates() {
  return useQuery({
    queryKey: [QUERY_KEY],
    queryFn: async (): Promise<JobTemplate[]> => {
      const { data } = await api.get<{ data: JobTemplate[] }>("/job-templates");
      return data.data;
    },
  });
}

export function useCreateJobTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateJobTemplateInput): Promise<JobTemplate> => {
      const { data } = await api.post<JobTemplate>("/job-templates", input);
      return data;
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
      await api.delete(`/job-templates/${id}`);
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
      const { data } = await api.post<Job>(`/jobs/${jobId}/duplicate`, {
        overrides,
      });
      return data;
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
      const { data } = await api.post<Job>(
        `/jobs/from-template/${templateId}`,
        { overrides }
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}
