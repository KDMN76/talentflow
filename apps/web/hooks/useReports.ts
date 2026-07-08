"use client";

/**
 * useReports — Custom Report Builder hooks (Sprint Q3.5).
 *
 * Response envelopes (see apps/api/src/modules/reports/reports.controller.ts):
 *   GET  /reports              → { reports: Report[] }
 *   GET  /reports/:id          → { report: Report }
 *   POST /reports              → { report: Report }
 *   PATCH /reports/:id         → { report: Report }
 *   POST /reports/:id/duplicate→ { report: Report }
 *   POST /reports/:id/run      → RunReportResponse (bare)
 *   GET  /reports/templates    → { templates: SystemTemplate[] }
 *   GET  /reports/dimensions   → { dimensions: DimensionDef[] }
 *   GET  /reports/metrics      → { metrics: MetricDef[] }
 *   POST /reports/:id/embed    → { token, url, expires_at } (bare)
 *   GET  /reports/embed/:token → { data: EmbedReportData } (public, no auth)
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
  TemplateKey,
  DimensionDef,
  MetricDef,
  RunReportResponse,
  EmbedTokenResponse,
  EmbedReportData,
  ReportDateRange,
} from "@/lib/types/reports";

// ─── Hooks ───────────────────────────────────────────────────────────────────

export interface ReportsFilters {
  template_key?: TemplateKey;
  is_template?: boolean;
}

export function useReports(filters?: ReportsFilters) {
  return useQuery({
    queryKey: ["reports", filters],
    queryFn: async (): Promise<Report[]> => {
      const { data } = await api.get<{ reports: Report[] }>("/reports", {
        params: filters,
      });
      return data.reports ?? [];
    },
  });
}

export function useReport(id: string | undefined) {
  return useQuery({
    queryKey: ["reports", id],
    enabled: !!id,
    queryFn: async (): Promise<Report> => {
      const { data } = await api.get<{ report: Report }>(`/reports/${id}`);
      return data.report;
    },
  });
}

export interface CreateReportInput {
  name: string;
  description?: string;
  config: ReportConfig;
  template_key?: TemplateKey;
}

export function useCreateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateReportInput): Promise<Report> => {
      const { data } = await api.post<{ report: Report }>("/reports", input);
      return data.report;
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
      const { data } = await api.patch<{ report: Report }>(
        `/reports/${id}`,
        patch
      );
      return data.report;
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
      const { data } = await api.post<{ report: Report }>(
        `/reports/${id}/duplicate`,
        { new_name }
      );
      return data.report;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reports"] }),
  });
}

export interface RunReportInput {
  date_range_override?: ReportDateRange;
  no_cache?: boolean;
}

export function useRunReport(id: string | undefined) {
  return useMutation({
    mutationFn: async (
      parameters?: RunReportInput
    ): Promise<RunReportResponse> => {
      if (!id) throw new Error("Missing id");
      const { data } = await api.post<RunReportResponse>(
        `/reports/${id}/run`,
        parameters ? { parameters } : {}
      );
      return data;
    },
  });
}

export function useReportTemplates() {
  return useQuery({
    queryKey: ["reports", "templates"],
    queryFn: async (): Promise<SystemTemplate[]> => {
      const { data } = await api.get<{ templates: SystemTemplate[] }>(
        "/reports/templates"
      );
      return data.templates ?? [];
    },
  });
}

export function useReportDimensions() {
  return useQuery({
    queryKey: ["reports", "dimensions"],
    queryFn: async (): Promise<DimensionDef[]> => {
      const { data } = await api.get<{ dimensions: DimensionDef[] }>(
        "/reports/dimensions"
      );
      return data.dimensions ?? [];
    },
  });
}

export function useReportMetrics() {
  return useQuery({
    queryKey: ["reports", "metrics"],
    queryFn: async (): Promise<MetricDef[]> => {
      const { data } = await api.get<{ metrics: MetricDef[] }>(
        "/reports/metrics"
      );
      return data.metrics ?? [];
    },
  });
}

export interface GenerateEmbedInput {
  id: string;
  /** Geldigheid in dagen (1..365); null/omitted = geen expiry. */
  expires_in_days?: number | null;
}

export function useGenerateEmbedToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      expires_in_days,
    }: GenerateEmbedInput): Promise<EmbedTokenResponse> => {
      const { data } = await api.post<EmbedTokenResponse>(
        `/reports/${id}/embed`,
        expires_in_days ? { expires_in_days } : {}
      );
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["reports", vars.id] });
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

export function useEmbedReport(token: string | undefined) {
  return useQuery({
    queryKey: ["reports", "embed", token],
    enabled: !!token,
    retry: false,
    queryFn: async (): Promise<EmbedReportData> => {
      // Public endpoint — mounted on the reports router (no auth).
      const { data } = await api.get<{ data: EmbedReportData }>(
        `/reports/embed/${token}`
      );
      return data.data;
    },
  });
}
