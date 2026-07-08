/**
 * Mock-data fallback for the Skills Graph + Pay Transparency + DEI features.
 *
 * Lives in its own module so the main `mockData.ts` stays focused. The hooks in
 * `useSkills.ts` and the new compliance hooks fall back to these arrays
 * whenever the backend (HHH/III) is offline or returns a non-200 response.
 */

import type {
  CandidateSkillProfile,
  DEIFunnelReport,
  DEIFunnelSnapshot,
  DeiBiasLevel,
  DemandSupplyResponse,
  EscoCategory,
  EscoSkill,
  JobSkillProfile,
  PayEquityReport,
  PayEquitySnapshot,
  SkillsGapAnalysis,
  SkillsGapRecommendation,
  TenantPaySettings,
  TrendingSkill,
  TrendingSkillPoint,
} from "@/lib/types/skills";

// ─── ESCO catalogue (30 skills) ──────────────────────────────────────────────

interface RawEscoSkill {
  label: string;
  category: EscoCategory;
  alt?: string[];
  description?: string;
  candidate_count: number;
}

const RAW_ESCO: RawEscoSkill[] = [
  { label: "React", category: "technical", alt: ["React.js", "ReactJS"], candidate_count: 18, description: "JavaScript-bibliotheek voor het bouwen van gebruikersinterfaces." },
  { label: "TypeScript", category: "technical", alt: ["TS"], candidate_count: 22, description: "Typed superset van JavaScript die compileert naar plain JS." },
  { label: "Node.js", category: "technical", alt: ["NodeJS"], candidate_count: 15, description: "JavaScript runtime voor server-side ontwikkeling." },
  { label: "Next.js", category: "technical", alt: ["NextJS"], candidate_count: 9, description: "React framework voor SSR en SSG." },
  { label: "GraphQL", category: "technical", candidate_count: 7, description: "Query-taal voor APIs met sterk type-systeem." },
  { label: "Python", category: "technical", candidate_count: 24, description: "Programmeertaal voor data, web en automation." },
  { label: "Django", category: "technical", candidate_count: 6, description: "High-level Python webframework." },
  { label: "PostgreSQL", category: "technical", alt: ["Postgres"], candidate_count: 14, description: "Relationele database." },
  { label: "Docker", category: "tool", candidate_count: 19, description: "Containerisatieplatform." },
  { label: "Kubernetes", category: "tool", alt: ["k8s"], candidate_count: 8, description: "Container-orchestratie." },
  { label: "AWS", category: "tool", alt: ["Amazon Web Services"], candidate_count: 16, description: "Cloud-platform van Amazon." },
  { label: "Azure", category: "tool", candidate_count: 6, description: "Cloud-platform van Microsoft." },
  { label: "GCP", category: "tool", alt: ["Google Cloud Platform"], candidate_count: 4, description: "Cloud-platform van Google." },
  { label: "Figma", category: "tool", candidate_count: 5, description: "Browser-based UI-design tool." },
  { label: "User Research", category: "soft", candidate_count: 4, description: "Onderzoeksmethoden voor UX." },
  { label: "Product Management", category: "domain", alt: ["Productmanagement"], candidate_count: 7, description: "Strategie en uitvoering van productontwikkeling." },
  { label: "Agile", category: "soft", alt: ["Scrum", "Kanban"], candidate_count: 21, description: "Iteratieve werkwijze." },
  { label: "Stakeholder Management", category: "soft", candidate_count: 11, description: "Communicatie met belanghebbenden." },
  { label: "Leiderschap", category: "soft", alt: ["Leadership"], candidate_count: 9, description: "Mensen aansturen en motiveren." },
  { label: "Communicatie", category: "soft", alt: ["Communication"], candidate_count: 27, description: "Effectief informatie overdragen." },
  { label: "Nederlands", category: "language", alt: ["Dutch"], candidate_count: 30, description: "Nederlandse taalvaardigheid." },
  { label: "Engels", category: "language", alt: ["English"], candidate_count: 28, description: "Engelse taalvaardigheid." },
  { label: "Duits", category: "language", alt: ["German", "Deutsch"], candidate_count: 6, description: "Duitse taalvaardigheid." },
  { label: "Frans", category: "language", alt: ["French"], candidate_count: 4, description: "Franse taalvaardigheid." },
  { label: "AWS Certified Solutions Architect", category: "certification", alt: ["AWS SAA"], candidate_count: 3, description: "AWS architect-certificering." },
  { label: "PMP", category: "certification", alt: ["Project Management Professional"], candidate_count: 2, description: "Project Management Institute certificering." },
  { label: "CISSP", category: "certification", candidate_count: 1, description: "Information security certificering." },
  { label: "Data Analyse", category: "domain", alt: ["Data Analysis"], candidate_count: 12, description: "Werken met data om inzicht te genereren." },
  { label: "Machine Learning", category: "technical", alt: ["ML"], candidate_count: 5, description: "Algoritmes die leren van data." },
  { label: "SQL", category: "technical", candidate_count: 23, description: "Query-taal voor relationele databases." },
];

export const mockEscoSkills: EscoSkill[] = RAW_ESCO.map((raw, i) => ({
  id: `esco-${i + 1}`,
  esco_uri: `http://data.europa.eu/esco/skill/${raw.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  preferred_label: raw.label,
  alt_labels: raw.alt ?? [],
  description: raw.description ?? null,
  category: raw.category,
  candidate_count: raw.candidate_count,
}));

const escoByLabel = new Map(mockEscoSkills.map((s) => [s.preferred_label.toLowerCase(), s]));

export function findMockEscoByLabel(label: string): EscoSkill | undefined {
  return escoByLabel.get(label.toLowerCase());
}

// ─── Trending skills (10) ────────────────────────────────────────────────────

function buildSeries(base: number, growth: number): TrendingSkillPoint[] {
  const out: TrendingSkillPoint[] = [];
  const now = new Date();
  // 8 weeks back
  for (let w = 7; w >= 0; w -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - w * 7);
    const factor = 1 + (growth / 100) * ((7 - w) / 7);
    out.push({
      week_start: d.toISOString().slice(0, 10),
      demand: Math.max(0, Math.round(base * factor + (Math.random() - 0.5) * 4)),
      supply: Math.max(
        0,
        Math.round(base * 0.8 + (Math.random() - 0.5) * 3)
      ),
    });
  }
  return out;
}

export const mockTrendingSkills: TrendingSkill[] = [
  { label: "TypeScript", category: "technical", growth: 38, base: 14 },
  { label: "Kubernetes", category: "tool", growth: 52, base: 9 },
  { label: "Machine Learning", category: "technical", growth: 41, base: 8 },
  { label: "Next.js", category: "technical", growth: 33, base: 7 },
  { label: "AWS", category: "tool", growth: 22, base: 12 },
  { label: "Product Management", category: "domain", growth: 18, base: 8 },
  { label: "Data Analyse", category: "domain", growth: 27, base: 10 },
  { label: "GraphQL", category: "technical", growth: 15, base: 6 },
  { label: "Agile", category: "soft", growth: 9, base: 16 },
  { label: "Python", category: "technical", growth: 12, base: 18 },
].map(({ label, category, growth, base }, i) => {
  const esco = findMockEscoByLabel(label);
  const series = buildSeries(base, growth);
  const last = series[series.length - 1];
  return {
    esco_id: esco?.id ?? `esco-trend-${i}`,
    preferred_label: label,
    category: category as EscoCategory,
    growth_pct: growth,
    current_demand: last.demand,
    current_supply: last.supply,
    series,
  };
});

// ─── Demand vs supply per category ───────────────────────────────────────────

export const mockDemandSupply: DemandSupplyResponse = {
  per_category: [
    { category: "technical", demand: 86, supply: 64, gap: 22 },
    { category: "soft", demand: 42, supply: 51, gap: -9 },
    { category: "tool", demand: 48, supply: 39, gap: 9 },
    { category: "language", demand: 70, supply: 78, gap: -8 },
    { category: "certification", demand: 12, supply: 6, gap: 6 },
    { category: "domain", demand: 30, supply: 22, gap: 8 },
  ],
  computed_at: new Date().toISOString(),
};

// ─── Candidate / job skill profiles ──────────────────────────────────────────

function profileFromLabels(
  labels: { label: string; proficiency: number; confidence?: number }[]
) {
  return labels.map((l, i) => {
    const esco = findMockEscoByLabel(l.label);
    return {
      id: `ps-${l.label.toLowerCase().replace(/\s/g, "-")}-${i}`,
      esco_id: esco?.id ?? null,
      esco_uri: esco?.esco_uri ?? null,
      preferred_label: esco?.preferred_label ?? l.label,
      category: (esco?.category ?? "technical") as EscoCategory,
      proficiency: l.proficiency,
      source: (esco ? "esco_match" : "manual") as
        | "ai_extracted"
        | "manual"
        | "esco_match"
        | "embedding_match",
      confidence: l.confidence ?? (esco ? 0.95 : 0.6),
    };
  });
}

const candidateSkillProfilesData: Record<string, CandidateSkillProfile> = {
  "cand-1": {
    candidate_id: "cand-1",
    last_synced_at: "2026-04-28T10:00:00Z",
    skills: profileFromLabels([
      { label: "React", proficiency: 9 },
      { label: "TypeScript", proficiency: 9 },
      { label: "Node.js", proficiency: 7 },
      { label: "GraphQL", proficiency: 6 },
      { label: "Next.js", proficiency: 8 },
      { label: "Communicatie", proficiency: 8 },
    ]),
  },
  "cand-2": {
    candidate_id: "cand-2",
    last_synced_at: "2026-04-25T10:00:00Z",
    skills: profileFromLabels([
      { label: "Python", proficiency: 9 },
      { label: "Django", proficiency: 8 },
      { label: "PostgreSQL", proficiency: 8 },
      { label: "Docker", proficiency: 7 },
      { label: "AWS", proficiency: 7 },
      { label: "SQL", proficiency: 8 },
    ]),
  },
  "cand-3": {
    candidate_id: "cand-3",
    last_synced_at: "2026-04-20T10:00:00Z",
    skills: profileFromLabels([
      { label: "Product Management", proficiency: 9 },
      { label: "Agile", proficiency: 9 },
      { label: "Stakeholder Management", proficiency: 9 },
      { label: "SQL", proficiency: 6 },
      { label: "Communicatie", proficiency: 9 },
    ]),
  },
  "cand-5": {
    candidate_id: "cand-5",
    last_synced_at: "2026-04-15T10:00:00Z",
    skills: profileFromLabels([
      { label: "Figma", proficiency: 9 },
      { label: "User Research", proficiency: 8 },
      { label: "Communicatie", proficiency: 8 },
    ]),
  },
};

export function getMockCandidateSkillProfile(
  candidateId: string
): CandidateSkillProfile {
  return (
    candidateSkillProfilesData[candidateId] ?? {
      candidate_id: candidateId,
      last_synced_at: null,
      skills: [],
    }
  );
}

export function setMockCandidateSkillProfile(
  candidateId: string,
  profile: CandidateSkillProfile
) {
  candidateSkillProfilesData[candidateId] = profile;
}

const jobSkillProfilesData: Record<string, JobSkillProfile> = {
  "job-1": {
    job_id: "job-1",
    last_synced_at: "2026-04-30T10:00:00Z",
    skills: [
      ...profileFromLabels([
        { label: "React", proficiency: 8 },
        { label: "TypeScript", proficiency: 8 },
        { label: "Next.js", proficiency: 7 },
      ]).map((s) => ({ ...s, requirement: "required" as const, min_proficiency: 7 })),
      ...profileFromLabels([
        { label: "GraphQL", proficiency: 6 },
        { label: "Communicatie", proficiency: 7 },
      ]).map((s) => ({
        ...s,
        requirement: "nice_to_have" as const,
        min_proficiency: 5,
      })),
    ],
  },
  "job-2": {
    job_id: "job-2",
    last_synced_at: "2026-04-30T10:00:00Z",
    skills: [
      ...profileFromLabels([
        { label: "Python", proficiency: 8 },
        { label: "PostgreSQL", proficiency: 7 },
        { label: "Docker", proficiency: 6 },
      ]).map((s) => ({ ...s, requirement: "required" as const, min_proficiency: 7 })),
      ...profileFromLabels([
        { label: "AWS", proficiency: 6 },
        { label: "Machine Learning", proficiency: 5 },
      ]).map((s) => ({
        ...s,
        requirement: "nice_to_have" as const,
        min_proficiency: 5,
      })),
    ],
  },
};

export function getMockJobSkillProfile(jobId: string): JobSkillProfile {
  return (
    jobSkillProfilesData[jobId] ?? {
      job_id: jobId,
      last_synced_at: null,
      skills: [],
    }
  );
}

export function setMockJobSkillProfile(jobId: string, profile: JobSkillProfile) {
  jobSkillProfilesData[jobId] = profile;
}

// ─── Skills-gap analysis ─────────────────────────────────────────────────────

function pickRecommendation(pct: number): SkillsGapRecommendation {
  if (pct >= 85) return "strong_fit";
  if (pct >= 70) return "good_fit";
  if (pct >= 50) return "partial_fit";
  return "weak_fit";
}

export function buildMockSkillsGap(
  jobId: string,
  candidateId: string
): SkillsGapAnalysis {
  const job = getMockJobSkillProfile(jobId);
  const candidate = getMockCandidateSkillProfile(candidateId);
  const candidateById = new Map(
    candidate.skills.map((s) => [s.esco_id ?? s.preferred_label, s])
  );

  const required = job.skills
    .filter((s) => s.requirement === "required")
    .map((req) => {
      const cand =
        candidateById.get(req.esco_id ?? req.preferred_label) ?? null;
      return {
        esco_id: req.esco_id ?? req.preferred_label,
        preferred_label: req.preferred_label,
        category: req.category,
        required_proficiency: req.min_proficiency,
        candidate_proficiency: cand ? cand.proficiency : null,
        has_match: !!cand && cand.proficiency >= req.min_proficiency,
      };
    });

  const niceToHave = job.skills
    .filter((s) => s.requirement === "nice_to_have")
    .map((req) => {
      const cand =
        candidateById.get(req.esco_id ?? req.preferred_label) ?? null;
      return {
        esco_id: req.esco_id ?? req.preferred_label,
        preferred_label: req.preferred_label,
        category: req.category,
        required_proficiency: req.min_proficiency,
        candidate_proficiency: cand ? cand.proficiency : null,
        has_match: !!cand && cand.proficiency >= req.min_proficiency,
      };
    });

  const requiredKeys = new Set([
    ...job.skills.map((s) => s.esco_id ?? s.preferred_label),
  ]);
  const bonus = candidate.skills.filter(
    (s) => !requiredKeys.has(s.esco_id ?? s.preferred_label)
  );

  const requiredScore = required.length === 0
    ? 100
    : (required.filter((r) => r.has_match).length / required.length) * 80;
  const niceScore = niceToHave.length === 0
    ? 20
    : (niceToHave.filter((r) => r.has_match).length / niceToHave.length) * 20;
  const matchPct = Math.round(requiredScore + niceScore);

  return {
    job_id: jobId,
    candidate_id: candidateId,
    match_percentage: matchPct,
    recommendation: pickRecommendation(matchPct),
    required,
    nice_to_have: niceToHave,
    bonus_skills: bonus,
    computed_at: new Date().toISOString(),
  };
}

// ─── Pay settings ────────────────────────────────────────────────────────────

let mockPaySettingsStore: TenantPaySettings = {
  tenant_id: "tenant-1",
  pay_transparency_enforced: true,
  prohibit_current_salary_questions: true,
  reporting_threshold: 100,
  default_currency: "EUR",
  default_salary_frequency: "monthly",
  benchmark_data_consent: false,
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
};

export function getMockPaySettings(): TenantPaySettings {
  return { ...mockPaySettingsStore };
}

export function setMockPaySettings(
  patch: Partial<TenantPaySettings>
): TenantPaySettings {
  mockPaySettingsStore = {
    ...mockPaySettingsStore,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  return { ...mockPaySettingsStore };
}

// ─── Pay equity ──────────────────────────────────────────────────────────────

export function buildMockPayEquityReport(
  from: string,
  to: string,
  jobCategory?: string | null
): PayEquityReport {
  return {
    tenant_id: "tenant-1",
    from,
    to,
    job_category: jobCategory ?? null,
    total_records: 142,
    pay_gap_pct: 11.4,
    adjusted_pay_gap_pct: 6.2,
    by_gender: [
      { group_label: "Man", count: 88, median_salary: 64000, suppressed: false },
      { group_label: "Vrouw", count: 51, median_salary: 56700, suppressed: false },
      { group_label: "Non-binair", count: 3, median_salary: null, suppressed: true },
    ],
    by_age_bracket: [
      { group_label: "<25", count: 7, median_salary: 38000, suppressed: false },
      { group_label: "25-34", count: 58, median_salary: 54000, suppressed: false },
      { group_label: "35-44", count: 49, median_salary: 68000, suppressed: false },
      { group_label: "45-54", count: 22, median_salary: 76500, suppressed: false },
      { group_label: "55+", count: 6, median_salary: 81000, suppressed: false },
    ],
    by_nationality: [
      { group_label: "NL", count: 102, median_salary: 62000, suppressed: false },
      { group_label: "EU", count: 28, median_salary: 60500, suppressed: false },
      { group_label: "Overig", count: 12, median_salary: 58000, suppressed: false },
    ],
    k_anonymity_threshold: 5,
    computed_at: new Date().toISOString(),
  };
}

const mockPayEquitySnapshotsStore: PayEquitySnapshot[] = [
  {
    id: "pay-snap-1",
    from: "2026-01-01",
    to: "2026-03-31",
    pay_gap_pct: 11.4,
    computed_at: "2026-04-05T10:00:00Z",
  },
  {
    id: "pay-snap-2",
    from: "2025-10-01",
    to: "2025-12-31",
    pay_gap_pct: 12.7,
    computed_at: "2026-01-08T10:00:00Z",
  },
];

export function getMockPayEquitySnapshots(): PayEquitySnapshot[] {
  return [...mockPayEquitySnapshotsStore];
}

// ─── DEI funnel ──────────────────────────────────────────────────────────────

function biasLevel(score: number): DeiBiasLevel {
  if (score >= 25) return "high";
  if (score >= 10) return "medium";
  return "low";
}

export function buildMockDEIFunnelReport(from: string, to: string): DEIFunnelReport {
  const stagesRaw: Array<{
    stage_id: string;
    stage_name: string;
    total: number;
    bias: number;
    breakdown: {
      male: number;
      female: number;
      nonbin: number;
      ages: [number, number, number, number];
      nat: [number, number, number];
    };
  }> = [
    {
      stage_id: "stage-applied",
      stage_name: "Sollicitaties",
      total: 248,
      bias: 4,
      breakdown: { male: 152, female: 92, nonbin: 4, ages: [40, 110, 70, 28], nat: [180, 50, 18] },
    },
    {
      stage_id: "stage-screen",
      stage_name: "CV-screening",
      total: 132,
      bias: 8,
      breakdown: { male: 88, female: 42, nonbin: 2, ages: [16, 64, 36, 16], nat: [102, 22, 8] },
    },
    {
      stage_id: "stage-test",
      stage_name: "Technische test",
      total: 64,
      bias: 32,
      breakdown: { male: 50, female: 13, nonbin: 1, ages: [4, 32, 22, 6], nat: [54, 8, 2] },
    },
    {
      stage_id: "stage-interview",
      stage_name: "Eindgesprek",
      total: 28,
      bias: 14,
      breakdown: { male: 21, female: 7, nonbin: 0, ages: [1, 12, 12, 3], nat: [24, 3, 1] },
    },
    {
      stage_id: "stage-offer",
      stage_name: "Aanbod",
      total: 11,
      bias: 6,
      breakdown: { male: 8, female: 3, nonbin: 0, ages: [0, 5, 5, 1], nat: [10, 1, 0] },
    },
  ];

  const stages = stagesRaw.map((s, i) => {
    const total = s.total;
    const prev = i === 0 ? null : stagesRaw[i - 1].total;
    const conv =
      prev === null ? null : Math.round((total / prev) * 100 * 10) / 10;
    const pct = (n: number) =>
      total === 0 ? 0 : Math.round((n / total) * 1000) / 10;
    const supp = (n: number) => n > 0 && n < 5;
    return {
      stage_id: s.stage_id,
      stage_name: s.stage_name,
      total,
      conversion_pct: conv,
      bias_score: s.bias,
      bias_level: biasLevel(s.bias),
      breakdown: {
        gender: [
          { label: "Man", count: s.breakdown.male, pct: pct(s.breakdown.male), suppressed: supp(s.breakdown.male) },
          { label: "Vrouw", count: s.breakdown.female, pct: pct(s.breakdown.female), suppressed: supp(s.breakdown.female) },
          { label: "Non-binair", count: s.breakdown.nonbin, pct: pct(s.breakdown.nonbin), suppressed: supp(s.breakdown.nonbin) },
        ],
        age_bracket: [
          { label: "<25", count: s.breakdown.ages[0], pct: pct(s.breakdown.ages[0]), suppressed: supp(s.breakdown.ages[0]) },
          { label: "25-34", count: s.breakdown.ages[1], pct: pct(s.breakdown.ages[1]), suppressed: supp(s.breakdown.ages[1]) },
          { label: "35-44", count: s.breakdown.ages[2], pct: pct(s.breakdown.ages[2]), suppressed: supp(s.breakdown.ages[2]) },
          { label: "45+", count: s.breakdown.ages[3], pct: pct(s.breakdown.ages[3]), suppressed: supp(s.breakdown.ages[3]) },
        ],
        nationality: [
          { label: "NL", count: s.breakdown.nat[0], pct: pct(s.breakdown.nat[0]), suppressed: supp(s.breakdown.nat[0]) },
          { label: "EU", count: s.breakdown.nat[1], pct: pct(s.breakdown.nat[1]), suppressed: supp(s.breakdown.nat[1]) },
          { label: "Overig", count: s.breakdown.nat[2], pct: pct(s.breakdown.nat[2]), suppressed: supp(s.breakdown.nat[2]) },
        ],
      },
    };
  });

  return {
    tenant_id: "tenant-1",
    from,
    to,
    stages,
    alerts: [
      {
        stage_id: "stage-test",
        stage_name: "Technische test",
        message:
          "Vrouwen droppen 35% in deze stage tegenover 22% bij mannen — onderzoek mogelijke bias in beoordelingscriteria.",
        severity: "critical",
      },
      {
        stage_id: "stage-interview",
        stage_name: "Eindgesprek",
        message:
          "Sollicitanten van 45+ converteren onder benchmark — controleer interviewer-pool op leeftijdsdiversiteit.",
        severity: "warning",
      },
    ],
    k_anonymity_threshold: 5,
    computed_at: new Date().toISOString(),
  };
}

const mockDEIFunnelSnapshotsStore: DEIFunnelSnapshot[] = [
  {
    id: "dei-snap-1",
    from: "2026-01-01",
    to: "2026-03-31",
    total_alerts: 2,
    computed_at: "2026-04-05T10:00:00Z",
  },
];

export function getMockDEIFunnelSnapshots(): DEIFunnelSnapshot[] {
  return [...mockDEIFunnelSnapshotsStore];
}
