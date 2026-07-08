/**
 * DSAR export tests — AVG art. 15 (Sprint Q4 GDPR e2e).
 *
 * Dekt:
 *   - loadCandidateExportData: dossier-samenstelling (profiel + sollicitaties
 *     + communicatie + scorecards + ai_events), embedding-stripping, 404.
 *   - renderReadableExport: leesbare variant bevat alle secties.
 *   - createDataExportLink: token-insert (64-hex, TTL 24u, max 3 downloads)
 *     + audit-event; 404 onbekende kandidaat; 409 geanonimiseerd.
 *   - downloadDataExportByToken: 404 ongeldig, 410 verlopen, 410 op-limiet,
 *     race-guard, happy path (ZIP-buffer + teller-bump + audit).
 */

import { createHash } from 'crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';

/** Spiegelt hashExportToken in dsar.service.ts — alleen de hash ligt at rest. */
function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

import {
  createDataExportLink,
  downloadDataExportByToken,
  _internal,
} from '../../src/modules/compliance/dsar.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CAND_ID = '33333333-3333-3333-3333-333333333333';
const DSAR_ID = '44444444-4444-4444-4444-444444444444';
const TOKEN_ID = '55555555-5555-5555-5555-555555555555';
const VALID_TOKEN = 'a'.repeat(64);

// ─────────────────────────────────────────────────────────────────────────────
// Export-samenstelling
// ─────────────────────────────────────────────────────────────────────────────

describe('loadCandidateExportData', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  const candidateRow = {
    id: CAND_ID,
    name: 'Sofia Vermeer',
    email: 'sofia@example.nl',
    gdpr_consent: true,
    gdpr_consent_at: '2026-01-01T00:00:00Z',
    email_consent: false,
    email_consent_at: null,
    embedding: '[0.1,0.2]',
    embedding_updated_at: '2026-01-01T00:00:00Z',
  };

  function buildMatcher() {
    return (sql: string) => {
      if (/SELECT \* FROM candidates/i.test(sql)) {
        return { rows: [candidateRow], rowCount: 1 };
      }
      if (/FROM applications a/i.test(sql)) {
        return {
          rows: [
            {
              id: 'app-1',
              job_title: 'Frontend Developer',
              status: 'interviewing',
              created_at: '2026-02-01T00:00:00Z',
            },
          ],
          rowCount: 1,
        };
      }
      if (/FROM communications/i.test(sql)) {
        return {
          rows: [
            {
              id: 'comm-1',
              channel: 'email',
              direction: 'outbound',
              subject: 'Uitnodiging',
              sent_at: '2026-02-02T00:00:00Z',
            },
          ],
          rowCount: 1,
        };
      }
      if (/FROM scorecards sc/i.test(sql)) {
        return {
          rows: [
            {
              id: 'sc-1',
              application_id: 'app-1',
              job_title: 'Frontend Developer',
              overall_score: 4,
              recommendation: 'hire',
              notes: 'Sterke kandidaat',
              submitted_at: '2026-02-03T00:00:00Z',
            },
          ],
          rowCount: 1,
        };
      }
      if (/FROM ai_events/i.test(sql)) {
        return {
          rows: [
            {
              id: 'ai-1',
              feature: 'cv_parsing',
              model: 'claude-haiku',
              provider: 'anthropic',
              output_summary: 'CV geparsed',
              entity_type: 'candidate',
              entity_id: CAND_ID,
              status: 'ok',
              created_at: '2026-02-04T00:00:00Z',
            },
          ],
          rowCount: 1,
        };
      }
      // resumes, audit_events, BEGIN/COMMIT/SET → leeg
      return { rows: [], rowCount: 0 };
    };
  }

  it('bevat profiel, sollicitaties, communicatie, scorecards én ai_events', async () => {
    client = mockClient({ __matcher: buildMatcher() });
    teardown = installPoolMock(client);

    const data = await _internal.loadCandidateExportData(TENANT_ID, CAND_ID);

    expect(data.profile).toMatchObject({ id: CAND_ID, name: 'Sofia Vermeer' });
    expect(data.applications).toHaveLength(1);
    expect(data.communications).toHaveLength(1);
    expect(data.scorecards).toHaveLength(1);
    expect(data.scorecards[0]).toMatchObject({
      recommendation: 'hire',
      overall_score: 4,
    });
    expect(data.ai_events).toHaveLength(1);
    expect(data.ai_events[0]).toMatchObject({ feature: 'cv_parsing' });
    expect(data.consents).toEqual({
      gdpr_consent: true,
      gdpr_consent_at: '2026-01-01T00:00:00Z',
      email_consent: false,
      email_consent_at: null,
    });
  });

  it('stript embedding-kolommen uit het profiel (geen ML-blobs in export)', async () => {
    client = mockClient({ __matcher: buildMatcher() });
    teardown = installPoolMock(client);

    const data = await _internal.loadCandidateExportData(TENANT_ID, CAND_ID);

    expect(data.profile).not.toHaveProperty('embedding');
    expect(data.profile).not.toHaveProperty('embedding_updated_at');
    // Reguliere persoonsgegevens blijven wél aanwezig.
    expect(data.profile).toHaveProperty('email', 'sofia@example.nl');
  });

  it('throwt 404 als kandidaat onbekend is', async () => {
    client = mockClient({ __matcher: () => ({ rows: [], rowCount: 0 }) });
    teardown = installPoolMock(client);

    await expect(
      _internal.loadCandidateExportData(TENANT_ID, CAND_ID)
    ).rejects.toMatchObject({ statusCode: 404, code: 'CANDIDATE_NOT_FOUND' });
  });
});

describe('stripExcludedProfileKeys', () => {
  it('verwijdert alleen de excluded keys', () => {
    const out = _internal.stripExcludedProfileKeys({
      id: 'c1',
      name: 'Sofia',
      embedding: '[1,2,3]',
      embedding_updated_at: 'x',
    });
    expect(out).toEqual({ id: 'c1', name: 'Sofia' });
  });
});

describe('renderReadableExport', () => {
  it('bevat alle 8 secties + concrete waarden', () => {
    const txt = _internal.renderReadableExport({
      profile: { name: 'Sofia Vermeer', email: 'sofia@example.nl' },
      applications: [
        {
          job_title: 'Frontend Developer',
          status: 'interviewing',
          applied_at: '2026-02-01T00:00:00Z',
        },
      ],
      communications: [
        {
          channel: 'email',
          direction: 'outbound',
          subject: 'Uitnodiging',
          sent_at: '2026-02-02T00:00:00Z',
        },
      ],
      scorecards: [
        {
          job_title: 'Frontend Developer',
          overall_score: 4,
          recommendation: 'hire',
          notes: 'Sterke kandidaat',
          submitted_at: '2026-02-03T00:00:00Z',
        },
      ],
      ai_events: [
        {
          feature: 'cv_parsing',
          model: 'claude-haiku',
          output_summary: 'CV geparsed',
          created_at: '2026-02-04T00:00:00Z',
        },
      ],
      consents: {
        gdpr_consent: true,
        gdpr_consent_at: '2026-01-01T00:00:00Z',
        email_consent: false,
        email_consent_at: null,
      },
      resumes: [
        {
          id: 'r1',
          filename: 'cv-sofia.pdf',
          storage_key: 'k1',
          mime_type: 'application/pdf',
          size_bytes: 1234,
        },
      ] as never,
      audit_trail: [{ id: 'a1' }],
    } as never);

    expect(txt).toContain('KOPIE PERSOONSGEGEVENS — AVG ARTIKEL 15');
    expect(txt).toContain('1. PROFIELGEGEVENS');
    expect(txt).toContain('name: Sofia Vermeer');
    expect(txt).toContain('2. SOLLICITATIES (1)');
    expect(txt).toContain('Frontend Developer');
    expect(txt).toContain('3. COMMUNICATIE (1)');
    expect(txt).toContain('[email/outbound] Uitnodiging');
    expect(txt).toContain('4. BEOORDELINGEN / SCORECARDS (1)');
    expect(txt).toContain('aanbeveling: hire');
    expect(txt).toContain('5. AI-VERWERKINGEN (1)');
    expect(txt).toContain('cv_parsing (claude-haiku)');
    expect(txt).toContain('6. TOESTEMMINGEN');
    expect(txt).toContain('AVG-toestemming: Ja');
    expect(txt).toContain('E-mail-toestemming: Nee');
    expect(txt).toContain('7. CV-BESTANDEN (1)');
    expect(txt).toContain('cv-sofia.pdf');
    expect(txt).toContain('8. VERWERKINGSHISTORIE / AUDIT-TRAIL (1 events)');
  });

  it('toont lege-staat teksten zonder data', () => {
    const txt = _internal.renderReadableExport({
      profile: {},
      applications: [],
      communications: [],
      scorecards: [],
      ai_events: [],
      consents: {
        gdpr_consent: null,
        gdpr_consent_at: null,
        email_consent: null,
        email_consent_at: null,
      },
      resumes: [] as never,
      audit_trail: [],
    } as never);

    expect(txt).toContain('Geen sollicitaties.');
    expect(txt).toContain('Geen communicatie.');
    expect(txt).toContain('Geen beoordelingen.');
    expect(txt).toContain('Geen AI-verwerkingen.');
    expect(txt).toContain('Geen CV-bestanden.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Export-download-links (data_export_tokens, migration 046)
// ─────────────────────────────────────────────────────────────────────────────

describe('createDataExportLink', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  it('genereert 64-hex token, TTL 24u, max 3 downloads + audit-event', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT anonymized_at FROM candidates/i.test(sql)) {
          return { rows: [{ anonymized_at: null }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const before = Date.now();
    const link = await createDataExportLink(TENANT_ID, CAND_ID, {
      dsarId: DSAR_ID,
      userId: USER_ID,
    });
    const after = Date.now();

    expect(link.token).toMatch(/^[a-f0-9]{64}$/);
    expect(link.url).toContain(`/api/gdpr-export/${link.token}`);

    const ttlMs = _internal.EXPORT_TOKEN_TTL_HOURS * 3_600_000;
    const exp = new Date(link.expires_at).getTime();
    expect(exp).toBeGreaterThanOrEqual(before + ttlMs - 5_000);
    expect(exp).toBeLessThanOrEqual(after + ttlMs + 5_000);

    // INSERT-parameters controleren.
    const insert = client.query.mock.calls.find((c) =>
      /INSERT INTO data_export_tokens/i.test(String(c[0]))
    );
    expect(insert).toBeTruthy();
    const params = insert![1] as unknown[];
    // $1=tenant, $2=candidate, $3=dsar, $4=token_hash, $5=expiry, $6=max, $7=created_by
    expect(params[0]).toBe(TENANT_ID);
    expect(params[1]).toBe(CAND_ID);
    expect(params[2]).toBe(DSAR_ID);
    // At rest ligt de sha256-hash, niet de raw token (die zit alleen in de URL).
    expect(params[3]).toBe(sha256(link.token));
    expect(params[3]).not.toBe(link.token);
    expect(params[5]).toBe(_internal.EXPORT_TOKEN_MAX_DOWNLOADS);
    expect(params[6]).toBe(USER_ID);

    // Audit-event zonder PII (alleen dsar_id/expiry/limiet in after).
    const audit = client.query.mock.calls.find((c) =>
      /INSERT INTO audit_events/i.test(String(c[0]))
    );
    expect(audit).toBeTruthy();
    expect((audit![1] as unknown[])[2]).toBe('data_export_link.created');
  });

  it('throwt 404 bij onbekende kandidaat', async () => {
    client = mockClient({ __matcher: () => ({ rows: [], rowCount: 0 }) });
    teardown = installPoolMock(client);

    await expect(
      createDataExportLink(TENANT_ID, CAND_ID)
    ).rejects.toMatchObject({ statusCode: 404, code: 'CANDIDATE_NOT_FOUND' });
  });

  it('throwt 409 als kandidaat al geanonimiseerd is', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/SELECT anonymized_at FROM candidates/i.test(sql)) {
          return {
            rows: [{ anonymized_at: '2026-06-01T00:00:00Z' }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      createDataExportLink(TENANT_ID, CAND_ID)
    ).rejects.toMatchObject({ statusCode: 409, code: 'CANDIDATE_ANONYMIZED' });
  });
});

describe('downloadDataExportByToken', () => {
  let client: MockClient;
  let teardown: () => void;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => teardown?.());

  const tokenRow = {
    id: TOKEN_ID,
    tenant_id: TENANT_ID,
    candidate_id: CAND_ID,
    dsar_id: DSAR_ID,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    max_downloads: 3,
    download_count: 0,
  };

  it('throwt 404 bij onbekend token', async () => {
    client = mockClient({ __matcher: () => ({ rows: [], rowCount: 0 }) });
    teardown = installPoolMock(client);

    await expect(
      downloadDataExportByToken(VALID_TOKEN)
    ).rejects.toMatchObject({ statusCode: 404, code: 'EXPORT_TOKEN_INVALID' });
  });

  it('throwt 410 bij verlopen token', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM data_export_tokens/i.test(sql) && /SELECT/i.test(sql)) {
          return {
            rows: [
              {
                ...tokenRow,
                expires_at: new Date(Date.now() - 1_000).toISOString(),
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      downloadDataExportByToken(VALID_TOKEN)
    ).rejects.toMatchObject({ statusCode: 410, code: 'EXPORT_TOKEN_EXPIRED' });
  });

  it('throwt 410 als download-limiet bereikt is', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM data_export_tokens/i.test(sql) && /SELECT/i.test(sql)) {
          return {
            rows: [{ ...tokenRow, download_count: 3 }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      downloadDataExportByToken(VALID_TOKEN)
    ).rejects.toMatchObject({
      statusCode: 410,
      code: 'EXPORT_TOKEN_EXHAUSTED',
    });
  });

  it('throwt 410 als de teller-bump de race verliest (rowCount 0)', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM data_export_tokens/i.test(sql) && /SELECT/i.test(sql)) {
          return { rows: [tokenRow], rowCount: 1 };
        }
        if (/UPDATE data_export_tokens/i.test(sql)) {
          return { rows: [], rowCount: 0 }; // ander proces was eerder
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      downloadDataExportByToken(VALID_TOKEN)
    ).rejects.toMatchObject({
      statusCode: 410,
      code: 'EXPORT_TOKEN_EXHAUSTED',
    });
  });

  it('happy path: ZIP-buffer + teller-bump + download-audit', async () => {
    client = mockClient({
      __matcher: (sql) => {
        if (/FROM data_export_tokens/i.test(sql) && /SELECT/i.test(sql)) {
          return { rows: [tokenRow], rowCount: 1 };
        }
        if (/UPDATE data_export_tokens/i.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        if (/SELECT \* FROM candidates/i.test(sql)) {
          return {
            rows: [{ id: CAND_ID, name: 'Sofia Vermeer', gdpr_consent: true }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const { buffer, filename } = await downloadDataExportByToken(VALID_TOKEN);

    // Round-trip: de lookup zoekt op token_hash met sha256(incoming), niet op
    // de raw token.
    const lookup = client.query.mock.calls.find(
      (c) =>
        /FROM data_export_tokens/i.test(String(c[0])) &&
        /token_hash\s*=\s*\$1/i.test(String(c[0]))
    );
    expect(lookup).toBeTruthy();
    expect((lookup![1] as unknown[])[0]).toBe(sha256(VALID_TOKEN));

    // ZIP-magic bytes "PK".
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(filename).toMatch(new RegExp(`^dsar-${CAND_ID}-\\d{4}-\\d{2}-\\d{2}\\.zip$`));

    // Teller-bump met race-guard.
    const bump = client.query.mock.calls.find((c) =>
      /UPDATE data_export_tokens/i.test(String(c[0]))
    );
    expect(bump).toBeTruthy();
    expect(String(bump![0])).toContain('download_count < max_downloads');

    // Audit-acties: package.generated (uit generateDataExportZip) én
    // package.downloaded (token-flow).
    const auditActions = client.query.mock.calls
      .filter((c) => /INSERT INTO audit_events/i.test(String(c[0])))
      .map((c) => (c[1] as unknown[])[2]);
    expect(auditActions).toContain('data_export_package.generated');
    expect(auditActions).toContain('data_export_package.downloaded');
  });
});
