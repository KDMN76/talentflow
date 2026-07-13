"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type JobsFilterStatus = "all" | "draft" | "open" | "filled" | "closed";

export type JobsFilterSort =
  | "newest"
  | "oldest"
  | "most_applicants"
  | "fewest_applicants"
  | "title_az";

export interface JobsFilters {
  search: string;
  status: JobsFilterStatus;
  recruiter_id: string | "all";
  location: string;
  /** ISO YYYY-MM-DD or null. */
  date_from: string | null;
  /** ISO YYYY-MM-DD or null. */
  date_to: string | null;
  sort: JobsFilterSort;
  tags: string[];
}

const DEFAULTS: JobsFilters = {
  search: "",
  status: "all",
  recruiter_id: "all",
  location: "",
  date_from: null,
  date_to: null,
  sort: "newest",
  tags: [],
};

const VALID_STATUSES: ReadonlySet<JobsFilterStatus> = new Set([
  "all",
  "draft",
  "open",
  "filled",
  "closed",
]);

const VALID_SORTS: ReadonlySet<JobsFilterSort> = new Set([
  "newest",
  "oldest",
  "most_applicants",
  "fewest_applicants",
  "title_az",
]);

/** Parse the current `URLSearchParams` into a `JobsFilters` shape. */
export function parseFromSearchParams(sp: URLSearchParams): JobsFilters {
  const status = sp.get("status");
  const sort = sp.get("sort");
  const tagsParam = sp.get("tags");

  return {
    search: sp.get("search") ?? DEFAULTS.search,
    status:
      status && VALID_STATUSES.has(status as JobsFilterStatus)
        ? (status as JobsFilterStatus)
        : DEFAULTS.status,
    recruiter_id: sp.get("recruiter") ?? DEFAULTS.recruiter_id,
    location: sp.get("location") ?? DEFAULTS.location,
    date_from: sp.get("from") ?? DEFAULTS.date_from,
    date_to: sp.get("to") ?? DEFAULTS.date_to,
    sort:
      sort && VALID_SORTS.has(sort as JobsFilterSort)
        ? (sort as JobsFilterSort)
        : DEFAULTS.sort,
    tags:
      tagsParam && tagsParam.length > 0
        ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean)
        : DEFAULTS.tags,
  };
}

/** Serialise a `JobsFilters` into a URL query string, omitting defaults. */
export function buildQueryString(filters: JobsFilters): string {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.status !== DEFAULTS.status) params.set("status", filters.status);
  if (filters.recruiter_id !== DEFAULTS.recruiter_id)
    params.set("recruiter", filters.recruiter_id);
  if (filters.location) params.set("location", filters.location);
  if (filters.date_from) params.set("from", filters.date_from);
  if (filters.date_to) params.set("to", filters.date_to);
  if (filters.sort !== DEFAULTS.sort) params.set("sort", filters.sort);
  if (filters.tags.length > 0) params.set("tags", filters.tags.join(","));
  return params.toString();
}

/**
 * Count active *filters* for the reset badge. `sort` is intentionally excluded:
 * sorting is a view preference, not a filter, so it must not inflate the badge
 * or make "Reset (n)" appear when only the sort order changed.
 */
export function countActive(filters: JobsFilters): number {
  let n = 0;
  if (filters.search !== DEFAULTS.search) n++;
  if (filters.status !== DEFAULTS.status) n++;
  if (filters.recruiter_id !== DEFAULTS.recruiter_id) n++;
  if (filters.location !== DEFAULTS.location) n++;
  if (filters.date_from !== DEFAULTS.date_from) n++;
  if (filters.date_to !== DEFAULTS.date_to) n++;
  if (filters.tags.length !== DEFAULTS.tags.length) n++;
  return n;
}

export interface UseJobsFiltersReturn {
  filters: JobsFilters;
  /** Live (un-debounced) search input value, for controlled UI binding. */
  searchInput: string;
  setSearchInput: (value: string) => void;
  setFilter: <K extends keyof JobsFilters>(key: K, value: JobsFilters[K]) => void;
  /** Apply multiple filter changes atomically (for quick-filter chips). */
  setFilters: (patch: Partial<JobsFilters>) => void;
  resetFilters: () => void;
  activeCount: number;
}

/**
 * Filter-state hook synced with the URL `searchParams`. Search input is
 * debounced 300ms before being committed to the URL/filters; other fields
 * sync immediately. Empty/default values are stripped from the URL so links
 * stay clean and bookmarkable.
 */
export function useJobsFilters(): UseJobsFiltersReturn {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filtersFromUrl = useMemo(
    () => parseFromSearchParams(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );

  // Locally controlled search input (for immediate typing feedback).
  const [searchInput, setSearchInputState] = useState<string>(filtersFromUrl.search);

  // Keep local search input in sync if the URL changes externally
  // (e.g. browser nav, quick-filter chip, reset).
  const lastUrlSearchRef = useRef<string>(filtersFromUrl.search);
  useEffect(() => {
    if (filtersFromUrl.search !== lastUrlSearchRef.current) {
      lastUrlSearchRef.current = filtersFromUrl.search;
      setSearchInputState(filtersFromUrl.search);
    }
  }, [filtersFromUrl.search]);

  const replaceUrl = useCallback(
    (next: JobsFilters) => {
      const qs = buildQueryString(next);
      const url = qs.length > 0 ? `${pathname}?${qs}` : pathname;
      router.replace(url, { scroll: false });
    },
    [pathname, router]
  );

  // Debounced commit of the search input to the URL.
  useEffect(() => {
    if (searchInput === filtersFromUrl.search) return;
    const handle = setTimeout(() => {
      lastUrlSearchRef.current = searchInput;
      replaceUrl({ ...filtersFromUrl, search: searchInput });
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput, filtersFromUrl, replaceUrl]);

  const setFilter = useCallback(
    <K extends keyof JobsFilters>(key: K, value: JobsFilters[K]) => {
      if (key === "search") {
        setSearchInputState(value as string);
        return;
      }
      replaceUrl({ ...filtersFromUrl, [key]: value });
    },
    [filtersFromUrl, replaceUrl]
  );

  const setFilters = useCallback(
    (patch: Partial<JobsFilters>) => {
      const next = { ...filtersFromUrl, ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, "search")) {
        const nextSearch = patch.search ?? "";
        setSearchInputState(nextSearch);
        lastUrlSearchRef.current = nextSearch;
      }
      replaceUrl(next);
    },
    [filtersFromUrl, replaceUrl]
  );

  const resetFilters = useCallback(() => {
    setSearchInputState(DEFAULTS.search);
    lastUrlSearchRef.current = DEFAULTS.search;
    // Reset clears filters only; the chosen sort order (a view preference) is
    // preserved so it stays consistent with `countActive` not counting sort.
    replaceUrl({ ...DEFAULTS, sort: filtersFromUrl.sort });
  }, [replaceUrl, filtersFromUrl.sort]);

  const activeCount = useMemo(() => countActive(filtersFromUrl), [filtersFromUrl]);

  return {
    filters: filtersFromUrl,
    searchInput,
    setSearchInput: setSearchInputState,
    setFilter,
    setFilters,
    resetFilters,
    activeCount,
  };
}

export const JOBS_FILTERS_DEFAULTS: Readonly<JobsFilters> = DEFAULTS;
