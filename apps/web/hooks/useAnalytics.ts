"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ─── Filters ──────────────────────────────────────────────────────────────────

export interface AnalyticsFilters {
  /** ISO-datum: ondergrens periode. */
  from?: string | null;
  /** ISO-datum: bovengrens periode (exclusief). */
  to?: string | null;
  recruiterId?: string | null;
}

function toParams(f?: AnalyticsFilters): Record<string, string> | undefined {
  if (!f) return undefined;
  const p: Record<string, string> = {};
  if (f.from) p.from = f.from;
  if (f.to) p.to = f.to;
  if (f.recruiterId) p.recruiter_id = f.recruiterId;
  return Object.keys(p).length ? p : undefined;
}

function keyOf(f?: AnalyticsFilters) {
  return [f?.from ?? null, f?.to ?? null, f?.recruiterId ?? null];
}

// ─── Type interfaces ──────────────────────────────────────────────────────────

export interface AnalyticsOverview {
  open_jobs: number;
  total_candidates: number;
  applications_this_month: number;
  avg_time_to_hire_days: number;
  hired_this_month: number;
  active_recruiters: number;
}

export interface FunnelStage {
  stage_name: string;
  count: number;
  conversion_rate: number;
}

export interface RecruiterStat {
  recruiter_id: string;
  recruiter_name: string;
  open_jobs: number;
  applications_this_month: number;
  hires_this_month: number;
  avg_time_to_hire_days: number;
}

export interface SourceBreakdown {
  source: string;
  count: number;
  percentage: number;
}

export interface TimeToHirePoint {
  month: string;
  avg_days: number;
}

export interface ApplicationsTrendPoint {
  week: string;
  count: number;
}

// ─── AI & Bias (Sprint Q4.6 — EU AI Act bias-monitoring) ─────────────────────

export interface AdverseImpactGroup {
  group: string;
  total: number;
  selected: number;
  selection_rate: number;
  impact_ratio: number | null;
  passes_four_fifths: boolean | null;
  insufficient_data: boolean;
  is_reference: boolean;
}

export type AdverseImpactDimension = "gender" | "age_bracket" | "nationality";

export interface AdverseImpactReport {
  selected_definition: "hired";
  min_group_size: number;
  four_fifths_threshold: number;
  total_applications: number;
  dimensions: Array<{
    dimension: AdverseImpactDimension;
    groups: AdverseImpactGroup[];
  }>;
}

export interface AiUsageMonth {
  month: string;
  month_label: string;
  total: number;
  by_feature: Record<string, number>;
}

export interface AiUsageTrend {
  months: AiUsageMonth[];
  features: string[];
}

export interface MatchScoreBucket {
  bucket: string;
  from_pct: number;
  count: number;
}

export interface MatchScoreDistribution {
  buckets: MatchScoreBucket[];
  total: number;
  avg_score_pct: number;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useAnalyticsOverview(filters?: AnalyticsFilters) {
  return useQuery({
    queryKey: ["analytics", "overview", keyOf(filters)],
    queryFn: async (): Promise<AnalyticsOverview> => {
      const { data } = await api.get<AnalyticsOverview>("/analytics/overview", {
        params: toParams(filters),
      });
      return data;
    },
  });
}

export function useAnalyticsFunnel(filters?: AnalyticsFilters) {
  return useQuery({
    queryKey: ["analytics", "funnel", keyOf(filters)],
    queryFn: async (): Promise<FunnelStage[]> => {
      const { data } = await api.get<FunnelStage[]>("/analytics/funnel", {
        params: toParams(filters),
      });
      return data;
    },
  });
}

export function useAnalyticsRecruiterStats(filters?: AnalyticsFilters) {
  return useQuery({
    queryKey: ["analytics", "recruiters", keyOf(filters)],
    queryFn: async (): Promise<RecruiterStat[]> => {
      const { data } = await api.get<RecruiterStat[]>("/analytics/recruiters", {
        params: toParams(filters),
      });
      return data;
    },
  });
}

export function useAnalyticsSourceBreakdown(filters?: AnalyticsFilters) {
  return useQuery({
    queryKey: ["analytics", "sources", keyOf(filters)],
    queryFn: async (): Promise<SourceBreakdown[]> => {
      const { data } = await api.get<SourceBreakdown[]>("/analytics/sources", {
        params: toParams(filters),
      });
      return data;
    },
  });
}

export function useAnalyticsTimeToHireTrend(filters?: AnalyticsFilters) {
  return useQuery({
    queryKey: ["analytics", "time-to-hire-trend", keyOf(filters)],
    queryFn: async (): Promise<TimeToHirePoint[]> => {
      const { data } = await api.get<TimeToHirePoint[]>(
        "/analytics/time-to-hire-trend",
        { params: toParams(filters) }
      );
      return data;
    },
  });
}

export function useAnalyticsApplicationsTrend(filters?: AnalyticsFilters) {
  return useQuery({
    queryKey: ["analytics", "applications-trend", keyOf(filters)],
    queryFn: async (): Promise<ApplicationsTrendPoint[]> => {
      const { data } = await api.get<ApplicationsTrendPoint[]>(
        "/analytics/applications-trend",
        { params: toParams(filters) }
      );
      return data;
    },
  });
}

// ─── AI & Bias hooks (Sprint Q4.6) ───────────────────────────────────────────

export function useAnalyticsAdverseImpact(filters?: AnalyticsFilters) {
  return useQuery({
    queryKey: ["analytics", "adverse-impact", keyOf(filters)],
    queryFn: async (): Promise<AdverseImpactReport> => {
      const { data } = await api.get<AdverseImpactReport>(
        "/analytics/adverse-impact",
        { params: toParams(filters) }
      );
      return data;
    },
  });
}

export function useAnalyticsAiUsageTrend(filters?: AnalyticsFilters) {
  return useQuery({
    queryKey: ["analytics", "ai-usage-trend", keyOf(filters)],
    queryFn: async (): Promise<AiUsageTrend> => {
      const { data } = await api.get<AiUsageTrend>(
        "/analytics/ai-usage-trend",
        { params: toParams(filters) }
      );
      return data;
    },
  });
}

export function useAnalyticsMatchScoreDistribution(filters?: AnalyticsFilters) {
  return useQuery({
    queryKey: ["analytics", "match-score-distribution", keyOf(filters)],
    queryFn: async (): Promise<MatchScoreDistribution> => {
      const { data } = await api.get<MatchScoreDistribution>(
        "/analytics/match-score-distribution",
        { params: toParams(filters) }
      );
      return data;
    },
  });
}
