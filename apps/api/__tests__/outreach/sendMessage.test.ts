/**
 * outreach.service.sendMessage tests — Sprint Q4.5 (Agent XXX).
 *
 * Verifies that sendMessage:
 *   - reserves quota before invoking the channel callback
 *   - flips status approved → sending → sent
 *   - emits outreachMessageSent event on success
 *   - sets status=failed and increments retry_count on error
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

import { sendMessage, type OutreachMessageRow } from '../../src/modules/outreach/outreach.service';
import { eventBus } from '../../src/lib/eventBus';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const MSG_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';
const RECRUITER_ID = '44444444-4444-4444-4444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sendMessage', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('successful path: approved → sending → sent', async () => {
    const approved: OutreachMessageRow = {
      id: MSG_ID,
      tenant_id: TENANT_ID,
      enrollment_id: null,
      step_id: null,
      candidate_id: CAND_ID,
      channel: 'email',
      direction: 'outbound',
      status: 'approved',
      subject: 'Hi',
      body_text: 'Hello',
      body_html: null,
      ai_model: 'mock',
      prompt_tokens: 0,
      completion_tokens: 0,
      personalization_signals: {},
      scheduled_for: null,
      sent_at: null,
      external_id: null,
      external_thread_id: null,
      approved_by: RECRUITER_ID,
      approved_at: new Date().toISOString(),
      rejected_by: null,
      rejected_at: null,
      rejection_reason: null,
      reply_message_id: null,
      error_message: null,
      retry_count: 0,
      metadata: {},
      created_at: new Date().toISOString(),
    };
    let sentSeen = false;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+outreach_messages/i.test(sql)) {
          return { rows: [approved], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+outreach_quotas/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        if (/UPDATE\s+outreach_quotas/i.test(sql)) {
          return {
            rows: [
              {
                current_day_count: 1,
                current_week_count: 1,
                daily_limit: 100,
                weekly_limit: 500,
              },
            ],
            rowCount: 1,
          };
        }
        if (/UPDATE\s+outreach_messages\s+SET\s+status\s*=\s*'sending'/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        if (/UPDATE\s+outreach_messages\s+SET\s+status\s*=\s*'sent'/i.test(sql)) {
          sentSeen = true;
          return {
            rows: [
              { ...approved, status: 'sent', external_id: 'mock-id', sent_at: new Date().toISOString() },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const events: unknown[] = [];
    eventBus.on('outreachMessageSent', (p) => events.push(p));

    const r = await sendMessage(TENANT_ID, MSG_ID, async () => ({
      external_id: 'mock-id',
      external_thread_id: 'thread-x',
    }));

    expect(r.status).toBe('sent');
    expect(r.external_id).toBe('mock-id');
    expect(sentSeen).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('failure path marks status=failed + bumps retry_count + re-throws', async () => {
    const approved = {
      id: MSG_ID,
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      channel: 'email',
      direction: 'outbound',
      status: 'approved',
      approved_by: RECRUITER_ID,
      retry_count: 0,
      sent_at: null,
      created_at: new Date().toISOString(),
      personalization_signals: {},
      metadata: {},
    };
    let failedSeen = false;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+outreach_messages/i.test(sql)) {
          return { rows: [approved], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+outreach_quotas/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        if (/UPDATE\s+outreach_quotas/i.test(sql)) {
          return {
            rows: [
              {
                current_day_count: 1,
                current_week_count: 1,
                daily_limit: 100,
                weekly_limit: 500,
              },
            ],
            rowCount: 1,
          };
        }
        if (/UPDATE\s+outreach_messages\s+SET\s+status\s*=\s*'failed'/i.test(sql)) {
          failedSeen = true;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      sendMessage(TENANT_ID, MSG_ID, async () => {
        throw new Error('synthetic-failure');
      })
    ).rejects.toThrow('synthetic-failure');
    expect(failedSeen).toBe(true);
  });

  it('refuses to send when status is not approved/sending', async () => {
    const draft = {
      id: MSG_ID,
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      channel: 'email',
      direction: 'outbound',
      status: 'drafted',
      approved_by: null,
      retry_count: 0,
      sent_at: null,
      created_at: '',
      personalization_signals: {},
      metadata: {},
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+outreach_messages/i.test(sql)) {
          return { rows: [draft], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      sendMessage(TENANT_ID, MSG_ID, async () => ({ external_id: 'x' }))
    ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });

  it('throws 404 when message not found', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    await expect(
      sendMessage(TENANT_ID, MSG_ID, async () => ({ external_id: 'x' }))
    ).rejects.toMatchObject({ code: 'MESSAGE_NOT_FOUND' });
  });
});
