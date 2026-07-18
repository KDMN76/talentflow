import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from './helpers/dbMock';

vi.mock('../src/modules/workflows/workflowEmitter', () => ({
  emitWorkflowEvent: vi.fn(async () => undefined),
}));
vi.mock('../src/modules/matching/matchingEmitter', () => ({
  queueEmbedding: vi.fn(async () => undefined),
}));

import {
  createJob,
  generateJobReference,
  updateJob,
  listJobs,
  getJob,
  deleteJob,
  duplicateJob,
  getJobStats,
} from '../src/modules/jobs/jobs.service';
import {
  applyPipelineTemplateToJob,
  getStagesForJob,
  createStage,
  updateStage,
  deleteStage,
  addToPipeline,
  updateApplication,
  removeApplication,
} from '../src/modules/pipeline/pipeline.service';
import {
  instantiateTemplateStagesForJob,
  resolvePipelineTemplateId,
} from '../src/modules/pipeline/pipeline.service';
import { emitWorkflowEvent } from '../src/modules/workflows/workflowEmitter';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const TEMPLATE_ID = '00000000-0000-0000-0000-000000000001';

describe('generateJobReference', () => {
  it('starts with JOB- and is 6 alphanumerics long', () => {
    const ref = generateJobReference();
    expect(ref).toMatch(/^JOB-[A-Z0-9]{6}$/);
  });

  it('avoids visually ambiguous chars (O, 0, I, 1)', () => {
    for (let i = 0; i < 200; i++) {
      const ref = generateJobReference();
      expect(ref.slice(4)).not.toMatch(/[O0I1]/);
    }
  });
});

describe('createJob', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    teardown?.();
  });

  it('inserts the job, resolves the pipeline template, clones stages, and emits job.created', async () => {
    let insertedJobRow: Record<string, unknown> = {};
    let stageInsertCount = 0;

    client = mockClient({
      __matcher: (sql) => {
        // Job insert
        if (/^INSERT INTO jobs/i.test(sql.trim())) {
          insertedJobRow = {
            id: 'job-1',
            tenant_id: TENANT_ID,
            title: 'Senior Engineer',
            status: 'draft',
            employment_type: 'fulltime',
          };
          return { rows: [insertedJobRow], rowCount: 1 };
        }
        // Resolve template (no explicit id supplied → falls back to system default)
        if (/SELECT id FROM pipeline_templates\s+WHERE is_default/i.test(sql)) {
          return { rows: [{ id: TEMPLATE_ID }], rowCount: 1 };
        }
        // Existing stages count for idempotency check
        if (/SELECT COUNT\(\*\)::int AS n FROM pipeline_stages/i.test(sql)) {
          return { rows: [{ n: 0 }], rowCount: 1 };
        }
        // Stage clone
        if (/INSERT INTO pipeline_stages/i.test(sql)) {
          stageInsertCount++;
          return { rows: [], rowCount: 4 };
        }
        // Activity log
        if (/INSERT INTO activities/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await createJob(TENANT_ID, USER_ID, {
      title: 'Senior Engineer',
      description: 'Build APIs',
    });

    expect(result.id).toBe('job-1');
    expect(stageInsertCount).toBe(1);

    expect(emitWorkflowEvent).toHaveBeenCalledWith(
      TENANT_ID,
      'job.created',
      'job-1',
      expect.objectContaining({ user_id: USER_ID })
    );
  });

  it('uses an explicit pipeline_template_id when supplied', async () => {
    let templateLookupSql = '';
    client = mockClient({
      __matcher: (sql) => {
        if (/^INSERT INTO jobs/i.test(sql.trim())) {
          return { rows: [{ id: 'job-2' }], rowCount: 1 };
        }
        if (/FROM pipeline_templates\s+WHERE id =/i.test(sql)) {
          templateLookupSql = sql;
          return { rows: [{ id: TEMPLATE_ID }], rowCount: 1 };
        }
        if (/SELECT COUNT\(\*\)::int AS n FROM pipeline_stages/i.test(sql)) {
          return { rows: [{ n: 0 }], rowCount: 1 };
        }
        if (/INSERT INTO pipeline_stages/i.test(sql)) {
          return { rows: [], rowCount: 5 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await createJob(TENANT_ID, USER_ID, {
      title: 'X',
      pipeline_template_id: TEMPLATE_ID,
    });

    expect(templateLookupSql).toMatch(/FROM pipeline_templates/);
  });

  it('does NOT include pipeline_template_id in the jobs INSERT', async () => {
    let insertSql = '';
    client = mockClient({
      __matcher: (sql) => {
        if (/^INSERT INTO jobs/i.test(sql.trim())) {
          insertSql = sql;
          return { rows: [{ id: 'job-3' }], rowCount: 1 };
        }
        if (/FROM pipeline_templates/i.test(sql)) {
          return { rows: [{ id: TEMPLATE_ID }], rowCount: 1 };
        }
        if (/SELECT COUNT\(\*\)::int AS n FROM pipeline_stages/i.test(sql)) {
          return { rows: [{ n: 0 }], rowCount: 1 };
        }
        if (/INSERT INTO pipeline_stages/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await createJob(TENANT_ID, USER_ID, {
      title: 'Z',
      pipeline_template_id: TEMPLATE_ID,
    });

    expect(insertSql).not.toMatch(/pipeline_template_id/);
  });

  it('throws 500 NO_PIPELINE_TEMPLATE when nothing is resolvable', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/^INSERT INTO jobs/i.test(sql.trim())) {
          return { rows: [{ id: 'job-x' }], rowCount: 1 };
        }
        // No default, no fallback
        if (/FROM pipeline_templates/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      createJob(TENANT_ID, USER_ID, { title: 'X' })
    ).rejects.toMatchObject({ code: 'NO_PIPELINE_TEMPLATE' });
  });
});

describe('updateJob', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    teardown?.();
  });

  it('updates only the supplied fields', async () => {
    let updateSql = '';
    let updateValues: unknown[] = [];

    client = mockClient({
      __matcher: (sql, params) => {
        if (/SELECT \* FROM jobs WHERE id/i.test(sql)) {
          return {
            rows: [{ id: 'job-1', status: 'draft', title: 'Old' }],
            rowCount: 1,
          };
        }
        if (/^UPDATE jobs/i.test(sql.trim())) {
          updateSql = sql;
          updateValues = params;
          return {
            rows: [{ id: 'job-1', title: 'Updated', status: 'draft' }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await updateJob(TENANT_ID, 'job-1', USER_ID, {
      title: 'Updated',
    });

    expect(result.id).toBe('job-1');
    expect(updateSql).toMatch(/SET\s+title = \$1/);
    expect(updateSql).toMatch(/updated_at = now\(\)/);
    expect(updateValues).toEqual(['Updated', 'job-1', TENANT_ID]);
  });

  it('emits job.filled when status transitions to filled', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM jobs WHERE id/i.test(sql)) {
          return {
            rows: [{ id: 'job-1', status: 'open', title: 'Eng' }],
            rowCount: 1,
          };
        }
        if (/^UPDATE jobs/i.test(sql.trim())) {
          return {
            rows: [{ id: 'job-1', status: 'filled' }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await updateJob(TENANT_ID, 'job-1', USER_ID, { status: 'filled' });
    expect(emitWorkflowEvent).toHaveBeenCalledWith(
      TENANT_ID,
      'job.filled',
      'job-1',
      expect.any(Object)
    );
  });

  it('throws 404 when the job does not exist', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(
      updateJob(TENANT_ID, 'missing', USER_ID, { title: 'x' })
    ).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// pipeline.service — instantiateTemplateStagesForJob + resolvePipelineTemplateId
// (these are called inside createJob; we test them directly for branch coverage)
// ──────────────────────────────────────────────────────────────────────────────

describe('instantiateTemplateStagesForJob', () => {
  it('clones stages atomically via INSERT...SELECT when no stages exist', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const fakeClient = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (/SELECT COUNT\(\*\)::int AS n FROM pipeline_stages/i.test(sql)) {
          return { rows: [{ n: 0 }], rowCount: 1 };
        }
        if (/INSERT INTO pipeline_stages/i.test(sql)) {
          return { rows: [], rowCount: 5 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const count = await instantiateTemplateStagesForJob(
      fakeClient as any,
      TENANT_ID,
      'job-1',
      TEMPLATE_ID
    );
    expect(count).toBe(5);
    // Single INSERT — atomicity guarantee.
    const inserts = calls.filter((c) =>
      /INSERT INTO pipeline_stages/i.test(c.sql)
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toMatch(/INSERT INTO pipeline_stages[\s\S]+SELECT/i);
  });

  it('is idempotent — returns existing count without re-inserting', async () => {
    const fakeClient = {
      query: vi.fn(async (sql: string) => {
        if (/SELECT COUNT\(\*\)::int AS n FROM pipeline_stages/i.test(sql)) {
          return { rows: [{ n: 4 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const count = await instantiateTemplateStagesForJob(
      fakeClient as any,
      TENANT_ID,
      'job-1',
      TEMPLATE_ID
    );
    expect(count).toBe(4);
    // No INSERT was issued.
    const inserts = fakeClient.query.mock.calls.filter((c) =>
      /INSERT/i.test(String(c[0]))
    );
    expect(inserts).toHaveLength(0);
  });
});

describe('resolvePipelineTemplateId', () => {
  it('validates and returns an explicit id when accessible', async () => {
    const fakeClient = {
      query: vi.fn(async () => ({
        rows: [{ id: TEMPLATE_ID }],
        rowCount: 1,
      })),
      release: vi.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const id = await resolvePipelineTemplateId(
      fakeClient as any,
      TENANT_ID,
      TEMPLATE_ID
    );
    expect(id).toBe(TEMPLATE_ID);
  });

  it('throws 400 when an explicit id is not visible to the tenant', async () => {
    const fakeClient = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolvePipelineTemplateId(fakeClient as any, TENANT_ID, 'unknown')
    ).rejects.toMatchObject({ code: 'INVALID_PIPELINE_TEMPLATE' });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// listJobs / getJob / deleteJob / duplicateJob / getJobStats
// ──────────────────────────────────────────────────────────────────────────────

describe('listJobs', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
  });

  it('returns paginated jobs and applies filters', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT COUNT\(\*\) as total FROM jobs/i.test(sql)) {
          return { rows: [{ total: '10' }], rowCount: 1 };
        }
        if (/SELECT j\.id, j\.title/i.test(sql)) {
          return {
            rows: [{ id: 'j1', title: 'Engineer', application_count: '3' }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await listJobs(TENANT_ID, {
      page: 1,
      limit: 10,
      status: 'open',
      recruiterId: USER_ID,
    });
    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(10);
    expect(result.meta.pages).toBe(1);
  });
});

describe('getJob / deleteJob', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
  });

  it('getJob returns the job with hydrated stages', async () => {
    client = mockClient({
      __matcher: (sql) => {
        // Kolom-agnostisch: match op de WHERE-clause die uniek is voor getJob
        // (i.p.v. de exacte SELECT-kolommen, die nu expliciet zijn i.p.v. j.*).
        if (/WHERE j\.id = \$1 AND j\.tenant_id = \$2 AND j\.deleted_at IS NULL/i.test(sql)) {
          return { rows: [{ id: 'j1', title: 'Eng' }], rowCount: 1 };
        }
        if (/FROM pipeline_stages ps/i.test(sql)) {
          return {
            rows: [{ id: 'stage-1', name: 'Sourced', position: 1 }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const job = await getJob(TENANT_ID, 'j1');
    expect(job.id).toBe('j1');
    expect(job.stages).toHaveLength(1);
  });

  it('getJob throws 404 when missing', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(getJob(TENANT_ID, 'missing')).rejects.toMatchObject({
      code: 'JOB_NOT_FOUND',
    });
  });

  it('deleteJob soft-deletes and logs the action', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM jobs WHERE id/i.test(sql)) {
          return { rows: [{ id: 'j1', title: 'Eng' }], rowCount: 1 };
        }
        if (/^UPDATE jobs SET deleted_at/i.test(sql.trim())) {
          return { rows: [{ id: 'j1' }], rowCount: 1 };
        }
        if (/INSERT INTO activities/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(deleteJob(TENANT_ID, 'j1', USER_ID)).resolves.toBeUndefined();
  });

  it('deleteJob throws 404 when nothing matched', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(
      deleteJob(TENANT_ID, 'missing', USER_ID)
    ).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });
  });
});

describe('duplicateJob', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
  });

  it('clones the source job, generates a new reference, and copies stages', async () => {
    let pipelineInserts = 0;
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM jobs WHERE id/i.test(sql)) {
          return {
            rows: [
              {
                id: 'src',
                title: 'Senior Engineer',
                status: 'open',
                description: 'desc',
                employment_type: 'fulltime',
              },
            ],
            rowCount: 1,
          };
        }
        if (/^INSERT INTO jobs/i.test(sql.trim())) {
          return { rows: [{ id: 'copy', title: 'Senior Engineer (kopie)' }], rowCount: 1 };
        }
        if (/SELECT name, position, color FROM pipeline_stages/i.test(sql)) {
          return {
            rows: [
              { name: 'Sourced', position: 1, color: '#fff' },
              { name: 'Hired', position: 2, color: '#000' },
            ],
            rowCount: 2,
          };
        }
        if (/INSERT INTO pipeline_stages/i.test(sql)) {
          pipelineInserts++;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const copy = await duplicateJob(TENANT_ID, 'src', USER_ID);
    expect(copy.id).toBe('copy');
    expect(pipelineInserts).toBe(2);
  });

  it('throws 404 when the source is missing', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(
      duplicateJob(TENANT_ID, 'missing', USER_ID)
    ).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });
  });
});

describe('getJobStats', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
  });

  it('aggregates per-stage, per-status and timeframe counts', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM jobs WHERE id/i.test(sql)) {
          return { rows: [{ id: 'j1' }], rowCount: 1 };
        }
        if (/FROM pipeline_stages ps/i.test(sql)) {
          return {
            rows: [{ stage_id: 's1', stage_name: 'Sourced', count: '3' }],
            rowCount: 1,
          };
        }
        if (/SELECT status, COUNT\(\*\) as count\s+FROM applications/i.test(sql)) {
          return {
            rows: [{ status: 'active', count: '5' }],
            rowCount: 1,
          };
        }
        if (/total_applications/i.test(sql)) {
          return {
            rows: [
              {
                total_applications: '10',
                this_week: '2',
                this_month: '4',
                hired_count: '1',
                rejected_count: '1',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const stats = await getJobStats(TENANT_ID, 'j1');
    expect(stats.byStage).toHaveLength(1);
    expect(stats.byStatus).toHaveLength(1);
    expect(stats.total_applications).toBe('10');
  });

  it('throws 404 when the job is missing', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(getJobStats(TENANT_ID, 'missing')).rejects.toMatchObject({
      code: 'JOB_NOT_FOUND',
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// pipeline.service — broader coverage for stages + applications
// ──────────────────────────────────────────────────────────────────────────────

describe('pipeline.service — stages CRUD + applications', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
  });

  it('applyPipelineTemplateToJob resolves and instantiates stages', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM jobs WHERE id/i.test(sql)) {
          return { rows: [{ id: 'j1' }], rowCount: 1 };
        }
        if (/FROM pipeline_templates\s+WHERE id =/i.test(sql)) {
          return { rows: [{ id: TEMPLATE_ID }], rowCount: 1 };
        }
        if (/SELECT COUNT\(\*\)::int AS n FROM pipeline_stages/i.test(sql)) {
          return { rows: [{ n: 0 }], rowCount: 1 };
        }
        if (/INSERT INTO pipeline_stages/i.test(sql)) {
          return { rows: [], rowCount: 4 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await applyPipelineTemplateToJob(
      TENANT_ID,
      'j1',
      TEMPLATE_ID
    );
    expect(result.template_id).toBe(TEMPLATE_ID);
    expect(result.stage_count).toBe(4);
  });

  it('getStagesForJob returns stages for an existing job', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM jobs WHERE id/i.test(sql)) {
          return { rows: [{ id: 'j1' }], rowCount: 1 };
        }
        if (/FROM pipeline_stages ps/i.test(sql)) {
          return {
            rows: [{ id: 's1', name: 'Sourced', position: 1 }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const stages = await getStagesForJob(TENANT_ID, 'j1');
    expect(stages).toHaveLength(1);
  });

  it('createStage auto-positions when no position is supplied', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id FROM jobs WHERE id/i.test(sql)) {
          return { rows: [{ id: 'j1' }], rowCount: 1 };
        }
        if (/COALESCE\(MAX\(position\), 0\)/i.test(sql)) {
          return { rows: [{ next_pos: 5 }], rowCount: 1 };
        }
        if (/INSERT INTO pipeline_stages/i.test(sql)) {
          return { rows: [{ id: 'new-stage', name: 'X', position: 5 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const stage = await createStage(TENANT_ID, 'j1', { name: 'X' });
    expect(stage.position).toBe(5);
  });

  it('updateStage fails with NO_FIELDS when empty input', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM pipeline_stages/i.test(sql)) {
          return { rows: [{ id: 's1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      updateStage(TENANT_ID, 's1', {})
    ).rejects.toMatchObject({ code: 'NO_FIELDS' });
  });

  it('updateStage updates supplied fields', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM pipeline_stages/i.test(sql)) {
          return { rows: [{ id: 's1' }], rowCount: 1 };
        }
        if (/^UPDATE pipeline_stages/i.test(sql.trim())) {
          return { rows: [{ id: 's1', name: 'Renamed' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const stage = await updateStage(TENANT_ID, 's1', { name: 'Renamed' });
    expect(stage.name).toBe('Renamed');
  });

  it('deleteStage moves applications to the previous stage and deletes', async () => {
    let applicationsMoved = false;
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM pipeline_stages WHERE id/i.test(sql)) {
          return {
            rows: [{ id: 's2', job_id: 'j1', position: 2 }],
            rowCount: 1,
          };
        }
        if (/FROM pipeline_stages\s+WHERE job_id/i.test(sql)) {
          return { rows: [{ id: 's1' }], rowCount: 1 };
        }
        if (/^UPDATE applications SET stage_id/i.test(sql.trim())) {
          applicationsMoved = true;
          return { rows: [], rowCount: 0 };
        }
        if (/DELETE FROM pipeline_stages/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await deleteStage(TENANT_ID, 's2');
    expect(applicationsMoved).toBe(true);
  });

  it('deleteStage only reassigns active applications to the previous stage; terminal-status applications are cleared, not moved', async () => {
    let activeMoveSql = '';
    let terminalClearSql = '';
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM pipeline_stages WHERE id/i.test(sql)) {
          return {
            rows: [{ id: 's2', job_id: 'j1', name: 'Interview', position: 2 }],
            rowCount: 1,
          };
        }
        if (/FROM pipeline_stages\s+WHERE job_id/i.test(sql)) {
          return { rows: [{ id: 's1' }], rowCount: 1 };
        }
        if (/UPDATE applications SET stage_id = \$1.*status = 'active'/is.test(sql)) {
          activeMoveSql = sql;
          return { rows: [], rowCount: 1 };
        }
        if (/UPDATE applications SET stage_id = NULL.*status <> 'active'/is.test(sql)) {
          terminalClearSql = sql;
          return { rows: [], rowCount: 1 };
        }
        if (/DELETE FROM pipeline_stages/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await deleteStage(TENANT_ID, 's2', USER_ID);

    // Active applications get moved to the previous stage.
    expect(activeMoveSql).toMatch(/status = 'active'/);
    // Terminal-status applications (hired/rejected/withdrawn) are explicitly
    // nulled out instead of silently rewritten to a stage they were never in.
    expect(terminalClearSql).toMatch(/stage_id = NULL/);
    expect(terminalClearSql).toMatch(/status <> 'active'/);
  });

  it('addToPipeline creates an application in the first stage by default', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM jobs WHERE id/i.test(sql)) {
          return { rows: [{ id: 'j1' }], rowCount: 1 };
        }
        if (/FROM candidates WHERE id/i.test(sql)) {
          return { rows: [{ id: 'c1' }], rowCount: 1 };
        }
        if (/FROM pipeline_stages WHERE job_id/i.test(sql)) {
          return { rows: [{ id: 's1' }], rowCount: 1 };
        }
        if (/INSERT INTO applications/i.test(sql)) {
          return {
            rows: [
              { id: 'a1', job_id: 'j1', candidate_id: 'c1', stage_id: 's1' },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const app = await addToPipeline(TENANT_ID, USER_ID, {
      job_id: 'j1',
      candidate_id: 'c1',
    });
    expect(app.id).toBe('a1');
  });

  it('addToPipeline maps duplicate (no row returned by ON CONFLICT) to 409', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM jobs WHERE id/i.test(sql)) {
          return { rows: [{ id: 'j1' }], rowCount: 1 };
        }
        if (/FROM candidates WHERE id/i.test(sql)) {
          return { rows: [{ id: 'c1' }], rowCount: 1 };
        }
        if (/FROM pipeline_stages WHERE job_id/i.test(sql)) {
          return { rows: [{ id: 's1' }], rowCount: 1 };
        }
        if (/INSERT INTO applications/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      addToPipeline(TENANT_ID, USER_ID, { job_id: 'j1', candidate_id: 'c1' })
    ).rejects.toMatchObject({ code: 'ALREADY_APPLIED' });
  });

  it('updateApplication moves to a new stage and emits a stage_changed workflow event', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM applications WHERE id/i.test(sql)) {
          return {
            rows: [
              {
                id: 'a1',
                stage_id: 's1',
                status: 'active',
                candidate_id: 'c1',
                job_id: 'j1',
              },
            ],
            rowCount: 1,
          };
        }
        if (/FROM pipeline_stages ps[\s\S]+JOIN applications/i.test(sql)) {
          return { rows: [{ id: 's2' }], rowCount: 1 };
        }
        if (/^UPDATE applications/i.test(sql.trim())) {
          return {
            rows: [{ id: 'a1', stage_id: 's2', status: 'active' }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const app = await updateApplication(TENANT_ID, 'a1', USER_ID, {
      stage_id: 's2',
    });
    expect(app.stage_id).toBe('s2');
  });

  it('removeApplication deletes the row and logs', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/DELETE FROM applications/i.test(sql)) {
          return { rows: [{ id: 'a1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      removeApplication(TENANT_ID, 'a1', USER_ID)
    ).resolves.toBeUndefined();
  });

  it('removeApplication throws 404 when missing', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(
      removeApplication(TENANT_ID, 'missing', USER_ID)
    ).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });
  });
});
