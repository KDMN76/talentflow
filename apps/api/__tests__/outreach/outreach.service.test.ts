/**
 * outreach.service tests — Sprint Q4.5 (Agent XXX).
 *
 * Covers drafting (mock-mode), approve/reject lifecycle, regenerate, quota
 * enforcement, recordReply, and listMessages.
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
  draftOutreachMessage,
  approveMessage,
  rejectMessage,
  regenerateMessage,
  reserveQuota,
  listMessages,
  recordReply,
  updateQuota,
  listQuotas,
  QuotaExceededError,
} from '../../src/modules/outreach/outreach.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_OTHER = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const RECRUITER_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';
const MSG_ID = '44444444-4444-4444-4444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_MOCK = 'true';
});

afterEach(() => {
  delete process.env.AI_MOCK;
});

describe('draftOutreachMessage', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns mocked draft + inserts pending_approval row when ai_personalize=true', async () => {
    const candRow = {
      id: CAND_ID,
      name: 'Lina van Es',
      first_name: 'Lina',
      last_name: 'van Es',
      email: 'lina@example.com',
    };
    const insertedRow = {
      id: MSG_ID,
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      channel: 'email',
      direction: 'outbound',
      status: 'pending_approval',
      subject: 'Lina, ben je open voor een Senior Engineer?',
      body_text: 'Hoi Lina,\n\nIk zag je profiel...',
      body_html: null,
      ai_model: 'claude-opus-4-7-mock',
      personalization_signals: { brief_role: 'Senior Engineer' },
      enrollment_id: null,
      step_id: null,
      created_at: new Date().toISOString(),
      sent_at: null,
      retry_count: 0,
      metadata: {},
    };
    let inserts = 0;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+candidates/i.test(sql)) {
          return { rows: [candRow], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+outreach_messages/i.test(sql)) {
          inserts++;
          return { rows: [insertedRow], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+audit_events/i.test(sql)) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await draftOutreachMessage(
      TENANT_ID,
      CAND_ID,
      { channel: 'email', ai_personalize: true },
      { brief_role: 'Senior Engineer', recruiter_name: 'Kaan' },
      { userId: USER_ID }
    );

    expect(result.mocked).toBe(true);
    expect(result.message.status).toBe('pending_approval');
    expect(inserts).toBe(1);
  });

  it('throws when candidate is not found', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+candidates/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      draftOutreachMessage(
        TENANT_ID,
        CAND_ID,
        { channel: 'email' },
        {},
        { userId: USER_ID }
      )
    ).rejects.toMatchObject({ code: 'CANDIDATE_NOT_FOUND' });
  });

  it('uses template merge-vars for the mocked draft when provided', async () => {
    const candRow = {
      id: CAND_ID,
      name: 'Sven',
      first_name: 'Sven',
      last_name: '',
      email: 's@e.nl',
    };
    let capturedBody = '';
    const client = mockClient({
      __matcher: async (sql, params) => {
        if (/FROM\s+candidates/i.test(sql)) {
          return { rows: [candRow], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+outreach_messages/i.test(sql)) {
          // Params are (tenant, enrol, step, cand, chan, status, subject, body_text, model, ...)
          capturedBody = String((params as unknown[])[7] ?? '');
          return {
            rows: [
              {
                id: MSG_ID,
                tenant_id: TENANT_ID,
                candidate_id: CAND_ID,
                channel: 'email',
                direction: 'outbound',
                status: 'pending_approval',
                body_text: capturedBody,
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
      {
        channel: 'email',
        template_subject: 'Hoi {{candidate.first_name}}',
        template_body: 'Hi {{candidate.first_name}}, voor {{job.title}}',
      },
      { brief_role: 'DevOps lead' },
      { userId: USER_ID }
    );
    expect(capturedBody).toContain('Hi Sven');
    expect(capturedBody).toContain('DevOps lead');
  });
});

describe('approveMessage / rejectMessage', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('approveMessage flips drafted → approved', async () => {
    const updatedRow = {
      id: MSG_ID,
      tenant_id: TENANT_ID,
      status: 'approved',
      candidate_id: CAND_ID,
      channel: 'email',
      direction: 'outbound',
      created_at: new Date().toISOString(),
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/UPDATE\s+outreach_messages.*status\s*=\s*'approved'/is.test(sql)) {
          return { rows: [updatedRow], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const row = await approveMessage(TENANT_ID, MSG_ID, { userId: USER_ID });
    expect(row.status).toBe('approved');
  });

  it('approveMessage throws 409 when status is not drafted/pending_approval', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/UPDATE\s+outreach_messages.*status\s*=\s*'approved'/is.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT\s+status\s+FROM\s+outreach_messages/i.test(sql)) {
          return { rows: [{ status: 'sent' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      approveMessage(TENANT_ID, MSG_ID, { userId: USER_ID })
    ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });

  it('rejectMessage with pause_enrollment also pauses enrollment', async () => {
    let pausedSequence = false;
    const rejected = {
      id: MSG_ID,
      tenant_id: TENANT_ID,
      enrollment_id: 'enrol-1',
      status: 'rejected_by_recruiter',
      candidate_id: CAND_ID,
      channel: 'email',
      direction: 'outbound',
      rejection_reason: 'Too generic',
      created_at: new Date().toISOString(),
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/UPDATE\s+outreach_messages.*rejected_by/is.test(sql)) {
          return { rows: [rejected], rowCount: 1 };
        }
        if (/UPDATE\s+nurture_enrollments.*paused/is.test(sql)) {
          pausedSequence = true;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await rejectMessage(TENANT_ID, MSG_ID, {
      userId: USER_ID,
      reason: 'Too generic',
      pauseEnrollment: true,
    });
    expect(pausedSequence).toBe(true);
  });

  it('rejectMessage throws 409 when message already sent', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    await expect(
      rejectMessage(TENANT_ID, MSG_ID, { userId: USER_ID, reason: 'nope' })
    ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
  });
});

describe('regenerateMessage', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('refuses to regenerate already-sent messages', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+outreach_messages/i.test(sql)) {
          return {
            rows: [
              {
                id: MSG_ID,
                tenant_id: TENANT_ID,
                candidate_id: CAND_ID,
                channel: 'email',
                direction: 'outbound',
                sent_at: new Date().toISOString(),
                status: 'sent',
                personalization_signals: {},
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      regenerateMessage(TENANT_ID, MSG_ID, { userId: USER_ID })
    ).rejects.toMatchObject({ code: 'MESSAGE_ALREADY_SENT' });
  });

  it('refuses regenerate on inbound messages', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+outreach_messages/i.test(sql)) {
          return {
            rows: [
              {
                id: MSG_ID,
                tenant_id: TENANT_ID,
                candidate_id: CAND_ID,
                channel: 'email',
                direction: 'inbound',
                sent_at: null,
                status: 'sent',
                personalization_signals: {},
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      regenerateMessage(TENANT_ID, MSG_ID, { userId: USER_ID })
    ).rejects.toMatchObject({ code: 'INVALID_DIRECTION' });
  });
});

describe('quota enforcement', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('reserveQuota succeeds when below limits', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/INSERT\s+INTO\s+outreach_quotas/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        if (/UPDATE\s+outreach_quotas\s+SET\s+current_day_count\s*=\s*current_day_count\s*\+\s*1/i.test(sql)) {
          return {
            rows: [
              {
                current_day_count: 3,
                current_week_count: 12,
                daily_limit: 100,
                weekly_limit: 500,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      reserveQuota(TENANT_ID, RECRUITER_ID, 'email')
    ).resolves.toBeUndefined();
  });

  it('reserveQuota throws QuotaExceededError when daily cap reached', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/UPDATE\s+outreach_quotas\s+SET\s+current_day_count\s*=\s*current_day_count\s*\+\s*1/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT\s+current_day_count/i.test(sql)) {
          return {
            rows: [
              {
                current_day_count: 100,
                current_week_count: 350,
                daily_limit: 100,
                weekly_limit: 500,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      reserveQuota(TENANT_ID, RECRUITER_ID, 'email')
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('reserveQuota throws weekly QuotaExceededError when week cap reached first', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/UPDATE\s+outreach_quotas\s+SET\s+current_day_count\s*=\s*current_day_count\s*\+\s*1/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT\s+current_day_count/i.test(sql)) {
          return {
            rows: [
              {
                current_day_count: 5,
                current_week_count: 500,
                daily_limit: 100,
                weekly_limit: 500,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      reserveQuota(TENANT_ID, RECRUITER_ID, 'email')
    ).rejects.toMatchObject({ code: 'QUOTA_WEEKLY_EXCEEDED' });
  });

  it('updateQuota upserts custom limits', async () => {
    const upserted = {
      id: 'q1',
      tenant_id: TENANT_ID,
      recruiter_id: RECRUITER_ID,
      channel: 'email',
      daily_limit: 50,
      weekly_limit: 300,
      current_day_count: 0,
      current_week_count: 0,
      reset_day_at: null,
      reset_week_at: null,
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/INSERT\s+INTO\s+outreach_quotas/i.test(sql)) {
          return { rows: [upserted], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const r = await updateQuota(TENANT_ID, RECRUITER_ID, 'email', {
      daily_limit: 50,
      weekly_limit: 300,
    });
    expect(r.daily_limit).toBe(50);
    expect(r.weekly_limit).toBe(300);
  });

  it('listQuotas returns rows scoped to tenant via RLS', async () => {
    const rows = [
      { id: 'q1', tenant_id: TENANT_ID, recruiter_id: RECRUITER_ID, channel: 'email' },
    ];
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+outreach_quotas/i.test(sql)) {
          return { rows, rowCount: rows.length };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const result = await listQuotas(TENANT_ID);
    expect(result).toHaveLength(1);
    expect(result[0].tenant_id).toBe(TENANT_ID);
  });
});

describe('recordReply', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('links inbound reply to outbound parent by external_thread_id', async () => {
    const parent = {
      id: 'parent-1',
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      channel: 'email',
      direction: 'outbound',
      external_thread_id: 'thread-abc',
      enrollment_id: 'enrol-1',
    };
    const newReply = {
      id: 'reply-1',
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      direction: 'inbound',
      channel: 'email',
      body_text: 'thanks!',
      external_thread_id: 'thread-abc',
      sent_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    let parentLinked = false;
    let enrollmentReplied = false;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/SELECT\s+\*\s+FROM\s+outreach_messages\s+WHERE\s+id/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/external_thread_id\s*=\s*\$2\s+AND\s+direction\s*=\s*'outbound'/is.test(sql)) {
          return { rows: [parent], rowCount: 1 };
        }
        if (/INSERT\s+INTO\s+outreach_messages.*'inbound'/is.test(sql)) {
          return { rows: [newReply], rowCount: 1 };
        }
        if (/UPDATE\s+outreach_messages\s+SET\s+reply_message_id/is.test(sql)) {
          parentLinked = true;
          return { rows: [], rowCount: 1 };
        }
        if (/UPDATE\s+nurture_enrollments\s+SET\s+status\s*=\s*'replied'/is.test(sql)) {
          enrollmentReplied = true;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const reply = await recordReply(TENANT_ID, {
      externalThreadId: 'thread-abc',
      body_text: 'thanks!',
    });
    expect(reply.direction).toBe('inbound');
    expect(parentLinked).toBe(true);
    expect(enrollmentReplied).toBe(true);
  });

  it('throws when reply cannot be linked + no candidate id provided', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(
      recordReply(TENANT_ID, {
        externalThreadId: 'unknown',
        body_text: 'hi',
      })
    ).rejects.toMatchObject({ code: 'CANNOT_LINK_REPLY' });
  });
});

describe('listMessages — cross-tenant safety', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('only returns messages for the requesting tenant', async () => {
    const tenantARows = [
      {
        id: 'm1',
        tenant_id: TENANT_ID,
        candidate_id: CAND_ID,
        channel: 'email',
        direction: 'outbound',
        status: 'sent',
        created_at: '2026-05-09T10:00:00Z',
      },
    ];
    let lastQueryParams: unknown[] = [];
    const client = mockClient({
      __matcher: async (sql, params) => {
        if (/SELECT\s+\*\s+FROM\s+outreach_messages/i.test(sql)) {
          lastQueryParams = params as unknown[];
          // Filter by params[0] = tenant
          const tenant = lastQueryParams[0] as string;
          if (tenant === TENANT_ID) {
            return { rows: tenantARows, rowCount: tenantARows.length };
          }
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const a = await listMessages(TENANT_ID, {});
    expect(a.data).toHaveLength(1);
    const b = await listMessages(TENANT_OTHER, {});
    expect(b.data).toHaveLength(0);
  });
});
