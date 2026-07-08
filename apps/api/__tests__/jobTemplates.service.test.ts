import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from './helpers/dbMock';

// Mock workflow + matching emitters before importing — instantiate uses createJob
vi.mock('../src/modules/workflows/workflowEmitter', () => ({
  emitWorkflowEvent: vi.fn(async () => undefined),
}));
vi.mock('../src/modules/matching/matchingEmitter', () => ({
  queueEmbedding: vi.fn(async () => undefined),
}));
vi.mock('../src/modules/pipeline/pipeline.service', () => ({
  resolvePipelineTemplateId: vi.fn(async () => '00000000-0000-0000-0000-000000000099'),
  instantiateTemplateStagesForJob: vi.fn(async () => undefined),
}));

import {
  listJobTemplates,
  createJobTemplate,
  deleteJobTemplate,
  getJobTemplate,
  instantiateFromTemplate,
} from '../src/modules/jobs/jobTemplates.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const TEMPLATE_ID = '55555555-5555-5555-5555-555555555555';

describe('jobTemplates.service', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

  it('listJobTemplates returns templates incl. system rows', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM job_templates/i.test(sql)) {
          return {
            rows: [
              {
                id: 't1',
                tenant_id: null,
                name: 'System',
                description: null,
                job_data: '{}',
                is_system: true,
                created_by: null,
                deleted_at: null,
                created_at: 'a',
                updated_at: 'a',
              },
              {
                id: 't2',
                tenant_id: TENANT_ID,
                name: 'Mine',
                description: null,
                job_data: '{}',
                is_system: false,
                created_by: USER_ID,
                deleted_at: null,
                created_at: 'a',
                updated_at: 'a',
              },
            ],
            rowCount: 2,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const list = await listJobTemplates(TENANT_ID);
    expect(list).toHaveLength(2);
    expect(list[0].is_system).toBe(true);
  });

  it('createJobTemplate rejects empty name', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      createJobTemplate(TENANT_ID, USER_ID, '', { title: 'X' })
    ).rejects.toMatchObject({ code: 'NAME_REQUIRED' });
  });

  it('createJobTemplate strips status field from job_data', async () => {
    let capturedPayload: unknown[] | undefined;
    client = mockClient({
      __matcher: (sql, params) => {
        if (/INSERT INTO job_templates/i.test(sql)) {
          capturedPayload = params;
          return {
            rows: [
              {
                id: TEMPLATE_ID,
                tenant_id: TENANT_ID,
                name: 'X',
                description: null,
                job_data: params[3],
                is_system: false,
                created_by: USER_ID,
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
    await createJobTemplate(TENANT_ID, USER_ID, 'X', {
      title: 'Eng',
      status: 'open', // should be stripped
      headcount: 2,
    });
    expect(capturedPayload).toBeDefined();
    const jobDataJson = capturedPayload![3] as string;
    const parsed = JSON.parse(jobDataJson);
    expect(parsed.title).toBe('Eng');
    expect(parsed.headcount).toBe(2);
    expect(parsed).not.toHaveProperty('status');
  });

  it('deleteJobTemplate refuses system template', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id, tenant_id, name, is_system FROM job_templates/i.test(sql)) {
          return {
            rows: [{ id: TEMPLATE_ID, tenant_id: null, name: 'Sys', is_system: true }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      deleteJobTemplate(TENANT_ID, USER_ID, TEMPLATE_ID)
    ).rejects.toMatchObject({ code: 'SYSTEM_TEMPLATE' });
  });

  it('getJobTemplate throws 404 when not found', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    await expect(getJobTemplate(TENANT_ID, TEMPLATE_ID)).rejects.toMatchObject({
      code: 'JOB_TEMPLATE_NOT_FOUND',
    });
  });

  it('instantiateFromTemplate merges overrides over template data', async () => {
    let lastInsertSql = '';
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM job_templates/i.test(sql)) {
          return {
            rows: [
              {
                id: TEMPLATE_ID,
                tenant_id: TENANT_ID,
                name: 'Backend Engineer',
                description: null,
                job_data: JSON.stringify({
                  title: 'Backend Engineer',
                  department: 'Engineering',
                  headcount: 1,
                }),
                is_system: false,
                created_by: USER_ID,
                deleted_at: null,
                created_at: 'a',
                updated_at: 'a',
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT INTO jobs/i.test(sql)) {
          lastInsertSql = sql;
          return {
            rows: [
              {
                id: 'job-new',
                title: 'Senior Backend Engineer',
                tenant_id: TENANT_ID,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    const job = await instantiateFromTemplate(TENANT_ID, USER_ID, TEMPLATE_ID, {
      title: 'Senior Backend Engineer',
    });
    expect((job as { id: string }).id).toBe('job-new');
    expect(lastInsertSql).toContain('INSERT INTO jobs');
  });

  it('instantiate met status=open zonder salarisband → 422 PAY_TRANSPARENCY_REQUIRED', async () => {
    let jobInsertSeen = false;
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM job_templates/i.test(sql)) {
          return {
            rows: [
              {
                id: TEMPLATE_ID,
                tenant_id: TENANT_ID,
                name: 'Backend Engineer',
                description: null,
                job_data: JSON.stringify({
                  title: 'Backend Engineer',
                  department: 'Engineering',
                }),
                is_system: false,
                created_by: USER_ID,
                deleted_at: null,
                created_at: 'a',
                updated_at: 'a',
              },
            ],
            rowCount: 1,
          };
        }
        if (/FROM tenant_pay_settings/i.test(sql)) {
          return {
            rows: [{ pay_transparency_enforced: true }],
            rowCount: 1,
          };
        }
        if (/INSERT INTO jobs/i.test(sql)) {
          jobInsertSeen = true;
          return { rows: [{ id: 'job-x' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      instantiateFromTemplate(TENANT_ID, USER_ID, TEMPLATE_ID, {
        status: 'open',
      })
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'PAY_TRANSPARENCY_REQUIRED',
    });

    // Gate zit vóór createJob — er mag géén job-INSERT gebeuren.
    expect(jobInsertSeen).toBe(false);
  });

  it('instantiate met status=open MET volledige band publiceert gewoon', async () => {
    let jobInsertSeen = false;
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM job_templates/i.test(sql)) {
          return {
            rows: [
              {
                id: TEMPLATE_ID,
                tenant_id: TENANT_ID,
                name: 'Backend Engineer',
                description: null,
                job_data: JSON.stringify({
                  title: 'Backend Engineer',
                  salary_min: 55000,
                  salary_max: 75000,
                  salary_frequency: 'annual',
                }),
                is_system: false,
                created_by: USER_ID,
                deleted_at: null,
                created_at: 'a',
                updated_at: 'a',
              },
            ],
            rowCount: 1,
          };
        }
        if (/FROM tenant_pay_settings/i.test(sql)) {
          return {
            rows: [{ pay_transparency_enforced: true }],
            rowCount: 1,
          };
        }
        if (/INSERT INTO jobs/i.test(sql)) {
          jobInsertSeen = true;
          return {
            rows: [{ id: 'job-live', tenant_id: TENANT_ID }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const job = await instantiateFromTemplate(TENANT_ID, USER_ID, TEMPLATE_ID, {
      status: 'open',
    });
    expect((job as { id: string }).id).toBe('job-live');
    expect(jobInsertSeen).toBe(true);
  });
});
