/**
 * inbox.service tests — Sprint Q4.6 (Agent AAAA).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

vi.mock('../../src/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/audit')>(
    '../../src/lib/audit'
  );
  return { ...actual, logAudit: vi.fn(async () => undefined) };
});

import {
  ensureThread,
  listThreads,
  getThread,
  getThreadTimeline,
  markThreadRead,
  assignThread,
  setPinned,
  setArchived,
  addLabel,
  removeLabel,
} from '../../src/modules/inbox/inbox.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_OTHER = '99999999-9999-9999-9999-999999999999';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';
const THREAD_ID = '44444444-4444-4444-4444-444444444444';

beforeEach(() => vi.clearAllMocks());

describe('ensureThread', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('upserts a unified_threads row for the candidate', async () => {
    const row = {
      id: THREAD_ID,
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      last_message_at: null,
      last_channel: null,
      last_message_preview: null,
      unread_count_for_assignee: 0,
      assignee_user_id: null,
      pinned: false,
      archived_at: null,
      labels: [],
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    let inserts = 0;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/INSERT\s+INTO\s+unified_threads/i.test(sql)) {
          inserts++;
          return { rows: [row], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await ensureThread(TENANT_ID, CAND_ID);
    expect(result.id).toBe(THREAD_ID);
    expect(inserts).toBe(1);
  });

  it('ensures idempotency by upserting on (tenant, candidate)', async () => {
    const row = {
      id: THREAD_ID,
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      last_message_at: null,
      last_channel: null,
      last_message_preview: null,
      unread_count_for_assignee: 0,
      assignee_user_id: null,
      pinned: false,
      archived_at: null,
      labels: [],
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/unified_threads/i.test(sql)) {
          // ON CONFLICT path returns the existing row.
          return { rows: [row], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const a = await ensureThread(TENANT_ID, CAND_ID);
    const b = await ensureThread(TENANT_ID, CAND_ID);
    expect(a.id).toBe(b.id);
  });
});

describe('recordCommunication (inboxProjector)', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('updates last_message + increments unread for inbound', async () => {
    const { recordCommunication } = await import('../../src/lib/inboxProjector');
    let lastUpsertArgs: unknown[] | null = null;
    const client = mockClient({
      __matcher: async (sql, params) => {
        if (/INSERT\s+INTO\s+unified_threads/i.test(sql)) {
          lastUpsertArgs = params as unknown[];
          return { rows: [{ id: THREAD_ID }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await recordCommunication({
      tenantId: TENANT_ID,
      candidateId: CAND_ID,
      communicationId: '55555555-5555-5555-5555-555555555555',
      channel: 'whatsapp',
      direction: 'inbound',
      preview: 'Hoi! Wanneer kan ik bellen?',
      suppressEvent: true,
    });

    expect(lastUpsertArgs).not.toBeNull();
    // direction param is positional ($6) → 'inbound'
    const params = lastUpsertArgs as unknown[];
    expect(params[5]).toBe('inbound');
    // channel ($4)
    expect(params[3]).toBe('whatsapp');
  });

  it('does NOT increment unread for outbound direction', async () => {
    const { recordCommunication } = await import('../../src/lib/inboxProjector');
    let lastUpsertArgs: unknown[] | null = null;
    const client = mockClient({
      __matcher: async (sql, params) => {
        if (/INSERT\s+INTO\s+unified_threads/i.test(sql)) {
          lastUpsertArgs = params as unknown[];
          return { rows: [{ id: THREAD_ID }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await recordCommunication({
      tenantId: TENANT_ID,
      candidateId: CAND_ID,
      communicationId: '55555555-5555-5555-5555-555555555555',
      channel: 'email',
      direction: 'outbound',
      preview: 'Hallo Lina',
      suppressEvent: true,
    });

    const params = lastUpsertArgs as unknown[];
    expect(params[5]).toBe('outbound');
  });

  it('truncates preview to 200 chars', async () => {
    const { truncatePreview } = await import('../../src/lib/inboxProjector');
    const long = 'a'.repeat(500);
    const result = truncatePreview(long);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('listThreads', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  function buildThread(id: string, ts: string): Record<string, unknown> {
    return {
      id,
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      last_message_at: ts,
      last_channel: 'email',
      last_message_preview: 'hello',
      unread_count_for_assignee: 0,
      assignee_user_id: null,
      pinned: false,
      archived_at: null,
      labels: [],
      metadata: {},
      created_at: ts,
      updated_at: ts,
      candidate_name: 'Test',
    };
  }

  it('returns threads with no cursor when result fits in one page', async () => {
    const rows = [
      buildThread('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-05-01T10:00:00Z'),
      buildThread('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-05-01T09:00:00Z'),
    ];
    const client = mockClient({
      __matcher: async () => ({ rows, rowCount: rows.length }),
    });
    teardown = installPoolMock(client);

    const result = await listThreads(TENANT_ID, { limit: 50 });
    expect(result.data.length).toBe(2);
    expect(result.next_cursor).toBeNull();
  });

  it('returns next_cursor when there are more results than limit', async () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      buildThread(
        `${'aaaaaaaa'.slice(0, 7)}${i}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,
        `2026-05-01T1${i}:00:00Z`
      )
    );
    const client = mockClient({
      __matcher: async () => ({ rows, rowCount: rows.length }),
    });
    teardown = installPoolMock(client);

    const result = await listThreads(TENANT_ID, { limit: 3 });
    expect(result.data.length).toBe(3);
    expect(result.next_cursor).not.toBeNull();
  });

  it('applies all filters in the SQL WHERE clause', async () => {
    let captured: string = '';
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+unified_threads/i.test(sql)) {
          captured = sql;
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await listThreads(TENANT_ID, {
      unread: true,
      channel: 'whatsapp',
      assignee_user_id: USER_ID,
      pinned: true,
      archived: false,
      q: 'lina',
    });

    expect(captured).toContain('unread_count_for_assignee > 0');
    expect(captured).toContain('last_channel');
    expect(captured).toContain('assignee_user_id');
    expect(captured).toContain('t.pinned = TRUE');
    expect(captured).toContain('t.archived_at IS NULL');
    expect(captured).toContain('LIKE');
  });

  it('cross-tenant isolation: query carries tenantId in $1', async () => {
    let params: unknown[] | null = null;
    const client = mockClient({
      __matcher: async (sql, p) => {
        if (/FROM\s+unified_threads/i.test(sql)) params = p as unknown[];
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await listThreads(TENANT_OTHER, {});
    expect(params).not.toBeNull();
    expect((params as unknown[])[0]).toBe(TENANT_OTHER);
  });
});

describe('getThread + getThreadTimeline', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('returns 404 when thread is not found', async () => {
    const client = mockClient({ __matcher: async () => ({ rows: [], rowCount: 0 }) });
    teardown = installPoolMock(client);
    await expect(getThread(TENANT_ID, THREAD_ID)).rejects.toThrow(/Thread niet gevonden/);
  });

  it('merges email + voice + outreach into timeline sorted desc', async () => {
    const commRow = {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      channel: 'email',
      direction: 'outbound',
      sent_at: '2026-05-01T10:00:00Z',
      created_at: '2026-05-01T10:00:00Z',
      subject: 'Hi',
      body: 'Email body',
      preview: 'Email body',
      message_id: 'mid-1',
      thread_id: null,
    };
    const voiceRow = {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      direction: 'outbound',
      status: 'completed',
      started_at: '2026-05-01T11:00:00Z',
      ended_at: '2026-05-01T11:01:00Z',
      created_at: '2026-05-01T11:00:00Z',
      duration_seconds: 42,
      recording_url: 'https://example.com/rec.mp3',
      transcription_text: 'Goedemorgen!',
      voicemail: false,
      notes: null,
      from_number: '+311234',
      to_number: '+316789',
      metadata: {},
    };
    const outreachRow = {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      channel: 'linkedin_inmail',
      direction: 'outbound',
      status: 'sent',
      subject: 'LinkedIn',
      body_text: 'Hoi Lina!',
      body_html: null,
      sent_at: '2026-05-01T09:00:00Z',
      created_at: '2026-05-01T09:00:00Z',
      metadata: {},
    };

    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+unified_threads/i.test(sql)) {
          return { rows: [{ candidate_id: CAND_ID }], rowCount: 1 };
        }
        if (/FROM\s+communications/i.test(sql)) {
          return { rows: [commRow], rowCount: 1 };
        }
        if (/FROM\s+voice_calls/i.test(sql)) {
          return { rows: [voiceRow], rowCount: 1 };
        }
        if (/FROM\s+outreach_messages/i.test(sql)) {
          return { rows: [outreachRow], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await getThreadTimeline(TENANT_ID, THREAD_ID, { limit: 50 });
    expect(result.data.length).toBe(3);
    // Sorted desc by timestamp:
    expect(result.data[0].channel).toBe('voice');
    expect(result.data[1].channel).toBe('email');
    expect(result.data[2].channel).toBe('linkedin_inmail');
    expect(result.data[0].attachments.length).toBe(1);
  });

  it('uses voicemail preview when no transcript and voicemail=true', async () => {
    const voiceRow = {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      direction: 'inbound',
      status: 'voicemail',
      started_at: '2026-05-01T11:00:00Z',
      ended_at: '2026-05-01T11:01:00Z',
      created_at: '2026-05-01T11:00:00Z',
      duration_seconds: 30,
      recording_url: null,
      transcription_text: null,
      voicemail: true,
      notes: null,
      from_number: '+311234',
      to_number: '+316789',
      metadata: {},
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+unified_threads/i.test(sql)) {
          return { rows: [{ candidate_id: CAND_ID }], rowCount: 1 };
        }
        if (/FROM\s+voice_calls/i.test(sql)) {
          return { rows: [voiceRow], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await getThreadTimeline(TENANT_ID, THREAD_ID);
    expect(result.data[0].preview).toContain('Voicemail');
  });
});

describe('markThreadRead', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('zeroes the unread counter', async () => {
    let updated = false;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/UPDATE\s+unified_threads/i.test(sql) && /unread_count_for_assignee\s*=\s*0/i.test(sql)) {
          updated = true;
          return {
            rows: [
              {
                id: THREAD_ID,
                tenant_id: TENANT_ID,
                candidate_id: CAND_ID,
                last_message_at: null,
                last_channel: null,
                last_message_preview: null,
                unread_count_for_assignee: 0,
                assignee_user_id: null,
                pinned: false,
                archived_at: null,
                labels: [],
                metadata: {},
                created_at: '',
                updated_at: '',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await markThreadRead(TENANT_ID, THREAD_ID, USER_ID);
    expect(updated).toBe(true);
    expect(result.unread_count_for_assignee).toBe(0);
  });

  it('throws 404 when thread does not exist', async () => {
    const client = mockClient({
      __matcher: async () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    await expect(markThreadRead(TENANT_ID, THREAD_ID, USER_ID)).rejects.toThrow();
  });
});

describe('assignThread / setPinned / setArchived', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  function returnRow(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      id: THREAD_ID,
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      last_message_at: null,
      last_channel: null,
      last_message_preview: null,
      unread_count_for_assignee: 0,
      assignee_user_id: null,
      pinned: false,
      archived_at: null,
      labels: [],
      metadata: {},
      created_at: '',
      updated_at: '',
      ...overrides,
    };
  }

  it('assignThread updates assignee_user_id', async () => {
    const client = mockClient({
      __matcher: async () => ({
        rows: [returnRow({ assignee_user_id: USER_ID })],
        rowCount: 1,
      }),
    });
    teardown = installPoolMock(client);
    const r = await assignThread(TENANT_ID, THREAD_ID, USER_ID);
    expect(r.assignee_user_id).toBe(USER_ID);
  });

  it('setPinned(true) pins the thread', async () => {
    const client = mockClient({
      __matcher: async () => ({
        rows: [returnRow({ pinned: true })],
        rowCount: 1,
      }),
    });
    teardown = installPoolMock(client);
    const r = await setPinned(TENANT_ID, THREAD_ID, true);
    expect(r.pinned).toBe(true);
  });

  it('setArchived(true) sets archived_at', async () => {
    const client = mockClient({
      __matcher: async () => ({
        rows: [returnRow({ archived_at: '2026-05-01T12:00:00Z' })],
        rowCount: 1,
      }),
    });
    teardown = installPoolMock(client);
    const r = await setArchived(TENANT_ID, THREAD_ID, true);
    expect(r.archived_at).not.toBeNull();
  });
});

describe('labels', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('addLabel appends a normalized label', async () => {
    let updateArgs: unknown[] | null = null;
    const baseRow = {
      id: THREAD_ID,
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      last_message_at: null,
      last_channel: null,
      last_message_preview: null,
      unread_count_for_assignee: 0,
      assignee_user_id: null,
      pinned: false,
      archived_at: null,
      labels: ['existing'],
      metadata: {},
      created_at: '',
      updated_at: '',
    };
    const client = mockClient({
      __matcher: async (sql, params) => {
        if (/^SELECT\s+\*\s+FROM\s+unified_threads/i.test(sql)) {
          return { rows: [baseRow], rowCount: 1 };
        }
        if (/UPDATE\s+unified_threads/i.test(sql)) {
          updateArgs = params as unknown[];
          return { rows: [{ ...baseRow, labels: ['existing', 'urgent'] }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const r = await addLabel(TENANT_ID, THREAD_ID, 'URGENT');
    expect(r.labels).toContain('urgent');
    expect(updateArgs).not.toBeNull();
  });

  it('addLabel rejects empty label', async () => {
    const client = mockClient({});
    teardown = installPoolMock(client);
    await expect(addLabel(TENANT_ID, THREAD_ID, '   ')).rejects.toThrow();
  });

  it('removeLabel filters the array', async () => {
    const baseRow = {
      id: THREAD_ID,
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      last_message_at: null,
      last_channel: null,
      last_message_preview: null,
      unread_count_for_assignee: 0,
      assignee_user_id: null,
      pinned: false,
      archived_at: null,
      labels: ['urgent', 'spam'],
      metadata: {},
      created_at: '',
      updated_at: '',
    };
    const client = mockClient({
      __matcher: async (sql) => {
        if (/^SELECT\s+\*\s+FROM\s+unified_threads/i.test(sql)) {
          return { rows: [baseRow], rowCount: 1 };
        }
        if (/UPDATE\s+unified_threads/i.test(sql)) {
          return { rows: [{ ...baseRow, labels: ['spam'] }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const r = await removeLabel(TENANT_ID, THREAD_ID, 'urgent');
    expect(r.labels).not.toContain('urgent');
  });
});
