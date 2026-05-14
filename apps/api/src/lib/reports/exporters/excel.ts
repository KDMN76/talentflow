/**
 * Excel exporter voor Custom Reports — Sprint Q3.5 (Agent GGG).
 *
 * Gebruikt ExcelJS (^4.4.0). Layout:
 *   - Sheet 1 = "Samenvatting" — alle KPI-blokken als grote getallen + cover
 *   - Sheet 2..N = "Blok N — <Title>" — per niet-KPI block één sheet
 *
 * Charts: ExcelJS heeft GEEN ondersteuning voor het inserten van charts in
 * een xlsx (alleen images en data). We rendren bar/line/pie/funnel daarom
 * als nette table met numerieke waarden — Excel-gebruikers kunnen daar zelf
 * een chart op leggen via "Insert > Chart" als ze visualisatie willen.
 * Fallback-table is consistent met PDF/CSV en voorkomt formaat-mismatches.
 *
 * Branding: als de tenant primary_color/brand_name heeft, gebruiken we die
 * voor:
 *   - header-cells (fill-color)
 *   - cover-sheet titel
 * `accent_color` wordt gebruikt voor totaal-/footer-cells.
 *
 * Footer per sheet: "Gegenereerd op X door TalentFlow" + AI-disclosure.
 *
 * Output: Buffer met content-type
 *   `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
 */

import ExcelJS from 'exceljs';
import type {
  AggregateResult,
  ReportConfig,
  KpiAggregateResult,
  TableAggregateResult,
  ChartAggregateResult,
  FunnelAggregateResult,
  PieAggregateResult,
} from '../configSchema';

export interface ExcelExportBranding {
  primary_color?: string | null;
  accent_color?: string | null;
  brand_name?: string | null;
}

export interface ExcelExportOptions {
  branding?: ExcelExportBranding | null;
  /** Optionele AI-disclosure (bv. wanneer agg. een Claude-summary toont). */
  ai_disclosure?: string | null;
}

const DEFAULT_PRIMARY = '4F46E5'; // indigo-600 — TalentFlow brand fallback
const DEFAULT_ACCENT = '0EA5E9'; // sky-500
const FOOTER_TEXT = (brand: string): string =>
  `Gegenereerd op ${new Date().toISOString()} door ${brand}`;

function hex(input: string | null | undefined, fallback: string): string {
  if (!input) return fallback;
  // ExcelJS verwacht ARGB (8 hex). We krijgen #RRGGBB binnen.
  const m = /^#?([0-9a-fA-F]{6})$/.exec(input);
  return m ? m[1].toUpperCase() : fallback;
}

function styleHeaderRow(row: ExcelJS.Row, primaryHex: string): void {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${primaryHex}` },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    };
  });
}

/**
 * Rough auto-fit. ExcelJS kan niet pixel-exact passen omdat fonts via
 * de viewer renderen; we nemen `max(label.length, value.length) + 2`.
 */
function autoFitColumns(sheet: ExcelJS.Worksheet): void {
  sheet.columns.forEach((col) => {
    let maxLen = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      const s =
        v === null || v === undefined
          ? ''
          : typeof v === 'object'
            ? JSON.stringify(v)
            : String(v);
      if (s.length > maxLen) maxLen = s.length;
    });
    col.width = Math.min(maxLen + 2, 60);
  });
}

function writeFooter(
  sheet: ExcelJS.Worksheet,
  brandName: string,
  aiDisclosure: string | null | undefined
): void {
  sheet.addRow([]);
  const footer = sheet.addRow([FOOTER_TEXT(brandName)]);
  footer.font = { italic: true, color: { argb: 'FF6B7280' }, size: 9 };
  if (aiDisclosure) {
    const disc = sheet.addRow([`AI-disclosure: ${aiDisclosure}`]);
    disc.font = { italic: true, color: { argb: 'FF6B7280' }, size: 9 };
  }
}

function writeKpi(
  sheet: ExcelJS.Worksheet,
  block: KpiAggregateResult,
  primaryHex: string,
  accentHex: string
): void {
  const titleRow = sheet.addRow([block.title ?? block.metric_label]);
  titleRow.font = { bold: true, size: 14, color: { argb: `FF${primaryHex}` } };
  sheet.addRow([]);
  const valueRow = sheet.addRow([
    block.value === null
      ? '—'
      : block.metric_unit
        ? `${formatNumber(block.value)} ${block.metric_unit}`
        : formatNumber(block.value),
  ]);
  valueRow.font = { bold: true, size: 28, color: { argb: `FF${accentHex}` } };
  if (block.comparison_value !== undefined && block.comparison_value !== null) {
    sheet.addRow([
      `Vorige periode: ${formatNumber(block.comparison_value)}` +
        (block.comparison_delta_pct !== undefined &&
        block.comparison_delta_pct !== null
          ? ` (${block.comparison_delta_pct >= 0 ? '+' : ''}${block.comparison_delta_pct.toFixed(1)}%)`
          : ''),
    ]).font = { color: { argb: 'FF6B7280' }, italic: true };
  }
}

function writeTable(
  sheet: ExcelJS.Worksheet,
  block: TableAggregateResult,
  primaryHex: string
): void {
  if (block.title) {
    const t = sheet.addRow([block.title]);
    t.font = { bold: true, size: 12 };
    sheet.addRow([]);
  }
  const headerRow = sheet.addRow([...block.headers]);
  styleHeaderRow(headerRow, primaryHex);
  for (const row of block.rows) {
    sheet.addRow([...row]);
  }
}

function writeChart(
  sheet: ExcelJS.Worksheet,
  block: ChartAggregateResult,
  primaryHex: string
): void {
  if (block.title) {
    const t = sheet.addRow([block.title]);
    t.font = { bold: true, size: 12 };
    sheet.addRow([]);
  }
  const headers = [block.x_label, ...block.series_labels];
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow, primaryHex);
  for (const point of block.points) {
    sheet.addRow([
      point.x,
      ...block.series_labels.map((l) => point.values[l] ?? null),
    ]);
  }
  // Note voor recruiters die wel een chart willen.
  sheet.addRow([]);
  const note = sheet.addRow([
    'Tip: selecteer de tabel hierboven en kies "Invoegen → Grafiek" om te visualiseren.',
  ]);
  note.font = { italic: true, color: { argb: 'FF9CA3AF' }, size: 9 };
}

function writeFunnel(
  sheet: ExcelJS.Worksheet,
  block: FunnelAggregateResult,
  primaryHex: string
): void {
  if (block.title) {
    const t = sheet.addRow([block.title]);
    t.font = { bold: true, size: 12 };
    sheet.addRow([]);
  }
  const header = sheet.addRow(['Stage', 'Aantal', 'Conversie (%)']);
  styleHeaderRow(header, primaryHex);
  for (const stage of block.stages) {
    sheet.addRow([
      stage.stage,
      stage.count,
      stage.conversion_pct === null ? null : Number(stage.conversion_pct.toFixed(1)),
    ]);
  }
}

function writePie(
  sheet: ExcelJS.Worksheet,
  block: PieAggregateResult,
  primaryHex: string
): void {
  if (block.title) {
    const t = sheet.addRow([block.title]);
    t.font = { bold: true, size: 12 };
    sheet.addRow([]);
  }
  const header = sheet.addRow(['Categorie', block.metric_label, 'Aandeel (%)']);
  styleHeaderRow(header, primaryHex);
  for (const slice of block.slices) {
    sheet.addRow([
      slice.label,
      slice.value,
      slice.pct === null ? null : Number(slice.pct.toFixed(1)),
    ]);
  }
}

function formatNumber(n: number | null | undefined): number | string | null {
  if (n === null || n === undefined) return null;
  if (Number.isInteger(n)) return n;
  return Number(n.toFixed(2));
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

/**
 * Bouw een complete xlsx-buffer voor een rapport-run.
 *
 * @param reportName    Display-naam voor cover + Excel "Title" property
 * @param config        ReportConfig die werd uitgevoerd (voor periode-info)
 * @param blockResults  Aggregator-output, één entry per block in `config`
 * @param options       Optionele branding + AI-disclosure
 */
export async function reportToExcelBuffer(
  reportName: string,
  config: ReportConfig,
  blockResults: AggregateResult[],
  options: ExcelExportOptions = {}
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = options.branding?.brand_name ?? 'TalentFlow';
  wb.created = new Date();
  wb.title = reportName;
  wb.subject = 'Custom Report Export';

  const primary = hex(options.branding?.primary_color, DEFAULT_PRIMARY);
  const accent = hex(options.branding?.accent_color, DEFAULT_ACCENT);
  const brandName = options.branding?.brand_name ?? 'TalentFlow';

  // ── Summary-sheet: cover + alle KPI-blokken bij elkaar ──────────────────
  const summary = wb.addWorksheet('Samenvatting');
  const titleRow = summary.addRow([reportName]);
  titleRow.font = { bold: true, size: 18, color: { argb: `FF${primary}` } };
  summary.addRow([`Periode: ${describeDateRange(config)}`]).font = {
    italic: true,
    color: { argb: 'FF6B7280' },
  };
  summary.addRow([]);

  // Verzamel alle KPIs voor het Summary-sheet zodat recruiters een one-glance
  // overview hebben — non-KPI blocks staan in eigen sheets.
  const kpiBlocks = blockResults.filter(
    (b): b is KpiAggregateResult => b.block_type === 'kpi'
  );

  if (kpiBlocks.length > 0) {
    const kpiHeader = summary.addRow(['Indicator', 'Waarde', 'Vorige periode', 'Δ %']);
    styleHeaderRow(kpiHeader, primary);
    for (const k of kpiBlocks) {
      summary.addRow([
        k.title ?? k.metric_label,
        k.value === null
          ? '—'
          : k.metric_unit
            ? `${formatNumber(k.value)} ${k.metric_unit}`
            : formatNumber(k.value),
        k.comparison_value === undefined || k.comparison_value === null
          ? '—'
          : formatNumber(k.comparison_value),
        k.comparison_delta_pct === undefined || k.comparison_delta_pct === null
          ? '—'
          : `${k.comparison_delta_pct >= 0 ? '+' : ''}${k.comparison_delta_pct.toFixed(1)}%`,
      ]);
    }
  } else {
    summary.addRow(['Geen KPI-blokken in dit rapport.']).font = {
      italic: true,
      color: { argb: 'FF9CA3AF' },
    };
  }

  // Index van alle blokken (verwijzing naar sheet-namen)
  summary.addRow([]);
  summary.addRow([]);
  const indexHeader = summary.addRow(['#', 'Type', 'Titel', 'Tabblad']);
  styleHeaderRow(indexHeader, accent);
  blockResults.forEach((b, i) => {
    const sheetName = sheetNameFor(b, i);
    summary.addRow([i + 1, b.block_type, b.title ?? '—', sheetName]);
  });

  writeFooter(summary, brandName, options.ai_disclosure);
  autoFitColumns(summary);

  // ── Per-block sheets ────────────────────────────────────────────────────
  blockResults.forEach((block, i) => {
    if (block.block_type === 'kpi') {
      // KPIs zitten al in Summary — sla eigen sheet over om duplicatie te vermijden
      // tenzij ze een uitgebreide titel hebben en de gebruiker een per-block-sheet
      // verwacht. We nemen ze toch op zodat de "Tabblad"-index in Summary klopt.
      const sheet = wb.addWorksheet(sheetNameFor(block, i));
      writeKpi(sheet, block, primary, accent);
      writeFooter(sheet, brandName, options.ai_disclosure);
      autoFitColumns(sheet);
      return;
    }
    const sheet = wb.addWorksheet(sheetNameFor(block, i));
    switch (block.block_type) {
      case 'table':
        writeTable(sheet, block, primary);
        break;
      case 'bar':
      case 'line':
        writeChart(sheet, block, primary);
        break;
      case 'funnel':
        writeFunnel(sheet, block, primary);
        break;
      case 'pie':
        writePie(sheet, block, primary);
        break;
    }
    writeFooter(sheet, brandName, options.ai_disclosure);
    autoFitColumns(sheet);
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function sheetNameFor(block: AggregateResult, index: number): string {
  // Excel sheet-namen: max 31 chars, geen / \ ? * [ ]
  const base = block.title
    ? `${index + 1}. ${block.title}`
    : `Block ${index + 1} — ${block.block_type}`;
  return sanitizeSheetName(base);
}

function sanitizeSheetName(input: string): string {
  let s = input.replace(/[\\\/?*\[\]]/g, ' ').trim();
  if (s.length > 31) s = s.slice(0, 28) + '...';
  return s.length === 0 ? 'Sheet' : s;
}
