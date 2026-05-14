import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock } from '../helpers/dbMock';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const CONTRACT_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';
const RECRUITER_ID = '44444444-4444-4444-4444-444444444444';

// Capture email-sender enqueue calls
const { emailQueueAddSpy } = vi.hoisted(() => ({
  emailQueueAddSpy: vi.fn(async () => ({ id: 'mock-job' })),
}));
vi.mock('../../src/queue/queues', () => ({
  emailSenderQueue: { add: emailQueueAddSpy },
  contractExpiryQueue: { add: vi.fn(async () => ({ id: 'mock-job' })) },
}));

import { runExpirySweep } from '../../src/queue/workers/contractExpiry.worker';

function contractRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTRACT_ID,
    tenant_id: TENANT_A,
    candidate_id: CAND_ID,
    application_id: null,
    client_organization_id: null,
    job_id: null,
    contract_type: 'temp',
    status: 'active',
    start_date: '2026-01-01',
    end_date: '2026-05-15',
    weekly_hours: 40,
    hourly_rate_candidate: 25,
    hourly_rate_client: 50,
    margin_percent: 50,
    currency: 'EUR',
    cao: null,
    wtza_compliant: null,
    metadata: {},
    signed_at: null,
    terminated_at: null,
    termination_reason: null,
    created_by: RECRUITER_ID,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('contractExpiry — runExpirySweep', () => {
  let teardown: () => void;
  afterEach(() => teardown?.());

  it('flips active+past-end_date to ended and emits e-mails for due notifications', async () => {
    emailQueueAddSpy.mockClear();
    let flippedRows = 0;
    let markedSent = 0;

    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          // listTenantsWithActiveContracts
          if (/SELECT DISTINCT tenant_id\s+FROM contracts/i.test(sql)) {
            return { rows: [{ tenant_id: TENANT_A }], rowCount: 1 };
          }
          // markEndedDueDate UPDATE
          if (/UPDATE contracts\s+SET status = 'ended'/i.test(sql)) {
            flippedRows++;
            return { rows: [{ id: CONTRACT_ID }], rowCount: 1 };
          }
          // SELECT id FROM contracts (re-schedule sweep)
          if (/SELECT id FROM contracts/i.test(sql)) {
            return { rows: [{ id: CONTRACT_ID }], rowCount: 1 };
          }
          // scheduleExpiryNotifications: getContract
          if (/SELECT \* FROM contracts/i.test(sql)) {
            return { rows: [contractRow()], rowCount: 1 };
          }
          if (/FROM contract_extensions/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          if (/INSERT INTO contract_notification_queue/i.test(sql)) {
            return { rows: [], rowCount: 1 };
          }
          // listDueNotificationsAcrossTenants
          if (/FROM contract_notification_queue\s+WHERE scheduled_for/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'n-1',
                  tenant_id: TENANT_A,
                  contract_id: CONTRACT_ID,
                  notification_type: 'expiring_30d',
                  scheduled_for: '2026-04-15',
                  sent_at: null,
                  recipients: [],
                  created_at: new Date().toISOString(),
                },
              ],
              rowCount: 1,
            };
          }
          // gatherRecipients candidates
          if (/SELECT name, email FROM candidates/i.test(sql)) {
            return {
              rows: [{ name: 'Anna Test', email: 'anna@example.com' }],
              rowCount: 1,
            };
          }
          if (/FROM crm_organizations/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          if (/FROM users/i.test(sql)) {
            return {
              rows: [
                {
                  email: 'recruiter@example.com',
                  full_name: 'Test Recruiter',
                  name: 'Test Recruiter',
                },
              ],
              rowCount: 1,
            };
          }
          // markNotificationSent UPDATE
          if (/UPDATE contract_notification_queue/i.test(sql)) {
            markedSent++;
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );

    const result = await runExpirySweep('2026-05-15');
    expect(result.tenants).toBe(1);
    expect(flippedRows).toBeGreaterThanOrEqual(1);
    // 1 candidate + 1 recruiter for the single notification row
    expect(emailQueueAddSpy).toHaveBeenCalledTimes(2);
    expect(markedSent).toBeGreaterThanOrEqual(1);
  });

  it('skips when no recipients found and marks notification as sent with empty list', async () => {
    emailQueueAddSpy.mockClear();
    let markedSent = 0;
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql) => {
          if (/SELECT DISTINCT tenant_id/i.test(sql)) {
            return { rows: [{ tenant_id: TENANT_A }], rowCount: 1 };
          }
          if (/UPDATE contracts\s+SET status = 'ended'/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          if (/SELECT id FROM contracts/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          if (/FROM contract_notification_queue\s+WHERE scheduled_for/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'n-2',
                  tenant_id: TENANT_A,
                  contract_id: CONTRACT_ID,
                  notification_type: 'ended',
                  scheduled_for: '2026-05-15',
                  sent_at: null,
                  recipients: [],
                  created_at: new Date().toISOString(),
                },
              ],
              rowCount: 1,
            };
          }
          if (/SELECT \* FROM contracts/i.test(sql)) {
            return {
              rows: [contractRow({ created_by: null })],
              rowCount: 1,
            };
          }
          if (/FROM contract_extensions/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          if (/SELECT name, email FROM candidates/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          if (/UPDATE contract_notification_queue/i.test(sql)) {
            markedSent++;
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const result = await runExpirySweep('2026-05-15');
    expect(result.tenants).toBe(1);
    expect(emailQueueAddSpy).toHaveBeenCalledTimes(0);
    expect(markedSent).toBeGreaterThanOrEqual(1);
  });
});
