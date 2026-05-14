"use client";

/**
 * CanvasBlock — single sortable block on the builder canvas.
 *
 * Wraps a public block-renderer (read-only preview) with:
 *   - a click-overlay that swallows interactive events and selects the block
 *   - a drag-handle (top-left) wired up via @dnd-kit's useSortable
 *   - a delete button (top-right)
 *   - selection highlight (ring) when selected
 */

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import type { CareerPageBlock } from "@/hooks/useCareerPages";
import type { PublicBranding, PublicJob, Locale } from "@/components/career-public/types";
import { builderBlockToPublicBlock } from "./configToData";
import { PublicHeroBlock } from "@/components/career-public/blocks/PublicHeroBlock";
import { PublicFeaturesBlock } from "@/components/career-public/blocks/PublicFeaturesBlock";
import { PublicJobsListBlock } from "@/components/career-public/blocks/PublicJobsListBlock";
import { PublicAboutBlock } from "@/components/career-public/blocks/PublicAboutBlock";
import { PublicTestimonialsBlock } from "@/components/career-public/blocks/PublicTestimonialsBlock";
import { PublicCtaBlock } from "@/components/career-public/blocks/PublicCtaBlock";
import { PublicFooterBlock } from "@/components/career-public/blocks/PublicFooterBlock";
import { PublicCustomHtmlBlock } from "@/components/career-public/blocks/PublicCustomHtmlBlock";

const BLOCK_TYPE_LABELS: Record<string, string> = {
  hero: "Hero",
  features: "Features",
  jobs_list: "Vacatures",
  about: "Over ons",
  testimonials: "Reviews",
  cta: "CTA",
  footer: "Footer",
  custom_html: "Custom HTML",
};

export interface CanvasBlockProps {
  block: CareerPageBlock;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  branding: PublicBranding;
  jobs: PublicJob[];
  locale: Locale;
  slug: string;
  careerPageId: string;
}

export function CanvasBlock({
  block,
  selected,
  onSelect,
  onDelete,
  branding,
  jobs,
  locale,
  slug,
  careerPageId,
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

  const publicBlock = builderBlockToPublicBlock(block);
  const rendererProps = {
    block: publicBlock,
    jobs,
    branding,
    locale,
    slug,
    careerPageId,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`group relative cursor-pointer rounded-xl border bg-white shadow-sm transition-all ${
        selected
          ? "border-indigo-500 ring-2 ring-indigo-500/30"
          : "border-zinc-200 hover:border-indigo-300"
      }`}
      data-block-id={block.id}
    >
      {/* Top toolbar: drag-handle + label + delete */}
      <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50/80 px-3 py-2 text-xs">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Versleep blok"
          onClick={(e) => e.stopPropagation()}
          className="flex h-6 w-6 cursor-grab items-center justify-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          {BLOCK_TYPE_LABELS[block.type] ?? block.type}
        </span>
        <span className="ml-auto" />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="Blok verwijderen"
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Preview — public renderer wrapped in a click-trap overlay */}
      <div className="relative overflow-hidden rounded-b-xl">
        <div className="pointer-events-none [&_*]:pointer-events-none">
          <RendererSwitch type={block.type} props={rendererProps} />
        </div>
        {/* Faux-disabled overlay — swallows clicks so block-selection wins
            over any anchor/button inside the public renderer. */}
        <div className="absolute inset-0" aria-hidden />
      </div>
    </div>
  );
}

function RendererSwitch({
  type,
  props,
}: {
  type: string;
  // The public block-renderer expects fully-typed BlockRendererProps.
  // We've already adapted via builderBlockToPublicBlock so the shape is correct.
  props: Parameters<typeof PublicHeroBlock>[0];
}) {
  switch (type) {
    case "hero":
      return <PublicHeroBlock {...props} />;
    case "features":
      return <PublicFeaturesBlock {...props} />;
    case "jobs_list":
      return <PublicJobsListBlock {...props} />;
    case "about":
      return <PublicAboutBlock {...props} />;
    case "testimonials":
      return <PublicTestimonialsBlock {...props} />;
    case "cta":
      return <PublicCtaBlock {...props} />;
    case "footer":
      return <PublicFooterBlock {...props} />;
    case "custom_html":
      return <PublicCustomHtmlBlock {...props} />;
    default:
      return (
        <div className="px-6 py-12 text-center text-sm text-muted-foreground">
          Onbekend bloktype: {type}
        </div>
      );
  }
}
