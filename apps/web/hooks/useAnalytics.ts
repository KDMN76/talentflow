"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

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

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useAnalyticsOverview() {
  return useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: async (): Promise<AnalyticsOverview> => {
      const { data } = await api.get<AnalyticsOverview>(
        "/analytics/overview"
      );
      return data;
    },
  });
}

export function useAnalyticsFunnel() {
  return useQuery({
    queryKey: ["analytics", "funnel"],
    queryFn: async (): Promise<FunnelStage[]> => {
      const { data } = await api.get<FunnelStage[]>("/analytics/funnel");
      return data;
    },
  });
}

export function useAnalyticsRecruiterStats() {
  return useQuery({
    queryKey: ["analytics", "recruiters"],
    queryFn: async (): Promise<RecruiterStat[]> => {
      const { data } = await api.get<RecruiterStat[]>(
        "/analytics/recruiters"
      );
      return data;
    },
  });
}

export function useAnalyticsSourceBreakdown() {
  return useQuery({
    queryKey: ["analytics", "sources"],
    queryFn: async (): Promise<SourceBreakdown[]> => {
      const { data } = await api.get<SourceBreakdown[]>(
        "/analytics/sources"
      );
      return data;
    },
  });
}

export function useAnalyticsTimeToHireTrend() {
  return useQuery({
    queryKey: ["analytics", "time-to-hire-trend"],
    queryFn: async (): Promise<TimeToHirePoint[]> => {
      const { data } = await api.get<TimeToHirePoint[]>(
        "/analytics/time-to-hire-trend"
      );
      return data;
    },
  });
}

export function useAnalyticsApplicationsTrend() {
  return useQuery({
    queryKey: ["analytics", "applications-trend"],
    queryFn: async (): Promise<ApplicationsTrendPoint[]> => {
      const { data } = await api.get<ApplicationsTrendPoint[]>(
        "/analytics/applications-trend"
      );
      return data;
    },
  });
}
