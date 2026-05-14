import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from './helpers/dbMock';
import { generateCandidateReference } from '../src/modules/candidates/candidates.schema';

// Mock workflow + matching emitters BEFORE importing the service so the spies
// are wired up at module-load time.
vi.mock('../src/modules/workflows/workflowEmitter', () => ({
  emitWorkflowEvent: vi.fn(async () => undefined),
}));
vi.mock('../src/modules/matching/matchingEmitter', () => ({
  queueEmbedding: vi.fn(async () => undefined),
}));

import {
  createCandidate,
  updateCandidate,
  listCandidates,
  getCandidate,
  deleteCandidate,
  getCandidateTimeline,
  listCandidateSkills,
  addCandidateSkill,
  deleteCandidateSkill,
  listPipelineTemplates,
} from '../src/modules/candidates/candidates.service';
import { emitWorkflowEvent } from '../src/modules/workflows/workflowEmitter';
import { queueEmbedding } from '../src/modules/matching/matchingEmitter';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

// ──────────────────────────────────────────────────────────────────────────────
// Pure helpers: reference generation + payload normalisation behaviour
// ──────────────────────────────────────────────────────────────────────────────

describe('generateCandidateReference', () => {
  it('produces a 9-character upper-case alphanumeric string', () => {
    const ref = generateCandidateReference();
    expect(ref).toHaveLength(9);
    expect(ref).toMatch(/^[A-Z0-9]{9}$/);
  });

  it('never includes visually ambiguous characters O, 0, I, 1', () => {
    // Generate a sample large enough to make accidental absence unlikely.
    for (let i = 0; i < 500; i++) {
      const ref = generateCandidateReference();
      expect(ref).not.toMatch(/[O0I1]/);
    }
  });

  it('produces sufficient entropy — collisions are very rare', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateCandidateReference());
    expect(seen.size).toBeGreaterThan(990);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// createCandidate — INSERT shape, activity log, post-commit emits
// ──────────────────────────────────────────────────────────────────────────────

describe('createCandidate', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    teardown?.();
  });

  it('inserts a candidate with synced name and tenant_id, then emits events', async () => {
    const insertedRow = {
      id: 'cand-1',
      tenant_id: TENANT_ID,
      name: 'Sofia Vermeer',
      candidate_reference: 'ABC234567',
    };

    client = mockClient({
      __matcher: (sql) => {
        if (/INSERT INTO candidates/i.test(sql)) {
          return { rows: [insertedRow], rowCount: 1 };
        }
        if (/INSERT INTO activities/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await createCandidate(TENANT_ID, USER_ID, {
      first_name: 'Sofia',
      last_name: 'Vermeer',
    });

    expect(result.id).toBe('cand-1');

    // Verify an INSERT INTO candidates was issued
    const insertCalls = client.query.mock.calls.filter((c) =>
      /INSERT INTO candidates/i.test(String(c[0]))
    );
    expect(insertCalls).toHaveLength(1);

    const [sql, values] = insertCalls[0];
    // tenant_id is always $1
    expect(values[0]).toBe(TENANT_ID);
    // Name was synthesised from first/last
    expect(String(sql)).toMatch(/name/);
    expect(values).toContain('Sofia Vermeer');

    // Post-commit emits
    expect(emitWorkflowEvent).toHaveBeenCalledWith(
      TENANT_ID,
      'candidate.created',
      'cand-1',
      expect.objectContaining({ user_id: USER_ID })
    );
    expect(queueEmbedding).toHaveBeenCalledWith(TENANT_ID, 'candidate', 'cand-1');
  });

  it('only includes defined fields in the INSERT (DB-defaults for the rest)', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/INSERT INTO candidates/i.test(sql)) {
          return { rows: [{ id: 'cand-2', name: 'Alice' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await createCandidate(TENANT_ID, USER_ID, { name: 'Alice', email: 'a@b.nl' });

    const [sql, values] = client.query.mock.calls.find((c) =>
      /INSERT INTO candidates/i.test(String(c[0]))
    )!;
    // tenant_id, name, email, auto-generated candidate_reference → 4 values.
    expect(values).toHaveLength(4);
    expect(String(sql)).toMatch(/\(tenant_id, name, email, candidate_reference\)/);
  });

  it('retries on candidate_reference unique-violation and succeeds on second attempt', async () => {
    let attempt = 0;
    client = mockClient({
      __matcher: (sql) => {
        if (/INSERT INTO candidates/i.test(sql)) {
          attempt++;
          if (attempt === 1) {
            const err = new Error('duplicate key') as Error & {
              code: string;
              constraint: string;
            };
            err.code = '23505';
            err.constraint = 'uq_candidates_candidate_reference';
            throw err;
          }
          return { rows: [{ id: 'cand-retry', name: 'X' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await createCandidate(TENANT_ID, USER_ID, { name: 'X' });
    expect(result.id).toBe('cand-retry');
    expect(attempt).toBe(2);
  });

  it('does NOT retry when the user supplied their own candidate_reference', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/INSERT INTO candidates/i.test(sql)) {
          const err = new Error('duplicate key') as Error & {
            code: string;
            constraint: string;
          };
          err.code = '23505';
          err.constraint = 'uq_candidates_candidate_reference';
          throw err;
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      createCandidate(TENANT_ID, USER_ID, {
        name: 'X',
        candidate_reference: 'ABC234567',
      })
    ).rejects.toThrow();
  });

  it('defaults gdpr_consent_at when consent=true is given without timestamp', async () => {
    let captured: unknown[] | undefined;
    client = mockClient({
      __matcher: (sql, params) => {
        if (/INSERT INTO candidates/i.test(sql)) {
          captured = params;
          return { rows: [{ id: 'cand-3' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await createCandidate(TENANT_ID, USER_ID, {
      name: 'Y',
      gdpr_consent: true,
    });

    expect(captured).toBeDefined();
    // gdpr_consent_at should be auto-populated as ISO timestamp
    const isoLike = (captured as unknown[]).some(
      (v) =>
        typeof v === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)
    );
    expect(isoLike).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// updateCandidate — only supplied fields appear in the UPDATE
// ──────────────────────────────────────────────────────────────────────────────

describe('updateCandidate', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    teardown?.();
  });

  it('updates only the supplied fields plus updated_at', async () => {
    let updateSql = '';
    let updateValues: unknown[] = [];

    client = mockClient({
      __matcher: (sql, params) => {
        if (/SELECT (id|\*) FROM candidates/i.test(sql)) {
          return { rows: [{ id: 'cand-1' }], rowCount: 1 };
        }
        if (/^UPDATE candidates/i.test(sql.trim())) {
          updateSql = sql;
          updateValues = params;
          return { rows: [{ id: 'cand-1', name: 'New Name' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await updateCandidate(TENANT_ID, 'cand-1', USER_ID, {
      name: 'New Name',
    });

    expect(result.id).toBe('cand-1');
    expect(updateSql).toMatch(/SET\s+name = \$1/);
    expect(updateSql).toMatch(/updated_at = now\(\)/);
    // values: ['New Name', candidateId, tenantId]
    expect(updateValues).toEqual(['New Name', 'cand-1', TENANT_ID]);
  });

  it('throws 404 when the candidate does not exist', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM candidates/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      updateCandidate(TENANT_ID, 'missing', USER_ID, { name: 'X' })
    ).rejects.toThrow(/Kandidaat niet gevonden/);
  });

  it('throws 400 when no fields are supplied', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT (id|\*) FROM candidates/i.test(sql)) {
          return { rows: [{ id: 'cand-1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      updateCandidate(TENANT_ID, 'cand-1', USER_ID, {})
    ).rejects.toThrow(/Geen velden om bij te werken/);
  });

  it('queues an embedding refresh after the transaction commits', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT (id|\*) FROM candidates/i.test(sql)) {
          return { rows: [{ id: 'cand-1' }], rowCount: 1 };
        }
        if (/^UPDATE candidates/i.test(sql.trim())) {
          return { rows: [{ id: 'cand-1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await updateCandidate(TENANT_ID, 'cand-1', USER_ID, { phone: '+31...' });
    expect(queueEmbedding).toHaveBeenCalledWith(TENANT_ID, 'candidate', 'cand-1');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// listCandidates — pagination, filters, count + page math
// ──────────────────────────────────────────────────────────────────────────────

describe('listCandidates', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
  });

  it('returns paginated rows with total count and page math', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT COUNT\(\*\) as total FROM candidates/i.test(sql)) {
          return { rows: [{ total: '42' }], rowCount: 1 };
        }
        if (/SELECT id, candidate_reference/i.test(sql)) {
          return {
            rows: [{ id: 'c1' }, { id: 'c2' }],
            rowCount: 2,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await listCandidates(TENANT_ID, {
      page: 1,
      limit: 20,
      search: 'sofia',
      skills: ['typescript'],
      tags: ['internal'],
      source: 'LinkedIn',
    });

    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(42);
    expect(result.meta.pages).toBe(3); // ceil(42/20)
    expect(result.meta.page).toBe(1);
    expect(result.meta.limit).toBe(20);
  });

  it('handles empty result set', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT COUNT\(\*\) as total FROM candidates/i.test(sql)) {
          return { rows: [{ total: '0' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await listCandidates(TENANT_ID, { page: 1, limit: 20 });
    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
    expect(result.meta.pages).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getCandidate — hydrates skills + resumes + applications
// ──────────────────────────────────────────────────────────────────────────────

describe('getCandidate', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
  });

  it('returns 404 when the candidate is missing', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(getCandidate(TENANT_ID, 'missing')).rejects.toMatchObject({
      code: 'CANDIDATE_NOT_FOUND',
    });
  });

  it('returns the candidate with hydrated subresources', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM candidates/i.test(sql)) {
          return { rows: [{ id: 'c1', name: 'Sofia' }], rowCount: 1 };
        }
        if (/FROM candidate_skills/i.test(sql)) {
          return { rows: [{ skill: 'ts' }], rowCount: 1 };
        }
        if (/FROM candidate_resumes/i.test(sql)) {
          return { rows: [{ id: 'r1', filename: 'cv.pdf' }], rowCount: 1 };
        }
        if (/FROM applications a/i.test(sql)) {
          return { rows: [{ id: 'a1', job_id: 'j1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await getCandidate(TENANT_ID, 'c1');
    expect(result.id).toBe('c1');
    expect(result.candidate_skills).toHaveLength(1);
    expect(result.resumes).toHaveLength(1);
    expect(result.applications).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// deleteCandidate — soft delete + activity log
// ──────────────────────────────────────────────────────────────────────────────

describe('deleteCandidate', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
  });

  it('soft-deletes and logs an activity', async () => {
    let activityLogged = false;
    client = mockClient({
      __matcher: (sql) => {
        // Pre-check snapshot
        if (/SELECT \* FROM candidates WHERE id/i.test(sql)) {
          return { rows: [{ id: 'c1', name: 'Sofia' }], rowCount: 1 };
        }
        if (/^UPDATE candidates SET deleted_at/i.test(sql.trim())) {
          return { rows: [{ id: 'c1' }], rowCount: 1 };
        }
        if (/INSERT INTO activities/i.test(sql)) {
          activityLogged = true;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await deleteCandidate(TENANT_ID, 'c1', USER_ID);
    expect(activityLogged).toBe(true);
  });

  it('throws 404 when nothing matched', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(
      deleteCandidate(TENANT_ID, 'missing', USER_ID)
    ).rejects.toMatchObject({ code: 'CANDIDATE_NOT_FOUND' });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Skills + timeline + templates
// ──────────────────────────────────────────────────────────────────────────────

describe('candidate skills + timeline + templates', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
  });

  it('lists candidate skills after verifying existence', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM candidates/i.test(sql)) {
          return { rows: [{ id: 'c1' }], rowCount: 1 };
        }
        if (/FROM candidate_skills/i.test(sql)) {
          return {
            rows: [{ id: 's1', skill: 'TypeScript', score: 8 }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const skills = await listCandidateSkills(TENANT_ID, 'c1');
    expect(skills).toHaveLength(1);
  });

  it('addCandidateSkill returns the inserted row', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM candidates/i.test(sql)) {
          return { rows: [{ id: 'c1' }], rowCount: 1 };
        }
        if (/INSERT INTO candidate_skills/i.test(sql)) {
          return {
            rows: [
              {
                id: 's1',
                candidate_id: 'c1',
                skill: 'TypeScript',
                score: 8,
                source: 'manual',
                created_at: new Date(),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const skill = await addCandidateSkill(TENANT_ID, 'c1', USER_ID, {
      skill: 'TypeScript',
      score: 8,
    });
    expect(skill.skill).toBe('TypeScript');
  });

  it('addCandidateSkill maps unique-violation to 409 SKILL_DUPLICATE', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM candidates/i.test(sql)) {
          return { rows: [{ id: 'c1' }], rowCount: 1 };
        }
        if (/INSERT INTO candidate_skills/i.test(sql)) {
          const err = new Error('dup') as Error & { code: string };
          err.code = '23505';
          throw err;
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      addCandidateSkill(TENANT_ID, 'c1', USER_ID, { skill: 'TS' })
    ).rejects.toMatchObject({ code: 'SKILL_DUPLICATE' });
  });

  it('deleteCandidateSkill removes the row when found', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM candidates/i.test(sql)) {
          return { rows: [{ id: 'c1' }], rowCount: 1 };
        }
        if (/DELETE FROM candidate_skills/i.test(sql)) {
          return { rows: [{ id: 's1', skill: 'TS' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      deleteCandidateSkill(TENANT_ID, 'c1', 's1', USER_ID)
    ).resolves.toBeUndefined();
  });

  it('deleteCandidateSkill throws 404 when the skill is unknown', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM candidates/i.test(sql)) {
          return { rows: [{ id: 'c1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      deleteCandidateSkill(TENANT_ID, 'c1', 'missing', USER_ID)
    ).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND' });
  });

  it('getCandidateTimeline returns activity rows', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM candidates/i.test(sql)) {
          return { rows: [{ id: 'c1' }], rowCount: 1 };
        }
        if (/FROM activities a/i.test(sql)) {
          return {
            rows: [
              { id: 'a1', action: 'created', payload: '{}', created_at: new Date() },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const timeline = await getCandidateTimeline(TENANT_ID, 'c1');
    expect(timeline).toHaveLength(1);
  });

  it('listPipelineTemplates groups stages onto their templates', async () => {
    const templateA = '00000000-0000-0000-0000-000000000001';
    const templateB = '00000000-0000-0000-0000-000000000002';

    client = mockClient({
      __matcher: (sql) => {
        if (/FROM pipeline_templates/i.test(sql)) {
          return {
            rows: [
              { id: templateA, name: 'A', is_default: true, is_system: true },
              { id: templateB, name: 'B', is_default: false, is_system: false },
            ],
            rowCount: 2,
          };
        }
        if (/FROM pipeline_template_stages/i.test(sql)) {
          return {
            rows: [
              { id: 's1', template_id: templateA, name: 'Sourced', position: 1 },
              { id: 's2', template_id: templateA, name: 'Hired', position: 2 },
              { id: 's3', template_id: templateB, name: 'Custom', position: 1 },
            ],
            rowCount: 3,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const templates = await listPipelineTemplates(TENANT_ID);
    expect(templates).toHaveLength(2);
    const a = templates.find((t) => t.id === templateA);
    const b = templates.find((t) => t.id === templateB);
    expect(a?.stages).toHaveLength(2);
    expect(b?.stages).toHaveLength(1);
  });

  it('listPipelineTemplates returns [] when no templates exist', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    expect(await listPipelineTemplates(TENANT_ID)).toEqual([]);
  });
});
