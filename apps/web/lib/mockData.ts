import type {
  Candidate,
  CandidateResume,
  CandidateSkill,
  EmailTemplate,
  PipelineTemplate,
} from "@talentflow/shared";
import type {
  CandidateMatch,
  JobMatch,
  MatchExplanationResponse,
  SimilarHireDetail,
  TalentFitModelInfo,
  TalentFitPrediction,
} from "@/lib/types/matching";
import type {
  BiasCheckResult,
  ComparableJob,
  JobAttachment,
  JobFunnelResponse,
  JobHealthBreakdown,
  JobNote,
  JobSourcingItem,
  JobTeamMember,
} from "@/lib/types/jobDetail";
import type {
  CustomFieldDefinition,
  DedupeMatch,
  ImportStatusResponse,
  JobTemplate,
  SavedSearch,
  Scorecard,
  ScorecardTemplate,
} from "@/lib/types/atsExtensions";
import type {
  JdDraft,
  JdGeneratorInput,
  JdVariant,
} from "@/lib/types/jdGenerator";
import type {
  ReactivationStats,
  TalentReactivationAlert,
} from "@/lib/types/reactivation";

export type CandidateStatus = "active" | "inactive" | "hired" | "rejected";
export type ApplicationStatus = "active" | "rejected" | "hired";

/**
 * Re-export the shared `Candidate` type so existing imports
 * (`import type { Candidate } from "@/lib/mockData"`) keep working.
 */
export type { Candidate, CandidateSkill, CandidateResume, PipelineTemplate };

// Sub-fase 2C: Job-types komen niet meer uit dit bestand. Importeer
// rechtstreeks uit `@talentflow/contracts`:
//
//   import type { JobListItem, JobDetail, JobStatus } from "@talentflow/contracts";
//
// Mockdata onder `mockJobs` is alleen seed-data voor dev-scripts en tests;
// niet de bron-van-waarheid voor de Job-shape.

export interface PipelineStage {
  id: string;
  job_id: string;
  name: string;
  color: string;
  /** Backend field name is `position` (not `order`). */
  position: number;
  application_count?: number;
}

export interface Application {
  id: string;
  candidate_id: string;
  job_id: string;
  stage_id: string;
  /** Embedded candidate object — present in mock data and pipeline response. */
  candidate?: Candidate;
  /** Flat fields as returned by /pipeline/jobs/:id/applications */
  candidate_name?: string;
  candidate_email?: string;
  candidate_phone?: string | null;
  candidate_skills?: string[];
  ai_score?: number | null;
  resume_url?: string | null;
  source?: string;
  applied_at: string;
  notes?: string | null;
  status: ApplicationStatus;
}

export interface DashboardStats {
  open_jobs: number;
  open_jobs_trend: number;
  candidates_this_month: number;
  applications_this_week: number;
  avg_time_to_hire: number;
}

export interface ActivityItem {
  id: string;
  type: "application" | "stage_change" | "hire" | "job_posted";
  message: string;
  timestamp: string;
  candidate_name?: string;
  job_title?: string;
}

// ─── Helper: build a fully-shaped Candidate with sensible defaults ──────────

interface CandidateSeed {
  id: string;
  name: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  candidate_reference?: string | null;
  skills?: string[] | null;
  tags?: string[] | null;
  source?: string | null;
  ai_score?: number | null;
  resume_url?: string | null;
  notes?: string | null;
  description?: string | null;
  languages?: string[] | null;
  nationalities?: string[] | null;
  current_salary?: number | null;
  current_salary_currency?: string | null;
  expected_salary?: number | null;
  expected_salary_currency?: string | null;
  years_of_experience?: number | null;
  notice_period?: string | null;
  industry?: string | null;
  current_department?: string | null;
  current_position?: string | null;
  current_company?: string | null;
  diploma?: string | null;
  university?: string | null;
  graduation_date?: string | null;
  address_city?: string | null;
  address_country?: string | null;
  gdpr_consent?: boolean;
  gdpr_consent_at?: string | null;
  email_consent?: boolean;
  email_consent_at?: string | null;
  created_at: string;
  updated_at: string;
}

function seedCandidate(seed: CandidateSeed): Candidate {
  return {
    id: seed.id,
    tenant_id: "tenant-1",
    candidate_reference: seed.candidate_reference ?? null,
    created_at: seed.created_at,
    updated_at: seed.updated_at,
    deleted_at: null,

    name: seed.name,
    first_name: seed.first_name ?? null,
    last_name: seed.last_name ?? null,
    email: seed.email ?? null,
    phone: seed.phone ?? null,

    gender: null,
    birthdate: null,
    nationalities: seed.nationalities ?? null,
    languages: seed.languages ?? null,

    notice_period: seed.notice_period ?? null,
    current_salary: seed.current_salary ?? null,
    current_salary_currency: seed.current_salary_currency ?? null,
    expected_salary: seed.expected_salary ?? null,
    expected_salary_currency: seed.expected_salary_currency ?? null,
    current_benefits: null,
    expected_benefits: null,
    years_of_experience: seed.years_of_experience ?? null,
    graduation_date: seed.graduation_date ?? null,
    current_department: seed.current_department ?? null,
    current_position: seed.current_position ?? null,
    current_company: seed.current_company ?? null,
    industry: seed.industry ?? null,

    diploma: seed.diploma ?? null,
    university: seed.university ?? null,

    address_line1: null,
    address_line2: null,
    address_city: seed.address_city ?? null,
    address_country: seed.address_country ?? null,
    address_postal_code: null,

    skype: null,
    other_contact: null,

    description: seed.description ?? null,
    source: seed.source ?? null,

    gdpr_consent: seed.gdpr_consent ?? false,
    gdpr_consent_at: seed.gdpr_consent_at ?? null,
    email_consent: seed.email_consent ?? false,
    email_consent_at: seed.email_consent_at ?? null,

    resume_url: seed.resume_url ?? null,
    skills: seed.skills ?? null,
    ai_score: seed.ai_score ?? null,
    tags: seed.tags ?? null,
    notes: seed.notes ?? null,
  };
}

// ─── Candidates ────────────────────────────────────────────────────────────

export const mockCandidates: Candidate[] = [
  seedCandidate({
    id: "cand-1",
    candidate_reference: "CAND-0001",
    name: "Sophie van den Berg",
    first_name: "Sophie",
    last_name: "van den Berg",
    email: "sophie.vdberg@gmail.com",
    phone: "+31 6 12345678",
    skills: ["React", "TypeScript", "Node.js", "GraphQL"],
    tags: ["senior", "remote-ok", "beschikbaar"],
    source: "linkedin",
    ai_score: 92,
    resume_url: "/resumes/sophie-vdberg.pdf",
    notes:
      "Sterke kandidaat, 6 jaar ervaring bij grote techbedrijven. Beschikbaar vanaf volgende maand.",
    description: "Senior frontend engineer met focus op React en design systems.",
    languages: ["Dutch", "English"],
    nationalities: ["Dutch"],
    current_salary: 82000,
    current_salary_currency: "EUR",
    expected_salary: 95000,
    expected_salary_currency: "EUR",
    years_of_experience: 6,
    notice_period: "1 maand",
    industry: "SaaS",
    current_department: "Engineering",
    diploma: "MSc Computer Science",
    university: "TU Delft",
    graduation_date: "2018-06-30",
    address_city: "Amsterdam",
    address_country: "Netherlands",
    gdpr_consent: true,
    gdpr_consent_at: "2024-01-15T10:00:00Z",
    email_consent: true,
    email_consent_at: "2024-01-15T10:00:00Z",
    created_at: "2024-01-15T10:00:00Z",
    updated_at: "2024-01-20T14:30:00Z",
  }),
  seedCandidate({
    id: "cand-2",
    candidate_reference: "CAND-0002",
    name: "Thomas Janssen",
    first_name: "Thomas",
    last_name: "Janssen",
    email: "t.janssen@hotmail.com",
    phone: "+31 6 98765432",
    skills: ["Python", "Django", "PostgreSQL", "Docker", "AWS"],
    tags: ["medior", "backend"],
    source: "overig",
    ai_score: 74,
    resume_url: "/resumes/thomas-janssen.pdf",
    notes: "Goede achtergrond in data engineering. Heeft vragen over remote beleid.",
    description: "Data engineer met sterke focus op Python en cloud-infrastructuur.",
    languages: ["Dutch", "English"],
    nationalities: ["Dutch"],
    current_salary: 68000,
    current_salary_currency: "EUR",
    expected_salary: 78000,
    expected_salary_currency: "EUR",
    years_of_experience: 4,
    notice_period: "2 maanden",
    industry: "Fintech",
    current_department: "Platform",
    diploma: "BSc Software Engineering",
    university: "Hogeschool Utrecht",
    graduation_date: "2020-07-15",
    address_city: "Utrecht",
    address_country: "Netherlands",
    gdpr_consent: true,
    gdpr_consent_at: "2024-01-18T09:00:00Z",
    email_consent: true,
    email_consent_at: "2024-01-18T09:00:00Z",
    created_at: "2024-01-18T09:00:00Z",
    updated_at: "2024-01-19T11:00:00Z",
  }),
  seedCandidate({
    id: "cand-3",
    candidate_reference: "CAND-0003",
    name: "Aisha El Hamdouchi",
    first_name: "Aisha",
    last_name: "El Hamdouchi",
    email: "aisha.elhamdouchi@outlook.com",
    phone: "+31 6 55544433",
    skills: ["Product Management", "Agile", "Figma", "SQL", "Stakeholder Management"],
    tags: ["senior", "pm", "beschikbaar"],
    source: "referral",
    ai_score: 88,
    resume_url: "/resumes/aisha-elhamdouchi.pdf",
    notes: "Aangedragen door huidige PM. Excellent track record bij scale-ups.",
    description: "Senior product manager met B2B SaaS achtergrond.",
    languages: ["Dutch", "English", "Arabic", "French"],
    nationalities: ["Dutch", "Moroccan"],
    current_salary: 90000,
    current_salary_currency: "EUR",
    expected_salary: 105000,
    expected_salary_currency: "EUR",
    years_of_experience: 8,
    notice_period: "Direct beschikbaar",
    industry: "SaaS",
    current_department: "Product",
    diploma: "MSc Industrial Engineering",
    university: "TU Eindhoven",
    graduation_date: "2016-09-01",
    address_city: "Rotterdam",
    address_country: "Netherlands",
    gdpr_consent: true,
    gdpr_consent_at: "2024-01-22T08:30:00Z",
    email_consent: true,
    email_consent_at: "2024-01-22T08:30:00Z",
    created_at: "2024-01-22T08:30:00Z",
    updated_at: "2024-01-22T08:30:00Z",
  }),
  seedCandidate({
    id: "cand-4",
    candidate_reference: "CAND-0004",
    name: "Lars Visser",
    first_name: "Lars",
    last_name: "Visser",
    email: "lars.visser@gmail.com",
    phone: null,
    skills: ["Java", "Spring Boot", "Microservices", "Kubernetes"],
    tags: ["junior", "stagaire"],
    source: "career_page",
    ai_score: 61,
    resume_url: null,
    notes: null,
    description: "Recent afgestudeerd, op zoek naar eerste fulltime rol.",
    languages: ["Dutch", "English"],
    nationalities: ["Dutch"],
    current_salary: null,
    expected_salary: 45000,
    expected_salary_currency: "EUR",
    years_of_experience: 1,
    notice_period: "Direct beschikbaar",
    industry: "Banking",
    diploma: "BSc Computer Science",
    university: "Hogeschool Rotterdam",
    graduation_date: "2023-08-31",
    address_city: "Den Haag",
    address_country: "Netherlands",
    gdpr_consent: true,
    gdpr_consent_at: "2024-01-10T14:00:00Z",
    email_consent: false,
    created_at: "2024-01-10T14:00:00Z",
    updated_at: "2024-01-10T14:00:00Z",
  }),
  seedCandidate({
    id: "cand-5",
    candidate_reference: "CAND-0005",
    name: "Maya Okonkwo",
    first_name: "Maya",
    last_name: "Okonkwo",
    email: "maya.okonkwo@gmail.com",
    phone: "+31 6 77788899",
    skills: ["UX Design", "Figma", "User Research", "Prototyping", "CSS"],
    tags: ["medior", "designer", "remote-ok"],
    source: "manual_import",
    ai_score: 85,
    resume_url: "/resumes/maya-okonkwo.pdf",
    notes: "Portfolio is indrukwekkend. Gecombineerde UX/UI achtergrond.",
    description: "UX/UI designer met focus op B2B product design.",
    languages: ["Dutch", "English"],
    nationalities: ["Dutch", "Nigerian"],
    current_salary: 60000,
    current_salary_currency: "EUR",
    expected_salary: 72000,
    expected_salary_currency: "EUR",
    years_of_experience: 4,
    notice_period: "1 maand",
    industry: "Design Agency",
    current_department: "Design",
    diploma: "BA Graphic Design",
    university: "Willem de Kooning Academy",
    graduation_date: "2020-06-30",
    address_city: "Amsterdam",
    address_country: "Netherlands",
    gdpr_consent: true,
    gdpr_consent_at: "2024-01-25T11:00:00Z",
    email_consent: true,
    email_consent_at: "2024-01-25T11:00:00Z",
    created_at: "2024-01-25T11:00:00Z",
    updated_at: "2024-01-25T11:00:00Z",
  }),
];

// ─── Candidate skills (sub-resource for /candidates/:id/skills) ─────────────

export const mockCandidateSkills: CandidateSkill[] = [
  // Sophie — frontend powerhouse
  { id: "skill-s1", candidate_id: "cand-1", skill: "React", score: 10, source: "ai_extracted", created_at: "2024-01-15T10:05:00Z" },
  { id: "skill-s2", candidate_id: "cand-1", skill: "TypeScript", score: 9, source: "ai_extracted", created_at: "2024-01-15T10:05:00Z" },
  { id: "skill-s3", candidate_id: "cand-1", skill: "Node.js", score: 8, source: "manual", created_at: "2024-01-15T10:05:00Z" },
  { id: "skill-s4", candidate_id: "cand-1", skill: "GraphQL", score: 7, source: "ai_extracted", created_at: "2024-01-15T10:05:00Z" },
  { id: "skill-s5", candidate_id: "cand-1", skill: "Next.js", score: 9, source: "manual", created_at: "2024-01-15T10:05:00Z" },

  // Thomas — backend / data
  { id: "skill-t1", candidate_id: "cand-2", skill: "Python", score: 9, source: "ai_extracted", created_at: "2024-01-18T09:05:00Z" },
  { id: "skill-t2", candidate_id: "cand-2", skill: "Django", score: 8, source: "ai_extracted", created_at: "2024-01-18T09:05:00Z" },
  { id: "skill-t3", candidate_id: "cand-2", skill: "PostgreSQL", score: 8, source: "ai_extracted", created_at: "2024-01-18T09:05:00Z" },
  { id: "skill-t4", candidate_id: "cand-2", skill: "Docker", score: 7, source: "manual", created_at: "2024-01-18T09:05:00Z" },
  { id: "skill-t5", candidate_id: "cand-2", skill: "AWS", score: 7, source: "ai_extracted", created_at: "2024-01-18T09:05:00Z" },

  // Aisha — PM
  { id: "skill-a1", candidate_id: "cand-3", skill: "Product Management", score: 10, source: "manual", created_at: "2024-01-22T08:35:00Z" },
  { id: "skill-a2", candidate_id: "cand-3", skill: "Agile", score: 9, source: "ai_extracted", created_at: "2024-01-22T08:35:00Z" },
  { id: "skill-a3", candidate_id: "cand-3", skill: "Stakeholder Management", score: 9, source: "manual", created_at: "2024-01-22T08:35:00Z" },
  { id: "skill-a4", candidate_id: "cand-3", skill: "SQL", score: 7, source: "ai_extracted", created_at: "2024-01-22T08:35:00Z" },

  // Maya — designer
  { id: "skill-m1", candidate_id: "cand-5", skill: "Figma", score: 10, source: "ai_extracted", created_at: "2024-01-25T11:05:00Z" },
  { id: "skill-m2", candidate_id: "cand-5", skill: "User Research", score: 8, source: "manual", created_at: "2024-01-25T11:05:00Z" },
  { id: "skill-m3", candidate_id: "cand-5", skill: "Prototyping", score: 9, source: "ai_extracted", created_at: "2024-01-25T11:05:00Z" },
];

// ─── Candidate resumes (sub-resource for /candidates/:id/resumes) ───────────

export const mockCandidateResumes: CandidateResume[] = [
  {
    id: "resume-1",
    candidate_id: "cand-1",
    filename: "sophie-vdberg-cv.pdf",
    storage_url: "/resumes/sophie-vdberg.pdf",
    storage_key: "tenant-1/cand-1/sophie-vdberg-cv.pdf",
    mime_type: "application/pdf",
    size_bytes: 248_512,
    is_primary: true,
    parsed_at: "2024-01-15T10:02:00Z",
    created_at: "2024-01-15T10:00:00Z",
    parse_status: "done",
    parse_error: null,
    ai_summary:
      "Senior frontend engineer met 6 jaar ervaring, gespecialiseerd in React, TypeScript en design systems. Sterke achtergrond bij scale-up SaaS-bedrijven en bekend met GraphQL en Next.js. Beschikbaar op korte termijn en open voor remote-rollen.",
  },
  {
    id: "resume-2",
    candidate_id: "cand-2",
    filename: "thomas-janssen-cv.pdf",
    storage_url: "/resumes/thomas-janssen.pdf",
    storage_key: "tenant-1/cand-2/thomas-janssen-cv.pdf",
    mime_type: "application/pdf",
    size_bytes: 187_392,
    is_primary: true,
    parsed_at: "2024-01-18T09:02:00Z",
    created_at: "2024-01-18T09:00:00Z",
    parse_status: "done",
    parse_error: null,
    ai_summary:
      "Backend/data engineer met 4 jaar ervaring in Python, Django en PostgreSQL bij fintech-omgevingen. Comfortabel met Docker en AWS-deployments. Heeft voorkeur voor remote werk en is 2 maanden opzegtermijn gebonden.",
  },
  {
    id: "resume-3",
    candidate_id: "cand-3",
    filename: "aisha-elhamdouchi-cv.pdf",
    storage_url: "/resumes/aisha-elhamdouchi.pdf",
    storage_key: "tenant-1/cand-3/aisha-elhamdouchi-cv.pdf",
    mime_type: "application/pdf",
    size_bytes: 312_640,
    is_primary: true,
    parsed_at: "2024-01-22T08:32:00Z",
    created_at: "2024-01-22T08:30:00Z",
    parse_status: "done",
    parse_error: null,
    ai_summary:
      "Senior product manager met 8 jaar ervaring binnen B2B SaaS scale-ups. Sterk in stakeholder management, agile delivery en data-driven prioritering. Meertalig (NL/EN/AR/FR) en direct beschikbaar voor een nieuwe rol.",
  },
  {
    id: "resume-4",
    candidate_id: "cand-5",
    filename: "maya-okonkwo-portfolio.pdf",
    storage_url: "/resumes/maya-okonkwo.pdf",
    storage_key: "tenant-1/cand-5/maya-okonkwo-portfolio.pdf",
    mime_type: "application/pdf",
    size_bytes: 5_242_880,
    is_primary: true,
    parsed_at: "2024-01-25T11:02:00Z",
    created_at: "2024-01-25T11:00:00Z",
    parse_status: "done",
    parse_error: null,
    ai_summary:
      "UX/UI designer met 4 jaar ervaring in B2B product design. Indrukwekkend portfolio met focus op Figma, prototyping en user research. Combineert visuele kwaliteit met sterk gebruikersonderzoek; remote-bereid en 1 maand opzegtermijn.",
  },
];

// ─── Pipeline templates ─────────────────────────────────────────────────────

export const mockPipelineTemplates: PipelineTemplate[] = [
  {
    id: "tmpl-1",
    tenant_id: null,
    name: "Standaard sollicitatieflow",
    description: "Klassieke 5-staps pipeline geschikt voor de meeste vacatures.",
    is_default: true,
    is_system: true,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    stages: [
      { id: "tmpl-1-s1", template_id: "tmpl-1", name: "Nieuwe sollicitaties", position: 1, color: "#6366f1", created_at: "2024-01-01T00:00:00Z" },
      { id: "tmpl-1-s2", template_id: "tmpl-1", name: "Screening", position: 2, color: "#f59e0b", created_at: "2024-01-01T00:00:00Z" },
      { id: "tmpl-1-s3", template_id: "tmpl-1", name: "Interview", position: 3, color: "#3b82f6", created_at: "2024-01-01T00:00:00Z" },
      { id: "tmpl-1-s4", template_id: "tmpl-1", name: "Aanbieding", position: 4, color: "#10b981", created_at: "2024-01-01T00:00:00Z" },
      { id: "tmpl-1-s5", template_id: "tmpl-1", name: "Aangenomen", position: 5, color: "#22c55e", created_at: "2024-01-01T00:00:00Z" },
    ],
  },
  {
    id: "tmpl-2",
    tenant_id: null,
    name: "Tech-rol met assessment",
    description: "Pipeline voor technische rollen, inclusief technische test.",
    is_default: false,
    is_system: true,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    stages: [
      { id: "tmpl-2-s1", template_id: "tmpl-2", name: "Nieuwe sollicitaties", position: 1, color: "#6366f1", created_at: "2024-01-01T00:00:00Z" },
      { id: "tmpl-2-s2", template_id: "tmpl-2", name: "Recruiter screening", position: 2, color: "#f59e0b", created_at: "2024-01-01T00:00:00Z" },
      { id: "tmpl-2-s3", template_id: "tmpl-2", name: "Technische test", position: 3, color: "#8b5cf6", created_at: "2024-01-01T00:00:00Z" },
      { id: "tmpl-2-s4", template_id: "tmpl-2", name: "Tech interview", position: 4, color: "#3b82f6", created_at: "2024-01-01T00:00:00Z" },
      { id: "tmpl-2-s5", template_id: "tmpl-2", name: "Cultuur interview", position: 5, color: "#06b6d4", created_at: "2024-01-01T00:00:00Z" },
      { id: "tmpl-2-s6", template_id: "tmpl-2", name: "Aanbieding", position: 6, color: "#10b981", created_at: "2024-01-01T00:00:00Z" },
    ],
  },
];


// ─── Pipeline stages ─────────────────────────────────────────────────────────

export const mockStages: PipelineStage[] = [
  { id: "stage-1", job_id: "job-1", name: "Nieuwe sollicitaties", color: "#6366f1", position: 1 },
  { id: "stage-2", job_id: "job-1", name: "Screening", color: "#f59e0b", position: 2 },
  { id: "stage-3", job_id: "job-1", name: "Interview", color: "#3b82f6", position: 3 },
  { id: "stage-4", job_id: "job-1", name: "Technische test", color: "#8b5cf6", position: 4 },
  { id: "stage-5", job_id: "job-1", name: "Aanbieding", color: "#10b981", position: 5 },
  // Job 2 stages
  { id: "stage-6", job_id: "job-2", name: "Nieuwe sollicitaties", color: "#6366f1", position: 1 },
  { id: "stage-7", job_id: "job-2", name: "Screening", color: "#f59e0b", position: 2 },
  { id: "stage-8", job_id: "job-2", name: "Interview", color: "#3b82f6", position: 3 },
  { id: "stage-9", job_id: "job-2", name: "Case Study", color: "#8b5cf6", position: 4 },
];

// ─── Applications ─────────────────────────────────────────────────────────────

export const mockApplications: Application[] = [
  // Job 1 applications
  {
    id: "app-1",
    candidate_id: "cand-1",
    job_id: "job-1",
    stage_id: "stage-3",
    candidate: mockCandidates[0],
    applied_at: "2024-01-16T09:00:00Z",
    notes: "Uitstekend eerste gesprek.",
    status: "active",
  },
  {
    id: "app-2",
    candidate_id: "cand-4",
    job_id: "job-1",
    stage_id: "stage-1",
    candidate: mockCandidates[3],
    applied_at: "2024-01-20T10:00:00Z",
    notes: null,
    status: "active",
  },
  {
    id: "app-3",
    candidate_id: "cand-5",
    job_id: "job-1",
    stage_id: "stage-2",
    candidate: mockCandidates[4],
    applied_at: "2024-01-21T11:00:00Z",
    notes: "Screening ingepland.",
    status: "active",
  },
  {
    id: "app-4",
    candidate_id: "cand-2",
    job_id: "job-1",
    stage_id: "stage-4",
    candidate: mockCandidates[1],
    applied_at: "2024-01-18T09:00:00Z",
    notes: "Technische test verstuurd.",
    status: "active",
  },
  // Job 2 applications
  {
    id: "app-5",
    candidate_id: "cand-3",
    job_id: "job-2",
    stage_id: "stage-7",
    candidate: mockCandidates[2],
    applied_at: "2024-01-23T08:00:00Z",
    notes: "Telefonische screening gedaan.",
    status: "active",
  },
  {
    id: "app-6",
    candidate_id: "cand-1",
    job_id: "job-2",
    stage_id: "stage-6",
    candidate: mockCandidates[0],
    applied_at: "2024-01-24T09:00:00Z",
    notes: null,
    status: "active",
  },
];

// ─── Dashboard ────────────────────────────────────────────────────────────────

export const mockDashboardStats: DashboardStats = {
  open_jobs: 2,
  open_jobs_trend: 1,
  candidates_this_month: 5,
  applications_this_week: 3,
  avg_time_to_hire: 18,
};

export const mockActivityFeed: ActivityItem[] = [
  {
    id: "act-1",
    type: "application",
    message: "Nieuwe sollicitatie ontvangen",
    candidate_name: "Maya Okonkwo",
    job_title: "Senior Frontend Developer",
    timestamp: "2024-01-25T11:00:00Z",
  },
  {
    id: "act-2",
    type: "stage_change",
    message: "Doorgeschoven naar Interview",
    candidate_name: "Sophie van den Berg",
    job_title: "Senior Frontend Developer",
    timestamp: "2024-01-24T15:30:00Z",
  },
  {
    id: "act-3",
    type: "application",
    message: "Nieuwe sollicitatie ontvangen",
    candidate_name: "Aisha El Hamdouchi",
    job_title: "Product Manager",
    timestamp: "2024-01-23T08:00:00Z",
  },
  {
    id: "act-4",
    type: "job_posted",
    message: "Vacature geplaatst",
    job_title: "Product Manager",
    timestamp: "2024-01-22T10:00:00Z",
  },
  {
    id: "act-5",
    type: "stage_change",
    message: "Doorgeschoven naar Technische test",
    candidate_name: "Thomas Janssen",
    job_title: "Senior Frontend Developer",
    timestamp: "2024-01-21T14:00:00Z",
  },
];

// ─── User ─────────────────────────────────────────────────────────────────────

export const mockUser = {
  id: "user-1",
  name: "Emma Bakker",
  email: "emma@talentflow.io",
  role: "admin" as const,
  tenant: {
    id: "tenant-1",
    name: "TechRecruit B.V.",
    plan: "Professional",
  },
};

export const mockTeamMembers = [
  { id: "user-1", name: "Emma Bakker", email: "emma@talentflow.io", role: "admin" },
  { id: "user-2", name: "Jan Peters", email: "jan@talentflow.io", role: "recruiter" },
  { id: "user-3", name: "Lisa Smits", email: "lisa@talentflow.io", role: "recruiter" },
];

// ─── Email templates ─────────────────────────────────────────────────────────

/**
 * Re-export the shared `EmailTemplate` type so frontend imports can stay
 * consistent (`import type { EmailTemplate } from "@/lib/mockData"`).
 */
export type { EmailTemplate };

/**
 * Mutable in-memory store backing the dev-mode mock fallback for
 * `useEmailTemplates`. Mirrors the shape returned by
 * `GET /api/email-templates`.
 */
export const mockEmailTemplates: EmailTemplate[] = [
  {
    id: "tmpl-1",
    tenant_id: "tenant-1",
    name: "Uitnodiging eerste interview",
    category: "invite",
    subject: "Uitnodiging gesprek - {{job.title}}",
    body_html:
      "<p>Beste {{candidate.first_name}},</p>" +
      "<p>Bedankt voor je sollicitatie op de positie van <strong>{{job.title}}</strong>. " +
      "We zijn enthousiast over je profiel en willen je graag uitnodigen voor een eerste " +
      "kennismakingsgesprek.</p>" +
      "<p>Kun je een aantal voorkeursmomenten doorgeven voor volgende week? Het gesprek " +
      "duurt ongeveer 45 minuten en vindt plaats via Google Meet.</p>" +
      "<p>Met vriendelijke groet,<br/>{{recruiter.name}}<br/>{{tenant.name}}</p>",
    body_text:
      "Beste {{candidate.first_name}},\n\nBedankt voor je sollicitatie op de positie " +
      "van {{job.title}}. We willen je graag uitnodigen voor een kennismakingsgesprek.\n\n" +
      "Met vriendelijke groet,\n{{recruiter.name}}",
    merge_variables: [
      "candidate.first_name",
      "job.title",
      "recruiter.name",
      "tenant.name",
    ],
    created_at: "2024-01-04T09:00:00Z",
    updated_at: "2024-01-12T14:30:00Z",
  },
  {
    id: "tmpl-2",
    tenant_id: "tenant-1",
    name: "Afwijzing na sollicitatie",
    category: "reject",
    subject: "Update over je sollicitatie bij {{tenant.name}}",
    body_html:
      "<p>Beste {{candidate.first_name}},</p>" +
      "<p>Bedankt voor je interesse in de functie van <strong>{{job.title}}</strong> " +
      "en de tijd die je hebt genomen om te solliciteren.</p>" +
      "<p>Na een zorgvuldige afweging hebben we besloten om met andere kandidaten " +
      "verder te gaan. We waarderen je inspanning en wensen je veel succes met de " +
      "volgende stap in je carrière.</p>" +
      "<p>Met vriendelijke groet,<br/>{{recruiter.name}}</p>",
    body_text: null,
    merge_variables: [
      "candidate.first_name",
      "job.title",
      "tenant.name",
      "recruiter.name",
    ],
    created_at: "2024-01-05T10:15:00Z",
    updated_at: "2024-01-05T10:15:00Z",
  },
  {
    id: "tmpl-3",
    tenant_id: "tenant-1",
    name: "Job offer - aanbiedingsbrief",
    category: "offer",
    subject: "Aanbod: {{job.title}} bij {{tenant.name}}",
    body_html:
      "<p>Beste {{candidate.first_name}},</p>" +
      "<p>We zijn verheugd je een aanbod te doen voor de positie van " +
      "<strong>{{job.title}}</strong> bij {{tenant.name}}.</p>" +
      "<p>In de bijlage vind je het officiële aanbod met alle details over " +
      "salaris, secundaire arbeidsvoorwaarden en startdatum. Neem gerust contact " +
      "op als je vragen hebt.</p>" +
      "<p>We kijken uit naar je reactie en hopen je binnenkort te verwelkomen " +
      "in het team.</p>" +
      "<p>Met vriendelijke groet,<br/>{{recruiter.name}}<br/>{{tenant.name}}</p>",
    body_text: null,
    merge_variables: [
      "candidate.first_name",
      "job.title",
      "tenant.name",
      "recruiter.name",
    ],
    created_at: "2024-01-08T11:00:00Z",
    updated_at: "2024-01-15T08:45:00Z",
  },
  {
    id: "tmpl-4",
    tenant_id: "tenant-1",
    name: "Stage 2 uitnodiging - technisch interview",
    category: "invite",
    subject: "Vervolggesprek {{job.title}} - technische ronde",
    body_html:
      "<p>Beste {{candidate.first_name}},</p>" +
      "<p>Goed nieuws: na het kennismakingsgesprek willen we graag door naar de " +
      "tweede ronde voor de positie van <strong>{{job.title}}</strong>.</p>" +
      "<p>De tweede ronde is een technisch interview van ongeveer 90 minuten met " +
      "twee teamleden. Tijdens dit gesprek bespreken we een aantal cases en is er " +
      "ruimte voor een korte coding-oefening.</p>" +
      "<p>Geef alsjeblieft drie voorkeursmomenten in de komende twee weken door, " +
      "dan plannen we het gesprek zo snel mogelijk in.</p>" +
      "<p>Met vriendelijke groet,<br/>{{recruiter.name}}</p>",
    body_text: null,
    merge_variables: [
      "candidate.first_name",
      "job.title",
      "recruiter.name",
    ],
    created_at: "2024-01-10T13:20:00Z",
    updated_at: "2024-01-10T13:20:00Z",
  },
];

// ─── AI matching (Slice 4) ───────────────────────────────────────────────────
//
// Mock data backing the new /api/matching/* endpoints. Used by the dev-mode
// fallback in `useMatching.ts` so the UI demonstrates the full match → explain
// flow even when the API is unavailable.
//
// Standardised AI-Act disclosure shown verbatim in the explanation dialog.
export const MOCK_AI_DISCLOSURE =
  "Deze match-score is gegenereerd door AI op basis van vacature-tekst en " +
  "kandidaat-profiel. De recruiter behoudt het finale oordeel.";

const COMPUTED_AT = "2026-05-05T09:00:00Z";

/**
 * Top-N kandidaten per vacature, gerangschikt op match-percent (descending).
 * Keyed op `job.id`. Alleen `job-1` heeft een vol mock-resultaatset; andere
 * vacatures vallen via de hook terug op een lege lijst.
 */
export const mockJobMatches: Record<string, JobMatch[]> = {
  "job-1": [
    {
      candidate_id: "cand-1",
      candidate_name: "Sophie van den Berg",
      candidate_email: "sophie.vdberg@gmail.com",
      candidate_position: "Senior Frontend Engineer",
      score: 0.92,
      cosine_score: 0.92,
      fit_score: 0.88,
      combined_score: 0.9,
      match_percent: 90,
      ai_explanation:
        "Sterke match: 6 jaar React/TypeScript ervaring sluit naadloos aan bij de senior frontend rol. Werkt al met Next.js en heeft ervaring met design systems.",
      similar_hire_count: 4,
      has_active_model: true,
      computed_at: COMPUTED_AT,
    },
    {
      candidate_id: "cand-3",
      candidate_name: "Aisha El Hamdouchi",
      candidate_email: "aisha.elhamdouchi@outlook.com",
      candidate_position: "Senior Product Manager",
      score: 0.87,
      cosine_score: 0.87,
      fit_score: 0.62,
      combined_score: 0.75,
      match_percent: 75,
      ai_explanation:
        "Hoge match op senioriteit en SaaS-context, technische affiniteit aanwezig. Achtergrond is product management — overweeg of een hybride PM/eng-rol passend is.",
      similar_hire_count: 1,
      has_active_model: true,
      computed_at: COMPUTED_AT,
    },
    {
      candidate_id: "cand-5",
      candidate_name: "Maya Okonkwo",
      candidate_email: "maya.okonkwo@gmail.com",
      candidate_position: "UX/UI Designer",
      score: 0.78,
      cosine_score: 0.78,
      fit_score: 0.71,
      combined_score: 0.74,
      match_percent: 74,
      ai_explanation:
        "Sterke front-end design skills (Figma, CSS, prototyping). Mist diepe React-implementatie-ervaring, maar designer-met-code-achtergrond past bij design-system focus van de rol.",
      similar_hire_count: 2,
      has_active_model: true,
      computed_at: COMPUTED_AT,
    },
    {
      candidate_id: "cand-2",
      candidate_name: "Thomas Janssen",
      candidate_email: "t.janssen@hotmail.com",
      candidate_position: "Data Engineer",
      score: 0.65,
      cosine_score: 0.65,
      fit_score: 0.41,
      combined_score: 0.53,
      match_percent: 53,
      ai_explanation: null,
      similar_hire_count: 0,
      has_active_model: true,
      computed_at: COMPUTED_AT,
    },
    {
      candidate_id: "cand-4",
      candidate_name: "Lars Visser",
      candidate_email: "lars.visser@gmail.com",
      candidate_position: "Junior Backend Developer",
      score: 0.54,
      cosine_score: 0.54,
      fit_score: 0.32,
      combined_score: 0.43,
      match_percent: 43,
      ai_explanation: null,
      similar_hire_count: 0,
      has_active_model: true,
      computed_at: COMPUTED_AT,
    },
  ],
};

/**
 * Top-N vacatures per kandidaat, gerangschikt op match-percent (descending).
 * Keyed op `candidate.id`.
 */
export const mockCandidateMatches: Record<string, CandidateMatch[]> = {
  "cand-1": [
    {
      job_id: "job-1",
      job_title: "Senior Frontend Developer",
      job_status: "open",
      score: 0.92,
      match_percent: 92,
      ai_explanation:
        "Sterke match: 6 jaar React/TypeScript ervaring sluit naadloos aan bij de senior frontend rol. Werkt al met Next.js en heeft ervaring met design systems.",
      computed_at: COMPUTED_AT,
    },
    {
      job_id: "job-2",
      job_title: "Product Manager",
      job_status: "open",
      score: 0.42,
      match_percent: 42,
      ai_explanation:
        "Beperkte match: profiel is engineering-zwaar zonder bewezen product-ownership. Rol vraagt 3+ jaar PM-ervaring.",
      computed_at: COMPUTED_AT,
    },
    {
      job_id: "job-3",
      job_title: "Backend Engineer (Python)",
      job_status: "draft",
      score: 0.31,
      match_percent: 31,
      ai_explanation:
        "Lage match: kandidaat heeft frontend-focus terwijl deze vacature Python/Django-expertise vraagt. Node.js-ervaring is positief maar niet de kern.",
      computed_at: COMPUTED_AT,
    },
  ],
};

/**
 * Pre-computed explanations keyed `${jobId}:${candidateId}`. The mutation hook
 * `useGenerateMatchExplanation` first tries the live POST endpoint and on
 * failure looks up an entry here, simulating the cache-or-generate flow.
 */
export const mockMatchExplanations: Record<string, MatchExplanationResponse> = {
  "job-1:cand-1": {
    explanation:
      "Sterke match: 6 jaar React/TypeScript ervaring sluit naadloos aan bij de senior frontend rol. Werkt al met Next.js en heeft ervaring met design systems en componentbibliotheken.",
    strengths: [
      "React expertise (10/10)",
      "TypeScript fluent (9/10)",
      "Senior level — 6 jaar relevante ervaring",
      "Next.js ervaring (9/10) sluit aan bij stack",
      "Beschikbaar binnen 1 maand",
    ],
    gaps: [
      "Geen expliciete GraphQL Federation ervaring genoemd",
      "Onbekend hoe diepgaand de design-system rol moet zijn",
    ],
    score: 0.92,
    match_percent: 92,
    cached: false,
    ai_disclosure: MOCK_AI_DISCLOSURE,
  },
  "job-1:cand-3": {
    explanation:
      "Goede match qua senioriteit en SaaS-context. Sterke stakeholder- en analytische vaardigheden, maar profiel is product management eerder dan engineering.",
    strengths: [
      "Senior level (8 jaar ervaring)",
      "SaaS B2B achtergrond",
      "Sterke stakeholder management skills",
      "Werkt agile en met design tools (Figma)",
    ],
    gaps: [
      "Geen hands-on React/TypeScript ervaring zichtbaar",
      "Product management profiel — twijfel over fit met IC engineering rol",
      "Salarisverwachting (€105k) ligt boven typisch frontend-budget",
    ],
    score: 0.87,
    match_percent: 87,
    cached: true,
    ai_disclosure: MOCK_AI_DISCLOSURE,
  },
  "job-1:cand-5": {
    explanation:
      "Designer met code-achtergrond. Sterke front-of-the-frontend skills, maar mist diepe React-implementatie-ervaring die de senior engineering rol vraagt.",
    strengths: [
      "Sterke UX/UI achtergrond (Figma, prototyping)",
      "CSS expertise",
      "User research ervaring — waardevol voor product-team samenwerking",
    ],
    gaps: [
      "Geen React/TypeScript expertise op senior niveau",
      "4 jaar ervaring is medior, niet senior",
      "Profiel is design-led, vacature vraagt engineering-led",
    ],
    score: 0.78,
    match_percent: 78,
    cached: false,
    ai_disclosure: MOCK_AI_DISCLOSURE,
  },
  "job-1:cand-2": {
    explanation:
      "Backend/data engineer met Python-focus. Heeft enige JavaScript-kennis maar geen frontend-portfolio. Lage fit voor senior frontend rol.",
    strengths: [
      "Sterk backend/data profiel",
      "Cloud en infrastructuur ervaring",
      "Senior software engineering hygiëne",
    ],
    gaps: [
      "Geen React of TypeScript ervaring",
      "Geen frontend portfolio",
      "Vraagt 2 maanden opzegtermijn",
    ],
    score: 0.65,
    match_percent: 65,
    cached: false,
    ai_disclosure: MOCK_AI_DISCLOSURE,
  },
  "job-1:cand-4": {
    explanation:
      "Junior kandidaat met backend-Java focus. Mist zowel de seniority als de frontend-stack die de rol vraagt.",
    strengths: [
      "Recent afgestudeerd, leergierig",
      "Direct beschikbaar",
      "Lage salarisverwachting biedt budget-ruimte",
    ],
    gaps: [
      "Junior level (1 jaar ervaring) versus senior rol",
      "Java/Spring stack — geen React/TypeScript",
      "Geen e-mail consent voor outreach",
    ],
    score: 0.54,
    match_percent: 54,
    cached: false,
    ai_disclosure: MOCK_AI_DISCLOSURE,
  },
  // Vacature-side keys (gebruikt vanaf candidate detail "Waarom?"):
  "job-2:cand-1": {
    explanation:
      "Beperkte match: profiel is engineering-zwaar zonder bewezen product-ownership. Rol vraagt 3+ jaar PM-ervaring met SaaS-roadmap-werk.",
    strengths: [
      "Sterke technische achtergrond",
      "SaaS context bekend",
      "Senior level",
    ],
    gaps: [
      "Geen product management track record",
      "Geen ervaring met roadmap- of stakeholder-werk in PM-rol",
      "Profielstap van engineering naar PM is significant",
    ],
    score: 0.42,
    match_percent: 42,
    cached: false,
    ai_disclosure: MOCK_AI_DISCLOSURE,
  },
  "job-3:cand-1": {
    explanation:
      "Lage match: kandidaat heeft frontend-focus terwijl deze vacature Python/Django-expertise vraagt. Node.js-ervaring is positief maar niet de kern.",
    strengths: [
      "Algemene engineering hygiëne",
      "Heeft Node.js ervaring (transferable)",
    ],
    gaps: [
      "Geen Python/Django ervaring",
      "Geen ervaring met data pipelines",
      "Profiel is duidelijk frontend-georiënteerd",
    ],
    score: 0.31,
    match_percent: 31,
    cached: false,
    ai_disclosure: MOCK_AI_DISCLOSURE,
  },
};

// ─── Talent Fit Model (Slice Q3.3) ──────────────────────────────────────────
//
// Mocks backing the new /api/matching/talent-fit/* endpoints. These power the
// settings/talent-fit page, the dual-score badge on MatchCard, and the
// SimilarHiresModal. All values are tenant-scoped in the real API; the mock
// pretends there is exactly one tenant ("KDMN demo bureau").

export const mockTalentFitModel: TalentFitModelInfo = {
  id: "tfm-2026-05-01",
  trained_on: 87,
  hires: 32,
  rejects: 55,
  precision_at_1: 0.74,
  recall_at_10: 0.81,
  auc: 0.83,
  trained_at: "2026-05-01T04:00:00Z",
  has_active_model: true,
  history: [
    {
      trained_at: "2025-11-01T04:00:00Z",
      precision_at_1: 0.61,
      recall_at_10: 0.68,
      auc: 0.74,
      trained_on: 41,
    },
    {
      trained_at: "2025-12-01T04:00:00Z",
      precision_at_1: 0.65,
      recall_at_10: 0.71,
      auc: 0.76,
      trained_on: 52,
    },
    {
      trained_at: "2026-01-01T04:00:00Z",
      precision_at_1: 0.68,
      recall_at_10: 0.74,
      auc: 0.78,
      trained_on: 61,
    },
    {
      trained_at: "2026-02-01T04:00:00Z",
      precision_at_1: 0.7,
      recall_at_10: 0.76,
      auc: 0.8,
      trained_on: 70,
    },
    {
      trained_at: "2026-03-01T04:00:00Z",
      precision_at_1: 0.71,
      recall_at_10: 0.78,
      auc: 0.81,
      trained_on: 78,
    },
    {
      trained_at: "2026-04-01T04:00:00Z",
      precision_at_1: 0.73,
      recall_at_10: 0.8,
      auc: 0.82,
      trained_on: 83,
    },
    {
      trained_at: "2026-05-01T04:00:00Z",
      precision_at_1: 0.74,
      recall_at_10: 0.81,
      auc: 0.83,
      trained_on: 87,
    },
  ],
};

/**
 * Top-N similar past-hires per (candidate). Used by SimilarHiresModal when
 * opened from a MatchCard. Keyed on the *queried* candidate id; values are
 * the past-hires that look most like that candidate.
 */
export const mockSimilarHiresByCandidate: Record<string, SimilarHireDetail[]> = {
  "cand-1": [
    {
      candidate_id: "past-cand-101",
      candidate_name: "Lisa Visser",
      candidate_position: "Senior Frontend Developer",
      job_id: "past-job-101",
      job_title: "Senior FE bij Acme Holding",
      hired_at: "2025-08-15T10:00:00Z",
      cosine_to_query: 0.91,
      shared_skills: ["React", "TypeScript", "Next.js"],
    },
    {
      candidate_id: "past-cand-102",
      candidate_name: "Daan Kuipers",
      candidate_position: "Lead Frontend Engineer",
      job_id: "past-job-102",
      job_title: "Lead FE bij FinTech Republic",
      hired_at: "2025-06-22T09:30:00Z",
      cosine_to_query: 0.88,
      shared_skills: ["React", "Design systems", "GraphQL"],
    },
    {
      candidate_id: "past-cand-103",
      candidate_name: "Noor Bakker",
      candidate_position: "Senior Frontend Engineer",
      job_id: "past-job-103",
      job_title: "Senior FE bij Logistics NL",
      hired_at: "2025-04-08T11:15:00Z",
      cosine_to_query: 0.84,
      shared_skills: ["React", "TypeScript", "Tailwind"],
    },
    {
      candidate_id: "past-cand-104",
      candidate_name: "Mehmet Aydin",
      candidate_position: "Frontend Tech Lead",
      job_id: "past-job-104",
      job_title: "FE Tech Lead bij MediaCo",
      hired_at: "2025-02-19T15:00:00Z",
      cosine_to_query: 0.79,
      shared_skills: ["React", "Next.js", "Architectuur"],
    },
  ],
  "cand-3": [
    {
      candidate_id: "past-cand-201",
      candidate_name: "Esmee de Wit",
      candidate_position: "Product Manager SaaS",
      job_id: "past-job-201",
      job_title: "Senior PM bij PortalCo",
      hired_at: "2025-09-04T13:00:00Z",
      cosine_to_query: 0.86,
      shared_skills: ["SaaS", "Stakeholder management", "Roadmapping"],
    },
  ],
  "cand-5": [
    {
      candidate_id: "past-cand-301",
      candidate_name: "Ravi Mehta",
      candidate_position: "Product Designer",
      job_id: "past-job-301",
      job_title: "Senior Designer bij ScaleCo",
      hired_at: "2025-07-11T08:45:00Z",
      cosine_to_query: 0.82,
      shared_skills: ["Figma", "Design systems", "Prototyping"],
    },
    {
      candidate_id: "past-cand-302",
      candidate_name: "Chloé Dupont",
      candidate_position: "UX Designer",
      job_id: "past-job-302",
      job_title: "UX Designer bij EdTech",
      hired_at: "2025-03-28T10:00:00Z",
      cosine_to_query: 0.77,
      shared_skills: ["Figma", "User research"],
    },
  ],
};

/**
 * Similar past-hires for a *job* — surfaces in the JobAISuiteTab as
 * "Vergelijkbare past-hires van jou". Independent of candidate, keyed on
 * job-id.
 */
export const mockSimilarHiresByJob: Record<string, SimilarHireDetail[]> = {
  "job-1": [
    {
      candidate_id: "past-cand-101",
      candidate_name: "Lisa Visser",
      candidate_position: "Senior Frontend Developer",
      job_id: "past-job-101",
      job_title: "Senior FE bij Acme Holding",
      hired_at: "2025-08-15T10:00:00Z",
      cosine_to_query: 0.93,
      shared_skills: ["React", "TypeScript", "Next.js"],
    },
    {
      candidate_id: "past-cand-102",
      candidate_name: "Daan Kuipers",
      candidate_position: "Lead Frontend Engineer",
      job_id: "past-job-102",
      job_title: "Lead FE bij FinTech Republic",
      hired_at: "2025-06-22T09:30:00Z",
      cosine_to_query: 0.9,
      shared_skills: ["React", "Design systems", "GraphQL"],
    },
    {
      candidate_id: "past-cand-103",
      candidate_name: "Noor Bakker",
      candidate_position: "Senior Frontend Engineer",
      job_id: "past-job-103",
      job_title: "Senior FE bij Logistics NL",
      hired_at: "2025-04-08T11:15:00Z",
      cosine_to_query: 0.86,
      shared_skills: ["React", "TypeScript", "Tailwind"],
    },
    {
      candidate_id: "past-cand-105",
      candidate_name: "Femke Hendriks",
      candidate_position: "Senior FE Engineer",
      job_id: "past-job-105",
      job_title: "Senior FE bij Retail Group",
      hired_at: "2024-12-02T13:30:00Z",
      cosine_to_query: 0.83,
      shared_skills: ["React", "Storybook", "Testing"],
    },
    {
      candidate_id: "past-cand-104",
      candidate_name: "Mehmet Aydin",
      candidate_position: "Frontend Tech Lead",
      job_id: "past-job-104",
      job_title: "FE Tech Lead bij MediaCo",
      hired_at: "2025-02-19T15:00:00Z",
      cosine_to_query: 0.81,
      shared_skills: ["React", "Next.js", "Architectuur"],
    },
  ],
};

/**
 * Pre-computed Talent Fit predictions per (job, candidate). Drives the
 * expanded dual-score badge details popover. Key format `${jobId}:${candId}`.
 */
export const mockTalentFitPredictions: Record<string, TalentFitPrediction> = {
  "job-1:cand-1": {
    fit_score: 0.88,
    combined_score: 0.9,
    cosine_score: 0.92,
    features: [
      { name: "skill_overlap_past_hires", weight: 0.42, label: "Skill-overlap met eerdere hires" },
      { name: "tenure_match", weight: 0.21, label: "Senioriteit past bij vergelijkbare rollen" },
      { name: "industry_signal", weight: 0.13, label: "Sector-signaal (SaaS/B2B)" },
      { name: "salary_band_match", weight: -0.07, label: "Salarisband afwijking" },
    ],
    similar_hires: [],
  },
  "job-1:cand-3": {
    fit_score: 0.62,
    combined_score: 0.75,
    cosine_score: 0.87,
    features: [
      { name: "tenure_match", weight: 0.34, label: "Senioriteit past bij vergelijkbare rollen" },
      { name: "industry_signal", weight: 0.18, label: "Sector-signaal (SaaS/B2B)" },
      { name: "skill_overlap_past_hires", weight: -0.22, label: "Skill-overlap met eerdere hires" },
      { name: "title_pivot_penalty", weight: -0.15, label: "Profielstap PM → IC engineering" },
    ],
    similar_hires: [],
  },
};

// ─── Job-detail mocks (Slice 4.5) ───────────────────────────────────────────
//
// Backing data for the 6-tab job detail redesign. Job-1 ("Senior Frontend
// Developer") is fully populated as the showcase job; other jobs fall through
// to empty arrays / minimal stubs so the UI stays graceful.

export const mockJobTeam: Record<string, JobTeamMember[]> = {
  "job-1": [
    {
      id: "team-1-1",
      job_id: "job-1",
      user_id: "user-1",
      user_name: "Emma Bakker",
      user_email: "emma@talentflow.io",
      role: "owner",
      added_at: "2024-01-10T08:05:00Z",
    },
    {
      id: "team-1-2",
      job_id: "job-1",
      user_id: "user-2",
      user_name: "Jan Peters",
      user_email: "jan@talentflow.io",
      role: "hiring_manager",
      added_at: "2024-01-10T08:05:00Z",
    },
    {
      id: "team-1-3",
      job_id: "job-1",
      user_id: "user-3",
      user_name: "Lisa Smits",
      user_email: "lisa@talentflow.io",
      role: "interviewer",
      added_at: "2024-01-12T09:30:00Z",
    },
  ],
  "job-2": [
    {
      id: "team-2-1",
      job_id: "job-2",
      user_id: "user-1",
      user_name: "Emma Bakker",
      user_email: "emma@talentflow.io",
      role: "owner",
      added_at: "2024-01-15T10:05:00Z",
    },
  ],
  "job-3": [
    {
      id: "team-3-1",
      job_id: "job-3",
      user_id: "user-2",
      user_name: "Jan Peters",
      user_email: "jan@talentflow.io",
      role: "owner",
      added_at: "2024-01-25T08:05:00Z",
    },
  ],
};

export const mockJobNotes: Record<string, JobNote[]> = {
  "job-1": [
    {
      id: "note-1-1",
      job_id: "job-1",
      author_id: "user-1",
      author_name: "Emma Bakker",
      body:
        "Briefing met TCS gehad. Belangrijkste eisen: Next.js App Router en design-system ervaring. Salaris is rekbaar tot €88k voor de juiste kandidaat.",
      mentions: [],
      created_at: "2024-01-11T09:15:00Z",
    },
    {
      id: "note-1-2",
      job_id: "job-1",
      author_id: "user-2",
      author_name: "Jan Peters",
      body:
        "Eerste interview met Sophie was positief — Emma kan de tweede ronde inplannen.",
      mentions: ["user-1"],
      created_at: "2024-01-17T14:00:00Z",
    },
    {
      id: "note-1-3",
      job_id: "job-1",
      author_id: "user-1",
      author_name: "Emma Bakker",
      body:
        "Lars heeft te weinig ervaring voor senior — afwijzen na screening, eventueel parkeren voor medior-rol.",
      mentions: [],
      created_at: "2024-01-21T11:20:00Z",
    },
    {
      id: "note-1-4",
      job_id: "job-1",
      author_id: "user-3",
      author_name: "Lisa Smits",
      body:
        "Technische test verstuurd naar Thomas. Deadline volgende vrijdag.",
      mentions: [],
      created_at: "2024-01-22T15:45:00Z",
    },
    {
      id: "note-1-5",
      job_id: "job-1",
      author_id: "user-1",
      author_name: "Emma Bakker",
      body:
        "Klant wil graag iemand voor 1 april starten. We hebben dus nog ~10 weken om af te ronden.",
      mentions: [],
      created_at: "2024-01-25T08:30:00Z",
    },
  ],
  "job-2": [],
  "job-3": [],
};

export const mockJobAttachments: Record<string, JobAttachment[]> = {
  "job-1": [
    {
      id: "att-1-1",
      job_id: "job-1",
      filename: "tcs-functieprofiel.pdf",
      mime_type: "application/pdf",
      size_bytes: 348_672,
      storage_url: "/attachments/tcs-functieprofiel.pdf",
      uploaded_by_id: "user-1",
      uploaded_by_name: "Emma Bakker",
      created_at: "2024-01-11T09:30:00Z",
    },
    {
      id: "att-1-2",
      job_id: "job-1",
      filename: "tcs-arbeidsvoorwaarden.pdf",
      mime_type: "application/pdf",
      size_bytes: 121_344,
      storage_url: "/attachments/tcs-arbeidsvoorwaarden.pdf",
      uploaded_by_id: "user-2",
      uploaded_by_name: "Jan Peters",
      created_at: "2024-01-12T10:00:00Z",
    },
  ],
  "job-2": [],
  "job-3": [],
};

export const mockJobHealth: Record<string, JobHealthBreakdown> = {
  "job-1": {
    job_id: "job-1",
    score: 78,
    components: [
      {
        key: "velocity",
        label: "Doorlooptijd",
        score: 84,
        description:
          "Kandidaten bewegen sneller door de pipeline dan het bureau-gemiddelde van 14 dagen.",
      },
      {
        key: "drop_off",
        label: "Drop-off",
        score: 72,
        description:
          "Iets bovengemiddelde uitval tussen screening en interview — controleer de screening-feedback.",
      },
      {
        key: "recency",
        label: "Activiteit",
        score: 78,
        description:
          "Recruiter heeft laatste 7 dagen 4 acties uitgevoerd. Net boven verwacht.",
      },
    ],
    predicted_close_date: "2026-05-28",
    days_open: 12,
    candidates_total: 18,
    candidates_in_funnel: 11,
    computed_at: "2026-05-05T08:00:00Z",
    weights: { velocity: 0.4, drop_off: 0.3, recency: 0.3 },
  },
  "job-2": {
    job_id: "job-2",
    score: 54,
    components: [
      {
        key: "velocity",
        label: "Doorlooptijd",
        score: 48,
        description: "Kandidaten blijven langer dan gewenst hangen in screening.",
      },
      {
        key: "drop_off",
        label: "Drop-off",
        score: 60,
        description: "Normale uitval voor PM-rollen.",
      },
      {
        key: "recency",
        label: "Activiteit",
        score: 55,
        description: "Laatste activiteit was 6 dagen geleden — interventie aanbevolen.",
      },
    ],
    predicted_close_date: "2026-06-20",
    days_open: 28,
    candidates_total: 9,
    candidates_in_funnel: 5,
    computed_at: "2026-05-05T08:00:00Z",
    weights: { velocity: 0.4, drop_off: 0.3, recency: 0.3 },
  },
  "job-3": {
    job_id: "job-3",
    score: 34,
    components: [
      {
        key: "velocity",
        label: "Doorlooptijd",
        score: 0,
        description: "Vacature staat op concept — geen activiteit.",
      },
      {
        key: "drop_off",
        label: "Drop-off",
        score: 50,
        description: "Geen data beschikbaar.",
      },
      {
        key: "recency",
        label: "Activiteit",
        score: 50,
        description: "Vacature is recent aangemaakt maar nog niet gepubliceerd.",
      },
    ],
    predicted_close_date: null,
    days_open: 0,
    candidates_total: 0,
    candidates_in_funnel: 0,
    computed_at: "2026-05-05T08:00:00Z",
    weights: { velocity: 0.4, drop_off: 0.3, recency: 0.3 },
  },
};

export const mockJobFunnel: Record<string, JobFunnelResponse> = {
  "job-1": {
    job_id: "job-1",
    stages: [
      {
        stage_id: "stage-1",
        name: "Nieuwe sollicitaties",
        position: 1,
        count: 4,
        conversion_to_next_pct: 75,
      },
      {
        stage_id: "stage-2",
        name: "Screening",
        position: 2,
        count: 3,
        conversion_to_next_pct: 67,
      },
      {
        stage_id: "stage-3",
        name: "Interview",
        position: 3,
        count: 2,
        conversion_to_next_pct: 50,
      },
      {
        stage_id: "stage-4",
        name: "Technische test",
        position: 4,
        count: 1,
        conversion_to_next_pct: 100,
      },
      {
        stage_id: "stage-5",
        name: "Aanbieding",
        position: 5,
        count: 1,
        conversion_to_next_pct: null,
      },
    ],
    total: 11,
    hired: 0,
    dropped: 1,
    computed_at: "2026-05-05T08:00:00Z",
  },
  "job-2": {
    job_id: "job-2",
    stages: [
      {
        stage_id: "stage-6",
        name: "Nieuwe sollicitaties",
        position: 1,
        count: 1,
        conversion_to_next_pct: 100,
      },
      {
        stage_id: "stage-7",
        name: "Screening",
        position: 2,
        count: 1,
        conversion_to_next_pct: 0,
      },
      {
        stage_id: "stage-8",
        name: "Interview",
        position: 3,
        count: 0,
        conversion_to_next_pct: null,
      },
      {
        stage_id: "stage-9",
        name: "Case Study",
        position: 4,
        count: 0,
        conversion_to_next_pct: null,
      },
    ],
    total: 2,
    hired: 0,
    dropped: 0,
    computed_at: "2026-05-05T08:00:00Z",
  },
  "job-3": {
    job_id: "job-3",
    stages: [],
    total: 0,
    hired: 0,
    dropped: 0,
    computed_at: "2026-05-05T08:00:00Z",
  },
};

export const mockComparableJobs: Record<string, ComparableJob[]> = {
  "job-1": [
    {
      id: "past-1",
      title: "Senior Frontend Engineer",
      client: "Bunq",
      similarity_score: 91,
      filled: true,
      days_to_fill: 22,
      total_candidates: 18,
      closed_at: "2025-09-12T00:00:00Z",
    },
    {
      id: "past-2",
      title: "Lead React Developer",
      client: "Adyen",
      similarity_score: 84,
      filled: true,
      days_to_fill: 31,
      total_candidates: 24,
      closed_at: "2025-07-30T00:00:00Z",
    },
    {
      id: "past-3",
      title: "Frontend Developer (TypeScript)",
      client: "Coolblue",
      similarity_score: 77,
      filled: true,
      days_to_fill: 18,
      total_candidates: 14,
      closed_at: "2025-11-05T00:00:00Z",
    },
    {
      id: "past-4",
      title: "Senior UI Engineer",
      client: "Picnic",
      similarity_score: 71,
      filled: false,
      days_to_fill: null,
      total_candidates: 9,
      closed_at: null,
    },
  ],
  "job-2": [],
  "job-3": [],
};

export const mockJobSourcing: Record<string, JobSourcingItem[]> = {
  "job-1": [
    {
      source: "LinkedIn",
      candidates: 6,
      hires: 0,
      conversion_pct: 0,
      cost_per_hire_cents: 0,
    },
    {
      source: "Referral",
      candidates: 2,
      hires: 0,
      conversion_pct: 0,
      cost_per_hire_cents: 0,
    },
    {
      source: "Career page",
      candidates: 3,
      hires: 0,
      conversion_pct: 0,
      cost_per_hire_cents: 0,
    },
    {
      source: "Indeed",
      candidates: 1,
      hires: 0,
      conversion_pct: 0,
      cost_per_hire_cents: 0,
    },
  ],
  "job-2": [],
  "job-3": [],
};

export const mockBiasCheck: Record<string, BiasCheckResult> = {
  "job-1": {
    job_id: "job-1",
    clarity_score: 82,
    inclusivity_score: 71,
    flags: [
      {
        type: "gender_coded",
        label: "Mannelijk getint woordgebruik",
        excerpt: "rockstar developer",
        suggestion:
          "Vervang door neutralere termen zoals 'ervaren engineer' of 'sterke technische professional'.",
        severity: "medium",
      },
      {
        type: "vague_requirement",
        label: "Vage vereiste",
        excerpt: "Sterke communicatieve vaardigheden",
        suggestion:
          "Specificeer: in welke taal, voor welk publiek (technisch/niet-technisch) en in welke vorm (schriftelijk/mondeling).",
        severity: "low",
      },
    ],
    ai_disclosure: MOCK_AI_DISCLOSURE,
    computed_at: "2026-05-05T08:00:00Z",
  },
  "job-2": {
    job_id: "job-2",
    clarity_score: 68,
    inclusivity_score: 80,
    flags: [],
    ai_disclosure: MOCK_AI_DISCLOSURE,
    computed_at: "2026-05-05T08:00:00Z",
  },
  "job-3": {
    job_id: "job-3",
    clarity_score: 60,
    inclusivity_score: 75,
    flags: [],
    ai_disclosure: MOCK_AI_DISCLOSURE,
    computed_at: "2026-05-05T08:00:00Z",
  },
};

/**
 * Mock sourcing-suggestion booleans surfaced in the AI Suite tab. Plausible
 * boolean searches that a recruiter could paste into LinkedIn / Indeed.
 */
export const mockSourcingSuggestions: Record<string, string[]> = {
  "job-1": [
    "site:linkedin.com/in (\"Senior Frontend\" OR \"Lead Frontend\") AND React AND TypeScript AND \"Next.js\" AND (Amsterdam OR \"The Netherlands\")",
    "site:linkedin.com/in (\"Frontend Engineer\" OR \"UI Engineer\") AND \"design system\" AND TypeScript -recruiter -intern",
    "site:github.com (location:Amsterdam OR location:\"The Netherlands\") AND language:TypeScript AND followers:>50",
  ],
  "job-2": [
    "site:linkedin.com/in \"Product Manager\" AND SaaS AND (Rotterdam OR Amsterdam OR remote)",
  ],
  "job-3": [],
};

// ─── ATS extensions (Sprint Q1.2) ───────────────────────────────────────────

/**
 * Saved searches — surface a few realistic Boolean queries that recruiters
 * commonly reuse. Mutated by the `useSavedSearches` mock-fallback when the
 * API is unreachable, so the dropdown stays in sync with create/delete UI.
 */
export const mockSavedSearches: SavedSearch[] = [
  {
    id: "ss-1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    entity_type: "candidates",
    name: "Senior FE — direct beschikbaar",
    query: "(react OR \"next.js\") AND typescript AND \"design system\" NOT junior",
    filters: { source: "linkedin" },
    created_at: "2026-04-12T09:00:00Z",
    updated_at: "2026-04-12T09:00:00Z",
  },
  {
    id: "ss-2",
    tenant_id: "tenant-1",
    user_id: "user-1",
    entity_type: "candidates",
    name: "Backend Python — Amsterdam",
    query: "python AND (django OR fastapi) AND postgres AND city:amsterdam",
    filters: null,
    created_at: "2026-03-20T13:30:00Z",
    updated_at: "2026-04-02T10:15:00Z",
  },
  {
    id: "ss-3",
    tenant_id: "tenant-1",
    user_id: "user-1",
    entity_type: "candidates",
    name: "Product Managers — scale-up ervaring",
    query: "\"product manager\" AND saas AND (b2b OR enterprise) AND yoe:>4",
    filters: null,
    created_at: "2026-02-10T08:45:00Z",
    updated_at: "2026-02-10T08:45:00Z",
  },
];

/**
 * Job templates — opslagbare vacature-skeletons die recruiters gebruiken om
 * snel nieuwe vacatures te starten zonder van scratch te beginnen.
 */
export const mockJobTemplates: JobTemplate[] = [
  {
    id: "tmpl-1",
    tenant_id: "tenant-1",
    name: "Senior Frontend Developer",
    description:
      "Standaard template voor ervaren React/TypeScript frontenders met design-system ervaring.",
    job_data: {
      title: "Senior Frontend Developer",
      department: "Engineering",
      location: "Amsterdam (hybride)",
      employment_type: "fulltime",
      salary_min: 75000,
      salary_max: 95000,
      description:
        "Wij zoeken een Senior Frontend Developer die ons design system meebouwt en complexe UI-componenten bouwt voor onze SaaS-suite. Je werkt nauw samen met designers en backend-engineers in een autonoom productteam.",
      requirements: [
        "5+ jaar React-ervaring",
        "TypeScript expertise",
        "Ervaring met Next.js en SSR",
        "Design system / component library ervaring",
        "Toegankelijkheid (WCAG 2.1) bewustzijn",
      ],
    },
    created_at: "2026-01-08T10:00:00Z",
    updated_at: "2026-03-18T14:00:00Z",
  },
  {
    id: "tmpl-2",
    tenant_id: "tenant-1",
    name: "Product Manager (B2B SaaS)",
    description:
      "Template voor Product Managers met B2B SaaS-ervaring, gericht op data-driven roadmap-werk.",
    job_data: {
      title: "Product Manager",
      department: "Product",
      location: "Rotterdam (hybride)",
      employment_type: "fulltime",
      salary_min: 70000,
      salary_max: 90000,
      description:
        "Als Product Manager ben je verantwoordelijk voor de roadmap en outcomes van een van onze productpijlers. Je werkt customer-driven, met een sterke analytische basis.",
      requirements: [
        "4+ jaar PM-ervaring in B2B SaaS",
        "Data-driven besluitvorming (SQL is een pré)",
        "Sterke stakeholder-skills",
        "Ervaring met discovery & dual-track agile",
      ],
    },
    created_at: "2026-01-15T11:00:00Z",
    updated_at: "2026-02-04T09:30:00Z",
  },
  {
    id: "tmpl-3",
    tenant_id: "tenant-1",
    name: "Senior Product Designer",
    description:
      "Template voor Senior Product Designers met sterke interaction & visual skills.",
    job_data: {
      title: "Senior Product Designer",
      department: "Design",
      location: "Amsterdam (hybride)",
      employment_type: "fulltime",
      salary_min: 65000,
      salary_max: 85000,
      description:
        "Wij zoeken een Senior Product Designer die end-to-end ownership neemt over feature-discovery én visual delivery. Je werkt in een cross-functioneel team met PM en engineering.",
      requirements: [
        "5+ jaar product design ervaring",
        "Sterke interaction- en visual-design skills",
        "Figma expertise + design system bijdragen",
        "User research & usability testing",
      ],
    },
    created_at: "2026-02-01T09:00:00Z",
    updated_at: "2026-02-01T09:00:00Z",
  },
];

/**
 * Custom field definitions per entity-type. Demonstrates alle ondersteunde
 * field_types (text, date, dropdown, multiselect, boolean, number) zodat de
 * `CustomFieldsRenderer` component in dev-mode meteen zichtbaar is.
 */
export const mockCustomFieldDefinitions: Record<string, CustomFieldDefinition[]> = {
  candidate: [
    {
      id: "cf-1",
      tenant_id: "tenant-1",
      entity_type: "candidate",
      key: "linkedin_url",
      label: "LinkedIn URL",
      field_type: "text",
      required: false,
      position: 1,
    },
    {
      id: "cf-2",
      tenant_id: "tenant-1",
      entity_type: "candidate",
      key: "preferred_start_date",
      label: "Voorkeur startdatum",
      field_type: "date",
      required: false,
      position: 2,
    },
    {
      id: "cf-3",
      tenant_id: "tenant-1",
      entity_type: "candidate",
      key: "work_authorization",
      label: "Werkvergunning",
      field_type: "dropdown",
      options: ["NL/EU", "VS", "Anders"],
      required: true,
      position: 3,
    },
    {
      id: "cf-4",
      tenant_id: "tenant-1",
      entity_type: "candidate",
      key: "preferred_languages",
      label: "Werktalen",
      field_type: "multiselect",
      options: ["Nederlands", "Engels", "Duits", "Frans", "Spaans"],
      required: false,
      position: 4,
    },
  ],
  job: [
    {
      id: "cf-job-1",
      tenant_id: "tenant-1",
      entity_type: "job",
      key: "client_account_manager",
      label: "Account manager (intern)",
      field_type: "text",
      required: false,
      position: 1,
    },
    {
      id: "cf-job-2",
      tenant_id: "tenant-1",
      entity_type: "job",
      key: "is_confidential",
      label: "Vertrouwelijke vacature",
      field_type: "boolean",
      required: false,
      position: 2,
    },
    {
      id: "cf-job-3",
      tenant_id: "tenant-1",
      entity_type: "job",
      key: "fee_percentage",
      label: "Fee (%)",
      field_type: "number",
      required: false,
      position: 3,
    },
  ],
  application: [
    {
      id: "cf-app-1",
      tenant_id: "tenant-1",
      entity_type: "application",
      key: "referrer_name",
      label: "Aangedragen door",
      field_type: "text",
      required: false,
      position: 1,
    },
  ],
};

/**
 * Scorecard templates — twee plausibele templates, één technisch interview
 * en één cultural-fit. De criteria zijn 1-op-1 wat de UI op het scherm
 * rendert als 5-punts radio.
 */
export const mockScorecardTemplates: ScorecardTemplate[] = [
  {
    id: "tmpl-sc-1",
    tenant_id: "tenant-1",
    name: "Default tech interview",
    description: "Standaard scorecard voor technische interviews (engineering rollen).",
    criteria: [
      {
        key: "technical_skills",
        label: "Technische vaardigheden",
        description: "Diepgang in relevante tech-stack en problem-solving.",
      },
      {
        key: "system_design",
        label: "System design / architectuur",
        description: "Vermogen om schaalbare oplossingen te ontwerpen.",
      },
      {
        key: "code_quality",
        label: "Code-kwaliteit",
        description: "Leesbaarheid, testdekking, engineering hygiene.",
      },
      {
        key: "communication",
        label: "Communicatie",
        description: "Helderheid in uitleg en denkproces.",
      },
      {
        key: "ownership",
        label: "Ownership / autonomie",
        description: "Pakt verantwoordelijkheid en handelt zelfstandig.",
      },
    ],
    created_at: "2026-01-05T09:00:00Z",
  },
  {
    id: "tmpl-sc-2",
    tenant_id: "tenant-1",
    name: "Cultural fit",
    description: "Cultural-fit scorecard voor het laatste interview-rondje.",
    criteria: [
      {
        key: "values_alignment",
        label: "Aansluiting op waarden",
        description: "Past bij onze kernwaarden (transparantie, eigenaarschap).",
      },
      {
        key: "collaboration",
        label: "Samenwerking",
        description: "Werkt effectief in cross-functionele teams.",
      },
      {
        key: "growth_mindset",
        label: "Groei-mindset",
        description: "Toont leerbereidheid en omgang met feedback.",
      },
      {
        key: "energy_match",
        label: "Energie-match",
        description: "Past bij het tempo en de werkstijl van het team.",
      },
    ],
    created_at: "2026-01-05T09:00:00Z",
  },
];

/**
 * Bestaande scorecards — drie ingevulde scorecards van verschillende
 * interviewers op application `app-1`, zodat de Agreement Matrix in de
 * UI direct iets te tonen heeft.
 */
export const mockScorecards: Record<string, Scorecard[]> = {
  "app-1": [
    {
      id: "sc-1",
      tenant_id: "tenant-1",
      application_id: "app-1",
      template_id: "tmpl-sc-1",
      user_id: "user-2",
      user_name: "Mara Visser",
      interview_date: "2026-04-22T13:00:00Z",
      criteria: [
        { key: "technical_skills", label: "Technische vaardigheden", score: 5 },
        { key: "system_design", label: "System design / architectuur", score: 4 },
        { key: "code_quality", label: "Code-kwaliteit", score: 5 },
        { key: "communication", label: "Communicatie", score: 4 },
        { key: "ownership", label: "Ownership / autonomie", score: 5 },
      ],
      overall_score: 4.6,
      recommendation: "strong_yes",
      notes:
        "Sterke technische diepgang, vooral op React-architectuur. Heldere communicatie en eigenaarschap. Aanbevolen voor offer.",
      created_at: "2026-04-22T15:30:00Z",
      updated_at: "2026-04-22T15:30:00Z",
    },
    {
      id: "sc-2",
      tenant_id: "tenant-1",
      application_id: "app-1",
      template_id: "tmpl-sc-1",
      user_id: "user-3",
      user_name: "Jeroen Bakker",
      interview_date: "2026-04-23T10:00:00Z",
      criteria: [
        { key: "technical_skills", label: "Technische vaardigheden", score: 4 },
        { key: "system_design", label: "System design / architectuur", score: 3 },
        { key: "code_quality", label: "Code-kwaliteit", score: 4 },
        { key: "communication", label: "Communicatie", score: 5 },
        { key: "ownership", label: "Ownership / autonomie", score: 4 },
      ],
      overall_score: 4.0,
      recommendation: "yes",
      notes:
        "Goede communicator, maar wat aarzelend bij distributed-systems vragen. Solide hire voor een team met genoeg seniors.",
      created_at: "2026-04-23T12:00:00Z",
      updated_at: "2026-04-23T12:00:00Z",
    },
    {
      id: "sc-3",
      tenant_id: "tenant-1",
      application_id: "app-1",
      template_id: "tmpl-sc-2",
      user_id: "user-4",
      user_name: "Lisa de Vries",
      interview_date: "2026-04-24T14:00:00Z",
      criteria: [
        { key: "values_alignment", label: "Aansluiting op waarden", score: 5 },
        { key: "collaboration", label: "Samenwerking", score: 5 },
        { key: "growth_mindset", label: "Groei-mindset", score: 4 },
        { key: "energy_match", label: "Energie-match", score: 4 },
      ],
      overall_score: 4.5,
      recommendation: "strong_yes",
      notes:
        "Cultural fit zeer sterk. Past goed bij ons eigenaarschapsmodel.",
      created_at: "2026-04-24T16:00:00Z",
      updated_at: "2026-04-24T16:00:00Z",
    },
  ],
};

/**
 * Dedupe matches — voorbeeld: cand-1 deelt e-mail met een (synthetisch)
 * tweede record. Reageert op `useDuplicatesForCandidate("cand-1")`.
 */
export const mockDuplicates: Record<string, DedupeMatch[]> = {
  "cand-1": [
    {
      candidate_id: "cand-1",
      matched_candidate_id: "cand-2",
      reason: "email",
      score: 1.0,
      matched_name: "Thomas Janssen",
      matched_email: "sophie.vdberg@gmail.com",
    },
  ],
};

/**
 * Mock import-status store — aangevuld door `useStartImport` zodat
 * `useImportStatus` polling in dev-mode een complete state-machine doorloopt.
 */
export const mockImportStatuses: Record<string, ImportStatusResponse> = {};

// ─────────────────────────────────────────────────────────────────────────────
// Portal-mock data (Q2.1 — white-label klantportaal)
// ─────────────────────────────────────────────────────────────────────────────

export interface MockPortalCommentEntry {
  id: string;
  author: string | null;
  body: string;
  created_at: string;
}

export interface MockPortalApplication {
  id: string;
  candidate_id: string;
  candidate_name: string;
  candidate_email: string | null;
  candidate_phone: string | null;
  ai_score: number | null;
  stage_name: string | null;
  pipeline_history: Array<{ stage_name: string; entered_at: string }>;
  applied_at: string | null;
  skills: string[];
  resume_url: string | null;
  comments: MockPortalCommentEntry[];
  client_feedback: "approve" | "reject" | "doubt" | null;
}

export interface MockPortalAccess {
  job: { id: string; title: string; description: string | null };
  recruiter: { name: string; email: string | null } | null;
  client_name: string | null;
  permissions: {
    view_candidates: boolean;
    view_resumes: boolean;
    view_ai_scores: boolean;
    view_contact_info: boolean;
    accept_reject: boolean;
    comment: boolean;
    download_cv: boolean;
    view_pipeline_history: boolean;
  };
  branding: {
    brand_name: string | null;
    logo_url: string | null;
    favicon_url: string | null;
    primary_color: string | null;
    accent_color: string | null;
    show_powered_by: boolean;
  };
  applications: MockPortalApplication[];
  expires_at: string | null;
}

export const MOCK_PORTAL_BRANDING: MockPortalAccess["branding"] = {
  brand_name: "Acme Talent Hub",
  logo_url: null,
  favicon_url: null,
  primary_color: "#0ea5e9",
  accent_color: "#22d3ee",
  show_powered_by: true,
};

export const MOCK_PORTAL_ACCESS_FULL: MockPortalAccess = {
  job: {
    id: "job-portal-1",
    title: "Senior Frontend Developer",
    description:
      "We zoeken een ervaren frontend developer met diepgaande kennis van React, TypeScript en moderne UI-architectuur. Je werkt nauw samen met designers en backend-engineers aan ons SaaS-platform. Minimaal 5 jaar ervaring met grootschalige web-applicaties is vereist.",
  },
  recruiter: {
    name: "Sanne Postma",
    email: "sanne@example-recruitment.nl",
  },
  client_name: "Acme Corporation",
  permissions: {
    view_candidates: true,
    view_resumes: true,
    view_ai_scores: true,
    view_contact_info: true,
    accept_reject: true,
    comment: true,
    download_cv: true,
    view_pipeline_history: true,
  },
  branding: MOCK_PORTAL_BRANDING,
  applications: [
    {
      id: "papp-1",
      candidate_id: "pcand-1",
      candidate_name: "Lisa van der Berg",
      candidate_email: "lisa.vdberg@example.com",
      candidate_phone: "+31 6 1234 5678",
      ai_score: 92,
      stage_name: "Interview",
      pipeline_history: [
        { stage_name: "Sollicitatie ontvangen", entered_at: "2026-04-12T10:00:00Z" },
        { stage_name: "Screening", entered_at: "2026-04-15T11:00:00Z" },
        { stage_name: "Interview", entered_at: "2026-04-22T14:00:00Z" },
      ],
      applied_at: "2026-04-12T10:00:00Z",
      skills: ["React", "TypeScript", "Next.js", "GraphQL", "Tailwind"],
      resume_url: "/sample-cv.pdf",
      comments: [
        {
          id: "pcom-1",
          author: "Sanne Postma",
          body: "Sterke profiel — drie jaar React op grote SaaS, eerder bij Booking.com gewerkt.",
          created_at: "2026-04-22T15:00:00Z",
        },
      ],
      client_feedback: null,
    },
    {
      id: "papp-2",
      candidate_id: "pcand-2",
      candidate_name: "Mark Jansen",
      candidate_email: "mark.jansen@example.com",
      candidate_phone: "+31 6 2222 3344",
      ai_score: 87,
      stage_name: "Technische assessment",
      pipeline_history: [
        { stage_name: "Sollicitatie ontvangen", entered_at: "2026-04-14T14:30:00Z" },
        { stage_name: "Screening", entered_at: "2026-04-17T09:00:00Z" },
        { stage_name: "Technische assessment", entered_at: "2026-04-23T13:00:00Z" },
      ],
      applied_at: "2026-04-14T14:30:00Z",
      skills: ["React", "Vue.js", "TypeScript", "Node.js"],
      resume_url: "/sample-cv.pdf",
      comments: [],
      client_feedback: null,
    },
    {
      id: "papp-3",
      candidate_id: "pcand-3",
      candidate_name: "Sofia El-Amrani",
      candidate_email: "sofia.ea@example.com",
      candidate_phone: null,
      ai_score: 78,
      stage_name: "Sollicitatie ontvangen",
      pipeline_history: [
        { stage_name: "Sollicitatie ontvangen", entered_at: "2026-04-18T09:15:00Z" },
      ],
      applied_at: "2026-04-18T09:15:00Z",
      skills: ["React", "Redux", "JavaScript", "CSS"],
      resume_url: "/sample-cv.pdf",
      comments: [],
      client_feedback: null,
    },
    {
      id: "papp-4",
      candidate_id: "pcand-4",
      candidate_name: "Thomas de Vries",
      candidate_email: "thomas.devries@example.com",
      candidate_phone: "+31 6 9988 7766",
      ai_score: 65,
      stage_name: "Sollicitatie ontvangen",
      pipeline_history: [
        { stage_name: "Sollicitatie ontvangen", entered_at: "2026-04-20T16:45:00Z" },
      ],
      applied_at: "2026-04-20T16:45:00Z",
      skills: ["Angular", "TypeScript", "RxJS"],
      resume_url: "/sample-cv.pdf",
      comments: [],
      client_feedback: null,
    },
    {
      id: "papp-5",
      candidate_id: "pcand-5",
      candidate_name: "Emma Visser",
      candidate_email: "emma.visser@example.com",
      candidate_phone: "+31 6 5544 3322",
      ai_score: 81,
      stage_name: "Screening",
      pipeline_history: [
        { stage_name: "Sollicitatie ontvangen", entered_at: "2026-04-21T10:00:00Z" },
        { stage_name: "Screening", entered_at: "2026-04-25T11:30:00Z" },
      ],
      applied_at: "2026-04-21T10:00:00Z",
      skills: ["React", "TypeScript", "Storybook", "Testing Library"],
      resume_url: "/sample-cv.pdf",
      comments: [],
      client_feedback: null,
    },
  ],
  expires_at: "2026-06-30T23:59:59Z",
};

// ─────────────────────────────────────────────────────────────────────────────
// Admin-side portal-link management (Sprint Q2.1 — Agent GG)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 8 fijnmazige rechten die een recruiter per klant-portaal kan toekennen.
 * Deze keys matchen 1-op-1 met FF's `MockPortalAccess.permissions` zodat
 * een toggle in admin direct doorwerkt op wat de klant kan in de portal.
 */
export interface AdminPortalLinkPermissions {
  /** Mag de kandidatenlijst überhaupt zien */
  view_candidates: boolean;
  /** Mag CV's bekijken/downloaden */
  view_resumes: boolean;
  /** Mag AI-matchscore zien */
  view_ai_scores: boolean;
  /** Mag e-mail/telefoon van kandidaten zien */
  view_contact_info: boolean;
  /** Mag goedkeuren/afwijzen */
  accept_reject: boolean;
  /** Mag opmerkingen plaatsen */
  comment: boolean;
  /** Mag CV als bestand downloaden */
  download_cv: boolean;
  /** Mag de pipeline-historie van een kandidaat zien */
  view_pipeline_history: boolean;
}

export type PortalNotificationFrequency =
  | "instant"
  | "daily"
  | "weekly"
  | "off";

export type PortalCustomDomainStatus =
  | "none"
  | "pending"
  | "verified"
  | "failed";

export interface AdminPortalBranding {
  primary_color?: string;
  logo_url?: string | null;
}

export interface AdminPortalLink {
  id: string;
  job_id: string;
  job_title?: string;
  token: string;
  client_name: string | null;
  permissions: AdminPortalLinkPermissions;
  notification_email: string | null;
  notification_frequency: PortalNotificationFrequency;
  custom_domain: string | null;
  custom_domain_status: PortalCustomDomainStatus;
  custom_domain_txt_record: string | null;
  branding: AdminPortalBranding | null;
  expires_at: string | null;
  is_active: boolean;
  view_count: number;
  last_viewed_at: string | null;
  last_activity_at: string | null;
  created_at: string;
}

export type PortalActivityActionType =
  | "viewed_portal"
  | "viewed_candidate"
  | "approved_candidate"
  | "rejected_candidate"
  | "commented"
  | "rated_candidate"
  | "downloaded_cv"
  | "scheduled_interview";

export interface PortalActivityEvent {
  id: string;
  portal_link_id: string;
  action_type: PortalActivityActionType;
  candidate_id?: string;
  candidate_name?: string;
  actor_name?: string;
  metadata?: Record<string, string | number | boolean | null>;
  created_at: string;
}

const _fullPerms: AdminPortalLinkPermissions = {
  view_candidates: true,
  view_resumes: true,
  view_ai_scores: true,
  view_contact_info: true,
  accept_reject: true,
  comment: true,
  download_cv: true,
  view_pipeline_history: true,
};

export const mockPortalLinks: AdminPortalLink[] = [
  {
    id: "portal-1",
    job_id: "job-1",
    job_title: "Senior Frontend Developer",
    token: "tk_demo_a1b2c3d4e5f6g7h8",
    client_name: "Acme Corporation",
    permissions: { ..._fullPerms },
    notification_email: "hr@acmecorp.com",
    notification_frequency: "daily",
    custom_domain: "talent.acmecorp.com",
    custom_domain_status: "verified",
    custom_domain_txt_record: "talentflow-verify=ac7f3e21b9c4",
    branding: { primary_color: "#dc2626", logo_url: null },
    expires_at: "2026-06-30T23:59:59Z",
    is_active: true,
    view_count: 28,
    last_viewed_at: "2026-05-05T14:30:00Z",
    last_activity_at: "2026-05-05T14:32:11Z",
    created_at: "2026-04-10T09:00:00Z",
  },
  {
    id: "portal-2",
    job_id: "job-2",
    job_title: "Product Manager",
    token: "tk_demo_x9y8z7w6v5u4t3s2",
    client_name: "TechStart B.V.",
    permissions: {
      view_candidates: true,
      view_resumes: true,
      view_ai_scores: false,
      view_contact_info: false,
      accept_reject: false,
      comment: true,
      download_cv: false,
      view_pipeline_history: false,
    },
    notification_email: "ceo@techstart.nl",
    notification_frequency: "weekly",
    custom_domain: null,
    custom_domain_status: "none",
    custom_domain_txt_record: null,
    branding: null,
    expires_at: null,
    is_active: true,
    view_count: 4,
    last_viewed_at: "2026-04-30T11:15:00Z",
    last_activity_at: "2026-04-30T11:15:00Z",
    created_at: "2026-04-15T13:00:00Z",
  },
  {
    id: "portal-3",
    job_id: "job-1",
    job_title: "Senior Frontend Developer",
    token: "tk_demo_q1w2e3r4t5y6u7i8",
    client_name: "Innovate Group",
    permissions: {
      view_candidates: true,
      view_resumes: true,
      view_ai_scores: true,
      view_contact_info: true,
      accept_reject: true,
      comment: false,
      download_cv: true,
      view_pipeline_history: true,
    },
    notification_email: null,
    notification_frequency: "off",
    custom_domain: null,
    custom_domain_status: "none",
    custom_domain_txt_record: null,
    branding: null,
    expires_at: "2026-04-15T23:59:59Z",
    is_active: false,
    view_count: 0,
    last_viewed_at: null,
    last_activity_at: null,
    created_at: "2026-03-22T08:30:00Z",
  },
];

export const mockPortalActivity: Record<string, PortalActivityEvent[]> = {
  "portal-1": [
    { id: "pa-1", portal_link_id: "portal-1", action_type: "viewed_portal", actor_name: "Acme Corporation", created_at: "2026-05-05T14:30:00Z" },
    { id: "pa-2", portal_link_id: "portal-1", action_type: "viewed_candidate", candidate_id: "app-1", candidate_name: "Lisa van der Berg", created_at: "2026-05-05T14:31:18Z" },
    { id: "pa-3", portal_link_id: "portal-1", action_type: "rated_candidate", candidate_id: "app-1", candidate_name: "Lisa van der Berg", metadata: { rating: 5 }, created_at: "2026-05-05T14:32:11Z" },
    { id: "pa-4", portal_link_id: "portal-1", action_type: "approved_candidate", candidate_id: "app-1", candidate_name: "Lisa van der Berg", created_at: "2026-05-05T14:32:35Z" },
    { id: "pa-5", portal_link_id: "portal-1", action_type: "commented", candidate_id: "app-1", candidate_name: "Lisa van der Berg", metadata: { comment: "Sterk profiel, graag uitnodigen voor onsite." }, created_at: "2026-05-05T14:33:02Z" },
    { id: "pa-6", portal_link_id: "portal-1", action_type: "viewed_candidate", candidate_id: "app-2", candidate_name: "Mark Jansen", created_at: "2026-05-04T10:12:00Z" },
    { id: "pa-7", portal_link_id: "portal-1", action_type: "downloaded_cv", candidate_id: "app-2", candidate_name: "Mark Jansen", created_at: "2026-05-04T10:13:42Z" },
    { id: "pa-8", portal_link_id: "portal-1", action_type: "rated_candidate", candidate_id: "app-2", candidate_name: "Mark Jansen", metadata: { rating: 4 }, created_at: "2026-05-04T10:14:55Z" },
    { id: "pa-9", portal_link_id: "portal-1", action_type: "scheduled_interview", candidate_id: "app-2", candidate_name: "Mark Jansen", metadata: { slot: "2026-05-12T14:00:00Z" }, created_at: "2026-05-04T10:15:30Z" },
    { id: "pa-10", portal_link_id: "portal-1", action_type: "viewed_portal", actor_name: "Acme Corporation", created_at: "2026-05-03T09:00:00Z" },
    { id: "pa-11", portal_link_id: "portal-1", action_type: "viewed_candidate", candidate_id: "app-3", candidate_name: "Sofia El-Amrani", created_at: "2026-05-03T09:02:11Z" },
    { id: "pa-12", portal_link_id: "portal-1", action_type: "rejected_candidate", candidate_id: "app-3", candidate_name: "Sofia El-Amrani", metadata: { reason: "Niveau ervaring niet voldoende" }, created_at: "2026-05-03T09:03:48Z" },
    { id: "pa-13", portal_link_id: "portal-1", action_type: "commented", candidate_id: "app-3", candidate_name: "Sofia El-Amrani", metadata: { comment: "Mooi profiel maar onvoldoende senior." }, created_at: "2026-05-03T09:04:30Z" },
    { id: "pa-14", portal_link_id: "portal-1", action_type: "viewed_candidate", candidate_id: "app-4", candidate_name: "Thomas de Vries", created_at: "2026-05-02T16:20:00Z" },
    { id: "pa-15", portal_link_id: "portal-1", action_type: "rated_candidate", candidate_id: "app-4", candidate_name: "Thomas de Vries", metadata: { rating: 2 }, created_at: "2026-05-02T16:21:30Z" },
    { id: "pa-16", portal_link_id: "portal-1", action_type: "rejected_candidate", candidate_id: "app-4", candidate_name: "Thomas de Vries", created_at: "2026-05-02T16:22:00Z" },
    { id: "pa-17", portal_link_id: "portal-1", action_type: "viewed_portal", actor_name: "Acme Corporation", created_at: "2026-04-28T11:00:00Z" },
    { id: "pa-18", portal_link_id: "portal-1", action_type: "downloaded_cv", candidate_id: "app-1", candidate_name: "Lisa van der Berg", created_at: "2026-04-28T11:02:18Z" },
    { id: "pa-19", portal_link_id: "portal-1", action_type: "commented", candidate_id: "app-1", candidate_name: "Lisa van der Berg", metadata: { comment: "Klopt het CV met de Github-projecten?" }, created_at: "2026-04-28T11:05:11Z" },
    { id: "pa-20", portal_link_id: "portal-1", action_type: "viewed_portal", actor_name: "Acme Corporation", created_at: "2026-04-25T08:30:00Z" },
  ],
  "portal-2": [
    { id: "pb-1", portal_link_id: "portal-2", action_type: "viewed_portal", actor_name: "TechStart B.V.", created_at: "2026-04-30T11:15:00Z" },
    { id: "pb-2", portal_link_id: "portal-2", action_type: "rated_candidate", candidate_id: "app-1", candidate_name: "Lisa van der Berg", metadata: { rating: 4 }, created_at: "2026-04-30T11:16:25Z" },
  ],
  "portal-3": [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Tenant branding (white-label) — Sprint Q2.1
// ─────────────────────────────────────────────────────────────────────────────

export interface TenantBranding {
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  accent_color: string;
  brand_name_override: string | null;
  email_footer_html: string;
}

export const mockTenantBranding: TenantBranding = {
  logo_url: null,
  favicon_url: null,
  primary_color: "#6366f1",
  accent_color: "#a855f7",
  brand_name_override: null,
  email_footer_html:
    '<p style="font-size:12px;color:#6b7280;margin-top:16px;">Met vriendelijke groet,<br/>Het recruitment-team<br/><a href="https://example.com" style="color:#6366f1;">www.example.com</a></p>',
};

// ─────────────────────────────────────────────────────────────────────────────
// Self-service portaal voor kandidaten — Sprint Q2.3 (AVG art. 15-17)
// ─────────────────────────────────────────────────────────────────────────────

export interface SelfServiceCandidate {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  current_position: string | null;
  current_company: string | null;
  created_at: string;
  updated_at: string;
}

export interface SelfServiceApplication {
  id: string;
  job_id: string;
  job_title: string;
  status:
    | "active"
    | "in_review"
    | "interviewing"
    | "offer"
    | "hired"
    | "rejected"
    | "withdrawn";
  current_stage: string | null;
  applied_at: string;
  withdrawn_at: string | null;
}

export interface SelfServiceCommunication {
  id: string;
  channel: "email" | "whatsapp" | "sms";
  direction: "inbound" | "outbound";
  subject: string | null;
  summary: string;
  sent_at: string;
}

export interface SelfServiceConsent {
  type: "gdpr" | "email";
  granted: boolean;
  granted_at: string | null;
  revoked_at: string | null;
  source: string | null;
}

export interface SelfServiceRetention {
  policy_name: string;
  delete_at: string | null;
  days_remaining: number | null;
}

export interface SelfServiceDeletionRequest {
  dsar_id: string;
  status: "pending" | "processing" | "completed" | "rejected";
  requested_at: string;
  deadline: string;
}

export interface SelfServiceTenant {
  name: string;
  privacy_email: string | null;
}

export interface SelfServiceData {
  candidate: SelfServiceCandidate;
  applications: SelfServiceApplication[];
  communications: SelfServiceCommunication[];
  consents: SelfServiceConsent[];
  retention: SelfServiceRetention;
  deletion_request: SelfServiceDeletionRequest | null;
  tenant: SelfServiceTenant;
}

/** Vaste mock-token zodat developers /profile/mock-self-token kunnen openen. */
export const MOCK_SELF_SERVICE_TOKEN = "mock-self-token";

export const MOCK_SELF_SERVICE_DATA: SelfServiceData = {
  candidate: {
    id: "cand-self-1",
    first_name: "Lisa",
    last_name: "van der Berg",
    email: "lisa.vdberg@example.com",
    phone: "+31 6 12345678",
    current_position: "Senior Frontend Developer",
    current_company: "TechCorp B.V.",
    created_at: "2025-11-12T09:30:00Z",
    updated_at: "2026-04-22T14:18:00Z",
  },
  applications: [
    {
      id: "app-self-1",
      job_id: "job-1",
      job_title: "Senior Frontend Developer",
      status: "interviewing",
      current_stage: "Tweede gesprek",
      applied_at: "2026-03-14T10:00:00Z",
      withdrawn_at: null,
    },
    {
      id: "app-self-2",
      job_id: "job-2",
      job_title: "React Developer",
      status: "rejected",
      current_stage: "Afgewezen",
      applied_at: "2025-12-04T16:22:00Z",
      withdrawn_at: null,
    },
    {
      id: "app-self-3",
      job_id: "job-3",
      job_title: "Lead Frontend Engineer",
      status: "active",
      current_stage: "CV-screening",
      applied_at: "2026-04-19T08:45:00Z",
      withdrawn_at: null,
    },
  ],
  communications: [
    {
      id: "comm-self-1",
      channel: "email",
      direction: "outbound",
      subject: "Uitnodiging tweede gesprek — Senior Frontend Developer",
      summary:
        "Hallo Lisa, leuk om je weer te ontmoeten. We willen je graag uitnodigen voor een tweede gesprek met de tech-lead.",
      sent_at: "2026-04-22T14:15:00Z",
    },
    {
      id: "comm-self-2",
      channel: "email",
      direction: "inbound",
      subject: "Re: Uitnodiging tweede gesprek",
      summary:
        "Bedankt voor de uitnodiging — donderdag 14:00 past goed in mijn agenda.",
      sent_at: "2026-04-22T16:42:00Z",
    },
    {
      id: "comm-self-3",
      channel: "email",
      direction: "outbound",
      subject: "Bevestiging sollicitatie — React Developer",
      summary:
        "Bedankt voor je sollicitatie. We laten zo snel mogelijk weten of er een match is.",
      sent_at: "2025-12-04T16:25:00Z",
    },
  ],
  consents: [
    {
      type: "gdpr",
      granted: true,
      granted_at: "2025-11-12T09:30:00Z",
      revoked_at: null,
      source: "career-page",
    },
    {
      type: "email",
      granted: true,
      granted_at: "2025-11-12T09:30:00Z",
      revoked_at: null,
      source: "career-page",
    },
  ],
  retention: {
    policy_name: "Standaard 24 maanden na laatste activiteit",
    delete_at: "2028-04-22T14:18:00Z",
    days_remaining: 730,
  },
  deletion_request: null,
  tenant: {
    name: "TalentFlow Demo Recruitment",
    privacy_email: "privacy@example.com",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// WORM audit-trail viewer — Sprint Q2.3 (Compliance platformlaag)
// ─────────────────────────────────────────────────────────────────────────────

export type AuditActionGroup =
  | "writes"
  | "ai"
  | "consent"
  | "communications"
  | "access"
  | "exports";

export interface AuditTrailEvent {
  id: string;
  /** ISO timestamp — WORM, write-once. */
  occurred_at: string;
  /** Stable action key, e.g. "candidate.update", "ai.match.score". */
  action: string;
  group: AuditActionGroup;
  /** Human-leesbare omschrijving (NL). */
  label: string;
  /** Wie de actie uitvoerde — kan "system" zijn voor automatic events. */
  actor_name: string;
  actor_role: string | null;
  /** entity-info — voor breadcrumb/header. */
  entity_type: "candidate" | "job" | "application";
  entity_id: string;
  entity_label: string;
  /** Optionele diff van velden — voor/na. Null voor read/AI-events. */
  diff: Array<{
    field: string;
    before: string | number | boolean | null;
    after: string | number | boolean | null;
  }> | null;
  /** Vrij metadata-blob voor non-write events. */
  metadata: Record<string, string | number | boolean | null> | null;
  /** WORM-zegel — hash van event voor tamper-detection. */
  worm_hash: string;
}

export const MOCK_AUDIT_TRAIL_EVENTS: AuditTrailEvent[] = [
  {
    id: "audit-1",
    occurred_at: "2026-05-04T09:14:22Z",
    action: "candidate.create",
    group: "writes",
    label: "Kandidaat aangemaakt",
    actor_name: "Sarah Jansen",
    actor_role: "recruiter",
    entity_type: "candidate",
    entity_id: "cand-self-1",
    entity_label: "Lisa van der Berg",
    diff: null,
    metadata: { source: "linkedin", import_batch: "batch-2026-05-04-a" },
    worm_hash: "0xa1f2b3c4d5e6f7a8b9c0",
  },
  {
    id: "audit-2",
    occurred_at: "2026-05-04T09:14:22Z",
    action: "consent.granted",
    group: "consent",
    label: "AVG-toestemming verleend",
    actor_name: "Lisa van der Berg",
    actor_role: "candidate",
    entity_type: "candidate",
    entity_id: "cand-self-1",
    entity_label: "Lisa van der Berg",
    diff: [
      { field: "gdpr_consent", before: false, after: true },
      { field: "gdpr_consent_at", before: null, after: "2026-05-04T09:14:22Z" },
    ],
    metadata: { source: "career-page", ip_hash: "sha256:9f8a2b…" },
    worm_hash: "0xb2e3f4d5c6b7a8d9e0f1",
  },
  {
    id: "audit-3",
    occurred_at: "2026-05-04T09:15:11Z",
    action: "ai.match.score",
    group: "ai",
    label: "AI-matchscore berekend",
    actor_name: "Claude (system)",
    actor_role: "system",
    entity_type: "candidate",
    entity_id: "cand-self-1",
    entity_label: "Lisa van der Berg",
    diff: null,
    metadata: {
      model: "claude-opus-4-7",
      job_id: "job-1",
      score: 87,
      explanation_snippet: "Sterke match op React + TypeScript + 7 jaar ervaring.",
    },
    worm_hash: "0xc3d4e5f6a7b8c9d0e1f2",
  },
  {
    id: "audit-4",
    occurred_at: "2026-05-08T11:42:08Z",
    action: "candidate.update",
    group: "writes",
    label: "Profiel-velden gewijzigd",
    actor_name: "Sarah Jansen",
    actor_role: "recruiter",
    entity_type: "candidate",
    entity_id: "cand-self-1",
    entity_label: "Lisa van der Berg",
    diff: [
      { field: "current_position", before: "Frontend Developer", after: "Senior Frontend Developer" },
      { field: "phone", before: null, after: "+31 6 12345678" },
    ],
    metadata: null,
    worm_hash: "0xd4e5f6a7b8c9d0e1f2a3",
  },
  {
    id: "audit-5",
    occurred_at: "2026-05-12T14:08:55Z",
    action: "communication.email.sent",
    group: "communications",
    label: "E-mail verzonden",
    actor_name: "Sarah Jansen",
    actor_role: "recruiter",
    entity_type: "candidate",
    entity_id: "cand-self-1",
    entity_label: "Lisa van der Berg",
    diff: null,
    metadata: {
      subject: "Uitnodiging tweede gesprek",
      template_id: "tmpl-interview-2",
      delivered: true,
    },
    worm_hash: "0xe5f6a7b8c9d0e1f2a3b4",
  },
  {
    id: "audit-6",
    occurred_at: "2026-05-19T10:01:33Z",
    action: "candidate.export",
    group: "exports",
    label: "Profiel geëxporteerd naar PDF",
    actor_name: "Mark de Wit",
    actor_role: "hiring-manager",
    entity_type: "candidate",
    entity_id: "cand-self-1",
    entity_label: "Lisa van der Berg",
    diff: null,
    metadata: { format: "pdf", reason: "shortlist-review" },
    worm_hash: "0xf6a7b8c9d0e1f2a3b4c5",
  },
  {
    id: "audit-7",
    occurred_at: "2026-04-22T16:42:00Z",
    action: "communication.email.received",
    group: "communications",
    label: "E-mail ontvangen van kandidaat",
    actor_name: "Lisa van der Berg",
    actor_role: "candidate",
    entity_type: "candidate",
    entity_id: "cand-self-1",
    entity_label: "Lisa van der Berg",
    diff: null,
    metadata: { subject: "Re: Uitnodiging tweede gesprek" },
    worm_hash: "0xa7b8c9d0e1f2a3b4c5d6",
  },
  {
    id: "audit-8",
    occurred_at: "2026-04-19T08:45:00Z",
    action: "application.create",
    group: "writes",
    label: "Sollicitatie aangemaakt",
    actor_name: "Lisa van der Berg",
    actor_role: "candidate",
    entity_type: "candidate",
    entity_id: "cand-self-1",
    entity_label: "Lisa van der Berg",
    diff: null,
    metadata: { job_id: "job-3", job_title: "Lead Frontend Engineer" },
    worm_hash: "0xb8c9d0e1f2a3b4c5d6e7",
  },
  {
    id: "audit-9",
    occurred_at: "2026-03-14T10:00:00Z",
    action: "application.create",
    group: "writes",
    label: "Sollicitatie aangemaakt",
    actor_name: "Lisa van der Berg",
    actor_role: "candidate",
    entity_type: "candidate",
    entity_id: "cand-self-1",
    entity_label: "Lisa van der Berg",
    diff: null,
    metadata: { job_id: "job-1", job_title: "Senior Frontend Developer" },
    worm_hash: "0xc9d0e1f2a3b4c5d6e7f8",
  },
  {
    id: "audit-10",
    occurred_at: "2026-05-22T15:30:00Z",
    action: "candidate.access.viewed",
    group: "access",
    label: "Profiel bekeken door recruiter",
    actor_name: "Anna de Boer",
    actor_role: "recruiter",
    entity_type: "candidate",
    entity_id: "cand-self-1",
    entity_label: "Lisa van der Berg",
    diff: null,
    metadata: { context: "candidate-detail-page" },
    worm_hash: "0xd0e1f2a3b4c5d6e7f8a9",
  },
];

export const AUDIT_GROUP_LABELS: Record<AuditActionGroup, string> = {
  writes: "Wijzigingen",
  ai: "AI-acties",
  consent: "Toestemmingen",
  communications: "Communicatie",
  access: "Toegang & inzage",
  exports: "Exports",
};

// ─────────────────────────────────────────────────────────────────────────────
// Compliance / GDPR — Sprint Q2.3
// ─────────────────────────────────────────────────────────────────────────────

export type RetentionEntityType =
  | "candidate"
  | "rejected_candidate"
  | "application"
  | "communication";

export type RetentionTriggerField =
  | "last_activity_at"
  | "created_at"
  | "rejected_at";

export type RetentionAction = "archive" | "anonymize" | "delete";

export interface RetentionPolicy {
  id: string;
  tenant_id: string;
  entity_type: RetentionEntityType;
  retention_months: number;
  trigger_field: RetentionTriggerField;
  action_on_expiry: RetentionAction;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export type RetentionPolicyInput = Omit<
  RetentionPolicy,
  "id" | "tenant_id" | "created_at" | "updated_at"
>;

export const RETENTION_ENTITY_LABELS: Record<RetentionEntityType, string> = {
  candidate: "Kandidaten",
  rejected_candidate: "Afgewezen kandidaten",
  application: "Sollicitaties",
  communication: "Communicatie-berichten",
};

export const RETENTION_TRIGGER_LABELS: Record<RetentionTriggerField, string> = {
  last_activity_at: "Laatste activiteit",
  created_at: "Aanmaakdatum",
  rejected_at: "Afwijzingsdatum",
};

export const RETENTION_ACTION_LABELS: Record<RetentionAction, string> = {
  archive: "Archiveren",
  anonymize: "Anonimiseren",
  delete: "Permanent verwijderen",
};

export const mockRetentionPolicies: RetentionPolicy[] = [
  {
    id: "pol-1",
    tenant_id: "tenant-1",
    entity_type: "candidate",
    retention_months: 24,
    trigger_field: "last_activity_at",
    action_on_expiry: "anonymize",
    enabled: true,
    created_at: "2026-01-12T10:00:00Z",
    updated_at: "2026-03-04T09:30:00Z",
  },
  {
    id: "pol-2",
    tenant_id: "tenant-1",
    entity_type: "rejected_candidate",
    retention_months: 6,
    trigger_field: "rejected_at",
    action_on_expiry: "anonymize",
    enabled: true,
    created_at: "2026-01-12T10:05:00Z",
    updated_at: "2026-01-12T10:05:00Z",
  },
  {
    id: "pol-3",
    tenant_id: "tenant-1",
    entity_type: "communication",
    retention_months: 36,
    trigger_field: "created_at",
    action_on_expiry: "archive",
    enabled: false,
    created_at: "2026-02-20T08:00:00Z",
    updated_at: "2026-02-20T08:00:00Z",
  },
];

// ─── DSAR-requests (Data Subject Access Requests) ────────────────────────────

export type DsarStatus = "pending" | "in_progress" | "fulfilled" | "rejected";

export type DsarRequestType = "access" | "export" | "correction" | "deletion";

export interface DsarRequest {
  id: string;
  tenant_id: string;
  candidate_id: string | null;
  candidate_name: string | null;
  request_type: DsarRequestType;
  requester_email: string;
  status: DsarStatus;
  notes: string | null;
  fulfilled_at: string | null;
  export_url: string | null;
  due_at: string;
  created_at: string;
  updated_at: string;
}

export interface DsarRequestInput {
  candidate_id?: string | null;
  candidate_name?: string | null;
  request_type: DsarRequestType;
  requester_email: string;
  notes?: string | null;
}

export const DSAR_STATUS_LABELS: Record<DsarStatus, string> = {
  pending: "Open",
  in_progress: "In behandeling",
  fulfilled: "Vervuld",
  rejected: "Geweigerd",
};

export const DSAR_TYPE_LABELS: Record<DsarRequestType, string> = {
  access: "Inzage",
  export: "Export",
  correction: "Correctie",
  deletion: "Verwijdering",
};

const dsarDay = (offsetDays: number) => {
  const d = new Date("2026-05-07T09:00:00Z");
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString();
};

export const mockDsarRequests: DsarRequest[] = [
  {
    id: "dsar-1",
    tenant_id: "tenant-1",
    candidate_id: "cand-1",
    candidate_name: "Sophie van den Berg",
    request_type: "access",
    requester_email: "sophie.vdberg@gmail.com",
    status: "pending",
    notes: "Vraagt om volledig overzicht van opgeslagen gegevens.",
    fulfilled_at: null,
    export_url: null,
    due_at: dsarDay(2),
    created_at: dsarDay(-28),
    updated_at: dsarDay(-1),
  },
  {
    id: "dsar-2",
    tenant_id: "tenant-1",
    candidate_id: "cand-2",
    candidate_name: "Thomas Janssen",
    request_type: "export",
    requester_email: "t.janssen@hotmail.com",
    status: "in_progress",
    notes: "Export aangevraagd via self-service portaal.",
    fulfilled_at: null,
    export_url: null,
    due_at: dsarDay(5),
    created_at: dsarDay(-25),
    updated_at: dsarDay(-3),
  },
  {
    id: "dsar-3",
    tenant_id: "tenant-1",
    candidate_id: "cand-3",
    candidate_name: "Aisha El Hamdouchi",
    request_type: "deletion",
    requester_email: "aisha.elhamdouchi@outlook.com",
    status: "in_progress",
    notes: "Recht op vergetelheid. Goedkeuring DPO afwachten.",
    fulfilled_at: null,
    export_url: null,
    due_at: dsarDay(11),
    created_at: dsarDay(-19),
    updated_at: dsarDay(-2),
  },
  {
    id: "dsar-4",
    tenant_id: "tenant-1",
    candidate_id: "cand-4",
    candidate_name: "Lars Visser",
    request_type: "correction",
    requester_email: "lars.visser@gmail.com",
    status: "fulfilled",
    notes: "Telefoonnummer gecorrigeerd, e-mailbevestiging gestuurd.",
    fulfilled_at: dsarDay(-10),
    export_url: null,
    due_at: dsarDay(-5),
    created_at: dsarDay(-32),
    updated_at: dsarDay(-10),
  },
  {
    id: "dsar-5",
    tenant_id: "tenant-1",
    candidate_id: null,
    candidate_name: null,
    request_type: "access",
    requester_email: "anoniem.aanvrager@protonmail.com",
    status: "pending",
    notes:
      "Verzoeker is niet aan een kandidaat gekoppeld. Identiteitsverificatie vereist.",
    fulfilled_at: null,
    export_url: null,
    due_at: dsarDay(18),
    created_at: dsarDay(-12),
    updated_at: dsarDay(-12),
  },
];

// ─── Audit-events (WORM) ─────────────────────────────────────────────────────

export type AuditAction =
  | "consent.granted"
  | "consent.withdrawn"
  | "consent.requested"
  | "candidate.created"
  | "candidate.updated"
  | "candidate.anonymized"
  | "candidate.retention_excluded"
  | "dsar.created"
  | "dsar.updated"
  | "dsar.fulfilled"
  | "retention_policy.created"
  | "retention_policy.updated"
  | "retention_policy.deleted"
  | "user.login"
  | "user.logout"
  | "export.downloaded";

export interface AuditEvent {
  id: string;
  timestamp: string;
  action: AuditAction;
  entity_type: string;
  entity_id: string;
  actor_name: string | null;
  actor_email: string | null;
  ip_address: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  "consent.granted": "Toestemming verleend",
  "consent.withdrawn": "Toestemming ingetrokken",
  "consent.requested": "Toestemming opgevraagd",
  "candidate.created": "Kandidaat aangemaakt",
  "candidate.updated": "Kandidaat bijgewerkt",
  "candidate.anonymized": "Kandidaat geanonimiseerd",
  "candidate.retention_excluded": "Uitgesloten van retention",
  "dsar.created": "DSAR-verzoek aangemaakt",
  "dsar.updated": "DSAR-verzoek bijgewerkt",
  "dsar.fulfilled": "DSAR-verzoek vervuld",
  "retention_policy.created": "Bewaarbeleid aangemaakt",
  "retention_policy.updated": "Bewaarbeleid bijgewerkt",
  "retention_policy.deleted": "Bewaarbeleid verwijderd",
  "user.login": "Ingelogd",
  "user.logout": "Uitgelogd",
  "export.downloaded": "Export gedownload",
};

const ACTORS: Array<{ name: string; email: string; ip: string }> = [
  { name: "Kaan Duman", email: "kaan@talentflow.nl", ip: "10.0.0.5" },
  { name: "Lisa Vermeer", email: "lisa@talentflow.nl", ip: "10.0.0.7" },
  { name: "Sander Bakker", email: "sander@talentflow.nl", ip: "10.0.0.9" },
  { name: "System", email: "system@talentflow.nl", ip: "127.0.0.1" },
];

function generateAuditEvents(): AuditEvent[] {
  const actions: AuditAction[] = [
    "consent.granted",
    "consent.withdrawn",
    "consent.requested",
    "candidate.updated",
    "candidate.anonymized",
    "dsar.created",
    "dsar.fulfilled",
    "retention_policy.updated",
    "user.login",
    "export.downloaded",
  ];
  const entities: Array<{ type: string; ids: string[] }> = [
    { type: "candidate", ids: ["cand-1", "cand-2", "cand-3", "cand-4", "cand-5"] },
    { type: "dsar_request", ids: ["dsar-1", "dsar-2", "dsar-3", "dsar-4"] },
    { type: "retention_policy", ids: ["pol-1", "pol-2", "pol-3"] },
    { type: "user", ids: ["user-1", "user-2"] },
  ];
  const events: AuditEvent[] = [];
  const start = new Date("2026-05-07T08:00:00Z").getTime();
  for (let i = 0; i < 50; i++) {
    const action = actions[i % actions.length];
    const entityGroup =
      action.startsWith("dsar")
        ? entities[1]
        : action.startsWith("retention")
        ? entities[2]
        : action.startsWith("user")
        ? entities[3]
        : entities[0];
    const actor = ACTORS[i % ACTORS.length];
    const ts = new Date(start - i * 1000 * 60 * 60 * 3.7).toISOString();
    const eid = entityGroup.ids[i % entityGroup.ids.length];
    let before: Record<string, unknown> | null = null;
    let after: Record<string, unknown> | null = null;
    switch (action) {
      case "consent.granted":
        before = { gdpr_consent: false };
        after = { gdpr_consent: true, gdpr_consent_at: ts };
        break;
      case "consent.withdrawn":
        before = { gdpr_consent: true };
        after = { gdpr_consent: false, gdpr_consent_at: null };
        break;
      case "consent.requested":
        after = { channel: "email" };
        break;
      case "candidate.updated":
        before = { phone: "+31 6 11111111" };
        after = { phone: "+31 6 22222222" };
        break;
      case "candidate.anonymized":
        before = { name: "(verborgen)", email: "(verborgen)" };
        after = { name: "Geanonimiseerd", email: null };
        break;
      case "dsar.created":
        after = { request_type: "access", status: "pending" };
        break;
      case "dsar.fulfilled":
        before = { status: "in_progress" };
        after = { status: "fulfilled", fulfilled_at: ts };
        break;
      case "retention_policy.updated":
        before = { retention_months: 18 };
        after = { retention_months: 24 };
        break;
      case "user.login":
        after = { method: "password", success: true };
        break;
      case "export.downloaded":
        after = { format: "zip", size_bytes: 412300 };
        break;
    }
    events.push({
      id: `audit-${i + 1}`,
      timestamp: ts,
      action,
      entity_type: entityGroup.type,
      entity_id: eid,
      actor_name: actor.name,
      actor_email: actor.email,
      ip_address: actor.ip,
      before,
      after,
    });
  }
  return events;
}

export const mockAuditEvents: AuditEvent[] = generateAuditEvents();

// ─── Mailbox integrations (Gmail / Outlook OAuth) ────────────────────────────

export type MailboxProvider = "gmail" | "outlook";

export interface MailboxIntegration {
  id: string;
  tenant_id: string;
  user_id: string;
  provider: MailboxProvider;
  account_email: string;
  account_name: string | null;
  /** ISO timestamp of the last successful sync */
  last_sync_at: string | null;
  /** Total emails synced via this mailbox in the last 24h */
  emails_synced_24h: number;
  active: boolean;
  scopes: string[];
  created_at: string;
}

export const mockMailboxIntegrations: MailboxIntegration[] = [
  {
    id: "mbx-1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    provider: "gmail",
    account_email: "recruiter@itproposal.com",
    account_name: "Angelo de Vries",
    last_sync_at: "2026-05-07T08:14:00Z",
    emails_synced_24h: 23,
    active: true,
    scopes: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
    created_at: "2026-04-12T10:00:00Z",
  },
];

// ─── Bulk e-mail campaigns ───────────────────────────────────────────────────

export type BulkCampaignStatus =
  | "draft"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "paused";

export type BulkCampaignProvider = "resend" | "gmail" | "outlook";

export interface BulkCampaignFailure {
  candidate_id: string;
  candidate_name: string;
  email: string | null;
  reason: string;
  failed_at: string;
}

export interface BulkCampaignAudience {
  /** Optional explicit candidate IDs — overrules filter when set. */
  candidate_ids?: string[];
  status?: ("active" | "inactive" | "hired" | "rejected")[];
  source?: string[];
  tags?: string[];
  last_activity_from?: string | null;
  last_activity_to?: string | null;
  /** Always enforced server-side; surfaced for transparency in UI. */
  has_email_consent: true;
}

export interface BulkCampaignInput {
  name: string;
  subject: string;
  body_html: string;
  template_id?: string | null;
  provider: BulkCampaignProvider;
  /** Required when provider !== "resend" */
  mailbox_integration_id?: string | null;
  audience: BulkCampaignAudience;
}

export interface BulkCampaign {
  id: string;
  tenant_id: string;
  name: string;
  subject: string;
  body_html: string;
  template_id: string | null;
  provider: BulkCampaignProvider;
  mailbox_integration_id: string | null;
  status: BulkCampaignStatus;
  /** Total candidates that matched the audience filter */
  eligible_count: number;
  /** Skipped because they had no consent or no email address */
  skipped_count: number;
  /** Successfully sent so far */
  sent_count: number;
  /** Permanently failed sends */
  failed_count: number;
  audience: BulkCampaignAudience;
  failures: BulkCampaignFailure[];
  created_by: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export const mockBulkCampaigns: BulkCampaign[] = [
  {
    id: "camp-1",
    tenant_id: "tenant-1",
    name: "Lente-update senior frontend",
    subject: "Nieuwe rol bij {{tenant.name}} — wellicht iets voor jou?",
    body_html:
      "<p>Hi {{candidate.first_name}},</p><p>We hebben een nieuwe senior frontend-rol open. Heb je interesse om kennis te maken?</p><p>Groet,<br/>{{recruiter.name}}</p>",
    template_id: null,
    provider: "resend",
    mailbox_integration_id: null,
    status: "running",
    eligible_count: 145,
    skipped_count: 12,
    sent_count: 87,
    failed_count: 2,
    audience: {
      tags: ["senior", "remote-ok"],
      status: ["active"],
      has_email_consent: true,
    },
    failures: [
      {
        candidate_id: "cand-2",
        candidate_name: "Thomas Janssen",
        email: "t.janssen@hotmail.com",
        reason: "Bounce — mailbox vol",
        failed_at: "2026-05-07T07:42:00Z",
      },
      {
        candidate_id: "cand-9",
        candidate_name: "Onbekende Kandidaat",
        email: "obscure@example.com",
        reason: "Rate-limited door provider",
        failed_at: "2026-05-07T07:55:00Z",
      },
    ],
    created_by: "user-1",
    created_at: "2026-05-07T07:00:00Z",
    started_at: "2026-05-07T07:05:00Z",
    completed_at: null,
  },
  {
    id: "camp-2",
    tenant_id: "tenant-1",
    name: "Re-engagement Q1 dropouts",
    subject: "We willen graag opnieuw met je in gesprek",
    body_html:
      "<p>Hi {{candidate.first_name}},</p><p>We zagen dat je eerder hebt gesolliciteerd. Er zijn nieuwe rollen die wellicht passen.</p>",
    template_id: null,
    provider: "gmail",
    mailbox_integration_id: "mbx-1",
    status: "completed",
    eligible_count: 62,
    skipped_count: 4,
    sent_count: 62,
    failed_count: 0,
    audience: {
      status: ["inactive"],
      has_email_consent: true,
    },
    failures: [],
    created_by: "user-1",
    created_at: "2026-04-22T09:00:00Z",
    started_at: "2026-04-22T09:02:00Z",
    completed_at: "2026-04-22T15:48:00Z",
  },
  {
    id: "camp-3",
    tenant_id: "tenant-1",
    name: "Data engineers — externe lijst",
    subject: "Vacature data engineer bij {{tenant.name}}",
    body_html: "<p>Hallo {{candidate.first_name}},</p><p>...</p>",
    template_id: null,
    provider: "outlook",
    mailbox_integration_id: "mbx-2",
    status: "failed",
    eligible_count: 38,
    skipped_count: 0,
    sent_count: 4,
    failed_count: 34,
    audience: {
      tags: ["data-engineer"],
      has_email_consent: true,
    },
    failures: [
      {
        candidate_id: "cand-x",
        candidate_name: "Niet beschikbaar",
        email: null,
        reason:
          "OAuth-token verlopen — herverbind je Outlook-account onder Integraties",
        failed_at: "2026-04-30T11:30:00Z",
      },
    ],
    created_by: "user-1",
    created_at: "2026-04-30T11:00:00Z",
    started_at: "2026-04-30T11:02:00Z",
    completed_at: "2026-04-30T11:34:00Z",
  },
];

// ─── Sprint Q3.2 — JD-generator drafts ─────────────────────────────────────
//
// Two seeded drafts: one fresh (status=draft, 3 variants, no selection yet),
// and one already published (linked to job-1). The wizard reads/writes these
// via the `useJdGenerator` hooks and falls back to in-memory mutation when
// the backend is unreachable.

const JD_AI_DISCLOSURE =
  "Deze vacaturetekst is gegenereerd door AI op basis van jouw briefing. " +
  "De recruiter behoudt het finale oordeel en kan elke variant bewerken " +
  "vóór publicatie.";

const JD_DRAFT_INPUT_FE: JdGeneratorInput = {
  role: "Senior Frontend Developer",
  level: "senior",
  key_skills: ["React", "TypeScript", "Next.js", "Design systems"],
  must_haves: [
    "5+ jaar React-ervaring",
    "Gevorderd in TypeScript",
    "Werkt zelfstandig in een product-team",
  ],
  nice_to_haves: [
    "Ervaring met Next.js App Router",
    "Componentbibliotheek-onderhoud",
    "Web performance & a11y",
  ],
  tone: "direct",
  length: "medium",
  language: "NL",
  company_context:
    "TalentFlow is een EU-native recruitment SaaS met focus op compliance " +
    "en AI-transparantie. Klein product-team van 12, hybride vanuit Amsterdam.",
};

const JD_VARIANT_FE_DIRECT: JdVariant = {
  id: "var-fe-direct",
  title: "Senior Frontend Developer",
  description:
    "## Wat ga je doen?\n" +
    "Je bouwt mee aan TalentFlow's recruiter-platform: van pipeline-views tot " +
    "AI-uitleg-dialogen. Je werkt nauw samen met design en backend en hebt " +
    "eigenaarschap over het frontend-component-systeem.\n\n" +
    "## Wat verwachten we?\n" +
    "- 5+ jaar React + TypeScript in productie\n" +
    "- Ervaring met Next.js (bij voorkeur App Router)\n" +
    "- Goede balans tussen snelheid en codekwaliteit\n" +
    "- Communicatief sterk in een klein team\n\n" +
    "## Wat bieden wij?\n" +
    "- Marktconform salaris + aandelenoptie\n" +
    "- Hybride werken vanuit Amsterdam (2 dagen op kantoor)\n" +
    "- Volledige autonomie over je technische keuzes",
  bias_flags: [
    {
      type: "vague_requirement",
      label: "Vage vereiste",
      excerpt: "Communicatief sterk",
      suggestion:
        'Vervang door concreet criterium, bv. "kan een design-trade-off in 1 paragraaf onderbouwen".',
      severity: "low",
    },
  ],
  clarity_score: 82,
  inclusivity_score: 76,
  word_count: 118,
};

const JD_VARIANT_FE_ENTHUSIAST: JdVariant = {
  id: "var-fe-enthusiast",
  title: "Senior Frontend Developer — bouw mee aan AI-recruitment",
  description:
    "## Bouw het recruitment-platform van morgen\n" +
    "Bij TalentFlow ontwerpen we een product dat recruiters helpt sneller, " +
    "eerlijker en plezieriger te werken. Jouw frontend-werk wordt elke dag " +
    "gezien door honderden recruiters in heel Europa.\n\n" +
    "## Wat je bij ons doet\n" +
    "- Je bouwt features die direct impact hebben op honderden gebruikers\n" +
    "- Je werkt mee aan ons component-systeem en design-tokens\n" +
    "- Je breekt door samen met design en backend in dezelfde squad\n\n" +
    "## Wat we zoeken\n" +
    "- Diepe React + TypeScript-ervaring\n" +
    "- Affiniteit met productdenken — niet alleen pixels\n" +
    "- Plezier in mentoren en feedback geven\n\n" +
    "## Wat we bieden\n" +
    "- Salaris vanaf €75.000 + aandelen\n" +
    "- Hybride werken (Amsterdam, 2 dagen kantoor)\n" +
    "- Een team dat écht iets nieuws bouwt",
  bias_flags: [
    {
      type: "exclusive_language",
      label: "Mogelijk uitsluitende taal",
      excerpt: "diepe React + TypeScript-ervaring",
      suggestion:
        'Overweeg "ruime React- en TypeScript-ervaring" om bredere doelgroep aan te spreken.',
      severity: "low",
    },
  ],
  clarity_score: 78,
  inclusivity_score: 81,
  word_count: 142,
};

const JD_VARIANT_FE_FORMAL: JdVariant = {
  id: "var-fe-formal",
  title: "Senior Software Engineer — Frontend",
  description:
    "## Functieomschrijving\n" +
    "Als Senior Software Engineer — Frontend draagt u de eindverantwoordelijkheid " +
    "voor de implementatie en kwaliteit van de gebruikersinterface van TalentFlow. " +
    "U rapporteert aan de Engineering Manager en stuurt functioneel een team " +
    "van twee medior frontend-collega's aan.\n\n" +
    "## Vereiste kwalificaties\n" +
    "- Minimaal 5 jaar aantoonbare ervaring met React en TypeScript\n" +
    "- Bewezen ervaring met Next.js in een productieomgeving\n" +
    "- Ervaring met het opzetten en beheren van een componentbibliotheek\n" +
    "- HBO/WO werk- en denkniveau\n\n" +
    "## Arbeidsvoorwaarden\n" +
    "- Een marktconform salaris\n" +
    "- 27 vakantiedagen per jaar\n" +
    "- Hybride werkmodel (twee dagen per week op kantoor te Amsterdam)\n" +
    "- Pensioenregeling via Achmea",
  bias_flags: [
    {
      type: "exclusive_language",
      label: "Uitsluitende opleidingseis",
      excerpt: "HBO/WO werk- en denkniveau",
      suggestion:
        'Vervang door "kan abstractie en ontwerpkeuzes onderbouwen" — diploma-eisen sluiten gekwalificeerde autodidacten uit.',
      severity: "medium",
    },
    {
      type: "salary_undisclosed",
      label: "Geen concreet salaris",
      excerpt: "Een marktconform salaris",
      suggestion:
        "Geef een range op (bv. €70.000 — €85.000) — transparantie verhoogt response-rate met ~15%.",
      severity: "medium",
    },
    {
      type: "gender_coded",
      label: "Mogelijk masculien gecodeerd",
      excerpt: "draagt u de eindverantwoordelijkheid",
      suggestion: 'Overweeg "u bent eindverantwoordelijk voor".',
      severity: "low",
    },
  ],
  clarity_score: 71,
  inclusivity_score: 58,
  word_count: 134,
};

const JD_DRAFT_INPUT_PM: JdGeneratorInput = {
  role: "Product Manager",
  level: "medior",
  key_skills: ["Discovery", "Roadmapping", "Stakeholder-management"],
  must_haves: ["3+ jaar PM-ervaring in B2B SaaS"],
  nice_to_haves: ["Recruitment-domein", "Data-gedreven besluitvorming"],
  tone: "casual",
  length: "medium",
  language: "NL",
  company_context: "TalentFlow — EU-native recruitment SaaS, 12-mens product-team.",
};

const JD_VARIANT_PM_PUBLISHED: JdVariant = {
  id: "var-pm-published",
  title: "Product Manager",
  description:
    "## Wat je gaat doen\n" +
    "Als Product Manager bij TalentFlow vertaal je recruiter-pijn naar product-" +
    "richting. Je werkt nauw samen met design, engineering en customer success.\n\n" +
    "## Wat we zoeken\n" +
    "- 3+ jaar PM-ervaring in B2B SaaS\n" +
    "- Comfortabel met data en discovery-interviews\n" +
    "- Kan prioriteren onder druk\n\n" +
    "## Wat we bieden\n" +
    "- €65.000 — €80.000 afhankelijk van ervaring\n" +
    "- Hybride werken vanuit Amsterdam\n" +
    "- Direct impact op productrichting",
  bias_flags: [],
  clarity_score: 84,
  inclusivity_score: 79,
  word_count: 92,
};

export const mockJdDrafts: JdDraft[] = [
  {
    id: "jd-draft-1",
    tenant_id: "tenant-1",
    role: JD_DRAFT_INPUT_FE.role,
    input: JD_DRAFT_INPUT_FE,
    variants: [
      JD_VARIANT_FE_DIRECT,
      JD_VARIANT_FE_ENTHUSIAST,
      JD_VARIANT_FE_FORMAL,
    ],
    selected_variant_id: null,
    status: "draft",
    published_job_id: null,
    ai_disclosure: JD_AI_DISCLOSURE,
    created_at: "2026-05-06T10:30:00Z",
    updated_at: "2026-05-06T10:30:00Z",
  },
  {
    id: "jd-draft-2",
    tenant_id: "tenant-1",
    role: JD_DRAFT_INPUT_PM.role,
    input: JD_DRAFT_INPUT_PM,
    variants: [JD_VARIANT_PM_PUBLISHED],
    selected_variant_id: JD_VARIANT_PM_PUBLISHED.id,
    status: "published",
    published_job_id: "job-2",
    ai_disclosure: JD_AI_DISCLOSURE,
    created_at: "2026-04-28T14:00:00Z",
    updated_at: "2026-04-28T14:30:00Z",
  },
];

// ─── Sprint Q3.2 — Talent Reactivation alerts ──────────────────────────────

export const mockReactivationAlerts: TalentReactivationAlert[] = [
  {
    id: "react-1",
    tenant_id: "tenant-1",
    job_id: "job-1",
    job_title: "Senior Frontend Developer",
    candidate_id: "cand-1",
    candidate_name: "Sophie van den Berg",
    candidate_email: "sophie.vdberg@gmail.com",
    candidate_position: "Senior Frontend Engineer",
    score: 0.92,
    match_percent: 92,
    reasons: [
      {
        type: "near_miss_previous_round",
        label: "Bijna-match vorige ronde",
        detail: "Eindronde Senior FE bij ACME — strandde op locatie",
      },
    ],
    ai_explanation:
      "Sophie scoorde 92% match, maar viel af door geografische voorkeur. Deze rol is hybride — overweeg her-engagement.",
    status: "new",
    acted_by_id: null,
    acted_by_name: null,
    acted_at: null,
    created_at: "2026-05-07T08:15:00Z",
  },
  {
    id: "react-2",
    tenant_id: "tenant-1",
    job_id: "job-1",
    job_title: "Senior Frontend Developer",
    candidate_id: "cand-3",
    candidate_name: "Aisha El Hamdouchi",
    candidate_email: "aisha.elhamdouchi@outlook.com",
    candidate_position: "Senior Product Manager",
    score: 0.78,
    match_percent: 78,
    reasons: [
      {
        type: "profile_updated",
        label: "Profiel bijgewerkt",
        detail: "CV-update 2 dagen geleden — Next.js toegevoegd",
      },
    ],
    ai_explanation:
      "Aisha heeft Next.js toegevoegd aan haar profiel — dat tilt haar match boven de drempel.",
    status: "new",
    acted_by_id: null,
    acted_by_name: null,
    acted_at: null,
    created_at: "2026-05-06T16:42:00Z",
  },
  {
    id: "react-3",
    tenant_id: "tenant-1",
    job_id: "job-1",
    job_title: "Senior Frontend Developer",
    candidate_id: "cand-5",
    candidate_name: "Maya Okonkwo",
    candidate_email: "maya.okonkwo@gmail.com",
    candidate_position: "UX/UI Designer",
    score: 0.74,
    match_percent: 74,
    reasons: [
      {
        type: "rejected_similar_role",
        label: "Eerder afgewezen voor vergelijkbare rol",
        detail: "Afgewezen 14 jan 2026 voor Frontend Designer @ Bolt",
      },
    ],
    ai_explanation:
      "Maya werd eerder afgewezen omdat React-ervaring ontbrak; haar profiel toont nu twee React-projecten.",
    status: "new",
    acted_by_id: null,
    acted_by_name: null,
    acted_at: null,
    created_at: "2026-05-06T11:05:00Z",
  },
  {
    id: "react-4",
    tenant_id: "tenant-1",
    job_id: "job-2",
    job_title: "Product Manager",
    candidate_id: "cand-3",
    candidate_name: "Aisha El Hamdouchi",
    candidate_email: "aisha.elhamdouchi@outlook.com",
    candidate_position: "Senior Product Manager",
    score: 0.88,
    match_percent: 88,
    reasons: [
      {
        type: "high_score_uncontacted",
        label: "Hoge score — nooit benaderd",
      },
    ],
    ai_explanation:
      "Sterke PM-ervaring in B2B SaaS sluit naadloos aan bij deze rol — kandidaat is nog nooit gecontacteerd voor PM-rollen.",
    status: "new",
    acted_by_id: null,
    acted_by_name: null,
    acted_at: null,
    created_at: "2026-05-05T09:30:00Z",
  },
  {
    id: "react-5",
    tenant_id: "tenant-1",
    job_id: "job-2",
    job_title: "Product Manager",
    candidate_id: "cand-2",
    candidate_name: "Thomas Janssen",
    candidate_email: "t.janssen@hotmail.com",
    candidate_position: "Data Engineer",
    score: 0.61,
    match_percent: 61,
    reasons: [
      {
        type: "dormant_strong_match",
        label: "Inactief — sterke match",
        detail: "Laatste contact 9 maanden geleden",
      },
    ],
    ai_explanation:
      "Thomas heeft data-PM-achtergrond uit eerdere rol — overweeg een snelle reactivatie-mail.",
    status: "new",
    acted_by_id: null,
    acted_by_name: null,
    acted_at: null,
    created_at: "2026-05-04T13:18:00Z",
  },
  {
    id: "react-6",
    tenant_id: "tenant-1",
    job_id: "job-2",
    job_title: "Product Manager",
    candidate_id: "cand-4",
    candidate_name: "Lars Visser",
    candidate_email: "lars.visser@gmail.com",
    candidate_position: "Junior Backend Developer",
    score: 0.54,
    match_percent: 54,
    reasons: [
      {
        type: "high_score_uncontacted",
        label: "Hoge score — nooit benaderd",
      },
    ],
    ai_explanation: null,
    status: "acknowledged",
    acted_by_id: "user-1",
    acted_by_name: "Emma Bakker",
    acted_at: "2026-05-03T15:00:00Z",
    created_at: "2026-05-03T08:00:00Z",
  },
  {
    id: "react-7",
    tenant_id: "tenant-1",
    job_id: "job-3",
    job_title: "Backend Engineer (Python)",
    candidate_id: "cand-2",
    candidate_name: "Thomas Janssen",
    candidate_email: "t.janssen@hotmail.com",
    candidate_position: "Data Engineer",
    score: 0.86,
    match_percent: 86,
    reasons: [
      {
        type: "near_miss_previous_round",
        label: "Bijna-match vorige ronde",
        detail: "2 jaar Python in vorige rol — eerder afgewezen op senioriteit",
      },
      {
        type: "profile_updated",
        label: "Profiel bijgewerkt",
        detail: "Nieuwe Django-certificering",
      },
    ],
    ai_explanation:
      "Thomas heeft net een Django-certificering toegevoegd — dat dekt de gap die bij vorige afwijzing genoemd werd.",
    status: "new",
    acted_by_id: null,
    acted_by_name: null,
    acted_at: null,
    created_at: "2026-05-07T07:45:00Z",
  },
  {
    id: "react-8",
    tenant_id: "tenant-1",
    job_id: "job-3",
    job_title: "Backend Engineer (Python)",
    candidate_id: "cand-1",
    candidate_name: "Sophie van den Berg",
    candidate_email: "sophie.vdberg@gmail.com",
    candidate_position: "Senior Frontend Engineer",
    score: 0.42,
    match_percent: 42,
    reasons: [
      {
        type: "high_score_uncontacted",
        label: "Mogelijke crossover",
      },
    ],
    ai_explanation: null,
    status: "dismissed",
    acted_by_id: "user-1",
    acted_by_name: "Emma Bakker",
    acted_at: "2026-05-02T10:00:00Z",
    created_at: "2026-05-02T09:00:00Z",
  },
];

export const mockReactivationStats: ReactivationStats = {
  unacknowledged: 6,
  this_week: 8,
};

// ─── Sprint Q3.4: Interview suite ────────────────────────────────────────────

import type {
  AgreementMatrix,
  AvailableSlot,
  Interview,
  InterviewKit,
  InterviewRecording,
  InterviewTranscript,
  UserAvailability,
} from "@/lib/types/interviews";

/**
 * Interview kits — three plausible templates that map naturally to the
 * existing mock-jobs (job-1 = senior FE, job-2 = PM, job-3 = backend).
 */
export const mockInterviewKits: InterviewKit[] = [
  {
    id: "kit-1",
    tenant_id: "tenant-1",
    name: "Senior FE Tech Interview",
    description:
      "60-minuten technisch interview voor senior frontend engineers. Focus op React-architectuur, performance en design systems.",
    job_id: "job-1",
    job_title: "Senior Frontend Developer",
    scorecard_template_id: "tmpl-sc-1",
    scorecard_template_name: "Default tech interview",
    questions: [
      {
        id: "q1-1",
        text: "Vertel over een complex React-component dat je hebt gebouwd. Wat maakte het complex?",
        category: "behavioral",
        suggested_followups: [
          "Hoe zou je het anders aanpakken nu?",
          "Welke trade-offs heb je gemaakt?",
        ],
        evaluation_criteria:
          "Diepgang in component-design, awareness van trade-offs, reflectievermogen.",
        expected_duration_minutes: 12,
        position: 1,
      },
      {
        id: "q1-2",
        text: "Hoe zou je een design-system opzetten dat door 30+ developers gebruikt wordt?",
        category: "technical",
        suggested_followups: [
          "Hoe houd je componenten consistent over teams?",
          "Welke tooling gebruik je voor versie-beheer?",
        ],
        evaluation_criteria:
          "System-design vaardigheid, governance-denken, ervaring met design tokens.",
        expected_duration_minutes: 15,
        position: 2,
      },
      {
        id: "q1-3",
        text: "Een Largest Contentful Paint van 4.5s — waar begin je?",
        category: "technical",
        suggested_followups: [
          "Welke metrics zou je nog meer bekijken?",
          "Hoe pak je dit op zonder de DX te verpesten?",
        ],
        evaluation_criteria:
          "Performance-intuïtie, kennis van Web Vitals, gestructureerde diagnose.",
        expected_duration_minutes: 12,
        position: 3,
      },
      {
        id: "q1-4",
        text: "Hoe ga je om met disagreements binnen je team over architecturale keuzes?",
        category: "behavioral",
        suggested_followups: [
          "Geef een recent voorbeeld",
          "Wat als de tech-lead het niet eens is met jou?",
        ],
        evaluation_criteria:
          "Communicatie, empathie, vermogen om consensus te bouwen.",
        expected_duration_minutes: 10,
        position: 4,
      },
      {
        id: "q1-5",
        text: "Welke vragen heb jij voor ons?",
        category: "experience",
        suggested_followups: [],
        evaluation_criteria:
          "Voorbereiding, oprechte interesse, kwaliteit van de vragen.",
        expected_duration_minutes: 8,
        position: 5,
      },
    ],
    created_at: "2026-04-01T09:00:00Z",
    updated_at: "2026-04-15T11:30:00Z",
  },
  {
    id: "kit-2",
    tenant_id: "tenant-1",
    name: "Cultural Fit",
    description:
      "45-minuten cultural-fit interview voor het laatste rondje. Generiek over rollen heen.",
    job_id: null,
    job_title: null,
    scorecard_template_id: "tmpl-sc-2",
    scorecard_template_name: "Cultural fit",
    questions: [
      {
        id: "q2-1",
        text: "Beschrijf de werkomgeving waarin jij het beste tot je recht komt.",
        category: "culture",
        suggested_followups: [
          "Wat zou een dealbreaker zijn?",
          "Hoe ga je om met ambiguïteit?",
        ],
        evaluation_criteria:
          "Self-awareness, alignment met onze remote-first cultuur.",
        expected_duration_minutes: 10,
        position: 1,
      },
      {
        id: "q2-2",
        text: "Wat is een keer dat je feedback ontving die moeilijk was om te horen?",
        category: "behavioral",
        suggested_followups: [
          "Hoe heb je het verwerkt?",
          "Wat heb je ervan geleerd?",
        ],
        evaluation_criteria:
          "Groei-mindset, omgang met kritiek, eigenaarschap.",
        expected_duration_minutes: 12,
        position: 2,
      },
      {
        id: "q2-3",
        text: "Vertel over een team-conflict dat je hebt opgelost (of meegemaakt).",
        category: "scenario",
        suggested_followups: [
          "Wat was jouw rol?",
          "Wat zou je achteraf anders doen?",
        ],
        evaluation_criteria:
          "Samenwerking, conflict-vaardigheid, EQ.",
        expected_duration_minutes: 12,
        position: 3,
      },
      {
        id: "q2-4",
        text: "Wat zoek je in een volgende rol dat je huidige niet biedt?",
        category: "experience",
        suggested_followups: [
          "Waarom nu?",
          "Wat is het sterkst — geld, groei, of impact?",
        ],
        evaluation_criteria:
          "Motivatie-fit, oprechtheid, lange-termijn alignment.",
        expected_duration_minutes: 8,
        position: 4,
      },
    ],
    created_at: "2026-03-15T10:00:00Z",
    updated_at: "2026-04-22T14:00:00Z",
  },
  {
    id: "kit-3",
    tenant_id: "tenant-1",
    name: "Director Interview",
    description:
      "30-minuten executive interview met de hiring manager. Sluitstuk voor leidinggevende rollen.",
    job_id: "job-2",
    job_title: "Product Manager",
    scorecard_template_id: null,
    scorecard_template_name: null,
    questions: [
      {
        id: "q3-1",
        text: "Wat is jouw 90-dagen plan in deze rol?",
        category: "scenario",
        suggested_followups: [
          "Wat doe je in week 1?",
          "Welke KPI's zou je willen zien?",
        ],
        evaluation_criteria:
          "Strategisch denken, structuur, ownership van uitkomsten.",
        expected_duration_minutes: 12,
        position: 1,
      },
      {
        id: "q3-2",
        text: "Welke metric zou je prioriteren als alle andere onbeschikbaar waren?",
        category: "scenario",
        suggested_followups: [
          "Waarom?",
          "Welke trade-offs accepteer je?",
        ],
        evaluation_criteria:
          "Helderheid van visie, focus, business-instinct.",
        expected_duration_minutes: 8,
        position: 2,
      },
      {
        id: "q3-3",
        text: "Hoe ga je om met een CEO die een feature wil pushen die niet in de roadmap past?",
        category: "scenario",
        suggested_followups: [
          "Geef een echt voorbeeld",
        ],
        evaluation_criteria:
          "Stakeholder-management, ruggegraat, framing-vaardigheid.",
        expected_duration_minutes: 10,
        position: 3,
      },
    ],
    created_at: "2026-04-10T08:00:00Z",
    updated_at: "2026-04-12T13:00:00Z",
  },
];

const _now = new Date("2026-05-07T09:00:00Z").getTime();
function _isoOffset(days: number, hours = 0): string {
  return new Date(_now + days * 86400_000 + hours * 3600_000).toISOString();
}

/**
 * Interviews — 8 stuks: 3 komend, 4 afgerond, 1 geannuleerd. Mappen op
 * bestaande mockApplications zodat de detail-pagina's directe data hebben.
 */
export const mockInterviews: Interview[] = [
  // ─── Komend (3) ──
  {
    id: "iv-1",
    tenant_id: "tenant-1",
    application_id: "app-1",
    candidate_id: "cand-1",
    candidate_name: "Sophie van den Berg",
    job_id: "job-1",
    job_title: "Senior Frontend Developer",
    scheduled_start: _isoOffset(2, 5), // 2 days from "now" + 5h
    scheduled_end: _isoOffset(2, 6),
    duration_minutes: 60,
    timezone: "Europe/Amsterdam",
    status: "scheduled",
    location_type: "google_meet",
    location_url: "https://meet.google.com/abc-defg-hij",
    location_address: null,
    participants: [
      {
        id: "p-1-1",
        user_id: "user-1",
        user_name: "Emma Bakker",
        user_email: "emma@talentflow.io",
        role: "interviewer",
        rsvp: "accepted",
      },
      {
        id: "p-1-2",
        user_id: "user-2",
        user_name: "Jan Peters",
        user_email: "jan@talentflow.io",
        role: "interviewer",
        rsvp: "pending",
      },
    ],
    kit_id: "kit-1",
    kit_name: "Senior FE Tech Interview",
    notes:
      "Eindgesprek met Emma en Jan. Focus op design-system ervaring en stakeholder-management.",
    has_recording: false,
    scorecard_count: 0,
    created_by_id: "user-1",
    created_by_name: "Emma Bakker",
    created_at: _isoOffset(-1),
    updated_at: _isoOffset(-1),
  },
  {
    id: "iv-2",
    tenant_id: "tenant-1",
    application_id: "app-3",
    candidate_id: "cand-5",
    candidate_name: "Maya Okonkwo",
    job_id: "job-1",
    job_title: "Senior Frontend Developer",
    scheduled_start: _isoOffset(4, 7),
    scheduled_end: _isoOffset(4, 7.75),
    duration_minutes: 45,
    timezone: "Europe/Amsterdam",
    status: "scheduled",
    location_type: "teams",
    location_url: "https://teams.microsoft.com/l/meetup-join/xyz",
    location_address: null,
    participants: [
      {
        id: "p-2-1",
        user_id: "user-3",
        user_name: "Lisa Smits",
        user_email: "lisa@talentflow.io",
        role: "interviewer",
        rsvp: "accepted",
      },
    ],
    kit_id: "kit-2",
    kit_name: "Cultural Fit",
    notes: null,
    has_recording: false,
    scorecard_count: 0,
    created_by_id: "user-3",
    created_by_name: "Lisa Smits",
    created_at: _isoOffset(-1),
    updated_at: _isoOffset(-1),
  },
  {
    id: "iv-3",
    tenant_id: "tenant-1",
    application_id: "app-5",
    candidate_id: "cand-3",
    candidate_name: "Aisha El Hamdouchi",
    job_id: "job-2",
    job_title: "Product Manager",
    scheduled_start: _isoOffset(7, 4),
    scheduled_end: _isoOffset(7, 4.5),
    duration_minutes: 30,
    timezone: "Europe/Amsterdam",
    status: "scheduled",
    location_type: "in_person",
    location_url: null,
    location_address: "Spaklerweg 79, 1099 BA Amsterdam — Vergaderzaal 'Mondriaan'",
    participants: [
      {
        id: "p-3-1",
        user_id: "user-1",
        user_name: "Emma Bakker",
        user_email: "emma@talentflow.io",
        role: "hiring_manager",
        rsvp: "accepted",
      },
      {
        id: "p-3-2",
        user_id: "user-2",
        user_name: "Jan Peters",
        user_email: "jan@talentflow.io",
        role: "interviewer",
        rsvp: "accepted",
      },
    ],
    kit_id: "kit-3",
    kit_name: "Director Interview",
    notes: "Final interview met de directeur Product. Cultural fit + 90-dagen plan.",
    has_recording: false,
    scorecard_count: 0,
    created_by_id: "user-1",
    created_by_name: "Emma Bakker",
    created_at: _isoOffset(-2),
    updated_at: _isoOffset(-2),
  },

  // ─── Afgerond (4) ──
  {
    id: "iv-4",
    tenant_id: "tenant-1",
    application_id: "app-1",
    candidate_id: "cand-1",
    candidate_name: "Sophie van den Berg",
    job_id: "job-1",
    job_title: "Senior Frontend Developer",
    scheduled_start: _isoOffset(-15, 4),
    scheduled_end: _isoOffset(-15, 5),
    duration_minutes: 60,
    timezone: "Europe/Amsterdam",
    status: "completed",
    location_type: "google_meet",
    location_url: "https://meet.google.com/old-abc-xyz",
    location_address: null,
    participants: [
      {
        id: "p-4-1",
        user_id: "user-2",
        user_name: "Mara Visser",
        user_email: "mara@talentflow.io",
        role: "interviewer",
        rsvp: "accepted",
      },
      {
        id: "p-4-2",
        user_id: "user-3",
        user_name: "Lisa Smits",
        user_email: "lisa@talentflow.io",
        role: "interviewer",
        rsvp: "accepted",
      },
      {
        id: "p-4-3",
        user_id: "user-4",
        user_name: "Daan de Jong",
        user_email: "daan@talentflow.io",
        role: "interviewer",
        rsvp: "accepted",
      },
    ],
    kit_id: "kit-1",
    kit_name: "Senior FE Tech Interview",
    notes: "Eerste technische ronde — alle 3 interviewers hebben scorecards ingeleverd.",
    has_recording: true,
    scorecard_count: 3,
    created_by_id: "user-1",
    created_by_name: "Emma Bakker",
    created_at: _isoOffset(-20),
    updated_at: _isoOffset(-15, 5),
  },
  {
    id: "iv-5",
    tenant_id: "tenant-1",
    application_id: "app-2",
    candidate_id: "cand-4",
    candidate_name: "Lars Visser",
    job_id: "job-1",
    job_title: "Senior Frontend Developer",
    scheduled_start: _isoOffset(-10, 3),
    scheduled_end: _isoOffset(-10, 3.75),
    duration_minutes: 45,
    timezone: "Europe/Amsterdam",
    status: "completed",
    location_type: "zoom",
    location_url: "https://zoom.us/j/1234567890",
    location_address: null,
    participants: [
      {
        id: "p-5-1",
        user_id: "user-1",
        user_name: "Emma Bakker",
        user_email: "emma@talentflow.io",
        role: "interviewer",
        rsvp: "accepted",
      },
    ],
    kit_id: "kit-2",
    kit_name: "Cultural Fit",
    notes: null,
    has_recording: false,
    scorecard_count: 1,
    created_by_id: "user-1",
    created_by_name: "Emma Bakker",
    created_at: _isoOffset(-15),
    updated_at: _isoOffset(-10, 3.75),
  },
  {
    id: "iv-6",
    tenant_id: "tenant-1",
    application_id: "app-4",
    candidate_id: "cand-2",
    candidate_name: "Thomas Janssen",
    job_id: "job-1",
    job_title: "Senior Frontend Developer",
    scheduled_start: _isoOffset(-7, 6),
    scheduled_end: _isoOffset(-7, 7),
    duration_minutes: 60,
    timezone: "Europe/Amsterdam",
    status: "completed",
    location_type: "google_meet",
    location_url: "https://meet.google.com/old-thomas",
    location_address: null,
    participants: [
      {
        id: "p-6-1",
        user_id: "user-2",
        user_name: "Jan Peters",
        user_email: "jan@talentflow.io",
        role: "interviewer",
        rsvp: "accepted",
      },
    ],
    kit_id: "kit-1",
    kit_name: "Senior FE Tech Interview",
    notes: "Technische screening — solide maar niet senior.",
    has_recording: true,
    scorecard_count: 1,
    created_by_id: "user-2",
    created_by_name: "Jan Peters",
    created_at: _isoOffset(-12),
    updated_at: _isoOffset(-7, 7),
  },
  {
    id: "iv-7",
    tenant_id: "tenant-1",
    application_id: "app-6",
    candidate_id: "cand-1",
    candidate_name: "Sophie van den Berg",
    job_id: "job-2",
    job_title: "Product Manager",
    scheduled_start: _isoOffset(-3, 4),
    scheduled_end: _isoOffset(-3, 4.5),
    duration_minutes: 30,
    timezone: "Europe/Amsterdam",
    status: "completed",
    location_type: "phone",
    location_url: null,
    location_address: "Telefonisch — +31 20 123 4567",
    participants: [
      {
        id: "p-7-1",
        user_id: "user-3",
        user_name: "Lisa Smits",
        user_email: "lisa@talentflow.io",
        role: "interviewer",
        rsvp: "accepted",
      },
    ],
    kit_id: null,
    kit_name: null,
    notes: "Korte intro — kandidaat is nog te oriënterend voor PM-rol.",
    has_recording: false,
    scorecard_count: 0,
    created_by_id: "user-1",
    created_by_name: "Emma Bakker",
    created_at: _isoOffset(-5),
    updated_at: _isoOffset(-3, 4.5),
  },

  // ─── Geannuleerd (1) ──
  {
    id: "iv-8",
    tenant_id: "tenant-1",
    application_id: "app-3",
    candidate_id: "cand-5",
    candidate_name: "Maya Okonkwo",
    job_id: "job-1",
    job_title: "Senior Frontend Developer",
    scheduled_start: _isoOffset(-2, 6),
    scheduled_end: _isoOffset(-2, 7),
    duration_minutes: 60,
    timezone: "Europe/Amsterdam",
    status: "cancelled",
    location_type: "google_meet",
    location_url: "https://meet.google.com/cancelled",
    location_address: null,
    participants: [
      {
        id: "p-8-1",
        user_id: "user-1",
        user_name: "Emma Bakker",
        user_email: "emma@talentflow.io",
        role: "interviewer",
        rsvp: "declined",
      },
    ],
    kit_id: "kit-1",
    kit_name: "Senior FE Tech Interview",
    notes: "Kandidaat heeft 2 uur tevoren afgezegd — herinplannen volgende week.",
    has_recording: false,
    scorecard_count: 0,
    created_by_id: "user-1",
    created_by_name: "Emma Bakker",
    created_at: _isoOffset(-7),
    updated_at: _isoOffset(-2, 4),
  },
];

/**
 * Recordings — alleen aanwezig voor de afgeronde interviews die bewijsbaar
 * zijn opgenomen (iv-4, iv-6).
 */
export const mockRecordings: Record<string, InterviewRecording[]> = {
  "iv-4": [
    {
      id: "rec-iv-4-1",
      interview_id: "iv-4",
      filename: "sophie-vdberg-tech-interview.m4a",
      size_bytes: 18_421_904,
      duration_seconds: 3598,
      storage_url: "https://storage.talentflow.io/recordings/rec-iv-4-1.m4a",
      consent_given: true,
      consent_given_at: _isoOffset(-15, 3.95),
      consent_given_by_id: "cand-1",
      uploaded_by_id: "user-2",
      uploaded_by_name: "Mara Visser",
      transcript_status: "done",
      created_at: _isoOffset(-15, 5.1),
    },
  ],
  "iv-6": [
    {
      id: "rec-iv-6-1",
      interview_id: "iv-6",
      filename: "thomas-janssen-screening.m4a",
      size_bytes: 14_892_771,
      duration_seconds: 3540,
      storage_url: "https://storage.talentflow.io/recordings/rec-iv-6-1.m4a",
      consent_given: true,
      consent_given_at: _isoOffset(-7, 5.95),
      consent_given_by_id: "cand-2",
      uploaded_by_id: "user-2",
      uploaded_by_name: "Jan Peters",
      transcript_status: "processing",
      created_at: _isoOffset(-7, 7.05),
    },
  ],
};

export const mockTranscripts: Record<string, InterviewTranscript> = {
  "rec-iv-4-1": {
    recording_id: "rec-iv-4-1",
    status: "done",
    full_text:
      "Mara: Welkom Sophie, fijn dat je er bent. Kunnen we beginnen met het bevestigen dat je akkoord bent met de opname?\n" +
      "Sophie: Ja, helemaal akkoord — ik heb ook in de e-mail al toestemming gegeven.\n" +
      "Mara: Top. Vertel me eens over een complex React-component dat je hebt gebouwd.\n" +
      "Sophie: Een paar maanden geleden bouwde ik een virtuele lijst met inline-editing voor 50.000+ rijen. De uitdaging zat in het combineren van keyboard-navigatie, optimistic updates en de virtualisatie zonder dat de UX hortend werd. Ik heb uiteindelijk een custom row-renderer gemaakt met een eigen focus-manager…\n" +
      "Lisa: Hoe heb je de testdekking voor zoiets aangepakt?\n" +
      "Sophie: We hebben unit-tests voor de focus-manager, snapshot-tests voor de rij-rendering en een Playwright-test die specifiek de toetsenbord-flow afgaat met 1000 rijen geseed.\n" +
      "Daan: Hoe zou je een design-system opzetten dat door 30+ developers gebruikt wordt?\n" +
      "Sophie: Ik zou starten met design-tokens, een strict-mode storybook met visual-regression, en een RFC-proces voor nieuwe primitives. Belangrijk: governance — niemand mergt direct in main zonder review van twee design-system maintainers.\n" +
      "Mara: Mooi. Hoe ga je om met disagreements over architecturale keuzes?\n" +
      "Sophie: Ik probeer altijd eerst te begrijpen welke beperking de andere persoon ziet die ik mis. Vaak gaat een meningsverschil over verschillende prioriteiten in plaats van technische merites…",
    utterances: [
      {
        speaker: "Mara Visser",
        speaker_user_id: "user-2",
        start_seconds: 0,
        end_seconds: 11,
        text:
          "Welkom Sophie, fijn dat je er bent. Kunnen we beginnen met het bevestigen dat je akkoord bent met de opname?",
      },
      {
        speaker: "Sophie van den Berg",
        speaker_user_id: "cand-1",
        start_seconds: 12,
        end_seconds: 19,
        text:
          "Ja, helemaal akkoord — ik heb ook in de e-mail al toestemming gegeven.",
      },
      {
        speaker: "Mara Visser",
        speaker_user_id: "user-2",
        start_seconds: 20,
        end_seconds: 31,
        text:
          "Top. Vertel me eens over een complex React-component dat je hebt gebouwd.",
      },
      {
        speaker: "Sophie van den Berg",
        speaker_user_id: "cand-1",
        start_seconds: 32,
        end_seconds: 124,
        text:
          "Een paar maanden geleden bouwde ik een virtuele lijst met inline-editing voor 50.000+ rijen. De uitdaging zat in het combineren van keyboard-navigatie, optimistic updates en de virtualisatie zonder dat de UX hortend werd.",
      },
      {
        speaker: "Lisa Smits",
        speaker_user_id: "user-3",
        start_seconds: 125,
        end_seconds: 138,
        text: "Hoe heb je de testdekking voor zoiets aangepakt?",
      },
      {
        speaker: "Sophie van den Berg",
        speaker_user_id: "cand-1",
        start_seconds: 139,
        end_seconds: 198,
        text:
          "We hebben unit-tests voor de focus-manager, snapshot-tests voor de rij-rendering en een Playwright-test die de toetsenbord-flow afgaat met 1000 rijen geseed.",
      },
      {
        speaker: "Daan de Jong",
        speaker_user_id: "user-4",
        start_seconds: 199,
        end_seconds: 215,
        text:
          "Hoe zou je een design-system opzetten dat door 30+ developers gebruikt wordt?",
      },
      {
        speaker: "Sophie van den Berg",
        speaker_user_id: "cand-1",
        start_seconds: 216,
        end_seconds: 320,
        text:
          "Ik zou starten met design-tokens, een strict-mode storybook met visual-regression, en een RFC-proces voor nieuwe primitives. Governance is essentieel.",
      },
    ],
    ai_summary:
      "Sophie demonstreert sterke senior-niveau frontend-architectuur met concrete, productieve voorbeelden (virtuele lijst, design-tokens, governance). Communicatie is helder en gestructureerd. Toont eigenaarschap, vraagt door op trade-offs en plaatst eigen werk in een teamcontext.",
    ai_strengths: [
      "Diepgaande React-architectuur — virtualisatie + focus-management op 50k+ rijen",
      "Sterke design-system intuïtie (tokens, RFC-proces, visual regression)",
      "Multi-laag teststrategie (unit, snapshot, e2e)",
      "Empathische conflicthantering — zoekt onderliggende prioriteiten",
    ],
    ai_concerns: [
      "Performance-budget niet expliciet besproken (Web Vitals werd kort aangestipt)",
      "Geen voorbeeld van directe mentoring/coaching gegeven",
    ],
    ai_recommendation: "strong_yes",
    language: "nl",
    finished_at: _isoOffset(-15, 5.4),
  },
};

/**
 * Agreement matrix — voor application app-1 (Sophie) hebben 3 interviewers
 * scorecards ingeleverd. Rijen = criteria, kolommen = interviewers.
 */
export const mockAgreementMatrix: Record<string, AgreementMatrix> = {
  "app-1": {
    application_id: "app-1",
    candidate_id: "cand-1",
    candidate_name: "Sophie van den Berg",
    job_id: "job-1",
    job_title: "Senior Frontend Developer",
    interviewers: [
      {
        user_id: "user-2",
        user_name: "Mara Visser",
        mean: 4.6,
        std_dev: 0.49,
        is_outlier: false,
        scorecard_id: "sc-1",
      },
      {
        user_id: "user-3",
        user_name: "Lisa Smits",
        mean: 4.0,
        std_dev: 0.63,
        is_outlier: false,
        scorecard_id: "sc-2",
      },
      {
        user_id: "user-4",
        user_name: "Daan de Jong",
        mean: 3.0,
        std_dev: 1.10,
        is_outlier: true,
        scorecard_id: "sc-3",
      },
    ],
    rows: [
      {
        criterion_key: "technical_skills",
        criterion_label: "Technische vaardigheden",
        cells: [
          { score: 5, outlier: false },
          { score: 4, outlier: false },
          { score: 2, outlier: true },
        ],
        average: 3.67,
        range: 3,
        consensus: "low",
      },
      {
        criterion_key: "system_design",
        criterion_label: "System design / architectuur",
        cells: [
          { score: 4, outlier: false },
          { score: 4, outlier: false },
          { score: 3, outlier: false },
        ],
        average: 3.67,
        range: 1,
        consensus: "moderate",
      },
      {
        criterion_key: "code_quality",
        criterion_label: "Code-kwaliteit",
        cells: [
          { score: 5, outlier: false },
          { score: 5, outlier: false },
          { score: 4, outlier: false },
        ],
        average: 4.67,
        range: 1,
        consensus: "strong",
      },
      {
        criterion_key: "communication",
        criterion_label: "Communicatie",
        cells: [
          { score: 4, outlier: false },
          { score: 3, outlier: false },
          { score: 3, outlier: false },
        ],
        average: 3.33,
        range: 1,
        consensus: "moderate",
      },
      {
        criterion_key: "ownership",
        criterion_label: "Ownership / autonomie",
        cells: [
          { score: 5, outlier: false },
          { score: 4, outlier: false },
          { score: 3, outlier: false },
        ],
        average: 4.0,
        range: 2,
        consensus: "moderate",
      },
    ],
    highest_range_criterion: "technical_skills",
    overall_consensus: "moderate",
  },
};

/**
 * Available slots — gegenereerd voor de Scheduler-dialog. We bouwen een
 * deterministische set: ma-vr 09:00, 10:00, 11:00, 13:00, 14:00, 15:00 UTC
 * voor de komende 14 dagen, met willekeurige availability per interviewer.
 */
function buildMockSlots(): AvailableSlot[] {
  const slots: AvailableSlot[] = [];
  const start = new Date("2026-05-08T00:00:00Z");
  const interviewers = ["user-1", "user-2", "user-3", "user-4"];
  for (let day = 0; day < 14; day++) {
    const date = new Date(start.getTime() + day * 86400_000);
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) continue; // skip weekends
    [9, 10, 11, 13, 14, 15].forEach((hour) => {
      const slotStart = new Date(date);
      slotStart.setUTCHours(hour, 0, 0, 0);
      const slotEnd = new Date(slotStart.getTime() + 60 * 60_000);
      // Pseudo-random subset: hash-based, deterministic.
      const seed = day * 100 + hour;
      const available = interviewers.filter(
        (_, i) => ((seed * (i + 7)) % 5) > 0
      );
      slots.push({
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        duration_minutes: 60,
        available_interviewer_ids: available,
      });
    });
  }
  return slots;
}

export const mockAvailableSlots: AvailableSlot[] = buildMockSlots();

export const mockUserAvailability: Record<string, UserAvailability> = {
  "user-1": {
    user_id: "user-1",
    user_name: "Emma Bakker",
    timezone: "Europe/Amsterdam",
    recurring_hours: [
      { weekday: "monday", start: "09:00", end: "12:00" },
      { weekday: "monday", start: "13:00", end: "17:00" },
      { weekday: "tuesday", start: "09:00", end: "12:00" },
      { weekday: "tuesday", start: "13:00", end: "17:00" },
      { weekday: "wednesday", start: "09:00", end: "12:00" },
      { weekday: "thursday", start: "09:00", end: "17:00" },
      { weekday: "friday", start: "09:00", end: "13:00" },
    ],
    overrides: [
      {
        date: "2026-05-15",
        available: false,
        reason: "Vakantie",
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Sprint Q4.2 — Enterprise security (SSO/2FA/RBAC/IP-allowlist/WORM-audit)
// ─────────────────────────────────────────────────────────────────────────────

import type {
  SamlConfig,
  ScimToken,
  TwoFactorStatus,
  Role,
  RoleAssignment,
  SecuritySettings,
  ExtAuditEvent,
  PermissionGrant,
} from "./types/security";

// ─── SSO/SAML — disabled Okta-voorbeeld ─────────────────────────────────────

export const mockSsoConfig: SamlConfig = {
  id: "sso-1",
  tenant_id: "tenant-1",
  enabled: false,
  provider: "okta",
  entry_point: "https://techrecruit.okta.com/app/talentflow/exk1abc.../sso/saml",
  issuer: "http://www.okta.com/exk1abcDEF",
  idp_cert:
    "-----BEGIN CERTIFICATE-----\n" +
    "MIIDpDCCAoygAwIBAgIGAYxJ7VJ5MA0GCSqGSIb3DQEBCwUAMIGSMQswCQYDVQQG\n" +
    "EwJVUzETMBEGA1UECAwKQ2FsaWZvcm5pYTEWMBQGA1UEBwwNU2FuIEZyYW5jaXNj\n" +
    "bzENMAsGA1UECgwET2t0YTEUMBIGA1UECwwLU1NPUHJvdmlkZXIxEzARBgNVBAMM\n" +
    "Cm15dGVuYW50LXgxHDAaBgkqhkiG9w0BCQEWDWluZm9Ab2t0YS5jb20wHhcNMjUw\n" +
    "...truncated...\n" +
    "-----END CERTIFICATE-----",
  attribute_mapping: {
    email: "user.email",
    first_name: "user.firstName",
    last_name: "user.lastName",
    groups: "user.groups",
  },
  auto_create_users: false,
  default_role_id: "role-recruiter",
  sp_entity_id: "https://app.talentflow.nl/sso/tenant-1",
  sp_acs_url: "https://app.talentflow.nl/api/sso/tenant-1/acs",
  sp_metadata_url: "https://app.talentflow.nl/api/sso/tenant-1/metadata.xml",
  created_at: "2026-04-12T09:00:00Z",
  updated_at: "2026-05-01T10:30:00Z",
};

export const mockScimToken: ScimToken = {
  id: "scim-1",
  tenant_id: "tenant-1",
  enabled: false,
  endpoint_url: "https://app.talentflow.nl/api/scim/v2",
  token_prefix: null,
  last_used_at: null,
  created_at: "2026-04-12T09:00:00Z",
};

// ─── 2FA-status — niet-ingeschakeld voor demo-gebruiker ─────────────────────

export const mock2faStatus: TwoFactorStatus = {
  enabled: false,
  enrolled_at: null,
  backup_codes_remaining: 0,
  required_by_policy: false,
  policy_grace_period_ends_at: null,
};

// ─── Roles ──────────────────────────────────────────────────────────────────

const FULL_PERMS: PermissionGrant[] = [
  { resource: "candidates", actions: ["read", "create", "update", "delete", "export", "manage"] },
  { resource: "jobs", actions: ["read", "create", "update", "delete", "manage"] },
  { resource: "applications", actions: ["read", "create", "update", "delete"] },
  { resource: "pipeline", actions: ["read", "update", "manage"] },
  { resource: "interviews", actions: ["read", "create", "update", "delete"] },
  { resource: "communications", actions: ["read", "create", "update"] },
  { resource: "reports", actions: ["read", "export"] },
  { resource: "analytics", actions: ["read"] },
  { resource: "billing", actions: ["read", "manage"] },
  { resource: "users", actions: ["read", "create", "update", "delete", "manage"] },
  { resource: "roles", actions: ["read", "create", "update", "delete", "manage"] },
  { resource: "settings", actions: ["read", "update", "manage"] },
  { resource: "audit", actions: ["read", "export"] },
  { resource: "integrations", actions: ["read", "create", "update", "delete", "manage"] },
];

export const mockRoles: Role[] = [
  {
    id: "role-admin",
    tenant_id: null,
    key: "admin",
    label: "Admin",
    description: "Volledige toegang — kan alles beheren in de tenant.",
    is_system: true,
    inherits_from_role_id: null,
    permissions: FULL_PERMS,
    user_count: 2,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
  {
    id: "role-recruiter",
    tenant_id: null,
    key: "recruiter",
    label: "Recruiter",
    description: "Standaard recruiter — kandidaten + vacatures + pipeline.",
    is_system: true,
    inherits_from_role_id: null,
    permissions: [
      { resource: "candidates", actions: ["read", "create", "update", "export"] },
      { resource: "jobs", actions: ["read", "create", "update"] },
      { resource: "applications", actions: ["read", "create", "update"] },
      { resource: "pipeline", actions: ["read", "update"] },
      { resource: "interviews", actions: ["read", "create", "update"] },
      { resource: "communications", actions: ["read", "create"] },
      { resource: "reports", actions: ["read"] },
      { resource: "analytics", actions: ["read"] },
    ],
    user_count: 14,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
  {
    id: "role-hiring-manager",
    tenant_id: null,
    key: "hiring_manager",
    label: "Hiring Manager",
    description: "Beoordeelt kandidaten op vacatures van eigen team.",
    is_system: true,
    inherits_from_role_id: null,
    permissions: [
      { resource: "candidates", actions: ["read"] },
      { resource: "jobs", actions: ["read", "update"] },
      { resource: "applications", actions: ["read", "update"] },
      { resource: "pipeline", actions: ["read"] },
      { resource: "interviews", actions: ["read", "create", "update"] },
    ],
    user_count: 6,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
  {
    id: "role-viewer",
    tenant_id: null,
    key: "viewer",
    label: "Bekijker",
    description: "Alleen-lezen toegang tot kandidaten + vacatures.",
    is_system: true,
    inherits_from_role_id: null,
    permissions: [
      { resource: "candidates", actions: ["read"] },
      { resource: "jobs", actions: ["read"] },
      { resource: "pipeline", actions: ["read"] },
    ],
    user_count: 3,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
  {
    id: "role-cust-1",
    tenant_id: "tenant-1",
    key: "billing_admin",
    label: "Billing-admin",
    description: "Beheert facturatie + abonnementen, geen recruitment-toegang.",
    is_system: false,
    inherits_from_role_id: null,
    permissions: [
      { resource: "billing", actions: ["read", "manage"] },
      { resource: "settings", actions: ["read"] },
    ],
    user_count: 1,
    created_at: "2026-03-15T11:20:00Z",
    updated_at: "2026-04-02T08:14:00Z",
  },
  {
    id: "role-cust-2",
    tenant_id: "tenant-1",
    key: "compliance_officer",
    label: "Compliance Officer",
    description: "Audit-log + DSAR + retention-beheer voor AVG-naleving.",
    is_system: false,
    inherits_from_role_id: "role-recruiter",
    permissions: [
      { resource: "audit", actions: ["read", "export"] },
      { resource: "settings", actions: ["read", "update"] },
    ],
    user_count: 1,
    created_at: "2026-03-20T09:30:00Z",
    updated_at: "2026-04-15T15:00:00Z",
  },
];

export const mockRoleAssignments: RoleAssignment[] = [
  {
    id: "ra-1",
    user_id: "user-1",
    user_name: "Emma Bakker",
    user_email: "emma@talentflow.io",
    role_id: "role-admin",
    role_label: "Admin",
    assigned_by: "system",
    assigned_at: "2025-01-01T00:00:00Z",
    expires_at: null,
  },
  {
    id: "ra-2",
    user_id: "user-2",
    user_name: "Jan Peters",
    user_email: "jan@talentflow.io",
    role_id: "role-recruiter",
    role_label: "Recruiter",
    assigned_by: "user-1",
    assigned_at: "2025-03-12T09:00:00Z",
    expires_at: null,
  },
  {
    id: "ra-3",
    user_id: "user-3",
    user_name: "Lisa Smits",
    user_email: "lisa@talentflow.io",
    role_id: "role-recruiter",
    role_label: "Recruiter",
    assigned_by: "user-1",
    assigned_at: "2025-04-04T11:00:00Z",
    expires_at: "2026-12-31T23:59:59Z",
  },
];

// ─── Security-settings ──────────────────────────────────────────────────────

export const mockSecuritySettings: SecuritySettings = {
  tenant_id: "tenant-1",
  ip_allowlist_enabled: false,
  ip_allowlist: [
    { cidr: "10.0.0.0/24", label: "Kantoor Amsterdam", added_at: "2026-02-12T10:00:00Z" },
    { cidr: "91.98.232.104/32", label: "VPS productie", added_at: "2026-03-01T08:30:00Z" },
  ],
  two_factor_policy: "admins",
  two_factor_required_role_ids: ["role-admin"],
  two_factor_grace_period_days: 14,
  password_policy: {
    min_length: 12,
    require_uppercase: true,
    require_lowercase: true,
    require_number: true,
    require_symbol: false,
    rotation_days: null,
  },
  session_idle_timeout_minutes: 60,
  updated_at: "2026-04-22T14:00:00Z",
};

// ─── Extended audit-events (50+, met before/after) ─────────────────────────

function genExtAuditEvents(): ExtAuditEvent[] {
  const actors = [
    { id: "user-1", name: "Emma Bakker", email: "emma@talentflow.io", role: "admin", ip: "10.0.0.5" },
    { id: "user-2", name: "Jan Peters", email: "jan@talentflow.io", role: "recruiter", ip: "10.0.0.7" },
    { id: "user-3", name: "Lisa Smits", email: "lisa@talentflow.io", role: "recruiter", ip: "85.150.12.44" },
    { id: null, name: "System", email: null, role: "system", ip: "127.0.0.1" },
  ];
  const ua =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 Safari/605.1.15";

  const tpl: Array<Omit<ExtAuditEvent, "id" | "occurred_at" | "actor_id" | "actor_name" | "actor_email" | "actor_role" | "ip_address" | "user_agent" | "request_id" | "tenant_id" | "worm_hash">> = [
    {
      action: "user.login.success",
      category: "auth",
      label: "Succesvol ingelogd",
      entity_type: "user",
      entity_id: "user-2",
      entity_label: "Jan Peters",
      before: null,
      after: { method: "password", mfa: false },
      metadata: { session_id: "sess-9af2..." },
    },
    {
      action: "user.login.failed",
      category: "auth",
      label: "Mislukte inlog",
      entity_type: "user",
      entity_id: "user-2",
      entity_label: "Jan Peters",
      before: null,
      after: { reason: "invalid_password" },
      metadata: { attempts_in_window: 2 },
    },
    {
      action: "user.2fa.enabled",
      category: "security",
      label: "2FA ingeschakeld",
      entity_type: "user",
      entity_id: "user-1",
      entity_label: "Emma Bakker",
      before: { two_factor_enabled: false },
      after: { two_factor_enabled: true, method: "totp" },
      metadata: null,
    },
    {
      action: "user.2fa.backup_codes_regenerated",
      category: "security",
      label: "2FA backup-codes opnieuw gegenereerd",
      entity_type: "user",
      entity_id: "user-1",
      entity_label: "Emma Bakker",
      before: { backup_codes_remaining: 3 },
      after: { backup_codes_remaining: 10 },
      metadata: null,
    },
    {
      action: "role.created",
      category: "admin",
      label: "Rol aangemaakt",
      entity_type: "role",
      entity_id: "role-cust-2",
      entity_label: "Compliance Officer",
      before: null,
      after: { key: "compliance_officer", label: "Compliance Officer" },
      metadata: null,
    },
    {
      action: "role.assigned",
      category: "admin",
      label: "Rol toegewezen",
      entity_type: "role_assignment",
      entity_id: "ra-3",
      entity_label: "Lisa Smits → Recruiter",
      before: null,
      after: { user_id: "user-3", role_id: "role-recruiter" },
      metadata: null,
    },
    {
      action: "role.permission.updated",
      category: "admin",
      label: "Rolrechten gewijzigd",
      entity_type: "role",
      entity_id: "role-cust-1",
      entity_label: "Billing-admin",
      before: { permissions: [{ resource: "billing", actions: ["read"] }] },
      after: { permissions: [{ resource: "billing", actions: ["read", "manage"] }] },
      metadata: null,
    },
    {
      action: "ip_allowlist.entry_added",
      category: "security",
      label: "IP-allowlist entry toegevoegd",
      entity_type: "security_settings",
      entity_id: "tenant-1",
      entity_label: "Tenant security",
      before: null,
      after: { cidr: "91.98.232.104/32", label: "VPS productie" },
      metadata: null,
    },
    {
      action: "ip_allowlist.enabled",
      category: "security",
      label: "IP-allowlist geactiveerd",
      entity_type: "security_settings",
      entity_id: "tenant-1",
      entity_label: "Tenant security",
      before: { ip_allowlist_enabled: false },
      after: { ip_allowlist_enabled: true },
      metadata: { entries_count: 2 },
    },
    {
      action: "sso.config.updated",
      category: "security",
      label: "SSO-configuratie bijgewerkt",
      entity_type: "sso_config",
      entity_id: "sso-1",
      entity_label: "Okta SAML",
      before: { enabled: false },
      after: { enabled: true, provider: "okta" },
      metadata: null,
    },
    {
      action: "candidate.exported",
      category: "exports",
      label: "Kandidaat geëxporteerd naar PDF",
      entity_type: "candidate",
      entity_id: "cand-1",
      entity_label: "Sophie van den Berg",
      before: null,
      after: { format: "pdf" },
      metadata: { reason: "shortlist-review" },
    },
    {
      action: "candidate.bulk_export",
      category: "exports",
      label: "Bulk-export kandidaten",
      entity_type: "candidate",
      entity_id: "bulk",
      entity_label: "247 kandidaten",
      before: null,
      after: { format: "csv", count: 247 },
      metadata: { filter: "stage=hired&period=Q1-2026" },
    },
    {
      action: "candidate.viewed",
      category: "access",
      label: "Kandidaatprofiel bekeken",
      entity_type: "candidate",
      entity_id: "cand-2",
      entity_label: "Thomas Janssen",
      before: null,
      after: null,
      metadata: { context: "candidate-detail-page" },
    },
    {
      action: "candidate.updated",
      category: "writes",
      label: "Kandidaat bijgewerkt",
      entity_type: "candidate",
      entity_id: "cand-2",
      entity_label: "Thomas Janssen",
      before: { current_position: "Frontend Developer", phone: null },
      after: { current_position: "Senior Frontend Developer", phone: "+31 6 12345678" },
      metadata: null,
    },
    {
      action: "consent.granted",
      category: "consent",
      label: "AVG-toestemming verleend",
      entity_type: "candidate",
      entity_id: "cand-3",
      entity_label: "Aisha El Hamdouchi",
      before: { gdpr_consent: false },
      after: { gdpr_consent: true },
      metadata: { source: "career-page" },
    },
    {
      action: "ai.match.score",
      category: "ai",
      label: "AI-matchscore berekend",
      entity_type: "candidate",
      entity_id: "cand-1",
      entity_label: "Sophie van den Berg",
      before: null,
      after: { score: 87, model: "claude-opus-4-7", job_id: "job-1" },
      metadata: { explanation_snippet: "Sterke match op React + TypeScript + 7 jaar ervaring." },
    },
    {
      action: "communication.email.sent",
      category: "communications",
      label: "E-mail verzonden",
      entity_type: "candidate",
      entity_id: "cand-4",
      entity_label: "Mark de Wit",
      before: null,
      after: { subject: "Uitnodiging gesprek", template_id: "tmpl-1" },
      metadata: { delivered: true, message_id: "msg-9384..." },
    },
    {
      action: "user.password.changed",
      category: "auth",
      label: "Wachtwoord gewijzigd",
      entity_type: "user",
      entity_id: "user-3",
      entity_label: "Lisa Smits",
      before: null,
      after: { method: "self-service" },
      metadata: null,
    },
    {
      action: "settings.password_policy.updated",
      category: "security",
      label: "Wachtwoord-beleid bijgewerkt",
      entity_type: "security_settings",
      entity_id: "tenant-1",
      entity_label: "Tenant security",
      before: { min_length: 8, require_symbol: false },
      after: { min_length: 12, require_symbol: false },
      metadata: null,
    },
    {
      action: "api_key.created",
      category: "security",
      label: "API-sleutel aangemaakt",
      entity_type: "api_key",
      entity_id: "key-2",
      entity_label: "Job board sync",
      before: null,
      after: { scopes: ["jobs:read", "candidates:read"] },
      metadata: null,
    },
  ];

  const events: ExtAuditEvent[] = [];
  const start = new Date("2026-05-08T11:00:00Z").getTime();
  for (let i = 0; i < 60; i++) {
    const t = tpl[i % tpl.length];
    const a = actors[i % actors.length];
    const ts = new Date(start - i * 1000 * 60 * 47).toISOString();
    events.push({
      id: `ext-audit-${i + 1}`,
      tenant_id: "tenant-1",
      occurred_at: ts,
      action: t.action,
      category: t.category,
      label: t.label,
      actor_id: a.id,
      actor_name: a.name,
      actor_email: a.email,
      actor_role: a.role,
      entity_type: t.entity_type,
      entity_id: t.entity_id,
      entity_label: t.entity_label,
      ip_address: a.ip,
      user_agent: ua,
      request_id: `req-${(i + 1).toString().padStart(6, "0")}`,
      before: t.before,
      after: t.after,
      metadata: t.metadata,
      worm_hash: `0x${(i * 7919 + 123456).toString(16).padStart(20, "a")}`,
    });
  }
  return events;
}

export const mockExtAuditEvents: ExtAuditEvent[] = genExtAuditEvents();

/** Distinct action-keys voor autocomplete in de viewer-filter. */
export function listExtAuditActions(): string[] {
  return Array.from(new Set(mockExtAuditEvents.map((e) => e.action))).sort();
}

// ─── Sprint Q4.3 — Job-board distribution ────────────────────────────────────

import type {
  JobBoardCatalogEntry,
  JobBoardIntegration,
  JobPosting,
} from "./types/jobBoards";

export type {
  CostPerHireRow,
  JobBoardAuthType,
  JobBoardCatalogEntry,
  JobBoardIntegration,
  JobBoardIntegrationStatus,
  JobBoardRegion,
  JobPosting,
  JobPostingStatus,
  PostingStatusEvent,
} from "./types/jobBoards";

/** Catalog of supported boards. Locked to 8 per spec. */
export const mockJobBoardCatalog: JobBoardCatalogEntry[] = [
  { id: "linkedin", display_name: "LinkedIn Jobs", region: "global", auth_type: "oauth2" },
  { id: "indeed", display_name: "Indeed", region: "global", auth_type: "oauth2" },
  { id: "jobbird", display_name: "Jobbird", region: "nl", auth_type: "api_key" },
  { id: "stepstone", display_name: "StepStone", region: "eu", auth_type: "oauth2" },
  { id: "werkzoeken", display_name: "Werkzoeken.nl", region: "nl", auth_type: "xml_feed" },
  { id: "jobsnl", display_name: "Jobs.nl", region: "nl", auth_type: "api_key" },
  {
    id: "nationale-vacaturebank",
    display_name: "Nationale Vacaturebank",
    region: "nl",
    auth_type: "xml_feed",
  },
  { id: "broadbean", display_name: "Broadbean (multi-post)", region: "global", auth_type: "oauth2" },
];

const ISO_NOW = new Date("2026-05-09T10:00:00Z");

function isoOffset(daysAgo: number, minuteOffset = 0): string {
  const d = new Date(ISO_NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setMinutes(d.getMinutes() + minuteOffset);
  return d.toISOString();
}

export const mockJobBoardIntegrations: JobBoardIntegration[] = [
  {
    id: "jbi-linkedin",
    board_id: "linkedin",
    display_name: "LinkedIn Jobs",
    status: "connected",
    connected_at: isoOffset(28),
    last_polled_at: isoOffset(0, -7),
    last_error: null,
    settings: { account: "TalentFlow Demo BV", company_id: "12345678" },
  },
  {
    id: "jbi-jobbird",
    board_id: "jobbird",
    display_name: "Jobbird",
    status: "connected",
    connected_at: isoOffset(46),
    last_polled_at: isoOffset(0, -3),
    last_error: null,
    settings: { account: "demo@talentflow.io" },
  },
  {
    id: "jbi-indeed",
    board_id: "indeed",
    display_name: "Indeed",
    status: "connected",
    connected_at: isoOffset(60),
    last_polled_at: isoOffset(0, -12),
    last_error: null,
    settings: { account: "TalentFlow Demo BV" },
  },
];

export const mockJobPostings: JobPosting[] = [
  // job-1: Senior Frontend Developer
  {
    id: "jbp-1",
    job_id: "job-1",
    job_title: "Senior Frontend Developer",
    board_id: "linkedin",
    status: "posted",
    external_id: "li-8472913",
    external_url: "https://www.linkedin.com/jobs/view/8472913",
    cost_amount: 295,
    cost_currency: "EUR",
    applicants_count: 27,
    posted_at: isoOffset(12),
    expires_at: isoOffset(-18),
    retracted_at: null,
    last_polled_at: isoOffset(0, -5),
    error_message: null,
    created_at: isoOffset(12, -5),
  },
  {
    id: "jbp-2",
    job_id: "job-1",
    job_title: "Senior Frontend Developer",
    board_id: "indeed",
    status: "posted",
    external_id: "ind-552031",
    external_url: "https://nl.indeed.com/viewjob?jk=ind552031",
    cost_amount: 0,
    cost_currency: "EUR",
    applicants_count: 14,
    posted_at: isoOffset(11),
    expires_at: isoOffset(-19),
    retracted_at: null,
    last_polled_at: isoOffset(0, -10),
    error_message: null,
    created_at: isoOffset(11, -3),
  },
  {
    id: "jbp-3",
    job_id: "job-1",
    job_title: "Senior Frontend Developer",
    board_id: "jobbird",
    status: "posted",
    external_id: "jb-9933",
    external_url: "https://www.jobbird.com/nl/vacature/9933",
    cost_amount: 89,
    cost_currency: "EUR",
    applicants_count: 6,
    posted_at: isoOffset(10),
    expires_at: isoOffset(-20),
    retracted_at: null,
    last_polled_at: isoOffset(0, -25),
    error_message: null,
    created_at: isoOffset(10, -2),
  },
  {
    id: "jbp-4",
    job_id: "job-1",
    job_title: "Senior Frontend Developer",
    board_id: "stepstone",
    status: "queued",
    external_id: null,
    external_url: null,
    cost_amount: 215,
    cost_currency: "EUR",
    applicants_count: 0,
    posted_at: null,
    expires_at: null,
    retracted_at: null,
    last_polled_at: null,
    error_message: null,
    created_at: isoOffset(0, -3),
  },
  // job-2: Product Manager
  {
    id: "jbp-5",
    job_id: "job-2",
    job_title: "Product Manager",
    board_id: "linkedin",
    status: "posted",
    external_id: "li-8473501",
    external_url: "https://www.linkedin.com/jobs/view/8473501",
    cost_amount: 295,
    cost_currency: "EUR",
    applicants_count: 19,
    posted_at: isoOffset(8),
    expires_at: isoOffset(-22),
    retracted_at: null,
    last_polled_at: isoOffset(0, -8),
    error_message: null,
    created_at: isoOffset(8, -3),
  },
  {
    id: "jbp-6",
    job_id: "job-2",
    job_title: "Product Manager",
    board_id: "nationale-vacaturebank",
    status: "posted",
    external_id: "nvb-118273",
    external_url: "https://www.nationalevacaturebank.nl/vacature/118273",
    cost_amount: 175,
    cost_currency: "EUR",
    applicants_count: 8,
    posted_at: isoOffset(7),
    expires_at: isoOffset(-23),
    retracted_at: null,
    last_polled_at: isoOffset(0, -18),
    error_message: null,
    created_at: isoOffset(7, -2),
  },
  {
    id: "jbp-7",
    job_id: "job-2",
    job_title: "Product Manager",
    board_id: "stepstone",
    status: "failed",
    external_id: null,
    external_url: null,
    cost_amount: 215,
    cost_currency: "EUR",
    applicants_count: 0,
    posted_at: null,
    expires_at: null,
    retracted_at: null,
    last_polled_at: isoOffset(2),
    error_message: "Authenticatiefout: API-token verlopen. Vernieuw de StepStone-koppeling.",
    created_at: isoOffset(3),
  },
  // job-3: Backend Engineer (Python)
  {
    id: "jbp-8",
    job_id: "job-3",
    job_title: "Backend Engineer (Python)",
    board_id: "indeed",
    status: "posted",
    external_id: "ind-559912",
    external_url: "https://nl.indeed.com/viewjob?jk=ind559912",
    cost_amount: 0,
    cost_currency: "EUR",
    applicants_count: 11,
    posted_at: isoOffset(5),
    expires_at: isoOffset(-25),
    retracted_at: null,
    last_polled_at: isoOffset(0, -45),
    error_message: null,
    created_at: isoOffset(5, -2),
  },
  {
    id: "jbp-9",
    job_id: "job-3",
    job_title: "Backend Engineer (Python)",
    board_id: "jobbird",
    status: "posted",
    external_id: "jb-10145",
    external_url: "https://www.jobbird.com/nl/vacature/10145",
    cost_amount: 89,
    cost_currency: "EUR",
    applicants_count: 4,
    posted_at: isoOffset(5),
    expires_at: isoOffset(-25),
    retracted_at: null,
    last_polled_at: isoOffset(0, -42),
    error_message: null,
    created_at: isoOffset(5, -1),
  },
  {
    id: "jbp-10",
    job_id: "job-3",
    job_title: "Backend Engineer (Python)",
    board_id: "linkedin",
    status: "queued",
    external_id: null,
    external_url: null,
    cost_amount: 295,
    cost_currency: "EUR",
    applicants_count: 0,
    posted_at: null,
    expires_at: null,
    retracted_at: null,
    last_polled_at: null,
    error_message: null,
    created_at: isoOffset(0, -1),
  },
  // job-4: synthetic — DevOps
  {
    id: "jbp-11",
    job_id: "job-4",
    job_title: "DevOps Engineer",
    board_id: "linkedin",
    status: "posted",
    external_id: "li-8475122",
    external_url: "https://www.linkedin.com/jobs/view/8475122",
    cost_amount: 295,
    cost_currency: "EUR",
    applicants_count: 22,
    posted_at: isoOffset(20),
    expires_at: isoOffset(-10),
    retracted_at: null,
    last_polled_at: isoOffset(0, -2),
    error_message: null,
    created_at: isoOffset(20, -2),
  },
  {
    id: "jbp-12",
    job_id: "job-4",
    job_title: "DevOps Engineer",
    board_id: "indeed",
    status: "expired",
    external_id: "ind-540118",
    external_url: "https://nl.indeed.com/viewjob?jk=ind540118",
    cost_amount: 0,
    cost_currency: "EUR",
    applicants_count: 9,
    posted_at: isoOffset(45),
    expires_at: isoOffset(15),
    retracted_at: null,
    last_polled_at: isoOffset(15, 5),
    error_message: null,
    created_at: isoOffset(45, -3),
  },
  {
    id: "jbp-13",
    job_id: "job-4",
    job_title: "DevOps Engineer",
    board_id: "jobbird",
    status: "retracted",
    external_id: "jb-9821",
    external_url: "https://www.jobbird.com/nl/vacature/9821",
    cost_amount: 89,
    cost_currency: "EUR",
    applicants_count: 3,
    posted_at: isoOffset(30),
    expires_at: isoOffset(0),
    retracted_at: isoOffset(8),
    last_polled_at: isoOffset(8, 1),
    error_message: null,
    created_at: isoOffset(30, -1),
  },
];

// ─── Sprint Q4.4 — Temp/contract back-office ────────────────────────────────

import type {
  AccountingCatalogEntry,
  AccountingIntegration,
  CommissionAssignment,
  CommissionRecord,
  CommissionScheme,
  Contract,
  ContractExtension,
  Invoice,
  MarginRow,
  RevenueForecastMonth,
  Timesheet,
  TimesheetEntry,
} from "./types/backOffice";

export type {
  AccountingAuthType,
  AccountingCatalogEntry,
  AccountingIntegration,
  AccountingIntegrationStatus,
  AccountingProvider,
  CommissionAssignment,
  CommissionRecord,
  CommissionRecordStatus,
  CommissionScheme,
  CommissionSchemeType,
  Contract,
  ContractExtension,
  ContractStatus,
  ContractType,
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  MarginGroupBy,
  MarginRow,
  RevenueForecastMonth,
  Timesheet,
  TimesheetEntry,
  TimesheetStatus,
  TimesheetSummary,
} from "./types/backOffice";

/** Build an ISO date offset from `ISO_NOW` (defined above). */
function isoDate(daysAgo: number): string {
  const d = new Date(ISO_NOW);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function isoFull(daysAgo: number, minuteOffset = 0): string {
  return isoOffset(daysAgo, minuteOffset);
}

/**
 * 8 contracts — mix of statuses with 3 active contracts that have valid
 * weekly_hours + rates (so timesheets / invoicing demos work).
 */
export const mockContracts: Contract[] = [
  {
    id: "ctr-1",
    tenant_id: "tenant-1",
    candidate_id: "cand-1",
    candidate_name: "Sophie de Vries",
    client_organization_id: "org-1",
    client_name: "ING Bank N.V.",
    job_id: "job-1",
    job_title: "Senior Frontend Engineer",
    contract_type: "contract",
    status: "active",
    start_date: isoDate(60),
    end_date: isoDate(-120),
    weekly_hours: 40,
    hourly_rate_candidate: 75,
    hourly_rate_client: 110,
    margin_percent: 31.8,
    currency: "EUR",
    cao: "CAO Banken",
    wtza_compliant: true,
    signed_at: isoFull(60),
    terminated_at: null,
    termination_reason: null,
    created_at: isoFull(62),
    updated_at: isoFull(2),
  },
  {
    id: "ctr-2",
    tenant_id: "tenant-1",
    candidate_id: "cand-2",
    candidate_name: "Lars Janssen",
    client_organization_id: "org-2",
    client_name: "Coolblue B.V.",
    job_id: "job-2",
    job_title: "DevOps Engineer",
    contract_type: "temp",
    status: "active",
    start_date: isoDate(45),
    end_date: isoDate(-90),
    weekly_hours: 36,
    hourly_rate_candidate: 62,
    hourly_rate_client: 92,
    margin_percent: 32.6,
    currency: "EUR",
    cao: "CAO ABU Uitzendkrachten",
    wtza_compliant: true,
    signed_at: isoFull(45),
    terminated_at: null,
    termination_reason: null,
    created_at: isoFull(47),
    updated_at: isoFull(3),
  },
  {
    id: "ctr-3",
    tenant_id: "tenant-1",
    candidate_id: "cand-3",
    candidate_name: "Eva Bakker",
    client_organization_id: "org-3",
    client_name: "Adyen N.V.",
    job_id: "job-3",
    job_title: "Backend Engineer (Python)",
    contract_type: "freelance",
    status: "active",
    start_date: isoDate(20),
    end_date: isoDate(-180),
    weekly_hours: 32,
    hourly_rate_candidate: 95,
    hourly_rate_client: 135,
    margin_percent: 29.6,
    currency: "EUR",
    cao: null,
    wtza_compliant: true,
    signed_at: isoFull(20),
    terminated_at: null,
    termination_reason: null,
    created_at: isoFull(22),
    updated_at: isoFull(1),
  },
  {
    id: "ctr-4",
    tenant_id: "tenant-1",
    candidate_id: "cand-4",
    candidate_name: "Mehmet Yılmaz",
    client_organization_id: "org-1",
    client_name: "ING Bank N.V.",
    job_id: "job-4",
    job_title: "Data Engineer",
    contract_type: "contract",
    status: "ended",
    start_date: isoDate(220),
    end_date: isoDate(40),
    weekly_hours: 40,
    hourly_rate_candidate: 70,
    hourly_rate_client: 100,
    margin_percent: 30,
    currency: "EUR",
    cao: "CAO Banken",
    wtza_compliant: true,
    signed_at: isoFull(220),
    terminated_at: null,
    termination_reason: null,
    created_at: isoFull(222),
    updated_at: isoFull(40),
  },
  {
    id: "ctr-5",
    tenant_id: "tenant-1",
    candidate_id: "cand-5",
    candidate_name: "Anna Visser",
    client_organization_id: "org-4",
    client_name: "Bol.com",
    job_id: null,
    job_title: undefined,
    contract_type: "temp",
    status: "terminated",
    start_date: isoDate(180),
    end_date: isoDate(60),
    weekly_hours: 32,
    hourly_rate_candidate: 55,
    hourly_rate_client: 80,
    margin_percent: 31.3,
    currency: "EUR",
    cao: "CAO ABU Uitzendkrachten",
    wtza_compliant: true,
    signed_at: isoFull(180),
    terminated_at: isoFull(95),
    termination_reason: "Vroege beëindiging op verzoek van kandidaat",
    created_at: isoFull(182),
    updated_at: isoFull(95),
  },
  {
    id: "ctr-6",
    tenant_id: "tenant-1",
    candidate_id: "cand-6",
    candidate_name: "Tom van Dijk",
    client_organization_id: "org-2",
    client_name: "Coolblue B.V.",
    job_id: null,
    job_title: undefined,
    contract_type: "permanent",
    status: "renewed",
    start_date: isoDate(380),
    end_date: isoDate(15),
    weekly_hours: 40,
    hourly_rate_candidate: 60,
    hourly_rate_client: 88,
    margin_percent: 31.8,
    currency: "EUR",
    cao: null,
    wtza_compliant: null,
    signed_at: isoFull(380),
    terminated_at: null,
    termination_reason: null,
    created_at: isoFull(382),
    updated_at: isoFull(15),
  },
  {
    id: "ctr-7",
    tenant_id: "tenant-1",
    candidate_id: "cand-7",
    candidate_name: "Fatima El Amrani",
    client_organization_id: "org-5",
    client_name: "ASML",
    job_id: null,
    job_title: undefined,
    contract_type: "freelance",
    status: "draft",
    start_date: isoDate(-7),
    end_date: isoDate(-180),
    weekly_hours: 36,
    hourly_rate_candidate: 110,
    hourly_rate_client: 155,
    margin_percent: 29,
    currency: "EUR",
    cao: null,
    wtza_compliant: null,
    signed_at: null,
    terminated_at: null,
    termination_reason: null,
    created_at: isoFull(2),
    updated_at: isoFull(1),
  },
  {
    id: "ctr-8",
    tenant_id: "tenant-1",
    candidate_id: "cand-8",
    candidate_name: "Niels de Boer",
    client_organization_id: "org-3",
    client_name: "Adyen N.V.",
    job_id: null,
    job_title: undefined,
    contract_type: "contract",
    status: "ended",
    start_date: isoDate(540),
    end_date: isoDate(180),
    weekly_hours: 40,
    hourly_rate_candidate: 80,
    hourly_rate_client: 115,
    margin_percent: 30.4,
    currency: "EUR",
    cao: null,
    wtza_compliant: true,
    signed_at: isoFull(540),
    terminated_at: null,
    termination_reason: null,
    created_at: isoFull(542),
    updated_at: isoFull(180),
  },
];

export const mockContractExtensions: ContractExtension[] = [
  {
    id: "ext-1",
    contract_id: "ctr-6",
    previous_end_date: isoDate(15),
    new_end_date: isoDate(-180),
    reason: "Verlenging na succesvolle review",
    signed_at: isoFull(15),
  },
  {
    id: "ext-2",
    contract_id: "ctr-1",
    previous_end_date: isoDate(0),
    new_end_date: isoDate(-120),
    reason: "Project uitgebreid met fase 2",
    signed_at: isoFull(0),
  },
];

/** Helper to build a 5-day workweek of timesheet entries. */
function makeWeekEntries(
  prefix: string,
  weekStart: string,
  hoursPerDay: number,
  overtimeOnFriday = 0
): TimesheetEntry[] {
  const start = new Date(weekStart);
  const entries: TimesheetEntry[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const isFriday = i === 4;
    entries.push({
      id: `${prefix}-d${i}`,
      date: d.toISOString().slice(0, 10),
      hours: hoursPerDay,
      overtime_hours: isFriday ? overtimeOnFriday : 0,
      break_minutes: 30,
      description: null,
      project_code: null,
    });
  }
  return entries;
}

function weekStartFor(daysAgo: number): string {
  const d = new Date(ISO_NOW);
  d.setDate(d.getDate() - daysAgo);
  // Roll back to Monday.
  const day = d.getDay();
  const offset = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - offset);
  return d.toISOString().slice(0, 10);
}

function weekEndOf(weekStart: string): string {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

function mkTimesheet(
  id: string,
  contract_id: string,
  candidate_id: string,
  weekDaysAgo: number,
  status: Timesheet["status"],
  hoursPerDay: number,
  overtime: number,
  notes: string | null = null,
  rejection_reason: string | null = null
): Timesheet {
  const week_start = weekStartFor(weekDaysAgo);
  const week_end = weekEndOf(week_start);
  const entries = makeWeekEntries(id, week_start, hoursPerDay, overtime);
  const total_hours = entries.reduce((s, e) => s + e.hours, 0);
  const total_overtime_hours = entries.reduce(
    (s, e) => s + e.overtime_hours,
    0
  );
  return {
    id,
    contract_id,
    candidate_id,
    week_start,
    week_end,
    status,
    total_hours,
    total_overtime_hours,
    notes,
    submitted_at:
      status === "draft" ? null : isoFull(Math.max(weekDaysAgo - 6, 0), -120),
    approved_at:
      status === "approved" ? isoFull(Math.max(weekDaysAgo - 6, 0), -60) : null,
    approved_by: status === "approved" ? "user-1" : null,
    rejected_at:
      status === "rejected" ? isoFull(Math.max(weekDaysAgo - 6, 0), -90) : null,
    rejection_reason,
    entries,
    created_at: isoFull(weekDaysAgo + 1),
    updated_at: isoFull(Math.max(weekDaysAgo - 6, 0)),
  };
}

/** 12 timesheets across 4 contracts with mixed statuses. */
export const mockTimesheets: Timesheet[] = [
  // ctr-1 (Sophie / ING) — 4 weeks
  mkTimesheet("ts-1", "ctr-1", "cand-1", 28, "approved", 8, 0),
  mkTimesheet("ts-2", "ctr-1", "cand-1", 21, "approved", 8, 2),
  mkTimesheet("ts-3", "ctr-1", "cand-1", 14, "submitted", 8, 1),
  mkTimesheet("ts-4", "ctr-1", "cand-1", 7, "draft", 8, 0),
  // ctr-2 (Lars / Coolblue) — 3 weeks
  mkTimesheet("ts-5", "ctr-2", "cand-2", 21, "approved", 7.2, 0),
  mkTimesheet(
    "ts-6",
    "ctr-2",
    "cand-2",
    14,
    "rejected",
    7.2,
    0,
    null,
    "Pauze van 30min ontbreekt op woensdag"
  ),
  mkTimesheet("ts-7", "ctr-2", "cand-2", 7, "submitted", 7.2, 1.5),
  // ctr-3 (Eva / Adyen) — 3 weeks
  mkTimesheet("ts-8", "ctr-3", "cand-3", 14, "approved", 6.4, 0),
  mkTimesheet("ts-9", "ctr-3", "cand-3", 7, "approved", 6.4, 2),
  mkTimesheet("ts-10", "ctr-3", "cand-3", 0, "draft", 6.4, 0),
  // ctr-4 (Mehmet / ING — ended) — 2 weeks
  mkTimesheet("ts-11", "ctr-4", "cand-4", 49, "approved", 8, 0),
  mkTimesheet("ts-12", "ctr-4", "cand-4", 42, "approved", 8, 0),
];

// ─── Invoices ────────────────────────────────────────────────────────────────

function buildInvoiceLines(
  prefix: string,
  hours: number,
  unitPrice: number,
  overtimeHours = 0
): { lines: import("./types/backOffice").InvoiceLine[]; subtotal: number } {
  const lines: import("./types/backOffice").InvoiceLine[] = [
    {
      id: `${prefix}-l1`,
      description: "Reguliere uren",
      quantity: hours,
      unit: "uur",
      unit_price: unitPrice,
      line_total: hours * unitPrice,
      vat_rate: 21,
    },
  ];
  if (overtimeHours > 0) {
    lines.push({
      id: `${prefix}-l2`,
      description: "Overuren (1.25×)",
      quantity: overtimeHours,
      unit: "uur",
      unit_price: unitPrice * 1.25,
      line_total: overtimeHours * unitPrice * 1.25,
      vat_rate: 21,
    });
  }
  const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
  return { lines, subtotal };
}

function mkInvoice(
  id: string,
  invoice_number: string,
  contract_id: string,
  client_organization_id: string,
  client_name: string,
  status: Invoice["status"],
  daysAgoIssued: number,
  hours: number,
  unitPrice: number,
  overtimeHours = 0,
  external?: { id: string; provider: string; synced_at: string }
): Invoice {
  const { lines, subtotal } = buildInvoiceLines(id, hours, unitPrice, overtimeHours);
  const vat_amount = Math.round(subtotal * 0.21 * 100) / 100;
  const total_amount = Math.round((subtotal + vat_amount) * 100) / 100;
  const period_end = isoDate(daysAgoIssued + 7);
  const period_start = isoDate(daysAgoIssued + 13);
  const issued_date = status === "draft" ? null : isoDate(daysAgoIssued);
  const due_date =
    status === "draft" ? null : isoDate(Math.max(daysAgoIssued - 30, -60));
  return {
    id,
    tenant_id: "tenant-1",
    invoice_number,
    client_organization_id,
    client_name,
    contract_id,
    status,
    period_start,
    period_end,
    issued_date,
    due_date,
    paid_date: status === "paid" ? isoDate(Math.max(daysAgoIssued - 21, 0)) : null,
    subtotal_amount: subtotal,
    vat_rate: 21,
    vat_amount,
    total_amount,
    currency: "EUR",
    notes: null,
    external_accounting_id: external?.id ?? null,
    external_accounting_provider: external?.provider ?? null,
    external_synced_at: external?.synced_at ?? null,
    lines,
    created_at: isoFull(daysAgoIssued + 1),
  };
}

export const mockInvoices: Invoice[] = [
  mkInvoice(
    "inv-1",
    "TF-2026-0001",
    "ctr-1",
    "org-1",
    "ING Bank N.V.",
    "paid",
    49,
    320,
    110,
    0,
    {
      id: "EOL-FIN-2026-001",
      provider: "exact_online",
      synced_at: isoFull(48),
    }
  ),
  mkInvoice(
    "inv-2",
    "TF-2026-0002",
    "ctr-1",
    "org-1",
    "ING Bank N.V.",
    "paid",
    21,
    320,
    110,
    8,
    {
      id: "EOL-FIN-2026-002",
      provider: "exact_online",
      synced_at: isoFull(20),
    }
  ),
  mkInvoice(
    "inv-3",
    "TF-2026-0003",
    "ctr-2",
    "org-2",
    "Coolblue B.V.",
    "sent",
    7,
    72,
    92,
    0,
    {
      id: "EOL-FIN-2026-003",
      provider: "exact_online",
      synced_at: isoFull(7),
    }
  ),
  mkInvoice(
    "inv-4",
    "TF-2026-0004",
    "ctr-3",
    "org-3",
    "Adyen N.V.",
    "draft",
    0,
    64,
    135,
    0
  ),
  mkInvoice(
    "inv-5",
    "TF-2025-0142",
    "ctr-4",
    "org-1",
    "ING Bank N.V.",
    "overdue",
    52,
    320,
    100,
    0,
    {
      id: "EOL-FIN-2025-142",
      provider: "exact_online",
      synced_at: isoFull(52),
    }
  ),
  mkInvoice(
    "inv-6",
    "TF-2025-0099",
    "ctr-8",
    "org-3",
    "Adyen N.V.",
    "void",
    240,
    160,
    115,
    0
  ),
];

// ─── Accounting integrations ────────────────────────────────────────────────

export const mockAccountingCatalog: AccountingCatalogEntry[] = [
  {
    provider: "exact_online",
    display_name: "Exact Online",
    description:
      "Marktleider in Nederland. OAuth2-koppeling met automatische BTW-codes en grootboekrekeningen.",
    auth_type: "oauth2",
    region: "nl",
  },
  {
    provider: "twinfield",
    display_name: "Twinfield (Wolters Kluwer)",
    description:
      "Cloud-boekhouding van Wolters Kluwer. OAuth2 voor administratiekantoren en grotere MKB-klanten.",
    auth_type: "oauth2",
    region: "nl",
  },
  {
    provider: "snelstart",
    display_name: "SnelStart",
    description:
      "Populair bij ZZP en klein-MKB. API-key koppeling, eenvoudige sync van verkoopfacturen.",
    auth_type: "api_key",
    region: "nl",
  },
];

export const mockAccountingIntegrations: AccountingIntegration[] = [
  {
    id: "acct-int-1",
    provider: "exact_online",
    status: "connected",
    display_name: "Exact Online — TalentFlow Demo BV",
    default_revenue_account: "8000",
    default_vat_code: "VH-21",
    connected_at: isoFull(50),
    last_synced_at: isoFull(0, -90),
    last_error: null,
  },
];

// ─── Commissions ─────────────────────────────────────────────────────────────

export const mockCommissionSchemes: CommissionScheme[] = [
  {
    id: "scheme-1",
    name: "Standaard — 8% van fee",
    type: "percent_of_fee",
    config: { percent: 8 },
    active: true,
    is_default: true,
  },
  {
    id: "scheme-2",
    name: "Premium — getrapt op marge",
    type: "tiered",
    config: {
      tiers: [
        { up_to: 5000, percent: 10 },
        { up_to: 15000, percent: 12.5 },
        { up_to: null, percent: 15 },
      ],
    },
    active: true,
    is_default: false,
  },
  {
    id: "scheme-3",
    name: "Recurring — €250/mnd actief contract",
    type: "recurring_monthly",
    config: { monthly_amount: 250 },
    active: true,
    is_default: false,
  },
];

export const mockCommissionAssignments: CommissionAssignment[] = [
  {
    id: "comm-asg-1",
    recruiter_id: "user-1",
    recruiter_name: "Emma Bakker",
    contract_id: "ctr-1",
    scheme_id: "scheme-2",
    scheme_name: "Premium — getrapt op marge",
    share_percent: 100,
  },
  {
    id: "comm-asg-2",
    recruiter_id: "user-2",
    recruiter_name: "Jan Peters",
    contract_id: "ctr-2",
    scheme_id: "scheme-1",
    scheme_name: "Standaard — 8% van fee",
    share_percent: 100,
  },
  {
    id: "comm-asg-3",
    recruiter_id: "user-3",
    recruiter_name: "Lisa Smits",
    contract_id: "ctr-3",
    scheme_id: "scheme-3",
    scheme_name: "Recurring — €250/mnd actief contract",
    share_percent: 100,
  },
  {
    id: "comm-asg-4",
    recruiter_id: "user-1",
    recruiter_name: "Emma Bakker",
    contract_id: "ctr-4",
    scheme_id: "scheme-1",
    scheme_name: "Standaard — 8% van fee",
    share_percent: 50,
  },
  {
    id: "comm-asg-5",
    recruiter_id: "user-2",
    recruiter_name: "Jan Peters",
    contract_id: "ctr-4",
    scheme_id: "scheme-1",
    scheme_name: "Standaard — 8% van fee",
    share_percent: 50,
  },
];

export const mockCommissionRecords: CommissionRecord[] = [
  {
    id: "comm-rec-1",
    recruiter_id: "user-1",
    recruiter_name: "Emma Bakker",
    contract_id: "ctr-1",
    invoice_id: "inv-1",
    base_amount: 35200,
    commission_amount: 4400,
    period_start: isoDate(60),
    period_end: isoDate(50),
    status: "paid",
    paid_at: isoFull(45),
  },
  {
    id: "comm-rec-2",
    recruiter_id: "user-1",
    recruiter_name: "Emma Bakker",
    contract_id: "ctr-1",
    invoice_id: "inv-2",
    base_amount: 36400,
    commission_amount: 4550,
    period_start: isoDate(28),
    period_end: isoDate(21),
    status: "approved",
    paid_at: null,
  },
  {
    id: "comm-rec-3",
    recruiter_id: "user-2",
    recruiter_name: "Jan Peters",
    contract_id: "ctr-2",
    invoice_id: "inv-3",
    base_amount: 6624,
    commission_amount: 530,
    period_start: isoDate(14),
    period_end: isoDate(7),
    status: "pending",
    paid_at: null,
  },
  {
    id: "comm-rec-4",
    recruiter_id: "user-3",
    recruiter_name: "Lisa Smits",
    contract_id: "ctr-3",
    invoice_id: null,
    base_amount: 250,
    commission_amount: 250,
    period_start: isoDate(20),
    period_end: isoDate(0),
    status: "disputed",
    paid_at: null,
  },
];

// ─── Forecasting ────────────────────────────────────────────────────────────

export const mockRevenueForecast: RevenueForecastMonth[] = (() => {
  const out: RevenueForecastMonth[] = [];
  const base = new Date(ISO_NOW);
  base.setDate(1);
  for (let i = 0; i < 6; i++) {
    const m = new Date(base);
    m.setMonth(m.getMonth() + i);
    const month = m.toISOString().slice(0, 7);
    const expected = 95_000 + i * 8_500 + (i % 2 === 0 ? 4_000 : 0);
    const pipeline = 32_000 + i * 6_000;
    out.push({
      forecast_month: month,
      expected_revenue: expected,
      pipeline_revenue: pipeline,
      hires_in_pipeline: 4 + i,
      active_contracts: 12 + Math.floor(i * 0.7),
    });
  }
  return out;
})();

export const mockMarginByClient: MarginRow[] = [
  {
    group_id: "org-1",
    group_name: "ING Bank N.V.",
    total_revenue: 70400,
    total_cost: 48000,
    margin_amount: 22400,
    margin_pct: 31.8,
    contracts: 2,
  },
  {
    group_id: "org-3",
    group_name: "Adyen N.V.",
    total_revenue: 58320,
    total_cost: 41040,
    margin_amount: 17280,
    margin_pct: 29.6,
    contracts: 2,
  },
  {
    group_id: "org-2",
    group_name: "Coolblue B.V.",
    total_revenue: 33120,
    total_cost: 22320,
    margin_amount: 10800,
    margin_pct: 32.6,
    contracts: 2,
  },
  {
    group_id: "org-4",
    group_name: "Bol.com",
    total_revenue: 15360,
    total_cost: 10560,
    margin_amount: 4800,
    margin_pct: 31.3,
    contracts: 1,
  },
  {
    group_id: "org-5",
    group_name: "ASML",
    total_revenue: 0,
    total_cost: 0,
    margin_amount: 0,
    margin_pct: 0,
    contracts: 1,
  },
];

export const mockMarginByRecruiter: MarginRow[] = [
  {
    group_id: "user-1",
    group_name: "Emma Bakker",
    total_revenue: 92800,
    total_cost: 64000,
    margin_amount: 28800,
    margin_pct: 31.0,
    contracts: 3,
  },
  {
    group_id: "user-2",
    group_name: "Jan Peters",
    total_revenue: 49120,
    total_cost: 33360,
    margin_amount: 15760,
    margin_pct: 32.1,
    contracts: 2,
  },
  {
    group_id: "user-3",
    group_name: "Lisa Smits",
    total_revenue: 35280,
    total_cost: 24960,
    margin_amount: 10320,
    margin_pct: 29.2,
    contracts: 2,
  },
];

// ─── Sprint Q4.5 — Agentic AI sourcing + outreach + nurture mock state ──────

import type {
  AgentBrief,
  AgentRun,
  AgentFinding,
  AgentAction,
} from "@/lib/types/sourcing";
import type {
  CandidateSignal,
  NurtureEnrollment,
  NurtureSequence,
  NurtureStep,
  OutreachMessage,
  OutreachQuota,
  ReplyClassification,
} from "@/lib/types/outreach";

// Re-export so callers can `import type { AgentBrief } from "@/lib/mockData"`.
export type {
  AgentBrief,
  AgentRun,
  AgentFinding,
  AgentAction,
  CandidateSignal,
  NurtureEnrollment,
  NurtureSequence,
  NurtureStep,
  OutreachMessage,
  OutreachQuota,
  ReplyClassification,
};

const SOURCING_NOW = new Date("2026-05-09T10:00:00Z");
const sourcingOffset = (h: number): string =>
  new Date(SOURCING_NOW.getTime() + h * 3600 * 1000).toISOString();

export const mockAgentBriefs: AgentBrief[] = [
  {
    id: "brief-1",
    job_id: "job-1",
    brief_text:
      "We zoeken een Senior Data Engineer met Snowflake-ervaring voor het BI-team van een fintech in Amsterdam. Hybride werken (2 dagen kantoor). Nederlands en Engels.",
    must_have: ["Snowflake", "dbt", "Python", "5+ jaar"],
    nice_to_have: ["Airflow", "Looker", "Terraform"],
    exclusions: ["junior", "consultancy >50% travel"],
    target_count: 25,
    search_locations: ["Amsterdam", "Utrecht", "Rotterdam"],
    language_preferences: ["nl", "en"],
    active: true,
    created_at: sourcingOffset(-72),
  },
  {
    id: "brief-2",
    job_id: "job-2",
    brief_text:
      "React Frontend Lead voor SaaS-platform. Sterke design-sense. Liefst iemand die het hele design-system kan dragen.",
    must_have: ["React", "TypeScript", "Design systems"],
    nice_to_have: ["Tailwind", "shadcn/ui", "Storybook"],
    exclusions: ["pure backend"],
    target_count: 15,
    search_locations: ["Amsterdam", "Remote NL"],
    language_preferences: ["nl", "en"],
    active: true,
    created_at: sourcingOffset(-120),
  },
  {
    id: "brief-3",
    job_id: "job-3",
    brief_text:
      "Embedded C++ engineer met automotive ervaring (AUTOSAR, ISO 26262). Eindhoven regio.",
    must_have: ["C++", "AUTOSAR", "ISO 26262"],
    nice_to_have: ["MISRA", "CAN bus", "Vector tools"],
    exclusions: ["webdev"],
    target_count: 10,
    search_locations: ["Eindhoven", "Helmond"],
    language_preferences: ["nl", "en", "de"],
    active: false,
    created_at: sourcingOffset(-240),
  },
];

export const mockAgentRuns: AgentRun[] = [
  // 1) Currently running with a partial reasoning_log.
  {
    id: "run-1",
    brief_id: "brief-1",
    status: "running",
    trigger: "manual",
    started_at: sourcingOffset(-0.05),
    finished_at: null,
    candidates_found: 12,
    candidates_approved: 0,
    candidates_rejected: 0,
    expansion_iteration: 2,
    current_query: {
      keywords: "Snowflake dbt Python",
      locations: ["Amsterdam", "Utrecht"],
      seniority: "Senior",
    },
    reasoning_log: [
      {
        ts: sourcingOffset(-0.05),
        step: "plan",
        reason:
          "Brief: Senior Data Engineer Snowflake. Strategie: 3 query-iteraties — exact-match, synoniemen, soft-skill expansie.",
      },
      {
        ts: sourcingOffset(-0.04),
        step: "search:linkedin",
        reason:
          "Query 1 — 'Senior Data Engineer Snowflake Amsterdam' → 47 hits, 12 lijken in scope.",
      },
      {
        ts: sourcingOffset(-0.025),
        step: "score",
        reason: "12 kandidaten gescoord. 8 boven drempel (75+).",
      },
      {
        ts: sourcingOffset(-0.01),
        step: "expand",
        reason:
          "Iteratie 2: synoniemen 'Analytics Engineer' + 'Data Platform Engineer' toegevoegd.",
      },
    ],
    error_message: null,
    created_at: sourcingOffset(-0.05),
  },
  // 2) Review-required (8 findings ready).
  {
    id: "run-2",
    brief_id: "brief-2",
    status: "review_required",
    trigger: "manual",
    started_at: sourcingOffset(-3),
    finished_at: sourcingOffset(-2.5),
    candidates_found: 14,
    candidates_approved: 0,
    candidates_rejected: 0,
    expansion_iteration: 3,
    current_query: null,
    reasoning_log: [
      {
        ts: sourcingOffset(-3),
        step: "plan",
        reason: "React Frontend Lead — focus op design-system ervaring.",
      },
      {
        ts: sourcingOffset(-2.9),
        step: "search:linkedin",
        reason: "32 hits, 14 in scope na noise-filter.",
      },
      {
        ts: sourcingOffset(-2.6),
        step: "review_required",
        reason: "14 kandidaten klaar voor menselijke review.",
      },
    ],
    error_message: null,
    created_at: sourcingOffset(-3),
  },
  // 3) Completed (8 approved).
  {
    id: "run-3",
    brief_id: "brief-1",
    status: "completed",
    trigger: "scheduled",
    started_at: sourcingOffset(-48),
    finished_at: sourcingOffset(-47.5),
    candidates_found: 22,
    candidates_approved: 8,
    candidates_rejected: 6,
    expansion_iteration: 4,
    current_query: null,
    reasoning_log: [
      {
        ts: sourcingOffset(-48),
        step: "plan",
        reason: "Geplande wekelijkse run.",
      },
      {
        ts: sourcingOffset(-47.5),
        step: "completed",
        reason: "8 goedgekeurd, 6 afgewezen, 8 nog niet beoordeeld.",
      },
    ],
    error_message: null,
    created_at: sourcingOffset(-48),
  },
  // 4) Queued — flips to running after 4s in mock progressor.
  {
    id: "run-4",
    brief_id: "brief-2",
    status: "queued",
    trigger: "manual",
    started_at: null,
    finished_at: null,
    candidates_found: 0,
    candidates_approved: 0,
    candidates_rejected: 0,
    expansion_iteration: 0,
    current_query: null,
    reasoning_log: [],
    error_message: null,
    created_at: new Date().toISOString(),
  },
  // 5) Failed.
  {
    id: "run-5",
    brief_id: "brief-3",
    status: "failed",
    trigger: "manual",
    started_at: sourcingOffset(-96),
    finished_at: sourcingOffset(-95.5),
    candidates_found: 3,
    candidates_approved: 0,
    candidates_rejected: 0,
    expansion_iteration: 1,
    current_query: null,
    reasoning_log: [
      {
        ts: sourcingOffset(-96),
        step: "plan",
        reason: "Embedded C++ AUTOSAR Eindhoven.",
      },
      {
        ts: sourcingOffset(-95.7),
        step: "error",
        reason: "LinkedIn rate-limit geraakt na 3 hits.",
      },
    ],
    error_message: "linkedin_rate_limit_exceeded",
    created_at: sourcingOffset(-96),
  },
  // 6) Cancelled.
  {
    id: "run-6",
    brief_id: "brief-1",
    status: "cancelled",
    trigger: "reactivation",
    started_at: sourcingOffset(-200),
    finished_at: sourcingOffset(-199),
    candidates_found: 4,
    candidates_approved: 0,
    candidates_rejected: 0,
    expansion_iteration: 1,
    current_query: null,
    reasoning_log: [
      {
        ts: sourcingOffset(-200),
        step: "plan",
        reason: "Reactivatie-trigger.",
      },
      {
        ts: sourcingOffset(-199),
        step: "cancelled",
        reason: "Recruiter heeft run handmatig geannuleerd.",
      },
    ],
    error_message: null,
    created_at: sourcingOffset(-200),
  },
];

const FINDING_NAMES: Array<{ name: string; title: string; company: string }> = [
  { name: "Sven Visser", title: "Senior Data Engineer", company: "Bunq" },
  { name: "Mei Chen", title: "Analytics Engineer", company: "Adyen" },
  { name: "Tomasz Kowalski", title: "Data Platform Lead", company: "Booking.com" },
  { name: "Anouk de Vries", title: "Senior Data Engineer", company: "Mollie" },
  { name: "Rohan Sharma", title: "Snowflake Architect", company: "Picnic" },
  { name: "Liesbeth Janssen", title: "Lead Data Engineer", company: "ABN AMRO" },
  { name: "Daniel Müller", title: "Data Engineer", company: "ING" },
  { name: "Sara Lopez", title: "Senior Analytics Engineer", company: "Coolblue" },
  { name: "Pieter Bakker", title: "Frontend Lead", company: "Mews" },
  { name: "Yara El Amrani", title: "Staff Frontend Engineer", company: "Catawiki" },
  { name: "James O'Connor", title: "Principal Frontend Engineer", company: "TomTom" },
  { name: "Wei Zhang", title: "Frontend Architect", company: "Personio" },
  { name: "Emma Hendriks", title: "UI Engineer", company: "Optiver" },
  { name: "Marc Dubois", title: "Frontend Engineering Manager", company: "Backbase" },
  { name: "Ines Aydin", title: "Senior React Engineer", company: "Ahold" },
  { name: "Stefan Berg", title: "Frontend Lead", company: "Just Eat" },
  { name: "Hannah Petersen", title: "UI Lead", company: "Klarna" },
  { name: "Igor Ivanov", title: "React Specialist", company: "Bol.com" },
  { name: "Nora Saidi", title: "Senior Frontend", company: "Wetransfer" },
  { name: "Felix Becker", title: "Tech Lead Frontend", company: "Otrium" },
  { name: "Aisha Khan", title: "Senior Data Engineer", company: "Albert Heijn" },
  { name: "Bram Smit", title: "Data Engineer", company: "Vodafone" },
  { name: "Carla Rossi", title: "Analytics Engineer", company: "GitLab" },
  { name: "Hugo Lambert", title: "Senior Data Engineer", company: "Datadog" },
];

const SKILL_POOL_DATA = ["Snowflake", "dbt", "Python", "Airflow", "SQL", "Looker", "Terraform", "Spark", "Kafka", "BigQuery"];
const SKILL_POOL_FE = ["React", "TypeScript", "Tailwind", "Next.js", "Storybook", "GraphQL", "Vue", "Webpack", "Vite", "Jest"];

export const mockAgentFindings: AgentFinding[] = FINDING_NAMES.map((person, i) => {
  const isData = i < 8 || i >= 20;
  const runId = i < 8 ? "run-3" : i < 20 ? "run-2" : "run-3";
  const briefId = isData ? "brief-1" : "brief-2";
  const skillPool = isData ? SKILL_POOL_DATA : SKILL_POOL_FE;
  // Deterministic skill subset per finding.
  const skills = skillPool.slice((i % 4), (i % 4) + 4);
  const score = 92 - (i * 2) + (i % 3) * 4;
  const status: AgentFinding["status"] =
    i < 4
      ? "approved"
      : i < 7
        ? "rejected"
        : i < 9
          ? "contacted"
          : "pending_review";
  return {
    id: `find-${i + 1}`,
    run_id: runId,
    brief_id: briefId,
    candidate_id: i % 5 === 0 ? `cand-existing-${i}` : null,
    external_source: "linkedin",
    external_url: `https://linkedin.com/in/${person.name.toLowerCase().replace(/\s+/g, "-")}`,
    external_id: `li-${i}-${Math.floor(Math.random() * 9999)}`,
    full_name: person.name,
    current_title: person.title,
    current_company: person.company,
    location: ["Amsterdam", "Utrecht", "Rotterdam", "Eindhoven", "Den Haag"][i % 5],
    headline: `${person.title} @ ${person.company}`,
    summary: `Ervaren ${person.title.toLowerCase()} met ${4 + (i % 8)} jaar ervaring bij ${person.company}.`,
    skills,
    languages: ["nl", "en"],
    match_score: Math.max(45, Math.min(98, score)),
    match_reasoning:
      isData
        ? `Sterke match op Snowflake + dbt. Werkt al ${4 + (i % 6)} jaar in een data-platform team. Locatie binnen reisbereik.`
        : `Past op design-system ervaring. Heeft ${person.company}'s frontend-stack opgebouwd vanaf nul.`,
    status,
    reviewed_at: status !== "pending_review" ? sourcingOffset(-1 - i) : null,
    reviewed_by: status !== "pending_review" ? "user-1" : null,
    review_note:
      status === "rejected" ? "Te ver weg / niet beschikbaar." : null,
    created_at: sourcingOffset(-2 - (i * 0.1)),
  };
});

export const mockAgentActions: AgentAction[] = [
  {
    id: "act-1",
    run_id: "run-2",
    finding_id: null,
    action: "agent_run_started",
    payload: { trigger: "manual" },
    reasoning: "Recruiter heeft brief-2 gestart.",
    ai_model: null,
    cost_usd: null,
    requires_approval: false,
    approved_by: null,
    approved_at: null,
    created_at: sourcingOffset(-3),
  },
  {
    id: "act-2",
    run_id: "run-2",
    finding_id: null,
    action: "linkedin_search",
    payload: { keywords: "React Frontend Lead", location: "Amsterdam" },
    reasoning: "Initiële LinkedIn-zoekopdracht.",
    ai_model: "claude-sonnet-4.5",
    cost_usd: 0.02,
    requires_approval: false,
    approved_by: null,
    approved_at: null,
    created_at: sourcingOffset(-2.9),
  },
  {
    id: "act-3",
    run_id: "run-2",
    finding_id: "find-9",
    action: "candidate_scored",
    payload: { score: 92 },
    reasoning: "Sterke match op design-system ervaring + Mews stack.",
    ai_model: "claude-sonnet-4.5",
    cost_usd: 0.004,
    requires_approval: false,
    approved_by: null,
    approved_at: null,
    created_at: sourcingOffset(-2.85),
  },
  {
    id: "act-4",
    run_id: "run-3",
    finding_id: "find-1",
    action: "candidate_approved",
    payload: { match_score: 92 },
    reasoning: "Recruiter (Emma) heeft kandidaat goedgekeurd.",
    ai_model: null,
    cost_usd: null,
    requires_approval: true,
    approved_by: "user-1",
    approved_at: sourcingOffset(-1),
    created_at: sourcingOffset(-1),
  },
  {
    id: "act-5",
    run_id: "run-3",
    finding_id: "find-3",
    action: "outreach_drafted",
    payload: { channel: "linkedin_inmail" },
    reasoning: "Auto-draft op basis van design-system match-signaal.",
    ai_model: "claude-sonnet-4.5",
    cost_usd: 0.012,
    requires_approval: true,
    approved_by: null,
    approved_at: null,
    created_at: sourcingOffset(-0.5),
  },
];

// ─── Outreach mock state ─────────────────────────────────────────────────────

const CANDIDATE_NAMES: Array<{ id: string; name: string }> = [
  { id: "cand-1", name: "Sven Visser" },
  { id: "cand-2", name: "Mei Chen" },
  { id: "cand-3", name: "Tomasz Kowalski" },
  { id: "cand-4", name: "Anouk de Vries" },
  { id: "cand-5", name: "Pieter Bakker" },
  { id: "cand-6", name: "Yara El Amrani" },
  { id: "cand-7", name: "Wei Zhang" },
  { id: "cand-8", name: "Sara Lopez" },
  { id: "cand-9", name: "Stefan Berg" },
  { id: "cand-10", name: "Hannah Petersen" },
];

export const mockOutreachMessages: OutreachMessage[] = [
  // Drafted / pending_approval (6)
  {
    id: "msg-1",
    enrollment_id: "enr-1",
    step_id: "step-1-1",
    candidate_id: "cand-1",
    candidate_name: "Sven Visser",
    channel: "linkedin_inmail",
    direction: "outbound",
    status: "pending_approval",
    subject: "Snowflake-rol bij fintech in Amsterdam — interesse?",
    body_text:
      "Hi Sven,\n\nIk zag dat je bij Bunq werkt aan hun data-platform — sterke achtergrond. We hebben een Senior Data Engineer rol bij een fintech in Amsterdam waar je de Snowflake/dbt stack vanaf het begin mee mag bouwen.\n\nKan ik je 15 min spreken?\n\nGroet,\nEmma",
    personalization_signals: { current_company: "Bunq", primary_skill: "Snowflake" },
    scheduled_for: sourcingOffset(2),
    sent_at: null,
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    reply_message_id: null,
    error_message: null,
    created_at: sourcingOffset(-1),
  },
  {
    id: "msg-2",
    enrollment_id: "enr-2",
    step_id: "step-1-1",
    candidate_id: "cand-2",
    candidate_name: "Mei Chen",
    channel: "email",
    direction: "outbound",
    status: "drafted",
    subject: "Senior Analytics Engineer — design partner setup",
    body_text:
      "Hoi Mei,\n\nJe analytics-werk bij Adyen viel op. We zoeken iemand die ons data-platform van de grond kan bouwen.\n\nGroet,\nEmma",
    personalization_signals: { current_company: "Adyen" },
    scheduled_for: null,
    sent_at: null,
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    reply_message_id: null,
    error_message: null,
    created_at: sourcingOffset(-0.5),
  },
  {
    id: "msg-3",
    enrollment_id: null,
    step_id: null,
    candidate_id: "cand-5",
    candidate_name: "Pieter Bakker",
    channel: "linkedin_inmail",
    direction: "outbound",
    status: "pending_approval",
    subject: "Frontend Lead — design-system kans",
    body_text:
      "Hi Pieter,\n\nMews heeft een prachtig design-system, en jouw rol als Frontend Lead daar is precies het profiel waar we voor zoeken.\n\nGroet,\nEmma",
    personalization_signals: { current_company: "Mews" },
    scheduled_for: null,
    sent_at: null,
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    reply_message_id: null,
    error_message: null,
    created_at: sourcingOffset(-0.3),
  },
  {
    id: "msg-4",
    enrollment_id: "enr-3",
    step_id: "step-2-1",
    candidate_id: "cand-3",
    candidate_name: "Tomasz Kowalski",
    channel: "email",
    direction: "outbound",
    status: "drafted",
    subject: "Data Platform Lead — interesse?",
    body_text: "Hi Tomasz,\n\nKorte vraag — ben je open voor een nieuwe rol?\n\nGroet,\nEmma",
    personalization_signals: { current_company: "Booking.com" },
    scheduled_for: null,
    sent_at: null,
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    reply_message_id: null,
    error_message: null,
    created_at: sourcingOffset(-0.2),
  },
  {
    id: "msg-5",
    enrollment_id: "enr-4",
    step_id: "step-1-1",
    candidate_id: "cand-7",
    candidate_name: "Wei Zhang",
    channel: "linkedin_connection",
    direction: "outbound",
    status: "pending_approval",
    subject: null,
    body_text:
      "Hi Wei,\nJe Personio frontend-architectuur viel op. Mag ik je connecten?\nEmma",
    personalization_signals: { current_company: "Personio" },
    scheduled_for: null,
    sent_at: null,
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    reply_message_id: null,
    error_message: null,
    created_at: sourcingOffset(-0.1),
  },
  {
    id: "msg-6",
    enrollment_id: null,
    step_id: null,
    candidate_id: "cand-9",
    candidate_name: "Stefan Berg",
    channel: "email",
    direction: "outbound",
    status: "drafted",
    subject: "Frontend Lead-kans",
    body_text: "Hi Stefan,\n\nKan ik je 10 min spreken?\n\nEmma",
    personalization_signals: { current_company: "Just Eat" },
    scheduled_for: null,
    sent_at: null,
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    reply_message_id: null,
    error_message: null,
    created_at: sourcingOffset(-0.05),
  },
  // Sent (8)
  ...Array.from({ length: 8 }).map<OutreachMessage>((_, i) => ({
    id: `msg-sent-${i + 1}`,
    enrollment_id: `enr-sent-${i + 1}`,
    step_id: `step-1-${(i % 3) + 1}`,
    candidate_id: CANDIDATE_NAMES[i % CANDIDATE_NAMES.length].id,
    candidate_name: CANDIDATE_NAMES[i % CANDIDATE_NAMES.length].name,
    channel: (["email", "linkedin_inmail", "email", "linkedin_connection"] as const)[i % 4],
    direction: "outbound",
    status: "sent",
    subject: i % 4 === 3 ? null : "Korte vraag van TalentFlow",
    body_text: "Hi,\n\nKorte vraag — ben je open voor een rol?\n\nEmma",
    personalization_signals: { source: "agent_run" },
    scheduled_for: null,
    sent_at: sourcingOffset(-2 - i),
    approved_by: "user-1",
    approved_at: sourcingOffset(-2.1 - i),
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    reply_message_id: i < 3 ? `msg-reply-${i + 1}` : null,
    error_message: null,
    created_at: sourcingOffset(-2.5 - i),
  })),
  // Inbound replies (4)
  ...Array.from({ length: 4 }).map<OutreachMessage>((_, i) => ({
    id: `msg-reply-${i + 1}`,
    enrollment_id: `enr-sent-${i + 1}`,
    step_id: null,
    candidate_id: CANDIDATE_NAMES[i].id,
    candidate_name: CANDIDATE_NAMES[i].name,
    channel: i % 2 === 0 ? "email" : "linkedin_inmail",
    direction: "inbound",
    status: "sent",
    subject: i % 2 === 0 ? "Re: Korte vraag van TalentFlow" : null,
    body_text:
      i === 0
        ? "Bedankt voor je bericht! Klinkt interessant — kan je me wat meer vertellen over de rol?"
        : i === 1
          ? "Ik ben momenteel niet beschikbaar maar misschien Q3."
          : i === 2
            ? "Niet geïnteresseerd op dit moment, dank."
            : "Out of office tot 20 mei.",
    personalization_signals: {},
    scheduled_for: null,
    sent_at: sourcingOffset(-1.5 - i),
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    reply_message_id: null,
    error_message: null,
    created_at: sourcingOffset(-1.5 - i),
  })),
];

export const mockReplyClassifications: ReplyClassification[] = [
  {
    id: "rc-1",
    message_id: "msg-reply-1",
    category: "interested",
    sentiment: "positive",
    next_action: "schedule_call",
    reasoning: "Vraagt actief om meer info — duidelijk signaal van interesse.",
    confidence: 0.92,
    classified_at: sourcingOffset(-1.4),
  },
  {
    id: "rc-2",
    message_id: "msg-reply-2",
    category: "not_now",
    sentiment: "neutral",
    next_action: "pause_sequence",
    reasoning: "Open voor later kwartaal. Pauzeer voor 90 dagen.",
    confidence: 0.85,
    classified_at: sourcingOffset(-2.4),
  },
  {
    id: "rc-3",
    message_id: "msg-reply-3",
    category: "not_interested",
    sentiment: "negative",
    next_action: "remove_from_outreach",
    reasoning: "Direct 'niet geïnteresseerd' — markeer als no-contact.",
    confidence: 0.97,
    classified_at: sourcingOffset(-3.4),
  },
  {
    id: "rc-4",
    message_id: "msg-reply-4",
    category: "out_of_office",
    sentiment: "neutral",
    next_action: "send_followup",
    reasoning: "OOO tot 20 mei — automatische follow-up op 21 mei.",
    confidence: 0.99,
    classified_at: sourcingOffset(-4.4),
  },
  {
    id: "rc-5",
    message_id: "msg-sent-5",
    category: "question",
    sentiment: "neutral",
    next_action: "manual_review",
    reasoning: "Stelt vraag over salaris — recruiter beslist.",
    confidence: 0.78,
    classified_at: sourcingOffset(-5),
  },
  {
    id: "rc-6",
    message_id: "msg-sent-6",
    category: "unsubscribe",
    sentiment: "negative",
    next_action: "remove_from_outreach",
    reasoning: "'Stop met mailen' — direct uitschrijven.",
    confidence: 0.95,
    classified_at: sourcingOffset(-6),
  },
  {
    id: "rc-7",
    message_id: "msg-sent-7",
    category: "spam",
    sentiment: "negative",
    next_action: "remove_from_outreach",
    reasoning: "Auto-responder spam-detectie.",
    confidence: 0.88,
    classified_at: sourcingOffset(-7),
  },
  {
    id: "rc-8",
    message_id: "msg-sent-8",
    category: "interested",
    sentiment: "positive",
    next_action: "schedule_call",
    reasoning: "Vraagt om meeting deze week.",
    confidence: 0.91,
    classified_at: sourcingOffset(-8),
  },
];

export const mockCandidateSignals: CandidateSignal[] = [
  {
    id: "sig-1",
    candidate_id: "cand-existing-1",
    candidate_name: "Lars Janssen",
    signal_type: "job_change",
    detected_at: sourcingOffset(-2),
    source: "linkedin",
    before_value: "Senior Data Engineer @ Booking",
    after_value: "Lead Data Engineer @ Bunq",
    reviewed: false,
    triggered_action: null,
  },
  {
    id: "sig-2",
    candidate_id: "cand-existing-2",
    candidate_name: "Femke de Boer",
    signal_type: "open_to_work_flag",
    detected_at: sourcingOffset(-3),
    source: "linkedin",
    before_value: null,
    after_value: "Open to work — Senior Frontend",
    reviewed: false,
    triggered_action: null,
  },
  {
    id: "sig-3",
    candidate_id: "cand-existing-3",
    candidate_name: "Mert Yıldız",
    signal_type: "title_change",
    detected_at: sourcingOffset(-12),
    source: "linkedin",
    before_value: "Frontend Engineer",
    after_value: "Senior Frontend Engineer",
    reviewed: false,
    triggered_action: null,
  },
  {
    id: "sig-4",
    candidate_id: "cand-existing-4",
    candidate_name: "Sophia Andersson",
    signal_type: "company_growth",
    detected_at: sourcingOffset(-24),
    source: "crunchbase",
    before_value: "50 medewerkers",
    after_value: "120 medewerkers (+140%)",
    reviewed: true,
    triggered_action: "drafted_reactivation",
  },
  {
    id: "sig-5",
    candidate_id: "cand-existing-5",
    candidate_name: "Lucas Martin",
    signal_type: "funding_round",
    detected_at: sourcingOffset(-48),
    source: "crunchbase",
    before_value: "Series A",
    after_value: "Series B (€45M)",
    reviewed: true,
    triggered_action: null,
  },
  {
    id: "sig-6",
    candidate_id: "cand-existing-6",
    candidate_name: "Eva Nielsen",
    signal_type: "linkedin_post",
    detected_at: sourcingOffset(-1),
    source: "linkedin",
    before_value: null,
    after_value: "Plaatste artikel 'Lessons from scaling our data platform'",
    reviewed: false,
    triggered_action: null,
  },
];

export const mockOutreachQuotas: OutreachQuota[] = [
  {
    recruiter_id: "user-1",
    recruiter_name: "Emma Bakker",
    channel: "linkedin_inmail",
    daily_limit: 30,
    weekly_limit: 100,
    current_day_count: 12,
    current_week_count: 47,
  },
  {
    recruiter_id: "user-1",
    recruiter_name: "Emma Bakker",
    channel: "email",
    daily_limit: 100,
    weekly_limit: 400,
    current_day_count: 38,
    current_week_count: 142,
  },
  {
    recruiter_id: "user-2",
    recruiter_name: "Jan Peters",
    channel: "linkedin_inmail",
    daily_limit: 30,
    weekly_limit: 100,
    current_day_count: 22,
    current_week_count: 88,
  },
  {
    recruiter_id: "user-2",
    recruiter_name: "Jan Peters",
    channel: "email",
    daily_limit: 100,
    weekly_limit: 400,
    current_day_count: 67,
    current_week_count: 245,
  },
  {
    recruiter_id: "user-3",
    recruiter_name: "Lisa Smits",
    channel: "linkedin_connection",
    daily_limit: 50,
    weekly_limit: 200,
    current_day_count: 18,
    current_week_count: 72,
  },
];

// ─── Nurture sequences mock state ────────────────────────────────────────────

export const mockNurtureSequences: NurtureSequence[] = [
  {
    id: "seq-1",
    name: "Senior Data Engineer — Cold outbound",
    description: "Standaard 4-step funnel voor passive sourcing",
    active: true,
    total_steps: 4,
    created_at: sourcingOffset(-200),
  },
  {
    id: "seq-2",
    name: "Frontend Lead — Design-system focus",
    description: "Persoonlijker tempo, 3 steps",
    active: true,
    total_steps: 3,
    created_at: sourcingOffset(-150),
  },
  {
    id: "seq-3",
    name: "Reactivatie — afgewezen na finale",
    description: "Re-engagement na 6 maanden",
    active: true,
    total_steps: 5,
    created_at: sourcingOffset(-300),
  },
  {
    id: "seq-4",
    name: "Embedded C++ — Eindhoven niche",
    description: "Kleine talent pool, persoonlijke aanpak",
    active: false,
    total_steps: 4,
    created_at: sourcingOffset(-400),
  },
];

export const mockNurtureSteps: NurtureStep[] = [
  // seq-1 (4)
  {
    id: "step-1-1",
    sequence_id: "seq-1",
    step_order: 1,
    channel: "linkedin_inmail",
    delay_days: 0,
    ai_personalize: true,
    template_subject: "Snowflake-rol — interesse?",
    template_body:
      "Hi {first_name},\n\n{personalized_opener}\n\nWe hebben een rol bij een fintech in {city}.\n\nGroet,\n{recruiter_name}",
    stop_on_reply: true,
  },
  {
    id: "step-1-2",
    sequence_id: "seq-1",
    step_order: 2,
    channel: "email",
    delay_days: 4,
    ai_personalize: true,
    template_subject: "Follow-up — Snowflake-rol",
    template_body: "Hi {first_name},\n\nKorte follow-up — relevante content meegestuurd.",
    stop_on_reply: true,
  },
  {
    id: "step-1-3",
    sequence_id: "seq-1",
    step_order: 3,
    channel: "linkedin_connection",
    delay_days: 7,
    ai_personalize: false,
    template_subject: null,
    template_body: "Connectie-verzoek met korte intro.",
    stop_on_reply: true,
  },
  {
    id: "step-1-4",
    sequence_id: "seq-1",
    step_order: 4,
    channel: "email",
    delay_days: 14,
    ai_personalize: true,
    template_subject: "Laatste outreach",
    template_body: "Hi {first_name},\n\nLaatste bericht — als ik niets hoor pauzeer ik 90 dagen.",
    stop_on_reply: true,
  },
  // seq-2 (3)
  {
    id: "step-2-1",
    sequence_id: "seq-2",
    step_order: 1,
    channel: "linkedin_inmail",
    delay_days: 0,
    ai_personalize: true,
    template_subject: "Frontend Lead — design-system",
    template_body: "Hi {first_name},\n\n{personalized_opener}",
    stop_on_reply: true,
  },
  {
    id: "step-2-2",
    sequence_id: "seq-2",
    step_order: 2,
    channel: "email",
    delay_days: 5,
    ai_personalize: true,
    template_subject: "Interesse?",
    template_body: "Volgens onze data heb je {signal} — wil je vrijblijvend kletsen?",
    stop_on_reply: true,
  },
  {
    id: "step-2-3",
    sequence_id: "seq-2",
    step_order: 3,
    channel: "email",
    delay_days: 12,
    ai_personalize: false,
    template_subject: "Wrap-up",
    template_body: "Sluit dit dossier — tot ziens.",
    stop_on_reply: true,
  },
  // seq-3 (5)
  ...Array.from({ length: 5 }).map<NurtureStep>((_, i) => ({
    id: `step-3-${i + 1}`,
    sequence_id: "seq-3",
    step_order: i + 1,
    channel: (["email", "email", "linkedin_inmail", "email", "email"] as const)[i],
    delay_days: [0, 7, 14, 30, 60][i],
    ai_personalize: i !== 2,
    template_subject: `Reactivatie ${i + 1}`,
    template_body: `Reactivatie-stap ${i + 1} — context wordt door AI ingevuld.`,
    stop_on_reply: true,
  })),
  // seq-4 (4)
  ...Array.from({ length: 4 }).map<NurtureStep>((_, i) => ({
    id: `step-4-${i + 1}`,
    sequence_id: "seq-4",
    step_order: i + 1,
    channel: (["email", "linkedin_inmail", "email", "email"] as const)[i],
    delay_days: [0, 5, 10, 20][i],
    ai_personalize: i % 2 === 0,
    template_subject: `Embedded C++ ${i + 1}`,
    template_body: "Persoonlijke aanpak voor niche talent pool.",
    stop_on_reply: true,
  })),
];

export const mockNurtureEnrollments: NurtureEnrollment[] = [
  {
    id: "enr-1",
    candidate_id: "cand-1",
    candidate_name: "Sven Visser",
    finding_id: "find-1",
    sequence_id: "seq-1",
    sequence_name: "Senior Data Engineer — Cold outbound",
    status: "pending_approval",
    current_step_order: 1,
    next_send_at: sourcingOffset(2),
    enrolled_at: sourcingOffset(-1),
    stopped_at: null,
    stopped_reason: null,
  },
  {
    id: "enr-2",
    candidate_id: "cand-2",
    candidate_name: "Mei Chen",
    finding_id: "find-2",
    sequence_id: "seq-1",
    sequence_name: "Senior Data Engineer — Cold outbound",
    status: "active",
    current_step_order: 2,
    next_send_at: sourcingOffset(48),
    enrolled_at: sourcingOffset(-72),
    stopped_at: null,
    stopped_reason: null,
  },
  {
    id: "enr-3",
    candidate_id: "cand-3",
    candidate_name: "Tomasz Kowalski",
    finding_id: "find-3",
    sequence_id: "seq-1",
    sequence_name: "Senior Data Engineer — Cold outbound",
    status: "active",
    current_step_order: 3,
    next_send_at: sourcingOffset(72),
    enrolled_at: sourcingOffset(-120),
    stopped_at: null,
    stopped_reason: null,
  },
  {
    id: "enr-4",
    candidate_id: "cand-7",
    candidate_name: "Wei Zhang",
    finding_id: "find-12",
    sequence_id: "seq-2",
    sequence_name: "Frontend Lead — Design-system focus",
    status: "active",
    current_step_order: 1,
    next_send_at: sourcingOffset(24),
    enrolled_at: sourcingOffset(-2),
    stopped_at: null,
    stopped_reason: null,
  },
  {
    id: "enr-5",
    candidate_id: "cand-5",
    candidate_name: "Pieter Bakker",
    finding_id: "find-9",
    sequence_id: "seq-2",
    sequence_name: "Frontend Lead — Design-system focus",
    status: "paused",
    current_step_order: 2,
    next_send_at: null,
    enrolled_at: sourcingOffset(-200),
    stopped_at: sourcingOffset(-20),
    stopped_reason: null,
  },
  {
    id: "enr-6",
    candidate_id: "cand-4",
    candidate_name: "Anouk de Vries",
    finding_id: "find-4",
    sequence_id: "seq-1",
    sequence_name: "Senior Data Engineer — Cold outbound",
    status: "replied",
    current_step_order: 1,
    next_send_at: null,
    enrolled_at: sourcingOffset(-50),
    stopped_at: sourcingOffset(-30),
    stopped_reason: "reply_received",
  },
  {
    id: "enr-7",
    candidate_id: "cand-6",
    candidate_name: "Yara El Amrani",
    finding_id: "find-10",
    sequence_id: "seq-2",
    sequence_name: "Frontend Lead — Design-system focus",
    status: "completed",
    current_step_order: 3,
    next_send_at: null,
    enrolled_at: sourcingOffset(-400),
    stopped_at: sourcingOffset(-100),
    stopped_reason: "sequence_completed",
  },
  {
    id: "enr-8",
    candidate_id: "cand-8",
    candidate_name: "Sara Lopez",
    finding_id: null,
    sequence_id: "seq-3",
    sequence_name: "Reactivatie — afgewezen na finale",
    status: "active",
    current_step_order: 2,
    next_send_at: sourcingOffset(48),
    enrolled_at: sourcingOffset(-180),
    stopped_at: null,
    stopped_reason: null,
  },
  {
    id: "enr-9",
    candidate_id: "cand-9",
    candidate_name: "Stefan Berg",
    finding_id: null,
    sequence_id: "seq-3",
    sequence_name: "Reactivatie — afgewezen na finale",
    status: "stopped",
    current_step_order: 1,
    next_send_at: null,
    enrolled_at: sourcingOffset(-220),
    stopped_at: sourcingOffset(-100),
    stopped_reason: "manual_stop",
  },
  {
    id: "enr-10",
    candidate_id: "cand-10",
    candidate_name: "Hannah Petersen",
    finding_id: null,
    sequence_id: "seq-2",
    sequence_name: "Frontend Lead — Design-system focus",
    status: "pending_approval",
    current_step_order: 1,
    next_send_at: sourcingOffset(4),
    enrolled_at: sourcingOffset(-0.5),
    stopped_at: null,
    stopped_reason: null,
  },
  {
    id: "enr-11",
    candidate_id: "cand-1",
    candidate_name: "Sven Visser",
    finding_id: null,
    sequence_id: "seq-3",
    sequence_name: "Reactivatie — afgewezen na finale",
    status: "active",
    current_step_order: 4,
    next_send_at: sourcingOffset(168),
    enrolled_at: sourcingOffset(-2400),
    stopped_at: null,
    stopped_reason: null,
  },
  {
    id: "enr-12",
    candidate_id: "cand-3",
    candidate_name: "Tomasz Kowalski",
    finding_id: null,
    sequence_id: "seq-2",
    sequence_name: "Frontend Lead — Design-system focus",
    status: "active",
    current_step_order: 1,
    next_send_at: sourcingOffset(12),
    enrolled_at: sourcingOffset(-0.2),
    stopped_at: null,
    stopped_reason: null,
  },
];

// ─── Sprint Q4.6 — WhatsApp / Voice / Omni-channel inbox mock data ──────────
// ─────────────────────────────────────────────────────────────────────────────

import type {
  VoiceIntegration,
  VoiceCall,
} from "@/lib/types/voice";
import type {
  WhatsAppIntegration,
  WhatsAppTemplate,
  WhatsAppMessage,
  WhatsAppConversation,
  WhatsAppConsent,
} from "@/lib/types/whatsapp";
import type {
  UnifiedThread,
  TimelineEvent,
  ChannelType,
} from "@/lib/types/inbox";

const q46Now = Date.now();
function q46Offset(hoursAgo: number): string {
  return new Date(q46Now - hoursAgo * 3_600_000).toISOString();
}

// WhatsApp integration — primary connected number
export const mockWhatsAppIntegration: WhatsAppIntegration = {
  id: "wa-int-1",
  status: "connected",
  phone_number: "+31 6 1234 5678",
  display_name: "TechRecruit B.V.",
  waba_id: "waba_487291",
  quality_rating: "green",
  messaging_limit: "10K / 24h",
  connected_at: q46Offset(720),
  last_health_check_at: q46Offset(0.5),
  last_error: null,
};

// Voice (Twilio) integration
export const mockVoiceIntegration: VoiceIntegration = {
  id: "voice-int-1",
  status: "connected",
  phone_number: "+31 20 8080 808",
  account_sid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  connected_at: q46Offset(1100),
  last_error: null,
};

// 6 WhatsApp templates — mix of approved/submitted/rejected
export const mockWhatsAppTemplates: WhatsAppTemplate[] = [
  {
    id: "wa-tpl-1",
    name: "interview_uitnodiging_nl",
    language: "nl",
    category: "utility",
    status: "approved",
    header: { type: "text", text: "Uitnodiging gesprek bij {{1}}" },
    body:
      "Hoi {{1}},\n\nWe zouden je graag uitnodigen voor een kennismakingsgesprek op {{2}} om {{3}} bij ons kantoor in {{4}}.\n\nLaat het ons weten als deze datum lukt.",
    footer: "TechRecruit B.V.",
    buttons: [
      { type: "quick_reply", text: "Ja, ik kom" },
      { type: "quick_reply", text: "Andere datum" },
    ],
    example_variables: ["Sophie", "donderdag 15 mei", "14:00", "Amsterdam"],
    rejection_reason: null,
    submitted_at: q46Offset(72),
    approved_at: q46Offset(70),
    created_at: q46Offset(72),
    updated_at: q46Offset(70),
  },
  {
    id: "wa-tpl-2",
    name: "feedback_na_gesprek_nl",
    language: "nl",
    category: "utility",
    status: "approved",
    header: null,
    body:
      "Hoi {{1}}, bedankt voor het gesprek vandaag! We laten je binnen 5 werkdagen weten hoe we verder gaan. Vragen? Reageer gerust op dit bericht.",
    footer: null,
    buttons: [],
    example_variables: ["Thomas"],
    rejection_reason: null,
    submitted_at: q46Offset(168),
    approved_at: q46Offset(166),
    created_at: q46Offset(168),
    updated_at: q46Offset(166),
  },
  {
    id: "wa-tpl-3",
    name: "opt_in_uitnodiging_nl",
    language: "nl",
    category: "utility",
    status: "approved",
    header: { type: "text", text: "WhatsApp-toestemming" },
    body:
      "Hoi {{1}}, mogen we je via WhatsApp updates sturen over je sollicitatie bij {{2}}? Klik op de link om dit te bevestigen: {{3}}",
    footer: "Je kunt je toestemming altijd intrekken.",
    buttons: [{ type: "url", text: "Toestemming geven", url: "https://example.com/opt-in/{{3}}" }],
    example_variables: ["Sophie", "TechRecruit", "TOKEN"],
    rejection_reason: null,
    submitted_at: q46Offset(240),
    approved_at: q46Offset(238),
    created_at: q46Offset(240),
    updated_at: q46Offset(238),
  },
  {
    id: "wa-tpl-4",
    name: "follow_up_nieuwe_rol_nl",
    language: "nl",
    category: "marketing",
    status: "submitted",
    header: null,
    body:
      "Hoi {{1}}, we hebben een nieuwe {{2}}-rol die misschien interessant is. Wil je meer info? Reageer met 'ja' of bekijk de vacature: {{3}}",
    footer: null,
    buttons: [{ type: "url", text: "Bekijk rol", url: "https://example.com/jobs/{{3}}" }],
    example_variables: ["Sven", "Senior Frontend Developer", "ABC123"],
    rejection_reason: null,
    submitted_at: q46Offset(4),
    approved_at: null,
    created_at: q46Offset(6),
    updated_at: q46Offset(4),
  },
  {
    id: "wa-tpl-5",
    name: "reactivatie_zomer_2026",
    language: "nl",
    category: "marketing",
    status: "rejected",
    header: { type: "text", text: "Even checken" },
    body:
      "Hoi {{1}}!! Klik nu hier voor een GEWELDIGE aanbieding — werkdag van slechts 4 uur, salaris van €10K/maand!!! Beperkt aanbod!!!",
    footer: null,
    buttons: [],
    example_variables: ["Sven"],
    rejection_reason:
      "Inhoud bevat misleidende beloften en overmatige hoofdletters/uitroeptekens. WhatsApp staat geen onrealistische compensatie-claims toe.",
    submitted_at: q46Offset(96),
    approved_at: null,
    created_at: q46Offset(98),
    updated_at: q46Offset(94),
  },
  {
    id: "wa-tpl-6",
    name: "verificatie_code_nl",
    language: "nl",
    category: "authentication",
    status: "approved",
    header: null,
    body: "Je TalentFlow-verificatiecode is {{1}}. Geldig voor 10 minuten.",
    footer: "Deel deze code met niemand.",
    buttons: [{ type: "quick_reply", text: "Code kopiëren" }],
    example_variables: ["482917"],
    rejection_reason: null,
    submitted_at: q46Offset(480),
    approved_at: q46Offset(478),
    created_at: q46Offset(480),
    updated_at: q46Offset(478),
  },
];

// WhatsApp consents — 1 row per candidate (granted / pending / withdrawn mix)
export const mockWhatsAppConsents: WhatsAppConsent[] = [
  {
    id: "wa-consent-1",
    candidate_id: "cand-1",
    candidate_name: "Sven Visser",
    phone_number: "+31 6 1111 1111",
    status: "granted",
    opt_in_source: "landing_page",
    granted_at: q46Offset(240),
    withdrawn_at: null,
    withdrawal_reason: null,
  },
  {
    id: "wa-consent-2",
    candidate_id: "cand-2",
    candidate_name: "Sophie van den Berg",
    phone_number: "+31 6 2222 2222",
    status: "granted",
    opt_in_source: "whatsapp_template",
    granted_at: q46Offset(96),
    withdrawn_at: null,
    withdrawal_reason: null,
  },
  {
    id: "wa-consent-3",
    candidate_id: "cand-3",
    candidate_name: "Thomas Janssen",
    phone_number: "+31 6 3333 3333",
    status: "granted",
    opt_in_source: "application_form",
    granted_at: q46Offset(48),
    withdrawn_at: null,
    withdrawal_reason: null,
  },
  {
    id: "wa-consent-4",
    candidate_id: "cand-4",
    candidate_name: "Lisa de Vries",
    phone_number: "+31 6 4444 4444",
    status: "pending",
    opt_in_source: "landing_page",
    granted_at: null,
    withdrawn_at: null,
    withdrawal_reason: null,
  },
  {
    id: "wa-consent-5",
    candidate_id: "cand-5",
    candidate_name: "Mike Brown",
    phone_number: "+31 6 5555 5555",
    status: "withdrawn",
    opt_in_source: "landing_page",
    granted_at: q46Offset(720),
    withdrawn_at: q46Offset(72),
    withdrawal_reason: "Te veel berichten",
  },
];

// 18 WhatsApp messages across 4 candidates
export const mockWhatsAppMessages: WhatsAppMessage[] = [
  // cand-1 conversation
  {
    id: "wa-msg-1",
    candidate_id: "cand-1",
    candidate_name: "Sven Visser",
    conversation_id: "wa-conv-1",
    direction: "outbound",
    message_type: "template",
    template_id: "wa-tpl-1",
    body_text: "Hoi Sven, uitnodiging voor een gesprek op donderdag 15 mei om 14:00.",
    media_url: null,
    media_mime: null,
    status: "read",
    external_id: "wamid.abc1",
    sent_at: q46Offset(20),
    delivered_at: q46Offset(19.9),
    read_at: q46Offset(19.5),
    error_message: null,
    created_at: q46Offset(20),
  },
  {
    id: "wa-msg-2",
    candidate_id: "cand-1",
    candidate_name: "Sven Visser",
    conversation_id: "wa-conv-1",
    direction: "inbound",
    message_type: "text",
    template_id: null,
    body_text: "Hoi! Ja dat lukt. Tot dan!",
    media_url: null,
    media_mime: null,
    status: "received",
    external_id: "wamid.abc2",
    sent_at: q46Offset(19),
    delivered_at: q46Offset(19),
    read_at: q46Offset(19),
    error_message: null,
    created_at: q46Offset(19),
  },
  {
    id: "wa-msg-3",
    candidate_id: "cand-1",
    candidate_name: "Sven Visser",
    conversation_id: "wa-conv-1",
    direction: "outbound",
    message_type: "text",
    template_id: null,
    body_text: "Top! Heb je nog vragen vooraf?",
    media_url: null,
    media_mime: null,
    status: "read",
    external_id: "wamid.abc3",
    sent_at: q46Offset(18.5),
    delivered_at: q46Offset(18.5),
    read_at: q46Offset(18.4),
    error_message: null,
    created_at: q46Offset(18.5),
  },
  {
    id: "wa-msg-4",
    candidate_id: "cand-1",
    candidate_name: "Sven Visser",
    conversation_id: "wa-conv-1",
    direction: "inbound",
    message_type: "text",
    template_id: null,
    body_text: "Is het mogelijk om eerst een korte video-call te doen?",
    media_url: null,
    media_mime: null,
    status: "received",
    external_id: "wamid.abc4",
    sent_at: q46Offset(2),
    delivered_at: q46Offset(2),
    read_at: q46Offset(2),
    error_message: null,
    created_at: q46Offset(2),
  },
  // cand-2
  {
    id: "wa-msg-5",
    candidate_id: "cand-2",
    candidate_name: "Sophie van den Berg",
    conversation_id: "wa-conv-2",
    direction: "outbound",
    message_type: "template",
    template_id: "wa-tpl-2",
    body_text: "Hoi Sophie, bedankt voor het gesprek vandaag!",
    media_url: null,
    media_mime: null,
    status: "delivered",
    external_id: "wamid.abc5",
    sent_at: q46Offset(48),
    delivered_at: q46Offset(48),
    read_at: null,
    error_message: null,
    created_at: q46Offset(48),
  },
  {
    id: "wa-msg-6",
    candidate_id: "cand-2",
    candidate_name: "Sophie van den Berg",
    conversation_id: "wa-conv-2",
    direction: "inbound",
    message_type: "text",
    template_id: null,
    body_text: "Bedankt! Wanneer kan ik feedback verwachten?",
    media_url: null,
    media_mime: null,
    status: "received",
    external_id: "wamid.abc6",
    sent_at: q46Offset(45),
    delivered_at: q46Offset(45),
    read_at: q46Offset(45),
    error_message: null,
    created_at: q46Offset(45),
  },
  {
    id: "wa-msg-7",
    candidate_id: "cand-2",
    candidate_name: "Sophie van den Berg",
    conversation_id: "wa-conv-2",
    direction: "outbound",
    message_type: "text",
    template_id: null,
    body_text: "Uiterlijk maandag 11:00. We zijn enthousiast!",
    media_url: null,
    media_mime: null,
    status: "read",
    external_id: "wamid.abc7",
    sent_at: q46Offset(44),
    delivered_at: q46Offset(44),
    read_at: q46Offset(43.8),
    error_message: null,
    created_at: q46Offset(44),
  },
  {
    id: "wa-msg-8",
    candidate_id: "cand-2",
    candidate_name: "Sophie van den Berg",
    conversation_id: "wa-conv-2",
    direction: "outbound",
    message_type: "document",
    template_id: null,
    body_text: "Hier is de uitgebreide rolbeschrijving.",
    media_url: "https://example.com/role-frontend-lead.pdf",
    media_mime: "application/pdf",
    status: "delivered",
    external_id: "wamid.abc8",
    sent_at: q46Offset(43),
    delivered_at: q46Offset(43),
    read_at: null,
    error_message: null,
    created_at: q46Offset(43),
  },
  // cand-3
  {
    id: "wa-msg-9",
    candidate_id: "cand-3",
    candidate_name: "Thomas Janssen",
    conversation_id: "wa-conv-3",
    direction: "inbound",
    message_type: "text",
    template_id: null,
    body_text: "Hi, ik zag jullie vacature op LinkedIn — is die nog open?",
    media_url: null,
    media_mime: null,
    status: "received",
    external_id: "wamid.abc9",
    sent_at: q46Offset(8),
    delivered_at: q46Offset(8),
    read_at: q46Offset(8),
    error_message: null,
    created_at: q46Offset(8),
  },
  {
    id: "wa-msg-10",
    candidate_id: "cand-3",
    candidate_name: "Thomas Janssen",
    conversation_id: "wa-conv-3",
    direction: "outbound",
    message_type: "text",
    template_id: null,
    body_text: "Hoi Thomas! Ja, hij is nog open. Heb je tijd voor een korte intro deze week?",
    media_url: null,
    media_mime: null,
    status: "read",
    external_id: "wamid.abc10",
    sent_at: q46Offset(7.5),
    delivered_at: q46Offset(7.5),
    read_at: q46Offset(7),
    error_message: null,
    created_at: q46Offset(7.5),
  },
  {
    id: "wa-msg-11",
    candidate_id: "cand-3",
    candidate_name: "Thomas Janssen",
    conversation_id: "wa-conv-3",
    direction: "inbound",
    message_type: "text",
    template_id: null,
    body_text: "Donderdag of vrijdag werkt voor mij.",
    media_url: null,
    media_mime: null,
    status: "received",
    external_id: "wamid.abc11",
    sent_at: q46Offset(6),
    delivered_at: q46Offset(6),
    read_at: q46Offset(6),
    error_message: null,
    created_at: q46Offset(6),
  },
  {
    id: "wa-msg-12",
    candidate_id: "cand-3",
    candidate_name: "Thomas Janssen",
    conversation_id: "wa-conv-3",
    direction: "outbound",
    message_type: "text",
    template_id: null,
    body_text: "Perfect — donderdag 14:00 staat ingepland. Tot dan!",
    media_url: null,
    media_mime: null,
    status: "delivered",
    external_id: "wamid.abc12",
    sent_at: q46Offset(5),
    delivered_at: q46Offset(5),
    read_at: null,
    error_message: null,
    created_at: q46Offset(5),
  },
  // cand-4
  {
    id: "wa-msg-13",
    candidate_id: "cand-4",
    candidate_name: "Lisa de Vries",
    conversation_id: "wa-conv-4",
    direction: "outbound",
    message_type: "template",
    template_id: "wa-tpl-3",
    body_text: "Hoi Lisa, mogen we je via WhatsApp updates sturen over je sollicitatie?",
    media_url: null,
    media_mime: null,
    status: "delivered",
    external_id: "wamid.abc13",
    sent_at: q46Offset(72),
    delivered_at: q46Offset(72),
    read_at: null,
    error_message: null,
    created_at: q46Offset(72),
  },
  {
    id: "wa-msg-14",
    candidate_id: "cand-4",
    candidate_name: "Lisa de Vries",
    conversation_id: "wa-conv-4",
    direction: "outbound",
    message_type: "template",
    template_id: "wa-tpl-3",
    body_text: "Even een herinnering — opt-in link voor WhatsApp-updates.",
    media_url: null,
    media_mime: null,
    status: "sent",
    external_id: "wamid.abc14",
    sent_at: q46Offset(24),
    delivered_at: null,
    read_at: null,
    error_message: null,
    created_at: q46Offset(24),
  },
  {
    id: "wa-msg-15",
    candidate_id: "cand-1",
    candidate_name: "Sven Visser",
    conversation_id: "wa-conv-1",
    direction: "outbound",
    message_type: "image",
    template_id: null,
    body_text: "Foto van het kantoor 📷",
    media_url: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=800",
    media_mime: "image/jpeg",
    status: "read",
    external_id: "wamid.abc15",
    sent_at: q46Offset(17),
    delivered_at: q46Offset(17),
    read_at: q46Offset(16.5),
    error_message: null,
    created_at: q46Offset(17),
  },
  {
    id: "wa-msg-16",
    candidate_id: "cand-2",
    candidate_name: "Sophie van den Berg",
    conversation_id: "wa-conv-2",
    direction: "inbound",
    message_type: "text",
    template_id: null,
    body_text: "Top! Bedankt voor de PDF.",
    media_url: null,
    media_mime: null,
    status: "received",
    external_id: "wamid.abc16",
    sent_at: q46Offset(42),
    delivered_at: q46Offset(42),
    read_at: q46Offset(42),
    error_message: null,
    created_at: q46Offset(42),
  },
  {
    id: "wa-msg-17",
    candidate_id: "cand-3",
    candidate_name: "Thomas Janssen",
    conversation_id: "wa-conv-3",
    direction: "outbound",
    message_type: "text",
    template_id: null,
    body_text: "Tot zo!",
    media_url: null,
    media_mime: null,
    status: "failed",
    external_id: null,
    sent_at: q46Offset(1),
    delivered_at: null,
    read_at: null,
    error_message: "Recipient blocked sender",
    created_at: q46Offset(1),
  },
  {
    id: "wa-msg-18",
    candidate_id: "cand-1",
    candidate_name: "Sven Visser",
    conversation_id: "wa-conv-1",
    direction: "outbound",
    message_type: "text",
    template_id: null,
    body_text: "Ja, video-call is mogelijk. Stuur ik je een Google Meet-link.",
    media_url: null,
    media_mime: null,
    status: "sent",
    external_id: "wamid.abc18",
    sent_at: q46Offset(1.5),
    delivered_at: null,
    read_at: null,
    error_message: null,
    created_at: q46Offset(1.5),
  },
];

export const mockWhatsAppConversations: WhatsAppConversation[] = [
  {
    id: "wa-conv-1",
    candidate_id: "cand-1",
    candidate_name: "Sven Visser",
    last_inbound_at: q46Offset(2),
    last_message_at: q46Offset(1.5),
    session_open: true,
    session_expires_at: new Date(q46Now + 22 * 3_600_000).toISOString(),
    message_count: 7,
  },
  {
    id: "wa-conv-2",
    candidate_id: "cand-2",
    candidate_name: "Sophie van den Berg",
    last_inbound_at: q46Offset(42),
    last_message_at: q46Offset(42),
    session_open: false,
    session_expires_at: null,
    message_count: 4,
  },
  {
    id: "wa-conv-3",
    candidate_id: "cand-3",
    candidate_name: "Thomas Janssen",
    last_inbound_at: q46Offset(6),
    last_message_at: q46Offset(1),
    session_open: true,
    session_expires_at: new Date(q46Now + 18 * 3_600_000).toISOString(),
    message_count: 5,
  },
  {
    id: "wa-conv-4",
    candidate_id: "cand-4",
    candidate_name: "Lisa de Vries",
    last_inbound_at: null,
    last_message_at: q46Offset(24),
    session_open: false,
    session_expires_at: null,
    message_count: 2,
  },
];

// 12 voice calls — 4 inbound voicemails, 6 completed outbound, 2 missed
export const mockVoiceCalls: VoiceCall[] = [
  {
    id: "call-1",
    candidate_id: "cand-1",
    candidate_name: "Sven Visser",
    direction: "inbound",
    status: "voicemail",
    from_number: "+31 6 1111 1111",
    to_number: "+31 20 8080 808",
    duration_seconds: 38,
    recording_url: "https://example.com/recordings/call-1.mp3",
    transcription_text:
      "Hoi, met Sven. Ik wilde even vragen of de positie nog open is, en of we eventueel volgende week een gesprek kunnen plannen. Bel me terug, dankjewel.",
    transcription_status: "done",
    voicemail: true,
    notes: null,
    started_at: q46Offset(4),
    answered_at: null,
    ended_at: q46Offset(3.99),
    created_at: q46Offset(4),
  },
  {
    id: "call-2",
    candidate_id: "cand-2",
    candidate_name: "Sophie van den Berg",
    direction: "inbound",
    status: "voicemail",
    from_number: "+31 6 2222 2222",
    to_number: "+31 20 8080 808",
    duration_seconds: 52,
    recording_url: "https://example.com/recordings/call-2.mp3",
    transcription_text:
      "Hallo, met Sophie. Ik kreeg jullie mailtje over de Frontend Lead-rol. Klinkt interessant — graag terugbellen.",
    transcription_status: "done",
    voicemail: true,
    notes: "Direct terugbellen — sterke kandidaat.",
    started_at: q46Offset(28),
    answered_at: null,
    ended_at: q46Offset(27.99),
    created_at: q46Offset(28),
  },
  {
    id: "call-3",
    candidate_id: "cand-3",
    candidate_name: "Thomas Janssen",
    direction: "inbound",
    status: "voicemail",
    from_number: "+31 6 3333 3333",
    to_number: "+31 20 8080 808",
    duration_seconds: 21,
    recording_url: "https://example.com/recordings/call-3.mp3",
    transcription_text: "Met Thomas, bel me terug graag.",
    transcription_status: "done",
    voicemail: true,
    notes: null,
    started_at: q46Offset(56),
    answered_at: null,
    ended_at: q46Offset(55.99),
    created_at: q46Offset(56),
  },
  {
    id: "call-4",
    candidate_id: "cand-4",
    candidate_name: "Lisa de Vries",
    direction: "inbound",
    status: "voicemail",
    from_number: "+31 6 4444 4444",
    to_number: "+31 20 8080 808",
    duration_seconds: 67,
    recording_url: "https://example.com/recordings/call-4.mp3",
    transcription_text:
      "Hoi, met Lisa. Ik wil graag meer info over de rol, en ook over salaris en arbeidsvoorwaarden voordat ik solliciteer.",
    transcription_status: "done",
    voicemail: true,
    notes: null,
    started_at: q46Offset(96),
    answered_at: null,
    ended_at: q46Offset(95.99),
    created_at: q46Offset(96),
  },
  // 6 completed outbound
  {
    id: "call-5",
    candidate_id: "cand-1",
    candidate_name: "Sven Visser",
    direction: "outbound",
    status: "completed",
    from_number: "+31 20 8080 808",
    to_number: "+31 6 1111 1111",
    duration_seconds: 412,
    recording_url: "https://example.com/recordings/call-5.mp3",
    transcription_text:
      "Recruiter: Hoi Sven, dankjewel dat je terugbelt. — Sven: Geen probleem, ik ben benieuwd naar de rol. — Recruiter: Het is een Senior Frontend-positie, focus op design systems en performance. — Sven: Klinkt goed. Welk stack? — Recruiter: Next.js, React, TypeScript. — Sven: Top, dat is mijn stack. — Recruiter: Zullen we volgende week een gesprek plannen? — Sven: Ja graag, donderdag 14:00 lukt me. — Recruiter: Top, dan zet ik het in de agenda.",
    transcription_status: "done",
    voicemail: false,
    notes: "Geïnteresseerd. Gesprek donderdag 14:00 ingepland.",
    started_at: q46Offset(3.5),
    answered_at: q46Offset(3.48),
    ended_at: q46Offset(3.4),
    created_at: q46Offset(3.5),
  },
  {
    id: "call-6",
    candidate_id: "cand-2",
    candidate_name: "Sophie van den Berg",
    direction: "outbound",
    status: "completed",
    from_number: "+31 20 8080 808",
    to_number: "+31 6 2222 2222",
    duration_seconds: 285,
    recording_url: "https://example.com/recordings/call-6.mp3",
    transcription_text:
      "Recruiter: Hoi Sophie, ik bel terug op je voicemail. — Sophie: Top, dankjewel. — Recruiter: Wil je meer over de rol weten? — Sophie: Ja, wat zijn de teamgroottes? — Recruiter: 8 mensen in het frontend-team. — Sophie: Goed. Salarisrange? — Recruiter: €75K-90K. — Sophie: Werkt. Plan maar een gesprek in. — Recruiter: Top, donderdag stuur ik je een Calendly.",
    transcription_status: "done",
    voicemail: false,
    notes: "Salaris akkoord (€75-90K). Wacht op Calendly.",
    started_at: q46Offset(27),
    answered_at: q46Offset(26.99),
    ended_at: q46Offset(26.92),
    created_at: q46Offset(27),
  },
  {
    id: "call-7",
    candidate_id: "cand-3",
    candidate_name: "Thomas Janssen",
    direction: "outbound",
    status: "completed",
    from_number: "+31 20 8080 808",
    to_number: "+31 6 3333 3333",
    duration_seconds: 178,
    recording_url: "https://example.com/recordings/call-7.mp3",
    transcription_text: null,
    transcription_status: "pending",
    voicemail: false,
    notes: null,
    started_at: q46Offset(54),
    answered_at: q46Offset(53.99),
    ended_at: q46Offset(53.95),
    created_at: q46Offset(54),
  },
  {
    id: "call-8",
    candidate_id: "cand-4",
    candidate_name: "Lisa de Vries",
    direction: "outbound",
    status: "completed",
    from_number: "+31 20 8080 808",
    to_number: "+31 6 4444 4444",
    duration_seconds: 540,
    recording_url: "https://example.com/recordings/call-8.mp3",
    transcription_text:
      "Recruiter: Hoi Lisa, met TechRecruit. — Lisa: Hoi! Bedankt voor het terugbellen. — Recruiter: Geen dank — laat me wat meer over de rol vertellen…",
    transcription_status: "done",
    voicemail: false,
    notes: "Eerste intro gehad. Wacht op CV.",
    started_at: q46Offset(95),
    answered_at: q46Offset(94.99),
    ended_at: q46Offset(94.85),
    created_at: q46Offset(95),
  },
  {
    id: "call-9",
    candidate_id: "cand-5",
    candidate_name: "Mike Brown",
    direction: "outbound",
    status: "completed",
    from_number: "+31 20 8080 808",
    to_number: "+31 6 5555 5555",
    duration_seconds: 95,
    recording_url: "https://example.com/recordings/call-9.mp3",
    transcription_text: "Kort gesprek — Mike heeft afgezegd voor deze rol.",
    transcription_status: "done",
    voicemail: false,
    notes: "Afgehaakt — wil intern doorgroeien.",
    started_at: q46Offset(120),
    answered_at: q46Offset(119.99),
    ended_at: q46Offset(119.97),
    created_at: q46Offset(120),
  },
  {
    id: "call-10",
    candidate_id: "cand-1",
    candidate_name: "Sven Visser",
    direction: "outbound",
    status: "completed",
    from_number: "+31 20 8080 808",
    to_number: "+31 6 1111 1111",
    duration_seconds: 320,
    recording_url: "https://example.com/recordings/call-10.mp3",
    transcription_text: "Follow-up gesprek over teamcultuur.",
    transcription_status: "done",
    voicemail: false,
    notes: "Vragen over teamcultuur beantwoord.",
    started_at: q46Offset(48),
    answered_at: q46Offset(47.99),
    ended_at: q46Offset(47.91),
    created_at: q46Offset(48),
  },
  // 2 missed
  {
    id: "call-11",
    candidate_id: "cand-2",
    candidate_name: "Sophie van den Berg",
    direction: "outbound",
    status: "no_answer",
    from_number: "+31 20 8080 808",
    to_number: "+31 6 2222 2222",
    duration_seconds: 0,
    recording_url: null,
    transcription_text: null,
    transcription_status: null,
    voicemail: false,
    notes: null,
    started_at: q46Offset(72),
    answered_at: null,
    ended_at: q46Offset(71.98),
    created_at: q46Offset(72),
  },
  {
    id: "call-12",
    candidate_id: "cand-3",
    candidate_name: "Thomas Janssen",
    direction: "outbound",
    status: "busy",
    from_number: "+31 20 8080 808",
    to_number: "+31 6 3333 3333",
    duration_seconds: 0,
    recording_url: null,
    transcription_text: null,
    transcription_status: null,
    voicemail: false,
    notes: null,
    started_at: q46Offset(36),
    answered_at: null,
    ended_at: q46Offset(35.99),
    created_at: q46Offset(36),
  },
];

// 24 unified threads — mixed channels, realistic interleaving
function buildThread(
  i: number,
  cand: { id: string; name: string },
  channel: ChannelType,
  hoursAgo: number,
  preview: string,
  unread: number,
  pinned = false,
  assigneeUserId: string | null = "user-1",
  assigneeName?: string,
  labels: string[] = [],
  archived = false
): UnifiedThread {
  return {
    id: `thr-${i}`,
    candidate_id: cand.id,
    candidate_name: cand.name,
    last_message_at: q46Offset(hoursAgo),
    last_channel: channel,
    last_message_preview: preview,
    unread_count_for_assignee: unread,
    assignee_user_id: assigneeUserId,
    assignee_name: assigneeName ?? (assigneeUserId === "user-1" ? "Emma Bakker" : undefined),
    pinned,
    archived_at: archived ? q46Offset(hoursAgo - 24) : null,
    labels,
    created_at: q46Offset(hoursAgo + 24),
    updated_at: q46Offset(hoursAgo),
  };
}

export const mockUnifiedThreads: UnifiedThread[] = [
  buildThread(1, { id: "cand-1", name: "Sven Visser" }, "whatsapp", 2, "Is het mogelijk om eerst een korte video-call te doen?", 1, true, "user-1", "Emma Bakker", ["hot"]),
  buildThread(2, { id: "cand-2", name: "Sophie van den Berg" }, "voice", 27, "Voicemail: bel me terug graag (52s).", 1, true, "user-1", "Emma Bakker"),
  buildThread(3, { id: "cand-3", name: "Thomas Janssen" }, "whatsapp", 1, "Tot zo!", 0, false, "user-1", "Emma Bakker", ["interview"]),
  buildThread(4, { id: "cand-4", name: "Lisa de Vries" }, "email", 0.5, "Re: Senior PM rol — kan ik nog wat vragen stellen?", 2, false, "user-1", "Emma Bakker"),
  buildThread(5, { id: "cand-5", name: "Mike Brown" }, "linkedin_inmail", 4, "Bedankt voor de connectie. Helaas wil ik intern doorgroeien.", 0, false, "user-2", "Jan Peters"),
  buildThread(6, { id: "cand-1", name: "Sven Visser" }, "email", 26, "Voorstel voor donderdag 14:00 — past dit?", 0, false, "user-1", "Emma Bakker"),
  buildThread(7, { id: "cand-3", name: "Thomas Janssen" }, "voice", 53, "Outbound call — 178s. Transcriptie nog bezig.", 0, false, "user-1", "Emma Bakker"),
  buildThread(8, { id: "cand-2", name: "Sophie van den Berg" }, "whatsapp", 42, "Top! Bedankt voor de PDF.", 0, false, "user-1", "Emma Bakker"),
  buildThread(9, { id: "cand-4", name: "Lisa de Vries" }, "voice", 95, "Voicemail: vragen over arbeidsvoorwaarden (67s).", 0, false, "user-3", "Lisa Smits"),
  buildThread(10, { id: "cand-1", name: "Sven Visser" }, "linkedin_connection", 120, "Connectie geaccepteerd.", 0, false, null),
  buildThread(11, { id: "cand-2", name: "Sophie van den Berg" }, "email", 74, "Bevestiging gesprek vrijdag 09:30", 0, false, "user-1", "Emma Bakker"),
  buildThread(12, { id: "cand-3", name: "Thomas Janssen" }, "email", 168, "Bedankt voor de uitnodiging — ja, ik kom.", 0, false, "user-2", "Jan Peters"),
  buildThread(13, { id: "cand-5", name: "Mike Brown" }, "sms", 200, "Bevestiging: gesprek geannuleerd.", 0, false, "user-2", "Jan Peters", [], true),
  buildThread(14, { id: "cand-4", name: "Lisa de Vries" }, "whatsapp", 24, "Even een herinnering — opt-in link.", 0, false, "user-1", "Emma Bakker"),
  buildThread(15, { id: "cand-1", name: "Sven Visser" }, "voice", 3.5, "Outbound — 412s. Transcriptie beschikbaar.", 0, false, "user-1", "Emma Bakker", ["interview"]),
  buildThread(16, { id: "cand-2", name: "Sophie van den Berg" }, "voice", 27.5, "Outbound — 285s. Notities: salaris akkoord.", 0, false, "user-1", "Emma Bakker"),
  buildThread(17, { id: "cand-3", name: "Thomas Janssen" }, "sms", 480, "Reminder: gesprek morgen 11:00", 0, false, "user-1", "Emma Bakker"),
  buildThread(18, { id: "cand-4", name: "Lisa de Vries" }, "email", 8, "CV bijgevoegd — bedankt voor de uitleg.", 1, false, "user-3", "Lisa Smits", ["nieuw"]),
  buildThread(19, { id: "cand-5", name: "Mike Brown" }, "voice", 240, "Outbound — 95s. Mike heeft afgezegd.", 0, false, "user-2", "Jan Peters", [], true),
  buildThread(20, { id: "cand-1", name: "Sven Visser" }, "whatsapp", 17.5, "Foto van het kantoor", 0, false, "user-1", "Emma Bakker"),
  buildThread(21, { id: "cand-3", name: "Thomas Janssen" }, "linkedin_inmail", 360, "Open voor een gesprek? Bekijk onze rol.", 0, false, "user-1", "Emma Bakker"),
  buildThread(22, { id: "cand-2", name: "Sophie van den Berg" }, "email", 12, "Re: case-study feedback (PDF)", 1, false, "user-1", "Emma Bakker", ["case-study"]),
  buildThread(23, { id: "cand-4", name: "Lisa de Vries" }, "linkedin_connection", 700, "Connectie-verzoek verstuurd.", 0, false, "user-1", "Emma Bakker"),
  buildThread(24, { id: "cand-5", name: "Mike Brown" }, "email", 320, "Beleefd nee — bedankt voor het aanbod.", 0, false, "user-2", "Jan Peters", [], true),
];

// Timeline events per thread (richer detail for top threads)
export const mockTimelineEvents: Record<string, TimelineEvent[]> = {
  "thr-1": [
    {
      id: "te-1-1",
      channel: "whatsapp",
      direction: "inbound",
      timestamp: q46Offset(2),
      sender_name: "Sven Visser",
      preview: "Is het mogelijk om eerst een korte video-call te doen?",
      body: "Is het mogelijk om eerst een korte video-call te doen?",
      attachments: [],
      metadata: { status: "received" },
    },
    {
      id: "te-1-2",
      channel: "whatsapp",
      direction: "outbound",
      timestamp: q46Offset(17),
      sender_name: "Emma Bakker",
      preview: "Foto van het kantoor",
      body: "Hier is een foto van het kantoor 📷",
      attachments: [
        {
          url: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=800",
          mime: "image/jpeg",
          name: "kantoor.jpg",
        },
      ],
      metadata: { status: "read" },
    },
    {
      id: "te-1-3",
      channel: "whatsapp",
      direction: "outbound",
      timestamp: q46Offset(18.5),
      sender_name: "Emma Bakker",
      preview: "Top! Heb je nog vragen vooraf?",
      body: "Top! Heb je nog vragen vooraf?",
      attachments: [],
      metadata: { status: "read" },
    },
    {
      id: "te-1-4",
      channel: "whatsapp",
      direction: "inbound",
      timestamp: q46Offset(19),
      sender_name: "Sven Visser",
      preview: "Hoi! Ja dat lukt. Tot dan!",
      body: "Hoi! Ja dat lukt. Tot dan!",
      attachments: [],
      metadata: {},
    },
    {
      id: "te-1-5",
      channel: "whatsapp",
      direction: "outbound",
      timestamp: q46Offset(20),
      sender_name: "Emma Bakker",
      preview: "Hoi Sven, uitnodiging voor een gesprek op donderdag 15 mei…",
      body: "Hoi Sven, uitnodiging voor een gesprek op donderdag 15 mei om 14:00.",
      attachments: [],
      metadata: { template_id: "wa-tpl-1" },
    },
    {
      id: "te-1-6",
      channel: "voice",
      direction: "outbound",
      timestamp: q46Offset(3.5),
      sender_name: "Emma Bakker",
      preview: "Outbound call — 412s (6m 52s)",
      body: "Outbound call van 6 minuten 52 seconden. Notities: Gesprek donderdag 14:00 ingepland.",
      attachments: [
        { url: "https://example.com/recordings/call-5.mp3", mime: "audio/mp3", name: "call-5.mp3" },
      ],
      metadata: { call_id: "call-5", duration_seconds: 412 },
    },
    {
      id: "te-1-7",
      channel: "email",
      direction: "outbound",
      timestamp: q46Offset(26),
      sender_name: "Emma Bakker",
      preview: "Voorstel voor donderdag 14:00",
      body: "Hoi Sven,\n\nFijn dat je openstaat voor een gesprek. Voorstel: donderdag 14:00 in ons kantoor in Amsterdam.\n\nGroet,\nEmma",
      attachments: [],
      metadata: { subject: "Voorstel voor donderdag 14:00 — past dit?" },
    },
  ],
  "thr-2": [
    {
      id: "te-2-1",
      channel: "voice",
      direction: "inbound",
      timestamp: q46Offset(28),
      sender_name: "Sophie van den Berg",
      preview: "Voicemail — 52s",
      body:
        "Hallo, met Sophie. Ik kreeg jullie mailtje over de Frontend Lead-rol. Klinkt interessant — graag terugbellen.",
      attachments: [
        { url: "https://example.com/recordings/call-2.mp3", mime: "audio/mp3", name: "call-2.mp3" },
      ],
      metadata: { call_id: "call-2", duration_seconds: 52, voicemail: true },
    },
    {
      id: "te-2-2",
      channel: "voice",
      direction: "outbound",
      timestamp: q46Offset(27),
      sender_name: "Emma Bakker",
      preview: "Outbound call — 285s (4m 45s)",
      body: "Outbound call — Salaris akkoord (€75-90K). Wacht op Calendly.",
      attachments: [
        { url: "https://example.com/recordings/call-6.mp3", mime: "audio/mp3", name: "call-6.mp3" },
      ],
      metadata: { call_id: "call-6", duration_seconds: 285 },
    },
  ],
  "thr-3": [
    {
      id: "te-3-1",
      channel: "whatsapp",
      direction: "inbound",
      timestamp: q46Offset(8),
      sender_name: "Thomas Janssen",
      preview: "Hi, ik zag jullie vacature op LinkedIn — is die nog open?",
      body: "Hi, ik zag jullie vacature op LinkedIn — is die nog open?",
      attachments: [],
      metadata: {},
    },
    {
      id: "te-3-2",
      channel: "whatsapp",
      direction: "outbound",
      timestamp: q46Offset(7.5),
      sender_name: "Emma Bakker",
      preview: "Hoi Thomas! Ja, hij is nog open.",
      body: "Hoi Thomas! Ja, hij is nog open. Heb je tijd voor een korte intro deze week?",
      attachments: [],
      metadata: {},
    },
    {
      id: "te-3-3",
      channel: "whatsapp",
      direction: "inbound",
      timestamp: q46Offset(6),
      sender_name: "Thomas Janssen",
      preview: "Donderdag of vrijdag werkt voor mij.",
      body: "Donderdag of vrijdag werkt voor mij.",
      attachments: [],
      metadata: {},
    },
    {
      id: "te-3-4",
      channel: "whatsapp",
      direction: "outbound",
      timestamp: q46Offset(5),
      sender_name: "Emma Bakker",
      preview: "Perfect — donderdag 14:00 staat ingepland.",
      body: "Perfect — donderdag 14:00 staat ingepland. Tot dan!",
      attachments: [],
      metadata: {},
    },
    {
      id: "te-3-5",
      channel: "whatsapp",
      direction: "outbound",
      timestamp: q46Offset(1),
      sender_name: "Emma Bakker",
      preview: "Tot zo!",
      body: "Tot zo!",
      attachments: [],
      metadata: { error: "Recipient blocked sender", status: "failed" },
    },
  ],
};
