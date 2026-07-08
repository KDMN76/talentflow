/**
 * jdGenerator.service tests — Sprint Q3.2.
 *
 * We mocken `lib/jdGenerator` (de Claude-call) en `jobs.service.createJob`
 * (de echte job-INSERT) zodat we het orkestratie-gedrag van de service
 * laag in isolatie testen: persistence, audit, state-transitions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from './helpers/dbMock';

vi.mock('../src/lib/jdGenerator', () => ({
  generateJd: vi.fn(),
  generateSingleJdVariant: vi.fn(),
}));

vi.mock('../src/modules/jobs/jobs.service', () => ({
  createJob: vi.fn(),
}));

vi.mock('../src/lib/aiEvents', () => ({
  logAIEvent: vi.fn(async () => undefined),
}));

vi.mock('../src/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/audit')>(
    '../src/lib/audit'
  );
  return {
    ...actual,
    logAudit: vi.fn(async () => undefined),
  };
});

import {
  createJdDraft,
  listJdDrafts,
  getJdDraft,
  selectVariant,
  regenerateVariant,
  publishJdDraft,
  discardJdDraft,
} from '../src/modules/jobs/jdGenerator.service';
import { generateJd, generateSingleJdVariant } from '../src/lib/jdGenerator';
import { createJob } from '../src/modules/jobs/jobs.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const DRAFT_ID = '33333333-3333-3333-3333-333333333333';
const JOB_ID = '44444444-4444-4444-4444-444444444444';
const VAR_ID_A = '55555555-5555-5555-5555-555555555555';
const VAR_ID_B = '66666666-6666-6666-6666-666666666666';

const sampleVariants = [
  {
    id: VAR_ID_A,
    title: 'Senior Frontend Developer',
    description: '## Over de rol\nJe bouwt features.',
    bias_flags: [],
    clarity_score: 85,
    inclusivity_score: 100,
    word_count: 50,
  },
  {
    id: VAR_ID_B,
    title: 'Senior Frontend Engineer',
    description: '## Het team\nWe zijn een team.',
    bias_flags: [],
    clarity_score: 78,
    inclusivity_score: 100,
    word_count: 45,
  },
];

function draftRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: DRAFT_ID,
    tenant_id: TENANT_ID,
    user_id: USER_ID,
    prompt: 'Senior Frontend Developer',
    parameters: { role: 'Senior Frontend Developer', level: 'senior' },
    variants: sampleVariants,
    selected_variant_id: null,
    status: 'draft',
    job_id: null,
    created_at: new Date('2026-05-01T10:00:00Z'),
    updated_at: new Date('2026-05-01T10:00:00Z'),
    ...overrides,
  };
}

describe('createJdDraft', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    teardown?.();
  });

  it('calls generateJd, INSERTs jd_drafts row, returns hydrated draft', async () => {
    vi.mocked(generateJd).mockResolvedValue({
      variants: sampleVariants,
      mocked: true,
      _meta: { latencyMs: 100, mocked: true, model: 'mock' },
    });

    client = mockClient({
      __matcher: (sql) => {
        if (/^INSERT INTO jd_drafts/i.test(sql.trim())) {
          return { rows: [draftRow()], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const draft = await createJdDraft(TENANT_ID, USER_ID, {
      role: 'Senior Frontend Developer',
      level: 'senior',
      generate_variants: 2,
    });

    expect(generateJd).toHaveBeenCalledOnce();
    expect(draft.id).toBe(DRAFT_ID);
    expect(draft.status).toBe('draft');
    expect(draft.variants).toHaveLength(2);
    expect(draft.variants[0].id).toBe(VAR_ID_A);
  });
});

describe('listJdDrafts', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('returns drafts filtered by status', async () => {
    client = mockClient({
      __matcher: (sql, params) => {
        if (/SELECT \* FROM jd_drafts/i.test(sql)) {
          // Verify status filter is wired through
          expect(params).toContain('draft');
          return {
            rows: [draftRow(), draftRow({ id: 'other' })],
            rowCount: 2,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const drafts = await listJdDrafts(TENANT_ID, { status: 'draft' });
    expect(drafts).toHaveLength(2);
  });
});

describe('getJdDraft', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('throws 404 when draft not found', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);

    await expect(getJdDraft(TENANT_ID, DRAFT_ID)).rejects.toMatchObject({
      code: 'JD_DRAFT_NOT_FOUND',
    });
  });

  it('returns draft when found', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM jd_drafts/i.test(sql)) {
          return { rows: [draftRow()], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const draft = await getJdDraft(TENANT_ID, DRAFT_ID);
    expect(draft.id).toBe(DRAFT_ID);
  });
});

describe('selectVariant', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('rejects when draft is not in draft status', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FOR UPDATE/i.test(sql)) {
          return { rows: [draftRow({ status: 'published' })], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      selectVariant(TENANT_ID, DRAFT_ID, VAR_ID_A, USER_ID)
    ).rejects.toMatchObject({ code: 'JD_DRAFT_NOT_EDITABLE' });
  });

  it('rejects unknown variant_id', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FOR UPDATE/i.test(sql)) {
          return { rows: [draftRow()], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      selectVariant(TENANT_ID, DRAFT_ID, 'nonexistent', USER_ID)
    ).rejects.toMatchObject({ code: 'JD_VARIANT_NOT_FOUND' });
  });

  it('updates selected_variant_id and returns new draft', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FOR UPDATE/i.test(sql)) {
          return { rows: [draftRow()], rowCount: 1 };
        }
        if (/^UPDATE jd_drafts/i.test(sql.trim())) {
          return {
            rows: [draftRow({ selected_variant_id: VAR_ID_A })],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const updated = await selectVariant(TENANT_ID, DRAFT_ID, VAR_ID_A, USER_ID);
    expect(updated.selected_variant_id).toBe(VAR_ID_A);
  });
});

describe('regenerateVariant', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('replaces target variant in array, calls AI once', async () => {
    const newVariant = {
      ...sampleVariants[0],
      id: 'new-id',
      title: 'New Title',
    };
    vi.mocked(generateSingleJdVariant).mockResolvedValue({
      variant: newVariant,
      mocked: true,
      _meta: { latencyMs: 80, mocked: true, model: 'mock' },
    });

    let updateParams: unknown[] = [];

    client = mockClient({
      __matcher: (sql, params) => {
        if (/SELECT \* FROM jd_drafts/i.test(sql) && !/FOR UPDATE/i.test(sql)) {
          // Initial getJdDraft call
          return { rows: [draftRow()], rowCount: 1 };
        }
        if (/FOR UPDATE/i.test(sql)) {
          return { rows: [draftRow()], rowCount: 1 };
        }
        if (/^UPDATE jd_drafts/i.test(sql.trim())) {
          updateParams = params;
          return {
            rows: [
              draftRow({
                variants: [newVariant, sampleVariants[1]],
                updated_at: new Date(),
              }),
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const updated = await regenerateVariant(
      TENANT_ID,
      DRAFT_ID,
      VAR_ID_A,
      USER_ID
    );

    expect(generateSingleJdVariant).toHaveBeenCalledOnce();
    expect(updated.variants[0].id).toBe('new-id');
    expect(updated.variants[1].id).toBe(VAR_ID_B);
    // First parameter to UPDATE is the variants JSON
    expect(updateParams[0]).toContain('new-id');
  });
});

describe('publishJdDraft', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('rejects when no variant selected', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM jd_drafts/i.test(sql)) {
          return { rows: [draftRow()], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      publishJdDraft(TENANT_ID, DRAFT_ID, USER_ID)
    ).rejects.toMatchObject({ code: 'JD_DRAFT_NO_SELECTION' });
  });

  it('rejects when already published', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM jd_drafts/i.test(sql)) {
          return {
            rows: [draftRow({ status: 'published', selected_variant_id: VAR_ID_A })],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      publishJdDraft(TENANT_ID, DRAFT_ID, USER_ID)
    ).rejects.toMatchObject({ code: 'JD_DRAFT_ALREADY_PUBLISHED' });
  });

  it('happy-path: creates job, updates draft to published', async () => {
    vi.mocked(createJob).mockResolvedValue({
      id: JOB_ID,
      title: 'Senior Frontend Developer',
    } as Awaited<ReturnType<typeof createJob>>);

    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM jd_drafts/i.test(sql)) {
          return {
            rows: [draftRow({ selected_variant_id: VAR_ID_A })],
            rowCount: 1,
          };
        }
        // Publiceer-gate (EU 2023/970): tenant dwingt af — de band in de
        // overrides hieronder maakt de publish compliant.
        if (/FROM tenant_pay_settings/i.test(sql)) {
          return {
            rows: [{ pay_transparency_enforced: true }],
            rowCount: 1,
          };
        }
        if (/^UPDATE jd_drafts/i.test(sql.trim())) {
          return {
            rows: [
              draftRow({
                selected_variant_id: VAR_ID_A,
                status: 'published',
                job_id: JOB_ID,
              }),
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await publishJdDraft(TENANT_ID, DRAFT_ID, USER_ID, {
      salary_min: 60000,
      salary_max: 80000,
    });

    expect(createJob).toHaveBeenCalledOnce();
    const [tenantArg, userArg, jobInput] = vi.mocked(createJob).mock.calls[0];
    expect(tenantArg).toBe(TENANT_ID);
    expect(userArg).toBe(USER_ID);
    expect((jobInput as { title: string }).title).toBe('Senior Frontend Developer');
    expect((jobInput as { salary_min: number }).salary_min).toBe(60000);
    expect((jobInput as { salary_max: number }).salary_max).toBe(80000);

    expect(result.draft.status).toBe('published');
    expect(result.draft.job_id).toBe(JOB_ID);
    expect((result.job as { id: string }).id).toBe(JOB_ID);
  });

  it('applies overrides on top of variant content', async () => {
    vi.mocked(createJob).mockResolvedValue({ id: JOB_ID } as Awaited<
      ReturnType<typeof createJob>
    >);

    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM jd_drafts/i.test(sql)) {
          return {
            rows: [draftRow({ selected_variant_id: VAR_ID_A })],
            rowCount: 1,
          };
        }
        if (/FROM tenant_pay_settings/i.test(sql)) {
          return {
            rows: [{ pay_transparency_enforced: true }],
            rowCount: 1,
          };
        }
        if (/^UPDATE jd_drafts/i.test(sql.trim())) {
          return {
            rows: [
              draftRow({
                selected_variant_id: VAR_ID_A,
                status: 'published',
                job_id: JOB_ID,
              }),
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await publishJdDraft(TENANT_ID, DRAFT_ID, USER_ID, {
      department: 'Engineering',
      location: 'Amsterdam',
      headcount: 2,
      salary_min: 55000,
      salary_max: 75000,
    });

    const [, , jobInput] = vi.mocked(createJob).mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(jobInput.department).toBe('Engineering');
    expect(jobInput.location).toBe('Amsterdam');
    expect(jobInput.headcount).toBe(2);
    // Description still comes from the variant
    expect((jobInput.description as string).length).toBeGreaterThan(0);
  });

  it('blokkeert publish naar status open zonder salarisband (EU 2023/970)', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM jd_drafts/i.test(sql)) {
          return {
            rows: [draftRow({ selected_variant_id: VAR_ID_A })],
            rowCount: 1,
          };
        }
        if (/FROM tenant_pay_settings/i.test(sql)) {
          return {
            rows: [{ pay_transparency_enforced: true }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      publishJdDraft(TENANT_ID, DRAFT_ID, USER_ID)
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'PAY_TRANSPARENCY_REQUIRED',
    });

    // Gate zit VÓÓR createJob — bij een blok mag er géén job ontstaan.
    expect(createJob).not.toHaveBeenCalled();
  });

  it('publiceert zonder band wanneer tenant afdwinging uit heeft staan', async () => {
    vi.mocked(createJob).mockResolvedValue({ id: JOB_ID } as Awaited<
      ReturnType<typeof createJob>
    >);

    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM jd_drafts/i.test(sql)) {
          return {
            rows: [draftRow({ selected_variant_id: VAR_ID_A })],
            rowCount: 1,
          };
        }
        if (/FROM tenant_pay_settings/i.test(sql)) {
          return {
            rows: [{ pay_transparency_enforced: false }],
            rowCount: 1,
          };
        }
        if (/^UPDATE jd_drafts/i.test(sql.trim())) {
          return {
            rows: [
              draftRow({
                selected_variant_id: VAR_ID_A,
                status: 'published',
                job_id: JOB_ID,
              }),
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await publishJdDraft(TENANT_ID, DRAFT_ID, USER_ID);

    expect(createJob).toHaveBeenCalledOnce();
    expect(result.draft.status).toBe('published');
  });

  it('als concept (status draft) publiceren vereist geen band', async () => {
    vi.mocked(createJob).mockResolvedValue({ id: JOB_ID } as Awaited<
      ReturnType<typeof createJob>
    >);

    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM jd_drafts/i.test(sql)) {
          return {
            rows: [draftRow({ selected_variant_id: VAR_ID_A })],
            rowCount: 1,
          };
        }
        // Bewust GEEN tenant_pay_settings-matcher: bij status 'draft' mag
        // de gate helemaal niet lezen — default-matcher zou enforced=true
        // opleveren (defaults) en dan alsnog doorlaten, maar het punt is
        // dat de flow zonder band slaagt.
        if (/^UPDATE jd_drafts/i.test(sql.trim())) {
          return {
            rows: [
              draftRow({
                selected_variant_id: VAR_ID_A,
                status: 'published',
                job_id: JOB_ID,
              }),
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await publishJdDraft(TENANT_ID, DRAFT_ID, USER_ID, {
      status: 'draft',
    });

    expect(createJob).toHaveBeenCalledOnce();
    const [, , jobInput] = vi.mocked(createJob).mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(jobInput.status).toBe('draft');
    expect(result.draft.status).toBe('published');
  });
});

describe('discardJdDraft', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('refuses to discard published drafts', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FOR UPDATE/i.test(sql)) {
          return { rows: [draftRow({ status: 'published' })], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      discardJdDraft(TENANT_ID, DRAFT_ID, USER_ID)
    ).rejects.toMatchObject({ code: 'JD_DRAFT_PUBLISHED' });
  });

  it('is idempotent for already-discarded drafts', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FOR UPDATE/i.test(sql)) {
          return { rows: [draftRow({ status: 'discarded' })], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      discardJdDraft(TENANT_ID, DRAFT_ID, USER_ID)
    ).resolves.toBeUndefined();
  });

  it('marks draft as discarded', async () => {
    let updateRan = false;
    client = mockClient({
      __matcher: (sql) => {
        if (/FOR UPDATE/i.test(sql)) {
          return { rows: [draftRow()], rowCount: 1 };
        }
        if (/^UPDATE jd_drafts/i.test(sql.trim())) {
          updateRan = true;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await discardJdDraft(TENANT_ID, DRAFT_ID, USER_ID);
    expect(updateRan).toBe(true);
  });
});
