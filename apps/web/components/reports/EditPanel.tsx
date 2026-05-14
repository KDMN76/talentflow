"use client";

/**
 * EditPanel — right rail of the report builder.
 *
 * Picks the right type-specific edit panel for the selected block. Also
 * exposes a top-level "Titel" field shared across all block-types.
 */

import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BLOCK_TYPE_LABELS,
  type BarBlockConfig,
  type BlockConfig,
  type DimensionDef,
  type FunnelBlockConfig,
  type KpiBlockConfig,
  type LineBlockConfig,
  type MetricDef,
  type PieBlockConfig,
  type ReportBlock,
  type TableBlockConfig,
} from "@/lib/types/reports";
import { BarEditPanel } from "./edit-panels/BarEditPanel";
import { FunnelEditPanel } from "./edit-panels/FunnelEditPanel";
import { KpiEditPanel } from "./edit-panels/KpiEditPanel";
import { LineEditPanel } from "./edit-panels/LineEditPanel";
import { PieEditPanel } from "./edit-panels/PieEditPanel";
import { TableEditPanel } from "./edit-panels/TableEditPanel";
import { Field, Section } from "./edit-panels/shared";

export interface EditPanelProps {
  block: ReportBlock | null;
  metrics: MetricDef[];
  dimensions: DimensionDef[];
  onChangeTitle: (title: string) => void;
  onChangeConfig: (config: BlockConfig) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function EditPanel({
  block,
  metrics,
  dimensions,
  onChangeTitle,
  onChangeConfig,
  onDelete,
  onClose,
}: EditPanelProps) {
  if (!block) {
    return (
      <aside className="w-96 shrink-0 border-l border-border bg-zinc-50/40 dark:bg-zinc-900/40">
        <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-2 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Geen blok geselecteerd
          </p>
          <p className="text-xs text-muted-foreground">
            Klik een blok in het canvas om te bewerken.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-border bg-zinc-50/40 dark:bg-zinc-900/40">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border bg-white/80 px-4 py-3 dark:bg-zinc-950/60">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Blok
        </span>
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {BLOCK_TYPE_LABELS[block.type]}
        </span>
        <span className="ml-auto" />
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          className="h-7 w-7 text-zinc-400 hover:bg-red-50 hover:text-red-600"
          title="Verwijder blok"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-7 w-7 text-zinc-400 hover:text-zinc-700"
          title="Sluit panel"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <Section title="Titel">
          <Field label="Toon boven het blok">
            <Input
              value={block.title ?? ""}
              onChange={(e) => onChangeTitle(e.target.value)}
              placeholder="Bijv. Sollicitaties per recruiter"
              className="h-9 text-sm"
            />
          </Field>
        </Section>

        {block.type === "kpi" && (
          <KpiEditPanel
            config={block.config as KpiBlockConfig}
            onChange={onChangeConfig}
            metrics={metrics}
            dimensions={dimensions}
          />
        )}
        {block.type === "table" && (
          <TableEditPanel
            config={block.config as TableBlockConfig}
            onChange={onChangeConfig}
            metrics={metrics}
            dimensions={dimensions}
          />
        )}
        {block.type === "bar" && (
          <BarEditPanel
            config={block.config as BarBlockConfig}
            onChange={onChangeConfig}
            metrics={metrics}
            dimensions={dimensions}
          />
        )}
        {block.type === "line" && (
          <LineEditPanel
            config={block.config as LineBlockConfig}
            onChange={onChangeConfig}
            metrics={metrics}
            dimensions={dimensions}
          />
        )}
        {block.type === "funnel" && (
          <FunnelEditPanel
            config={block.config as FunnelBlockConfig}
            onChange={onChangeConfig}
            metrics={metrics}
            dimensions={dimensions}
          />
        )}
        {block.type === "pie" && (
          <PieEditPanel
            config={block.config as PieBlockConfig}
            onChange={onChangeConfig}
            metrics={metrics}
            dimensions={dimensions}
          />
        )}
      </div>
    </aside>
  );
}
