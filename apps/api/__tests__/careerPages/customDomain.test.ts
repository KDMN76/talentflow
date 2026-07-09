import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient, installPoolMock, type MockClient } from '../helpers/dbMock';
import {
  normalizeHostname,
  isValidHostname,
  validateCustomDomainInput,
  isReservedHost,
  getReservedHosts,
  ipMatchesTarget,
} from '../../src/modules/career-pages/customDomain';
import {
  resolveCareerPageByDomain,
  setCareerPageCustomDomain,
} from '../../src/modules/career-pages/career-pages.service';
import { AppError } from '../../src/middleware/errorHandler';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PAGE_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

// ──────────────────────────────────────────────────────────────────────────────
// Pure helpers — normalisatie + hostname-validatie
// ──────────────────────────────────────────────────────────────────────────────

describe('normalizeHostname', () => {
  it('lowercases and strips scheme, path, query, port and trailing dot', () => {
    expect(normalizeHostname('HTTPS://WerkenBij.Klant.NL:443/vacatures?x=1#a')).toBe(
      'werkenbij.klant.nl'
    );
    expect(normalizeHostname('werkenbij.klant.nl.')).toBe('werkenbij.klant.nl');
    expect(normalizeHostname('  Werkenbij.Klant.NL  ')).toBe('werkenbij.klant.nl');
  });

  it('returns null for empty / whitespace input', () => {
    expect(normalizeHostname('')).toBeNull();
    expect(normalizeHostname('   ')).toBeNull();
    expect(normalizeHostname(null)).toBeNull();
    expect(normalizeHostname(undefined)).toBeNull();
  });
});

describe('isValidHostname', () => {
  it('accepts multi-label hostnames', () => {
    expect(isValidHostname('werkenbij.klant.nl')).toBe(true);
    expect(isValidHostname('a.b.c.example.com')).toBe(true);
  });

  it('rejects single labels, empty and malformed hosts', () => {
    expect(isValidHostname('localhost')).toBe(false); // geen punt
    expect(isValidHostname('')).toBe(false);
    expect(isValidHostname('-bad.com')).toBe(false);
    expect(isValidHostname('bad-.com')).toBe(false);
    expect(isValidHostname('has space.com')).toBe(false);
    expect(isValidHostname('a'.repeat(254) + '.com')).toBe(false); // > 253
  });
});

describe('getReservedHosts / isReservedHost', () => {
  const original = process.env.CORS_ORIGIN;
  beforeEach(() => {
    process.env.CORS_ORIGIN = 'https://talentflow.kdmn.nl';
  });
  afterEach(() => {
    process.env.CORS_ORIGIN = original;
  });

  it('always reserves loopback names', () => {
    const reserved = getReservedHosts();
    expect(reserved.has('localhost')).toBe(true);
    expect(reserved.has('127.0.0.1')).toBe(true);
  });

  it('derives the app host from CORS_ORIGIN', () => {
    const reserved = getReservedHosts();
    expect(reserved.has('talentflow.kdmn.nl')).toBe(true);
  });

  it('reserves the app host and its subdomains', () => {
    const reserved = getReservedHosts();
    expect(isReservedHost('talentflow.kdmn.nl', reserved)).toBe(true);
    expect(isReservedHost('foo.talentflow.kdmn.nl', reserved)).toBe(true);
    expect(isReservedHost('werkenbij.klant.nl', reserved)).toBe(false);
  });
});

describe('validateCustomDomainInput', () => {
  const original = process.env.CORS_ORIGIN;
  beforeEach(() => {
    process.env.CORS_ORIGIN = 'https://talentflow.kdmn.nl';
  });
  afterEach(() => {
    process.env.CORS_ORIGIN = original;
  });

  it('returns the normalized host for a valid custom domain', () => {
    expect(validateCustomDomainInput('WerkenBij.Klant.NL')).toBe('werkenbij.klant.nl');
    // scheme/pad worden gestript en het resultaat is een geldige host
    expect(validateCustomDomainInput('https://careers.company.com/jobs')).toBe(
      'careers.company.com'
    );
  });

  it('rejects app-owned hosts (localhost + app host)', () => {
    expect(() => validateCustomDomainInput('localhost')).toThrowError(AppError);
    expect(() => validateCustomDomainInput('talentflow.kdmn.nl')).toThrowError(
      AppError
    );
    expect(() => validateCustomDomainInput('careers.talentflow.kdmn.nl')).toThrowError(
      AppError
    );
    try {
      validateCustomDomainInput('talentflow.kdmn.nl');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(400);
      expect((err as AppError).code).toBe('DOMAIN_RESERVED');
    }
  });

  it('rejects malformed hostnames', () => {
    expect(() => validateCustomDomainInput('nodot')).toThrowError(AppError);
    expect(() => validateCustomDomainInput('has space.com')).toThrowError(AppError);
    try {
      validateCustomDomainInput('nodot');
    } catch (err) {
      expect((err as AppError).code).toBe('INVALID_DOMAIN');
    }
  });
});

describe('ipMatchesTarget', () => {
  it('matches when the target IP is among the resolved A-records', () => {
    expect(ipMatchesTarget(['1.2.3.4', '91.98.232.104'], '91.98.232.104')).toBe(true);
    expect(ipMatchesTarget(['1.2.3.4'], '91.98.232.104')).toBe(false);
    expect(ipMatchesTarget([], '91.98.232.104')).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// resolveCareerPageByDomain — service (DB gemockt)
// ──────────────────────────────────────────────────────────────────────────────

describe('resolveCareerPageByDomain', () => {
  let teardown: (() => void) | undefined;

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    vi.clearAllMocks();
  });

  /** Mock-DB die alleen 'werkenbij.klant.nl' → slug 'klant' publiceert. */
  function installDomainDb(): MockClient {
    const client = mockClient({
      __matcher: (sql, params) => {
        // De service gate't op published-zichtbaarheid via `active = TRUE`.
        expect(sql).toMatch(/active\s*=\s*TRUE/i);
        const host = params[0] as string;
        return host === 'werkenbij.klant.nl'
          ? { rows: [{ slug: 'klant' }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);
    return client;
  }

  it('resolves a published custom domain to its slug', async () => {
    installDomainDb();
    await expect(resolveCareerPageByDomain('werkenbij.klant.nl')).resolves.toEqual({
      slug: 'klant',
    });
  });

  it('is case-insensitive and strips port + trailing dot before matching', async () => {
    const client = installDomainDb();
    await expect(
      resolveCareerPageByDomain('WerkenBij.Klant.NL:443')
    ).resolves.toEqual({ slug: 'klant' });
    await expect(resolveCareerPageByDomain('werkenbij.klant.nl.')).resolves.toEqual({
      slug: 'klant',
    });
    // De query kreeg de genormaliseerde (lowercase, poortloze) host mee.
    const params = client.query.mock.calls.map((c) => (c[1] as unknown[])?.[0]);
    expect(params).toContain('werkenbij.klant.nl');
    expect(params).not.toContain('WerkenBij.Klant.NL:443');
  });

  it('throws 404 when no published page matches the host', async () => {
    installDomainDb();
    await expect(
      resolveCareerPageByDomain('onbekend.example.com')
    ).rejects.toMatchObject({ statusCode: 404, code: 'DOMAIN_NOT_FOUND' });
  });

  it('throws 404 for an empty / unparseable host without hitting the DB', async () => {
    const client = installDomainDb();
    await expect(resolveCareerPageByDomain('')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(client.query).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// setCareerPageCustomDomain — uniqueness conflict + happy path (DB gemockt)
// ──────────────────────────────────────────────────────────────────────────────

describe('setCareerPageCustomDomain', () => {
  let teardown: (() => void) | undefined;

  afterEach(() => {
    teardown?.();
    teardown = undefined;
    vi.clearAllMocks();
  });

  it('throws 409 when the domain is already linked to another page', async () => {
    const client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT id, custom_domain/i.test(sql)) {
          return { rows: [{ id: PAGE_ID, custom_domain: null }], rowCount: 1 };
        }
        // Uniqueness pre-check → een andere pagina heeft dit domein al.
        if (/id\s*<>\s*\$2/i.test(sql)) {
          return { rows: [{ id: 'other-page' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    await expect(
      setCareerPageCustomDomain(
        TENANT_ID,
        PAGE_ID,
        USER_ID,
        'werkenbij.klant.nl'
      )
    ).rejects.toMatchObject({ statusCode: 409, code: 'DOMAIN_TAKEN' });
  });

  it('stores the normalized host and resets verification on success', async () => {
    let updateParams: unknown[] = [];
    const client = mockClient({
      __matcher: (sql, params) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT id, custom_domain/i.test(sql)) {
          return { rows: [{ id: PAGE_ID, custom_domain: null }], rowCount: 1 };
        }
        if (/id\s*<>\s*\$2/i.test(sql)) {
          return { rows: [], rowCount: 0 }; // geen conflict
        }
        if (/^\s*UPDATE career_pages/i.test(sql)) {
          updateParams = params;
          return {
            rows: [
              {
                id: PAGE_ID,
                tenant_id: TENANT_ID,
                custom_domain: params[0],
                custom_domain_verified_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 }; // audit-insert etc.
      },
    });
    teardown = installPoolMock(client);

    const page = await setCareerPageCustomDomain(
      TENANT_ID,
      PAGE_ID,
      USER_ID,
      'WerkenBij.Klant.NL'
    );

    expect(page.custom_domain).toBe('werkenbij.klant.nl');
    expect(page.custom_domain_verified_at).toBeNull();
    // De UPDATE kreeg de genormaliseerde host als eerste parameter.
    expect(updateParams[0]).toBe('werkenbij.klant.nl');
  });

  it('clears the domain when given an empty value', async () => {
    let sawClearUpdate = false;
    const client = mockClient({
      __matcher: (sql) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET)/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/SELECT id, custom_domain/i.test(sql)) {
          return {
            rows: [{ id: PAGE_ID, custom_domain: 'werkenbij.klant.nl' }],
            rowCount: 1,
          };
        }
        if (/^\s*UPDATE career_pages/i.test(sql) && /custom_domain = NULL/i.test(sql)) {
          sawClearUpdate = true;
          return {
            rows: [
              { id: PAGE_ID, custom_domain: null, custom_domain_verified_at: null },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    teardown = installPoolMock(client);

    const page = await setCareerPageCustomDomain(TENANT_ID, PAGE_ID, USER_ID, '');
    expect(sawClearUpdate).toBe(true);
    expect(page.custom_domain).toBeNull();
  });
});
