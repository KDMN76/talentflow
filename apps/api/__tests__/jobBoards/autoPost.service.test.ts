import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

// Replace the real enqueue path so we can observe distribution without Redis
// or the connector network calls.
const { enqueueSpy } = vi.hoisted(() => ({
  enqueueSpy: vi.fn(async (_t: string, _j: string, boardId: string) => ({
    id: `posting-${boardId}`,
  })),
}));
vi.mock('../../src/modules/job-boards/service', () => ({
  enqueuePosting: enqueueSpy,
}));

import {
  normalizeAutoPostSettings,
  getAutoPostSettings,
  updateAutoPostSettings,
  autoPostJobToBoards,
} from '../../src/modules/job-boards/autoPost.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const JOB = '44444444-4444-4444-4444-444444444444';
const USER = '33333333-3333-3333-3333-333333333333';

// Helper: install a pool mock whose `tenants.settings` returns the given
// auto-post config. Returns the teardown.
function withSettings(settings: unknown): { teardown: () => void } {
  const client = mockClient({
    __matcher: (sql: string) => {
      if (/SELECT settings FROM tenants/i.test(sql)) {
        return {
          rows: [{ settings: { job_board_auto_post: settings } }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  });
  return { teardown: installPoolMock(client) };
}

describe('normalizeAutoPostSettings', () => {
  it('defaults to disabled + empty for junk input', () => {
    expect(normalizeAutoPostSettings(undefined)).toEqual({
      enabled: false,
      boards: [],
    });
    expect(normalizeAutoPostSettings(null)).toEqual({ enabled: false, boards: [] });
    expect(normalizeAutoPostSettings('nope')).toEqual({ enabled: false, boards: [] });
  });

  it('only treats a literal true as enabled', () => {
    expect(normalizeAutoPostSettings({ enabled: 'yes' }).enabled).toBe(false);
    expect(normalizeAutoPostSettings({ enabled: 1 }).enabled).toBe(false);
    expect(normalizeAutoPostSettings({ enabled: true }).enabled).toBe(true);
  });

  it('keeps only registered boards and de-dupes', () => {
    const out = normalizeAutoPostSettings({
      enabled: true,
      boards: ['jobbird', 'indeed', 'jobbird', 'not-a-board', 42],
    });
    expect(out.boards).toEqual(['jobbird', 'indeed']);
  });
});

describe('getAutoPostSettings', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('reads + normalizes the tenants.settings JSONB', async () => {
    ({ teardown } = withSettings({ enabled: true, boards: ['jobbird', 'bogus'] }));
    const s = await getAutoPostSettings(TENANT);
    expect(s).toEqual({ enabled: true, boards: ['jobbird'] });
  });

  it('returns the disabled default when the key is absent', async () => {
    const client = mockClient({
      __matcher: (sql: string) =>
        /SELECT settings FROM tenants/i.test(sql)
          ? { rows: [{ settings: {} }], rowCount: 1 }
          : { rows: [], rowCount: 0 },
    });
    teardown = installPoolMock(client);
    expect(await getAutoPostSettings(TENANT)).toEqual({
      enabled: false,
      boards: [],
    });
  });
});

describe('updateAutoPostSettings', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('normalizes input before persisting and returns the stored shape', async () => {
    let writtenJson: string | null = null;
    const client = mockClient({
      __matcher: (sql: string, params: unknown[]) => {
        if (/UPDATE tenants/i.test(sql)) {
          writtenJson = params[1] as string;
          return {
            rows: [{ settings: { job_board_auto_post: JSON.parse(writtenJson) } }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const out = await updateAutoPostSettings(TENANT, {
      enabled: true,
      boards: ['indeed', 'garbage'],
    });
    expect(out).toEqual({ enabled: true, boards: ['indeed'] });
    // Persisted payload is the cleaned object, not the raw input.
    expect(JSON.parse(writtenJson!)).toEqual({ enabled: true, boards: ['indeed'] });
  });
});

describe('autoPostJobToBoards', () => {
  let teardown: () => void;

  beforeEach(() => {
    enqueueSpy.mockClear();
    enqueueSpy.mockImplementation(async (_t: string, _j: string, boardId: string) => ({
      id: `posting-${boardId}`,
    }));
  });
  afterEach(() => teardown?.());

  it('ON → enqueues once per configured board', async () => {
    ({ teardown } = withSettings({ enabled: true, boards: ['jobbird', 'indeed'] }));
    const result = await autoPostJobToBoards(TENANT, JOB, USER);

    expect(enqueueSpy).toHaveBeenCalledTimes(2);
    expect(enqueueSpy).toHaveBeenNthCalledWith(1, TENANT, JOB, 'jobbird', {
      userId: USER,
    });
    expect(enqueueSpy).toHaveBeenNthCalledWith(2, TENANT, JOB, 'indeed', {
      userId: USER,
    });
    expect(result.enqueued).toEqual(['jobbird', 'indeed']);
  });

  it('OFF → enqueues nothing', async () => {
    ({ teardown } = withSettings({ enabled: false, boards: ['jobbird'] }));
    const result = await autoPostJobToBoards(TENANT, JOB, USER);
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(result.enqueued).toEqual([]);
  });

  it('ON but no boards → no enqueue, no error', async () => {
    ({ teardown } = withSettings({ enabled: true, boards: [] }));
    const result = await autoPostJobToBoards(TENANT, JOB, USER);
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(result.enqueued).toEqual([]);
  });

  it('one board failing does not abort the others and never throws', async () => {
    ({ teardown } = withSettings({ enabled: true, boards: ['jobbird', 'indeed'] }));
    enqueueSpy.mockImplementation(async (_t: string, _j: string, boardId: string) => {
      if (boardId === 'jobbird') throw new Error('board down');
      return { id: `posting-${boardId}` };
    });

    const result = await autoPostJobToBoards(TENANT, JOB, USER);
    expect(enqueueSpy).toHaveBeenCalledTimes(2);
    expect(result.enqueued).toEqual(['indeed']);
  });
});
