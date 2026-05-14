/**
 * runs.service tests — Sprint Q4.5 (Agent WWW).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

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

import {
  enqueueRun,
  getRun,
  listRuns,
  cancelRun,
  approveFinding,
  rejectFinding,
  bulkApprove,
  bulkReject,
  listActionsForRun,
  upsertMemory,
  listMemory,
  deleteMemory,
} from '../../src/modules/sourcing/runs.service';
import { eventBus } from '../../src/lib/eventBus';
import { createCandidate as createCandidateMockFn } from '../../src/modules/candidates/candidates.service';
import { sourcingAgentQueue as sourcingQueueMock } from '../../src/queue/queues';

const createCandidateMock = createCandidateMockFn as unknown as ReturnType<typeof vi.fn>;
const queueAddMock = sourcingQueueMock.add as unknown as ReturnType<typeof vi.fn>;

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const BRIEF_ID = '33333333-3333-3333-3333-333333333333';
const RUN_ID = '44444444-4444-4444-4444-444444444444';
const FINDING_ID = '55555555-5555-5555-5555-555555555555';
const CAND_ID = '66666666-6666-6666-6666-666666666666';
const MEM_ID = '77777777-7777-7777-7777-777777777777';

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    tenant_id: TENANT_ID,
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
    created_at: new Date('2026-05-10'),
    updated_at: new Date('2026-05-10'),
    ...overrides,
  };
}

function findingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FINDING_ID,
    tenant_id: TENANT_ID,
    run_id: RUN_ID,
    brief_id: BRIEF_ID,
    candidate_id: null,
    external_source: 'linkedin',
    external_url: 'https://linkedin.com/in/x',
    external_id: 'linkedin-x',
    full_name: 'Alice External',
    current_title: 'Engineer',
    current_company: 'X',
    location: 'Amsterdam',
    headline: 'react engineer',
    summary: 'mock',
    skills: ['react'],
    languages: ['Nederlands'],
    match_score: '75.00',
    match_reasoning: 'Auto',
    status: 'pending_review',
    reviewed_at: null,
    reviewed_by: null,
    review_note: null,
    metadata: {},
    created_at: new Date('2026-05-10'),
    ...overrides,
  };
}

describe('enqueueRun', () => {
  let teardown: () => void;
  beforeEach(() => {
    queueAddMock.mockClear();
  });
  afterEach(() => teardown?.());

  it('inserts run + pushes to BullMQ', async () => {
    const client: MockClient = mockClient({
      __matcher: (sql) => {
        if (/SELECT id, active FROM agent_briefs/i.test(sql)) {
          return { rows: [{ id: BRIEF_ID, active: true }], rowCount: 1 };
        }
        if (/INSERT INTO agent_runs/i.test(sql)) {
          return { rows: [runRow()], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const out = await enqueueRun(TENANT_ID, BRIEF_ID, 'manual', USER_ID);
    expect(out.id).toBe(RUN_ID);
    expect(out.status).toBe('queued');
    expect(queueAddMock).toHaveBeenCalledTimes(1);
  });

  it('throws when brief not found', async () => {
    teardown = installPoolMock(mockClient());
    await expect(enqueueRun(TENANT_ID, BRIEF_ID, 'manual', USER_ID))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 409 when brief inactive', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: (sql) => {
        if (/SELECT id, active FROM agent_briefs/i.test(sql)) {
          return { rows: [{ id: BRIEF_ID, active: false }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    }));
    await expect(enqueueRun(TENANT_ID, BRIEF_ID, 'manual', USER_ID))
      .rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('getRun + listRuns + cancelRun', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('getRun 404 when missing', async () => {
    teardown = installPoolMock(mockClient());
    await expect(getRun(TENANT_ID, RUN_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('listRuns returns paginated data', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: (sql) => {
        if (/FROM agent_runs/i.test(sql)) {
          return { rows: [runRow()], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    }));
    const out = await listRuns(TENANT_ID, { limit: 10 });
    expect(out.data).toHaveLength(1);
    expect(out.nextCursor).toBeNull();
  });

  it('cancelRun transitions to cancelled', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: (sql) => {
        if (/^\s*SELECT \* FROM agent_runs/i.test(sql)) {
          return { rows: [runRow({ status: 'running' })], rowCount: 1 };
        }
        if (/UPDATE agent_runs/i.test(sql)) {
          return { rows: [runRow({ status: 'cancelled' })], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    }));
    const out = await cancelRun(TENANT_ID, RUN_ID, USER_ID);
    expect(out.status).toBe('cancelled');
  });

  it('cancelRun no-op when already completed', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: (sql) => {
        if (/^\s*SELECT \* FROM agent_runs/i.test(sql)) {
          return { rows: [runRow({ status: 'completed' })], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    }));
    const out = await cancelRun(TENANT_ID, RUN_ID, USER_ID);
    expect(out.status).toBe('completed');
  });
});

describe('approveFinding', () => {
  let teardown: () => void;
  beforeEach(() => {
    createCandidateMock.mockClear();
    eventBus.removeAllListeners();
  });
  afterEach(() => teardown?.());

  it('creates a candidate when external + emits findingApproved event', async () => {
    let emittedPayload: unknown = null;
    eventBus.on('findingApproved', (p) => { emittedPayload = p; });

    const client: MockClient = mockClient({
      __matcher: (sql) => {
        if (/^\s*SELECT \* FROM agent_findings/i.test(sql)) {
          return { rows: [findingRow({ candidate_id: null })], rowCount: 1 };
        }
        if (/UPDATE agent_findings/i.test(sql)) {
          return { rows: [findingRow({ candidate_id: 'created-cand-id', status: 'approved' })], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const out = await approveFinding(TENANT_ID, FINDING_ID, USER_ID, 'looks good');
    expect(out.status).toBe('approved');
    expect(createCandidateMock).toHaveBeenCalledTimes(1);

    // Wait a tick for fire-and-forget eventBus.emit (Node EventEmitter is sync,
    // but listener wrapper awaits — give it a microtask).
    await new Promise((r) => setImmediate(r));
    expect(emittedPayload).toMatchObject({
      tenantId: TENANT_ID,
      findingId: FINDING_ID,
      candidateId: 'created-cand-id',
    });
  });

  it('does NOT create candidate when finding already has candidate_id', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: (sql) => {
        if (/^\s*SELECT \* FROM agent_findings/i.test(sql)) {
          return { rows: [findingRow({ candidate_id: CAND_ID })], rowCount: 1 };
        }
        if (/UPDATE agent_findings/i.test(sql)) {
          return { rows: [findingRow({ candidate_id: CAND_ID, status: 'approved' })], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    }));
    await approveFinding(TENANT_ID, FINDING_ID, USER_ID);
    expect(createCandidateMock).not.toHaveBeenCalled();
  });

  it('idempotent — already approved is short-circuit no-op', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: (sql) => {
        if (/^\s*SELECT \* FROM agent_findings/i.test(sql)) {
          return { rows: [findingRow({ status: 'approved', candidate_id: CAND_ID })], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    }));
    const out = await approveFinding(TENANT_ID, FINDING_ID, USER_ID);
    expect(out.status).toBe('approved');
    expect(createCandidateMock).not.toHaveBeenCalled();
  });
});

describe('rejectFinding', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('preserves reason in review_note', async () => {
    let updateParams: unknown[] = [];
    teardown = installPoolMock(mockClient({
      __matcher: (sql, params) => {
        if (/^\s*SELECT \* FROM agent_findings/i.test(sql)) {
          return { rows: [findingRow()], rowCount: 1 };
        }
        if (/UPDATE agent_findings/i.test(sql)) {
          updateParams = params as unknown[];
          return { rows: [findingRow({ status: 'rejected', review_note: 'not a fit' })], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    }));
    const out = await rejectFinding(TENANT_ID, FINDING_ID, 'not a fit', USER_ID);
    expect(out.status).toBe('rejected');
    expect(out.review_note).toBe('not a fit');
    expect(updateParams).toContain('not a fit');
  });
});

describe('bulkApprove + bulkReject', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('bulkApprove counts successes', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: (sql) => {
        if (/^\s*SELECT \* FROM agent_findings/i.test(sql)) {
          return { rows: [findingRow()], rowCount: 1 };
        }
        if (/UPDATE agent_findings/i.test(sql)) {
          return { rows: [findingRow({ status: 'approved', candidate_id: CAND_ID })], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    }));
    const result = await bulkApprove(TENANT_ID, [FINDING_ID, FINDING_ID], USER_ID);
    expect(result.approved + result.failed).toBe(2);
  });

  it('bulkReject counts successes', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: (sql) => {
        if (/^\s*SELECT \* FROM agent_findings/i.test(sql)) {
          return { rows: [findingRow()], rowCount: 1 };
        }
        if (/UPDATE agent_findings/i.test(sql)) {
          return { rows: [findingRow({ status: 'rejected' })], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    }));
    const result = await bulkReject(TENANT_ID, [FINDING_ID, FINDING_ID], 'no fit', USER_ID);
    expect(result.rejected + result.failed).toBe(2);
  });
});

describe('listActionsForRun', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns ordered actions', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: (sql) => {
        if (/FROM agent_actions/i.test(sql)) {
          return {
            rows: [
              {
                id: 'a-1', tenant_id: TENANT_ID, run_id: RUN_ID, finding_id: null,
                action: 'query_expanded', payload: {}, reasoning: null,
                ai_model: 'mock', prompt_tokens: null, completion_tokens: null, cost_usd: null,
                requires_approval: false, approved_by: null, approved_at: null,
                created_at: new Date(),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    }));
    const out = await listActionsForRun(TENANT_ID, RUN_ID);
    expect(out).toHaveLength(1);
    expect(out[0].action).toBe('query_expanded');
  });
});

describe('memory upsert/list/delete', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('upsert returns the row', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: (sql) => {
        if (/INSERT INTO agent_memory/i.test(sql)) {
          return {
            rows: [{
              id: MEM_ID, tenant_id: TENANT_ID, scope: 'tenant', scope_id: null,
              key: 'preferred_languages', value: '["nl","en"]',
              created_at: new Date(), updated_at: new Date(),
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    }));
    const out = await upsertMemory(TENANT_ID, 'tenant', null, 'preferred_languages', ['nl', 'en']);
    expect(out.id).toBe(MEM_ID);
    expect(out.value).toEqual(['nl', 'en']);
  });

  it('listMemory returns rows', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: (sql) => {
        if (/FROM agent_memory/i.test(sql)) {
          return {
            rows: [{
              id: MEM_ID, tenant_id: TENANT_ID, scope: 'tenant', scope_id: null,
              key: 'k', value: '{"a":1}',
              created_at: new Date(), updated_at: new Date(),
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    }));
    const out = await listMemory(TENANT_ID);
    expect(out).toHaveLength(1);
    expect(out[0].value).toEqual({ a: 1 });
  });

  it('deleteMemory throws 404 when not found', async () => {
    teardown = installPoolMock(mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    }));
    await expect(deleteMemory(TENANT_ID, MEM_ID)).rejects.toMatchObject({ statusCode: 404 });
  });
});
