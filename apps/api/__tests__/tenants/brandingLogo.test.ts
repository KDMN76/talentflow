/**
 * brandingLogo.service.ts — content-type-validatie voor tenant-logo-uploads.
 *
 * Onder test (pure functies, geen DB/storage nodig):
 *   - sniffLogoType        magic-byte-detectie (PNG/JPEG) + SVG-tekstdetectie
 *   - validateLogoFile     grootte, mime-allowlist, mime↔inhoud-consistentie
 *   - assertSafeSvgContent SVG-scrub (script, on*-attributen, javascript:,
 *                          foreignObject, embedded HTML, @import, externe
 *                          hrefs, entity-obfuscatie)
 *
 * Zie het SVG-beleid in de file-header van brandingLogo.service.ts: SVG wordt
 * geaccepteerd met defense-in-depth (upload-scrub + serve-CSP + <img>-only).
 */

import { describe, it, expect } from 'vitest';
import {
  sniffLogoType,
  validateLogoFile,
  assertSafeSvgContent,
  MAX_LOGO_BYTES,
} from '../../src/modules/tenants/brandingLogo.service';
import { AppError } from '../../src/middleware/errorHandler';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PNG_BUFFER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-png-payload'),
]);

const JPEG_BUFFER = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('fake-jpeg-payload'),
]);

const GIF_BUFFER = Buffer.from('GIF89a-not-allowed');

const SAFE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>
  <rect width="10" height="10" fill="url(#g)"/>
</svg>`;

/** Verwacht een AppError met de gegeven code. */
function expectAppError(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.fail(`verwachtte AppError(${code}), maar er werd niets gegooid`);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    expect((err as AppError).statusCode).toBe(400);
  }
}

// ─── sniffLogoType ───────────────────────────────────────────────────────────

describe('sniffLogoType — magic bytes + SVG-detectie', () => {
  it('herkent PNG aan de magic bytes', () => {
    expect(sniffLogoType(PNG_BUFFER)).toBe('png');
  });

  it('herkent JPEG aan de magic bytes', () => {
    expect(sniffLogoType(JPEG_BUFFER)).toBe('jpg');
  });

  it('herkent een kale SVG', () => {
    expect(sniffLogoType(Buffer.from('<svg xmlns="x"></svg>'))).toBe('svg');
  });

  it('herkent SVG achter BOM + XML-declaratie + comments + doctype', () => {
    const svg =
      '﻿<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!-- exported by tool -->\n' +
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "svg11.dtd">\n' +
      '<!-- second comment -->\n' +
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(sniffLogoType(Buffer.from(svg, 'utf8'))).toBe('svg');
  });

  it('weigert GIF (niet in de allowlist)', () => {
    expect(sniffLogoType(GIF_BUFFER)).toBeNull();
  });

  it('weigert willekeurige tekst en "<svgfoo"-prefixen', () => {
    expect(sniffLogoType(Buffer.from('hello world'))).toBeNull();
    expect(sniffLogoType(Buffer.from('<svgfoo>'))).toBeNull();
    expect(sniffLogoType(Buffer.alloc(0))).toBeNull();
  });
});

// ─── validateLogoFile ────────────────────────────────────────────────────────

describe('validateLogoFile — grootte, allowlist en mime↔inhoud-consistentie', () => {
  it('accepteert een geldige PNG en geeft de canonieke mime terug', () => {
    expect(validateLogoFile(PNG_BUFFER, 'image/png')).toEqual({
      mime: 'image/png',
      ext: 'png',
    });
  });

  it('normaliseert de non-standaard alias image/jpg naar image/jpeg', () => {
    expect(validateLogoFile(JPEG_BUFFER, 'image/jpg')).toEqual({
      mime: 'image/jpeg',
      ext: 'jpg',
    });
  });

  it('accepteert een veilige SVG', () => {
    expect(validateLogoFile(Buffer.from(SAFE_SVG), 'image/svg+xml')).toEqual({
      mime: 'image/svg+xml',
      ext: 'svg',
    });
  });

  it('weigert een leeg bestand (EMPTY_FILE)', () => {
    expectAppError(() => validateLogoFile(Buffer.alloc(0), 'image/png'), 'EMPTY_FILE');
  });

  it('weigert bestanden boven de 1MB-cap (LOGO_TOO_LARGE)', () => {
    const big = Buffer.concat([PNG_BUFFER, Buffer.alloc(MAX_LOGO_BYTES)]);
    expectAppError(() => validateLogoFile(big, 'image/png'), 'LOGO_TOO_LARGE');
  });

  it('weigert mimes buiten de allowlist (INVALID_LOGO_TYPE)', () => {
    expectAppError(() => validateLogoFile(GIF_BUFFER, 'image/gif'), 'INVALID_LOGO_TYPE');
    expectAppError(() => validateLogoFile(PNG_BUFFER, 'application/pdf'), 'INVALID_LOGO_TYPE');
  });

  it('weigert inhoud die geen PNG/JPG/SVG is (INVALID_LOGO_CONTENT)', () => {
    expectAppError(
      () => validateLogoFile(Buffer.from('not an image'), 'image/png'),
      'INVALID_LOGO_CONTENT'
    );
  });

  it('weigert mime↔inhoud-mismatch: PNG-bytes gedeclareerd als SVG (LOGO_TYPE_MISMATCH)', () => {
    expectAppError(() => validateLogoFile(PNG_BUFFER, 'image/svg+xml'), 'LOGO_TYPE_MISMATCH');
  });

  it('weigert mime↔inhoud-mismatch: SVG-inhoud gedeclareerd als PNG (LOGO_TYPE_MISMATCH)', () => {
    expectAppError(
      () => validateLogoFile(Buffer.from(SAFE_SVG), 'image/png'),
      'LOGO_TYPE_MISMATCH'
    );
  });

  it('weigert een SVG met script óók als de mime klopt (UNSAFE_SVG)', () => {
    const evil = '<svg xmlns="x"><script>alert(1)</script></svg>';
    expectAppError(() => validateLogoFile(Buffer.from(evil), 'image/svg+xml'), 'UNSAFE_SVG');
  });
});

// ─── assertSafeSvgContent ────────────────────────────────────────────────────

describe('assertSafeSvgContent — SVG-scrub (fail-closed)', () => {
  const unsafe = (svg: string) => expectAppError(() => assertSafeSvgContent(svg), 'UNSAFE_SVG');

  it('laat een schone SVG met interne #refs en inline style door', () => {
    expect(() => assertSafeSvgContent(SAFE_SVG)).not.toThrow();
    expect(() =>
      assertSafeSvgContent('<svg><use href="#icon"/><rect style="fill:#f00"/></svg>')
    ).not.toThrow();
  });

  it('weigert <script>', () => {
    unsafe('<svg><script>alert(1)</script></svg>');
    unsafe('<svg><SCRIPT href="x"/></svg>');
  });

  it('weigert event-handler-attributen (on*=)', () => {
    unsafe('<svg onload="alert(1)"></svg>');
    unsafe('<svg><rect onclick="steal()"/></svg>');
  });

  it('weigert javascript:-URIs, ook entity-geobfusceerd', () => {
    unsafe('<svg><a href="javascript:alert(1)">x</a></svg>');
    unsafe('<svg><a href="&#106;avascript:alert(1)">x</a></svg>');
    unsafe('<svg><a href="&#x6A;avascript:alert(1)">x</a></svg>');
  });

  it('weigert <foreignObject> en embedded HTML-elementen', () => {
    unsafe('<svg><foreignObject><body/></foreignObject></svg>');
    unsafe('<svg><iframe src="x"/></svg>');
    unsafe('<svg><embed src="x"/></svg>');
  });

  it('weigert @import in styles', () => {
    unsafe('<svg><style>@import url(https://evil.example/x.css);</style></svg>');
  });

  it('weigert externe href/xlink:href-verwijzingen (alleen #fragmenten mogen)', () => {
    unsafe('<svg><use href="https://evil.example/sprite.svg#i"/></svg>');
    unsafe('<svg><use xlink:href="data:text/html,<b>x</b>"/></svg>');
  });
});
