"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  buildMockSkillsGap,
  findMockEscoByLabel,
  getMockCandidateSkillProfile,
  getMockJobSkillProfile,
  mockDemandSupply,
  mockEscoSkills,
  mockTrendingSkills,
  setMockCandidateSkillProfile,
  setMockJobSkillProfile,
} from "@/lib/mockSkills";
import type {
  CandidateSkillProfile,
  DemandSupplyResponse,
  EscoCategory,
  EscoSkill,
  JobSkillProfile,
  ProfileSkill,
  SkillsGapAnalysis,
  TrendingSkill,
} from "@/lib/types/skills";

// ─── ESCO search ────────────────────────────────────────────────────────────

export interface EscoSearchFilters {
  q?: string;
  category?: EscoCategory | "all";
  limit?: number;
}

export function useEscoSearch(filters: EscoSearchFilters = {}) {
  const limit = filters.limit ?? 20;
  return useQuery({
    queryKey: ["skills", "esco", filters],
    queryFn: async (): Promise<EscoSkill[]> => {
      try {
        const { data } = await api.get<{ data: EscoSkill[] }>("/skills/esco", {
          params: filters,
        });
        return data.data;
      } catch {
        const q = (filters.q ?? "").toLowerCase().trim();
        return mockEscoSkills
          .filter((s) => {
            if (
              filters.category &&
              filters.category !== "all" &&
              s.category !== filters.category
            )
              return false;
            if (!q) return true;
            const hay = [
              s.preferred_label,
              ...s.alt_labels,
              s.description ?? "",
            ]
              .join(" ")
              .toLowerCase();
            return hay.includes(q);
          })
          .slice(0, limit);
      }
    },
    // Skill catalogue is static-ish — keep fresh for 5 minutes.
    staleTime: 1000 * 60 * 5,
  });
}

// ─── Candidate / job skill profiles ─────────────────────────────────────────

export function useCandidateSkillProfile(candidateId: string | undefined) {
  return useQuery({
    queryKey: ["skills", "candidate-profile", candidateId],
    enabled: !!candidateId,
    queryFn: async (): Promise<CandidateSkillProfile> => {
      try {
        const { data } = await api.get<CandidateSkillProfile>(
          `/candidates/${candidateId}/skill-profile`
        );
        return data;
      } catch {
        return getMockCandidateSkillProfile(candidateId!);
      }
    },
  });
}

export function useJobSkillProfile(jobId: string | undefined) {
  return useQuery({
    queryKey: ["skills", "job-profile", jobId],
    enabled: !!jobId,
    queryFn: async (): Promise<JobSkillProfile> => {
      try {
        const { data } = await api.get<JobSkillProfile>(
          `/jobs/${jobId}/skill-profile`
        );
        return data;
      } catch {
        return getMockJobSkillProfile(jobId!);
      }
    },
  });
}

export function useSyncCandidateEsco() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      candidateId: string
    ): Promise<CandidateSkillProfile> => {
      try {
        const { data } = await api.post<CandidateSkillProfile>(
          `/candidates/${candidateId}/sync-esco`
        );
        return data;
      } catch {
        const existing = getMockCandidateSkillProfile(candidateId);
        const refreshed: CandidateSkillProfile = {
          ...existing,
          last_synced_at: new Date().toISOString(),
          skills: existing.skills.map((s) => ({
            ...s,
            source: s.esco_id ? "esco_match" : s.source,
          })),
        };
        setMockCandidateSkillProfile(candidateId, refreshed);
        return refreshed;
      }
    },
    onSuccess: (_data, candidateId) => {
      queryClient.invalidateQueries({
        queryKey: ["skills", "candidate-profile", candidateId],
      });
    },
  });
}

export function useSyncJobEsco() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string): Promise<JobSkillProfile> => {
      try {
        const { data } = await api.post<JobSkillProfile>(
          `/jobs/${jobId}/sync-esco`
        );
        return data;
      } catch {
        const existing = getMockJobSkillProfile(jobId);
        const refreshed: JobSkillProfile = {
          ...existing,
          last_synced_at: new Date().toISOString(),
        };
        setMockJobSkillProfile(jobId, refreshed);
        return refreshed;
      }
    },
    onSuccess: (_data, jobId) => {
      queryClient.invalidateQueries({
        queryKey: ["skills", "job-profile", jobId],
      });
    },
  });
}

/**
 * Local-only mutation that updates the candidate's skill profile in the mock
 * store. The backend (HHH) would expose a PATCH endpoint, but in mock-mode we
 * simply persist into our in-memory store so that subsequent reads see the
 * changes.
 */
export function useUpdateCandidateSkillProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      candidateId,
      skills,
    }: {
      candidateId: string;
      skills: ProfileSkill[];
    }): Promise<CandidateSkillProfile> => {
      try {
        const { data } = await api.patch<CandidateSkillProfile>(
          `/candidates/${candidateId}/skill-profile`,
          { skills }
        );
        return data;
      } catch {
        const profile: CandidateSkillProfile = {
          candidate_id: candidateId,
          skills,
          last_synced_at: new Date().toISOString(),
        };
        setMockCandidateSkillProfile(candidateId, profile);
        return profile;
      }
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["skills", "candidate-profile", vars.candidateId],
      });
    },
  });
}

// ─── Skills-gap ──────────────────────────────────────────────────────────────

export function useSkillsGap(
  jobId: string | undefined,
  candidateId: string | undefined
) {
  return useQuery({
    queryKey: ["skills", "gap", jobId, candidateId],
    enabled: !!jobId && !!candidateId,
    queryFn: async (): Promise<SkillsGapAnalysis> => {
      try {
        const { data } = await api.get<SkillsGapAnalysis>(
          `/jobs/${jobId}/candidates/${candidateId}/skills-gap`
        );
        return data;
      } catch {
        return buildMockSkillsGap(jobId!, candidateId!);
      }
    },
    staleTime: 1000 * 30,
  });
}

// ─── Trending + demand/supply ────────────────────────────────────────────────

export interface TrendingSkillsFilters {
  category?: EscoCategory | "all";
  limit?: number;
}

export function useTrendingSkills(filters: TrendingSkillsFilters = {}) {
  return useQuery({
    queryKey: ["skills", "trending", filters],
    queryFn: async (): Promise<TrendingSkill[]> => {
      try {
        const { data } = await api.get<{ data: TrendingSkill[] }>(
          "/skills/trending",
          { params: filters }
        );
        return data.data;
      } catch {
        let list = [...mockTrendingSkills];
        if (filters.category && filters.category !== "all") {
          list = list.filter((t) => t.category === filters.category);
        }
        if (filters.limit) list = list.slice(0, filters.limit);
        return list;
      }
    },
    staleTime: 1000 * 60,
  });
}

export function useDemandSupply() {
  return useQuery({
    queryKey: ["skills", "demand-supply"],
    queryFn: async (): Promise<DemandSupplyResponse> => {
      try {
        const { data } = await api.get<DemandSupplyResponse>(
          "/skills/demand-supply"
        );
        return data;
      } catch {
        return mockDemandSupply;
      }
    },
    staleTime: 1000 * 60,
  });
}

// ─── Re-exports for convenience ──────────────────────────────────────────────

export { findMockEscoByLabel };
