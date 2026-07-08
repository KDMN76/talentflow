/**
 * emailFooter.ts — sanitatie + appenden van de tenant-branding e-mail-footer.
 *
 * Onder test:
 *   1. sanitizeEmailFooterHtml — strikte allowlist (tags/attributen/href/style),
 *      raw-text-blokken inclusief inhoud weg, escaping van losse < >, lengte-cap.
 *   2. footerHtmlToText        — nette platte-tekst-variant voor het text-part.
 *   3. renderBrandingFooter    — wrapper met marker-attribuut.
 *   4. appendTenantEmailFooter — footer ophalen + appenden; fail-open bij
 *      infrastructuurfouten; dubbel-append-preventie via marker/inhoud.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sanitizeEmailFooterHtml,
  footerHtmlToText,
  renderBrandingFooter,
  appendTenantEmailFooter,
  BRANDING_FOOTER_MARKER,
  MAX_FOOTER_HTML_LENGTH,
} from '../../src/lib/emailFooter';
import { getBrandingForTenant } from '../../src/modules/tenants/branding.service';
import type { TenantBranding } from '../../src/modules/tenants/branding.service';

vi.mock('../../src/modules/tenants/branding.service', () => ({
  getBrandingForTenant: vi.fn(async () => null),
}));

const brandingMock = vi.mocked(getBrandingForTenant);

const TENANT = '11111111-1111-1111-1111-111111111111';

function brandingWithFooter(footer: string | null): TenantBranding {
  return {
    tenant_id: TENANT,
    logo_url: null,
    favicon_url: null,
    primary_color: null,
    accent_color: null,
    brand_name: null,
    email_footer: footer,
    updated_at: new Date().toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  brandingMock.mockResolvedValue(null);
});

// ─── sanitizeEmailFooterHtml ─────────────────────────────────────────────────

describe('sanitizeEmailFooterHtml — strikte allowlist', () => {
  it('laat toegestane tags door', () => {
    const input = '<p>Groet,<br/><strong>Team</strong> <em>KDMN</em></p>';
    const out = sanitizeEmailFooterHtml(input);
    expect(out).toContain('<p>');
    expect(out).toContain('<br/>');
    expect(out).toContain('<strong>Team</strong>');
    expect(out).toContain('<em>KDMN</em>');
  });

  it('verwijdert <script> inclusief inhoud', () => {
    const out = sanitizeEmailFooterHtml('<p>Hoi</p><script>document.cookie</script>');
    expect(out).toBe('<p>Hoi</p>');
    expect(out).not.toContain('cookie');
  });

  it('verwijdert <style>/<iframe>/<svg> inclusief inhoud', () => {
    const out = sanitizeEmailFooterHtml(
      '<style>body{display:none}</style><iframe src="x"></iframe><svg><rect/></svg><p>Ok</p>'
    );
    expect(out).toBe('<p>Ok</p>');
  });

  it('dropt niet-toegestane tags maar behoudt de tekst-inhoud', () => {
    const out = sanitizeEmailFooterHtml('<table><tr><td>Adresregel</td></tr></table>');
    expect(out).toBe('Adresregel');
  });

  it('stript event-handler-attributen en alle overige attributen', () => {
    const out = sanitizeEmailFooterHtml(
      '<p onclick="steal()" class="x" id="y" data-z="1">Hallo</p>'
    );
    expect(out).toBe('<p>Hallo</p>');
  });

  it('staat alleen http(s)/mailto/tel-hrefs toe en voegt target+rel toe', () => {
    const out = sanitizeEmailFooterHtml('<a href="https://kdmn.nl">site</a>');
    expect(out).toContain('href="https://kdmn.nl"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');

    expect(sanitizeEmailFooterHtml('<a href="mailto:info@kdmn.nl">mail</a>')).toContain(
      'href="mailto:info@kdmn.nl"'
    );
    expect(sanitizeEmailFooterHtml('<a href="tel:+31701234567">bel</a>')).toContain(
      'href="tel:+31701234567"'
    );
  });

  it('dropt javascript:-hrefs, ook met tab-obfuscatie', () => {
    const out1 = sanitizeEmailFooterHtml('<a href="javascript:alert(1)">x</a>');
    expect(out1).not.toContain('javascript');
    expect(out1).not.toContain('href');

    const out2 = sanitizeEmailFooterHtml('<a href="java\tscript:alert(1)">x</a>');
    expect(out2).not.toContain('script:');
    expect(out2).not.toContain('href');
  });

  it('geen href overgebleven → ook geen target/rel toegevoegd', () => {
    const out = sanitizeEmailFooterHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('target=');
    expect(out).toBe('<a>x</a>');
  });

  it('filtert style op property-allowlist en weigert url()/expression()', () => {
    const kept = sanitizeEmailFooterHtml('<p style="color:#6b7280;font-size:12px">x</p>');
    expect(kept).toContain('style="color:#6b7280;font-size:12px"');

    const dropped = sanitizeEmailFooterHtml(
      '<p style="background-image:url(https://evil.example/x);width:expression(alert(1))">x</p>'
    );
    expect(dropped).toBe('<p>x</p>');
  });

  it('escapet losse < en > die geen geldige tag vormen', () => {
    const out = sanitizeEmailFooterHtml('1 < 2 en 3 > 2');
    expect(out).toBe('1 &lt; 2 en 3 &gt; 2');
  });

  it('verwijdert HTML-comments', () => {
    expect(sanitizeEmailFooterHtml('<p>a</p><!-- geheim -->')).toBe('<p>a</p>');
  });

  it('capt op MAX_FOOTER_HTML_LENGTH tekens', () => {
    const long = `<p>${'a'.repeat(MAX_FOOTER_HTML_LENGTH + 500)}</p>`;
    const out = sanitizeEmailFooterHtml(long);
    // Input is vóór het parsen afgekapt — output kan nooit langer zijn dan
    // de cap plus de sluit-escaping die het parsen toevoegt.
    expect(out.length).toBeLessThanOrEqual(MAX_FOOTER_HTML_LENGTH + 20);
  });

  it('geeft lege string terug bij null/lege input of alleen lege tags', () => {
    expect(sanitizeEmailFooterHtml(null)).toBe('');
    expect(sanitizeEmailFooterHtml(undefined)).toBe('');
    expect(sanitizeEmailFooterHtml('')).toBe('');
    expect(sanitizeEmailFooterHtml('<p>   </p><br/>')).toBe('');
    expect(sanitizeEmailFooterHtml('<script>x()</script>')).toBe('');
  });
});

// ─── footerHtmlToText / renderBrandingFooter ─────────────────────────────────

describe('footerHtmlToText — platte-tekst-variant', () => {
  it('zet <br> en blok-sluittags om in newlines en stript de rest', () => {
    const text = footerHtmlToText('<p>Groet,<br/>Team &amp; co</p><p>KDMN</p>');
    expect(text).toBe('Groet,\nTeam & co\nKDMN');
  });
});

describe('renderBrandingFooter — wrapper', () => {
  it('bevat het marker-attribuut en de footer-inhoud', () => {
    const html = renderBrandingFooter('<p>Groet</p>');
    expect(html).toContain(`${BRANDING_FOOTER_MARKER}="1"`);
    expect(html).toContain('<p>Groet</p>');
  });
});

// ─── appendTenantEmailFooter ─────────────────────────────────────────────────

describe('appendTenantEmailFooter — appenden + fail-open', () => {
  const body = { html: '<p>Bericht</p>', text: 'Bericht' };

  it('geen branding-rij → body ongewijzigd', async () => {
    brandingMock.mockResolvedValue(null);
    expect(await appendTenantEmailFooter(TENANT, body)).toEqual(body);
  });

  it('footer null → body ongewijzigd', async () => {
    brandingMock.mockResolvedValue(brandingWithFooter(null));
    expect(await appendTenantEmailFooter(TENANT, body)).toEqual(body);
  });

  it('footer die volledig wegsaneert (alleen script) → body ongewijzigd', async () => {
    brandingMock.mockResolvedValue(brandingWithFooter('<script>x()</script>'));
    expect(await appendTenantEmailFooter(TENANT, body)).toEqual(body);
  });

  it('append gesaneerde footer aan html én text', async () => {
    brandingMock.mockResolvedValue(
      brandingWithFooter('<p>Groet, Team</p><script>steal()</script>')
    );
    const out = await appendTenantEmailFooter(TENANT, body);

    expect(out.html).toContain('<p>Bericht</p>');
    expect(out.html).toContain(BRANDING_FOOTER_MARKER);
    expect(out.html).toContain('<p>Groet, Team</p>');
    expect(out.html).not.toContain('steal');
    expect(out.text).toBe('Bericht\n\n--\nGroet, Team');
  });

  it('body zonder text-part → text blijft undefined', async () => {
    brandingMock.mockResolvedValue(brandingWithFooter('<p>Groet</p>'));
    const out = await appendTenantEmailFooter(TENANT, { html: '<p>Hoi</p>' });
    expect(out.text).toBeUndefined();
    expect(out.html).toContain('<p>Groet</p>');
  });

  it('dubbel appenden voorkomen: marker al aanwezig → ongewijzigd', async () => {
    brandingMock.mockResolvedValue(brandingWithFooter('<p>Groet</p>'));
    const once = await appendTenantEmailFooter(TENANT, body);
    const twice = await appendTenantEmailFooter(TENANT, once);
    expect(twice).toEqual(once);
  });

  it('dubbel appenden voorkomen: body bevat de footer-inhoud al → ongewijzigd', async () => {
    brandingMock.mockResolvedValue(brandingWithFooter('<p>Groet</p>'));
    const preRendered = { html: '<p>Bericht</p><p>Groet</p>', text: 'Bericht' };
    expect(await appendTenantEmailFooter(TENANT, preRendered)).toEqual(preRendered);
  });

  it('fail-open: branding-lookup gooit → body ongewijzigd, geen throw', async () => {
    brandingMock.mockRejectedValue(new Error('db down'));
    expect(await appendTenantEmailFooter(TENANT, body)).toEqual(body);
  });
});
