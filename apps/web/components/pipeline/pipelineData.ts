import type { Application, PipelineStage } from "@/lib/mockData";

/** The four sortable columns of the pipeline list view. */
export type SortColumn = "candidate" | "stage" | "score" | "applied";
export type SortDirection = "asc" | "desc";

export interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

/** Candidate display name, mirroring PipelineListView's resolve(). */
export function candidateName(app: Application): string {
  return app.candidate?.name ?? app.candidate_name ?? "";
}

/** AI score, or null when unknown / not a finite number. */
export function candidateScore(app: Application): number | null {
  const score = app.candidate?.ai_score ?? app.ai_score ?? null;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

/** Applied-at timestamp in ms; NaN when missing or unparseable. */
function appliedTime(app: Application): number {
  if (!app.applied_at) return NaN;
  return new Date(app.applied_at).getTime();
}

/**
 * Header-click state machine: clicking the already-active column flips its
 * direction; clicking a different column starts a fresh ascending sort.
 */
export function nextSortState(
  current: SortState | null,
  column: SortColumn
): SortState {
  if (current && current.column === column) {
    return { column, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { column, direction: "asc" };
}

/**
 * Sort applications for the list view. Pure — returns a new array and never
 * mutates the input. Robust against empty data and missing fields.
 *
 * Sort keys per column:
 *  - candidate: display name, locale-aware (nl), case-insensitive
 *  - stage:     stage position in the pipeline (unknown stages last)
 *  - score:     numeric AI score; null/undefined always at the bottom
 *  - applied:   applied_at date; missing/invalid dates always at the bottom
 */
export function sortApplications(
  applications: Application[],
  stages: PipelineStage[],
  sort: SortState | null
): Application[] {
  // No sort requested, or nothing to reorder: hand back the original ref.
  if (!sort || applications.length < 2) return applications;

  const dir = sort.direction === "asc" ? 1 : -1;

  // Map stage → pipeline position; unknown stages sort after all known ones.
  const stagePosition = new Map<string, number>();
  stages.forEach((s) => stagePosition.set(s.id, s.position));
  const lastStage = stages.length;

  const sorted = applications.slice();

  sorted.sort((a, b) => {
    switch (sort.column) {
      case "candidate":
        return (
          candidateName(a).localeCompare(candidateName(b), "nl", {
            sensitivity: "base",
          }) * dir
        );
      case "stage": {
        const pa = stagePosition.get(a.stage_id) ?? lastStage;
        const pb = stagePosition.get(b.stage_id) ?? lastStage;
        return (pa - pb) * dir;
      }
      case "score": {
        const sa = candidateScore(a);
        const sb = candidateScore(b);
        if (sa === null && sb === null) return 0;
        if (sa === null) return 1; // nulls always last, both directions
        if (sb === null) return -1;
        return (sa - sb) * dir;
      }
      case "applied": {
        const ta = appliedTime(a);
        const tb = appliedTime(b);
        const na = Number.isNaN(ta);
        const nb = Number.isNaN(tb);
        if (na && nb) return 0;
        if (na) return 1; // missing dates always last, both directions
        if (nb) return -1;
        return (ta - tb) * dir;
      }
      default:
        return 0;
    }
  });

  return sorted;
}

/**
 * Keep only applications whose stage is selected. An empty selection means
 * "no stage filter" → every application passes. Pure and crash-safe.
 */
export function filterApplicationsByStages(
  applications: Application[],
  selectedStageIds: string[]
): Application[] {
  if (!selectedStageIds || selectedStageIds.length === 0) return applications;
  const allowed = new Set(selectedStageIds);
  return applications.filter((a) => allowed.has(a.stage_id));
}
