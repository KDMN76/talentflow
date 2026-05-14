"use client";

/**
 * useReports — Custom Report Builder hooks (Sprint Q3.5).
 *
 * Pattern matches the rest of the codebase: try API → fall back to mock data.
 * All mutations invalidate cache via useQueryClient.
 *
 * Mock data lives at the top of this file (instead of lib/mockData.ts) because
 * it's tightly coupled to the report-block result shapes and only used here.
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
  BlockResult,
  ReportBlock,
} from "@/lib/types/reports";

// ─── Mock catalogues ─────────────────────────────────────────────────────────

const MOCK_DIMENSIONS: DimensionDef[] = [
  { key: "stage", label: "Pipeline-fase" },
  { key: "source", label: "Bron" },
  { key: "recruiter", label: "Recruiter" },
  { key: "department", label: "Afdeling" },
  { key: "job", label: "Vacature" },
  { key: "location", label: "Locatie" },
  { key: "month", label: "Maand" },
  { key: "week", label: "Week" },
  { key: "day", label: "Dag" },
  { key: "rejection_reason", label: "Afwijsreden" },
  { key: "tag", label: "Tag" },
];

const MOCK_METRICS: MetricDef[] = [
  { key: "applications_count", label: "Sollicitaties", unit: "count" },
  { key: "candidates_count", label: "Kandidaten", unit: "count" },
  { key: "hires_count", label: "Aangenomen", unit: "count" },
  { key: "interviews_count", label: "Interviews", unit: "count" },
  { key: "offers_count", label: "Aanbiedingen", unit: "count" },
  { key: "rejections_count", label: "Afgewezen", unit: "count" },
  { key: "avg_time_to_hire_days", label: "Gem. time-to-hire", unit: "days" },
  { key: "avg_time_in_stage_days", label: "Gem. tijd in fase", unit: "days" },
  { key: "conversion_rate", label: "Conversieratio", unit: "percentage" },
  { key: "open_jobs_count", label: "Open vacatures", unit: "count" },
];

// ─── Mock templates ──────────────────────────────────────────────────────────

const MOCK_TEMPLATES: SystemTemplate[] = [
  {
    key: "executive_summary",
    name: "Executive samenvatting",
    description: "KPI's voor management: open vacatures, hires, time-to-hire en pipeline-conversie.",
    config: {
      date_range: { preset: "last_30_days" },
      blocks: [
        {
          id: "tpl-exec-1",
          type: "kpi",
          title: "Open vacatures",
          config: { metric: "open_jobs_count", comparison: "previous_period" },
        },
        {
          id: "tpl-exec-2",
          type: "kpi",
          title: "Aangenomen",
          config: { metric: "hires_count", comparison: "previous_period" },
        },
        {
          id: "tpl-exec-3",
          type: "kpi",
          title: "Gem. time-to-hire",
          config: { metric: "avg_time_to_hire_days", comparison: "previous_period" },
        },
        {
          id: "tpl-exec-4",
          type: "funnel",
          title: "Pipeline-conversie",
          config: { stages: ["Nieuw", "Screening", "Interview", "Offer", "Hired"] },
        },
        {
          id: "tpl-exec-5",
          type: "line",
          title: "Sollicitaties per maand",
          config: { x: "month", series: ["applications_count", "hires_count"] },
        },
      ],
    },
  },
  {
    key: "recruiter_performance",
    name: "Recruiter prestaties",
    description: "Vergelijking per recruiter: open vacatures, sollicitaties, hires, time-to-hire.",
    config: {
      date_range: { preset: "this_quarter" },
      blocks: [
        {
          id: "tpl-rec-1",
          type: "table",
          title: "Per recruiter",
          config: {
            rows: ["recruiter"],
            metric: "applications_count",
            sort_by: "metric_desc",
            show_totals: true,
          },
        },
        {
          id: "tpl-rec-2",
          type: "bar",
          title: "Hires per recruiter",
          config: { x: "recruiter", series: ["hires_count"] },
        },
        {
          id: "tpl-rec-3",
          type: "bar",
          title: "Time-to-hire per recruiter",
          config: { x: "recruiter", series: ["avg_time_to_hire_days"] },
        },
      ],
    },
  },
  {
    key: "pipeline_health",
    name: "Pipeline gezondheid",
    description: "Funnel met conversies tussen fases + tijd per fase.",
    config: {
      date_range: { preset: "last_30_days" },
      blocks: [
        {
          id: "tpl-pipe-1",
          type: "funnel",
          title: "Pipeline funnel",
          config: { stages: ["Nieuw", "Screening", "Interview", "Tech-test", "Offer", "Hired"] },
        },
        {
          id: "tpl-pipe-2",
          type: "table",
          title: "Tijd per fase",
          config: {
            rows: ["stage"],
            metric: "avg_time_in_stage_days",
            sort_by: "metric_desc",
          },
        },
        {
          id: "tpl-pipe-3",
          type: "kpi",
          title: "Totale conversie",
          config: { metric: "conversion_rate", comparison: "previous_period" },
        },
      ],
    },
  },
  {
    key: "diversity_inclusion",
    name: "Diversiteit & inclusie",
    description: "D&I-metriek: bron, afdeling en afwijsredenen.",
    config: {
      date_range: { preset: "this_quarter" },
      blocks: [
        {
          id: "tpl-di-1",
          type: "pie",
          title: "Sollicitaties per afdeling",
          config: { metric: "applications_count", group_by: "department", limit: 8 },
        },
        {
          id: "tpl-di-2",
          type: "pie",
          title: "Hires per afdeling",
          config: { metric: "hires_count", group_by: "department", limit: 8 },
        },
        {
          id: "tpl-di-3",
          type: "bar",
          title: "Afwijsredenen",
          config: { x: "rejection_reason", series: ["rejections_count"] },
        },
      ],
    },
  },
  {
    key: "source_efficiency",
    name: "Bron-efficiëntie",
    description: "Welke bronnen leveren de beste kandidaten en hires?",
    config: {
      date_range: { preset: "last_30_days" },
      blocks: [
        {
          id: "tpl-src-1",
          type: "pie",
          title: "Sollicitaties per bron",
          config: { metric: "applications_count", group_by: "source", limit: 6 },
        },
        {
          id: "tpl-src-2",
          type: "table",
          title: "Hire-conversie per bron",
          config: {
            rows: ["source"],
            metric: "hires_count",
            sort_by: "metric_desc",
            show_totals: true,
          },
        },
        {
          id: "tpl-src-3",
          type: "bar",
          title: "Sollicitaties vs hires",
          config: { x: "source", series: ["applications_count", "hires_count"] },
        },
      ],
    },
  },
];

// ─── Mock saved reports ──────────────────────────────────────────────────────

const MOCK_REPORTS: Report[] = [
  {
    id: "rep-1",
    name: "Q2 Executive Briefing",
    description: "Maandelijks rapport voor het management.",
    config: MOCK_TEMPLATES[0].config,
    template_key: "executive_summary",
    last_run_at: "2026-04-30T10:15:00Z",
    embed_enabled: false,
    created_at: "2026-04-01T09:00:00Z",
    updated_at: "2026-04-30T10:15:00Z",
    created_by_name: "Emma Bakker",
  },
  {
    id: "rep-2",
    name: "Recruiter Scorecard",
    description: "Wekelijkse recruiter performance — KPIs + ranking.",
    config: MOCK_TEMPLATES[1].config,
    template_key: "recruiter_performance",
    last_run_at: "2026-05-05T08:00:00Z",
    embed_enabled: true,
    embed_token: "demo-token-rec-2",
    created_at: "2026-03-15T10:00:00Z",
    updated_at: "2026-05-05T08:00:00Z",
    created_by_name: "Jan Peters",
  },
  {
    id: "rep-3",
    name: "Bronnen — Engineering",
    description: "Custom: alleen Engineering, gefilterd op LinkedIn vs Referral.",
    config: {
      date_range: { preset: "last_30_days" },
      blocks: [
        {
          id: "rep3-b1",
          type: "kpi",
          title: "Engineering hires",
          config: { metric: "hires_count", comparison: "previous_period" },
        },
        {
          id: "rep3-b2",
          type: "pie",
          title: "Bron-mix",
          config: { metric: "applications_count", group_by: "source" },
        },
      ],
    },
    template_key: null,
    last_run_at: null,
    embed_enabled: false,
    created_at: "2026-05-01T11:30:00Z",
    updated_at: "2026-05-01T11:30:00Z",
    created_by_name: "Lisa Smits",
  },
];

// ─── Mock run results ────────────────────────────────────────────────────────

function generateMockResults(report: Report): BlockResult[] {
  return report.config.blocks.map((block) => makeMockResult(block));
}

function makeMockResult(block: ReportBlock): BlockResult {
  switch (block.type) {
    case "kpi": {
      const metric = (block.config as { metric: string }).metric;
      const value = MOCK_KPI_VALUES[metric] ?? Math.floor(Math.random() * 100) + 1;
      const prev = Math.max(1, Math.floor(value * (0.7 + Math.random() * 0.5)));
      const change = ((value - prev) / prev) * 100;
      const isDayMetric = metric.includes("days");
      const isPercentMetric = metric.includes("rate");
      return {
        block_id: block.id,
        type: "kpi",
        value,
        label: block.title,
        comparison_value: prev,
        change_percentage: Math.round(change * 10) / 10,
        unit: isDayMetric ? "days" : isPercentMetric ? "percentage" : "count",
      };
    }
    case "table": {
      const cfg = block.config as { rows: string[]; metric: string };
      const dim = cfg.rows[0] ?? "recruiter";
      const sample = SAMPLE_VALUES[dim] ?? ["Item A", "Item B", "Item C"];
      const rows = sample.map((label) => ({
        group: { [dim]: label },
        values: { value: Math.floor(Math.random() * 60) + 5 },
        total: 0,
      }));
      rows.forEach((r) => {
        r.total = r.values.value;
      });
      const totalSum = rows.reduce((s, r) => s + r.values.value, 0);
      return {
        block_id: block.id,
        type: "table",
        columns: ["value"],
        rows,
        total: { value: totalSum },
      };
    }
    case "bar":
    case "line": {
      const cfg = block.config as { x: string; series: string[] };
      const xLabels = SAMPLE_VALUES[cfg.x] ?? ["Wk 1", "Wk 2", "Wk 3", "Wk 4", "Wk 5"];
      const data = xLabels.map((label) => {
        const row: Record<string, number | string> = { [cfg.x]: label };
        cfg.series.forEach((s) => {
          const base = MOCK_KPI_VALUES[s] ?? 30;
          row[s] = Math.max(0, Math.round(base * (0.4 + Math.random() * 1.2)));
        });
        return row;
      });
      return {
        block_id: block.id,
        type: block.type,
        data,
        series: cfg.series,
        x_key: cfg.x,
      };
    }
    case "funnel": {
      const cfg = block.config as { stages: string[] };
      let prev = 100 + Math.floor(Math.random() * 80);
      const stages = cfg.stages.map((name, i) => {
        const drop = i === 0 ? 1 : 0.55 + Math.random() * 0.3;
        const count = i === 0 ? prev : Math.max(1, Math.floor(prev * drop));
        const conversion = i === 0 ? null : count / prev;
        prev = count;
        return { name, count, conversion };
      });
      const overall =
        stages.length > 1 ? stages[stages.length - 1].count / stages[0].count : 1;
      return {
        block_id: block.id,
        type: "funnel",
        stages,
        overall_conversion: overall,
      };
    }
    case "pie": {
      const cfg = block.config as { group_by: string; limit?: number };
      const labels = (SAMPLE_VALUES[cfg.group_by] ?? ["A", "B", "C", "D"]).slice(
        0,
        cfg.limit ?? 6
      );
      const raw = labels.map((name) => ({
        name,
        v: Math.floor(Math.random() * 80) + 10,
      }));
      const total = raw.reduce((s, r) => s + r.v, 0);
      const slices = raw.map((r) => ({
        name: r.name,
        value: r.v,
        percentage: Math.round((r.v / total) * 1000) / 10,
      }));
      return {
        block_id: block.id,
        type: "pie",
        slices,
        total,
      };
    }
  }
}

const MOCK_KPI_VALUES: Record<string, number> = {
  applications_count: 247,
  candidates_count: 412,
  hires_count: 18,
  interviews_count: 96,
  offers_count: 24,
  rejections_count: 173,
  avg_time_to_hire_days: 21,
  avg_time_in_stage_days: 4,
  conversion_rate: 7.3,
  open_jobs_count: 12,
};

const SAMPLE_VALUES: Record<string, string[]> = {
  recruiter: ["Emma Bakker", "Jan Peters", "Lisa Smits", "Mark de Vries", "Nadia Yilmaz"],
  source: ["LinkedIn", "Indeed", "Referral", "Website", "Anders"],
  department: ["Engineering", "Sales", "Marketing", "HR", "Finance", "Ops"],
  stage: ["Nieuw", "Screening", "Interview", "Tech-test", "Offer", "Hired"],
  location: ["Amsterdam", "Den Haag", "Rotterdam", "Utrecht", "Eindhoven"],
  job: ["Senior Dev", "Recruiter", "Designer", "PM", "Sales Lead"],
  month: ["Dec", "Jan", "Feb", "Mrt", "Apr", "Mei"],
  week: ["Wk 14", "Wk 15", "Wk 16", "Wk 17", "Wk 18"],
  day: ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"],
  rejection_reason: ["Niet passend", "Geen reactie", "Andere baan", "Salaris", "Cultureel"],
  tag: ["Hoog potentieel", "Senior", "Junior", "Remote", "Lokaal"],
};

// ─── In-memory mock store ────────────────────────────────────────────────────
// Lets create/update/delete operations work in dev without a backend.

const mockStore: { reports: Report[] } = {
  reports: structuredClone(MOCK_REPORTS),
};

function findMock(id: string): Report | undefined {
  return mockStore.reports.find((r) => r.id === id);
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export interface ReportsFilters {
  template_key?: SystemTemplateKey;
  shared?: boolean;
}

export function useReports(filters?: ReportsFilters) {
  return useQuery({
    queryKey: ["reports", filters],
    queryFn: async (): Promise<Report[]> => {
      try {
        const { data } = await api.get<Report[]>("/reports", { params: filters });
        return data;
      } catch {
        return mockStore.reports;
      }
    },
  });
}

export function useReport(id: string | undefined) {
  return useQuery({
    queryKey: ["reports", id],
    enabled: !!id,
    queryFn: async (): Promise<Report> => {
      try {
        const { data } = await api.get<Report>(`/reports/${id}`);
        return data;
      } catch {
        const r = findMock(id!);
        if (!r) throw new Error("Report not found");
        return r;
      }
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
      try {
        const { data } = await api.post<Report>("/reports", input);
        return data;
      } catch {
        const now = new Date().toISOString();
        const newReport: Report = {
          id: `rep-${Math.random().toString(36).slice(2, 8)}`,
          name: input.name,
          description: input.description,
          config: input.config,
          template_key: input.template_key ?? null,
          last_run_at: null,
          embed_enabled: false,
          created_at: now,
          updated_at: now,
          created_by_name: "Jij",
        };
        mockStore.reports.unshift(newReport);
        return newReport;
      }
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
      try {
        const { data } = await api.patch<Report>(`/reports/${id}`, patch);
        return data;
      } catch {
        const r = findMock(id);
        if (!r) throw new Error("Report not found");
        Object.assign(r, patch, { updated_at: new Date().toISOString() });
        return r;
      }
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
      try {
        await api.delete(`/reports/${id}`);
      } catch {
        mockStore.reports = mockStore.reports.filter((r) => r.id !== id);
      }
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
      try {
        const { data } = await api.post<Report>(`/reports/${id}/duplicate`, {
          new_name,
        });
        return data;
      } catch {
        const src = findMock(id);
        if (!src) throw new Error("Source report not found");
        const now = new Date().toISOString();
        const dup: Report = {
          ...structuredClone(src),
          id: `rep-${Math.random().toString(36).slice(2, 8)}`,
          name: new_name,
          embed_token: null,
          embed_enabled: false,
          created_at: now,
          updated_at: now,
        };
        mockStore.reports.unshift(dup);
        return dup;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reports"] }),
  });
}

export function useRunReport(id: string | undefined) {
  return useMutation({
    mutationFn: async (): Promise<RunReportResponse> => {
      if (!id) throw new Error("Missing id");
      try {
        const { data } = await api.post<RunReportResponse>(`/reports/${id}/run`, {});
        return data;
      } catch {
        const r = findMock(id);
        if (!r) throw new Error("Report not found");
        return {
          blocks: generateMockResults(r),
          ran_at: new Date().toISOString(),
        };
      }
    },
  });
}

export function useReportTemplates() {
  return useQuery({
    queryKey: ["reports", "templates"],
    queryFn: async (): Promise<SystemTemplate[]> => {
      try {
        const { data } = await api.get<SystemTemplate[]>("/reports/templates");
        return data;
      } catch {
        return MOCK_TEMPLATES;
      }
    },
  });
}

export function useReportDimensions() {
  return useQuery({
    queryKey: ["reports", "dimensions"],
    queryFn: async (): Promise<DimensionDef[]> => {
      try {
        const { data } = await api.get<DimensionDef[]>("/reports/dimensions");
        return data;
      } catch {
        return MOCK_DIMENSIONS;
      }
    },
  });
}

export function useReportMetrics() {
  return useQuery({
    queryKey: ["reports", "metrics"],
    queryFn: async (): Promise<MetricDef[]> => {
      try {
        const { data } = await api.get<MetricDef[]>("/reports/metrics");
        return data;
      } catch {
        return MOCK_METRICS;
      }
    },
  });
}

export function useGenerateEmbedToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<EmbedTokenResponse> => {
      try {
        const { data } = await api.post<EmbedTokenResponse>(
          `/reports/${id}/embed`
        );
        return data;
      } catch {
        const r = findMock(id);
        if (!r) throw new Error("Report not found");
        const token = `embed-${Math.random().toString(36).slice(2, 12)}`;
        r.embed_token = token;
        r.embed_enabled = true;
        const url =
          typeof window !== "undefined"
            ? `${window.location.origin}/embed/reports/${token}`
            : `/embed/reports/${token}`;
        return { token, url };
      }
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
      try {
        await api.delete(`/reports/${id}/embed`);
      } catch {
        const r = findMock(id);
        if (r) {
          r.embed_token = null;
          r.embed_enabled = false;
        }
      }
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
      try {
        const { data } = await api.get<EmbedReportData>(
          `/embed/reports/${token}`
        );
        return data;
      } catch {
        // Mock fallback: find report by token, run it.
        const r = mockStore.reports.find((x) => x.embed_token === token);
        if (!r) {
          // For demo, fall back to first report.
          const fb = mockStore.reports[0];
          return {
            report: fb,
            result: { blocks: generateMockResults(fb), ran_at: new Date().toISOString() },
          };
        }
        return {
          report: r,
          result: { blocks: generateMockResults(r), ran_at: new Date().toISOString() },
        };
      }
    },
  });
}
