/**
 * sourcing.routes integration tests — Sprint Q4.5 (Agent WWW).
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';
import { errorHandler } from '../../src/middleware/errorHandler';

vi.mock('../../src/lib/aiEvents', () => ({
  logAIEvent: vi.fn(async () => undefined),
}));

vi.mock('../../src/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/audit')>(
    '../../src/lib/audit'
  );
  return { ...actual, logAudit: vi.fn(async () => undefined) };
});

vi.mock('../../src/modules/candidates/candidates.service', () => ({
  createCandidate: vi.fn(async () => ({ id: 'created-cand-id' })),
}));

vi.mock('../../src/queue/queues', () => ({
  sourcingAgentQueue: { add: vi.fn(async () => ({ id: 'q-1' })) },
}));

import sourcingRouter from '../../src/modules/sourcing/sourcing.routes';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const BRIEF_ID = '44444444-4444-4444-4444-444444444444';
const RUN_ID = '55555555-5555-5555-5555-555555555555';
const FINDING_ID = '66666666-6666-6666-6666-666666666666';

function token(tenantId: string, role = 'admin'): string {
  return jwt.sign(
    { userId: USER_ID, tenantId, email: 'r@example.com', role },
    process.env.JWT_SECRET!,
    { expiresIn: '5m' }
  );
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sourcing', sourcingRouter);
  app.use(errorHandler);
  return app;
}

/** requirePermission('candidates', 'write') looks up the user's role
 * (+ any custom-role assignments) before the route handler runs.
 * Same pattern as __tests__/whatsapp/routes.test.ts. */
function withRoleMatcher(
  role: string,
  extra?: (sql: string) => { rows: unknown[]; rowCount: number } | undefined
) {
  return async (sql: string) => {
    if (/FROM\s+users\b/i.test(sql)) return { rows: [{ role }], rowCount: 1 };
    if (/FROM\s+user_role_assignments\b/i.test(sql)) return { rows: [], rowCount: 0 };
    const extraResult = extra?.(sql);
    if (extraResult) return extraResult;
    return { rows: [], rowCount: 0 };
  };
}

function briefRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BRIEF_ID,
    tenant_id: TENANT_A,
    job_id: null,
    brief_text: 'Senior React developer in Amsterdam, 5+ jaar ervaring.',
    must_have: ['react'],
    nice_to_have: [],
    exclusions: [],
    target_count: 25,
    search_locations: ['amsterdam'],
    language_preferences: ['nl', 'en'],
    active: true,
    created_by: USER_ID,
    created_at: new Date('2026-05-10'),
    updated_at: new Date('2026-05-10'),
    ...overrides,
  };
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    tenant_id: TENANT_A,
    brief_id: BRIEF_ID,
    status: 'queued',
    trigger: 'manual',
    started_at: null,
    finished_at: null,
    candidates_found: 0,
    candidates_approved: 0,
    candidates_rejected: 0,
    expansion_iteration: 0,
    current_query: null,
    reasoning_log: [],
    error_message: null,
    created_by: USER_ID,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function findingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FINDING_ID,
    tenant_id: TENANT_A,
    run_id: RUN_ID,
    brief_id: BRIEF_ID,
    candidate_id: null,
    external_source: 'linkedin',
    external_url: null,
    external_id: 'ext-1',
    full_name: 'Alice External',
    current_title: 'Engineer',
    current_company: 'X',
    location: 'Amsterdam',
    headline: null,
    summary: null,
    skills: ['react'],
    languages: [],
    match_score: '70.00',
    match_reasoning: null,
    status: 'pending_review',
    reviewed_at: null,
    reviewed_by: null,
    review_note: null,
    metadata: {},
    created_at: new Date(),
    ...overrides,
  };
}

describe('POST /api/sourcing/briefs', () => {
  let teardown: () => void;
  beforeEach(() => { delete process.env.ANTHROPIC_API_KEY; });
  afterEach(() => teardown?.());

  it('201 creates a brief in mock-mode parser', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: withRoleMatcher('recruiter', (sql) => {
        if (/INSERT INTO agent_briefs/i.test(sql)) {
          return { rows: [briefRow()], rowCount: 1 };
        }
        return undefined;
      }),
    }));
    const res = await request(buildApp())
      .post('/api/sourcing/briefs')
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({
        brief_text: 'Senior React developer in Amsterdam, 5+ jaar ervaring, geen banking.',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(BRIEF_ID);
  });

  it('400 when brief_text too short', async () => {
    teardown = installPoolMock(mockClient({ __matcher: withRoleMatcher('recruiter') }));
    const res = await request(buildApp())
      .post('/api/sourcing/briefs')
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({ brief_text: 'short' });
    expect(res.status).toBe(400);
  });

  it('401 without JWT', async () => {
    teardown = installPoolMock(mockClient());
    const res = await request(buildApp())
      .post('/api/sourcing/briefs')
      .send({ brief_text: 'long enough brief text 12345 abcde' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/sourcing/briefs', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('200 returns paginated briefs', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: (sql) => {
        if (/FROM agent_briefs/i.test(sql)) {
          return { rows: [briefRow()], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    }));
    const res = await request(buildApp())
      .get('/api/sourcing/briefs')
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('GET /api/sourcing/briefs/:id', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('200 returns brief', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: (sql) => {
        if (/FROM agent_briefs/i.test(sql)) {
          return { rows: [briefRow()], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    }));
    const res = await request(buildApp())
      .get(`/api/sourcing/briefs/${BRIEF_ID}`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    expect(res.status).toBe(200);
  });

  it('404 when brief not found', async () => {
    teardown = installPoolMock(mockClient());
    const res = await request(buildApp())
      .get(`/api/sourcing/briefs/${BRIEF_ID}`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/sourcing/briefs/:id/runs', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('202 enqueues run', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: withRoleMatcher('recruiter', (sql) => {
        if (/SELECT id, active FROM agent_briefs/i.test(sql)) {
          return { rows: [{ id: BRIEF_ID, active: true }], rowCount: 1 };
        }
        if (/INSERT INTO agent_runs/i.test(sql)) {
          return { rows: [runRow()], rowCount: 1 };
        }
        return undefined;
      }),
    }));
    const res = await request(buildApp())
      .post(`/api/sourcing/briefs/${BRIEF_ID}/runs`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({});
    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('queued');
  });
});

describe('Cross-tenant isolation', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('Tenant B cannot read Tenant A brief — RLS returns 0 rows ⇒ 404', async () => {
    // dbMock doesn't apply RLS; we simulate isolation by checking that the
    // service propagates the empty result as 404 to whichever tenant queries.
    teardown = installPoolMock(mockClient());
    const res = await request(buildApp())
      .get(`/api/sourcing/briefs/${BRIEF_ID}`)
      .set('Authorization', `Bearer ${token(TENANT_B)}`);
    expect(res.status).toBe(404);
  });
});

describe('Findings routes', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('POST /findings/:id/approve → 200', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: withRoleMatcher('recruiter', (sql) => {
        if (/^\s*SELECT \* FROM agent_findings/i.test(sql)) {
          return { rows: [findingRow()], rowCount: 1 };
        }
        if (/UPDATE agent_findings/i.test(sql)) {
          return { rows: [findingRow({ status: 'approved', candidate_id: 'created-cand-id' })], rowCount: 1 };
        }
        return undefined;
      }),
    }));
    const res = await request(buildApp())
      .post(`/api/sourcing/findings/${FINDING_ID}/approve`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({ note: 'looks good' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
  });

  it('POST /findings/:id/reject — 400 missing reason', async () => {
    teardown = installPoolMock(mockClient({ __matcher: withRoleMatcher('recruiter') }));
    const res = await request(buildApp())
      .post(`/api/sourcing/findings/${FINDING_ID}/reject`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('POST /findings/:id/reject — 200 with reason', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: withRoleMatcher('recruiter', (sql) => {
        if (/^\s*SELECT \* FROM agent_findings/i.test(sql)) {
          return { rows: [findingRow()], rowCount: 1 };
        }
        if (/UPDATE agent_findings/i.test(sql)) {
          return { rows: [findingRow({ status: 'rejected', review_note: 'no fit' })], rowCount: 1 };
        }
        return undefined;
      }),
    }));
    const res = await request(buildApp())
      .post(`/api/sourcing/findings/${FINDING_ID}/reject`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({ reason: 'no fit' });
    expect(res.status).toBe(200);
  });

  it('POST /findings/bulk-approve — 200 with finding_ids', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: withRoleMatcher('recruiter', (sql) => {
        if (/^\s*SELECT \* FROM agent_findings/i.test(sql)) {
          return { rows: [findingRow()], rowCount: 1 };
        }
        if (/UPDATE agent_findings/i.test(sql)) {
          return { rows: [findingRow({ status: 'approved', candidate_id: 'c' })], rowCount: 1 };
        }
        return undefined;
      }),
    }));
    const res = await request(buildApp())
      .post('/api/sourcing/findings/bulk-approve')
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({ finding_ids: [FINDING_ID, FINDING_ID] });
    expect(res.status).toBe(200);
    expect(res.body.data.approved + res.body.data.failed).toBe(2);
  });

  it('POST /findings/bulk-approve — 400 empty array', async () => {
    teardown = installPoolMock(mockClient({ __matcher: withRoleMatcher('recruiter') }));
    const res = await request(buildApp())
      .post('/api/sourcing/findings/bulk-approve')
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({ finding_ids: [] });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/sourcing/runs/:id', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('200 with reasoning_log + actions', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: (sql) => {
        if (/^\s*SELECT \* FROM agent_runs/i.test(sql)) {
          return { rows: [runRow({ reasoning_log: '[{"iteration":0,"reasoning":"mock"}]' })], rowCount: 1 };
        }
        if (/FROM agent_actions/i.test(sql)) {
          return {
            rows: [{
              id: 'a-1', tenant_id: TENANT_A, run_id: RUN_ID, finding_id: null,
              action: 'query_expanded', payload: '{}', reasoning: 'r',
              ai_model: 'mock', prompt_tokens: null, completion_tokens: null, cost_usd: null,
              requires_approval: false, approved_by: null, approved_at: null,
              created_at: new Date(),
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    }));
    const res = await request(buildApp())
      .get(`/api/sourcing/runs/${RUN_ID}`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(RUN_ID);
    expect(Array.isArray(res.body.actions)).toBe(true);
  });
});

describe('POST /api/sourcing/runs/:id/cancel', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('200 cancels a running run', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: withRoleMatcher('recruiter', (sql) => {
        if (/^\s*SELECT \* FROM agent_runs/i.test(sql)) {
          return { rows: [runRow({ status: 'running' })], rowCount: 1 };
        }
        if (/UPDATE agent_runs/i.test(sql)) {
          return { rows: [runRow({ status: 'cancelled' })], rowCount: 1 };
        }
        return undefined;
      }),
    }));
    const res = await request(buildApp())
      .post(`/api/sourcing/runs/${RUN_ID}/cancel`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
  });
});

describe('Memory routes', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('PUT /memory upserts', async () => {
    const memId = '77777777-7777-7777-7777-777777777777';
    teardown = installPoolMock(mockClient({
      __matcher: withRoleMatcher('recruiter', (sql) => {
        if (/INSERT INTO agent_memory/i.test(sql)) {
          return {
            rows: [{
              id: memId, tenant_id: TENANT_A, scope: 'tenant', scope_id: null,
              key: 'k', value: '"v"',
              created_at: new Date(), updated_at: new Date(),
            }],
            rowCount: 1,
          };
        }
        return undefined;
      }),
    }));
    const res = await request(buildApp())
      .put('/api/sourcing/memory')
      .set('Authorization', `Bearer ${token(TENANT_A)}`)
      .send({ scope: 'tenant', key: 'k', value: 'v' });
    expect(res.status).toBe(200);
    expect(res.body.data.value).toBe('v');
  });

  it('GET /memory list', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: (sql) => {
        if (/FROM agent_memory/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    }));
    const res = await request(buildApp())
      .get('/api/sourcing/memory')
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    expect(res.status).toBe(200);
  });
});

describe('Audit timeline', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('GET /actions/:runId returns actions', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: (sql) => {
        if (/FROM agent_actions/i.test(sql)) {
          return {
            rows: [{
              id: 'a-1', tenant_id: TENANT_A, run_id: RUN_ID, finding_id: null,
              action: 'query_expanded', payload: '{}', reasoning: null,
              ai_model: null, prompt_tokens: null, completion_tokens: null, cost_usd: null,
              requires_approval: false, approved_by: null, approved_at: null,
              created_at: new Date(),
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    }));
    const res = await request(buildApp())
      .get(`/api/sourcing/actions/${RUN_ID}`)
      .set('Authorization', `Bearer ${token(TENANT_A)}`);
    expect(res.status).toBe(200);
    // Frontend-contract (useAgentActions): { items: [...] } — de oude
    // `data`-assertion codificeerde precies de shape-bug die de
    // run-detailpagina een lege lijst gaf.
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});

describe('Append-only protection — agent_actions UPDATE/DELETE blocked', () => {
  // Simuleer DB-side trigger door mock client een fout te laten gooien op
  // UPDATE/DELETE op agent_actions. Dit is wat de migration 029 trigger doet.
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('UPDATE on agent_actions raises insufficient_privilege', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: (sql) => {
        if (/UPDATE agent_actions/i.test(sql) || /DELETE FROM agent_actions/i.test(sql)) {
          const err = new Error('append-only table: UPDATE/DELETE is forbidden on agent_actions');
          (err as Error & { code?: string }).code = '42501';
          throw err;
        }
        return { rows: [], rowCount: 0 };
      },
    }));
    // We schrijven de UPDATE manueel via withTenant — dit simuleert een
    // poging vanuit application code. Verwacht throw.
    const { withTenant } = await import('../../src/db/pool');
    await expect(
      withTenant(TENANT_A, async (client) => {
        return client.query('UPDATE agent_actions SET reasoning = $1 WHERE id = $2', ['x', 'y']);
      })
    ).rejects.toThrow(/append-only/i);
  });

  it('DELETE on agent_actions raises insufficient_privilege', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: (sql) => {
        if (/DELETE FROM agent_actions/i.test(sql)) {
          const err = new Error('append-only table: UPDATE/DELETE is forbidden on agent_actions');
          (err as Error & { code?: string }).code = '42501';
          throw err;
        }
        return { rows: [], rowCount: 0 };
      },
    }));
    const { withTenant } = await import('../../src/db/pool');
    await expect(
      withTenant(TENANT_A, async (client) => {
        return client.query('DELETE FROM agent_actions WHERE id = $1', ['y']);
      })
    ).rejects.toThrow(/append-only/i);
  });
});
