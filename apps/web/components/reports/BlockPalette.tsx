"use client";

/**
 * BlockPalette — left rail of the report builder.
 *
 * Two sections:
 *   1. Block-types (6 buttons → click to append a block with default config)
 *   2. "Snelle templates" — 5 system-template shortcuts that REPLACE the
 *      whole config when applied (with confirm).
 */

import {
  BarChart3,
  Hash,
  LineChart as LineIcon,
  PieChart as PieIcon,
  Sigma,
  Sparkles,
  Table2,
  type LucideIcon,
} from "lucide-react";
import {
  BLOCK_TYPE_DESCRIPTIONS,
  BLOCK_TYPE_LABELS,
  type BlockType,
  type SystemTemplate,
} from "@/lib/types/reports";

interface BlockEntry {
  type: BlockType;
  Icon: LucideIcon;
}

const PALETTE: BlockEntry[] = [
  { type: "kpi", Icon: Hash },
  { type: "table", Icon: Table2 },
  { type: "bar", Icon: BarChart3 },
  { type: "line", Icon: LineIcon },
  { type: "funnel", Icon: Sigma },
  { type: "pie", Icon: PieIcon },
];

export interface BlockPaletteProps {
  onAddBlock: (type: BlockType) => void;
  onPickTemplate: (template: SystemTemplate) => void;
  templates: SystemTemplate[] | undefined;
}

export function BlockPalette({
  onAddBlock,
  onPickTemplate,
  templates,
}: BlockPaletteProps) {
  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-r border-border bg-zinc-50/40 dark:bg-zinc-900/40">
      <div className="px-4 py-4">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Blokken
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Klik om toe te voegen.
        </p>
        <div className="space-y-1.5">
          {PALETTE.map(({ type, Icon }) => (
            <button
              key={type}
              type="button"
              onClick={() => onAddBlock(type)}
              className="group flex w-full items-start gap-3 rounded-lg border border-transparent bg-white px-3 py-2.5 text-left shadow-sm transition-all hover:border-indigo-200 hover:bg-indigo-50/40 hover:shadow dark:bg-zinc-950 dark:hover:bg-indigo-950/30"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-indigo-100 text-indigo-600 group-hover:bg-indigo-500 group-hover:text-white dark:bg-indigo-950/60 dark:text-indigo-300">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {BLOCK_TYPE_LABELS[type]}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {BLOCK_TYPE_DESCRIPTIONS[type]}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-border px-4 py-4">
        <h2 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          Snelle templates
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Vervangt huidige config.
        </p>
        <div className="space-y-1.5">
          {(templates ?? []).map((tpl) => (
            <button
              key={tpl.key}
              type="button"
              onClick={() => onPickTemplate(tpl)}
              className="block w-full rounded-lg border border-transparent bg-white px-3 py-2.5 text-left shadow-sm transition-all hover:border-purple-200 hover:bg-purple-50/40 dark:bg-zinc-950 dark:hover:bg-purple-950/30"
            >
              <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {tpl.name}
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {tpl.description}
              </span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
