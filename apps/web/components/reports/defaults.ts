import type {
  BarBlockConfig,
  BlockConfig,
  BlockType,
  FunnelBlockConfig,
  KpiBlockConfig,
  LineBlockConfig,
  PieBlockConfig,
  ReportBlock,
  TableBlockConfig,
} from "@/lib/types/reports";

export function makeBlockId(): string {
  return `blk-${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultConfigForType(type: BlockType): BlockConfig {
  switch (type) {
    case "kpi":
      return {
        metric: "applications_count",
        comparison: "previous_period",
      } satisfies KpiBlockConfig;
    case "table":
      return {
        rows: ["recruiter"],
        metric: "applications_count",
        sort_by: "metric_desc",
        show_totals: true,
      } satisfies TableBlockConfig;
    case "bar":
      return {
        x: "month",
        series: ["applications_count"],
        stacked: false,
      } satisfies BarBlockConfig;
    case "line":
      return {
        x: "month",
        series: ["applications_count", "hires_count"],
      } satisfies LineBlockConfig;
    case "funnel":
      return {
        stages: ["Nieuw", "Screening", "Interview", "Offer", "Hired"],
      } satisfies FunnelBlockConfig;
    case "pie":
      return {
        metric: "applications_count",
        group_by: "source",
        limit: 6,
      } satisfies PieBlockConfig;
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

export function makeBlock(type: BlockType): ReportBlock {
  return {
    id: makeBlockId(),
    type,
    title: defaultTitleForType(type),
    config: defaultConfigForType(type),
  };
}
