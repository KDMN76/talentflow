/**
 * Job enums — single source of truth.
 *
 * Decision-rule (Sub-fase 2B): DB CHECK-constraints zijn de waarheid waar
 * ze bestaan. Frontend wordt aangepast om te matchen, niet omgekeerd.
 *
 * Mismatch-resolutie t.o.v. JOB_CONTRACT_AUDIT.md:
 *   - experience_level  : DB heeft junior/medior/senior/lead — frontend-
 *                          fantasie `intern` en `director` zijn verwijderd.
 *   - contract_type     : DB heeft fulltime/parttime/contract/temp —
 *                          frontend-fantasie `freelance`/`internship` zijn
 *                          verwijderd. (Voor freelance/internship gebruik je
 *                          employment_type, dat is een aparte kolom met
 *                          andere semantiek.)
 *   - salary_frequency  : DB heeft monthly/annual/hourly — frontend-
 *                          fantasie `yearly` is verwijderd; `annual` is
 *                          de DB-juiste term.
 *   - remote_type       : DB heeft onsite/hybrid/remote — frontend al
 *                          gealigneerd.
 *   - status            : DB heeft GEEN CHECK-constraint maar de set die
 *                          de backend Zod-laag accepteerde wint:
 *                          draft/open/filled/closed/archived. Frontend
 *                          mockData miste `archived` — toegevoegd.
 *   - employment_type   : DB heeft GEEN CHECK-constraint. Backend Zod-set
 *                          fulltime/parttime/contract/freelance/internship
 *                          behouden (geen DB-grond om te wijzigen). Dit
 *                          overlapt deels met contract_type — beide kolommen
 *                          bestaan naast elkaar in de DB, met verschillende
 *                          semantiek. Verwarrend, maar de huidige realiteit;
 *                          enum-rationalisatie buiten scope van 2B.
 */

export const JOB_STATUS_VALUES = [
  "draft",
  "open",
  "filled",
  "closed",
  "archived",
] as const;

export const JOB_EMPLOYMENT_TYPE_VALUES = [
  "fulltime",
  "parttime",
  "contract",
  "freelance",
  "internship",
] as const;

/** Matches DB CHECK constraint `jobs_contract_type_check`. */
export const JOB_CONTRACT_TYPE_VALUES = [
  "fulltime",
  "parttime",
  "contract",
  "temp",
] as const;

/** Matches DB CHECK constraint `jobs_experience_level_check`. */
export const JOB_EXPERIENCE_LEVEL_VALUES = [
  "junior",
  "medior",
  "senior",
  "lead",
] as const;

/** Matches DB CHECK constraint `jobs_remote_type_check`. */
export const JOB_REMOTE_TYPE_VALUES = ["onsite", "hybrid", "remote"] as const;

/** Matches DB CHECK constraint `jobs_salary_frequency_check`. */
export const JOB_SALARY_FREQUENCY_VALUES = [
  "monthly",
  "annual",
  "hourly",
] as const;

export type JobStatus = (typeof JOB_STATUS_VALUES)[number];
export type JobEmploymentType = (typeof JOB_EMPLOYMENT_TYPE_VALUES)[number];
export type JobContractType = (typeof JOB_CONTRACT_TYPE_VALUES)[number];
export type JobExperienceLevel = (typeof JOB_EXPERIENCE_LEVEL_VALUES)[number];
export type JobRemoteType = (typeof JOB_REMOTE_TYPE_VALUES)[number];
export type JobSalaryFrequency = (typeof JOB_SALARY_FREQUENCY_VALUES)[number];
