/**
 * Default block factories for the builder palette.
 *
 * Metric/dimension objects mirror the backend whitelist
 * (apps/api/src/lib/reports/configSchema.ts — AVAILABLE_METRICS /
 * AVAILABLE_DIMENSIONS). Only `key` is validated server-side; entity + label
 * ride along for display.
 */

import type {
  BlockSize,
  BlockType,
  ReportBlock,
  ReportBlockEntry,
  ReportDimension,
  ReportMetric,
} from "@/lib/types/reports";

export function makeBlockId(): string {
  return `blk-${Math.random().toString(36).slice(2, 10)}`;
}

// Known-safe catalogue entries (backend whitelist).
const M = {
  applicationCount: {
    key: "application_count",
    entity: "applications",
    label: "Aantal sollicitaties",
  },
  hireCount: {
    key: "hire_count",
    entity: "applications",
    label: "Aantal hires",
  },
} satisfies Record<string, ReportMetric>;

const D = {
  source: { key: "source", entity: "candidates", label: "Bron" },
  dateMonth: { key: "date_month", entity: "applications", label: "Maand" },
  recruiter: { key: "recruiter", entity: "recruiters", label: "Recruiter" },
} satisfies Record<string, ReportDimension>;

export function defaultBlockForType(type: BlockType): ReportBlock {
  switch (type) {
    case "kpi":
      return {
        type: "kpi",
        metric: M.applicationCount,
        comparison: "previous_period",
      };
    case "table":
      return {
        type: "table",
        rows: [D.recruiter],
        metric: M.applicationCount,
        sort: { key: "metric", direction: "desc" },
        limit: 50,
      };
    case "bar":
      return {
        type: "bar",
        x: D.source,
        series: [M.applicationCount],
      };
    case "line":
      return {
        type: "line",
        x: D.dateMonth,
        series: [M.applicationCount, M.hireCount],
      };
    case "funnel":
      return {
        type: "funnel",
        entity: "applications",
        stages: ["New Application", "Phone Screen", "Interview", "Offer", "Hired"],
      };
    case "pie":
      return {
        type: "pie",
        metric: M.applicationCount,
        group_by: D.source,
        limit: 6,
      };
  }
}

export function defaultTitleForType(type: BlockType): string {
  switch (type) {
    case "kpi":
      return "Nieuwe KPI";
    case "table":
      return "Nieuwe tabel";
    case "bar":
      return "Nieuw staafdiagram";
    case "line":
      return "Nieuwe lijn";
    case "funnel":
      return "Nieuwe funnel";
    case "pie":
      return "Nieuwe verdeling";
  }
}

export function defaultSizeForType(type: BlockType): BlockSize {
  switch (type) {
    case "kpi":
      return "sm";
    case "pie":
      return "md";
    default:
      return "lg";
  }
}

export function makeBlock(type: BlockType): ReportBlockEntry {
  return {
    id: makeBlockId(),
    title: defaultTitleForType(type),
    size: defaultSizeForType(type),
    block: defaultBlockForType(type),
  };
}
