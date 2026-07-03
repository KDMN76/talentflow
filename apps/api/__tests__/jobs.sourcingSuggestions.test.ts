/**
 * Tests voor GET /jobs/:id/sourcing-suggestions.
 *
 * Twee lagen:
 *   1. buildSourcingSuggestions — pure functie, geen DB nodig. Hier zit de
 *      determinisme-garantie: zelfde input → exact dezelfde output.
 *   2. getJobSourcingSuggestions — service met tenant-scoped DB-lookup,
 *      getest via de gedeelde pool-mock (zelfde patroon als sibling-services).
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  buildSourcingSuggestions,
  getJobSourcingSuggestions,
} from '../src/modules/jobs/jobDetail.service';
import { AppError } from '../src/middleware/errorHandler';
import { mockClient, installPoolMock, type MockClient } from './helpers/dbMock';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const JOB_ID = '22222222-2222-2222-2222-222222222222';

describe('buildSourcingSuggestions (pure)', () => {
  it('genereert exact de verwachte 5 strings voor een rijke job (deterministisch)', () => {
    const input = {
      title: 'Senior Java Developer',
      requiredSkills: ['Java', 'Spring', 'AWS'],
      niceToHaveSkills: ['Docker', 'Kubernetes'],
    };

    const result = buildSourcingSuggestions(input);

    expect(result).toEqual([
      '("java" OR "spring" OR "aws") AND "senior" site:linkedin.com/in',
      '"senior java developer" AND "java" AND "spring" AND "aws"',
      '("java" OR "spring" OR "aws") AND ("docker" OR "kubernetes") site:linkedin.com/in',
      '"senior java developer" site:linkedin.com/in',
      '("java" OR "spring" OR "aws") site:github.com',
    ]);

    // Determinisme: tweede aanroep met identieke input → identieke output.
    expect(buildSourcingSuggestions(input)).toEqual(result);
  });

  it('geeft altijd 3-5 suggesties zolang de job een titel heeft', () => {
    // Skill-loze job: varianten 4/5/6 vangen dit op.
    const bare = buildSourcingSuggestions({
      title: 'Office Manager',
      requiredSkills: [],
      niceToHaveSkills: [],
    });
    expect(bare).toEqual([
      '"office manager" site:linkedin.com/in',
      '"office manager" site:github.com',
      '"office manager" AND ("cv" OR "resume") -vacature -jobs',
    ]);

    // Rijke job: geclamped op 5.
    const rich = buildSourcingSuggestions({
      title: 'Senior Data Engineer',
      requiredSkills: ['Python', 'Airflow', 'dbt', 'Snowflake', 'Spark'],
      niceToHaveSkills: ['Terraform', 'Kafka'],
    });
    expect(rich.length).toBe(5);
    expect(new Set(rich).size).toBe(5); // geen duplicaten
  });

  it('clamped required skills op 4 termen in de OR-groep', () => {
    const result = buildSourcingSuggestions({
      title: 'Backend Developer',
      requiredSkills: ['A', 'B', 'C', 'D', 'E', 'F'],
      niceToHaveSkills: [],
    });
    expect(result[0]).toBe('("a" OR "b" OR "c" OR "d") site:linkedin.com/in');
  });

  it('filtert nice-to-have skills die al required zijn (case-insensitive)', () => {
    const result = buildSourcingSuggestions({
      title: 'DevOps Engineer',
      requiredSkills: ['Kubernetes', 'Terraform'],
      niceToHaveSkills: ['KUBERNETES', 'Go'],
    });
    // orGroup met één term rendert zonder haakjes: `"go"` i.p.v. `("go")`.
    expect(result).toContain(
      '("kubernetes" OR "terraform") AND "go" site:linkedin.com/in'
    );
  });

  it('stript dubbele quotes uit input zodat de boolean-strings niet breken', () => {
    const result = buildSourcingSuggestions({
      title: 'Senior "Rockstar" Developer',
      requiredSkills: ['C++ "expert"'],
      niceToHaveSkills: [],
    });
    for (const s of result) {
      // Elke suggestie heeft een even aantal quotes (alle termen netjes gequote).
      expect((s.match(/"/g) ?? []).length % 2).toBe(0);
      expect(s).not.toContain('""');
    }
  });

  it('dedupliceert required skills en negeert lege/whitespace-termen', () => {
    const result = buildSourcingSuggestions({
      title: 'QA Engineer',
      requiredSkills: ['Cypress', 'cypress', '  ', '', 'Playwright'],
      niceToHaveSkills: [],
    });
    expect(result[0]).toBe('("cypress" OR "playwright") site:linkedin.com/in');
  });

  it('geeft een lege lijst bij een job zonder titel en zonder skills', () => {
    expect(
      buildSourcingSuggestions({
        title: '',
        requiredSkills: [],
        niceToHaveSkills: [],
      })
    ).toEqual([]);
  });
});

describe('getJobSourcingSuggestions (service, tenant-scoped)', () => {
  let teardown: (() => void) | null = null;

  afterEach(() => {
    teardown?.();
    teardown = null;
  });

  function install(client: MockClient): void {
    teardown = installPoolMock(client);
  }

  it('haalt de job tenant-scoped op en geeft suggesties terug', async () => {
    const client = mockClient({
      jobs: [
        {
          title: 'Senior Java Developer',
          required_skills: ['Java', 'Spring'],
          nice_to_have_skills: ['Docker'],
        },
      ],
    });
    install(client);

    const result = await getJobSourcingSuggestions(TENANT_ID, JOB_ID);

    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.length).toBeLessThanOrEqual(5);
    expect(result.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);

    // Tenant-check: de lookup filtert op id + tenant_id + deleted_at,
    // zelfde patroon als de sibling-endpoints (team/notes/funnel).
    const jobQuery = client.query.mock.calls.find((call) =>
      /FROM jobs/i.test(String(call[0]))
    );
    expect(jobQuery).toBeDefined();
    const [sql, params] = jobQuery as unknown as [string, unknown[]];
    expect(sql).toMatch(/tenant_id\s*=\s*\$2/i);
    expect(sql).toMatch(/deleted_at IS NULL/i);
    expect(params).toEqual([JOB_ID, TENANT_ID]);
  });

  it('gooit AppError 404 JOB_NOT_FOUND voor een onbekende of andermans job', async () => {
    install(mockClient({ jobs: [] }));

    await expect(
      getJobSourcingSuggestions(TENANT_ID, JOB_ID)
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'JOB_NOT_FOUND',
    });
    await expect(
      getJobSourcingSuggestions(TENANT_ID, JOB_ID)
    ).rejects.toBeInstanceOf(AppError);
  });

  it('werkt ook wanneer de skill-kolommen NULL zijn (legacy rows)', async () => {
    install(
      mockClient({
        jobs: [
          {
            title: 'Office Manager',
            required_skills: null,
            nice_to_have_skills: null,
          },
        ],
      })
    );

    const result = await getJobSourcingSuggestions(TENANT_ID, JOB_ID);
    expect(result).toEqual([
      '"office manager" site:linkedin.com/in',
      '"office manager" site:github.com',
      '"office manager" AND ("cv" OR "resume") -vacature -jobs',
    ]);
  });
});
