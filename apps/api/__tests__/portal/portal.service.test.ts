/**
 * Portal service tests — klantportaal shortlist-feedback (migration 048).
 *
 * Dekt de drie kernafspraken van het publieke portaal:
 *   1. Token-validatie   — onbekend token → 404, verlopen token → 410.
 *   2. PII-vrij contract — de publieke serialisatie bevat NOOIT e-mail,
 *                          telefoon of salaris, ongeacht permissions en
 *                          ongeacht wat de DB-rij meelevert.
 *   3. Feedback-opslag   — beslissingen (approved/rejected/doubt), comments
 *                          en algemene opmerkingen (zonder application_id),
 *                          inclusief permission-checks en shortlist-guard.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock } from '../helpers/dbMock';
import { pool } from '../../src/db/pool';
import { AppError } from '../../src/middleware/errorHandler';
import * as service from '../../src/modules/portal/portal.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const LINK_ID = '22222222-2222-2222-2222-222222222222';
const JOB_ID = '33333333-3333-3333-3333-333333333333';
const APP_ID = '44444444-4444-4444-4444-444444444444';
const CAND_ID = '55555555-5555-5555-5555-555555555555';

const ALL_PERMISSIONS: service.PortalPermissions = {
  view_candidates: true,
  view_resumes: true,
  view_ai_scores: true,
  view_contact_info: true,
  accept_reject: true,
  comment: true,
  download_cv: true,
  view_pipeline_history: true,
};

function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LINK_ID,
    tenant_id: TENANT_ID,
    job_id: JOB_ID,
    token: 'valid-token',
    client_name: 'Klant B.V.',
    permissions: JSON.stringify(ALL_PERMISSIONS),
    expires_at: null,
    view_count: 0,
    last_viewed_at: null,
    branding: '{}',
    job_title: 'Senior Developer',
    job_description: 'Mooie rol.',
    recruiter_name: 'Rita Recruiter',
    ...overrides,
  };
}

/** Applicatie-rij zoals de shortlist-query hem oplevert — mét gesmokkelde PII
 *  (simuleert een toekomstige `SELECT *` die te veel kolommen meeneemt). */
function applicationRowWithPii(): service.RawPortalApplicationRow {
  return {
    id: APP_ID,
    candidate_id: CAND_ID,
    candidate_name: 'Anna de Vries',
    ai_score: 88,
    skills: ['React', 'TypeScript'],
    resume_url: 'https://cdn.example.com/cv.pdf',
    resume_text: 'Frontend-developer met 6 jaar ervaring in React en TypeScript.',
    stage_name: 'Interview',
    applied_at: '2026-07-01T10:00:00.000Z',
    // ↓ PII die er nooit uit mag komen
    email: 'anna@example.com',
    candidate_email: 'anna@example.com',
    phone: '+31612345678',
    candidate_phone: '+31612345678',
    salary_expectation: 85000,
    current_salary: 78000,
  };
}

const PII_KEY_PATTERN = /email|phone|salary/i;
const PII_VALUE_PATTERN = /anna@example\.com|\+31612345678|85000|78000/;

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. PII-vrije serialisatie (pure functie)
// ─────────────────────────────────────────────────────────────────────────────

describe('serializePortalApplication — geen-PII-contract', () => {
  it('bevat nooit e-mail/telefoon/salaris, zelfs met alle permissions aan', () => {
    const out = service.serializePortalApplication(
      applicationRowWithPii(),
      ALL_PERMISSIONS
    );

    for (const key of Object.keys(out)) {
      expect(key).not.toMatch(PII_KEY_PATTERN);
    }
    expect(JSON.stringify(out)).not.toMatch(PII_VALUE_PATTERN);

    // Positief: de toegestane velden zijn er wél.
    expect(out.candidate_name).toBe('Anna de Vries');
    expect(out.ai_score).toBe(88);
    expect(out.skills).toEqual(['React', 'TypeScript']);
    expect(out.resume_summary).toContain('Frontend-developer');
  });

  it('gate-t ai_score, resume en stage op permissions', () => {
    const out = service.serializePortalApplication(applicationRowWithPii(), {
      ...ALL_PERMISSIONS,
      view_ai_scores: false,
      view_resumes: false,
      view_pipeline_history: false,
    });
    expect(out.ai_score).toBeNull();
    expect(out.resume_url).toBeNull();
    expect(out.resume_summary).toBeNull();
    expect(out.stage_name).toBeNull();
  });

  it('neemt eerder gegeven feedback (decision + comments) mee', () => {
    const out = service.serializePortalApplication(
      applicationRowWithPii(),
      ALL_PERMISSIONS,
      {
        decision: 'doubt',
        comments: [
          { id: 'c1', author: 'Klant', body: 'Twijfel over senioriteit', created_at: 'x' },
        ],
      }
    );
    expect(out.client_feedback).toBe('doubt');
    expect(out.comments).toHaveLength(1);
  });
});

describe('buildResumeSummary', () => {
  it('collapsed whitespace en kapt af op een woordgrens met ellipsis', () => {
    const long = `${'woord '.repeat(200)}`;
    const summary = service.buildResumeSummary(long, 100);
    expect(summary).toBeTruthy();
    expect((summary as string).length).toBeLessThanOrEqual(101);
    expect(summary).toMatch(/…$/);
    expect(summary).not.toMatch(/\s{2,}/);
  });

  it('geeft null bij lege input', () => {
    expect(service.buildResumeSummary(null)).toBeNull();
    expect(service.buildResumeSummary('   ')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Feedback-action mapping + groepering
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeFeedbackAction', () => {
  it('mapt UI-varianten naar het canonieke schema', () => {
    expect(service.normalizeFeedbackAction('approve')).toBe('approved');
    expect(service.normalizeFeedbackAction('approved')).toBe('approved');
    expect(service.normalizeFeedbackAction('reject')).toBe('rejected');
    expect(service.normalizeFeedbackAction('rejected')).toBe('rejected');
    expect(service.normalizeFeedbackAction('doubt')).toBe('doubt');
    expect(service.normalizeFeedbackAction('doubted')).toBe('doubt');
    expect(service.normalizeFeedbackAction('comment')).toBe('commented');
    expect(service.normalizeFeedbackAction('commented')).toBe('commented');
  });

  it('geeft null bij onbekende input', () => {
    expect(service.normalizeFeedbackAction('yolo')).toBeNull();
    expect(service.normalizeFeedbackAction(undefined)).toBeNull();
    expect(service.normalizeFeedbackAction(42)).toBeNull();
  });
});

describe('groupFeedbackRows', () => {
  it('splitst per-applicatie beslissingen, comment-threads en algemene opmerkingen', () => {
    const { perApplication, generalComments } = service.groupFeedbackRows([
      { id: 'f1', application_id: APP_ID, action: 'approved', comment: null, client_name: 'K', created_at: 't1' },
      { id: 'f2', application_id: APP_ID, action: 'commented', comment: 'Sterk profiel', client_name: 'K', created_at: 't2' },
      // Latere beslissing wint:
      { id: 'f3', application_id: APP_ID, action: 'doubt', comment: null, client_name: 'K', created_at: 't3' },
      // Algemene opmerking (geen application_id):
      { id: 'f4', application_id: null, action: 'commented', comment: 'Goede shortlist', client_name: 'K', created_at: 't4' },
    ]);

    const state = perApplication.get(APP_ID);
    expect(state?.decision).toBe('doubt');
    expect(state?.comments.map((c) => c.body)).toEqual(['Sterk profiel']);
    expect(generalComments).toHaveLength(1);
    expect(generalComments[0].body).toBe('Goede shortlist');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Token-validatie
// ─────────────────────────────────────────────────────────────────────────────

describe('resolvePortalToken — token-validatie', () => {
  let teardown: (() => void) | undefined;
  afterEach(() => teardown?.());

  it('gooit 404 PORTAL_NOT_FOUND bij onbekend token', async () => {
    teardown = installPoolMock(mockClient({ guest_portal_links: [] }));
    const err = await service.resolvePortalToken('bestaat-niet').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('PORTAL_NOT_FOUND');
  });

  it('gooit 410 PORTAL_EXPIRED bij verlopen token', async () => {
    teardown = installPoolMock(
      mockClient({
        guest_portal_links: [linkRow({ expires_at: '2020-01-01T00:00:00.000Z' })],
      })
    );
    const err = await service.resolvePortalToken('valid-token').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(410);
    expect(err.code).toBe('PORTAL_EXPIRED');
  });

  it('geeft link + geparste permissions terug bij geldig token', async () => {
    teardown = installPoolMock(mockClient({ guest_portal_links: [linkRow()] }));
    const link = await service.resolvePortalToken('valid-token');
    expect(link.id).toBe(LINK_ID);
    expect(link.tenant_id).toBe(TENANT_ID);
    expect(link.permissions.accept_reject).toBe(true);
  });
});

describe('getPortalAccess — token-validatie + PII-vrije respons', () => {
  let teardown: (() => void) | undefined;
  afterEach(() => teardown?.());

  it('gooit 404 door bij onbekend token (geen mock-fallback)', async () => {
    teardown = installPoolMock(mockClient({ guest_portal_links: [] }));
    const err = await service.getPortalAccess('bestaat-niet').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(404);
  });

  it('gooit 410 door bij verlopen token', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql: string) => {
          if (/FROM guest_portal_links/i.test(sql)) {
            return {
              rows: [linkRow({ expires_at: '2020-01-01T00:00:00.000Z' })],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    const err = await service.getPortalAccess('valid-token').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(410);
  });

  it('levert een shortlist zonder enige PII, ook als de DB-rij PII bevat', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql: string) => {
          if (/FROM guest_portal_links/i.test(sql)) {
            return { rows: [linkRow()], rowCount: 1 };
          }
          if (/FROM applications a/i.test(sql)) {
            return {
              rows: [applicationRowWithPii() as unknown as Record<string, unknown>],
              rowCount: 1,
            };
          }
          if (/FROM guest_portal_feedback/i.test(sql)) {
            return {
              rows: [
                {
                  id: 'f1',
                  application_id: APP_ID,
                  action: 'approved',
                  comment: 'Graag uitnodigen',
                  client_name: 'Klant B.V.',
                  created_at: '2026-07-02T09:00:00.000Z',
                },
                {
                  id: 'f2',
                  application_id: null,
                  action: 'commented',
                  comment: 'Sterke selectie',
                  client_name: 'Klant B.V.',
                  created_at: '2026-07-02T09:05:00.000Z',
                },
              ],
              rowCount: 2,
            };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );

    const access = await service.getPortalAccess('valid-token');

    // Geen PII — noch als key, noch als waarde, waar dan ook in de respons.
    expect(JSON.stringify(access)).not.toMatch(PII_VALUE_PATTERN);
    for (const app of access.applications) {
      for (const key of Object.keys(app)) {
        expect(key).not.toMatch(PII_KEY_PATTERN);
      }
    }

    // Feedback-status + algemene opmerkingen komen mee.
    expect(access.applications).toHaveLength(1);
    expect(access.applications[0].client_feedback).toBe('approved');
    expect(access.general_comments.map((c) => c.body)).toEqual(['Sterke selectie']);
    expect(access.job.title).toBe('Senior Developer');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Feedback-opslag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spy op pool.query (de INSERT gaat buiten withTenant om) en vang de
 * geïnserte rij op. pool.connect wordt apart gemockt voor token-resolutie,
 * shortlist-guard en activity-log.
 */
function spyInsert() {
  const inserted: { sql: string; params: unknown[] }[] = [];
  const spy = vi
    .spyOn(pool, 'query')
    .mockImplementation((async (sql: string, params?: unknown[]) => {
      if (/INSERT INTO guest_portal_feedback/i.test(sql)) {
        inserted.push({ sql, params: params ?? [] });
        const [tenant_id, portal_link_id, application_id, action, comment, client_name] =
          params as unknown[];
        return {
          rows: [
            {
              id: 'feedback-1',
              tenant_id,
              portal_link_id,
              application_id,
              action,
              comment,
              client_name,
              created_at: '2026-07-08T12:00:00.000Z',
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);
  return { inserted, spy };
}

describe('submitPortalFeedback — feedback-opslag', () => {
  let teardown: (() => void) | undefined;
  afterEach(() => teardown?.());

  function installHappyPathConnect() {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql: string) => {
          if (/FROM guest_portal_links/i.test(sql)) {
            return { rows: [linkRow()], rowCount: 1 };
          }
          if (/FROM applications/i.test(sql)) {
            return { rows: [{ id: APP_ID }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
  }

  it('slaat een beslissing per kandidaat op (approved)', async () => {
    installHappyPathConnect();
    const { inserted } = spyInsert();

    const feedback = await service.submitPortalFeedback('valid-token', {
      application_id: APP_ID,
      action: 'approved',
      comment: 'Graag uitnodigen',
      client_name: 'Piet',
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0].params).toEqual([
      TENANT_ID,
      LINK_ID,
      APP_ID,
      'approved',
      'Graag uitnodigen',
      'Piet',
    ]);
    expect(feedback.action).toBe('approved');
    expect(feedback.application_id).toBe(APP_ID);
  });

  it("slaat 'doubt' op als beslissing (accept_reject-permission)", async () => {
    installHappyPathConnect();
    const { inserted } = spyInsert();

    await service.submitPortalFeedback('valid-token', {
      application_id: APP_ID,
      action: 'doubt',
    });

    expect(inserted[0].params?.[3]).toBe('doubt');
  });

  it('slaat een algemene opmerking op zonder application_id', async () => {
    installHappyPathConnect();
    const { inserted } = spyInsert();

    const feedback = await service.submitPortalFeedback('valid-token', {
      action: 'commented',
      comment: 'Sterke shortlist, graag meer senioriteit',
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0].params?.[2]).toBeNull(); // application_id
    expect(inserted[0].params?.[3]).toBe('commented');
    // client_name valt terug op de naam van de link.
    expect(inserted[0].params?.[5]).toBe('Klant B.V.');
    expect(feedback.application_id).toBeNull();
  });

  it('weigert een algemene opmerking zonder tekst (400 INVALID_FEEDBACK)', async () => {
    installHappyPathConnect();
    spyInsert();

    const err = await service
      .submitPortalFeedback('valid-token', { action: 'commented', comment: '   ' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('INVALID_FEEDBACK');
  });

  it('weigert een beslissing als algemene opmerking (zonder kandidaat)', async () => {
    installHappyPathConnect();
    spyInsert();

    const err = await service
      .submitPortalFeedback('valid-token', { action: 'approved' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
  });

  it('geeft 403 PERMISSION_DENIED zonder accept_reject-permission', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql: string) => {
          if (/FROM guest_portal_links/i.test(sql)) {
            return {
              rows: [
                linkRow({
                  permissions: JSON.stringify({
                    ...ALL_PERMISSIONS,
                    accept_reject: false,
                  }),
                }),
              ],
              rowCount: 1,
            };
          }
          if (/FROM applications/i.test(sql)) {
            return { rows: [{ id: APP_ID }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    spyInsert();

    const err = await service
      .submitPortalFeedback('valid-token', { application_id: APP_ID, action: 'rejected' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('PERMISSION_DENIED');
  });

  it('geeft 404 als de applicatie niet bij de vacature/tenant van de link hoort', async () => {
    teardown = installPoolMock(
      mockClient({
        __matcher: (sql: string) => {
          if (/FROM guest_portal_links/i.test(sql)) {
            return { rows: [linkRow()], rowCount: 1 };
          }
          // Shortlist-guard vindt niets → andere vacature of andere tenant.
          if (/FROM applications/i.test(sql)) {
            return { rows: [], rowCount: 0 };
          }
          return { rows: [], rowCount: 0 };
        },
      })
    );
    spyInsert();

    const err = await service
      .submitPortalFeedback('valid-token', { application_id: APP_ID, action: 'approved' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('APPLICATION_NOT_FOUND');
  });

  it('gooit 410 door bij verlopen token vóór er iets wordt opgeslagen', async () => {
    teardown = installPoolMock(
      mockClient({
        guest_portal_links: [linkRow({ expires_at: '2020-01-01T00:00:00.000Z' })],
      })
    );
    const { inserted } = spyInsert();

    const err = await service
      .submitPortalFeedback('valid-token', { application_id: APP_ID, action: 'approved' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(410);
    expect(inserted).toHaveLength(0);
  });
});
