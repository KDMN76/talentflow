/**
 * Unit tests for the pipeline list view's client-side sort + stage-filter
 * helpers (components/pipeline/pipelineData.ts).
 *
 * These are pure functions over the already-loaded application list, so they
 * are fully deterministic and testable outside the browser.
 */

import { describe, expect, it } from "vitest";
import {
  candidateScore,
  filterApplicationsByStages,
  nextSortState,
  sortApplications,
  type SortState,
} from "@/components/pipeline/pipelineData";
import type { Application, PipelineStage } from "@/lib/mockData";

const stages: PipelineStage[] = [
  { id: "s1", job_id: "j", name: "Sourced", color: "#000", position: 0 },
  { id: "s2", job_id: "j", name: "Interview", color: "#111", position: 1 },
  { id: "s3", job_id: "j", name: "Hired", color: "#222", position: 2 },
];

function makeApp(over: Partial<Application>): Application {
  return {
    id: "a",
    candidate_id: "c",
    job_id: "j",
    stage_id: "s1",
    applied_at: "2024-01-01T00:00:00.000Z",
    status: "active",
    ...over,
  } as Application;
}

const ids = (apps: Application[]) => apps.map((a) => a.id);

describe("sortApplications — candidate name (locale-aware nl)", () => {
  const apps = [
    makeApp({ id: "chloe", candidate_name: "Chloé" }),
    makeApp({ id: "anna", candidate_name: "anna" }),
    makeApp({ id: "bram", candidate_name: "Bram" }),
  ];

  it("sorts A→Z case-insensitively when ascending", () => {
    const out = sortApplications(apps, stages, {
      column: "candidate",
      direction: "asc",
    });
    expect(ids(out)).toEqual(["anna", "bram", "chloe"]);
  });

  it("reverses to Z→A when descending", () => {
    const out = sortApplications(apps, stages, {
      column: "candidate",
      direction: "desc",
    });
    expect(ids(out)).toEqual(["chloe", "bram", "anna"]);
  });

  it("reads the embedded candidate object as a fallback", () => {
    const out = sortApplications(
      [
        makeApp({ id: "z", candidate: { name: "Zoe" } as never }),
        makeApp({ id: "a", candidate: { name: "Ada" } as never }),
      ],
      stages,
      { column: "candidate", direction: "asc" }
    );
    expect(ids(out)).toEqual(["a", "z"]);
  });
});

describe("sortApplications — stage by pipeline position", () => {
  const apps = [
    makeApp({ id: "hired", stage_id: "s3" }),
    makeApp({ id: "sourced", stage_id: "s1" }),
    makeApp({ id: "interview", stage_id: "s2" }),
  ];

  it("orders by stage position ascending, not alphabetically", () => {
    const out = sortApplications(apps, stages, {
      column: "stage",
      direction: "asc",
    });
    expect(ids(out)).toEqual(["sourced", "interview", "hired"]);
  });

  it("reverses stage order when descending", () => {
    const out = sortApplications(apps, stages, {
      column: "stage",
      direction: "desc",
    });
    expect(ids(out)).toEqual(["hired", "interview", "sourced"]);
  });
});

describe("sortApplications — score (nulls always last)", () => {
  const apps = [
    makeApp({ id: "mid", ai_score: 50 }),
    makeApp({ id: "none", ai_score: null }),
    makeApp({ id: "high", ai_score: 90 }),
    makeApp({ id: "low", ai_score: 10 }),
  ];

  it("ascending: low→high with null at the bottom", () => {
    const out = sortApplications(apps, stages, {
      column: "score",
      direction: "asc",
    });
    expect(ids(out)).toEqual(["low", "mid", "high", "none"]);
  });

  it("descending: high→low with null still at the bottom", () => {
    const out = sortApplications(apps, stages, {
      column: "score",
      direction: "desc",
    });
    expect(ids(out)).toEqual(["high", "mid", "low", "none"]);
  });
});

describe("sortApplications — applied date", () => {
  const apps = [
    makeApp({ id: "new", applied_at: "2024-03-01T00:00:00.000Z" }),
    makeApp({ id: "old", applied_at: "2024-01-01T00:00:00.000Z" }),
    makeApp({ id: "mid", applied_at: "2024-02-01T00:00:00.000Z" }),
  ];

  it("ascending = oldest first", () => {
    const out = sortApplications(apps, stages, {
      column: "applied",
      direction: "asc",
    });
    expect(ids(out)).toEqual(["old", "mid", "new"]);
  });

  it("descending = newest first", () => {
    const out = sortApplications(apps, stages, {
      column: "applied",
      direction: "desc",
    });
    expect(ids(out)).toEqual(["new", "mid", "old"]);
  });

  it("pushes missing/invalid dates to the bottom both ways", () => {
    const withBad = [
      makeApp({ id: "bad", applied_at: "" }),
      makeApp({ id: "good", applied_at: "2024-01-01T00:00:00.000Z" }),
    ];
    expect(
      ids(sortApplications(withBad, stages, { column: "applied", direction: "asc" }))
    ).toEqual(["good", "bad"]);
    expect(
      ids(sortApplications(withBad, stages, { column: "applied", direction: "desc" }))
    ).toEqual(["good", "bad"]);
  });
});

describe("sortApplications — robustness", () => {
  it("does not mutate the input array", () => {
    const apps = [
      makeApp({ id: "b", candidate_name: "B" }),
      makeApp({ id: "a", candidate_name: "A" }),
    ];
    const original = [...apps];
    sortApplications(apps, stages, { column: "candidate", direction: "asc" });
    expect(apps).toEqual(original);
  });

  it("returns the list unchanged when no sort is active", () => {
    const apps = [makeApp({ id: "x" }), makeApp({ id: "y" })];
    expect(sortApplications(apps, stages, null)).toBe(apps);
  });

  it("handles empty and single-element lists without crashing", () => {
    const s: SortState = { column: "score", direction: "asc" };
    expect(sortApplications([], stages, s)).toEqual([]);
    const one = [makeApp({ id: "solo" })];
    expect(ids(sortApplications(one, stages, s))).toEqual(["solo"]);
  });

  it("tolerates missing stages metadata", () => {
    const apps = [
      makeApp({ id: "b", stage_id: "s2" }),
      makeApp({ id: "a", stage_id: "s1" }),
    ];
    // Empty stages → every position falls back to `lastStage`, stable order.
    expect(
      ids(sortApplications(apps, [], { column: "stage", direction: "asc" }))
    ).toEqual(["b", "a"]);
  });
});

describe("candidateScore", () => {
  it("normalises non-finite / missing scores to null", () => {
    expect(candidateScore(makeApp({ ai_score: 42 }))).toBe(42);
    expect(candidateScore(makeApp({ ai_score: null }))).toBeNull();
    expect(candidateScore(makeApp({ ai_score: NaN }))).toBeNull();
    expect(candidateScore(makeApp({}))).toBeNull();
  });
});

describe("filterApplicationsByStages", () => {
  const apps = [
    makeApp({ id: "a1", stage_id: "s1" }),
    makeApp({ id: "a2", stage_id: "s2" }),
    makeApp({ id: "a3", stage_id: "s3" }),
    makeApp({ id: "a4", stage_id: "s1" }),
  ];

  it("returns everything when no stage is selected", () => {
    expect(filterApplicationsByStages(apps, [])).toBe(apps);
  });

  it("keeps only applications in the selected stages", () => {
    expect(ids(filterApplicationsByStages(apps, ["s1"]))).toEqual(["a1", "a4"]);
    expect(ids(filterApplicationsByStages(apps, ["s1", "s3"]))).toEqual([
      "a1",
      "a3",
      "a4",
    ]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterApplicationsByStages(apps, ["nope"])).toEqual([]);
  });
});

describe("nextSortState — header click state machine", () => {
  it("starts ascending on a fresh column", () => {
    expect(nextSortState(null, "score")).toEqual({
      column: "score",
      direction: "asc",
    });
  });

  it("flips direction when the same column is clicked again", () => {
    expect(nextSortState({ column: "score", direction: "asc" }, "score")).toEqual(
      { column: "score", direction: "desc" }
    );
    expect(
      nextSortState({ column: "score", direction: "desc" }, "score")
    ).toEqual({ column: "score", direction: "asc" });
  });

  it("resets to ascending when switching columns", () => {
    expect(
      nextSortState({ column: "score", direction: "desc" }, "candidate")
    ).toEqual({ column: "candidate", direction: "asc" });
  });
});
