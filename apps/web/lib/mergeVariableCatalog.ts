/**
 * Catalog of merge variables available in email templates and composed
 * emails. Paths follow the dot notation understood by
 * `applyMergeVariables` (see lib/shared/lib/mergeVariables.ts) and are
 * rendered as `{{path}}` placeholders.
 *
 * Used by the `{{`-picker in RichTextEditor / MergeVariableInput.
 */

export interface MergeVariable {
  /** Dot-notated path as used inside {{...}} placeholders. */
  path: string;
  /** Dutch label shown in the picker. */
  label: string;
  /** Display group inside the "Variabelen" section of the picker. */
  group: string;
}

export const MERGE_VARIABLE_CATALOG: MergeVariable[] = [
  { path: "candidate.first_name", label: "Voornaam kandidaat", group: "Kandidaat" },
  { path: "candidate.last_name", label: "Achternaam kandidaat", group: "Kandidaat" },
  { path: "candidate.full_name", label: "Volledige naam", group: "Kandidaat" },
  { path: "candidate.email", label: "E-mail kandidaat", group: "Kandidaat" },
  { path: "job.title", label: "Vacaturetitel", group: "Vacature" },
  { path: "job.location", label: "Locatie vacature", group: "Vacature" },
  { path: "recruiter.name", label: "Naam recruiter", group: "Recruiter" },
  { path: "recruiter.email", label: "E-mail recruiter", group: "Recruiter" },
  { path: "tenant.name", label: "Bedrijfsnaam", group: "Bedrijf" },
];

// ─── Picker items ────────────────────────────────────────────────────────────

/**
 * A single selectable row in the `{{`-picker. Variables insert a literal
 * `{{path}}` placeholder; jobs insert the job title as plain text.
 */
export type MergePickerItem =
  | { kind: "variable"; path: string; label: string }
  | { kind: "job"; title: string };

const MAX_JOB_RESULTS = 12;

/**
 * Build the (flat, ordered) picker item list for a given query: catalog
 * variables first, then matching job titles. Returns an empty list when the
 * query contains braces — that means the caret sits inside/behind an already
 * completed `{{...}}` placeholder and the picker should stay hidden.
 */
export function buildMergePickerItems(
  query: string,
  jobTitles: string[]
): MergePickerItem[] {
  if (query.includes("{") || query.includes("}")) return [];
  const q = query.trim().toLowerCase();

  const variables = MERGE_VARIABLE_CATALOG.filter(
    (v) =>
      q.length === 0 ||
      v.label.toLowerCase().includes(q) ||
      v.path.toLowerCase().includes(q)
  ).map<MergePickerItem>((v) => ({
    kind: "variable",
    path: v.path,
    label: v.label,
  }));

  const jobs = jobTitles
    .filter((title) => q.length === 0 || title.toLowerCase().includes(q))
    .slice(0, MAX_JOB_RESULTS)
    .map<MergePickerItem>((title) => ({ kind: "job", title }));

  return [...variables, ...jobs];
}
