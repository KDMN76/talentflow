/**
 * Invoice PDF renderer — Sprint Q4.4 (Agent UUU).
 *
 * Pure pdf-lib (zonder native deps), zelfde aanpak als Q3.5's
 * `lib/reports/exporters/pdf.ts`. Output is een A4-portret-PDF met:
 *   - Header: factuurnummer + bedrijfsnaam + factuurdatum + due-date
 *   - Periode + klant-info
 *   - Lijntabel: omschrijving / aantal / unit / prijs / totaal
 *   - Footer: subtotaal / BTW / totaal in een kader, plus IBAN/notities
 *
 * Test 5 in DoD: `head` van het bestand begint met `%PDF` — pdf-lib doet dit
 * standaard. We retourneren `Buffer` zodat de caller direct naar storage
 * kan schrijven of als response kan streamen.
 */

import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';

export interface InvoicePdfData {
  invoice_number: string;
  status: string;
  issued_date: string | null;
  due_date: string | null;
  period_start: string | null;
  period_end: string | null;
  client_organization_id: string | null;
  contract_id: string | null;
  subtotal_amount: number;
  vat_rate: number;
  vat_amount: number;
  total_amount: number;
  currency: string;
  notes: string | null;
}

export interface InvoicePdfLine {
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  line_total: number;
}

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 50;

function sanitize(s: string): string {
  // pdf-lib WinAnsi: alles buiten Latin-1 strippen.
  // eslint-disable-next-line no-control-regex
  return s.replace(/[^\x00-\xFF]/g, '?');
}

function fmtMoney(amount: number, currency: string): string {
  const symbol = currency === 'EUR' ? '€' : currency + ' ';
  return `${symbol}${amount.toFixed(2)}`;
}

function fmtNumber(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

interface RenderCtx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  fontBold: PDFFont;
}

function newPage(ctx: RenderCtx): void {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.y = PAGE_H - MARGIN;
}

function ensureSpace(ctx: RenderCtx, needed: number): void {
  if (ctx.y - needed < 60) newPage(ctx);
}

function drawText(
  ctx: RenderCtx,
  text: string,
  x: number,
  y: number,
  size: number,
  bold = false,
  color: { r: number; g: number; b: number } = { r: 0.15, g: 0.15, b: 0.18 }
): void {
  ctx.page.drawText(sanitize(text), {
    x,
    y,
    size,
    font: bold ? ctx.fontBold : ctx.font,
    color: rgb(color.r, color.g, color.b),
  });
}

export async function renderInvoicePdf(
  invoice: InvoicePdfData,
  lines: InvoicePdfLine[],
  options: {
    brand_name?: string | null;
    brand_color?: string | null;
    iban?: string | null;
    vat_id?: string | null;
  } = {}
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const ctx: RenderCtx = { doc, page, y: PAGE_H - MARGIN, font, fontBold };

  const brand = options.brand_name ?? 'TalentFlow';
  // Header band
  ctx.page.drawRectangle({
    x: 0,
    y: PAGE_H - 70,
    width: PAGE_W,
    height: 70,
    color: rgb(0.31, 0.27, 0.9),
  });
  drawText(ctx, brand, MARGIN, PAGE_H - 35, 22, true, { r: 1, g: 1, b: 1 });
  drawText(
    ctx,
    `Factuur ${invoice.invoice_number}`,
    PAGE_W - MARGIN - 200,
    PAGE_H - 35,
    16,
    true,
    { r: 1, g: 1, b: 1 }
  );

  ctx.y = PAGE_H - 100;

  // Meta block (left = client info, right = invoice info)
  drawText(ctx, 'Factuur aan:', MARGIN, ctx.y, 10, true);
  drawText(
    ctx,
    invoice.client_organization_id ?? '(klant niet gespecificeerd)',
    MARGIN,
    ctx.y - 14,
    10
  );
  if (invoice.contract_id) {
    drawText(
      ctx,
      `Contract: ${invoice.contract_id}`,
      MARGIN,
      ctx.y - 28,
      9,
      false,
      { r: 0.4, g: 0.4, b: 0.45 }
    );
  }

  const rightX = PAGE_W - MARGIN - 200;
  drawText(ctx, 'Factuurdatum:', rightX, ctx.y, 10, true);
  drawText(ctx, invoice.issued_date ?? '(concept)', rightX + 90, ctx.y, 10);
  drawText(ctx, 'Vervaldatum:', rightX, ctx.y - 14, 10, true);
  drawText(ctx, invoice.due_date ?? '—', rightX + 90, ctx.y - 14, 10);
  if (invoice.period_start && invoice.period_end) {
    drawText(ctx, 'Periode:', rightX, ctx.y - 28, 10, true);
    drawText(
      ctx,
      `${invoice.period_start} t/m ${invoice.period_end}`,
      rightX + 90,
      ctx.y - 28,
      10
    );
  }
  ctx.y -= 70;

  // Table header
  ensureSpace(ctx, 50);
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - 4,
    width: PAGE_W - 2 * MARGIN,
    height: 18,
    color: rgb(0.31, 0.27, 0.9),
  });
  const colXs = [
    MARGIN + 6,
    MARGIN + 270,
    MARGIN + 320,
    MARGIN + 380,
    MARGIN + 460,
  ];
  drawText(ctx, 'Omschrijving', colXs[0], ctx.y, 9, true, { r: 1, g: 1, b: 1 });
  drawText(ctx, 'Aantal', colXs[1], ctx.y, 9, true, { r: 1, g: 1, b: 1 });
  drawText(ctx, 'Eenheid', colXs[2], ctx.y, 9, true, { r: 1, g: 1, b: 1 });
  drawText(ctx, 'Prijs', colXs[3], ctx.y, 9, true, { r: 1, g: 1, b: 1 });
  drawText(ctx, 'Totaal', colXs[4], ctx.y, 9, true, { r: 1, g: 1, b: 1 });
  ctx.y -= 22;

  // Table rows
  let alt = false;
  for (const line of lines) {
    ensureSpace(ctx, 16);
    if (alt) {
      ctx.page.drawRectangle({
        x: MARGIN,
        y: ctx.y - 3,
        width: PAGE_W - 2 * MARGIN,
        height: 14,
        color: rgb(0.97, 0.97, 0.99),
      });
    }
    const desc =
      line.description.length > 50
        ? line.description.slice(0, 49) + '…'
        : line.description;
    drawText(ctx, desc, colXs[0], ctx.y, 9);
    drawText(ctx, fmtNumber(line.quantity), colXs[1], ctx.y, 9);
    drawText(ctx, line.unit, colXs[2], ctx.y, 9);
    drawText(
      ctx,
      fmtMoney(line.unit_price, invoice.currency),
      colXs[3],
      ctx.y,
      9
    );
    drawText(
      ctx,
      fmtMoney(line.line_total, invoice.currency),
      colXs[4],
      ctx.y,
      9
    );
    ctx.y -= 14;
    alt = !alt;
  }

  // Totals block
  ctx.y -= 20;
  ensureSpace(ctx, 80);
  const totalsX = PAGE_W - MARGIN - 200;
  drawText(ctx, 'Subtotaal', totalsX, ctx.y, 10);
  drawText(
    ctx,
    fmtMoney(invoice.subtotal_amount, invoice.currency),
    totalsX + 110,
    ctx.y,
    10,
    true
  );
  ctx.y -= 14;
  drawText(ctx, `BTW (${invoice.vat_rate.toFixed(2)}%)`, totalsX, ctx.y, 10);
  drawText(
    ctx,
    fmtMoney(invoice.vat_amount, invoice.currency),
    totalsX + 110,
    ctx.y,
    10,
    true
  );
  ctx.y -= 18;
  ctx.page.drawLine({
    start: { x: totalsX, y: ctx.y + 8 },
    end: { x: PAGE_W - MARGIN, y: ctx.y + 8 },
    thickness: 0.8,
    color: rgb(0.31, 0.27, 0.9),
  });
  drawText(ctx, 'Totaal', totalsX, ctx.y, 12, true);
  drawText(
    ctx,
    fmtMoney(invoice.total_amount, invoice.currency),
    totalsX + 110,
    ctx.y,
    12,
    true,
    { r: 0.31, g: 0.27, b: 0.9 }
  );
  ctx.y -= 30;

  // Notes / IBAN
  if (invoice.notes) {
    ensureSpace(ctx, 30);
    drawText(ctx, 'Opmerkingen:', MARGIN, ctx.y, 9, true);
    ctx.y -= 12;
    drawText(ctx, invoice.notes.slice(0, 200), MARGIN, ctx.y, 9);
    ctx.y -= 14;
  }
  if (options.iban) {
    drawText(
      ctx,
      `Betaling op IBAN: ${options.iban}`,
      MARGIN,
      ctx.y,
      9,
      false,
      { r: 0.4, g: 0.4, b: 0.45 }
    );
    ctx.y -= 12;
  }
  if (options.vat_id) {
    drawText(ctx, `BTW-id: ${options.vat_id}`, MARGIN, ctx.y, 9, false, {
      r: 0.4,
      g: 0.4,
      b: 0.45,
    });
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
