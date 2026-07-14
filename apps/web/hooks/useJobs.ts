"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { z } from "zod";
import { api } from "@/lib/api";
import {
  JobListItemSchema,
  JobDetailSchema,
  type JobListItem,
  type JobDetail,
  type JobCreateInput,
  type JobUpdateInput,
  type JobStatus,
} from "@talentflow/contracts";

export interface UseJobsOptions {
  status?: JobStatus | "all";
  recruiterId?: string | "all";
  page?: number;
  limit?: number;
}

// Backend response-envelope. We valideren `data` met het schema; `meta` is
// pagination en wordt door consumers nu nog niet uitgelezen.
const JobsListResponseSchema = z.object({
  data: z.array(JobListItemSchema),
  meta: z.object({
    total: z.number().int().nonnegative(),
    page: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
    pages: z.number().int().nonnegative(),
  }),
});

/**
 * Accepts either:
 *   - a `JobStatus | "all"` string (legacy callers), or
 *   - an options object `{ status, recruiterId, page, limit }`.
 *
 * Backend currently honours `status` and `recruiter_id` query params; `page`
 * and `limit` are forwarded for forward compatibility.
 *
 * Sub-fase 2C: response wordt runtime-gevalideerd met JobListItemSchema —
 * bij contract-drift gooit Zod synchroon en wordt de fout zichtbaar in
 * React Query's `error` state ipv stilletjes mis te renderen.
 */
export function useJobs(arg?: UseJobsOptions | JobStatus | "all") {
  const opts: UseJobsOptions =
    typeof arg === "string" || arg === undefined ? { status: arg } : arg;

  const { status, recruiterId, page, limit } = opts;

  return useQuery({
    queryKey: ["jobs", status ?? "all", recruiterId ?? "all", page ?? null, limit ?? null],
    queryFn: async (): Promise<JobListItem[]> => {
      const params: Record<string, string | number> = {};
      if (status && status !== "all") params.status = status;
      if (recruiterId && recruiterId !== "all") params.recruiter_id = recruiterId;
      if (typeof page === "number") params.page = page;
      if (typeof limit === "number") params.limit = limit;

      const { data } = await api.get<unknown>("/jobs", {
        params: Object.keys(params).length > 0 ? params : undefined,
      });
      return JobsListResponseSchema.parse(data).data;
    },
  });
}

/** Aantal vacatures per pagina bij de infinite-lijst (matcht server-default). */
const JOBS_PAGE_SIZE = 20;

export type JobsPage = z.infer<typeof JobsListResponseSchema>;

/**
 * Page-based infinite variant van {@link useJobs}. Elke pagina wordt met
 * `JobsListResponseSchema` gevalideerd en levert `{ data, meta }`, zodat de UI
 * de pagina's kan platslaan én `meta.total` als echte teller kan tonen i.p.v.
 * de eerste 20 rijen.
 *
 * `getNextPageParam` stopt zodra `meta.page >= meta.pages`.
 */
export function useJobsInfinite(arg?: UseJobsOptions | JobStatus | "all") {
  const opts: UseJobsOptions =
    typeof arg === "string" || arg === undefined ? { status: arg } : arg;

  const { status, recruiterId, limit } = opts;
  const pageSize = limit ?? JOBS_PAGE_SIZE;

  return useInfiniteQuery({
    queryKey: ["jobs", "infinite", status ?? "all", recruiterId ?? "all", pageSize],
    initialPageParam: 1,
    getNextPageParam: (lastPage: JobsPage) =>
      lastPage.meta.page < lastPage.meta.pages ? lastPage.meta.page + 1 : undefined,
    queryFn: async ({ pageParam }): Promise<JobsPage> => {
      const params: Record<string, string | number> = {
        page: pageParam as number,
        limit: pageSize,
      };
      if (status && status !== "all") params.status = status;
      if (recruiterId && recruiterId !== "all") params.recruiter_id = recruiterId;

      const { data } = await api.get<unknown>("/jobs", { params });
      return JobsListResponseSchema.parse(data);
    },
  });
}

export function useJob(id: string) {
  return useQuery({
    queryKey: ["jobs", id],
    queryFn: async (): Promise<JobDetail> => {
      const { data } = await api.get<unknown>(`/jobs/${id}`);
      return JobDetailSchema.parse(data);
    },
    enabled: !!id,
  });
}

export function useCreateJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (job: JobCreateInput): Promise<JobDetail> => {
      // POST /jobs response is een full row + (post-create) stages — past
      // op JobDetailSchema. Validatie is bewust client-side overgeslagen
      // hier (server heeft .parse() al gedaan op input én output).
      const { data } = await api.post<JobDetail>("/jobs", job);
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
    mutationFn: async ({
      id,
      ...updates
    }: JobUpdateInput & { id: string }): Promise<JobDetail> => {
      const { data } = await api.patch<JobDetail>(`/jobs/${id}`, updates);
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["jobs", variables.id] });
    },
  });
}
