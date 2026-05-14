"use client";

import type {
  BarBlockConfig,
  BarLineResult,
  BlockResult,
  FunnelBlockConfig,
  FunnelResult,
  KpiBlockConfig,
  KpiResult,
  LineBlockConfig,
  PieBlockConfig,
  PieResult,
  ReportBlock,
  TableBlockConfig,
  TableResult,
} from "@/lib/types/reports";
import { BarBlock } from "./BarBlock";
import { FunnelBlock } from "./FunnelBlock";
import { KpiBlock } from "./KpiBlock";
import { LineBlock } from "./LineBlock";
import { PieBlock } from "./PieBlock";
import { TableBlock } from "./TableBlock";

export interface BlockRendererProps {
  block: ReportBlock;
  result?: BlockResult;
}

/**
 * Single dispatcher that renders the right block-type for the given config.
 * Used both inside the builder (with a placeholder when no result) and inside
 * the embed/run views (with a real result).
 */
export function BlockRenderer({ block, result }: BlockRendererProps) {
  const placeholder = !result;

  switch (block.type) {
    case "kpi":
      return (
        <KpiBlock
          title={block.title}
          config={block.config as KpiBlockConfig}
          result={result as KpiResult | undefined}
          placeholder={placeholder}
        />
      );
    case "table":
      return (
        <TableBlock
          title={block.title}
          config={block.config as TableBlockConfig}
          result={result as TableResult | undefined}
          placeholder={placeholder}
        />
      );
    case "bar":
      return (
        <BarBlock
          title={block.title}
          config={block.config as BarBlockConfig}
          result={result as BarLineResult | undefined}
          placeholder={placeholder}
        />
      );
    case "line":
      return (
        <LineBlock
          title={block.title}
          config={block.config as LineBlockConfig}
          result={result as BarLineResult | undefined}
          placeholder={placeholder}
        />
      );
    case "funnel":
      return (
        <FunnelBlock
          title={block.title}
          config={block.config as FunnelBlockConfig}
          result={result as FunnelResult | undefined}
          placeholder={placeholder}
        />
      );
    case "pie":
      return (
        <PieBlock
          title={block.title}
          config={block.config as PieBlockConfig}
          result={result as PieResult | undefined}
          placeholder={placeholder}
        />
      );
    default:
      return (
        <div className="rounded-xl border border-dashed border-zinc-200 p-6 text-sm text-muted-foreground">
          Onbekend bloktype: {(block as ReportBlock).type}
        </div>
      );
  }
}
