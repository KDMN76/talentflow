import { describe, it, expect } from 'vitest';
import { reportToCsvBuffer } from '../../../src/lib/reports/exporters/csv';
import type {
  AggregateResult,
  ReportConfig,
} from '../../../src/lib/reports/configSchema';

const CONFIG: ReportConfig = {
  date_range: { type: 'last_n_days', days: 30 },
  blocks: [],
};

function csvOf(blocks: AggregateResult[], name = 'Test rapport'): string {
  return reportToCsvBuffer(name, CONFIG, blocks).toString('utf8');
}

describe('reportToCsvBuffer', () => {
  it('start met UTF-8 BOM en een cover-sectie met metadata', () => {
    const csv = csvOf([]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('# Rapport');
    expect(csv).toContain('Naam,Test rapport');
    expect(csv).toContain('Periode,Laatste 30 dagen');
    expect(csv).toContain('Aantal blocks,0');
    expect(csv).toContain('# Voetnoot');
  });

  it('rendert kpi met waarde, vergelijking en delta', () => {
    const csv = csvOf([
      {
        block_id: 'k1',
        block_type: 'kpi',
        title: 'Hires',
        metric_label: 'Aantal hires',
        value: 12,
        comparison_value: 10,
        comparison_delta_pct: 20,
      },
    ]);
    expect(csv).toContain('# Hires');
    expect(csv).toContain('Indicator,Waarde');
    expect(csv).toContain('Hires,12');
    expect(csv).toContain('Vorige periode,10');
    expect(csv).toContain('Verschil (%),20.0%');
  });

  it('rendert table headers + rows en escapet komma/quote per RFC 4180', () => {
    const csv = csvOf([
      {
        block_id: 't1',
        block_type: 'table',
        title: 'Per recruiter',
        headers: ['Recruiter', 'Aantal'],
        rows: [
          ['Jansen, Piet', 5],
          ['Zeg "hoi"', 3],
        ],
      },
    ]);
    expect(csv).toContain('Recruiter,Aantal');
    expect(csv).toContain('"Jansen, Piet",5');
    expect(csv).toContain('"Zeg ""hoi""",3');
  });

  it('rendert bar/line als x-kolom + series-kolommen', () => {
    const csv = csvOf([
      {
        block_id: 'b1',
        block_type: 'bar',
        x_label: 'Bron',
        series_labels: ['Sollicitaties', 'Hires'],
        points: [
          { x: 'LinkedIn', values: { Sollicitaties: 50, Hires: 4 } },
          { x: 'Indeed', values: { Sollicitaties: 30, Hires: null } },
        ],
      },
    ]);
    expect(csv).toContain('Bron,Sollicitaties,Hires');
    expect(csv).toContain('LinkedIn,50,4');
    // null-waarde wordt een lege cel, geen "null"-string.
    expect(csv).toContain('Indeed,30,');
    expect(csv).not.toContain('Indeed,30,null');
  });

  it('rendert funnel met conversie-percentage en lege cel bij null', () => {
    const csv = csvOf([
      {
        block_id: 'f1',
        block_type: 'funnel',
        stages: [
          { stage: 'Applied', count: 100, conversion_pct: 100 },
          { stage: 'Hired', count: 20, conversion_pct: 20 },
          { stage: 'Ghost', count: 0, conversion_pct: null },
        ],
      },
    ]);
    expect(csv).toContain('Stage,Aantal,Conversie (%)');
    expect(csv).toContain('Applied,100,100.0');
    expect(csv).toContain('Hired,20,20.0');
    expect(csv).toContain('Ghost,0,\n');
  });

  it('rendert pie met metric-label als kolomkop', () => {
    const csv = csvOf([
      {
        block_id: 'p1',
        block_type: 'pie',
        metric_label: 'Aantal',
        slices: [
          { label: 'LinkedIn', value: 80, pct: 80 },
          { label: 'Indeed', value: 20, pct: 20 },
        ],
      },
    ]);
    expect(csv).toContain('Categorie,Aantal,Aandeel (%)');
    expect(csv).toContain('LinkedIn,80,80.0');
  });

  it('scheidt meerdere blocks met lege regels (sectie-separator)', () => {
    const csv = csvOf([
      {
        block_id: 'k1',
        block_type: 'kpi',
        metric_label: 'A',
        value: 1,
      },
      {
        block_id: 'k2',
        block_type: 'kpi',
        metric_label: 'B',
        value: 2,
      },
    ]);
    // Twee lege regels tussen secties (join met \n\n\n).
    expect(csv).toContain('\n\n\n# Block k2');
  });

  it('gebruikt custom date-range beschrijving', () => {
    const csv = reportToCsvBuffer(
      'X',
      {
        date_range: { type: 'custom', from: '2026-01-01', to: '2026-03-31' },
        blocks: [],
      },
      []
    ).toString('utf8');
    expect(csv).toContain('Periode,2026-01-01 t/m 2026-03-31');
  });
});
