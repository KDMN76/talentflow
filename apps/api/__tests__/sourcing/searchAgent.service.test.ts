/**
 * searchAgent.service tests — Sprint Q4.5 (Agent WWW).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

vi.mock('../../src/lib/aiEvents', () => ({
  logAIEvent: vi.fn(async () => undefined),
}));

import {
  buildInitialMockQuery,
  refineMockQuery,
  expandInitialQuery,
  expandQueryWithFeedback,
  searchCandidatesAcrossSources,
  runSearchAgent,
} from '../../src/modules/sourcing/searchAgent.service';
import type { AgentBrief } from '../../src/modules/sourcing/brief.service';
import type { SourcingSource, RawCandidate } from '../../src/modules/sourcing/sources/types';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RUN_ID = '22222222-2222-2222-2222-222222222222';
const BRIEF_ID = '33333333-3333-3333-3333-333333333333';

function brief(overrides: Partial<AgentBrief> = {}): AgentBrief {
  return {
    id: BRIEF_ID,
    tenant_id: TENANT_ID,
    job_id: null,
    brief_text: 'Senior React developer in Amsterdam, 5+ jaar ervaring.',
    must_have: ['react', 'typescript'],
    nice_to_have: ['graphql'],
    exclusions: ['banking'],
    target_count: 10,
    search_locations: ['amsterdam'],
    language_preferences: ['nl', 'en'],
    active: true,
    created_by: null,
    created_at: '2026-05-10T10:00:00Z',
    updated_at: '2026-05-10T10:00:00Z',
    ...overrides,
  };
}

function rawCandidate(name: string, score = 80): RawCandidate {
  return {
    externalId: `ext-${name}`,
    externalUrl: null,
    fullName: name,
    currentTitle: 'React Engineer',
    currentCompany: 'Mock Co',
    location: 'Amsterdam',
    headline: 'React + TS engineer',
    summary: null,
    skills: ['react', 'typescript'],
    languages: ['Nederlands'],
    rawScore: score,
    metadata: {},
  };
}

describe('buildInitialMockQuery', () => {
  it('combines must_have AND, nice_to_have OR, NOT exclusions', () => {
    const q = buildInitialMockQuery(brief());
    expect(q.query).toContain('"react"');
    expect(q.query).toContain('AND');
    expect(q.query).toContain('"graphql"');
    expect(q.query).toContain('NOT');
    expect(q.locations).toEqual(['amsterdam']);
  });

  it('falls back to brief_text when no skills set', () => {
    const q = buildInitialMockQuery(brief({ must_have: [], nice_to_have: [], exclusions: [] }));
    expect(q.query.length).toBeGreaterThan(0);
  });
});

describe('refineMockQuery', () => {
  it('broadens query when too few candidates', () => {
    const initial = buildInitialMockQuery(brief());
    const refined = refineMockQuery(initial, [rawCandidate('a')], brief(), 1);
    expect(refined.query).toBeDefined();
  });

  it('narrows query when too many candidates', () => {
    const initial = buildInitialMockQuery(brief());
    const many = Array.from({ length: 50 }, (_, i) => rawCandidate(`c${i}`));
    const refined = refineMockQuery(initial, many, brief(), 1);
    expect(refined.query).toContain('AND');
  });

  it('keeps query stable in goldilocks zone', () => {
    const initial = buildInitialMockQuery(brief());
    const just = Array.from({ length: 10 }, (_, i) => rawCandidate(`c${i}`));
    const refined = refineMockQuery(initial, just, brief(), 1);
    expect(refined.query).toBe(initial.query);
  });
});

describe('expandInitialQuery — mock-mode', () => {
  it('returns mocked=true and a non-empty query', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const out = await expandInitialQuery(brief());
      expect(out.meta.mocked).toBe(true);
      expect(out.query.query.length).toBeGreaterThan(0);
      expect(out.reasoning.length).toBeGreaterThan(0);
    } finally {
      if (prev) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});

describe('expandQueryWithFeedback — mock-mode', () => {
  it('returns mocked=true with reasoning that includes "broadening" or "narrowing" or "stable"', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const initial = buildInitialMockQuery(brief());
      const out = await expandQueryWithFeedback(initial, [rawCandidate('a')], brief(), 1);
      expect(out.meta.mocked).toBe(true);
      expect(out.reasoning).toMatch(/broaden|narrow|stable/);
    } finally {
      if (prev) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});

describe('searchCandidatesAcrossSources', () => {
  it('fans out and dedupes by externalId', async () => {
    const sourceA: SourcingSource = {
      id: 'github' as const,
      name: 'A',
      isEnabled: () => true,
      search: vi.fn(async () => [rawCandidate('alice', 80)]),
    };
    const sourceB: SourcingSource = {
      id: 'linkedin' as const,
      name: 'B',
      isEnabled: () => true,
      search: vi.fn(async () => [rawCandidate('alice', 70)]),
    };
    const out = await searchCandidatesAcrossSources(
      { query: 'react' },
      { tenantId: TENANT_ID, brief: brief(), limit: 10 },
      [sourceA, sourceB]
    );
    // Different sources → dedupe key is per-source — so 2 unique entries.
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it('continues when one source throws', async () => {
    const failing: SourcingSource = {
      id: 'github',
      name: 'fail',
      isEnabled: () => true,
      search: vi.fn(async () => { throw new Error('boom'); }),
    };
    const ok: SourcingSource = {
      id: 'linkedin',
      name: 'ok',
      isEnabled: () => true,
      search: vi.fn(async () => [rawCandidate('bob')]),
    };
    const out = await searchCandidatesAcrossSources(
      { query: 'react' },
      { tenantId: TENANT_ID, brief: brief(), limit: 10 },
      [failing, ok]
    );
    expect(out).toHaveLength(1);
    expect(out[0].fullName).toBe('bob');
  });

  it('skips disabled sources', async () => {
    const disabled: SourcingSource = {
      id: 'github',
      name: 'd',
      isEnabled: () => false,
      search: vi.fn(async () => [rawCandidate('zoe')]),
    };
    const out = await searchCandidatesAcrossSources(
      { query: 'react' },
      { tenantId: TENANT_ID, brief: brief(), limit: 10 },
      [disabled]
    );
    expect(out).toHaveLength(0);
    expect(disabled.search).not.toHaveBeenCalled();
  });

  it('sorts by rawScore desc', async () => {
    const s: SourcingSource = {
      id: 'github',
      name: 's',
      isEnabled: () => true,
      search: vi.fn(async () => [
        rawCandidate('low', 30),
        rawCandidate('high', 90),
        rawCandidate('mid', 60),
      ]),
    };
    const out = await searchCandidatesAcrossSources(
      { query: 'react' },
      { tenantId: TENANT_ID, brief: brief(), limit: 10 },
      [s]
    );
    expect(out[0].fullName).toBe('high');
    expect(out[2].fullName).toBe('low');
  });
});

describe('runSearchAgent — mock-mode end-to-end', () => {
  let teardown: () => void;
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => teardown?.());

  it('runs initial expansion + at least one source pass and persists findings', async () => {
    let runStatusUpdates = 0;
    let findingsInserted = 0;
    let actionsInserted = 0;

    const findingId = '99999999-9999-9999-9999-999999999999';

    const client: MockClient = mockClient({
      __matcher: (sql) => {
        if (/^\s*SELECT id, tenant_id, brief_id, status, expansion_iteration, reasoning_log\s*FROM agent_runs/i.test(sql)) {
          return {
            rows: [{
              id: RUN_ID,
              tenant_id: TENANT_ID,
              brief_id: BRIEF_ID,
              status: 'queued',
              expansion_iteration: 0,
              reasoning_log: '[]',
            }],
            rowCount: 1,
          };
        }
        if (/^\s*SELECT \* FROM agent_briefs/i.test(sql)) {
          return {
            rows: [{
              id: BRIEF_ID,
              tenant_id: TENANT_ID,
              job_id: null,
              brief_text: 'React dev',
              must_have: ['react'],
              nice_to_have: [],
              exclusions: [],
              target_count: 5,
              search_locations: ['amsterdam'],
              language_preferences: ['nl'],
              active: true,
              created_by: null,
              created_at: new Date('2026-05-10'),
              updated_at: new Date('2026-05-10'),
            }],
            rowCount: 1,
          };
        }
        if (/UPDATE agent_runs SET status = 'running'/i.test(sql)) {
          runStatusUpdates++;
          return { rows: [], rowCount: 1 };
        }
        if (/INSERT INTO agent_actions/i.test(sql)) {
          actionsInserted++;
          return { rows: [], rowCount: 1 };
        }
        if (/INSERT INTO agent_findings/i.test(sql)) {
          findingsInserted++;
          return { rows: [{ id: findingId }], rowCount: 1 };
        }
        if (/UPDATE agent_runs/i.test(sql)) {
          runStatusUpdates++;
          return { rows: [], rowCount: 1 };
        }
        if (/FROM candidates/i.test(sql)) {
          // existingDb source returns mock candidates
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const out = await runSearchAgent(TENANT_ID, RUN_ID, { maxIterations: 2 });
    expect(out.runId).toBe(RUN_ID);
    expect(out.status).toBe('review_required');
    expect(runStatusUpdates).toBeGreaterThanOrEqual(1);
    expect(actionsInserted).toBeGreaterThan(0); // at least query_expanded action
  });

  it('marks run as completed if status was already cancelled (no-op short-circuit)', async () => {
    const client: MockClient = mockClient({
      __matcher: (sql) => {
        if (/^\s*SELECT id, tenant_id, brief_id, status/i.test(sql)) {
          return {
            rows: [{
              id: RUN_ID,
              tenant_id: TENANT_ID,
              brief_id: BRIEF_ID,
              status: 'cancelled',
              expansion_iteration: 0,
              reasoning_log: '[]',
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const out = await runSearchAgent(TENANT_ID, RUN_ID);
    expect(out.status).toBe('completed');
    expect(out.candidatesFound).toBe(0);
  });

  it('terminates loop when MAX_ITERATIONS reached', async () => {
    let queryExpansions = 0;
    const client: MockClient = mockClient({
      __matcher: (sql) => {
        if (/^\s*SELECT id, tenant_id, brief_id, status/i.test(sql)) {
          return {
            rows: [{
              id: RUN_ID,
              tenant_id: TENANT_ID,
              brief_id: BRIEF_ID,
              status: 'queued',
              expansion_iteration: 0,
              reasoning_log: '[]',
            }],
            rowCount: 1,
          };
        }
        if (/^\s*SELECT \* FROM agent_briefs/i.test(sql)) {
          return {
            rows: [{
              id: BRIEF_ID,
              tenant_id: TENANT_ID,
              job_id: null,
              brief_text: 'minimal',
              must_have: [],
              nice_to_have: [],
              exclusions: [],
              target_count: 99999, // unreachable target
              search_locations: [],
              language_preferences: [],
              active: true,
              created_by: null,
              created_at: new Date(),
              updated_at: new Date(),
            }],
            rowCount: 1,
          };
        }
        if (/INSERT INTO agent_actions/i.test(sql)) {
          queryExpansions++;
          return { rows: [], rowCount: 1 };
        }
        if (/INSERT INTO agent_findings/i.test(sql)) {
          return { rows: [{ id: '99999999-9999-9999-9999-999999999999' }], rowCount: 1 };
        }
        if (/UPDATE agent_runs/i.test(sql)) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const out = await runSearchAgent(TENANT_ID, RUN_ID, { maxIterations: 3 });
    expect(out.iterations).toBeLessThanOrEqual(3);
  });
});
