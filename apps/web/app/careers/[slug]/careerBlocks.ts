/**
 * Pure block-resolution logic for the public career-page.
 *
 * The builder stores its blocks under `career_page.config.blocks` (see
 * `career-pages.service.ts` — `updateCareerPageBlocks` writes to
 * `config.blocks` via `jsonb_set`). The public page renders those blocks
 * in order when they exist and are renderable; otherwise it falls back to
 * the fixed template.
 *
 * This module is deliberately free of React / Next imports so it can be
 * unit-tested in isolation (see `__tests__/careerBlocks.test.ts`). Only
 * `import type` is used, which is fully erased at runtime.
 */

import type {
  CareerPageBlock,
  CareerPageBlockType,
} from "@/hooks/useCareerPages";

/**
 * Block types the public renderer knows how to draw. Anything outside this
 * set is treated as non-renderable so a newer builder can add block types
 * without an older published page crashing (forward-compat).
 *
 * Keep in sync with `BlockRenderer` / `career-public/blocks/*` and the
 * switch in `careers/[slug]/page.tsx`.
 */
export const KNOWN_BLOCK_TYPES: readonly CareerPageBlockType[] = [
  "hero",
  "features",
  "jobs_list",
  "about",
  "testimonials",
  "cta",
  "footer",
  "custom_html",
];

const KNOWN_SET = new Set<string>(KNOWN_BLOCK_TYPES);

/**
 * Type-guard: a value is a renderable block when it has a string id, a
 * known string type and an object config. Malformed entries (legacy junk,
 * partially-saved drafts) are rejected so they never reach a renderer.
 */
export function isRenderableBlock(value: unknown): value is CareerPageBlock {
  if (!value || typeof value !== "object") return false;
  const b = value as Record<string, unknown>;
  if (typeof b.id !== "string" || b.id.length === 0) return false;
  if (typeof b.type !== "string" || !KNOWN_SET.has(b.type)) return false;
  if (!b.config || typeof b.config !== "object") return false;
  return true;
}

/**
 * Resolve the ordered list of blocks to render for a public career page.
 *
 * Returns `null` — the signal to fall back to the fixed template — when the
 * page has no usable blocks:
 *   - config is missing / not an object;
 *   - `config.blocks` is absent or not an array;
 *   - the array contains no renderable block after filtering.
 *
 * Otherwise returns the filtered blocks in their stored order.
 */
export function resolveCareerBlocks(config: unknown): CareerPageBlock[] | null {
  if (!config || typeof config !== "object") return null;
  const raw = (config as { blocks?: unknown }).blocks;
  if (!Array.isArray(raw)) return null;
  const blocks = raw.filter(isRenderableBlock);
  return blocks.length > 0 ? blocks : null;
}
