/**
 * Candidate-related shared types. Mirrors the database schema after the
 * `002_manatal_parity` migration (see apps/api/migrations/002_manatal_parity.sql).
 *
 * All fields except the immutable identifiers are optional/nullable on the
 * write path — clients only need to supply what they have. The API returns
 * the full hydrated row.
 */

// ────────────────────────────────────────────────────────────────────────────
// Enums / unions
// ────────────────────────────────────────────────────────────────────────────

export type Gender = 'male' | 'female' | 'other' | 'prefer_not';

export type CandidateSource =
  | 'career_page'
  | 'linkedin'
  | 'manual_import'
  | 'csv_import'
  | 'referral'
  | 'overig';

export type CandidateSkillSource = 'manual' | 'ai_extracted';

// ────────────────────────────────────────────────────────────────────────────
// Sub-resources
// ────────────────────────────────────────────────────────────────────────────

export interface CandidateSkill {
  id: string;
  candidate_id: string;
  skill: string;
  /** 1-10 inclusive when present. */
  score: number | null;
  source: CandidateSkillSource | null;
  created_at: string;
}

export type ResumeParseStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface CandidateResume {
  id: string;
  candidate_id: string;
  filename: string;
  storage_url: string;
  mime_type: string | null;
  size_bytes: number | null;
  is_primary: boolean;
  parsed_at: string | null;
  created_at: string;
  /** Storage backend object key (MinIO/S3). Populated by migration 003. */
  storage_key: string | null;
  /** AI-generated 3-line resume summary in candidate's primary language. */
  ai_summary: string | null;
  /** Parsing pipeline state. `done` → ai_summary is populated. `failed` → see parse_error. */
  parse_status: ResumeParseStatus;
  /** Human-readable error message when parse_status === 'failed'. */
  parse_error: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Candidate (full record)
// ────────────────────────────────────────────────────────────────────────────

export interface Candidate {
  // Core / system
  id: string;
  tenant_id: string;
  candidate_reference: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;

  // Identity
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;

  // Demographics
  gender: Gender | null;
  birthdate: string | null;
  nationalities: string[] | null;
  languages: string[] | null;

  // Work details
  notice_period: string | null;
  current_salary: number | null;
  current_salary_currency: string | null;
  expected_salary: number | null;
  expected_salary_currency: string | null;
  current_benefits: string | null;
  expected_benefits: string | null;
  years_of_experience: number | null;
  graduation_date: string | null;
  current_department: string | null;
  current_position: string | null;
  current_company: string | null;
  industry: string | null;

  // Education
  diploma: string | null;
  university: string | null;

  // Address
  address_line1: string | null;
  address_line2: string | null;
  address_city: string | null;
  address_country: string | null;
  address_postal_code: string | null;

  // Extra contact
  skype: string | null;
  other_contact: string | null;

  // Free text / sourcing
  description: string | null;
  source: CandidateSource | string | null;

  // GDPR / consent
  gdpr_consent: boolean;
  gdpr_consent_at: string | null;
  email_consent: boolean;
  email_consent_at: string | null;

  // Legacy / pre-existing columns retained for backwards compatibility
  resume_url: string | null;
  skills: string[] | null;
  ai_score: number | null;
  tags: string[] | null;
  notes: string | null;

  // Hydrated relations (populated by GET /candidates/:id)
  candidate_skills?: CandidateSkill[];
  resumes?: CandidateResume[];
}

// ────────────────────────────────────────────────────────────────────────────
// Write payloads
// ────────────────────────────────────────────────────────────────────────────

/**
 * Shape accepted by POST /candidates. All Manatal-parity fields are optional;
 * only `name` is required (the service falls back to first/last when only
 * those are supplied — see candidates.service).
 */
export interface CreateCandidateInput {
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;

  candidate_reference?: string;

  gender?: Gender;
  birthdate?: string;
  nationalities?: string[];
  languages?: string[];

  notice_period?: string;
  current_salary?: number;
  current_salary_currency?: string;
  expected_salary?: number;
  expected_salary_currency?: string;
  current_benefits?: string;
  expected_benefits?: string;
  years_of_experience?: number;
  graduation_date?: string;
  current_department?: string;
  current_position?: string;
  current_company?: string;
  industry?: string;

  diploma?: string;
  university?: string;

  address_line1?: string;
  address_line2?: string;
  address_city?: string;
  address_country?: string;
  address_postal_code?: string;

  skype?: string;
  other_contact?: string;

  description?: string;
  source?: string;

  gdpr_consent?: boolean;
  gdpr_consent_at?: string;
  email_consent?: boolean;
  email_consent_at?: string;

  // Legacy
  tags?: string[];
  notes?: string;
  skills?: string[];
}

/**
 * Shape accepted by PATCH /candidates/:id. Same as create but every field
 * is independently optional and `null` is allowed for clearing values where
 * the column is nullable.
 */
export type UpdateCandidateInput = Partial<{
  [K in keyof CreateCandidateInput]: CreateCandidateInput[K] | null;
}> & {
  ai_score?: number;
};

export interface CreateCandidateSkillInput {
  skill: string;
  score?: number;
  source?: CandidateSkillSource;
}
