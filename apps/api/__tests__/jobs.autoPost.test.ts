import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from './helpers/dbMock';

// Isolate the transition detection: the actual distribution is covered by
// jobBoards/autoPost.service.test.ts. Here we only assert that jobs.service
// fires (or doesn't fire) the auto-post hook on the right status transition.
vi.mock('../src/modules/job-boards/autoPost.service', () => ({
  autoPostJobToBoards: vi.fn(async () => ({ enqueued: [] })),
}));
vi.mock('../src/modules/workflows/workflowEmitter', () => ({
  emitWorkflowEvent: vi.fn(async () => undefined),
}));
vi.mock('../src/modules/matching/matchingEmitter', () => ({
  queueEmbedding: vi.fn(async () => undefined),
}));

import { createJob, updateJob } from '../src/modules/jobs/jobs.service';
import { autoPostJobToBoards } from '../src/modules/job-boards/autoPost.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const TEMPLATE_ID = '00000000-0000-0000-0000-000000000001';
const JOB_ID = 'job-1';

describe('updateJob — auto-post trigger', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  function install(existingStatus: string, nextStatus: string) {
    client = mockClient({
      __matcher: (sql: string) => {
        if (/SELECT \* FROM jobs WHERE id/i.test(sql)) {
          return {
            rows: [{ id: JOB_ID, tenant_id: TENANT_ID, status: existingStatus }],
            rowCount: 1,
          };
        }
        if (/^\s*UPDATE jobs SET/i.test(sql)) {
          return {
            rows: [{ id: JOB_ID, tenant_id: TENANT_ID, status: nextStatus }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
  }

  it('fires when status transitions draft → open', async () => {
    install('draft', 'open');
    await updateJob(TENANT_ID, JOB_ID, USER_ID, { status: 'open' });
    expect(autoPostJobToBoards).toHaveBeenCalledTimes(1);
    expect(autoPostJobToBoards).toHaveBeenCalledWith(TENANT_ID, JOB_ID, USER_ID);
  });

  it('does NOT fire when the job was already open', async () => {
    install('open', 'open');
    await updateJob(TENANT_ID, JOB_ID, USER_ID, { status: 'open', title: 'x' });
    expect(autoPostJobToBoards).not.toHaveBeenCalled();
  });

  it('does NOT fire for a non-open update', async () => {
    install('open', 'filled');
    await updateJob(TENANT_ID, JOB_ID, USER_ID, { status: 'filled' });
    expect(autoPostJobToBoards).not.toHaveBeenCalled();
  });
});

describe('createJob — auto-post trigger', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  function install(createdStatus: string) {
    client = mockClient({
      __matcher: (sql: string) => {
        if (/^\s*INSERT INTO jobs/i.test(sql)) {
          return {
            rows: [{ id: JOB_ID, tenant_id: TENANT_ID, status: createdStatus }],
            rowCount: 1,
          };
        }
        if (/SELECT id FROM pipeline_templates\s+WHERE is_default/i.test(sql)) {
          return { rows: [{ id: TEMPLATE_ID }], rowCount: 1 };
        }
        if (/SELECT COUNT\(\*\)::int AS n FROM pipeline_stages/i.test(sql)) {
          return { rows: [{ n: 0 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
  }

  it('fires when a job is created directly as open', async () => {
    install('open');
    await createJob(TENANT_ID, USER_ID, { title: 'Senior Engineer', status: 'open' });
    expect(autoPostJobToBoards).toHaveBeenCalledTimes(1);
    expect(autoPostJobToBoards).toHaveBeenCalledWith(TENANT_ID, JOB_ID, USER_ID);
  });

  it('does NOT fire for a draft creation', async () => {
    install('draft');
    await createJob(TENANT_ID, USER_ID, { title: 'Senior Engineer', status: 'draft' });
    expect(autoPostJobToBoards).not.toHaveBeenCalled();
  });
});
