/**
 * Frontend-local types for the JD-generator (AI vacaturetekst-generator).
 *
 * Mirrors backend contracts owned by Agent VV:
 *   POST   /api/jobs/jd-drafts                          → JdDraft (with variants[])
 *   GET    /api/jobs/jd-drafts                          → JdDraft[]
 *   GET    /api/jobs/jd-drafts/:id                      → JdDraft
 *   POST   /api/jobs/jd-drafts/:id/select-variant       → JdDraft
 *   POST   /api/jobs/jd-drafts/:id/regenerate           → JdDraft (1 variant replaced)
 *   POST   /api/jobs/jd-drafts/:id/publish              → { draft, job }
 *
 * The shapes will eventually be promoted to `@talentflow/shared`. Until then
 * the local copy keeps the wizard strictly typed and lets the mock-fallback
 * hooks return well-shaped values.
 */

import type { BiasFlag } from "@/lib/types/jobDetail";

export type JdGeneratorLevel =
  | "junior"
  | "medior"
  | "senior"
  | "lead"
  | "director";

export type JdGeneratorTone =
  | "formal"
  | "casual"
  | "direct"
  | "enthusiastic";

export type JdGeneratorLength = "short" | "medium" | "long";

// Lowercase — moet exact matchen met de backend-zod-enum
// (jdGenerator.service.ts: z.enum(['nl','en','de','fr'])). Stond eerder
// uppercase ("NL"), waardoor élke generatie-poging op een 400
// VALIDATION_ERROR strandde nog vóór de AI-call ("Genereren mislukte").
export type JdGeneratorLanguage = "nl" | "en" | "de" | "fr";

export interface JdGeneratorInput {
  role: string;
  level: JdGeneratorLevel;
  key_skills: string[];
  must_haves: string[];
  nice_to_haves: string[];
  tone: JdGeneratorTone;
  length: JdGeneratorLength;
  language: JdGeneratorLanguage;
  company_context?: string;
}

export interface JdVariant {
  id: string;
  title: string;
  /** Markdown-formatted description. */
  description: string;
  bias_flags: BiasFlag[];
  /** 0..100 — language clarity. */
  clarity_score: number;
  /** 0..100 — inclusivity score (higher is better). */
  inclusivity_score: number;
  word_count: number;
}

export type JdDraftStatus = "draft" | "published" | "discarded";

export interface JdDraft {
  id: string;
  tenant_id: string;
  /** The role-input from step 1 — used for the list view title column. */
  role: string;
  /**
   * Live API alias. The backend (GET /jobs/jd-drafts) returns the role under
   * `prompt`, not `role`. Optional so the wizard + fixtures (which set `role`)
   * keep compiling; the list view reads `prompt ?? parameters?.role ?? role`.
   */
  prompt?: string;
  /** Snapshot of the entire generator-input so the wizard can be resumed. */
  input: JdGeneratorInput;
  /**
   * Live API alias for `input`. The backend persists the generator-parameters
   * under `parameters` and only stores the fields the recruiter actually
   * filled in — hence `Partial`. Read defensively: `parameters?.language`.
   */
  parameters?: Partial<JdGeneratorInput>;
  variants: JdVariant[];
  /** Currently selected variant (null until user picks one). */
  selected_variant_id: string | null;
  status: JdDraftStatus;
  /** Set when the draft is published — links the draft to the resulting job. */
  published_job_id: string | null;
  /** Live API alias for `published_job_id`. */
  job_id?: string | null;
  ai_disclosure: string;
  created_at: string;
  updated_at: string;
}

/**
 * Body for the publish endpoint. Lets the user override or extend variant
 * fields with operational data (location, salary, contract type, etc.) before
 * the backend turns the draft into a real `Job`.
 */
export interface JdDraftPublishOverrides {
  title?: string;
  description?: string;
  /** 'draft' = als concept opslaan; 'open' (backend-default) = direct live. */
  status?: "draft" | "open";
  department?: string;
  location?: string;
  employment_type?: string;
  experience_level?: string;
  remote_type?: string;
  salary_min?: number | null;
  salary_max?: number | null;
  currency?: string;
  /** monthly / annual / hourly — spiegelt de DB-CHECK op jobs.salary_frequency. */
  salary_frequency?: string;
  /** Beloningscriteria (EU 2023/970 art. 5). */
  compensation_criteria?: string | null;
  open_date?: string | null;
  close_date?: string | null;
  client?: string | null;
  job_reference?: string | null;
  headcount?: number | null;
  requirements?: string[];
}

export interface JdDraftPublishResponse {
  draft: JdDraft;
  job: { id: string; title: string };
}

export interface JdDraftListFilters {
  status?: JdDraftStatus | "all";
  date_from?: string | null;
  date_to?: string | null;
}
