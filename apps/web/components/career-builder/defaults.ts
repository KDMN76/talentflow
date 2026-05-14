/**
 * Default block-config helper for the career-page builder.
 *
 * This is a thin facade over `defaultConfigForType` in `./templates.ts`, kept
 * as a separate module so the builder UI has a single, predictable import
 * surface for "give me a sensible default config for block type X".
 *
 * Sprint Q2.2 — agent LL.
 */

import {
  defaultConfigForType,
  makeBlock,
  newBlockId,
} from "./templates";
import type {
  CareerPageBlock,
  CareerPageBlockType,
  CareerPageBlockConfig,
} from "@/hooks/useCareerPages";

/**
 * Returns the default config object for a given block-type. Use this when
 * adding a new block from the BlockPalette so the canvas immediately renders
 * something meaningful instead of an empty placeholder.
 */
export function defaultBlockConfig(
  type: CareerPageBlockType
): CareerPageBlockConfig {
  return defaultConfigForType(type);
}

/** Re-exports so callers can pull everything from one place. */
export { makeBlock, newBlockId };
export type { CareerPageBlock, CareerPageBlockType, CareerPageBlockConfig };
