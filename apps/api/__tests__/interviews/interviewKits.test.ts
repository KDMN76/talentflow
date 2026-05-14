/**
 * Interview kits service unit tests.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';
import {
  createInterviewKit,
  listInterviewKits,
  getInterviewKit,
  updateInterviewKit,
  deleteInterviewKit,
} from '../../src/modules/interviews/interviewKits.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const KIT_ID = '33333333-3333-3333-3333-333333333333';

describe('interview kits', () => {
  let teardown: () => void;
  let client: MockClient;

  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

  it('rejects empty name', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      createInterviewKit(TENANT, USER, {
        name: '',
        questions: [],
      })
    ).rejects.toMatchObject({ code: 'NAME_REQUIRED' });
  });

  it('rejects invalid question category', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      createInterviewKit(TENANT, USER, {
        name: 'Default',
        // @ts-expect-error testing runtime validation
        questions: [{ id: 'q1', text: 'X', category: 'invalid' }],
      })
    ).rejects.toMatchObject({ code: 'INVALID_QUESTION_CATEGORY' });
  });

  it('rejects out-of-range estimated_duration', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      createInterviewKit(TENANT, USER, {
        name: 'X',
        questions: [],
        estimated_duration_minutes: 1000,
      })
    ).rejects.toMatchObject({ code: 'INVALID_DURATION' });
  });

  it('inserts with default flag and resets other defaults', async () => {
    let resetCount = 0;
    let inserted = false;
    client = mockClient({
      __matcher: (sql) => {
        if (/^UPDATE interview_kits/i.test(sql) && /is_default = FALSE/i.test(sql)) {
          resetCount++;
          return { rows: [], rowCount: 0 };
        }
        if (/^INSERT INTO interview_kits/i.test(sql)) {
          inserted = true;
          return {
            rows: [
              {
                id: KIT_ID,
                tenant_id: TENANT,
                name: 'Default',
                description: null,
                job_id: null,
                questions: '[]',
                scorecard_template_id: null,
                estimated_duration_minutes: 60,
                is_default: true,
                deleted_at: null,
                created_at: 'a',
                updated_at: 'a',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const kit = await createInterviewKit(TENANT, USER, {
      name: 'Default',
      questions: [],
      is_default: true,
    });
    expect(kit.id).toBe(KIT_ID);
    expect(resetCount).toBe(1);
    expect(inserted).toBe(true);
  });

  it('listInterviewKits filters by job_id', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM interview_kits/i.test(sql)) {
          return {
            rows: [
              {
                id: KIT_ID,
                tenant_id: TENANT,
                name: 'A',
                description: null,
                job_id: null,
                questions: '[]',
                scorecard_template_id: null,
                estimated_duration_minutes: 60,
                is_default: false,
                deleted_at: null,
                created_at: 'a',
                updated_at: 'a',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const list = await listInterviewKits(TENANT, 'job-1');
    expect(list).toHaveLength(1);
  });

  it('getInterviewKit 404s when missing', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    await expect(getInterviewKit(TENANT, KIT_ID)).rejects.toMatchObject({
      code: 'INTERVIEW_KIT_NOT_FOUND',
    });
  });

  it('updateInterviewKit returns existing when patch is empty', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/^SELECT \* FROM interview_kits/i.test(sql)) {
          return {
            rows: [
              {
                id: KIT_ID,
                tenant_id: TENANT,
                name: 'A',
                description: null,
                job_id: null,
                questions: '[]',
                scorecard_template_id: null,
                estimated_duration_minutes: 60,
                is_default: false,
                deleted_at: null,
                created_at: 'a',
                updated_at: 'a',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const out = await updateInterviewKit(TENANT, KIT_ID, USER, {});
    expect(out.id).toBe(KIT_ID);
  });

  it('deleteInterviewKit soft-deletes', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/^UPDATE interview_kits/i.test(sql) && /deleted_at = now\(\)/i.test(sql)) {
          return { rows: [{ id: KIT_ID, name: 'A' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await deleteInterviewKit(TENANT, KIT_ID, USER);
  });

  it('deleteInterviewKit 404s when missing', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    await expect(deleteInterviewKit(TENANT, KIT_ID, USER)).rejects.toMatchObject({
      code: 'INTERVIEW_KIT_NOT_FOUND',
    });
  });
});
