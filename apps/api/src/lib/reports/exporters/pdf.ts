/**
 * PDF exporter voor Custom Reports — Sprint Q3.5 (Agent GGG).
 *
 * Gebruikt pdf-lib (^1.17.1, al beschikbaar) — een pure JS lib zonder
 * native dependencies. Dat heeft trade-offs:
 *
 *   1. Geen native chart-rendering — pdf-lib kan alleen text/lines/rects/
 *      images. We rendren bar/line/pie/funnel daarom als simpele tabel met
 *      numerieke waarden + percentages. Echte chart-rendering zou een
 *      headless-browser of canvas-lib vereisen (chrome-pdf, puppeteer) en
 *      blaast de container-image op met >150MB. Out-of-scope voor Q3.5;
 *      Excel-export geeft de recruiter wel de cijfers om zelf te plotten.
 *
 *   2. Alleen ingebouwde fonts (Helvetica). Geen custom font = geen license
 *      issues + geen extra binary in image. Helvetica heeft wel beperkte
 *      Unicode coverage (Latin-1 + Latin-Extended) — emoji & non-Latin
 *      worden door pdf-lib's WinAnsi-encoder ge-stripped. Voor Nederlandse
 *      teksten (incl. €, é, ï, ç) is dat ruim voldoende.
 *
 * Layout (A4 portrait, 595×842pt):
 *   - Pagina 1 = cover  (titel, periode, branding)
 *   - Pagina 2..N = blokken in volgorde — auto pagebreak op 720pt
 *   - Footer op iedere pagina: paginanummer + brand-name
 *
 * Branding: primary_color voor titles + table-headers, accent_color voor
 * KPI-getallen. Beide hex-strings → RGB float [0..1] voor pdf-lib.
 *
 * AI-disclosure: indien gezet, op cover én laatste pagina (compact).
 */

import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import type {
  AggregateResult,
  ReportConfig,
  KpiAggregateResult,
  TableAggregateResult,
  ChartAggregateResult,
  FunnelAggregateResult,
  PieAggregateResult,
} from '../configSchema';

export interface PdfExportBranding {
  primary_color?: string | null;
  accent_color?: string | null;
  brand_name?: string | null;
  logo_url?: string | null;
}

export interface PdfExportOptions {
  branding?: PdfExportBranding | null;
  ai_disclosure?: string | null;
}

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = 30;
const PAGEBREAK_THRESHOLD_Y = 90;

const DEFAULT_PRIMARY = '#4F46E5';
const DEFAULT_ACCENT = '#0EA5E9';

// ────────────────────────────────────────────────────────────────────────────
// Color helpers
// ────────────────────────────────────────────────────────────────────────────

function hexToRgb(hex: string | null | undefined, fallback: string): {
  r: number;
  g: number;
  b: number;
} {
  const input = hex ?? fallback;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(input);
  if (!m) return hexToRgb(null, fallback);
  const v = m[1];
  return {
    r: parseInt(v.slice(0, 2), 16) / 255,
    g: parseInt(v.slice(2, 4), 16) / 255,
    b: parseInt(v.slice(4, 6), 16) / 255,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Layout-state — een simpele "cursor" die op iedere pagina y bijhoudt en
// auto-pagebreak doet wanneer een blok niet meer past.
// ────────────────────────────────────────────────────────────────────────────

interface RenderCtx {
  doc: PDFDocument;
  pages: PDFPage[];
  page: PDFPage;
  y: number;
  font: PDFFont;
  fontBold: PDFFont;
  primary: { r: number; g: number; b: number };
  accent: { r: number; g: number; b: number };
  brandName: string;
}

function newPage(ctx: RenderCtx): void {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.pages.push(ctx.page);
  ctx.y = PAGE_H - MARGIN;
}

function ensureSpace(ctx: RenderCtx, needed: number): void {
  if (ctx.y - needed < PAGEBREAK_THRESHOLD_Y) {
    newPage(ctx);
  }
}

/**
 * pdf-lib's WinAnsi encoder gooit op characters buiten Latin-1. We strippen
 * die preventief zodat een rogue emoji in een report-titel niet de hele
 * export sloopt. (Alternatief: kBet-font, maar dat blaast image op.)
 */
function sanitizeText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[^\x00-\xFF]/g, '?');
}

function drawText(
  ctx: RenderCtx,
  text: string,
  opts: {
    size?: number;
    bold?: boolean;
    color?: { r: number; g: number; b: number };
    x?: number;
  } = {}
): void {
  const size = opts.size ?? 11;
  const font = opts.bold ? ctx.fontBold : ctx.font;
  const c = opts.color ?? { r: 0.15, g: 0.15, b: 0.18 };
  ctx.page.drawText(sanitizeText(text), {
    x: opts.x ?? MARGIN,
    y: ctx.y,
    size,
    font,
    color: rgb(c.r, c.g, c.b),
  });
  ctx.y -= size + 4;
}

function drawLine(ctx: RenderCtx, color = rgb(0.85, 0.85, 0.88)): void {
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y + 2 },
    end: { x: MARGIN + CONTENT_W, y: ctx.y + 2 },
    thickness: 0.5,
    color,
  });
  ctx.y -= 6;
}

function drawHeaderBand(ctx: RenderCtx, label: string): void {
  ensureSpace(ctx, 30);
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - 4,
    width: CONTENT_W,
    height: 22,
    color: rgb(ctx.primary.r, ctx.primary.g, ctx.primary.b),
  });
  ctx.page.drawText(sanitizeText(label), {
    x: MARGIN + 8,
    y: ctx.y + 2,
    size: 12,
    font: ctx.fontBold,
    color: rgb(1, 1, 1),
  });
  ctx.y -= 28;
}

// ────────────────────────────────────────────────────────────────────────────
// Block renderers
// ────────────────────────────────────────────────────────────────────────────

function renderKpi(ctx: RenderCtx, block: KpiAggregateResult): void {
  drawHeaderBand(ctx, block.title ?? block.metric_label);
  ensureSpace(ctx, 70);
  const valueText =
    block.value === null
      ? '—'
      : block.metric_unit
        ? `${formatNumber(block.value)} ${block.metric_unit}`
        : formatNumber(block.value);
  ctx.page.drawText(sanitizeText(valueText), {
    x: MARGIN,
    y: ctx.y - 28,
    size: 32,
    font: ctx.fontBold,
    color: rgb(ctx.accent.r, ctx.accent.g, ctx.accent.b),
  });
  ctx.y -= 40;
  if (block.comparison_value !== undefined && block.comparison_value !== null) {
    const delta =
      block.comparison_delta_pct === undefined || block.comparison_delta_pct === null
        ? ''
        : ` (${block.comparison_delta_pct >= 0 ? '+' : ''}${block.comparison_delta_pct.toFixed(
            1
          )}%)`;
    drawText(
      ctx,
      `Vorige periode: ${formatNumber(block.comparison_value)}${delta}`,
      { size: 9, color: { r: 0.42, g: 0.45, b: 0.5 } }
    );
  }
  ctx.y -= 8;
}

function colWidths(headers: string[]): number[] {
  const n = headers.length;
  const w = CONTENT_W / n;
  return headers.map(() => w);
}

function drawTableHeader(ctx: RenderCtx, headers: string[], widths: number[]): void {
  ensureSpace(ctx, 20);
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - 4,
    width: CONTENT_W,
    height: 18,
    color: rgb(ctx.primary.r, ctx.primary.g, ctx.primary.b),
  });
  let x = MARGIN + 4;
  for (let i = 0; i < headers.length; i++) {
    ctx.page.drawText(sanitizeText(headers[i]), {
      x,
      y: ctx.y,
      size: 9,
      font: ctx.fontBold,
      color: rgb(1, 1, 1),
    });
    x += widths[i];
  }
  ctx.y -= 22;
}

function drawTableRow(
  ctx: RenderCtx,
  cells: ReadonlyArray<string | number | null>,
  widths: number[],
  alt: boolean
): void {
  ensureSpace(ctx, 16);
  if (alt) {
    ctx.page.drawRectangle({
      x: MARGIN,
      y: ctx.y - 3,
      width: CONTENT_W,
      height: 14,
      color: rgb(0.97, 0.97, 0.99),
    });
  }
  let x = MARGIN + 4;
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i];
    const txt =
      v === null || v === undefined
        ? ''
        : typeof v === 'number'
          ? Number.isInteger(v)
            ? String(v)
            : v.toFixed(2)
          : String(v);
    // Truncate naar kolom-breedte (ongeveer; pdf-lib-string-width is
    // beschikbaar maar we houden het simpel: 5pt per char schat).
    const maxChars = Math.floor(widths[i] / 5);
    const display = txt.length > maxChars ? txt.slice(0, maxChars - 1) + '…' : txt;
    ctx.page.drawText(sanitizeText(display), {
      x,
      y: ctx.y,
      size: 9,
      font: ctx.font,
      color: rgb(0.15, 0.15, 0.2),
    });
    x += widths[i];
  }
  ctx.y -= 16;
}

function renderTable(ctx: RenderCtx, block: TableAggregateResult): void {
  drawHeaderBand(ctx, block.title ?? 'Tabel');
  const widths = colWidths(block.headers);
  drawTableHeader(ctx, block.headers, widths);
  block.rows.forEach((row, i) => {
    drawTableRow(ctx, row, widths, i % 2 === 1);
  });
  ctx.y -= 8;
}

function renderChart(ctx: RenderCtx, block: ChartAggregateResult): void {
  drawHeaderBand(ctx, block.title ?? `${block.block_type === 'bar' ? 'Bar' : 'Line'} chart`);
  // Note dat we de chart als data-tabel renderen (pdf-lib limitations —
  // zie file-doc bovenaan).
  drawText(
    ctx,
    'Charts worden in PDF gerenderd als data-tabel — gebruik de Excel-export voor visuele charts.',
    { size: 8, color: { r: 0.55, g: 0.55, b: 0.6 } }
  );
  const headers = [block.x_label, ...block.series_labels];
  const widths = colWidths(headers);
  drawTableHeader(ctx, headers, widths);
  block.points.forEach((p, i) => {
    drawTableRow(
      ctx,
      [String(p.x), ...block.series_labels.map((l) => p.values[l] ?? null)],
      widths,
      i % 2 === 1
    );
  });
  ctx.y -= 8;
}

function renderFunnel(ctx: RenderCtx, block: FunnelAggregateResult): void {
  drawHeaderBand(ctx, block.title ?? 'Funnel');
  const headers = ['Stage', 'Aantal', 'Conversie (%)'];
  const widths = colWidths(headers);
  drawTableHeader(ctx, headers, widths);
  block.stages.forEach((stage, i) => {
    drawTableRow(
      ctx,
      [
        stage.stage,
        stage.count,
        stage.conversion_pct === null ? '' : `${stage.conversion_pct.toFixed(1)}%`,
      ],
      widths,
      i % 2 === 1
    );
  });
  ctx.y -= 8;
}

function renderPie(ctx: RenderCtx, block: PieAggregateResult): void {
  drawHeaderBand(ctx, block.title ?? 'Verdeling');
  const headers = ['Categorie', block.metric_label, 'Aandeel (%)'];
  const widths = colWidths(headers);
  drawTableHeader(ctx, headers, widths);
  block.slices.forEach((slice, i) => {
    drawTableRow(
      ctx,
      [
        slice.label,
        slice.value,
        slice.pct === null ? '' : `${slice.pct.toFixed(1)}%`,
      ],
      widths,
      i % 2 === 1
    );
  });
  ctx.y -= 8;
}

function renderBlock(ctx: RenderCtx, block: AggregateResult): void {
  switch (block.block_type) {
    case 'kpi':
      renderKpi(ctx, block);
      break;
    case 'table':
      renderTable(ctx, block);
      break;
    case 'bar':
    case 'line':
      renderChart(ctx, block);
      break;
    case 'funnel':
      renderFunnel(ctx, block);
      break;
    case 'pie':
      renderPie(ctx, block);
      break;
  }
}

function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function describeDateRange(config: ReportConfig): string {
  const dr = config.date_range;
  switch (dr.type) {
    case 'last_n_days':
      return `Laatste ${dr.days} dagen`;
    case 'this_quarter':
      return 'Dit kwartaal';
    case 'last_quarter':
      return 'Vorig kwartaal';
    case 'this_year':
      return 'Dit jaar';
    case 'last_year':
      return 'Vorig jaar';
    case 'custom':
      return `${dr.from} t/m ${dr.to}`;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Cover + footer
// ────────────────────────────────────────────────────────────────────────────

function drawCover(
  ctx: RenderCtx,
  reportName: string,
  config: ReportConfig,
  aiDisclosure: string | null | undefined
): void {
  // Brand-accent strip bovenaan
  ctx.page.drawRectangle({
    x: 0,
    y: PAGE_H - 6,
    width: PAGE_W,
    height: 6,
    color: rgb(ctx.primary.r, ctx.primary.g, ctx.primary.b),
  });
  ctx.y = PAGE_H - 140;

  ctx.page.drawText(sanitizeText(ctx.brandName), {
    x: MARGIN,
    y: PAGE_H - 70,
    size: 12,
    font: ctx.fontBold,
    color: rgb(ctx.primary.r, ctx.primary.g, ctx.primary.b),
  });
  ctx.page.drawText('Custom Report Export', {
    x: MARGIN,
    y: PAGE_H - 88,
    size: 10,
    font: ctx.font,
    color: rgb(0.45, 0.45, 0.5),
  });

  ctx.page.drawText(sanitizeText(reportName), {
    x: MARGIN,
    y: PAGE_H - 200,
    size: 28,
    font: ctx.fontBold,
    color: rgb(0.1, 0.12, 0.18),
  });
  ctx.page.drawText(`Periode: ${describeDateRange(config)}`, {
    x: MARGIN,
    y: PAGE_H - 230,
    size: 12,
    font: ctx.font,
    color: rgb(0.4, 0.43, 0.5),
  });
  ctx.page.drawText(`Gegenereerd: ${new Date().toISOString()}`, {
    x: MARGIN,
    y: PAGE_H - 248,
    size: 10,
    font: ctx.font,
    color: rgb(0.55, 0.55, 0.6),
  });
  if (aiDisclosure) {
    ctx.page.drawText('AI-disclosure:', {
      x: MARGIN,
      y: 120,
      size: 9,
      font: ctx.fontBold,
      color: rgb(0.4, 0.4, 0.45),
    });
    // Wrap simpel — eerste 100 chars per regel.
    const wrapped = wrapText(aiDisclosure, 100);
    let yy = 105;
    for (const line of wrapped) {
      ctx.page.drawText(sanitizeText(line), {
        x: MARGIN,
        y: yy,
        size: 8,
        font: ctx.font,
        color: rgb(0.45, 0.45, 0.5),
      });
      yy -= 11;
    }
  }
}

function drawFooters(ctx: RenderCtx): void {
  ctx.pages.forEach((page, idx) => {
    page.drawLine({
      start: { x: MARGIN, y: FOOTER_Y + 16 },
      end: { x: PAGE_W - MARGIN, y: FOOTER_Y + 16 },
      thickness: 0.4,
      color: rgb(0.85, 0.85, 0.88),
    });
    page.drawText(sanitizeText(ctx.brandName), {
      x: MARGIN,
      y: FOOTER_Y,
      size: 8,
      font: ctx.font,
      color: rgb(0.55, 0.55, 0.6),
    });
    const pageStr = `Pagina ${idx + 1} van ${ctx.pages.length}`;
    page.drawText(pageStr, {
      x: PAGE_W - MARGIN - 80,
      y: FOOTER_Y,
      size: 8,
      font: ctx.font,
      color: rgb(0.55, 0.55, 0.6),
    });
  });
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > maxChars) {
      if (current) lines.push(current);
      current = w;
    } else {
      current = (current ? `${current} ${w}` : w).trim();
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 6); // hard-cap zodat cover niet overflowed
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Render een ReportConfig + AggregateResult[] als A4-PDF.
 *
 * @returns Buffer met `application/pdf` payload
 */
export async function reportToPdfBuffer(
  reportName: string,
  config: ReportConfig,
  blockResults: AggregateResult[],
  options: PdfExportOptions = {}
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(reportName);
  doc.setSubject('Custom Report Export');
  doc.setProducer('TalentFlow');
  doc.setCreator(options.branding?.brand_name ?? 'TalentFlow');

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const ctx: RenderCtx = {
    doc,
    pages: [],
    page: doc.addPage([PAGE_W, PAGE_H]),
    y: PAGE_H - MARGIN,
    font,
    fontBold,
    primary: hexToRgb(options.branding?.primary_color, DEFAULT_PRIMARY),
    accent: hexToRgb(options.branding?.accent_color, DEFAULT_ACCENT),
    brandName: options.branding?.brand_name ?? 'TalentFlow',
  };
  ctx.pages.push(ctx.page);

  // Cover
  drawCover(ctx, reportName, config, options.ai_disclosure);

  // Content — start op fresh page
  newPage(ctx);

  for (const block of blockResults) {
    renderBlock(ctx, block);
    ctx.y -= 6;
  }

  // Eind-disclosure
  if (options.ai_disclosure) {
    ensureSpace(ctx, 30);
    drawText(ctx, 'AI-disclosure', { bold: true, size: 10 });
    drawLine(ctx);
    const wrapped = wrapText(options.ai_disclosure, 110);
    for (const line of wrapped) {
      drawText(ctx, line, { size: 9, color: { r: 0.45, g: 0.45, b: 0.5 } });
    }
  }

  // Footers (incl. paginanummers) — pas helemaal aan het eind, want we
  // moeten weten hoeveel pagina's er zijn voor "X van Y".
  drawFooters(ctx);

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
