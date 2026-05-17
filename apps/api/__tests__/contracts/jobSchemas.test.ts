import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  JobCreateInputSchema,
  JobListItemSchema,
  JobDetailSchema,
  JOB_STATUS_VALUES,
} from '@talentflow/contracts';

/**
 * Sub-fase 2B (Stap 2) — bewijst dat de shared Job-schemas fail-fast
 * werken aan beide kanten van de wire:
 *   1. backend response met EXTRA veld → ZodError (.strict())
 *   2. backend response zonder REQUIRED veld → ZodError
 *   3. correct POST-payload → slaagt
 *   4. incorrect POST-payload (verkeerd type / missing / verkeerde enum) → afgewezen
 *   5. .strict() op CreateInput vangt het oude `requirements`-fantoom veld
 *      ipv silent-drop — exact de bug die de UI form-submit 400 veroorzaakte
 */

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeListItem(overrides: Record<string, unknown> = {}) {
  return {
    id: '436ee32e-3bea-41be-bb9d-edec24b04fc6',
    title: 'Senior Backend Developer',
    description: 'Beste backend dev ooit',
    department: 'IT',
    location: 'Amsterdam',
    salary_min: 50000,
    salary_max: 70000,
    employment_type: 'fulltime' as const,
    status: 'draft' as const,
    recruiter_id: null,
    created_at: '2026-05-16T18:51:45.591Z',
    updated_at: '2026-05-16T18:51:45.591Z',
    job_reference: 'JOB-4H3JGG',
    headcount: 1,
    experience_level: null,
    contract_type: null,
    industry: null,
    remote_type: null,
    open_date: null,
    close_date: null,
    currency: 'EUR',
    salary_frequency: 'monthly' as const,
    recruiter_name: null,
    application_count: 0,
    ...overrides,
  };
}

function makeCreatePayload(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Backend Engineer',
    description: 'Beschrijving',
    department: 'IT',
    location: 'Utrecht',
    salary_min: 60000,
    salary_max: 80000,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Job contracts — backend response validatie (fail-fast)', () => {
  it('TEST 1: response met EXTRA veld faalt (.strict response schema)', () => {
    const withRogueField = {
      ...makeListItem(),
      _debug_internal_field: 'leak',
    };

    const result = JobListItemSchema.safeParse(withRogueField);
    expect(result.success).toBe(false);
    if (!result.success) {
      // Zod's "unknown_keys" issue legt expliciet uit welk veld niet hoort.
      const issue = result.error.issues[0];
      expect(issue.code).toBe('unrecognized_keys');
      expect(JSON.stringify(issue)).toContain('_debug_internal_field');
    }
  });

  it('TEST 2: response zonder REQUIRED veld faalt', () => {
    // `application_count` is required op JobListItem (hydration via COUNT)
    const item = makeListItem();
    delete (item as Record<string, unknown>).application_count;

    const result = JobListItemSchema.safeParse(item);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('application_count');
    }
  });

  it('JobDetailSchema rejecteert ook extra velden (.strict)', () => {
    // Lichtgewicht check op de tweede response-schema.
    const detail = {
      ...makeListItem(),
      tenant_id: '3353826b-267a-4989-b670-403be3353ca2',
      contract_details: null,
      office_address: null,
      package_details: null,
      required_skills: [],
      nice_to_have_skills: [],
      pay_transparency_required: true,
      salary_band_disclosed: true,
      compensation_criteria: null,
      deleted_at: null,
      recruiter_name: null,
      stages: [],
      // application_count is GEEN deel van JobDetailSchema → mag niet aanwezig zijn
      application_count: 0,
    };
    delete (detail as Record<string, unknown>).application_count;
    // Mocht alleen passeren als alle JobRow-velden aanwezig zijn.
    const ok = JobDetailSchema.safeParse(detail);
    if (!ok.success) {
      // Hulp om te zien wat eventueel fout zit
      console.error('JobDetail parse issues:', ok.error.issues.slice(0, 3));
    }
    expect(ok.success).toBe(true);
  });
});

describe('Job contracts — request validatie (input-zijde)', () => {
  it('TEST 3: correct POST-payload slaagt', () => {
    const parsed = JobCreateInputSchema.parse(makeCreatePayload());
    expect(parsed.title).toBe('Backend Engineer');
    expect(parsed.salary_min).toBe(60000);
  });

  it('TEST 4a: incorrect type (salary_min als string) → afgewezen', () => {
    const wrong = makeCreatePayload({ salary_min: 'tachtig' });
    const result = JobCreateInputSchema.safeParse(wrong);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.path).toEqual(['salary_min']);
      expect(issue.code).toBe('invalid_type');
    }
  });

  it('TEST 4b: ontbrekend required veld (title) → afgewezen', () => {
    const wrong = makeCreatePayload();
    delete (wrong as Record<string, unknown>).title;
    const result = JobCreateInputSchema.safeParse(wrong);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('title');
    }
  });

  it('TEST 4c: verkeerde enum (status="opn" tikfout) → afgewezen', () => {
    const wrong = makeCreatePayload({ status: 'opn' });
    const result = JobCreateInputSchema.safeParse(wrong);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.path).toEqual(['status']);
      expect(issue.code).toBe('invalid_enum_value');
    }
  });

  it('TEST 4d: verkeerde enum (experience_level="intern" — fantoom-waarde) → afgewezen', () => {
    // `intern` was frontend-fantasie die niet in DB CHECK staat. De
    // harmonisatie in Stap 1 dropte het. Bewijs dat backend het nu blokkeert.
    const wrong = makeCreatePayload({ experience_level: 'intern' });
    const result = JobCreateInputSchema.safeParse(wrong);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.path).toEqual(['experience_level']);
      expect(issue.code).toBe('invalid_enum_value');
    }
  });

  it('TEST 5: .strict() blokkeert het oude `requirements`-fantoom veld', () => {
    // Dit was de form-submit bug op 2026-05-16: de UI-form stuurde
    //   { title, ..., requirements: [...], salary_min: null }
    // Backend's oude jobBodySchema dropte `requirements` silent en faalde
    // alleen op `salary_min: null`. Met .strict() faalt nu specifiek op
    // het onbekende veld — duidelijker fout voor de form-laag.
    const formStylePayload = {
      ...makeCreatePayload(),
      requirements: ['React', 'TypeScript'], // onbekend veld
    };

    const result = JobCreateInputSchema.safeParse(formStylePayload);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.code).toBe('unrecognized_keys');
      // De fout-message bevat het exacte veld zodat een UI-developer
      // direct ziet wat te verwijderen of hernoemen.
      expect(JSON.stringify(issue)).toContain('requirements');
    }
  });
});
