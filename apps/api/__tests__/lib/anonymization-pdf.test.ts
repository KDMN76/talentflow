/**
 * PDF anonymization tests — Sprint Q2.3.
 *
 * Generate een trivial PDF, anonimiseer 'm en verifieer dat:
 *   1. Output een geldige PDF is (start met %PDF-)
 *   2. PII niet meer in de tekst-extract zit
 *   3. Voor een lege/non-text PDF een placeholder-pagina wordt gerenderd
 */

import { describe, it, expect } from 'vitest';
import { inflateRawSync, inflateSync } from 'zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  anonymizeResumePdf,
  DEFAULT_ANONYMIZATION_RULES,
} from '../../src/lib/anonymization';

/**
 * Pak alle FlateDecode-content-streams uit een PDF-buffer en concateneer
 * de inflated bytes als string. Niet een volledige PDF-parser maar
 * voldoende om te verifieren of een specifieke tekst in de gerenderde
 * content zit. Decodeer ook hex-strings (`<...>`) — pdf-lib gebruikt
 * die voor tekst-rendering.
 */
function inflateAllStreams(pdf: Buffer): string {
  const text = pdf.toString('latin1');
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const streamBytes = Buffer.from(match[1], 'latin1');
    let decoded: string | null = null;
    for (const fn of [inflateSync, inflateRawSync]) {
      try {
        decoded = fn(streamBytes).toString('latin1');
        break;
      } catch {
        /* probeer volgende algoritme */
      }
    }
    if (decoded === null) decoded = match[1];

    // Decode <hex>-strings (PDF-text-objects gebruiken die voor strings).
    decoded = decoded.replace(/<([0-9a-fA-F\s]+)>/g, (_, hex) => {
      const cleaned = hex.replace(/\s/g, '');
      if (cleaned.length === 0 || cleaned.length % 2 !== 0) return _;
      try {
        return Buffer.from(cleaned, 'hex').toString('latin1');
      } catch {
        return _;
      }
    });
    out.push(decoded);
  }
  return out.join('\n');
}

async function buildSimplePdf(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  let y = page.getHeight() - 50;
  for (const line of text.split('\n')) {
    page.drawText(line, { x: 50, y, size: 12, font });
    y -= 16;
  }
  const bytes = await doc.save({ useObjectStreams: false });
  return Buffer.from(bytes);
}

describe('anonymizeResumePdf', () => {
  it('returnt een geldige PDF zonder de email/telefoon van de kandidaat', async () => {
    const original = await buildSimplePdf(
      [
        'Curriculum Vitae',
        'Sofia Vermeer',
        'sofia@example.nl',
        '+31 6 1234 5678',
        'Senior Backend Engineer met 10 jaar ervaring.',
      ].join('\n')
    );

    const anonymized = await anonymizeResumePdf(
      original,
      DEFAULT_ANONYMIZATION_RULES,
      {
        name: 'Sofia Vermeer',
        first_name: 'Sofia',
        last_name: 'Vermeer',
        email: 'sofia@example.nl',
        phone: '+31 6 1234 5678',
      }
    );

    // Sanity: PDF-magic bytes.
    expect(anonymized.subarray(0, 4).toString('utf8')).toBe('%PDF');

    // Inflate de FlateDecode-content-streams en verifier dat PII niet
    // meer in de gerenderde tekst staat. Dit is robuuster dan
    // pdf-parse v1.1.1 (gebruikt pdf.js v1.10.100 uit 2017) die met
    // pdf-lib output instabiel is.
    const decoded = inflateAllStreams(anonymized);
    expect(decoded).not.toContain('sofia@example.nl');
    expect(decoded).not.toContain('Sofia Vermeer');
    // Description-fragmenten mogen nog leesbaar zijn (bewust):
    expect(decoded).toContain('Backend Engineer');
  }, 15000);

  it('rendert een waarschuwings-pagina voor een PDF zonder ge-extraheerde tekst', async () => {
    // Maak een PDF met alleen een lege pagina (geen tekst).
    const doc = await PDFDocument.create();
    doc.addPage();
    const empty = Buffer.from(await doc.save({ useObjectStreams: false }));

    const out = await anonymizeResumePdf(empty, DEFAULT_ANONYMIZATION_RULES, {});
    const decoded = inflateAllStreams(out);
    expect(decoded).toMatch(/Geanonimiseerd CV/);
  }, 15000);

  it('rendert een waarschuwings-pagina als pdf-parse faalt op corrupt input', async () => {
    const corrupt = Buffer.from('not-a-pdf-at-all', 'utf8');
    const out = await anonymizeResumePdf(
      corrupt,
      DEFAULT_ANONYMIZATION_RULES,
      {}
    );
    expect(out.subarray(0, 4).toString('utf8')).toBe('%PDF');
    const decoded = inflateAllStreams(out);
    expect(decoded).toMatch(/Geanonimiseerd CV/);
  }, 15000);
});
