/**
 * nurture.service tests — Sprint Q4.5 (Agent XXX).
 *
 * Covers sequence CRUD, step ordering / reorder, enrollment lifecycle, and
 * advanceEnrollments cron.
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

import {
  createSequence,
  updateSequence,
  archiveSequence,
  listSequences,
  getSequenceWithSteps,
  addStep,
  updateStep,
  reorderSteps,
  removeStep,
  enrollCandidate,
  pauseEnrollment,
  resumeEnrollment,
  stopEnrollment,
  listEnrollments,
  getEnrollment,
  advanceEnrollments,
} from '../../src/modules/nurture/nurture.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_OTHER = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';
const SEQ_ID = '44444444-4444-4444-4444-444444444444';
const STEP1 = '55555555-5555-5555-5555-555555555555';
const STEP2 = '66666666-6666-6666-6666-666666666666';
const STEP3 = '77777777-7777-7777-7777-777777777777';
const ENROLL_ID = '88888888-8888-8888-8888-888888888888';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_MOCK = 'true';
});

afterEach(() => {
  delete process.env.AI_MOCK;
});

describe('createSequence / updateSequence / archiveSequence', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('createSequence inserts and returns the row', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/INSERT\s+INTO\s+nurture_sequences/i.test(sql)) {
          return {
            rows: [
              {
                id: SEQ_ID,
                tenant_id: TENANT_ID,
                name: 'Outbound Engineering',
                description: null,
                active: true,
                total_steps: 0,
                metadata: {},
                created_by: USER_ID,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const r = await createSequence(
      TENANT_ID,
      { name: 'Outbound Engineering' },
      { userId: USER_ID }
    );
    expect(r.name).toBe('Outbound Engineering');
    expect(r.active).toBe(true);
  });

  it('updateSequence with no fields returns current row unchanged', async () => {
    const seq = {
      id: SEQ_ID,
      tenant_id: TENANT_ID,
      name: 'Existing',
      description: null,
      active: true,
      total_steps: 0,
      metadata: {},
      created_by: USER_ID,
      created_at: '',
      updated_at: '',
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+nurture_sequences/i.test(sql)) {
          return { rows: [seq], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await updateSequence(TENANT_ID, SEQ_ID, {}, { userId: USER_ID });
    expect(r.id).toBe(SEQ_ID);
  });

  it('archiveSequence flips active to false', async () => {
    const archived = {
      id: SEQ_ID,
      tenant_id: TENANT_ID,
      name: 'X',
      description: null,
      active: false,
      total_steps: 0,
      metadata: {},
      created_by: USER_ID,
      created_at: '',
      updated_at: '',
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/UPDATE\s+nurture_sequences/i.test(sql)) {
          return { rows: [archived], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await archiveSequence(TENANT_ID, SEQ_ID, { userId: USER_ID });
    expect(r.active).toBe(false);
  });

  it('listSequences applies pagination cursor', async () => {
    const rows = [
      { id: 'a', tenant_id: TENANT_ID, name: 'X', created_at: '2026-05-09', active: true, total_steps: 0, metadata: {}, description: null, created_by: USER_ID, updated_at: '' },
    ];
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+nurture_sequences/i.test(sql)) {
          return { rows, rowCount: rows.length };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await listSequences(TENANT_ID, { active: true, limit: 10 });
    expect(r.data).toHaveLength(1);
    expect(r.next_cursor).toBeNull();
  });

  it('getSequenceWithSteps returns sequence + steps array', async () => {
    const seq = {
      id: SEQ_ID,
      tenant_id: TENANT_ID,
      name: 'X',
      active: true,
      description: null,
      total_steps: 1,
      metadata: {},
      created_by: USER_ID,
      created_at: '',
      updated_at: '',
    };
    const steps = [{ id: STEP1, sequence_id: SEQ_ID, step_order: 1, channel: 'email', delay_days: 0, ai_personalize: true, template_subject: null, template_body: null, stop_on_reply: true, metadata: {}, created_at: '', tenant_id: TENANT_ID }];
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+nurture_sequences/i.test(sql)) {
          return { rows: [seq], rowCount: 1 };
        }
        if (/FROM\s+nurture_steps/i.test(sql)) {
          return { rows: steps, rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await getSequenceWithSteps(TENANT_ID, SEQ_ID);
    expect(r.steps).toHaveLength(1);
  });
});

describe('addStep / updateStep / reorderSteps / removeStep', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('addStep computes next step_order = max+1', async () => {
    let insertedOrder = -1;
    const client = mockClient({
      __matcher: async (sql, params) => {
        if (/SELECT\s+id\s+FROM\s+nurture_sequences/i.test(sql)) {
          return { rows: [{ id: SEQ_ID }], rowCount: 1 };
        }
        if (/MAX\(step_order\)/i.test(sql)) {
          return { rows: [{ max: 2 }], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+nurture_steps/i.test(sql)) {
          insertedOrder = (params as unknown[])[2] as number;
          return {
            rows: [
              {
                id: STEP3,
                tenant_id: TENANT_ID,
                sequence_id: SEQ_ID,
                step_order: insertedOrder,
                channel: 'email',
                delay_days: 3,
                ai_personalize: true,
                template_subject: null,
                template_body: null,
                stop_on_reply: true,
                metadata: {},
                created_at: '',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await addStep(
      TENANT_ID,
      SEQ_ID,
      { channel: 'email', delay_days: 3 },
      { userId: USER_ID }
    );
    expect(insertedOrder).toBe(3);
    expect(r.step_order).toBe(3);
  });

  it('addStep refuses for unknown sequence', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    await expect(
      addStep(TENANT_ID, SEQ_ID, { channel: 'email', delay_days: 0 }, { userId: USER_ID })
    ).rejects.toMatchObject({ code: 'SEQUENCE_NOT_FOUND' });
  });

  it('updateStep with no fields returns current row', async () => {
    const existing = {
      id: STEP1,
      tenant_id: TENANT_ID,
      sequence_id: SEQ_ID,
      step_order: 1,
      channel: 'email',
      delay_days: 0,
      ai_personalize: true,
      template_subject: null,
      template_body: null,
      stop_on_reply: true,
      metadata: {},
      created_at: '',
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+nurture_steps/i.test(sql)) {
          return { rows: [existing], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await updateStep(TENANT_ID, SEQ_ID, STEP1, {}, { userId: USER_ID });
    expect(r.id).toBe(STEP1);
  });

  it('reorderSteps rejects on length mismatch', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+nurture_steps/i.test(sql)) {
          return {
            rows: [
              { id: STEP1, step_order: 1, sequence_id: SEQ_ID, tenant_id: TENANT_ID },
              { id: STEP2, step_order: 2, sequence_id: SEQ_ID, tenant_id: TENANT_ID },
            ],
            rowCount: 2,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      reorderSteps(TENANT_ID, SEQ_ID, [STEP1], { userId: USER_ID })
    ).rejects.toMatchObject({ code: 'REORDER_LENGTH_MISMATCH' });
  });

  it('reorderSteps applies new order via two-phase update', async () => {
    let updates = 0;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/^SELECT\s+\*\s+FROM\s+nurture_steps/i.test(sql.trim())) {
          // First call returns existing rows; subsequent is final order.
          if (updates === 0) {
            return {
              rows: [
                { id: STEP1, step_order: 1, sequence_id: SEQ_ID, tenant_id: TENANT_ID },
                { id: STEP2, step_order: 2, sequence_id: SEQ_ID, tenant_id: TENANT_ID },
              ],
              rowCount: 2,
            };
          }
          return {
            rows: [
              { id: STEP2, step_order: 1, sequence_id: SEQ_ID, tenant_id: TENANT_ID },
              { id: STEP1, step_order: 2, sequence_id: SEQ_ID, tenant_id: TENANT_ID },
            ],
            rowCount: 2,
          };
        }
        if (/UPDATE\s+nurture_steps\s+SET\s+step_order/i.test(sql)) {
          updates++;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await reorderSteps(TENANT_ID, SEQ_ID, [STEP2, STEP1], {
      userId: USER_ID,
    });
    expect(r).toHaveLength(2);
    expect(updates).toBe(4); // 2 negative + 2 positive
  });

  it('reorderSteps rejects unknown step id', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+nurture_steps/i.test(sql)) {
          return {
            rows: [
              { id: STEP1, step_order: 1, sequence_id: SEQ_ID, tenant_id: TENANT_ID },
              { id: STEP2, step_order: 2, sequence_id: SEQ_ID, tenant_id: TENANT_ID },
            ],
            rowCount: 2,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      reorderSteps(TENANT_ID, SEQ_ID, [STEP1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'], {
        userId: USER_ID,
      })
    ).rejects.toMatchObject({ code: 'REORDER_UNKNOWN_STEP' });
  });

  it('removeStep deletes and re-sequences remaining', async () => {
    let deleted = false;
    let rese = 0;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/^DELETE\s+FROM\s+nurture_steps/i.test(sql.trim())) {
          deleted = true;
          return { rows: [], rowCount: 1 };
        }
        if (/SELECT\s+id\s+FROM\s+nurture_steps/i.test(sql)) {
          return {
            rows: [{ id: STEP2 }, { id: STEP3 }],
            rowCount: 2,
          };
        }
        if (/UPDATE\s+nurture_steps\s+SET\s+step_order/i.test(sql)) {
          rese++;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await removeStep(TENANT_ID, SEQ_ID, STEP1, { userId: USER_ID });
    expect(deleted).toBe(true);
    expect(rese).toBeGreaterThanOrEqual(2);
  });
});

describe('enrollCandidate / pause / resume / stop', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('enrollCandidate inserts pending_approval when step1.ai_personalize=true', async () => {
    const seq = {
      id: SEQ_ID,
      tenant_id: TENANT_ID,
      name: 'X',
      active: true,
      description: null,
      total_steps: 1,
      metadata: {},
      created_by: USER_ID,
      created_at: '',
      updated_at: '',
    };
    const step1 = {
      id: STEP1,
      tenant_id: TENANT_ID,
      sequence_id: SEQ_ID,
      step_order: 1,
      channel: 'email',
      delay_days: 0,
      ai_personalize: true,
      template_subject: null,
      template_body: null,
      stop_on_reply: true,
      metadata: {},
      created_at: '',
    };
    let insertedStatus: string | null = null;
    const client = mockClient({
      __matcher: async (sql, params) => {
        if (/SELECT\s+\*\s+FROM\s+nurture_sequences/i.test(sql)) {
          return { rows: [seq], rowCount: 1 };
        }
        if (/SELECT\s+\*\s+FROM\s+nurture_steps/i.test(sql)) {
          return { rows: [step1], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+nurture_enrollments/i.test(sql)) {
          insertedStatus = (params as unknown[])[4] as string;
          return {
            rows: [
              {
                id: ENROLL_ID,
                tenant_id: TENANT_ID,
                candidate_id: CAND_ID,
                sequence_id: SEQ_ID,
                status: insertedStatus,
                current_step_order: 0,
                next_send_at: new Date().toISOString(),
                enrolled_by: USER_ID,
                enrolled_at: new Date().toISOString(),
                stopped_at: null,
                stopped_reason: null,
                finding_id: null,
                metadata: {},
              },
            ],
            rowCount: 1,
          };
        }
        if (/FROM\s+candidates/i.test(sql)) {
          return {
            rows: [
              {
                id: CAND_ID,
                name: 'Test',
                first_name: 'Test',
                last_name: '',
                email: 't@e.nl',
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT\s+INTO\s+outreach_messages/i.test(sql)) {
          return {
            rows: [
              {
                id: 'msg-x',
                tenant_id: TENANT_ID,
                candidate_id: CAND_ID,
                channel: 'email',
                direction: 'outbound',
                status: 'pending_approval',
                created_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const r = await enrollCandidate(TENANT_ID, {
      candidateId: CAND_ID,
      sequenceId: SEQ_ID,
      userId: USER_ID,
    });
    expect(insertedStatus).toBe('pending_approval');
    expect(r.id).toBe(ENROLL_ID);
  });

  it('enrollCandidate refuses on inactive sequence', async () => {
    const seq = {
      id: SEQ_ID,
      tenant_id: TENANT_ID,
      name: 'X',
      active: false,
      description: null,
      total_steps: 0,
      metadata: {},
      created_by: USER_ID,
      created_at: '',
      updated_at: '',
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+nurture_sequences/i.test(sql)) {
          return { rows: [seq], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      enrollCandidate(TENANT_ID, {
        candidateId: CAND_ID,
        sequenceId: SEQ_ID,
        userId: USER_ID,
      })
    ).rejects.toMatchObject({ code: 'SEQUENCE_INACTIVE' });
  });

  it('enrollCandidate refuses when sequence has no steps', async () => {
    const seq = {
      id: SEQ_ID,
      tenant_id: TENANT_ID,
      name: 'X',
      active: true,
      description: null,
      total_steps: 0,
      metadata: {},
      created_by: USER_ID,
      created_at: '',
      updated_at: '',
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+nurture_sequences/i.test(sql)) {
          return { rows: [seq], rowCount: 1 };
        }
        if (/SELECT\s+\*\s+FROM\s+nurture_steps/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      enrollCandidate(TENANT_ID, {
        candidateId: CAND_ID,
        sequenceId: SEQ_ID,
        userId: USER_ID,
      })
    ).rejects.toMatchObject({ code: 'SEQUENCE_HAS_NO_STEPS' });
  });

  it('pauseEnrollment flips status to paused', async () => {
    const paused = {
      id: ENROLL_ID,
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      sequence_id: SEQ_ID,
      status: 'paused',
      current_step_order: 1,
      next_send_at: null,
      enrolled_by: USER_ID,
      enrolled_at: '',
      stopped_at: null,
      stopped_reason: null,
      finding_id: null,
      metadata: {},
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/UPDATE\s+nurture_enrollments\s+SET\s+status\s*=\s*'paused'/i.test(sql)) {
          return { rows: [paused], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await pauseEnrollment(TENANT_ID, ENROLL_ID, { userId: USER_ID });
    expect(r.status).toBe('paused');
  });

  it('resumeEnrollment 409s when not paused', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    await expect(
      resumeEnrollment(TENANT_ID, ENROLL_ID, { userId: USER_ID })
    ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });

  it('stopEnrollment terminates with a reason', async () => {
    const stopped = {
      id: ENROLL_ID,
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      sequence_id: SEQ_ID,
      status: 'stopped',
      current_step_order: 1,
      next_send_at: null,
      enrolled_by: USER_ID,
      enrolled_at: '',
      stopped_at: new Date().toISOString(),
      stopped_reason: 'closed lost',
      finding_id: null,
      metadata: {},
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/UPDATE\s+nurture_enrollments\s+SET\s+status\s*=\s*'stopped'/i.test(sql)) {
          return { rows: [stopped], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await stopEnrollment(TENANT_ID, ENROLL_ID, 'closed lost', {
      userId: USER_ID,
    });
    expect(r.status).toBe('stopped');
    expect(r.stopped_reason).toBe('closed lost');
  });

  it('listEnrollments returns next_cursor for paginated results', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: `e-${i}`,
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      sequence_id: SEQ_ID,
      status: 'active',
      current_step_order: 0,
      enrolled_at: `2026-05-${String(10 - (i % 9)).padStart(2, '0')}`,
      next_send_at: null,
      enrolled_by: USER_ID,
      stopped_at: null,
      stopped_reason: null,
      finding_id: null,
      metadata: {},
    }));
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+nurture_enrollments/i.test(sql)) {
          return { rows, rowCount: rows.length };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await listEnrollments(TENANT_ID, { limit: 50 });
    expect(r.data).toHaveLength(50);
    expect(r.next_cursor).not.toBeNull();
  });

  it('getEnrollment 404s when not found', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    await expect(
      getEnrollment(TENANT_ID, ENROLL_ID)
    ).rejects.toMatchObject({ code: 'ENROLLMENT_NOT_FOUND' });
  });
});

describe('advanceEnrollments cron', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('marks enrollment as completed when no further steps exist', async () => {
    const dueRow = {
      id: ENROLL_ID,
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      sequence_id: SEQ_ID,
      status: 'active',
      current_step_order: 3,
      next_send_at: '2026-05-09T10:00:00Z',
      enrolled_by: USER_ID,
      enrolled_at: '',
      stopped_at: null,
      stopped_reason: null,
      finding_id: null,
      metadata: {},
    };
    let completedSeen = false;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+nurture_enrollments\s+WHERE\s+tenant_id\s*=\s*\$1/is.test(sql)) {
          return { rows: [dueRow], rowCount: 1 };
        }
        if (/FROM\s+nurture_steps\s+WHERE\s+sequence_id/is.test(sql)) {
          // no next step
          return { rows: [], rowCount: 0 };
        }
        if (/UPDATE\s+nurture_enrollments\s+SET\s+status\s*=\s*'completed'/is.test(sql)) {
          completedSeen = true;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await advanceEnrollments(TENANT_ID, new Date('2026-05-10T00:00:00Z'));
    expect(r.completed).toBe(1);
    expect(completedSeen).toBe(true);
  });

  it('drafts next step when one exists', async () => {
    const dueRow = {
      id: ENROLL_ID,
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      sequence_id: SEQ_ID,
      status: 'active',
      current_step_order: 1,
      next_send_at: '2026-05-09T10:00:00Z',
      enrolled_by: USER_ID,
      enrolled_at: '',
      stopped_at: null,
      stopped_reason: null,
      finding_id: null,
      metadata: {},
    };
    const nextStep = {
      id: STEP2,
      tenant_id: TENANT_ID,
      sequence_id: SEQ_ID,
      step_order: 2,
      channel: 'email',
      delay_days: 3,
      ai_personalize: true,
      template_subject: null,
      template_body: null,
      stop_on_reply: true,
      metadata: {},
      created_at: '',
    };
    let stepLookups = 0;
    let cursorUpdated = false;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+nurture_enrollments\s+WHERE\s+tenant_id\s*=\s*\$1\s+AND\s+status\s*=\s*'active'/is.test(sql)) {
          return { rows: [dueRow], rowCount: 1 };
        }
        if (/FROM\s+nurture_steps\s+WHERE\s+sequence_id/is.test(sql)) {
          stepLookups++;
          if (stepLookups === 1) {
            return { rows: [nextStep], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }
        if (/FROM\s+candidates/i.test(sql)) {
          return {
            rows: [
              {
                id: CAND_ID,
                name: 'X',
                first_name: 'X',
                last_name: '',
                email: 'x@y.nl',
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT\s+INTO\s+outreach_messages/i.test(sql)) {
          return {
            rows: [
              {
                id: 'm1',
                tenant_id: TENANT_ID,
                candidate_id: CAND_ID,
                channel: 'email',
                direction: 'outbound',
                status: 'pending_approval',
                created_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        if (/UPDATE\s+nurture_enrollments\s+SET\s+current_step_order/is.test(sql)) {
          cursorUpdated = true;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await advanceEnrollments(TENANT_ID, new Date('2026-05-10T00:00:00Z'));
    expect(r.drafted).toBe(1);
    expect(cursorUpdated).toBe(true);
  });

  it('handles empty due list gracefully', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    const r = await advanceEnrollments(TENANT_ID);
    expect(r.advanced).toBe(0);
  });
});

describe('cross-tenant isolation', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('listEnrollments uses tenant_id in WHERE — verified by capturing param', async () => {
    let lastTenant: string | null = null;
    const client = mockClient({
      __matcher: async (sql, params) => {
        if (/FROM\s+nurture_enrollments/i.test(sql)) {
          lastTenant = (params as unknown[])[0] as string;
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await listEnrollments(TENANT_ID, {});
    expect(lastTenant).toBe(TENANT_ID);
    await listEnrollments(TENANT_OTHER, {});
    expect(lastTenant).toBe(TENANT_OTHER);
  });
});
