/**
 * Outreach AI events / audit logging — Sprint Q4.5 (Agent XXX).
 *
 * Verifies EU AI Act compliance: every Claude draft + classification call
 * must end up in `ai_events` and the action in `audit_events`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

vi.mock('../../src/lib/aiEvents', () => ({
  logAIEvent: vi.fn(async () => undefined),
}));

vi.mock('../../src/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/audit')>(
    '../../src/lib/audit'
  );
  return { ...actual, logAudit: vi.fn(async () => undefined) };
});

import { draftOutreachMessage } from '../../src/modules/outreach/outreach.service';
import { classifyReply } from '../../src/modules/outreach/replyClassifier.service';
import { logAIEvent } from '../../src/lib/aiEvents';
import { logAudit } from '../../src/lib/audit';

const logAIEventMock = vi.mocked(logAIEvent);
const logAuditMock = vi.mocked(logAudit);

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';
const MSG_ID = '44444444-4444-4444-4444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_MOCK = 'true';
});

afterEach(() => {
  delete process.env.AI_MOCK;
});

describe('AI compliance logging', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('draftOutreachMessage logs ai_events with mocked status', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+candidates/i.test(sql)) {
          return {
            rows: [{ id: CAND_ID, name: 'X', first_name: 'X', last_name: '', email: 'x@y.nl' }],
            rowCount: 1,
          };
        }
        if (/INSERT\s+INTO\s+outreach_messages/i.test(sql)) {
          return {
            rows: [
              {
                id: MSG_ID,
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

    await draftOutreachMessage(
      TENANT_ID,
      CAND_ID,
      { channel: 'email' },
      { brief_role: 'PE' },
      { userId: USER_ID }
    );

    // Wait for the fire-and-forget logAIEvent.
    await new Promise((r) => setImmediate(r));

    expect(logAIEventMock).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({
        feature: 'outreach_draft',
        provider: 'anthropic',
        status: 'mocked',
        entityType: 'outreach_message',
      })
    );
    expect(logAuditMock).toHaveBeenCalled();
  });

  it('classifyReply logs ai_events + audit on success', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+id,\s*body_text,\s*direction/i.test(sql)) {
          return {
            rows: [{ id: MSG_ID, body_text: 'interested', direction: 'inbound' }],
            rowCount: 1,
          };
        }
        if (/INSERT\s+INTO\s+reply_classifications/i.test(sql)) {
          return {
            rows: [
              {
                id: 'c1',
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

    await classifyReply(TENANT_ID, MSG_ID);
    await new Promise((r) => setImmediate(r));

    expect(logAIEventMock).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({
        feature: 'outreach_reply_classifier',
        provider: 'anthropic',
      })
    );
    expect(logAuditMock).toHaveBeenCalled();
  });
});
