/**
 * Manatal → TalentFlow field mapping + value transformers.
 *
 * Centrale lookup-tabellen + parsers voor de cutover-import. Het import-script
 * (manatal-import.ts) consumeert deze mappings; de mapping-file is
 * service-onafhankelijk en bevat geen DB-IO zodat hij goed unit-testbaar is.
 *
 * Naming-conventie:
 *   - Sleutels = Manatal-CSV-kolomheader (case-sensitive, exacte spelling).
 *   - Waarden  = TalentFlow-veld op de target-tabel (snake_case).
 *
 * Onbekende kolommen worden bewust GENEGEERD i.p.v. error — Manatal voegt
 * zelf nieuwe velden toe per release; we willen niet dat iedere CSV-export
 * de import breekt zodra Manatal een kolom toevoegt.
 *
 * Documentatie van Manatal CSV-kolomnamen: zie docs/Manatal_Live_Tour.md.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CANDIDATES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manatal candidate-CSV header → TalentFlow `candidates` column.
 *
 * Manatal exporteert in twee dialecten (afhankelijk van workspace-locale):
 *   - "Candidate Name" / "Candidate Email Address" (lange vorm, default EN)
 *   - "Name" / "Email" (korte vorm, sommige tenant-exports)
 *
 * We mappen beide vormen naar dezelfde TalentFlow-kolom.
 */
export const MANATAL_TO_TALENTFLOW_CANDIDATE: Record<string, string> = {
  // Identity (lang + kort)
  'Candidate Name': 'name',
  'Name': 'name',
  'Candidate First Name': 'first_name',
  'First Name': 'first_name',
  'Candidate Last Name': 'last_name',
  'Last Name': 'last_name',
  'Candidate Reference': 'candidate_reference',
  'Reference': 'candidate_reference',

  // Contact
  'Candidate Email Address': 'email',
  'Candidate Email': 'email',
  'Email': 'email',
  'Email Address': 'email',
  'Candidate Phone Number': 'phone',
  'Candidate Phone': 'phone',
  'Phone': 'phone',
  'Phone Number': 'phone',
  'Mobile': 'phone',

  // Demographics
  'Birthdate': 'birthdate',
  'Date of Birth': 'birthdate',
  'Gender': 'gender',
  'Nationalities': 'nationalities',
  'Nationality': 'nationalities',
  'Languages': 'languages',
  'Language': 'languages',

  // Work
  'Current Position': 'current_position',
  'Job Title': 'current_position',
  'Title': 'current_position',
  'Current Company': 'current_company',
  'Company': 'current_company',
  'Employer': 'current_company',
  'Industry': 'industry',
  'Years of Experience': 'years_of_experience',
  'Experience': 'years_of_experience',
  'Notice Period': 'notice_period',
  'Current Salary': 'current_salary',
  'Current Salary Currency': 'current_salary_currency',
  'Expected Salary': 'expected_salary',
  'Expected Salary Currency': 'expected_salary_currency',
  'Current Benefits': 'current_benefits',
  'Expected Benefits': 'expected_benefits',
  'Graduation Date': 'graduation_date',
  'Current Department': 'current_department',
  'Department': 'current_department',

  // Education
  'Diploma': 'diploma',
  'Education': 'diploma',
  'University': 'university',
  'School': 'university',

  // Address
  'Candidate Location': 'address_city',
  'Location': 'address_city',
  'City': 'address_city',
  'Country': 'address_country',
  'Address Line 1': 'address_line1',
  'Address Line 2': 'address_line2',
  'Postal Code': 'address_postal_code',
  'Zip Code': 'address_postal_code',

  // Extra contact
  'Skype': 'skype',
  'Other Contact': 'other_contact',

  // Free text / sourcing
  'Source': 'source',
  'Tags': 'tags',
  'Skills': 'skills',
  'Candidate Description': 'description',
  'Description': 'description',
  'Notes': 'notes',

  // GDPR / consent
  'GDPR Consent': 'gdpr_consent',
  'GDPR Consent Date': 'gdpr_consent_at',
  'Email Consent': 'email_consent',
  'Email Consent Date': 'email_consent_at',

  // Metadata — we ignore created_at on import (DB sets its own) but accept
  // it as a known column so we don't surface an "unmapped" warning.
  'Created Date': '__manatal_created_at',
  'Created At': '__manatal_created_at',
  'Last Modified': '__manatal_last_modified',
};

// ─────────────────────────────────────────────────────────────────────────────
// JOBS
// ─────────────────────────────────────────────────────────────────────────────

export const MANATAL_TO_TALENTFLOW_JOB: Record<string, string> = {
  // Title
  'Job Title': 'title',
  'Position Name': 'title',
  'Title': 'title',

  // References + meta
  'Job Reference': 'job_reference',
  'Reference': 'job_reference',
  'Job Description': 'description',
  'Description': 'description',
  'Job Location': 'location',
  'Location': 'location',
  'Office Address': 'office_address',
  'Job Industry': 'industry',
  'Industry': 'industry',
  'Department': 'department',
  'Headcount': 'headcount',
  'Number of Openings': 'headcount',
  'Experience Level': 'experience_level',
  'Open Date': 'open_date',
  'Opening Date': 'open_date',
  'Close Date': 'close_date',
  'Closing Date': 'close_date',

  // Salary
  'Currency': 'currency',
  'Minimum Salary': 'salary_min',
  'Salary Min': 'salary_min',
  'Maximum Salary': 'salary_max',
  'Salary Max': 'salary_max',
  'Salary Frequency': 'salary_frequency',
  'Package Details': 'package_details',

  // Type
  'Employment Type': 'employment_type',
  'Contract Type': 'contract_type',
  'Contract Details': 'contract_details',
  'Remote Type': 'remote_type',
  'Work Mode': 'remote_type',

  // Status
  'Status': 'status',
  'Job Status': 'status',
};

/**
 * Manatal job-status → TalentFlow job-status.
 *
 * TalentFlow statuses (zie 001_init.sql `jobs.status`): geen formele CHECK,
 * maar conventie is 'draft' | 'open' | 'on_hold' | 'filled' | 'closed'.
 * Manatal heeft een rijkere set; "On Hold" → 'on_hold' is letterlijk
 * mapped; we voegen 'on_hold' niet toe aan tags omdat de kolom 'on_hold'
 * inmiddels gewoon werkt voor recruitment-bureaus die deze status gebruiken.
 */
export const MANATAL_STATUS_TO_TALENTFLOW: Record<string, string> = {
  'Planning': 'draft',
  'Draft': 'draft',
  'Active': 'open',
  'Open': 'open',
  'Published': 'open',
  'On Hold': 'on_hold',
  'Paused': 'on_hold',
  'Completed': 'filled',
  'Filled': 'filled',
  'Cancelled': 'closed',
  'Canceled': 'closed',
  'Closed': 'closed',
  'Archived': 'closed',
};

/**
 * Manatal default pipeline-stages voor recruitment-bureau accounts.
 * Volgorde matcht de seeded "Bureau Pipeline" template (migration 002).
 */
export const MANATAL_PIPELINE_STAGES = [
  'New Candidates',
  'Interested',
  'Shortlisted',
  'Client Submission',
  'Client Interview',
  'Offered',
  'Hired',
  'Started',
  'Probation passed',
] as const;

/**
 * Manatal stage → TalentFlow Bureau-Pipeline stage. Gebruikt in
 * applications-import om de stage_id te resolven via stage-naam.
 *
 * Voor stages die exact overeenkomen returnen we de input ongewijzigd.
 * Onbekende stages → undefined (caller skipt of fallt-back op eerste fase).
 */
export function resolveStageNameFromManatal(manatalStage: string): string | undefined {
  if (!manatalStage) return undefined;
  const normalised = manatalStage.trim();
  // Exact match in onze seeded pipeline-stages
  for (const stage of MANATAL_PIPELINE_STAGES) {
    if (stage.toLowerCase() === normalised.toLowerCase()) return stage;
  }
  // Veelvoorkomende synoniemen
  const synonyms: Record<string, string> = {
    'New': 'New Candidates',
    'Sourced': 'New Candidates',
    'Submitted': 'Client Submission',
    'Submission': 'Client Submission',
    'Interview': 'Client Interview',
    'Offer': 'Offered',
    'Placement': 'Hired',
    'Onboarding': 'Started',
    'Probation': 'Probation passed',
  };
  return synonyms[normalised];
}

// ─────────────────────────────────────────────────────────────────────────────
// Value transformers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse een Manatal-datum naar ISO-8601 (YYYY-MM-DD).
 *
 * Accepted input-formats:
 *   - 2024-01-15        (ISO)
 *   - 2024-01-15T10:30:00Z (ISO timestamp)
 *   - 15/01/2024        (DD/MM/YYYY — EU/Manatal-default)
 *   - 01/15/2024        (MM/DD/YYYY — US-locale Manatal-tenants)
 *   - 15-Jan-2024       (DD-MMM-YYYY — Manatal export-rapporten)
 *   - 15 January 2024   (lange vorm)
 *
 * Returnt null bij onparseable input — de caller logt een row-error.
 *
 * Heuristic voor DD/MM vs MM/DD: als eerste deel > 12 → DD/MM. Anders
 * gaan we uit van DD/MM (Manatal-default voor EU-tenants). Override via
 * env LOCALE_DATE_FORMAT='US' is mogelijk maar uit scope voor Q1.3.
 */
export function parseManatalDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;

  // ISO date or ISO timestamp — pass-through (extract YYYY-MM-DD)
  const isoMatch = /^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/.exec(trimmed);
  if (isoMatch) return isoMatch[1];

  // DD/MM/YYYY of MM/DD/YYYY (slash of dash)
  const slash = /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/.exec(trimmed);
  if (slash) {
    let [, a, b, y] = slash;
    let day: string, month: string;
    const ai = parseInt(a, 10);
    const bi = parseInt(b, 10);
    if (ai > 12 && bi <= 12) {
      day = a;
      month = b;
    } else if (bi > 12 && ai <= 12) {
      day = b;
      month = a;
    } else {
      // Ambigu — default DD/MM (EU, Manatal-default)
      day = a;
      month = b;
    }
    if (y.length === 2) {
      // 2-digit year: pivot 50 → 1950..2049 (matcht Excel/Manatal-default)
      const yi = parseInt(y, 10);
      y = (yi >= 50 ? 1900 + yi : 2000 + yi).toString();
    }
    const dd = day.padStart(2, '0');
    const mm = month.padStart(2, '0');
    if (parseInt(dd, 10) < 1 || parseInt(dd, 10) > 31) return null;
    if (parseInt(mm, 10) < 1 || parseInt(mm, 10) > 12) return null;
    return `${y}-${mm}-${dd}`;
  }

  // 15-Jan-2024 / 15 January 2024
  const monthNames: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    january: '01', february: '02', march: '03', april: '04',
    june: '06', july: '07', august: '08', september: '09',
    october: '10', november: '11', december: '12',
  };
  const named = /^(\d{1,2})[\s-]+([A-Za-z]+)[\s-]+(\d{2,4})$/.exec(trimmed);
  if (named) {
    const [, day, monthStr, yearStr] = named;
    const mm = monthNames[monthStr.toLowerCase()];
    if (!mm) return null;
    let y = yearStr;
    if (y.length === 2) {
      const yi = parseInt(y, 10);
      y = (yi >= 50 ? 1900 + yi : 2000 + yi).toString();
    }
    const dd = day.padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }

  return null;
}

/**
 * Parse een Manatal multi-value veld (tags, languages, nationalities) naar
 * een schoongemaakte string-array. Manatal exporteert deze met `, ` of `; `
 * als separator (afhankelijk van CSV dialect).
 */
export function parseManatalArray(input: string | null | undefined): string[] | null {
  if (input === null || input === undefined) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  return trimmed
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Parse een Manatal-boolean naar een echte boolean. Manatal exporteert
 * meerdere notaties — we accepteren alle gangbare.
 */
export function parseManatalBoolean(input: string | null | undefined): boolean | null {
  if (input === null || input === undefined) return null;
  const trimmed = String(input).trim().toLowerCase();
  if (!trimmed) return null;
  if (['yes', 'y', 'true', 't', '1', 'ja'].includes(trimmed)) return true;
  if (['no', 'n', 'false', 'f', '0', 'nee'].includes(trimmed)) return false;
  return null;
}

/**
 * Parse een Manatal-currency-string ("€55,000.00", "$55000", "55.000 EUR")
 * naar een float. Strips bekende currency-symbolen + thousand-separators.
 *
 * Heuristic voor decimaalteken (`,` vs `.`): als beide voorkomen, geldt de
 * laatste als decimaal. Als alleen `,`, en het ziet eruit als duizendtal
 * (3-digit groepen), gebruik dan punt als decimaal. Anders → komma als decimaal.
 */
export function parseManatalCurrency(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  // Strip currency-symbolen, currency-codes, en whitespace
  let s = trimmed
    .replace(/[€$£¥₹]/g, '')
    .replace(/\b(EUR|USD|GBP|JPY|INR|CHF|CAD|AUD|NOK|SEK|DKK)\b/gi, '')
    .replace(/\s+/g, '')
    .trim();
  if (!s) return null;

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    // Beide → laatste = decimaal, andere = thousand-sep
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot > lastComma) {
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(/\./g, '').replace(',', '.');
    }
  } else if (hasComma && !hasDot) {
    // Alleen komma. Als pattern matcht "1,234" of "1,234,567" → thousands.
    if (/^-?\d{1,3}(,\d{3})+$/.test(s)) {
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(',', '.');
    }
  }

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse een Manatal-gender-veld naar TalentFlow's enum.
 * TalentFlow accepteert: 'male' | 'female' | 'other' | 'prefer_not'.
 */
export function parseManatalGender(
  input: string | null | undefined
): 'male' | 'female' | 'other' | 'prefer_not' | null {
  if (!input) return null;
  const t = String(input).trim().toLowerCase();
  if (!t) return null;
  if (['male', 'm', 'man'].includes(t)) return 'male';
  if (['female', 'f', 'woman', 'vrouw'].includes(t)) return 'female';
  if (['other', 'non-binary', 'nb', 'x'].includes(t)) return 'other';
  if (
    [
      'none',
      'prefer not',
      'prefer not to say',
      'prefer_not',
      'undisclosed',
      'unknown',
      'n/a',
    ].includes(t)
  )
    return 'prefer_not';
  return null;
}

/**
 * Parse een integer-string. Lege/non-numerieke input → null.
 * Strips thousand-separators (komma + punt verwijderd in dat geval).
 */
export function parseManatalInteger(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  // Strip thousand-separators (komma's + punten in pure ints)
  const cleaned = trimmed.replace(/[\s,]/g, '');
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Row-level transformers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manatal CSV-velden die als TalentFlow-array geserialiseerd moeten worden.
 * Gebruikt door buildCandidatePayload + buildJobPayload.
 */
const ARRAY_FIELDS_CANDIDATE = new Set([
  'tags',
  'skills',
  'languages',
  'nationalities',
]);

const DATE_FIELDS_CANDIDATE = new Set([
  'birthdate',
  'graduation_date',
  'gdpr_consent_at',
  'email_consent_at',
]);

const NUMERIC_FIELDS_CANDIDATE = new Set([
  'current_salary',
  'expected_salary',
]);

const INTEGER_FIELDS_CANDIDATE = new Set(['years_of_experience']);

const BOOLEAN_FIELDS_CANDIDATE = new Set(['gdpr_consent', 'email_consent']);

const ARRAY_FIELDS_JOB = new Set(['required_skills', 'nice_to_have_skills']);

const DATE_FIELDS_JOB = new Set(['open_date', 'close_date']);

const NUMERIC_FIELDS_JOB = new Set(['salary_min', 'salary_max']);

const INTEGER_FIELDS_JOB = new Set(['headcount']);

/**
 * Convert one Manatal CSV-row → TalentFlow-candidate-payload (validated for
 * createCandidate). Onbekende kolommen worden genegeerd (logged door caller).
 *
 * Returnt `{ payload, unknownColumns }` zodat de caller kan rapporteren
 * over kolommen die niet konden worden gemapped.
 */
export interface BuiltPayload {
  payload: Record<string, unknown>;
  unknownColumns: string[];
}

export function buildCandidatePayload(row: Record<string, string>): BuiltPayload {
  const payload: Record<string, unknown> = {};
  const unknown: string[] = [];

  for (const [csvCol, rawVal] of Object.entries(row)) {
    const target = MANATAL_TO_TALENTFLOW_CANDIDATE[csvCol];
    if (!target) {
      // Negeer Manatal-meta-kolommen die we niet willen importeren.
      if (csvCol.toLowerCase().startsWith('candidate id') ||
          csvCol.toLowerCase() === 'id' ||
          csvCol.startsWith('__manatal_')) {
        continue;
      }
      unknown.push(csvCol);
      continue;
    }
    if (target.startsWith('__manatal_')) continue; // metadata: skip

    const trimmed = rawVal === null || rawVal === undefined ? '' : String(rawVal).trim();
    if (trimmed === '') continue; // lege cellen → laat DB-default werken

    if (BOOLEAN_FIELDS_CANDIDATE.has(target)) {
      const b = parseManatalBoolean(trimmed);
      if (b !== null) payload[target] = b;
      continue;
    }
    if (DATE_FIELDS_CANDIDATE.has(target)) {
      const d = parseManatalDate(trimmed);
      if (d !== null) payload[target] = d;
      continue;
    }
    if (NUMERIC_FIELDS_CANDIDATE.has(target)) {
      const n = parseManatalCurrency(trimmed);
      if (n !== null) payload[target] = n;
      continue;
    }
    if (INTEGER_FIELDS_CANDIDATE.has(target)) {
      const n = parseManatalInteger(trimmed);
      if (n !== null) payload[target] = n;
      continue;
    }
    if (ARRAY_FIELDS_CANDIDATE.has(target)) {
      const a = parseManatalArray(trimmed);
      if (a !== null && a.length > 0) payload[target] = a;
      continue;
    }
    if (target === 'gender') {
      const g = parseManatalGender(trimmed);
      if (g !== null) payload[target] = g;
      continue;
    }
    payload[target] = trimmed;
  }

  return { payload, unknownColumns: unknown };
}

export function buildJobPayload(row: Record<string, string>): BuiltPayload {
  const payload: Record<string, unknown> = {};
  const unknown: string[] = [];

  for (const [csvCol, rawVal] of Object.entries(row)) {
    const target = MANATAL_TO_TALENTFLOW_JOB[csvCol];
    if (!target) {
      if (csvCol.toLowerCase() === 'job id' || csvCol.toLowerCase() === 'id') {
        continue;
      }
      unknown.push(csvCol);
      continue;
    }
    const trimmed = rawVal === null || rawVal === undefined ? '' : String(rawVal).trim();
    if (trimmed === '') continue;

    if (target === 'status') {
      const mapped = MANATAL_STATUS_TO_TALENTFLOW[trimmed] ?? trimmed.toLowerCase();
      payload[target] = mapped;
      continue;
    }
    if (DATE_FIELDS_JOB.has(target)) {
      const d = parseManatalDate(trimmed);
      if (d !== null) payload[target] = d;
      continue;
    }
    if (NUMERIC_FIELDS_JOB.has(target)) {
      const n = parseManatalCurrency(trimmed);
      if (n !== null) payload[target] = n;
      continue;
    }
    if (INTEGER_FIELDS_JOB.has(target)) {
      const n = parseManatalInteger(trimmed);
      if (n !== null) payload[target] = n;
      continue;
    }
    if (ARRAY_FIELDS_JOB.has(target)) {
      const a = parseManatalArray(trimmed);
      if (a !== null && a.length > 0) payload[target] = a;
      continue;
    }
    payload[target] = trimmed;
  }

  return { payload, unknownColumns: unknown };
}

/**
 * Special key onthouden zodat het import-script tracking-keys kan extraheren
 * (Manatal-kandidaat-id of Manatal-job-id) zonder te raden.
 */
export const MANATAL_CANDIDATE_ID_COLUMNS = [
  'Candidate ID',
  'ID',
  'Manatal ID',
  'Internal ID',
];

export const MANATAL_JOB_ID_COLUMNS = ['Job ID', 'ID', 'Manatal Job ID'];

export function extractManatalId(
  row: Record<string, string>,
  candidates: readonly string[]
): string | null {
  for (const col of candidates) {
    if (col in row && row[col] && String(row[col]).trim()) {
      return String(row[col]).trim();
    }
  }
  return null;
}
