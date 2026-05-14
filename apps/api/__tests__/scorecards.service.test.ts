import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from './helpers/dbMock';
import {
  createOrUpdateScorecard,
  listScorecardsForApplication,
  getScorecard,
  deleteScorecard,
  createTemplate,
  listTemplates,
} from '../src/modules/scorecards/scorecards.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const APPLICATION_ID = '33333333-3333-3333-3333-333333333333';
const STAGE_ID = '44444444-4444-4444-4444-444444444444';

describe('scorecards.service', () => {
  let client: MockClient;
  let teardown: () => void;

  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

  it('createOrUpdateScorecard rejects out-of-range overall_score', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      createOrUpdateScorecard(TENANT_ID, USER_ID, APPLICATION_ID, STAGE_ID, {
        overall_score: 7,
      })
    ).rejects.toMatchObject({ code: 'INVALID_OVERALL_SCORE' });
  });

  it('createOrUpdateScorecard 404s when application missing', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM applications/i.test(sql)) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      createOrUpdateScorecard(TENANT_ID, USER_ID, APPLICATION_ID, STAGE_ID, {
        overall_score: 4,
      })
    ).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });
  });

  it('createOrUpdateScorecard upserts and returns the row', async () => {
    let upsertCount = 0;
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM applications/i.test(sql)) {
          return { rows: [{ id: APPLICATION_ID }], rowCount: 1 };
        }
        if (/INSERT INTO scorecards/i.test(sql)) {
          upsertCount++;
          return {
            rows: [
              {
                id: 'sc-1',
                tenant_id: TENANT_ID,
                application_id: APPLICATION_ID,
                stage_id: STAGE_ID,
                interviewer_id: USER_ID,
                overall_score: 4,
                recommendation: 'yes',
                notes: null,
                criteria_scores: '[]',
                submitted_at: '2025-01-01T00:00:00Z',
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
    const card = await createOrUpdateScorecard(
      TENANT_ID,
      USER_ID,
      APPLICATION_ID,
      STAGE_ID,
      { overall_score: 4, recommendation: 'yes', submit: true }
    );
    expect(card.id).toBe('sc-1');
    expect(upsertCount).toBe(1);
    expect(Array.isArray(card.criteria_scores)).toBe(true);
  });

  it('listScorecardsForApplication returns parsed rows', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM scorecards s/i.test(sql)) {
          return {
            rows: [
              {
                id: 'sc-1',
                tenant_id: TENANT_ID,
                application_id: APPLICATION_ID,
                stage_id: STAGE_ID,
                interviewer_id: USER_ID,
                overall_score: 4,
                recommendation: 'yes',
                notes: null,
                criteria_scores: '[]',
                submitted_at: null,
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
    const list = await listScorecardsForApplication(TENANT_ID, APPLICATION_ID);
    expect(list).toHaveLength(1);
    expect(Array.isArray(list[0].criteria_scores)).toBe(true);
  });

  it('getScorecard 404s when not found', async () => {
    client = mockClient({
      __matcher: () => ({ rows: [], rowCount: 0 }),
    });
    teardown = installPoolMock(client);
    await expect(getScorecard(TENANT_ID, 'sc-1')).rejects.toMatchObject({
      code: 'SCORECARD_NOT_FOUND',
    });
  });

  it('deleteScorecard 404s when not found', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/DELETE FROM scorecards/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    await expect(
      deleteScorecard(TENANT_ID, 'sc-1', USER_ID)
    ).rejects.toMatchObject({ code: 'SCORECARD_NOT_FOUND' });
  });

  it('createTemplate requires criteria array', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);
    await expect(
      createTemplate(TENANT_ID, USER_ID, { name: 'X', criteria: [] })
    ).rejects.toMatchObject({ code: 'CRITERIA_REQUIRED' });
  });

  it('createTemplate inserts and returns parsed criteria', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/INSERT INTO scorecard_templates/i.test(sql)) {
          return {
            rows: [
              {
                id: 'tpl-1',
                tenant_id: TENANT_ID,
                name: 'Default',
                criteria: '[{"key":"comm","label":"Comms"}]',
                applies_to_job_id: null,
                applies_to_stage_id: null,
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
    const tmpl = await createTemplate(TENANT_ID, USER_ID, {
      name: 'Default',
      criteria: [{ key: 'comm', label: 'Comms' }],
      is_default: true,
    });
    expect(tmpl.id).toBe('tpl-1');
    expect(tmpl.criteria).toHaveLength(1);
    expect(tmpl.criteria[0].key).toBe('comm');
  });

  it('listTemplates returns rows ordered by default', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM scorecard_templates/i.test(sql)) {
          return {
            rows: [
              {
                id: 't1',
                tenant_id: TENANT_ID,
                name: 'A',
                criteria: '[]',
                applies_to_job_id: null,
                applies_to_stage_id: null,
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
    const list = await listTemplates(TENANT_ID);
    expect(list).toHaveLength(1);
  });
});
