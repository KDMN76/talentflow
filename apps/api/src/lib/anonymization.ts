/**
 * CV-anonimisatie — Sprint Q2.3.
 *
 * Twee onafhankelijke entry-points:
 *
 *   1. `anonymizeCandidate(candidate, rules)`
 *      Pure function over een Candidate-shape. Vervangt PII-velden door
 *      placeholders. Wordt gebruikt door de portal/share-flow zodat een
 *      hiring-manager nooit naam/email/foto te zien krijgt — én door de
 *      permanente DB-anonimisatie.
 *
 *   2. `anonymizeResumePdf(pdfBuffer, rules, candidate)`
 *      Beste-effort: extract tekst met `pdf-parse`, strip PII via
 *      regex/string-replace, render een nieuwe PDF met `pdf-lib` in een
 *      simpele formattering.
 *
 *      ⚠️  Dit is GEEN forensische redaction. Originele opmaak,
 *      logo's, embedded foto's en alles wat niet als ge-extraheerde
 *      tekst terugkomt is verloren. Voor scanned/image-only PDFs
 *      (pdf-parse levert dan geen tekst) wordt een lege placeholder-PDF
 *      gerenderd met een waarschuwing — caller is verantwoordelijk om
 *      de ratio "redacted vs lege output" te tonen aan de recruiter.
 *
 *      Reden voor "rerender" boven "overlay": pdf-lib heeft geen native
 *      tekst-extract met pixel-coordinaten. We zouden een hele PDF-tekst-
 *      engine moeten porten om bounding-boxes te krijgen. De rerender-
 *      strategie is voorspelbaar én verifieerbaar (PII-tekst staat
 *      NIET in de output).
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// pdf-parse heeft geen types. We laden het via require zoals
// resumeParser.worker.ts ook doet.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse') as (
  buffer: Buffer
) => Promise<{ text: string }>;

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface AnonymizationRules {
  hide_name: boolean;
  hide_email: boolean;
  hide_phone: boolean;
  hide_photo: boolean;
  hide_address: boolean;
  hide_birthdate: boolean;
  hide_nationality: boolean;
  hide_gender: boolean;
  hide_linkedin: boolean;
  /** Sommige bureaus willen graduation-jaren weghalen tegen leeftijd-bias. */
  hide_education_dates: boolean;
}

export const DEFAULT_ANONYMIZATION_RULES: AnonymizationRules = {
  hide_name: true,
  hide_email: true,
  hide_phone: true,
  hide_photo: true,
  hide_address: true,
  hide_birthdate: true,
  hide_nationality: true,
  hide_gender: true,
  hide_linkedin: true,
  hide_education_dates: true,
};

/**
 * Subset van candidate-velden die we mogen patchen. We gebruiken
 * `Partial<unknown>` zodat zowel de DB-row als een transient candidate-DTO
 * het object-shape voldoen.
 */
export interface AnonymizableCandidate {
  id?: string;
  candidate_reference?: string | null;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  birthdate?: string | Date | null;
  gender?: string | null;
  nationalities?: string[] | null;
  address_line1?: string | null;
  address_line2?: string | null;
  address_city?: string | null;
  address_country?: string | null;
  address_postal_code?: string | null;
  skype?: string | null;
  other_contact?: string | null;
  // LinkedIn / social: niet als losse kolom in DB — verwijderen we uit
  // description en other_contact via tekst-strip.
  description?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PII redaction — string utilities
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Internationaal telefoonformaat: optioneel +, 8-15 cijfers, met
// scheidingstekens (spaties, -, ., (, )).
const PHONE_REGEX =
  /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}(?:[\s.-]?\d{2,4})?/g;
// LinkedIn-URL of "linkedin.com/in/<slug>".
const LINKEDIN_REGEX = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/[\w/.-]+/gi;
// Geboortedatum: dd-mm-yyyy / dd/mm/yyyy / yyyy-mm-dd.
const DATE_REGEX =
  /\b(?:\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})\b/g;
// Postcodes (NL: "1234 AB" + UK + DE/BE 4-digit). Generiek.
const POSTCODE_NL = /\b\d{4}\s?[A-Z]{2}\b/g;

const PLACEHOLDER = '[REDACTED]';

/**
 * Vervang elke literal exact-match van `needle` in `haystack` door
 * placeholder. Case-insensitive, accent-tolerant. Defensief tegen lege /
 * korte needles (geen vervangen voor strings < 3 chars om
 * ruis te vermijden).
 */
function stripLiteral(haystack: string, needle: string | null | undefined): string {
  if (!needle) return haystack;
  const trimmed = needle.trim();
  if (trimmed.length < 3) return haystack;

  // Escape regex-special chars.
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'gi');
  return haystack.replace(re, PLACEHOLDER);
}

/**
 * Strip alle PII uit een vrije tekst (CV-text, beschrijving). De rules
 * controleren wat er weg moet — wat NIET weg moet, blijft staan.
 */
export function stripPiiFromText(
  text: string,
  rules: AnonymizationRules,
  candidate: {
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
    address_line1?: string | null;
    address_city?: string | null;
    address_postal_code?: string | null;
    birthdate?: string | Date | null;
  } = {}
): string {
  let out = text ?? '';

  if (rules.hide_email) out = out.replace(EMAIL_REGEX, PLACEHOLDER);
  if (rules.hide_phone) out = out.replace(PHONE_REGEX, PLACEHOLDER);
  if (rules.hide_linkedin) out = out.replace(LINKEDIN_REGEX, PLACEHOLDER);
  if (rules.hide_birthdate) out = out.replace(DATE_REGEX, PLACEHOLDER);
  if (rules.hide_address) out = out.replace(POSTCODE_NL, PLACEHOLDER);

  if (rules.hide_name) {
    out = stripLiteral(out, candidate.name);
    out = stripLiteral(out, candidate.first_name);
    out = stripLiteral(out, candidate.last_name);
    if (candidate.first_name && candidate.last_name) {
      out = stripLiteral(out, `${candidate.first_name} ${candidate.last_name}`);
    }
  }

  if (rules.hide_email) out = stripLiteral(out, candidate.email);
  if (rules.hide_phone) out = stripLiteral(out, candidate.phone);
  if (rules.hide_address) {
    out = stripLiteral(out, candidate.address_line1);
    out = stripLiteral(out, candidate.address_city);
    out = stripLiteral(out, candidate.address_postal_code);
  }

  if (rules.hide_birthdate && candidate.birthdate) {
    const iso =
      candidate.birthdate instanceof Date
        ? candidate.birthdate.toISOString().slice(0, 10)
        : String(candidate.birthdate).slice(0, 10);
    out = stripLiteral(out, iso);
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// anonymizeCandidate — pure transformer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vervang PII-velden in een candidate-shape door veilige placeholders.
 * Returnt een NIEUW object — input wordt niet gemuteerd.
 *
 * Voor `name` valt de placeholder terug op `Kandidaat #<reference>`. Als
 * candidate_reference niet beschikbaar is gebruiken we het id of "anoniem".
 */
export function anonymizeCandidate<T extends AnonymizableCandidate>(
  candidate: T,
  rules: AnonymizationRules
): T {
  const out: AnonymizableCandidate = { ...candidate };
  const reference =
    candidate.candidate_reference ?? candidate.id ?? 'anoniem';

  if (rules.hide_name) {
    out.name = `Kandidaat #${reference}`;
    out.first_name = 'Kandidaat';
    out.last_name = `#${reference}`;
  }
  if (rules.hide_email) out.email = null;
  if (rules.hide_phone) out.phone = null;
  if (rules.hide_birthdate) out.birthdate = null;
  if (rules.hide_gender) out.gender = null;
  if (rules.hide_nationality) out.nationalities = null;
  if (rules.hide_address) {
    out.address_line1 = null;
    out.address_line2 = null;
    out.address_city = null;
    out.address_postal_code = null;
    // address_country bewust BEHOUDEN — geografische match is niet PII.
  }
  if (rules.hide_linkedin) {
    out.skype = null;
    // other_contact kan LinkedIn bevatten — strip via tekst-redaction.
    if (typeof out.other_contact === 'string') {
      out.other_contact = out.other_contact.replace(LINKEDIN_REGEX, PLACEHOLDER);
    }
  }

  if (typeof out.description === 'string' && out.description.length > 0) {
    out.description = stripPiiFromText(out.description, rules, candidate);
  }

  return out as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF anonymization — extract + rerender (best-effort MVP)
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_MARGIN = 40;
const FONT_SIZE = 11;
const LINE_HEIGHT = 14;

/**
 * Anonimiseer een PDF: extract tekst, strip PII volgens `rules`, render
 * een nieuwe PDF in plain-text formattering. Werkt als best-effort en
 * verliest opmaak — explicit gedocumenteerd in de moduledoc.
 *
 * Voor PDFs zonder ge-extraheerde tekst (image/scanned) renderen we een
 * placeholder-pagina met de waarschuwing zodat de recruiter in plaats
 * van een lege response een leesbaar signaal krijgt.
 */
export async function anonymizeResumePdf(
  pdfBuffer: Buffer,
  rules: AnonymizationRules,
  candidate: {
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
    address_line1?: string | null;
    address_city?: string | null;
    address_postal_code?: string | null;
    birthdate?: string | Date | null;
  } = {}
): Promise<Buffer> {
  let extracted = '';
  let extractionFailed = false;
  try {
    const parsed = await pdfParse(pdfBuffer);
    extracted = (parsed.text ?? '').trim();
  } catch {
    extractionFailed = true;
  }

  const cleaned = extracted
    ? stripPiiFromText(extracted, rules, candidate)
    : '';

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  if (!cleaned || extractionFailed) {
    const page = pdfDoc.addPage();
    page.drawText(
      'Geanonimiseerd CV — let op:',
      {
        x: PAGE_MARGIN,
        y: page.getHeight() - PAGE_MARGIN,
        size: 14,
        font,
        color: rgb(0, 0, 0),
      }
    );
    page.drawText(
      'De originele PDF kon niet automatisch worden geanonimiseerd',
      {
        x: PAGE_MARGIN,
        y: page.getHeight() - PAGE_MARGIN - 22,
        size: FONT_SIZE,
        font,
      }
    );
    page.drawText(
      '(geen tekstuele inhoud of geblokkeerde extractor). Vraag de',
      {
        x: PAGE_MARGIN,
        y: page.getHeight() - PAGE_MARGIN - 38,
        size: FONT_SIZE,
        font,
      }
    );
    page.drawText('recruiter om handmatige redaction.', {
      x: PAGE_MARGIN,
      y: page.getHeight() - PAGE_MARGIN - 54,
      size: FONT_SIZE,
      font,
    });
  } else {
    drawWrappedText(pdfDoc, font, cleaned);
  }

  // pdf-lib geeft Uint8Array → wrap in Buffer voor Node consumers.
  // useObjectStreams=false zodat de output door legacy pdf.js readers
  // (zoals pdf-parse v1.1.1) gelezen kan worden — die kunnen geen
  // object-streams decoderen en geven anders een "Unknown compression
  // method in flate stream"-error.
  const bytes = await pdfDoc.save({ useObjectStreams: false });
  return Buffer.from(bytes);
}

/**
 * Render `text` over zoveel pagina's als nodig, met simpele word-wrap
 * binnen `pageWidth - 2*margin`. Gebruikt een mono-spaced fallback-aanpak
 * (chars per line) — precies meten met font.widthOfTextAtSize is duurder
 * maar nauwkeuriger. We kiezen het pragmatische pad: chars/line via een
 * heuristic + measureWidth voor de hard cut-off.
 */
function drawWrappedText(
  pdfDoc: PDFDocument,
  font: import('pdf-lib').PDFFont,
  text: string
): void {
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  const usableWidth = width - PAGE_MARGIN * 2;
  let y = height - PAGE_MARGIN;
  let currentPage = page;

  // Vervang oneindige whitespace + replace non-printable chars (pdf-lib's
  // Helvetica is WinAnsi-only). Niet-encoderbare chars → '?' om crash te
  // vermijden.
  const sanitized = text
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '    ')
    // Strip non-WinAnsi unicode (incl. emoji). pdf-lib WIN-ANSI throws
    // bij chars buiten 0x00–0xFF; we vervangen door '?' om compat te garanderen.
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');

  const lines = sanitized.split('\n');
  for (const rawLine of lines) {
    const wrapped = wrapLine(rawLine, font, usableWidth);
    for (const line of wrapped) {
      if (y < PAGE_MARGIN + LINE_HEIGHT) {
        currentPage = pdfDoc.addPage();
        y = currentPage.getHeight() - PAGE_MARGIN;
      }
      currentPage.drawText(line, {
        x: PAGE_MARGIN,
        y,
        size: FONT_SIZE,
        font,
      });
      y -= LINE_HEIGHT;
    }
  }
}

function wrapLine(
  line: string,
  font: import('pdf-lib').PDFFont,
  maxWidth: number
): string[] {
  if (line.trim().length === 0) return [''];
  const words = line.split(/\s+/);
  const out: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    const w = font.widthOfTextAtSize(candidate, FONT_SIZE);
    if (w <= maxWidth) {
      current = candidate;
    } else {
      if (current) out.push(current);
      // Single-word te breed → hard-cut.
      if (font.widthOfTextAtSize(word, FONT_SIZE) > maxWidth) {
        let chunk = '';
        for (const ch of word) {
          const probe = chunk + ch;
          if (font.widthOfTextAtSize(probe, FONT_SIZE) > maxWidth) {
            out.push(chunk);
            chunk = ch;
          } else {
            chunk = probe;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
  }
  if (current) out.push(current);
  return out;
}
