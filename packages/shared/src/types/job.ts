/**
 * Job-related shared types. Mirrors the database schema in
 * apps/api/migrations/001_init.sql (jobs + pipeline_stages).
 *
 * On creation, a job's pipeline is instantiated by cloning a
 * pipeline_template's stages into pipeline_stages. The default template
 * is the system "Bureau Pipeline" (see migration 002_manatal_parity).
 */

export type EmploymentType =
  | 'fulltime'
  | 'parttime'
  | 'contract'
  | 'freelance'
  | 'internship';

export type JobStatus = 'draft' | 'open' | 'filled' | 'closed' | 'archived';

/** UUID of the seeded system "Bureau Pipeline" template (migration 002). */
export const BUREAU_PIPELINE_TEMPLATE_ID =
  '00000000-0000-0000-0000-000000000001';

export interface PipelineStage {
  id: string;
  tenant_id: string;
  job_id: string;
  name: string;
  position: number;
  color: string;
  created_at: string;
  /** Hydrated by GET /jobs/:id and GET /pipeline/jobs/:jobId/stages. */
  application_count?: number;
}

/**
 * Manatal-pariteit unions added by migration 007. Re-exported here as part
 * of the canonical `Job` shape so consumers don't need to import job-detail
 * types just to talk about a single field.
 */
export type JobExperienceLevel = 'junior' | 'medior' | 'senior' | 'lead';
export type JobContractType = 'fulltime' | 'parttime' | 'contract' | 'temp';
export type JobRemoteType = 'onsite' | 'hybrid' | 'remote';
export type JobSalaryFrequency = 'monthly' | 'annual' | 'hourly';

export interface Job {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  department: string | null;
  location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  employment_type: EmploymentType | string;
  status: JobStatus | string;
  recruiter_id: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;

  /** Hydrated by GET /jobs/:id. */
  recruiter_name?: string | null;
  /** Hydrated by GET /jobs/:id. */
  stages?: PipelineStage[];

  // ─── Manatal-pariteit (migration 007) — all nullable/optional ─────────────
  job_reference?: string | null;
  headcount?: number | null;
  experience_level?: JobExperienceLevel | null;
  contract_type?: JobContractType | null;
  contract_details?: string | null;
  open_date?: string | null;
  close_date?: string | null;
  industry?: string | null;
  remote_type?: JobRemoteType | null;
  office_address?: string | null;
  package_details?: string | null;
  currency?: string | null;
  salary_frequency?: JobSalaryFrequency | null;
  required_skills?: string[] | null;
  nice_to_have_skills?: string[] | null;
}

export interface CreateJobInput {
  title: string;
  description?: string;
  department?: string;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  employment_type?: EmploymentType;
  status?: JobStatus;
  recruiter_id?: string | null;

  // Manatal-pariteit — optional on create
  job_reference?: string;
  headcount?: number;
  experience_level?: JobExperienceLevel;
  contract_type?: JobContractType;
  contract_details?: string;
  open_date?: string;
  close_date?: string;
  industry?: string;
  remote_type?: JobRemoteType;
  office_address?: string;
  package_details?: string;
  currency?: string;
  salary_frequency?: JobSalaryFrequency;
  required_skills?: string[];
  nice_to_have_skills?: string[];

  /**
   * Optional pipeline template UUID. If omitted, the system default
   * ("Bureau Pipeline") is used. The template's stages are cloned into
   * pipeline_stages for this job at creation time.
   */
  pipeline_template_id?: string;
}

export type UpdateJobInput = Partial<Omit<CreateJobInput, 'pipeline_template_id'>>;
