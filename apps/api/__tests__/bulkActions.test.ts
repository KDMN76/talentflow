/**
 * Bulk-actions tests — Sprint Q1.2.
 *
 * We testen twee lagen:
 *   1. Service: candidatesService.bulkAction (Agent Y geleverd) — happy path
 *      per action-type + RLS-isolatie + max-batch.
 *   2. Controller: bulkActionsHandler (Agent AA) — zod-validatie en
 *      service-delegate.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from './helpers/dbMock';

vi.mock('../src/modules/workflows/workflowEmitter', () => ({
  emitWorkflowEvent: vi.fn(async () => undefined),
}));
vi.mock('../src/modules/matching/matchingEmitter', () => ({
  queueEmbedding: vi.fn(async () => undefined),
}));

import { bulkAction } from '../src/modules/candidates/candidates.service';
import { bulkActionsHandler } from '../src/modules/candidates/candidates.controller';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID_1 = '33333333-3333-3333-3333-333333333333';
const CAND_ID_2 = '44444444-4444-4444-4444-444444444444';
const STAGE_ID = '55555555-5555-5555-5555-555555555555';
const JOB_ID = '66666666-6666-6666-6666-666666666666';

// ──────────────────────────────────────────────────────────────────────────────
// Service-laag (Agent Y)
// ──────────────────────────────────────────────────────────────────────────────

describe('candidatesService.bulkAction — service layer', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    teardown?.();
  });

  it('archive: UPDATE met deleted_at = now() over alle ids', async () => {
    let updateSql = '';
    let updateParams: unknown[] = [];
    client = mockClient({
      __matcher: (sql, params) => {
        if (/UPDATE candidates SET deleted_at/i.test(sql)) {
          updateSql = sql;
          updateParams = params;
          return { rows: [], rowCount: 2 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await bulkAction(
      TENANT_ID,
      USER_ID,
      [CAND_ID_1, CAND_ID_2],
      'archive',
      {}
    );

    expect(result.affected).toBe(2);
    // Tenant-id moet als guard in de WHERE staan — RLS-isolatie.
    expect(updateSql).toMatch(/tenant_id\s*=\s*\$/);
    // ids worden als ANY($1::uuid[]) doorgegeven.
    expect(updateParams[0]).toEqual([CAND_ID_1, CAND_ID_2]);
    expect(updateParams[1]).toBe(TENANT_ID);
  });

  it('add_tag: tag wordt toegevoegd via array_agg(DISTINCT)', async () => {
    let updateSql = '';
    client = mockClient({
      __matcher: (sql) => {
        if (/UPDATE candidates/i.test(sql) && /tags/.test(sql)) {
          updateSql = sql;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await bulkAction(TENANT_ID, USER_ID, [CAND_ID_1], 'add_tag', {
      tag: 'topkandidaat',
    });

    expect(result.affected).toBe(1);
    expect(updateSql).toMatch(/array_agg\(DISTINCT/);
  });

  it('add_tag: ontbrekende tag in payload → 400 MISSING_TAG', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      bulkAction(TENANT_ID, USER_ID, [CAND_ID_1], 'add_tag', {})
    ).rejects.toMatchObject({ statusCode: 400, code: 'MISSING_TAG' });
  });

  it('remove_tag: gebruikt array_remove', async () => {
    let updateSql = '';
    client = mockClient({
      __matcher: (sql) => {
        if (/UPDATE candidates/i.test(sql) && /array_remove/.test(sql)) {
          updateSql = sql;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await bulkAction(
      TENANT_ID,
      USER_ID,
      [CAND_ID_1],
      'remove_tag',
      { tag: 'cold' }
    );
    expect(result.affected).toBe(1);
    expect(updateSql).toMatch(/array_remove/);
  });

  it('change_source: zet source-veld op alle ids', async () => {
    let updateParams: unknown[] = [];
    client = mockClient({
      __matcher: (sql, params) => {
        if (/UPDATE candidates SET source/i.test(sql)) {
          updateParams = params;
          return { rows: [], rowCount: 2 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await bulkAction(
      TENANT_ID,
      USER_ID,
      [CAND_ID_1, CAND_ID_2],
      'change_source',
      { source: 'job-board-imported' }
    );
    expect(result.affected).toBe(2);
    expect(updateParams[0]).toBe('job-board-imported');
  });

  it('lege ids → 400 NO_IDS', async () => {
    await expect(
      bulkAction(TENANT_ID, USER_ID, [], 'archive', {})
    ).rejects.toMatchObject({ statusCode: 400, code: 'NO_IDS' });
  });

  it('te veel ids (>1000) → 400 TOO_MANY_IDS', async () => {
    const ids = Array.from({ length: 1001 }, (_v, i) =>
      `00000000-0000-0000-0000-${(i + 1).toString().padStart(12, '0')}`
    );
    await expect(
      bulkAction(TENANT_ID, USER_ID, ids, 'archive', {})
    ).rejects.toMatchObject({ statusCode: 400, code: 'TOO_MANY_IDS' });
  });

  it('onbekende action → 400 INVALID_ACTION', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      bulkAction(
        TENANT_ID,
        USER_ID,
        [CAND_ID_1],
        // Cast om de strict-typing te omzeilen — runtime moet het afvangen.
        'delete_forever' as never,
        {}
      )
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_ACTION' });
  });

  it('move_to_stage: zonder payload.stage_id → 400 MISSING_STAGE', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      bulkAction(TENANT_ID, USER_ID, [CAND_ID_1], 'move_to_stage', {})
    ).rejects.toMatchObject({ statusCode: 400, code: 'MISSING_STAGE' });
  });

  it('move_to_stage: onbekende stage_id → 400 INVALID_STAGE', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM pipeline_stages/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      bulkAction(TENANT_ID, USER_ID, [CAND_ID_1], 'move_to_stage', {
        stage_id: STAGE_ID,
      })
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_STAGE' });
  });

  it('move_to_stage: verplaatst actieve applications van de geselecteerde kandidaten naar de fase', async () => {
    let updateSql = '';
    let updateParams: unknown[] = [];
    client = mockClient({
      __matcher: (sql, params) => {
        if (/FROM pipeline_stages/i.test(sql)) {
          return { rows: [{ id: STAGE_ID, job_id: JOB_ID }], rowCount: 1 };
        }
        if (/UPDATE applications SET stage_id/i.test(sql)) {
          updateSql = sql;
          updateParams = params;
          return { rows: [], rowCount: 2 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await bulkAction(
      TENANT_ID,
      USER_ID,
      [CAND_ID_1, CAND_ID_2],
      'move_to_stage',
      { stage_id: STAGE_ID }
    );

    expect(result.affected).toBe(2);
    // Alleen actieve applications binnen dezelfde job als de fase.
    expect(updateSql).toMatch(/status = 'active'/);
    expect(updateSql).toMatch(/job_id = \$/);
    expect(updateParams[0]).toBe(STAGE_ID);
    expect(updateParams[1]).toEqual([CAND_ID_1, CAND_ID_2]);
    expect(updateParams[3]).toBe(JOB_ID);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Controller-laag (Agent AA)
// ──────────────────────────────────────────────────────────────────────────────

function makeReqRes(body: unknown) {
  const req = {
    body,
    user: { tenantId: TENANT_ID, userId: USER_ID, email: 'r@t.nl', role: 'admin' },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    get: () => undefined,
  } as unknown as import('express').Request;

  const res = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as import('express').Response;

  const next = vi.fn();
  return { req, res, next };
}

describe('bulkActionsHandler — controller layer', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    teardown?.();
  });

  it('valideert via zod en delegate naar service voor archive', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/UPDATE candidates SET deleted_at/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const { req, res, next } = makeReqRes({
      action: 'archive',
      ids: [CAND_ID_1],
    });
    await bulkActionsHandler(req, res, next as never);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ affected: 1 });
  });

  it('zod faalt bij invalid uuid', async () => {
    const { req, res, next } = makeReqRes({
      action: 'archive',
      ids: ['not-a-uuid'],
    });
    await bulkActionsHandler(req, res, next as never);
    expect(next).toHaveBeenCalled();
    // ZodError instance.
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.name).toBe('ZodError');
  });

  it('zod faalt bij batch >500', async () => {
    const ids = Array.from({ length: 501 }, (_v, i) =>
      `00000000-0000-0000-0000-${(i + 1).toString().padStart(12, '0')}`
    );
    const { req, res, next } = makeReqRes({ action: 'archive', ids });
    await bulkActionsHandler(req, res, next as never);
    expect(next).toHaveBeenCalled();
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err.name).toBe('ZodError');
  });

  it('add_tag zonder payload.tag → zod-fout', async () => {
    const { req, res, next } = makeReqRes({
      action: 'add_tag',
      ids: [CAND_ID_1],
      payload: {},
    });
    await bulkActionsHandler(req, res, next as never);
    expect(next).toHaveBeenCalled();
  });

  it('add_tag met geldige payload → service ontvangt payload', async () => {
    let receivedTag: string | undefined;
    client = mockClient({
      __matcher: (sql, params) => {
        if (/UPDATE candidates/i.test(sql) && /array_agg/i.test(sql)) {
          receivedTag = params[0] as string;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const { req, res, next } = makeReqRes({
      action: 'add_tag',
      ids: [CAND_ID_1],
      payload: { tag: 'hot' },
    });
    await bulkActionsHandler(req, res, next as never);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ affected: 1 });
    expect(receivedTag).toBe('hot');
  });
});
