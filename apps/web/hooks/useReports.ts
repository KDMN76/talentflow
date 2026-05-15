"use client";

/**
 * useReports — Custom Report Builder hooks (Sprint Q3.5).
 *
 * All hooks call the backend directly; errors bubble up to React Query.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  Report,
  ReportConfig,
  SystemTemplate,
  SystemTemplateKey,
  DimensionDef,
  MetricDef,
  RunReportResponse,
  EmbedTokenResponse,
} from "@/lib/types/reports";

// ─── Hooks ───────────────────────────────────────────────────────────────────

export interface ReportsFilters {
  template_key?: SystemTemplateKey;
  shared?: boolean;
}

export function useReports(filters?: ReportsFilters) {
  return useQuery({
    queryKey: ["reports", filters],
    queryFn: async (): Promise<Report[]> => {
      const { data } = await api.get<Report[]>("/reports", { params: filters });
      return data;
    },
  });
}

export function useReport(id: string | undefined) {
  return useQuery({
    queryKey: ["reports", id],
    enabled: !!id,
    queryFn: async (): Promise<Report> => {
      const { data } = await api.get<Report>(`/reports/${id}`);
      return data;
    },
  });
}

export interface CreateReportInput {
  name: string;
  description?: string;
  config: ReportConfig;
  template_key?: SystemTemplateKey | null;
}

export function useCreateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateReportInput): Promise<Report> => {
      const { data } = await api.post<Report>("/reports", input);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

export interface UpdateReportInput {
  id: string;
  name?: string;
  description?: string;
  config?: ReportConfig;
}

export function useUpdateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: UpdateReportInput): Promise<Report> => {
      const { data } = await api.patch<Report>(`/reports/${id}`, patch);
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["reports"] });
      qc.invalidateQueries({ queryKey: ["reports", vars.id] });
    },
  });
}

export function useDeleteReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/reports/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reports"] }),
  });
}

export function useDuplicateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      new_name,
    }: {
      id: string;
      new_name: string;
    }): Promise<Report> => {
      const { data } = await api.post<Report>(`/reports/${id}/duplicate`, {
        new_name,
      });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reports"] }),
  });
}

export function useRunReport(id: string | undefined) {
  return useMutation({
    mutationFn: async (): Promise<RunReportResponse> => {
      if (!id) throw new Error("Missing id");
      const { data } = await api.post<RunReportResponse>(`/reports/${id}/run`, {});
      return data;
    },
  });
}

export function useReportTemplates() {
  return useQuery({
    queryKey: ["reports", "templates"],
    queryFn: async (): Promise<SystemTemplate[]> => {
      const { data } = await api.get<SystemTemplate[]>("/reports/templates");
      return data;
    },
  });
}

export function useReportDimensions() {
  return useQuery({
    queryKey: ["reports", "dimensions"],
    queryFn: async (): Promise<DimensionDef[]> => {
      const { data } = await api.get<DimensionDef[]>("/reports/dimensions");
      return data;
    },
  });
}

export function useReportMetrics() {
  return useQuery({
    queryKey: ["reports", "metrics"],
    queryFn: async (): Promise<MetricDef[]> => {
      const { data } = await api.get<MetricDef[]>("/reports/metrics");
      return data;
    },
  });
}

export function useGenerateEmbedToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<EmbedTokenResponse> => {
      const { data } = await api.post<EmbedTokenResponse>(
        `/reports/${id}/embed`
      );
      return data;
    },
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["reports", id] });
      qc.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

export function useRevokeEmbedToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/reports/${id}/embed`);
    },
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["reports", id] });
      qc.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

// ─── Embed view (public) ─────────────────────────────────────────────────────

export interface EmbedReportData {
  report: Report;
  result: RunReportResponse;
}

export function useEmbedReport(token: string | undefined) {
  return useQuery({
    queryKey: ["reports", "embed", token],
    enabled: !!token,
    queryFn: async (): Promise<EmbedReportData> => {
      const { data } = await api.get<EmbedReportData>(
        `/embed/reports/${token}`
      );
      return data;
    },
  });
}
