/**
 * PATCH /candidates/:id/skill-profile — write-pad tests.
 *
 * Pint het gedrag van `updateCandidateSkillProfile` vast:
 *   1. Round-trip: geschreven skills komen in EXACT dezelfde vorm terug als
 *      GET /skill-profile (esco_skills-array, category-aggregatie, matched_via
 *      afgeleid uit source).
 *   2. Tenant-check: een kandidaat die niet (in deze tenant) bestaat → 404.
 *   3. Onbekende esco_id → 400 (FK-veilig, nette fout i.p.v. INSERT-crash).
 *   4. Zod-validatie op de request-body wijst kapotte payloads af.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';
import * as skillsService from '../../src/modules/skills/skills.service';
import { updateCandidateProfileBody } from '../../src/modules/skills/skills.controller';
import { AppError } from '../../src/middleware/errorHandler';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const CAND = '33333333-3333-3333-3333-333333333333';

// System-wide ESCO-taxonomie zoals de mock 'm kent (id → label + category).
const CATALOGUE: Record<string, { preferred_label: string; category: string }> = {
  'esco-js': { preferred_label: 'JavaScript', category: 'technical' },
  'esco-team': { preferred_label: 'Teamwork', category: 'soft' },
};

interface StoredMapping {
  esco_skill_id: string;
  source_skill_text: string;
  confidence: number;
  proficiency: number;
  matched_via: string;
}

/**
 * Bouwt een stateful matcher die zich als een mini-DB gedraagt: INSERTs
 * persisteren in-memory, de read-back-SELECT leest ze (join met CATALOGUE)
 * terug. Zo test de round-trip écht write → read.
 */
function makeStore(opts: {
  candidateExists?: boolean;
  knownEscoIds?: string[];
} = {}) {
  const candidateExists = opts.candidateExists ?? true;
  const knownEscoIds = opts.knownEscoIds ?? Object.keys(CATALOGUE);
  const store: StoredMapping[] = [];
  let inserts = 0;

  const matcher = (sql: string, params: unknown[]) => {
    if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET\s)/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    if (/DELETE FROM candidate_skill_mappings/i.test(sql)) {
      store.length = 0;
      return { rows: [], rowCount: 0 };
    }
    if (/INSERT INTO candidate_skill_mappings/i.test(sql)) {
      inserts++;
      store.push({
        esco_skill_id: params[1] as string,
        source_skill_text: params[2] as string,
        confidence: Number(params[3]),
        proficiency: params[4] as number,
        matched_via: params[5] as string,
      });
      return { rows: [], rowCount: 1 };
    }
    if (/INSERT INTO activities/i.test(sql)) return { rows: [], rowCount: 1 };
    if (/INSERT INTO audit_events/i.test(sql)) return { rows: [], rowCount: 1 };
    // Read-back — moet vóór de esco-validatie-match komen (bevat ook esco_skills).
    if (/FROM candidate_skill_mappings m/i.test(sql)) {
      const rows = store
        .map((s) => ({
          esco_skill_id: s.esco_skill_id,
          preferred_label: CATALOGUE[s.esco_skill_id]?.preferred_label ?? '',
          category: CATALOGUE[s.esco_skill_id]?.category ?? null,
          proficiency: s.proficiency,
          confidence: s.confidence,
          source_skill_text: s.source_skill_text,
          matched_via: s.matched_via,
        }))
        .sort((a, b) => a.preferred_label.localeCompare(b.preferred_label));
      return { rows, rowCount: rows.length };
    }
    if (/FROM esco_skills WHERE id = ANY/i.test(sql)) {
      const requested = (params[0] as string[]) ?? [];
      const rows = requested
        .filter((id) => knownEscoIds.includes(id))
        .map((id) => ({ id }));
      return { rows, rowCount: rows.length };
    }
    if (/FROM candidates/i.test(sql)) {
      return candidateExists
        ? { rows: [{ id: CAND }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  };

  return {
    client: mockClient({ __matcher: matcher }),
    get inserts() {
      return inserts;
    },
    store,
  };
}

describe('skills.service.updateCandidateSkillProfile', () => {
  let teardown: (() => void) | undefined;
  afterEach(() => teardown?.());

  it('round-trip: geschreven skills komen in dezelfde esco_skills-vorm terug', async () => {
    const s = makeStore();
    const client = s.client as MockClient;
    teardown = installPoolMock(client);

    const result = await skillsService.updateCandidateSkillProfile(
      TENANT,
      CAND,
      USER,
      [
        {
          esco_id: 'esco-js',
          preferred_label: 'JavaScript',
          proficiency: 8,
          confidence: 1,
          source: 'esco_match',
        },
        {
          esco_id: 'esco-team',
          preferred_label: 'Teamwork',
          proficiency: 5,
          confidence: 0.9,
          source: 'embedding_match',
        },
      ]
    );

    expect(s.inserts).toBe(2);
    expect(result.candidate_id).toBe(CAND);
    expect(result.total_skills).toBe(2);
    // Sorted op preferred_label: JavaScript < Teamwork.
    expect(result.esco_skills[0]).toMatchObject({
      esco_skill_id: 'esco-js',
      preferred_label: 'JavaScript',
      category: 'technical',
      proficiency: 8,
      confidence: 1,
      matched_via: 'exact', // source esco_match → exact
    });
    expect(result.esco_skills[1]).toMatchObject({
      esco_skill_id: 'esco-team',
      preferred_label: 'Teamwork',
      category: 'soft',
      proficiency: 5,
      confidence: 0.9,
      matched_via: 'embedding', // source embedding_match → embedding
    });
    expect(result.skill_categories).toEqual({ technical: 1, soft: 1 });
  });

  it('dedupliceert op esco_id (laatste wint)', async () => {
    const s = makeStore();
    teardown = installPoolMock(s.client as MockClient);

    const result = await skillsService.updateCandidateSkillProfile(
      TENANT,
      CAND,
      USER,
      [
        { esco_id: 'esco-js', preferred_label: 'JavaScript', proficiency: 3, confidence: 1 },
        { esco_id: 'esco-js', preferred_label: 'JavaScript', proficiency: 9, confidence: 1 },
      ]
    );

    expect(s.inserts).toBe(1);
    expect(result.total_skills).toBe(1);
    expect(result.esco_skills[0].proficiency).toBe(9);
  });

  it('tenant-check: onbekende kandidaat → 404 en geen writes', async () => {
    const s = makeStore({ candidateExists: false });
    teardown = installPoolMock(s.client as MockClient);

    await expect(
      skillsService.updateCandidateSkillProfile(TENANT, CAND, USER, [
        { esco_id: 'esco-js', preferred_label: 'JavaScript', proficiency: 5, confidence: 1 },
      ])
    ).rejects.toMatchObject({ statusCode: 404, code: 'CANDIDATE_NOT_FOUND' });

    expect(s.inserts).toBe(0);
  });

  it('onbekende esco_id → 400 UNKNOWN_ESCO_SKILL (FK-veilig)', async () => {
    const s = makeStore({ knownEscoIds: ['esco-js'] });
    teardown = installPoolMock(s.client as MockClient);

    await expect(
      skillsService.updateCandidateSkillProfile(TENANT, CAND, USER, [
        { esco_id: 'esco-js', preferred_label: 'JavaScript', proficiency: 5, confidence: 1 },
        { esco_id: 'esco-does-not-exist', preferred_label: 'Ghost', proficiency: 5, confidence: 1 },
      ])
    ).rejects.toBeInstanceOf(AppError);

    expect(s.inserts).toBe(0);
  });
});

describe('updateCandidateProfileBody (zod-validatie)', () => {
  it('accepteert een geldige skills-array', () => {
    const parsed = updateCandidateProfileBody.safeParse({
      skills: [
        {
          esco_id: 'esco-js',
          preferred_label: 'JavaScript',
          proficiency: 7,
          confidence: 0.8,
          source: 'esco_match',
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('stript onbekende velden (id/esco_uri/category) zonder te falen', () => {
    const parsed = updateCandidateProfileBody.safeParse({
      skills: [
        {
          id: 'local-123',
          esco_uri: 'http://data.europa.eu/esco/skill/x',
          category: 'technical',
          esco_id: 'esco-js',
          preferred_label: 'JavaScript',
          proficiency: 7,
          confidence: 0.8,
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.skills[0]).not.toHaveProperty('id');
      expect(parsed.data.skills[0]).not.toHaveProperty('category');
    }
  });

  it('wijst proficiency buiten 1..10 af', () => {
    expect(
      updateCandidateProfileBody.safeParse({
        skills: [
          { esco_id: 'x', preferred_label: 'X', proficiency: 11, confidence: 1 },
        ],
      }).success
    ).toBe(false);
  });

  it('wijst confidence buiten 0..1 af', () => {
    expect(
      updateCandidateProfileBody.safeParse({
        skills: [
          { esco_id: 'x', preferred_label: 'X', proficiency: 5, confidence: 1.5 },
        ],
      }).success
    ).toBe(false);
  });

  it('wijst een ontbrekende esco_id af', () => {
    expect(
      updateCandidateProfileBody.safeParse({
        skills: [{ preferred_label: 'X', proficiency: 5, confidence: 1 }],
      }).success
    ).toBe(false);
  });
});
