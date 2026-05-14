"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { mockJobs, type Job, type JobStatus } from "@/lib/mockData";

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

      try {
        const { data } = await api.get<{ data: Job[] }>("/jobs", {
          params: Object.keys(params).length > 0 ? params : undefined,
        });
        return data.data;
      } catch {
        let result = [...mockJobs];
        if (status && status !== "all") {
          result = result.filter((j) => j.status === status);
        }
        if (recruiterId && recruiterId !== "all") {
          result = result.filter((j) => j.recruiter_id === recruiterId);
        }
        return result;
      }
    },
  });
}

export function useJob(id: string) {
  return useQuery({
    queryKey: ["jobs", id],
    queryFn: async () => {
      try {
        const { data } = await api.get<Job & { stages: unknown[] }>(`/jobs/${id}`);
        return data;
      } catch {
        const job = mockJobs.find((j) => j.id === id);
        if (!job) throw new Error("Vacature niet gevonden");
        return job;
      }
    },
    enabled: !!id,
  });
}

export function useCreateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (job: Partial<Job>) => {
      try {
        const { data } = await api.post<Job>("/jobs", job);
        return data;
      } catch {
        const newJob: Job = {
          id: `job-${Date.now()}`,
          tenant_id: "tenant-1",
          title: job.title ?? "",
          department: job.department ?? "",
          location: job.location ?? "",
          description: job.description ?? "",
          requirements: job.requirements ?? [],
          status: "draft",
          recruiter_id: "user-1",
          recruiter_name: "Emma Bakker",
          application_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        mockJobs.unshift(newJob);
        return newJob;
      }
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
      try {
        const { data } = await api.patch<Job>(`/jobs/${id}`, updates);
        return data;
      } catch {
        const idx = mockJobs.findIndex((j) => j.id === id);
        if (idx !== -1) {
          mockJobs[idx] = { ...mockJobs[idx], ...updates, updated_at: new Date().toISOString() };
          return mockJobs[idx];
        }
        throw new Error("Vacature niet gevonden");
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["jobs", variables.id] });
    },
  });
}
