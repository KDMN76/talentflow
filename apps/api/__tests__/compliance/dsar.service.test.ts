/**
 * DSAR service tests — Sprint Q2.3.
 *
 * Mockt de DB-pool via `installPoolMock`. Test:
 *   - createDsarRequest: due_at = +30 dagen + audit-event
 *   - getDsarRequest: 404 bij onbekend
 *   - listDsarRequests: filters
 *   - fulfillDsarRequest: status-transition + audit
 *   - fulfillDsarRequest 'deletion' triggert anonymizeCandidatePermanently
 *   - input-validatie email
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

vi.mock('../../src/modules/compliance/anonymization.service', () => ({
  anonymizeCandidatePermanently: vi.fn(async () => undefined),
}));

import {
  createDsarRequest,
  listDsarRequests,
  fulfillDsarRequest,
  getDsarRequest,
  _internal,
} from '../../src/modules/compliance/dsar.service';
import { anonymizeCandidatePermanently } from '../../src/modules/compliance/anonymization.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';
const DSAR_ID = '44444444-4444-4444-4444-444444444444';

describe('createDsarRequest', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('insert met due_at = nu + 30 dagen + audit-event', async () => {
    const inserted = {
      id: DSAR_ID,
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      request_type: 'access',
      requested_via: 'admin',
      requester_email: 'sofia@example.nl',
      status: 'pending',
      due_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      created_at: new Date().toISOString(),
    };

    client = mockClient({
      __matcher: (sql) => {
        if (/INSERT INTO dsar_requests/i.test(sql)) {
          return { rows: [inserted], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const before = Date.now();
    const result = await createDsarRequest(
      TENANT_ID,
      CAND_ID,
      'access',
      'sofia@example.nl',
      'admin',
      'Inzage-verzoek',
      {},
      USER_ID
    );
    const after = Date.now();

    expect(result.id).toBe(DSAR_ID);

    // due_at parameter (zevende positionele) moet binnen 30 dagen ± fuzz zitten.
    const insertCall = client.query.mock.calls.find((c) =>
      /INSERT INTO dsar_requests/i.test(String(c[0]))
    );
    expect(insertCall).toBeTruthy();
    const params = insertCall![1] as unknown[];
    // Param-volgorde: $1=tenantId, $2=candidateId, $3=requestType,
    // $4=source, $5=email, $6=notes, $7=dueAt → array-index 6.
    const dueAt = new Date(params[6] as string).getTime();
    expect(dueAt).toBeGreaterThanOrEqual(before + 29 * 86_400_000);
    expect(dueAt).toBeLessThanOrEqual(after + 31 * 86_400_000);

    // Audit-event dsar.requested.
    const audit = client.query.mock.calls.find((c) =>
      /INSERT INTO audit_events/i.test(String(c[0]))
    );
    expect(audit).toBeTruthy();
    expect((audit![1] as unknown[])[2]).toBe('dsar.requested');
  });

  it('weigert ongeldig email-adres', async () => {
    await expect(
      createDsarRequest(
        TENANT_ID,
        null,
        'access',
        'not-an-email',
        'email'
      )
    ).rejects.toMatchObject({ code: 'DSAR_EMAIL_INVALID' });
  });

  it('exposeert DSAR_DUE_DAYS = 30 (AVG art. 12)', () => {
    expect(_internal.DSAR_DUE_DAYS).toBe(30);
  });
});

describe('getDsarRequest', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('throwt 404 als id onbekend', async () => {
    client = mockClient({ __matcher: () => ({ rows: [], rowCount: 0 }) });
    teardown = installPoolMock(client);

    await expect(getDsarRequest(TENANT_ID, DSAR_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: 'DSAR_NOT_FOUND',
    });
  });
});

describe('listDsarRequests', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('past status-filter toe in WHERE-clause', async () => {
    client = mockClient({
      __matcher: (sql, params) => {
        if (/FROM dsar_requests/i.test(sql)) {
          // Verifieer dat de status-param meekomt.
          expect(params).toContain('pending');
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await listDsarRequests(TENANT_ID, { status: 'pending' });
  });
});

describe('fulfillDsarRequest', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('triggert anonymizeCandidatePermanently bij deletion-fulfill', async () => {
    const existing = {
      id: DSAR_ID,
      tenant_id: TENANT_ID,
      candidate_id: CAND_ID,
      request_type: 'deletion',
      status: 'pending',
    };
    const updated = { ...existing, status: 'fulfilled' };

    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM dsar_requests/i.test(sql)) {
          return { rows: [existing], rowCount: 1 };
        }
        if (/UPDATE dsar_requests/i.test(sql)) {
          return { rows: [updated], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await fulfillDsarRequest(TENANT_ID, DSAR_ID, USER_ID, {
      status: 'fulfilled',
    });

    expect(anonymizeCandidatePermanently).toHaveBeenCalledWith(
      TENANT_ID,
      CAND_ID,
      USER_ID,
      expect.any(Object)
    );

    // Audit-event dsar.fulfilled.
    const audit = client.query.mock.calls.find((c) =>
      /INSERT INTO audit_events/i.test(String(c[0]))
    );
    expect(audit).toBeTruthy();
    expect((audit![1] as unknown[])[2]).toBe('dsar.fulfilled');
  });

  it('weigert al-afgehandelde verzoeken', async () => {
    client = mockClient({
      __matcher: () => ({
        rows: [{ id: DSAR_ID, status: 'fulfilled', request_type: 'access' }],
        rowCount: 1,
      }),
    });
    teardown = installPoolMock(client);

    await expect(
      fulfillDsarRequest(TENANT_ID, DSAR_ID, USER_ID, { status: 'fulfilled' })
    ).rejects.toMatchObject({ code: 'DSAR_ALREADY_CLOSED' });
  });

  it('schrijft dsar.rejected audit-event bij rejection', async () => {
    const existing = {
      id: DSAR_ID,
      tenant_id: TENANT_ID,
      candidate_id: null,
      request_type: 'access',
      status: 'pending',
    };
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT \* FROM dsar_requests/i.test(sql)) {
          return { rows: [existing], rowCount: 1 };
        }
        if (/UPDATE dsar_requests/i.test(sql)) {
          return {
            rows: [{ ...existing, status: 'rejected' }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await fulfillDsarRequest(TENANT_ID, DSAR_ID, USER_ID, {
      status: 'rejected',
      notes: 'Onvoldoende identificatie',
    });

    const audit = client.query.mock.calls.find((c) =>
      /INSERT INTO audit_events/i.test(String(c[0]))
    );
    expect((audit![1] as unknown[])[2]).toBe('dsar.rejected');
    expect(anonymizeCandidatePermanently).not.toHaveBeenCalled();
  });
});
