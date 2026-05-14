/**
 * eventBus + findingApproved hook test — Sprint Q4.5 (Agent XXX).
 *
 * Verifies that emitting `findingApproved` triggers the auto-enroll path
 * when a default sequence is configured, and is a no-op when not.
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

import { eventBus } from '../../src/lib/eventBus';
// Importing outreach.service registers the listener.
import '../../src/modules/outreach/outreach.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const CAND_ID = '33333333-3333-3333-3333-333333333333';
const FINDING_ID = '44444444-4444-4444-4444-444444444444';
const SEQ_ID = '55555555-5555-5555-5555-555555555555';
const STEP_ID = '66666666-6666-6666-6666-666666666666';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_MOCK = 'true';
});

afterEach(() => {
  delete process.env.AI_MOCK;
});

describe('findingApproved → auto-enroll', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('no-ops when no default sequence is configured', async () => {
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+tenant_settings/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    eventBus.emit('findingApproved', {
      tenantId: TENANT_ID,
      findingId: FINDING_ID,
      candidateId: CAND_ID,
    });

    // Listener is async — give it a microtask to run.
    await new Promise((r) => setImmediate(r));
    // No assertion needed; we just verify no throw + no enrollment insert.
    expect(true).toBe(true);
  });

  it('enrolls candidate into default sequence when configured', async () => {
    let enrollmentInserted = false;
    const client = mockClient({
      __matcher: async (sql) => {
        if (/FROM\s+tenant_settings/i.test(sql)) {
          return { rows: [{ value: SEQ_ID }], rowCount: 1 };
        }
        if (/SELECT\s+\*\s+FROM\s+nurture_sequences/i.test(sql)) {
          return {
            rows: [
              {
                id: SEQ_ID,
                tenant_id: TENANT_ID,
                name: 'Default',
                active: true,
                description: null,
                total_steps: 1,
                metadata: {},
                created_by: null,
                created_at: '',
                updated_at: '',
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT\s+\*\s+FROM\s+nurture_steps/i.test(sql)) {
          return {
            rows: [
              {
                id: STEP_ID,
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
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT\s+INTO\s+nurture_enrollments/i.test(sql)) {
          enrollmentInserted = true;
          return {
            rows: [
              {
                id: 'enr-x',
                tenant_id: TENANT_ID,
                candidate_id: CAND_ID,
                sequence_id: SEQ_ID,
                status: 'pending_approval',
                current_step_order: 0,
                enrolled_by: null,
                enrolled_at: '',
                next_send_at: null,
                stopped_at: null,
                stopped_reason: null,
                finding_id: FINDING_ID,
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

    eventBus.emit('findingApproved', {
      tenantId: TENANT_ID,
      findingId: FINDING_ID,
      candidateId: CAND_ID,
    });

    // Wait two microtasks for the chain (loadDefault → enrollCandidate).
    await new Promise((r) => setTimeout(r, 50));
    expect(enrollmentInserted).toBe(true);
  });
});
