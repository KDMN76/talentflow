/**
 * replyClassifier.service tests — Sprint Q4.5 (Agent XXX).
 *
 * Heuristic-based classification of inbound replies — covers all 8 categories
 * + applyNextAction side-effects (pause, stop, do-not-contact, schedule_call).
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
  classifyByHeuristic,
  classifyReply,
  applyNextAction,
} from '../../src/modules/outreach/replyClassifier.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const MSG_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';
const ENROLL_ID = '44444444-4444-4444-4444-444444444444';
const CLASS_ID = '55555555-5555-5555-5555-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_MOCK = 'true';
});

afterEach(() => {
  delete process.env.AI_MOCK;
});

describe('classifyByHeuristic — covers all 8 categories', () => {
  it('"unsubscribe" → unsubscribe', () => {
    const r = classifyByHeuristic('Please unsubscribe me, thanks');
    expect(r.category).toBe('unsubscribe');
    expect(r.next_action).toBe('remove_from_outreach');
  });

  it('"out of office" → out_of_office', () => {
    const r = classifyByHeuristic('I am out of office until Monday');
    expect(r.category).toBe('out_of_office');
    expect(r.next_action).toBe('pause_sequence');
  });

  it('"not interested" → not_interested', () => {
    const r = classifyByHeuristic('Sorry, not interested');
    expect(r.category).toBe('not_interested');
    expect(r.next_action).toBe('remove_from_outreach');
  });

  it('"spam" → spam', () => {
    const r = classifyByHeuristic('this looks like spam');
    expect(r.category).toBe('spam');
  });

  it('"later" → not_now', () => {
    const r = classifyByHeuristic('Misschien later, niet nu');
    expect(r.category).toBe('not_now');
    expect(r.next_action).toBe('pause_sequence');
  });

  it('"interested / tell me more" → interested', () => {
    const r = classifyByHeuristic("I'm interested, tell me more");
    expect(r.category).toBe('interested');
    expect(r.next_action).toBe('schedule_call');
  });

  it('reply with question mark → question', () => {
    const r = classifyByHeuristic('What is the salary range?');
    expect(r.category).toBe('question');
    expect(r.next_action).toBe('manual_review');
  });

  it('empty reply → unknown / manual_review', () => {
    const r = classifyByHeuristic('');
    expect(r.category).toBe('unknown');
    expect(r.next_action).toBe('manual_review');
  });
});

describe('classifyReply — persists row', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('inserts a reply_classifications row with mocked model + heuristic result', async () => {
    let inserted = false;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+id,\s*body_text,\s*direction\s+FROM\s+outreach_messages/i.test(sql)) {
          return {
            rows: [
              {
                id: MSG_ID,
                body_text: 'Sounds good — I am interested!',
                direction: 'inbound',
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT\s+INTO\s+reply_classifications/i.test(sql)) {
          inserted = true;
          return {
            rows: [
              {
                id: CLASS_ID,
                tenant_id: TENANT_ID,
                message_id: MSG_ID,
                category: 'interested',
                sentiment: 'positive',
                next_action: 'schedule_call',
                ai_model: 'claude-haiku-4-5-20251001-mock',
                confidence: 0.9,
                classified_at: new Date().toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const row = await classifyReply(TENANT_ID, MSG_ID);
    expect(row.category).toBe('interested');
    expect(row.next_action).toBe('schedule_call');
    expect(inserted).toBe(true);
  });

  it('refuses to classify outbound messages', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+id,\s*body_text,\s*direction/i.test(sql)) {
          return {
            rows: [{ id: MSG_ID, body_text: 'hi', direction: 'outbound' }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(classifyReply(TENANT_ID, MSG_ID)).rejects.toMatchObject({
      code: 'NOT_INBOUND',
    });
  });

  it('throws 404 when message id not found', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(classifyReply(TENANT_ID, MSG_ID)).rejects.toMatchObject({
      code: 'MESSAGE_NOT_FOUND',
    });
  });
});

describe('applyNextAction', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('pause_sequence → pauses the related enrollment', async () => {
    let pausedSql: string | null = null;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+reply_classifications/i.test(sql)) {
          return {
            rows: [
              {
                id: CLASS_ID,
                tenant_id: TENANT_ID,
                message_id: MSG_ID,
                next_action: 'pause_sequence',
                category: 'out_of_office',
              },
            ],
            rowCount: 1,
          };
        }
        if (/candidate_id,\s*enrollment_id\s+FROM\s+outreach_messages/i.test(sql)) {
          return {
            rows: [{ candidate_id: CAND_ID, enrollment_id: ENROLL_ID }],
            rowCount: 1,
          };
        }
        if (/UPDATE\s+nurture_enrollments\s+SET\s+status\s*=\s*'paused'/i.test(sql)) {
          pausedSql = sql;
          return {
            rows: [{ id: ENROLL_ID, status: 'paused' }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const r = await applyNextAction(TENANT_ID, CLASS_ID);
    expect(r.applied).toBe('pause_sequence');
    expect(pausedSql).not.toBeNull();
  });

  it('remove_from_outreach → stops enrollment + tags do_not_contact', async () => {
    let stoppedSeen = false;
    let dncSeen = false;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+reply_classifications/i.test(sql)) {
          return {
            rows: [
              {
                id: CLASS_ID,
                tenant_id: TENANT_ID,
                message_id: MSG_ID,
                next_action: 'remove_from_outreach',
                category: 'unsubscribe',
              },
            ],
            rowCount: 1,
          };
        }
        if (/candidate_id,\s*enrollment_id/i.test(sql)) {
          return {
            rows: [{ candidate_id: CAND_ID, enrollment_id: ENROLL_ID }],
            rowCount: 1,
          };
        }
        if (/UPDATE\s+nurture_enrollments\s+SET\s+status\s*=\s*'stopped'/is.test(sql)) {
          stoppedSeen = true;
          return {
            rows: [{ id: ENROLL_ID, status: 'stopped' }],
            rowCount: 1,
          };
        }
        if (/UPDATE\s+candidates\s+SET\s+metadata/is.test(sql)) {
          dncSeen = true;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await applyNextAction(TENANT_ID, CLASS_ID);
    expect(stoppedSeen).toBe(true);
    expect(dncSeen).toBe(true);
  });

  it('schedule_call → inserts a tasks row', async () => {
    let taskInserted = false;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+reply_classifications/i.test(sql)) {
          return {
            rows: [
              {
                id: CLASS_ID,
                tenant_id: TENANT_ID,
                message_id: MSG_ID,
                next_action: 'schedule_call',
                category: 'interested',
              },
            ],
            rowCount: 1,
          };
        }
        if (/candidate_id,\s*enrollment_id/i.test(sql)) {
          return {
            rows: [{ candidate_id: CAND_ID, enrollment_id: null }],
            rowCount: 1,
          };
        }
        if (/INSERT\s+INTO\s+tasks/i.test(sql)) {
          taskInserted = true;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await applyNextAction(TENANT_ID, CLASS_ID);
    expect(taskInserted).toBe(true);
  });

  it('manual_review → no-op, only returns applied', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+reply_classifications/i.test(sql)) {
          return {
            rows: [
              {
                id: CLASS_ID,
                tenant_id: TENANT_ID,
                message_id: MSG_ID,
                next_action: 'manual_review',
                category: 'question',
              },
            ],
            rowCount: 1,
          };
        }
        if (/candidate_id,\s*enrollment_id/i.test(sql)) {
          return {
            rows: [{ candidate_id: CAND_ID, enrollment_id: null }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const r = await applyNextAction(TENANT_ID, CLASS_ID);
    expect(r.applied).toBe('manual_review');
  });
});
