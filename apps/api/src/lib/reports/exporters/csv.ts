/**
 * CSV exporter voor Custom Reports — Sprint Q3.5 (Agent GGG).
 *
 * Hergebruikt het escape-patroon uit `modules/exports/exports.service.ts`
 * (Q1.2) zodat één CSV-dialect consistent is over de hele applicatie:
 *  - UTF-8 BOM (﻿) zodat Excel onder NL-locale diacritics niet sloopt
 *  - RFC 4180 quoting — wrap in `"` zodra een waarde `"`, `,`, `\n` of `\r`
 *    bevat, en double-up bestaande `"`.
 *
 * Output-layout: één bestand met meerdere "secties" — per block één sectie.
 * Secties zijn gescheiden door 2 lege regels zodat Excel/Sheets ze als
 * losse blokken inleest na een Text-to-Columns import. Voor recruiters die
 * slechts één blok exporteren is dit identiek aan een gewoon CSV-bestand.
 *
 * Per block-type:
 *  - kpi    → label/value pair (1 datarij)
 *  - table  → headers + rows direct uit AggregateResult
 *  - bar/line → headers = [x_label, ...series_labels], 1 rij per X
 *  - funnel → headers = [stage, count, conversion_pct]
 *  - pie    → headers = [label, value, pct]
 */

import type {
  AggregateResult,
  ReportConfig,
  KpiAggregateResult,
  TableAggregateResult,
  ChartAggregateResult,
  FunnelAggregateResult,
  PieAggregateResult,
} from '../configSchema';

// UTF-8 BOM (﻿). Hardcoded i.p.v. import om geen circular dep te krijgen
// met exports.service. Zelfde character, zelfde semantiek.
const UTF8_BOM = '﻿';

/**
 * Escape één CSV-veldwaarde volgens RFC 4180. Identiek aan
 * `escapeCsvField` in `modules/exports/exports.service.ts` — bewust
 * gedupliceerd zodat `lib/reports` geen dependency heeft op een
 * applicatie-module.
 */
function escapeField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (value instanceof Date) {
    s = Number.isNaN(value.getTime()) ? '' : value.toISOString();
  } else if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    s = JSON.stringify(value);
  } else if (typeof value === 'boolean') {
    s = value ? 'true' : 'false';
  } else {
    s = String(value);
  }
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildRows(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return rows.map((row) => row.map(escapeField).join(',')).join('\n');
}

function renderKpi(block: KpiAggregateResult): string {
  const headers = ['Indicator', 'Waarde'];
  const rows: Array<Array<unknown>> = [
    [
      block.title ?? block.metric_label,
      block.metric_unit
        ? `${formatNumber(block.value)} ${block.metric_unit}`
        : formatNumber(block.value),
    ],
  ];
  if (block.comparison_value !== undefined && block.comparison_value !== null) {
    rows.push(['Vorige periode', formatNumber(block.comparison_value)]);
  }
  if (
    block.comparison_delta_pct !== undefined &&
    block.comparison_delta_pct !== null
  ) {
    rows.push(['Verschil (%)', `${block.comparison_delta_pct.toFixed(1)}%`]);
  }
  return [headers.map(escapeField).join(','), buildRows(rows)].join('\n');
}

function renderTable(block: TableAggregateResult): string {
  const header = block.headers.map(escapeField).join(',');
  const body = buildRows(block.rows);
  return body ? `${header}\n${body}` : header;
}

function renderChart(block: ChartAggregateResult): string {
  const headers = [block.x_label, ...block.series_labels];
  const rows = block.points.map((p) => [
    p.x,
    ...block.series_labels.map((l) => p.values[l] ?? null),
  ]);
  return [headers.map(escapeField).join(','), buildRows(rows)].join('\n');
}

function renderFunnel(block: FunnelAggregateResult): string {
  const headers = ['Stage', 'Aantal', 'Conversie (%)'];
  const rows = block.stages.map((s) => [
    s.stage,
    s.count,
    s.conversion_pct === null ? '' : s.conversion_pct.toFixed(1),
  ]);
  return [headers.map(escapeField).join(','), buildRows(rows)].join('\n');
}

function renderPie(block: PieAggregateResult): string {
  const headers = ['Categorie', block.metric_label, 'Aandeel (%)'];
  const rows = block.slices.map((slice) => [
    slice.label,
    slice.value,
    slice.pct === null ? '' : slice.pct.toFixed(1),
  ]);
  return [headers.map(escapeField).join(','), buildRows(rows)].join('\n');
}

function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function renderBlock(block: AggregateResult): string {
  const title = block.title
    ? `# ${block.title}`
    : `# Block ${block.block_id}`;
  let body = '';
  switch (block.block_type) {
    case 'kpi':
      body = renderKpi(block);
      break;
    case 'table':
      body = renderTable(block);
      break;
    case 'bar':
    case 'line':
      body = renderChart(block);
      break;
    case 'funnel':
      body = renderFunnel(block);
      break;
    case 'pie':
      body = renderPie(block);
      break;
  }
  return `${title}\n${body}`;
}

/**
 * Build a single CSV-buffer voor een hele rapport-run.
 *
 * Caller verantwoordelijk voor Content-Disposition/headers — we returnen
 * een `Buffer` zodat Express dit direct als response kan sturen.
 */
export function reportToCsvBuffer(
  reportName: string,
  config: ReportConfig,
  blockResults: AggregateResult[]
): Buffer {
  const generatedAt = new Date().toISOString();
  const dateRange = describeDateRange(config);

  const sections: string[] = [];

  // Cover-sectie als eerste blok zodat downstream tooling (Power BI,
  // Sheets-import) altijd metadata ziet voordat de data begint.
  sections.push(
    [
      '# Rapport',
      `Naam,${escapeField(reportName)}`,
      `Gegenereerd op,${escapeField(generatedAt)}`,
      `Periode,${escapeField(dateRange)}`,
      `Aantal blocks,${blockResults.length}`,
    ].join('\n')
  );

  for (const block of blockResults) {
    sections.push(renderBlock(block));
  }

  // Footer — vrije tekst sectie. Twee lege regels tussen secties zodat
  // Excel "Text to columns" of LibreOffice de blokken makkelijk separeert.
  sections.push(
    [
      '# Voetnoot',
      'Bron,TalentFlow',
      'AI-disclosure,Aggregaties zijn deterministisch berekend uit RLS-veilige bronnen.',
    ].join('\n')
  );

  const csv = `${UTF8_BOM}${sections.join('\n\n\n')}\n`;
  return Buffer.from(csv, 'utf8');
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
