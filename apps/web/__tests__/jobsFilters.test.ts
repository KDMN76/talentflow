import { describe, it, expect } from "vitest";
import {
  buildQueryString,
  parseFromSearchParams,
  countActive,
  JOBS_FILTERS_DEFAULTS,
  type JobsFilters,
} from "@/hooks/useJobsFilters";

const base = (): JobsFilters => ({ ...JOBS_FILTERS_DEFAULTS });

describe("countActive", () => {
  it("returns 0 for the default (unfiltered) state", () => {
    expect(countActive(base())).toBe(0);
  });

  it("does NOT count sort as an active filter", () => {
    // Sorting is a view preference, not a filter — it must not inflate the
    // reset badge (FIX B / P1-7).
    const f: JobsFilters = { ...base(), sort: "title_az" };
    expect(countActive(f)).toBe(0);
  });

  it("counts real filters but keeps ignoring sort when combined", () => {
    const f: JobsFilters = {
      ...base(),
      status: "open",
      sort: "oldest",
      tags: ["react"],
    };
    // status (1) + tags (1) = 2; sort excluded.
    expect(countActive(f)).toBe(2);
  });

  it("counts a non-empty tags selection as one active filter", () => {
    const f: JobsFilters = { ...base(), tags: ["react", "vue"] };
    expect(countActive(f)).toBe(1);
  });
});

describe("tags URL round-trip", () => {
  it("serialises tags as a comma-separated param and parses them back", () => {
    const f: JobsFilters = { ...base(), tags: ["react", "node", "aws"] };
    const qs = buildQueryString(f);
    // URLSearchParams encodes the comma separator as %2C.
    expect(qs).toContain("tags=react%2Cnode%2Caws");

    const parsed = parseFromSearchParams(new URLSearchParams(qs));
    expect(parsed.tags).toEqual(["react", "node", "aws"]);
  });

  it("omits tags from the URL when the selection is empty", () => {
    const qs = buildQueryString(base());
    expect(qs).not.toContain("tags=");
  });

  it("trims whitespace and drops empty tokens on parse", () => {
    const parsed = parseFromSearchParams(
      new URLSearchParams("tags=react%2C%20%2Cnode")
    );
    expect(parsed.tags).toEqual(["react", "node"]);
  });

  it("round-trips sort alongside tags without counting sort", () => {
    const f: JobsFilters = {
      ...base(),
      sort: "most_applicants",
      tags: ["react"],
    };
    const parsed = parseFromSearchParams(
      new URLSearchParams(buildQueryString(f))
    );
    expect(parsed.sort).toBe("most_applicants");
    expect(parsed.tags).toEqual(["react"]);
    expect(countActive(parsed)).toBe(1); // only tags; sort excluded
  });
});
