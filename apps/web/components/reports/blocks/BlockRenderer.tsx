"use client";

import type {
  BlockResult,
  ChartResult,
  FunnelResult,
  KpiResult,
  PieResult,
  ReportBlockEntry,
  TableResult,
} from "@/lib/types/reports";
import { BarBlock } from "./BarBlock";
import { FunnelBlock } from "./FunnelBlock";
import { KpiBlock } from "./KpiBlock";
import { LineBlock } from "./LineBlock";
import { PieBlock } from "./PieBlock";
import { TableBlock } from "./TableBlock";

export interface BlockRendererProps {
  entry: ReportBlockEntry;
  result?: BlockResult;
}

/**
 * Single dispatcher that renders the right block-type for the given entry.
 * Used both inside the builder (with a placeholder when no result) and inside
 * the embed/run views (with a real result).
 */
export function BlockRenderer({ entry, result }: BlockRendererProps) {
  const placeholder = !result;
  const block = entry.block;

  switch (block.type) {
    case "kpi":
      return (
        <KpiBlock
          title={entry.title}
          config={block}
          result={result as KpiResult | undefined}
          placeholder={placeholder}
        />
      );
    case "table":
      return (
        <TableBlock
          title={entry.title}
          config={block}
          result={result as TableResult | undefined}
          placeholder={placeholder}
        />
      );
    case "bar":
      return (
        <BarBlock
          title={entry.title}
          config={block}
          result={result as ChartResult | undefined}
          placeholder={placeholder}
        />
      );
    case "line":
      return (
        <LineBlock
          title={entry.title}
          config={block}
          result={result as ChartResult | undefined}
          placeholder={placeholder}
        />
      );
    case "funnel":
      return (
        <FunnelBlock
          title={entry.title}
          config={block}
          result={result as FunnelResult | undefined}
          placeholder={placeholder}
        />
      );
    case "pie":
      return (
        <PieBlock
          title={entry.title}
          config={block}
          result={result as PieResult | undefined}
          placeholder={placeholder}
        />
      );
    default:
      return (
        <div className="rounded-xl border border-dashed border-zinc-200 p-6 text-sm text-muted-foreground">
          Onbekend bloktype
        </div>
      );
  }
}
