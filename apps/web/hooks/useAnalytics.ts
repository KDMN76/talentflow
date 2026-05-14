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

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_OVERVIEW: AnalyticsOverview = {
  open_jobs: 8,
  total_candidates: 234,
  applications_this_month: 47,
  avg_time_to_hire_days: 21,
  hired_this_month: 4,
  active_recruiters: 5,
};

const MOCK_FUNNEL: FunnelStage[] = [
  { stage_name: "Nieuwe sollicitaties", count: 120, conversion_rate: 100 },
  { stage_name: "Screening", count: 84, conversion_rate: 70 },
  { stage_name: "Interview", count: 45, conversion_rate: 37.5 },
  { stage_name: "Technische test", count: 24, conversion_rate: 20 },
  { stage_name: "Aanbieding", count: 12, conversion_rate: 10 },
  { stage_name: "Aangenomen", count: 8, conversion_rate: 6.7 },
];

const MOCK_RECRUITERS: RecruiterStat[] = [
  {
    recruiter_id: "u1",
    recruiter_name: "Emma Bakker",
    open_jobs: 3,
    applications_this_month: 18,
    hires_this_month: 2,
    avg_time_to_hire_days: 19,
  },
  {
    recruiter_id: "u2",
    recruiter_name: "Jan Peters",
    open_jobs: 2,
    applications_this_month: 14,
    hires_this_month: 1,
    avg_time_to_hire_days: 24,
  },
  {
    recruiter_id: "u3",
    recruiter_name: "Lisa Smits",
    open_jobs: 3,
    applications_this_month: 15,
    hires_this_month: 1,
    avg_time_to_hire_days: 20,
  },
];

const MOCK_SOURCES: SourceBreakdown[] = [
  { source: "LinkedIn", count: 105, percentage: 45 },
  { source: "Indeed", count: 65, percentage: 28 },
  { source: "Referral", count: 35, percentage: 15 },
  { source: "Website", count: 19, percentage: 8 },
  { source: "Anders", count: 10, percentage: 4 },
];

const MOCK_TIME_TO_HIRE: TimeToHirePoint[] = [
  { month: "Nov 2023", avg_days: 28 },
  { month: "Dec 2023", avg_days: 25 },
  { month: "Jan 2024", avg_days: 22 },
  { month: "Feb 2024", avg_days: 24 },
  { month: "Mrt 2024", avg_days: 20 },
  { month: "Apr 2024", avg_days: 18 },
];

const MOCK_APPLICATIONS_TREND: ApplicationsTrendPoint[] = [
  { week: "4 Mar", count: 8 },
  { week: "11 Mar", count: 12 },
  { week: "18 Mar", count: 9 },
  { week: "25 Mar", count: 15 },
  { week: "1 Apr", count: 11 },
  { week: "8 Apr", count: 18 },
  { week: "15 Apr", count: 14 },
  { week: "22 Apr", count: 22 },
];

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useAnalyticsOverview() {
  return useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: async (): Promise<AnalyticsOverview> => {
      try {
        const { data } = await api.get<AnalyticsOverview>(
          "/api/analytics/overview"
        );
        return data;
      } catch {
        return MOCK_OVERVIEW;
      }
    },
  });
}

export function useAnalyticsFunnel() {
  return useQuery({
    queryKey: ["analytics", "funnel"],
    queryFn: async (): Promise<FunnelStage[]> => {
      try {
        const { data } = await api.get<FunnelStage[]>("/api/analytics/funnel");
        return data;
      } catch {
        return MOCK_FUNNEL;
      }
    },
  });
}

export function useAnalyticsRecruiterStats() {
  return useQuery({
    queryKey: ["analytics", "recruiters"],
    queryFn: async (): Promise<RecruiterStat[]> => {
      try {
        const { data } = await api.get<RecruiterStat[]>(
          "/api/analytics/recruiters"
        );
        return data;
      } catch {
        return MOCK_RECRUITERS;
      }
    },
  });
}

export function useAnalyticsSourceBreakdown() {
  return useQuery({
    queryKey: ["analytics", "sources"],
    queryFn: async (): Promise<SourceBreakdown[]> => {
      try {
        const { data } = await api.get<SourceBreakdown[]>(
          "/api/analytics/sources"
        );
        return data;
      } catch {
        return MOCK_SOURCES;
      }
    },
  });
}

export function useAnalyticsTimeToHireTrend() {
  return useQuery({
    queryKey: ["analytics", "time-to-hire-trend"],
    queryFn: async (): Promise<TimeToHirePoint[]> => {
      try {
        const { data } = await api.get<TimeToHirePoint[]>(
          "/api/analytics/time-to-hire-trend"
        );
        return data;
      } catch {
        return MOCK_TIME_TO_HIRE;
      }
    },
  });
}

export function useAnalyticsApplicationsTrend() {
  return useQuery({
    queryKey: ["analytics", "applications-trend"],
    queryFn: async (): Promise<ApplicationsTrendPoint[]> => {
      try {
        const { data } = await api.get<ApplicationsTrendPoint[]>(
          "/api/analytics/applications-trend"
        );
        return data;
      } catch {
        return MOCK_APPLICATIONS_TREND;
      }
    },
  });
}
