/**
 * Bulk-campaign service tests — Sprint Q3.1.
 *
 * Focus: consent-filtering en correct counten van eligible/skipped.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

// vi.mock factories are hoisted — kunnen geen externe variabelen referencen.
// We installeren een gedeelde mock via vi.hoisted() (resolved before mock-factory).
const { enqueueMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn(async () => ({ id: 'mock-job' })),
}));

vi.mock('../../src/queue/queues', () => ({
  redis: {
    setex: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
  },
  emailSenderQueue: {
    add: enqueueMock,
  },
  workflowEventsQueue: { add: vi.fn() },
  inboxSyncQueue: { add: vi.fn() },
  bulkMailQueue: { add: vi.fn() },
}));

import { startBulkCampaign } from '../../src/modules/communications/bulkCampaign.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CAND_A = '33333333-3333-3333-3333-333333333333'; // consent + email
const CAND_B = '44444444-4444-4444-4444-444444444444'; // no consent
const CAND_C = '55555555-5555-5555-5555-555555555555'; // consent maar geen email
const CAMPAIGN_ID = '66666666-6666-6666-6666-666666666666';

describe('startBulkCampaign — consent-filter', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => {
    enqueueMock.mockClear();
  });

  afterEach(() => {
    teardown?.();
    vi.clearAllMocks();
  });

  it('telt eligible vs skipped en enqueued alleen consenters met email', async () => {
    let recipientInsertSqls: string[] = [];
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id, email, name, email_consent/i.test(sql)) {
          return {
            rows: [
              { id: CAND_A, email: 'a@x.com', name: 'A', email_consent: true },
              { id: CAND_B, email: 'b@x.com', name: 'B', email_consent: false },
              { id: CAND_C, email: null, name: 'C', email_consent: true },
            ],
            rowCount: 3,
          };
        }
        if (/INSERT INTO bulk_campaigns/i.test(sql)) {
          return {
            rows: [
              {
                id: CAMPAIGN_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                subject: 'Hi',
                body_html: '<p>hi</p>',
                template_id: null,
                via: 'resend',
                mailbox_integration_id: null,
                total_eligible: 1,
                total_skipped_consent: 2,
                total_sent: 0,
                total_failed: 0,
                status: 'running',
                started_at: new Date().toISOString(),
                completed_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        if (/INSERT INTO bulk_campaign_recipients/i.test(sql)) {
          recipientInsertSqls.push(sql);
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const result = await startBulkCampaign(TENANT_ID, USER_ID, {
      candidate_ids: [CAND_A, CAND_B, CAND_C],
      subject: 'Hi',
      body_html: '<p>hi</p>',
      via: 'resend',
    });

    expect(result.total_eligible).toBe(1);
    expect(result.total_skipped_consent).toBe(2);
    expect(result.campaign_id).toBe(CAMPAIGN_ID);

    // Eén INSERT voor de eligible, één voor de skipped batch.
    expect(recipientInsertSqls.length).toBe(2);

    // Slechts 1 mail-job enqueued (alleen kandidaat A).
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const [, payload] = enqueueMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload.candidateId).toBe(CAND_A);
    expect(payload.to).toBe('a@x.com');
    // Geen mailbox-integration in resend-modus.
    expect(payload.mailboxIntegrationId).toBeUndefined();
    expect(payload.campaignId).toBe(CAMPAIGN_ID);
  });

  it('weigert via=mailbox_integration zonder integration_id', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);

    await expect(
      startBulkCampaign(TENANT_ID, USER_ID, {
        candidate_ids: [CAND_A],
        subject: 'X',
        body_html: '<p>x</p>',
        via: 'mailbox_integration',
      })
    ).rejects.toMatchObject({ code: 'MISSING_MAILBOX_INTEGRATION' });
  });

  it('weigert lege ontvangers-lijst', async () => {
    client = mockClient({});
    teardown = installPoolMock(client);

    await expect(
      startBulkCampaign(TENANT_ID, USER_ID, {
        candidate_ids: [],
        subject: 'X',
        body_html: '<p>x</p>',
        via: 'resend',
      })
    ).rejects.toMatchObject({ code: 'NO_RECIPIENTS' });
  });

  it('rate-limit: i-de job krijgt delay = i*1000 ms', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT id, email, name, email_consent/i.test(sql)) {
          return {
            rows: [
              { id: CAND_A, email: 'a@x.com', name: 'A', email_consent: true },
              { id: CAND_B, email: 'b@x.com', name: 'B', email_consent: true },
            ],
            rowCount: 2,
          };
        }
        if (/INSERT INTO bulk_campaigns/i.test(sql)) {
          return {
            rows: [
              {
                id: CAMPAIGN_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                subject: 'Hi',
                body_html: '<p>hi</p>',
                template_id: null,
                via: 'resend',
                mailbox_integration_id: null,
                total_eligible: 2,
                total_skipped_consent: 0,
                total_sent: 0,
                total_failed: 0,
                status: 'running',
                started_at: new Date().toISOString(),
                completed_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await startBulkCampaign(TENANT_ID, USER_ID, {
      candidate_ids: [CAND_A, CAND_B],
      subject: 'Hi',
      body_html: '<p>hi</p>',
      via: 'resend',
    });

    expect(enqueueMock).toHaveBeenCalledTimes(2);
    const firstOpts = enqueueMock.mock.calls[0][2] as { delay: number };
    const secondOpts = enqueueMock.mock.calls[1][2] as { delay: number };
    expect(firstOpts.delay).toBe(0);
    expect(secondOpts.delay).toBe(1000);
  });
});
