"use client";

/**
 * BlockPalette — left sidebar of the career-page builder.
 *
 * Eight buttons (one per block-type). Click adds a block with default config
 * to the end of the canvas. Drag-from-palette is intentionally out of scope
 * for the MVP — the canvas itself uses @dnd-kit for reordering.
 */

import {
  Image as ImageIcon,
  Grid3x3,
  Briefcase,
  FileText,
  Quote,
  MousePointerClick,
  PanelBottom,
  Code,
  type LucideIcon,
} from "lucide-react";
import type { CareerPageBlockType } from "@/hooks/useCareerPages";

interface PaletteEntry {
  type: CareerPageBlockType;
  label: string;
  description: string;
  Icon: LucideIcon;
}

const PALETTE: PaletteEntry[] = [
  { type: "hero", label: "Hero", description: "Grote koptekst + CTA", Icon: ImageIcon },
  { type: "features", label: "Features", description: "Lijst met USP's", Icon: Grid3x3 },
  { type: "jobs_list", label: "Vacatures", description: "Open vacatures tonen", Icon: Briefcase },
  { type: "about", label: "Over ons", description: "Tekst & beeld", Icon: FileText },
  { type: "testimonials", label: "Reviews", description: "Quotes van team", Icon: Quote },
  { type: "cta", label: "CTA", description: "Tekst met knop", Icon: MousePointerClick },
  { type: "footer", label: "Footer", description: "Copyright + links", Icon: PanelBottom },
  { type: "custom_html", label: "Custom HTML", description: "Eigen HTML-snippet", Icon: Code },
];

export interface BlockPaletteProps {
  onAddBlock: (type: CareerPageBlockType) => void;
}

export function BlockPalette({ onAddBlock }: BlockPaletteProps) {
  return (
    <aside className="w-64 shrink-0 border-r border-border bg-zinc-50/40 dark:bg-zinc-900/40">
      <div className="sticky top-0 px-4 py-4">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Blokken
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Klik om toe te voegen.
        </p>
        <div className="space-y-1.5">
          {PALETTE.map(({ type, label, description, Icon }) => (
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
                  {label}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {description}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
