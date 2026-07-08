/**
 * Unit tests for the public career-page block-resolution logic.
 *
 * Covers the fallback rule: a page without usable blocks resolves to
 * `null` (→ fixed template), while a page with renderable blocks resolves
 * to the ordered, filtered list.
 */

import { describe, expect, it } from "vitest";
import {
  isRenderableBlock,
  resolveCareerBlocks,
  KNOWN_BLOCK_TYPES,
} from "@/app/careers/[slug]/careerBlocks";

const hero = { id: "b1", type: "hero", config: { headline: "Hi" } };
const jobs = { id: "b2", type: "jobs_list", config: { layout: "cards" } };
const cta = { id: "b3", type: "cta", config: { text: "Go" } };

describe("resolveCareerBlocks — fallback signalling", () => {
  it("returns null when config is missing", () => {
    expect(resolveCareerBlocks(undefined)).toBeNull();
    expect(resolveCareerBlocks(null)).toBeNull();
  });

  it("returns null when config is not an object", () => {
    expect(resolveCareerBlocks("nope")).toBeNull();
    expect(resolveCareerBlocks(42)).toBeNull();
  });

  it("returns null when there is no blocks array", () => {
    expect(resolveCareerBlocks({})).toBeNull();
    expect(resolveCareerBlocks({ blocks: "not-an-array" })).toBeNull();
    expect(resolveCareerBlocks({ blocks: {} })).toBeNull();
  });

  it("returns null for an empty blocks array", () => {
    expect(resolveCareerBlocks({ blocks: [] })).toBeNull();
  });

  it("returns null when every block is malformed or unknown", () => {
    const config = {
      blocks: [
        { id: "x", type: "banana", config: {} }, // unknown type
        { id: "y", type: "hero" }, // missing config
        { type: "cta", config: {} }, // missing id
        "garbage",
        null,
      ],
    };
    expect(resolveCareerBlocks(config)).toBeNull();
  });
});

describe("resolveCareerBlocks — rendering path", () => {
  it("returns renderable blocks in their stored order", () => {
    const result = resolveCareerBlocks({ blocks: [hero, jobs, cta] });
    expect(result).not.toBeNull();
    expect(result!.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
    expect(result!.map((b) => b.type)).toEqual(["hero", "jobs_list", "cta"]);
  });

  it("drops malformed / unknown blocks but keeps the valid ones", () => {
    const result = resolveCareerBlocks({
      blocks: [
        hero,
        { id: "bad", type: "mystery", config: {} },
        { id: "nocfg", type: "cta" },
        jobs,
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("accepts every known block type", () => {
    const blocks = KNOWN_BLOCK_TYPES.map((type, i) => ({
      id: `blk-${i}`,
      type,
      config: {},
    }));
    const result = resolveCareerBlocks({ blocks });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(KNOWN_BLOCK_TYPES.length);
  });
});

describe("isRenderableBlock", () => {
  it("accepts a well-formed block", () => {
    expect(isRenderableBlock(hero)).toBe(true);
  });

  it("rejects non-objects and missing fields", () => {
    expect(isRenderableBlock(null)).toBe(false);
    expect(isRenderableBlock("x")).toBe(false);
    expect(isRenderableBlock({ id: "", type: "hero", config: {} })).toBe(false);
    expect(isRenderableBlock({ id: "a", type: "hero", config: null })).toBe(false);
    expect(isRenderableBlock({ id: "a", type: "nope", config: {} })).toBe(false);
  });
});
