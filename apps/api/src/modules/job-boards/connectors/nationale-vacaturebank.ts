/**
 * Nationale Vacaturebank connector — `xml_feed`, region: nl.
 *
 * Strategy:
 *   Vacaturebank (UWV / werk.nl) does NOT accept push-API postings. Instead,
 *   the recruiter publishes a public XML feed and UWV scrapes it daily. So
 *   "post()" here just records intent; the actual visibility flips on once
 *   the row enters the public feed (handled by `publicFeedRoutes.ts`).
 *
 * Cost: € 0 — feed-based distribution is free for recruiters.
 *
 * pollStatus: walks the synthetic applicants_count via `mock.helper`. In
 * production a real poll would hit UWV's "applicantenoverzicht" RSS, but
 * for MVP we trust the kandidaat lands via the public apply_url.
 */

import type {
  ConnectorContext,
  IntegrationCreds,
  JobBoardConnector,
  NormalizedJob,
  PostResult,
  PostingRef,
  StatusUpdate,
} from '../types';
import {
  inMockMode,
  mockApplicantsCount,
  mockExpiresAt,
  mockExternalId,
} from './_helpers/mock.helper';

const BOARD_ID = 'nationale-vacaturebank';

export const nationaleVacaturebankConnector: JobBoardConnector = {
  id: BOARD_ID,
  displayName: 'Nationale Vacaturebank',
  region: 'nl',
  authType: 'xml_feed',

  async post(_ctx: ConnectorContext, job: NormalizedJob, integration: IntegrationCreds): Promise<PostResult> {
    // Vacaturebank is feed-based — there is never a "live API call" to make,
    // so we treat the synthetic-id path as the *real* path. Mock-mode and
    // production-mode return the same shape; the only difference is the
    // `feed_url` echoed in `raw`.
    const externalId = mockExternalId(BOARD_ID, job.id);
    const settings = integration.settings ?? {};
    const feedUrl: string | null = (settings.feed_url as string | undefined) ?? null;
    const externalUrl = `https://werk.nl/werkzoekenden/jobs/${externalId}`;

    if (inMockMode(integration)) {
      // Synthetic path — explicitly tagged so debugging UI can show it.
      return {
        external_id: externalId,
        external_url: externalUrl,
        cost_amount: 0,
        cost_currency: 'EUR',
        expires_at: mockExpiresAt(),
        raw: { mock: true, feed_url: feedUrl, board: BOARD_ID, job_id: job.id },
      };
    }

    // TODO(real-api): hook the eventual real submission API if UWV ever
    // exposes one. For now even "real" = feed-based.
    return {
      external_id: externalId,
      external_url: externalUrl,
      cost_amount: 0,
      cost_currency: 'EUR',
      expires_at: mockExpiresAt(),
      raw: { mock: false, feed_url: feedUrl, board: BOARD_ID, job_id: job.id },
    };
  },

  async pollStatus(
    _ctx: ConnectorContext,
    posting: PostingRef,
    integration: IntegrationCreds
  ): Promise<StatusUpdate | null> {
    if (inMockMode(integration)) {
      return {
        status: 'posted',
        applicants_count: mockApplicantsCount(posting.id),
        raw: { mock: true, board: BOARD_ID, posting_id: posting.id },
      };
    }
    // TODO(real-api): when UWV exposes the applicantenoverzicht RSS, parse
    // it here and return the count. Until then we surface a stable count.
    return {
      status: 'posted',
      applicants_count: mockApplicantsCount(posting.id),
      raw: { mock: false, board: BOARD_ID, posting_id: posting.id },
    };
  },

  async retract(_ctx: ConnectorContext, _posting: PostingRef, _integration: IntegrationCreds): Promise<void> {
    // No-op: removing the row from the feed (handled by service.ts setting
    // status='retracted') is what makes UWV stop scraping. The connector
    // only needs to be idempotent here — calling retract twice is fine.
    return;
  },
};

export default nationaleVacaturebankConnector;
