import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Reference ID generator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Alphabet excluding visually ambiguous chars (O/0, I/1) — matches Manatal's
 * reference style (e.g. "Y5694WY99"). Upper-case alphanumeric only.
 */
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REFERENCE_LENGTH = 9;

export function generateCandidateReference(): string {
  let out = '';
  for (let i = 0; i < REFERENCE_LENGTH; i++) {
    out += REFERENCE_ALPHABET[Math.floor(Math.random() * REFERENCE_ALPHABET.length)];
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reusable primitives
// ─────────────────────────────────────────────────────────────────────────────

const optionalString = (max?: number) => {
  let s = z.string();
  if (max !== undefined) s = s.max(max);
  return s.optional();
};

const optionalNullableString = (max?: number) => {
  let s = z.string();
  if (max !== undefined) s = s.max(max);
  return s.optional().nullable();
};

const isoDate = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/,
    'Verwacht ISO datum (YYYY-MM-DD of volledige ISO timestamp)'
  );

const genderSchema = z.enum(['male', 'female', 'other', 'prefer_not']);

const candidateReferenceSchema = z
  .string()
  .min(8, 'Reference moet minimaal 8 tekens bevatten')
  .max(12, 'Reference mag maximaal 12 tekens bevatten')
  .regex(/^[A-Z0-9]+$/, 'Reference mag alleen hoofdletters en cijfers bevatten');

// ─────────────────────────────────────────────────────────────────────────────
// Pagination / list filters
// ─────────────────────────────────────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  skills: z.string().optional(), // comma-separated
  tags: z.string().optional(), // comma-separated
  source: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Create / update candidate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared field set used by both create and update. All Manatal-parity fields
 * are independently optional. The service applies sensible defaults where
 * the migration adds them (e.g. EUR for *_currency, false for *_consent).
 */
const candidateFieldsSchema = {
  // Identity
  name: z.string().min(1).max(200).optional(),
  first_name: optionalString(100),
  last_name: optionalString(100),
  email: z
    .string()
    .email()
    .optional()
    .or(z.literal(''))
    .transform((v) => v || undefined),
  phone: optionalString(50),

  // Reference (usually auto-generated; allow override)
  candidate_reference: candidateReferenceSchema.optional(),

  // Demographics
  gender: genderSchema.optional(),
  birthdate: isoDate.optional(),
  nationalities: z.array(z.string().min(1).max(80)).optional(),
  languages: z.array(z.string().min(1).max(80)).optional(),

  // Work details
  notice_period: optionalString(80),
  current_salary: z.number().nonnegative().optional(),
  current_salary_currency: optionalString(8),
  expected_salary: z.number().nonnegative().optional(),
  expected_salary_currency: optionalString(8),
  current_benefits: optionalString(2000),
  expected_benefits: optionalString(2000),
  years_of_experience: z.number().int().min(0).max(80).optional(),
  graduation_date: isoDate.optional(),
  current_department: optionalString(120),
  industry: optionalString(120),

  // Education
  diploma: optionalString(200),
  university: optionalString(200),

  // Address
  address_line1: optionalString(200),
  address_line2: optionalString(200),
  address_city: optionalString(120),
  address_country: optionalString(120),
  address_postal_code: optionalString(40),

  // Extra contact
  skype: optionalString(120),
  other_contact: optionalString(200),

  // Free text / sourcing
  description: z.string().max(20000).optional(),
  source: z.string().max(100).optional(),

  // GDPR / consent
  gdpr_consent: z.boolean().optional(),
  gdpr_consent_at: isoDate.optional(),
  email_consent: z.boolean().optional(),
  email_consent_at: isoDate.optional(),

  // Legacy columns retained for backwards compatibility
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  skills: z.array(z.string()).optional(),
};

export const createCandidateSchema = z
  .object(candidateFieldsSchema)
  .refine(
    (d) => Boolean(d.name || d.first_name || d.last_name),
    'Geef minimaal name of first_name+last_name op'
  );

/**
 * Update schema: all fields optional + nullable (so the client can clear
 * values where the column is nullable). We can't simply call .partial()
 * on createCandidateSchema because that doesn't add `.nullable()`.
 */
export const updateCandidateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    first_name: optionalNullableString(100),
    last_name: optionalNullableString(100),
    email: z.string().email().optional().nullable(),
    phone: optionalNullableString(50),

    candidate_reference: candidateReferenceSchema.optional().nullable(),

    gender: genderSchema.optional().nullable(),
    birthdate: isoDate.optional().nullable(),
    nationalities: z.array(z.string().min(1).max(80)).optional().nullable(),
    languages: z.array(z.string().min(1).max(80)).optional().nullable(),

    notice_period: optionalNullableString(80),
    current_salary: z.number().nonnegative().optional().nullable(),
    current_salary_currency: optionalNullableString(8),
    expected_salary: z.number().nonnegative().optional().nullable(),
    expected_salary_currency: optionalNullableString(8),
    current_benefits: optionalNullableString(2000),
    expected_benefits: optionalNullableString(2000),
    years_of_experience: z.number().int().min(0).max(80).optional().nullable(),
    graduation_date: isoDate.optional().nullable(),
    current_department: optionalNullableString(120),
    industry: optionalNullableString(120),

    diploma: optionalNullableString(200),
    university: optionalNullableString(200),

    address_line1: optionalNullableString(200),
    address_line2: optionalNullableString(200),
    address_city: optionalNullableString(120),
    address_country: optionalNullableString(120),
    address_postal_code: optionalNullableString(40),

    skype: optionalNullableString(120),
    other_contact: optionalNullableString(200),

    description: z.string().max(20000).optional().nullable(),
    source: z.string().max(100).optional().nullable(),

    gdpr_consent: z.boolean().optional(),
    gdpr_consent_at: isoDate.optional().nullable(),
    email_consent: z.boolean().optional(),
    email_consent_at: isoDate.optional().nullable(),

    // Legacy columns
    tags: z.array(z.string()).optional(),
    notes: z.string().optional().nullable(),
    skills: z.array(z.string()).optional(),
    ai_score: z.number().int().min(0).max(100).optional(),
  });

export type CreateCandidateInput = z.infer<typeof createCandidateSchema>;
export type UpdateCandidateInput = z.infer<typeof updateCandidateSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Candidate skills
// ─────────────────────────────────────────────────────────────────────────────

export const createCandidateSkillSchema = z.object({
  skill: z.string().min(1).max(120),
  score: z.number().int().min(1).max(10).optional(),
  source: z.enum(['manual', 'ai_extracted']).optional(),
});

export type CreateCandidateSkillInput = z.infer<typeof createCandidateSkillSchema>;
