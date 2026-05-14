"use client";

/**
 * CanvasBlock — sortable block on the builder canvas.
 *
 * Wraps the BlockRenderer with:
 *   - drag-handle (top-left, @dnd-kit useSortable)
 *   - block-type label
 *   - delete button
 *   - selection highlight
 *   - click-overlay so children don't capture clicks
 */

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BLOCK_TYPE_LABELS,
  type BlockResult,
  type ReportBlock,
} from "@/lib/types/reports";
import { BlockRenderer } from "./blocks/BlockRenderer";

export interface CanvasBlockProps {
  block: ReportBlock;
  result?: BlockResult;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

export function CanvasBlock({
  block,
  result,
  selected,
  onSelect,
  onDelete,
}: CanvasBlockProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={cn(
        "group relative cursor-pointer rounded-xl border bg-white shadow-sm transition-all dark:bg-zinc-950",
        selected
          ? "border-indigo-500 ring-2 ring-indigo-500/30"
          : "border-zinc-200 hover:border-indigo-300 dark:border-zinc-800"
      )}
      data-block-id={block.id}
    >
      {/* Top toolbar */}
      <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50/80 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900/60">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Versleep blok"
          onClick={(e) => e.stopPropagation()}
          className="flex h-6 w-6 cursor-grab items-center justify-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 active:cursor-grabbing dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          {BLOCK_TYPE_LABELS[block.type]}
        </span>
        {block.title && (
          <span className="truncate text-xs text-muted-foreground">
            · {block.title}
          </span>
        )}
        <span className="ml-auto" />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="Blok verwijderen"
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Renderer (no border/shadow so the canvas wrapper provides it) */}
      <div className="p-3">
        <div className="pointer-events-none [&>div]:!border-0 [&>div]:!shadow-none [&>div]:!p-3">
          <BlockRenderer block={block} result={result} />
        </div>
      </div>
    </div>
  );
}
