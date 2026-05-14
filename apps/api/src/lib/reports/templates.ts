/**
 * Report Builder — system templates.
 *
 * Sprint Q3.5 (Agent EEE).
 *
 * Vijf gehardcodeerde templates die de UI aanbiedt als startpunt. Het zijn
 * GEEN database-rows; de service-laag exposed ze via `/api/reports/templates`
 * en een tenant kan ze "instantiëren" door /api/reports POST met
 * template_key + de template-config te doen.
 */

import {
  AVAILABLE_DIMENSIONS,
  AVAILABLE_METRICS,
  type ReportConfig,
  type ReportDimension,
  type ReportMetric,
} from './configSchema';

function dim(key: string): ReportDimension {
  const d = AVAILABLE_DIMENSIONS.find((x) => x.key === key);
  if (!d) throw new Error(`Unknown dimension in template: ${key}`);
  return { key: d.key, entity: d.entity, label: d.label };
}

function met(key: string): ReportMetric {
  const m = AVAILABLE_METRICS.find((x) => x.key === key);
  if (!m) throw new Error(`Unknown metric in template: ${key}`);
  return { key: m.key, entity: m.entity, label: m.label, unit: m.unit };
}

export interface SystemTemplate {
  key: 'recruiter' | 'manager' | 'chro' | 'source_of_hire' | 'dei_funnel';
  name: string;
  description: string;
  config: ReportConfig;
}

// ────────────────────────────────────────────────────────────────────────────
// 1) Recruiter Dashboard
// ────────────────────────────────────────────────────────────────────────────

const recruiter: SystemTemplate = {
  key: 'recruiter',
  name: 'Recruiter Dashboard',
  description:
    'Persoonlijke werklijst voor de recruiter: open vacatures, sollicitaties van deze week, eigen hires, funnel en bron-distributie.',
  config: {
    date_range: { type: 'last_n_days', days: 30 },
    blocks: [
      {
        id: 'kpi-open-jobs',
        title: 'Open vacatures',
        size: 'sm',
        block: {
          type: 'kpi',
          metric: met('count'),
          filters: [{ field: 'status', operator: 'equals', value: 'open' }],
        },
      },
      {
        id: 'kpi-applications-week',
        title: 'Sollicitaties (deze week)',
        size: 'sm',
        block: {
          type: 'kpi',
          metric: met('application_count'),
          comparison: 'previous_period',
        },
      },
      {
        id: 'kpi-hires',
        title: 'Hires (periode)',
        size: 'sm',
        block: {
          type: 'kpi',
          metric: met('hire_count'),
          comparison: 'previous_period',
        },
      },
      {
        id: 'funnel-applications',
        title: 'Sollicitatie-funnel',
        size: 'lg',
        block: {
          type: 'funnel',
          entity: 'applications',
          stages: ['New Application', 'Phone Screen', 'Interview', 'Offer', 'Hired'],
        },
      },
      {
        id: 'bar-applications-source',
        title: 'Sollicitaties per bron',
        size: 'md',
        block: {
          type: 'bar',
          x: dim('source'),
          series: [met('application_count')],
        },
      },
    ],
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 2) Manager Dashboard
// ────────────────────────────────────────────────────────────────────────────

const manager: SystemTemplate = {
  key: 'manager',
  name: 'Manager Dashboard',
  description:
    'Team-totalen voor hiring managers: team-prestaties per recruiter, time-to-hire trend, en hires-per-recruiter cross-tab.',
  config: {
    date_range: { type: 'this_quarter' },
    blocks: [
      {
        id: 'kpi-team-hires',
        title: 'Team hires',
        size: 'sm',
        block: {
          type: 'kpi',
          metric: met('hire_count'),
          comparison: 'previous_period',
        },
      },
      {
        id: 'kpi-team-applications',
        title: 'Team sollicitaties',
        size: 'sm',
        block: {
          type: 'kpi',
          metric: met('application_count'),
          comparison: 'previous_period',
        },
      },
      {
        id: 'kpi-team-tth',
        title: 'Gem. time-to-hire (dagen)',
        size: 'sm',
        block: {
          type: 'kpi',
          metric: met('time_to_hire'),
          comparison: 'previous_period',
        },
      },
      {
        id: 'table-recruiters-hires',
        title: 'Recruiters x Hires',
        size: 'lg',
        block: {
          type: 'table',
          rows: [dim('recruiter')],
          metric: met('hire_count'),
          sort: { key: 'metric', direction: 'desc' },
          limit: 50,
        },
      },
      {
        id: 'line-tth-trend',
        title: 'Time-to-hire trend',
        size: 'lg',
        block: {
          type: 'line',
          x: dim('date_month'),
          series: [met('time_to_hire')],
        },
      },
    ],
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 3) CHRO Dashboard
// ────────────────────────────────────────────────────────────────────────────

const chro: SystemTemplate = {
  key: 'chro',
  name: 'CHRO Dashboard',
  description:
    'Strategisch overzicht voor C-level: total hires per kwartaal, hires per afdeling, salaris-trend en time-to-hire ontwikkeling.',
  config: {
    date_range: { type: 'this_quarter' },
    blocks: [
      {
        id: 'kpi-total-hires',
        title: 'Total hires (kwartaal)',
        size: 'sm',
        block: {
          type: 'kpi',
          metric: met('hire_count'),
          comparison: 'previous_year',
        },
      },
      {
        id: 'kpi-tth',
        title: 'Gem. time-to-hire',
        size: 'sm',
        block: {
          type: 'kpi',
          metric: met('time_to_hire'),
          comparison: 'previous_year',
        },
      },
      {
        id: 'kpi-conversion',
        title: 'Sollicitatie → Hire conversie',
        size: 'sm',
        block: {
          type: 'kpi',
          metric: met('conversion'),
          comparison: 'previous_year',
        },
      },
      {
        id: 'pie-department',
        title: 'Hires per afdeling',
        size: 'md',
        block: {
          type: 'pie',
          metric: met('hire_count'),
          group_by: dim('department'),
          limit: 12,
        },
      },
      {
        id: 'bar-salary-trend',
        title: 'Gem. salaris per kwartaal',
        size: 'lg',
        block: {
          type: 'bar',
          x: dim('date_quarter'),
          series: [met('avg_salary')],
        },
      },
    ],
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 4) Source of Hire
// ────────────────────────────────────────────────────────────────────────────

const sourceOfHire: SystemTemplate = {
  key: 'source_of_hire',
  name: 'Source of Hire',
  description:
    'Welke kanalen leveren de meeste én beste hires? Tabel met per bron sollicitaties + hires + conversie, plus pie-chart van hires en bar-chart van Source ROI.',
  config: {
    date_range: { type: 'last_n_days', days: 90 },
    blocks: [
      {
        id: 'table-sources',
        title: 'Bronnen × Sollicitaties × Hires',
        size: 'lg',
        block: {
          type: 'table',
          rows: [dim('source')],
          metric: met('hire_count'),
          sort: { key: 'metric', direction: 'desc' },
          limit: 25,
        },
      },
      {
        id: 'pie-source-hires',
        title: '% Hires per bron',
        size: 'md',
        block: {
          type: 'pie',
          metric: met('hire_count'),
          group_by: dim('source'),
          limit: 10,
        },
      },
      {
        id: 'bar-source-roi',
        title: 'Source ROI (hires/applications %)',
        size: 'lg',
        block: {
          type: 'bar',
          x: dim('source'),
          series: [met('source_roi')],
        },
      },
    ],
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 5) DEI Funnel — anonieme demografische funnel + distributie
// ────────────────────────────────────────────────────────────────────────────

const deiFunnel: SystemTemplate = {
  key: 'dei_funnel',
  name: 'DEI Funnel',
  description:
    'Diversity, Equity & Inclusion: anonieme demografische drop-off per pipeline-stage en distributie over geslacht / land. Geaggregeerd, geen individuele kandidaten.',
  config: {
    date_range: { type: 'last_n_days', days: 180 },
    blocks: [
      {
        id: 'funnel-dei',
        title: 'DEI Funnel (alle kandidaten)',
        size: 'lg',
        block: {
          type: 'funnel',
          entity: 'applications',
          stages: ['New Application', 'Phone Screen', 'Interview', 'Offer', 'Hired'],
        },
      },
      {
        id: 'bar-country-distribution',
        title: 'Distributie per land kandidaat',
        size: 'lg',
        block: {
          type: 'bar',
          x: dim('candidate_country'),
          series: [met('count')],
        },
      },
      {
        id: 'pie-country',
        title: '% Kandidaten per land',
        size: 'md',
        block: {
          type: 'pie',
          metric: met('count'),
          group_by: dim('candidate_country'),
          limit: 15,
        },
      },
    ],
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Public export
// ────────────────────────────────────────────────────────────────────────────

export const SYSTEM_TEMPLATES: ReadonlyArray<SystemTemplate> = [
  recruiter,
  manager,
  chro,
  sourceOfHire,
  deiFunnel,
] as const;

export function getTemplateByKey(key: string): SystemTemplate | null {
  return SYSTEM_TEMPLATES.find((t) => t.key === key) ?? null;
}
