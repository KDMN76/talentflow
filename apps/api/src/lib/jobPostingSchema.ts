/**
 * schema.org/JobPosting JSON-LD builder — Sprint Q2.2.
 *
 * Wordt door de SSR-pagina (Agent JJ) ingevoegd in de <head> van de publieke
 * career-page zodat Google for Jobs de vacatures kan indexeren.
 *
 * Spec: https://schema.org/JobPosting + https://developers.google.com/search/docs/appearance/structured-data/job-posting
 *
 * Strategie:
 *  - Wij bouwen het object best-effort: ontbrekende velden worden weggelaten
 *    i.p.v. als `null` of `""` opgenomen — Google's structured-data tester
 *    klaagt zodra een veld bestaat maar leeg is.
 *  - Alle Google-required velden (`title`, `description`, `datePosted`,
 *    `validThrough`, `hiringOrganization`, `jobLocation`) krijgen een
 *    fallback wanneer de bron leeg is, zodat de page valid blijft.
 *  - `validThrough` defaultt naar `datePosted + 90 dagen` als de job geen
 *    `close_date` heeft; Google penaliseert pages waar het ontbreekt.
 */

export interface JobPostingJobInput {
  id: string;
  title: string;
  description: string | null;
  department?: string | null;
  location?: string | null;
  office_address?: string | null;
  employment_type?: string | null;     // 'fulltime'|'parttime'|'contract'|'temp'|'internship'
  contract_type?: string | null;
  remote_type?: string | null;          // 'onsite'|'hybrid'|'remote'
  salary_min?: number | null;
  salary_max?: number | null;
  currency?: string | null;             // 'EUR' default
  salary_frequency?: string | null;     // 'monthly'|'annual'|'hourly'
  experience_level?: string | null;
  required_skills?: string[] | null;
  open_date?: string | Date | null;
  close_date?: string | Date | null;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
  industry?: string | null;
}

export interface JobPostingTenantInput {
  id: string;
  name: string;
  slug?: string | null;
  website_url?: string | null;
  logo_url?: string | null;
}

export interface JobPostingCareerPageInput {
  id: string;
  slug: string;
  custom_domain?: string | null;
  /** Origin van de career-page (bv. https://werken.acme.nl), zonder pad. */
  base_url?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping tables — schema.org employment-type-strings zijn enum-waarden;
// onze eigen TalentFlow-strings vertalen we hier.
// ─────────────────────────────────────────────────────────────────────────────

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  fulltime: 'FULL_TIME',
  full_time: 'FULL_TIME',
  parttime: 'PART_TIME',
  part_time: 'PART_TIME',
  contract: 'CONTRACTOR',
  contractor: 'CONTRACTOR',
  temp: 'TEMPORARY',
  temporary: 'TEMPORARY',
  intern: 'INTERN',
  internship: 'INTERN',
  volunteer: 'VOLUNTEER',
  per_diem: 'PER_DIEM',
  other: 'OTHER',
};

const SALARY_FREQUENCY_MAP: Record<string, string> = {
  monthly: 'MONTH',
  annual: 'YEAR',
  yearly: 'YEAR',
  hourly: 'HOUR',
  weekly: 'WEEK',
  daily: 'DAY',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function toIsoDate(d: string | Date | null | undefined): string | undefined {
  if (!d) return undefined;
  try {
    const date = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(date.getTime())) return undefined;
    return date.toISOString().slice(0, 10);
  } catch {
    return undefined;
  }
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function omitEmpty<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0)
      continue;
    out[k] = v;
  }
  return out as T;
}

function buildBaseUrl(
  tenant: JobPostingTenantInput,
  careerPage: JobPostingCareerPageInput
): string {
  if (careerPage.base_url) return careerPage.base_url.replace(/\/+$/, '');
  if (careerPage.custom_domain)
    return `https://${careerPage.custom_domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  // Fallback naar app-domein /careers/<slug>.
  const root = process.env.PUBLIC_APP_URL ?? 'https://app.talentflow.app';
  return `${root.replace(/\/+$/, '')}/careers/${careerPage.slug}`;
}

function buildLocation(job: JobPostingJobInput): object | undefined {
  // Remote-only vacatures: gebruik `applicantLocationRequirements` (Google for
  // Jobs convention). Voor onsite/hybrid: bouw Place + PostalAddress.
  const remote = (job.remote_type ?? '').toLowerCase();
  if (remote === 'remote') {
    return undefined; // Caller voegt `jobLocationType` + applicantLocationRequirements toe.
  }

  // PostalAddress samenstellen uit office_address (vrije tekst) + location-string.
  // We hebben geen gestructureerde split, dus we proberen redelijke heuristics.
  const address = job.office_address?.trim() || job.location?.trim() || '';
  if (!address) return undefined;

  // Heel simpele heuristic: als de string komma's bevat, splits op laatste komma
  // voor land/regio. Anders alles in `addressLocality`.
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  let addressLocality = parts[0] ?? '';
  let addressCountry: string | undefined;

  if (parts.length >= 2) {
    addressCountry = parts[parts.length - 1];
    addressLocality = parts.slice(0, -1).join(', ');
  }

  return {
    '@type': 'Place',
    address: omitEmpty({
      '@type': 'PostalAddress',
      streetAddress: address,
      addressLocality,
      addressCountry,
    }),
  };
}

function buildBaseSalary(job: JobPostingJobInput): object | undefined {
  const { salary_min, salary_max, currency, salary_frequency } = job;
  if (salary_min == null && salary_max == null) return undefined;

  const unitText = SALARY_FREQUENCY_MAP[(salary_frequency ?? '').toLowerCase()] ?? 'YEAR';

  // schema.org accepteert minValue/maxValue OR een vaste value.
  const value: Record<string, unknown> = { '@type': 'QuantitativeValue', unitText };
  if (salary_min != null && salary_max != null && salary_min === salary_max) {
    value.value = salary_min;
  } else {
    if (salary_min != null) value.minValue = salary_min;
    if (salary_max != null) value.maxValue = salary_max;
  }

  return {
    '@type': 'MonetaryAmount',
    currency: (currency ?? 'EUR').toUpperCase(),
    value,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bouw schema.org JobPosting JSON-LD object.
 *
 * @param job          Vacature-data (mag deels leeg zijn — fallbacks zorgen
 *                     dat het object validatie-bestendig blijft).
 * @param tenant       Tenant (organisatie-info voor `hiringOrganization`).
 * @param careerPage   Career-page (gebruikt voor `url` + sameAs).
 */
export function buildJobPostingJsonLd(
  job: JobPostingJobInput,
  tenant: JobPostingTenantInput,
  careerPage: JobPostingCareerPageInput
): Record<string, unknown> {
  const datePosted =
    toIsoDate(job.open_date) ??
    toIsoDate(job.created_at) ??
    new Date().toISOString().slice(0, 10);

  const validThrough =
    toIsoDate(job.close_date) ?? addDays(datePosted, 90);

  const employmentRaw = (job.employment_type ?? job.contract_type ?? '').toLowerCase();
  const employmentType = EMPLOYMENT_TYPE_MAP[employmentRaw];

  const baseUrl = buildBaseUrl(tenant, careerPage);
  const jobUrl = `${baseUrl}/jobs/${job.id}`;

  const hiringOrganization = omitEmpty({
    '@type': 'Organization',
    name: tenant.name,
    sameAs: tenant.website_url ?? undefined,
    logo: tenant.logo_url ?? undefined,
  });

  const remote = (job.remote_type ?? '').toLowerCase();

  const out: Record<string, unknown> = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: job.title?.trim() || 'Vacature',
    description:
      job.description && job.description.trim().length > 0
        ? job.description
        : `${tenant.name} zoekt een ${job.title}.`,
    identifier: {
      '@type': 'PropertyValue',
      name: tenant.name,
      value: job.id,
    },
    datePosted,
    validThrough,
    employmentType,
    hiringOrganization,
    industry: job.industry ?? undefined,
    url: jobUrl,
    directApply: true,
  };

  // Location handling — remote-only krijgt jobLocationType + applicantLocationRequirements.
  if (remote === 'remote') {
    out.jobLocationType = 'TELECOMMUTE';
    out.applicantLocationRequirements = {
      '@type': 'Country',
      name: 'NL',
    };
  } else {
    const location = buildLocation(job);
    if (location) out.jobLocation = location;
  }

  const baseSalary = buildBaseSalary(job);
  if (baseSalary) out.baseSalary = baseSalary;

  if (job.experience_level) {
    out.qualifications = `Ervaringsniveau: ${job.experience_level}`;
  }

  if (job.required_skills && job.required_skills.length > 0) {
    out.skills = job.required_skills.join(', ');
  }

  if (job.department) {
    out.occupationalCategory = job.department;
  }

  return omitEmpty(out);
}
