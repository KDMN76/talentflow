"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Job, JobStatus } from "@/lib/mockData";

export interface UseJobsOptions {
  status?: JobStatus | "all";
  recruiterId?: string | "all";
  page?: number;
  limit?: number;
}

/**
 * Accepts either:
 *   - a `JobStatus | "all"` string (legacy callers), or
 *   - an options object `{ status, recruiterId, page, limit }`.
 *
 * Backend currently honours `status` and `recruiter_id` query params; `page`
 * and `limit` are forwarded for forward compatibility once Agent S extends
 * pagination support.
 */
export function useJobs(arg?: UseJobsOptions | JobStatus | "all") {
  const opts: UseJobsOptions =
    typeof arg === "string" || arg === undefined ? { status: arg } : arg;

  const { status, recruiterId, page, limit } = opts;

  return useQuery({
    queryKey: ["jobs", status ?? "all", recruiterId ?? "all", page ?? null, limit ?? null],
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      if (status && status !== "all") params.status = status;
      if (recruiterId && recruiterId !== "all") params.recruiter_id = recruiterId;
      if (typeof page === "number") params.page = page;
      if (typeof limit === "number") params.limit = limit;

      const { data } = await api.get<{ data: Job[] }>("/jobs", {
        params: Object.keys(params).length > 0 ? params : undefined,
      });
      return data.data;
    },
  });
}

export function useJob(id: string) {
  return useQuery({
    queryKey: ["jobs", id],
    queryFn: async () => {
      const { data } = await api.get<Job & { stages: unknown[] }>(`/jobs/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (job: Partial<Job>) => {
      const { data } = await api.post<Job>("/jobs", job);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export function useUpdateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Job> & { id: string }) => {
      const { data } = await api.patch<Job>(`/jobs/${id}`, updates);
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["jobs", variables.id] });
    },
  });
}
