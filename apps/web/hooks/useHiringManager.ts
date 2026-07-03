"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ScorecardInput } from "@/lib/types/atsExtensions";

export interface HMDashboard {
  open_jobs: number;
  pending_reviews: number;
  approved_today: number;
  rejected_today: number;
}

export interface HMJob {
  id: string;
  title: string;
  application_count: number;
  location: string;
}

export interface HMSkillScore {
  name: string;
  score: number; // 0..100
}

export interface HMReview {
  application_id: string;
  candidate_name: string;
  candidate_email: string;
  candidate_avatar_url?: string | null;
  candidate_position?: string | null;
  ai_score: number | null;
  applied_at: string;
  job_id: string;
  job_title: string;
  stage_name: string;
  stage_id?: string | null;
  ai_summary?: string;
  skills?: string[];
  /** Top-3 weighted skills with scores 0..100 — used in HM card. */
  top_skills?: HMSkillScore[];
  /** Set when user hits "Later" — for sort-to-bottom in current session. */
  last_skipped_at?: string;
}

export interface HMScorecardDeadline {
  application_id: string;
  candidate_name: string;
  candidate_avatar_url?: string | null;
  job_id: string;
  job_title: string;
  stage_id?: string | null;
  stage_name: string;
  /** ISO deadline. */
  due_at: string;
  /** Bucket helper for filters. */
  bucket: "overdue" | "today" | "this_week" | "later";
}

export interface HMStats {
  to_review: number;
  scorecards_due_today: number;
  scorecards_overdue: number;
  approved_today: number;
}

// ----------------------------------------------------------------------------
// Mock data — rich Dutch examples used as fallback when the API is unreachable
// ----------------------------------------------------------------------------

const mockHMDashboard: HMDashboard = {
  open_jobs: 7,
  pending_reviews: 5,
  approved_today: 3,
  rejected_today: 1,
};

const mockHMJobs: HMJob[] = [
  {
    id: "hm-job-1",
    title: "Senior Full-Stack Developer",
    application_count: 14,
    location: "Amsterdam",
  },
  {
    id: "hm-job-2",
    title: "Product Designer (Mid-level)",
    application_count: 9,
    location: "Utrecht / Hybride",
  },
  {
    id: "hm-job-3",
    title: "Data Engineer",
    application_count: 6,
    location: "Rotterdam",
  },
];

const mockHMReviews: HMReview[] = [
  {
    application_id: "app-hm-1",
    candidate_name: "Sanne de Vries",
    candidate_email: "sanne.devries@example.nl",
    candidate_position: "Senior Full-Stack Developer",
    ai_score: 92,
    applied_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    job_id: "hm-job-1",
    job_title: "Senior Full-Stack Developer",
    stage_id: "stage-hm-review",
    stage_name: "Hiring Manager Review",
    ai_summary:
      "Sterke match. 7 jaar ervaring met Node.js en React, leiding gegeven aan een team van 5. Heeft eerder bij scale-ups gewerkt en past bij de cultuur.",
    skills: ["TypeScript", "Node.js", "React", "PostgreSQL", "AWS"],
    top_skills: [
      { name: "TypeScript", score: 95 },
      { name: "React", score: 92 },
      { name: "Node.js", score: 88 },
    ],
  },
  {
    application_id: "app-hm-2",
    candidate_name: "Mehmet Yıldız",
    candidate_email: "m.yildiz@example.nl",
    candidate_position: "Product Designer",
    ai_score: 88,
    applied_at: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
    job_id: "hm-job-2",
    job_title: "Product Designer (Mid-level)",
    stage_id: "stage-hm-review",
    stage_name: "Hiring Manager Review",
    ai_summary:
      "Sterke portfolio met B2B SaaS werk. Werkt graag in design systems en heeft ervaring met Figma + research. Locatie kan een aandachtspunt zijn.",
    skills: ["Figma", "Design Systems", "User Research", "Prototyping"],
    top_skills: [
      { name: "Figma", score: 94 },
      { name: "Design Systems", score: 86 },
      { name: "User Research", score: 79 },
    ],
  },
  {
    application_id: "app-hm-3",
    candidate_name: "Lieke Janssen",
    candidate_email: "lieke.janssen@example.nl",
    candidate_position: "Data Engineer",
    ai_score: 76,
    applied_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    job_id: "hm-job-3",
    job_title: "Data Engineer",
    stage_id: "stage-hm-review",
    stage_name: "Hiring Manager Review",
    ai_summary:
      "Solide technische basis met Python en dbt. Mist nog wat ervaring met streaming pipelines, maar leerbereidheid is hoog.",
    skills: ["Python", "dbt", "Snowflake", "Airflow", "SQL"],
    top_skills: [
      { name: "Python", score: 84 },
      { name: "SQL", score: 81 },
      { name: "dbt", score: 72 },
    ],
  },
  {
    application_id: "app-hm-4",
    candidate_name: "Daan Kuipers",
    candidate_email: "daan.kuipers@example.nl",
    candidate_position: "Full-Stack Developer",
    ai_score: 81,
    applied_at: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
    job_id: "hm-job-1",
    job_title: "Senior Full-Stack Developer",
    stage_id: "stage-hm-review",
    stage_name: "Hiring Manager Review",
    ai_summary:
      "Goede full-stack ervaring met Vue en Laravel. Wil overstappen naar React-stack — gemotiveerd en zelflerend.",
    skills: ["Vue.js", "Laravel", "PHP", "MySQL", "Docker"],
    top_skills: [
      { name: "Vue.js", score: 88 },
      { name: "Laravel", score: 85 },
      { name: "MySQL", score: 76 },
    ],
  },
  {
    application_id: "app-hm-5",
    candidate_name: "Aïsha El Amrani",
    candidate_email: "aisha.elamrani@example.nl",
    candidate_position: "Senior Product Designer",
    ai_score: 95,
    applied_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    job_id: "hm-job-2",
    job_title: "Product Designer (Mid-level)",
    stage_id: "stage-hm-review",
    stage_name: "Hiring Manager Review",
    ai_summary:
      "Top kandidaat. 5 jaar bij design-led product teams, sterk in interaction design en accessibility. Kandidaat bekend met onze branche.",
    skills: ["Figma", "Accessibility", "Interaction Design", "Design Tokens", "Webflow"],
    top_skills: [
      { name: "Figma", score: 96 },
      { name: "Accessibility", score: 94 },
      { name: "Interaction Design", score: 91 },
    ],
  },
];

function isoIn(hours: number): string {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

const mockHMScorecardDeadlines: HMScorecardDeadline[] = [
  {
    application_id: "app-1",
    candidate_name: "Tom Hartog",
    job_id: "hm-job-1",
    job_title: "Senior Full-Stack Developer",
    stage_id: "stage-tech",
    stage_name: "Technical Interview",
    due_at: isoIn(-26),
    bucket: "overdue",
  },
  {
    application_id: "app-hm-1",
    candidate_name: "Sanne de Vries",
    job_id: "hm-job-1",
    job_title: "Senior Full-Stack Developer",
    stage_id: "stage-tech",
    stage_name: "Technical Interview",
    due_at: isoIn(6),
    bucket: "today",
  },
  {
    application_id: "app-hm-2",
    candidate_name: "Mehmet Yıldız",
    job_id: "hm-job-2",
    job_title: "Product Designer (Mid-level)",
    stage_id: "stage-portfolio",
    stage_name: "Portfolio Review",
    due_at: isoIn(48),
    bucket: "this_week",
  },
  {
    application_id: "app-hm-5",
    candidate_name: "Aïsha El Amrani",
    job_id: "hm-job-2",
    job_title: "Product Designer (Mid-level)",
    stage_id: "stage-cultural",
    stage_name: "Cultural Fit",
    due_at: isoIn(120),
    bucket: "this_week",
  },
  {
    application_id: "app-hm-3",
    candidate_name: "Lieke Janssen",
    job_id: "hm-job-3",
    job_title: "Data Engineer",
    stage_id: "stage-tech",
    stage_name: "Technical Interview",
    due_at: isoIn(7 * 24 + 5),
    bucket: "later",
  },
];

const mockHMStats: HMStats = {
  to_review: mockHMReviews.length,
  scorecards_due_today: 1,
  scorecards_overdue: 1,
  approved_today: 3,
};

// ----------------------------------------------------------------------------
// Hooks
// ----------------------------------------------------------------------------

// Mock-fallbacks ALLEEN in expliciete mock-modus. Voorheen vielen alle hooks
// bij élke fout stil terug op verzonnen cijfers — een demo toonde dan nepdata
// alsof het echt was. Buiten mock-modus propageert de fout nu netjes naar de
// error/empty-states van de UI.
const MOCK_MODE = process.env.NEXT_PUBLIC_USE_MOCK_DATA === "true";

export function useHMDashboard() {
  return useQuery({
    queryKey: ["hm", "dashboard"],
    queryFn: async () => {
      try {
        const { data } = await api.get<HMDashboard>("/hm/dashboard");
        return data;
      } catch (err) {
        if (MOCK_MODE) return mockHMDashboard;
        throw err;
      }
    },
  });
}

export function useHMJobs() {
  return useQuery({
    queryKey: ["hm", "jobs"],
    queryFn: async () => {
      try {
        const { data } = await api.get<{ data: HMJob[] }>("/hm/jobs");
        return data.data;
      } catch (err) {
        if (MOCK_MODE) return [...mockHMJobs];
        throw err;
      }
    },
  });
}

/** Shape zoals de backend hem levert (apps/api modules/hm). */
interface HmPendingReviewApi {
  application_id: string;
  candidate_id: string;
  candidate_name: string;
  candidate_email: string | null;
  candidate_position: string | null;
  ai_score: number | null;
  applied_at: string;
  job_id: string;
  job_title: string;
  stage_id: string | null;
  stage_name: string | null;
  summary: string | null;
  skills: string[];
}

export function usePendingReviews() {
  return useQuery({
    queryKey: ["hm", "reviews", "pending"],
    queryFn: async (): Promise<HMReview[]> => {
      try {
        const { data } = await api.get<{ data: HmPendingReviewApi[] }>(
          "/hm/reviews/pending"
        );
        return data.data.map((r) => ({
          application_id: r.application_id,
          candidate_name: r.candidate_name,
          candidate_email: r.candidate_email ?? "",
          candidate_position: r.candidate_position,
          ai_score: r.ai_score,
          applied_at: r.applied_at,
          job_id: r.job_id,
          job_title: r.job_title,
          stage_id: r.stage_id,
          stage_name: r.stage_name ?? "",
          ai_summary: r.summary ?? undefined,
          skills: r.skills ?? [],
        }));
      } catch (err) {
        if (MOCK_MODE) return [...mockHMReviews];
        throw err;
      }
    },
  });
}

/** Alias – Q2.4 swipe-deck reads the HM queue here. */
export function useHmCandidatesToReview() {
  return usePendingReviews();
}

export function useHmStats() {
  return useQuery({
    queryKey: ["hm", "stats"],
    queryFn: async (): Promise<HMStats> => {
      try {
        const { data } = await api.get<HMStats>("/hm/stats");
        return data;
      } catch (err) {
        if (MOCK_MODE) return { ...mockHMStats };
        throw err;
      }
    },
  });
}

export function useHmScorecardDeadlines() {
  return useQuery({
    queryKey: ["hm", "scorecards", "deadlines"],
    queryFn: async (): Promise<HMScorecardDeadline[]> => {
      try {
        const { data } = await api.get<{ data: HMScorecardDeadline[] }>(
          "/hm/scorecards/deadlines"
        );
        return data.data;
      } catch (err) {
        if (MOCK_MODE) return [...mockHMScorecardDeadlines];
        // Fout propageert naar de error-state van de pagina — geen stille
        // lege lijst die "alles is af" suggereert terwijl de API stuk is.
        throw err;
      }
    },
  });
}

export interface HmDecisionInput {
  candidateId: string; // application_id from the queue
  decision: "approve" | "reject" | "later";
  notes?: string;
  scorecard?: ScorecardInput;
  /** Huidige pipeline-fase — nodig om de scorecard aan de fase te koppelen. */
  stageId?: string | null;
}

/**
 * The Q2.4 swipe-deck mutation. Optionally submits an inline scorecard first
 * (mapped naar het backend-contract van POST /applications/:id/scorecards),
 * daarna de review-beslissing. Fouten propageren — geen mock-succes.
 */
export function useHmDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      candidateId,
      decision,
      notes,
      scorecard,
      stageId,
    }: HmDecisionInput) => {
      if (scorecard) {
        // Backend-contract: criteria_scores [{criterion, score}], submit-vlag
        // voor 'ingediend' i.p.v. draft. De oude code stuurde het frontend-
        // shape (criteria/template_id) dat door zod werd weggestript — de
        // scorecard kwam dan als lege draft binnen: een stille dataverlies-bug.
        await api.post(`/applications/${candidateId}/scorecards`, {
          stage_id: stageId ?? null,
          overall_score: scorecard.overall_score,
          recommendation: scorecard.recommendation,
          notes: scorecard.notes ?? undefined,
          criteria_scores: scorecard.criteria
            .filter((c): c is { key: string; label: string; score: number } =>
              c.score !== null
            )
            .map((c) => ({ criterion: c.label, score: c.score })),
          submit: true,
        });
      }
      const { data } = await api.post<{ ok: true }>(
        `/hm/applications/${candidateId}/review`,
        { decision, notes }
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hm", "dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["hm", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["hm", "reviews", "pending"] });
      queryClient.invalidateQueries({ queryKey: ["hm", "scorecards", "deadlines"] });
    },
  });
}
