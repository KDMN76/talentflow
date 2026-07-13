"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Plus, Briefcase, Wand2, Download } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { JobCard } from "@/components/jobs/JobCard";
import { JobRowBoundary } from "@/components/jobs/JobRowBoundary";
import {
  JobsFilterBar,
  type QuickFilter,
  type RecruiterOption,
} from "@/components/jobs/JobsFilterBar";
import type { MultiSelectOption } from "@/components/ui/multi-select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { useJobs } from "@/hooks/useJobs";
import {
  useJobsFilters,
  type JobsFilters,
} from "@/hooks/useJobsFilters";
import { getCurrentUserId } from "@/lib/auth";
import { downloadCsv } from "@/lib/downloadHelper";
import type { JobListItem as Job } from "@talentflow/contracts";

// `tags` is not yet a first-class field on `Job`, but the filter UI exposes
// it for forward-compat with backend full-text search. TODO(Agent S): zodra
// backend `tags`, full-text-search en datum-filtering ondersteunt, kunnen de
// onderstaande client-side filters server-side worden afgehandeld.
type JobWithOptionalTags = Job & { tags?: string[] | null };

export default function JobsPage() {
  const { t } = useTranslation("jobs");
  const { toast } = useToast();
  // Resolve the current user once per render from the JWT in session
  // storage. Falls back to `null` when the user can't be identified — in
  // that case the "Mijn open jobs" quick-filter simply has no effect
  // rather than masquerading as another user.
  const currentUserId = getCurrentUserId();
  const {
    filters,
    searchInput,
    setSearchInput,
    setFilter,
    setFilters,
    resetFilters,
    activeCount,
  } = useJobsFilters();

  // Server-side filtering: status + recruiter_id (backend supports these
  // today). All overige filters worden client-side toegepast op `jobs`.
  const { data: jobs, isLoading } = useJobs({
    status: filters.status,
    recruiterId: filters.recruiter_id,
  });

  // Build recruiter options from the loaded jobs (covers both mock and prod
  // until a dedicated `useUsers` hook bestaat).
  const recruiterOptions = useMemo<RecruiterOption[]>(() => {
    if (!jobs) return [];
    const seen = new Map<string, string>();
    for (const job of jobs) {
      // Sub-fase 2C: recruiter_id en recruiter_name kunnen null zijn —
      // skip jobs zonder gekoppelde recruiter.
      if (!job.recruiter_id || !job.recruiter_name) continue;
      if (!seen.has(job.recruiter_id)) {
        seen.set(job.recruiter_id, job.recruiter_name);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [jobs]);

  // Tag options for the (previously dead) tags filter. Derived from the loaded
  // jobs; `tags` is not yet a first-class field on `Job`, so we read it via the
  // optional-tags cast. When no job carries tags the filter simply isn't shown.
  const tagOptions = useMemo<MultiSelectOption[]>(() => {
    if (!jobs) return [];
    const set = new Set<string>();
    for (const job of jobs as JobWithOptionalTags[]) {
      for (const tag of job.tags ?? []) {
        const trimmed = tag.trim();
        if (trimmed) set.add(trimmed);
      }
    }
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, "nl"))
      .map((tag) => ({ value: tag, label: tag }));
  }, [jobs]);

  // Quick-filter chips. `current_user` valt terug op de JWT-uitgelezen
  // gebruiker (zie `getCurrentUserId` in `lib/auth`).
  const quickFilters = useMemo<QuickFilter[]>(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const startOfYear = new Date(new Date().getFullYear(), 0, 1);

    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    return [
      {
        id: "my-open",
        label: t("list.quickFilters.myOpen"),
        patch: { status: "open", recruiter_id: currentUserId ?? undefined },
        isActive: (f) =>
          f.status === "open" &&
          !!currentUserId &&
          f.recruiter_id === currentUserId,
      },
      {
        id: "recent-7d",
        label: t("list.quickFilters.recent7d"),
        patch: { date_from: fmt(sevenDaysAgo), date_to: null },
        isActive: (f) => f.date_from === fmt(sevenDaysAgo) && f.date_to === null,
      },
      {
        id: "filled-this-year",
        label: t("list.quickFilters.filledThisYear"),
        patch: { status: "filled", date_from: fmt(startOfYear), date_to: null },
        isActive: (f) =>
          f.status === "filled" &&
          f.date_from === fmt(startOfYear) &&
          f.date_to === null,
      },
    ];
  }, [currentUserId, t]);

  const totalCount = jobs?.length ?? 0;

  const filteredJobs = useMemo<Job[]>(() => {
    if (!jobs) return [];
    return applyClientSideFilters(jobs, filters);
  }, [jobs, filters]);

  const visibleCount = filteredJobs.length;

  // Client-side CSV export of the currently loaded + filtered/sorted jobs.
  // Mirrors the dashboard export pattern (downloadCsv + toast). Note: this only
  // covers the set already in memory — the tooltip on the button says so.
  const handleExportCsv = () => {
    const headers = [
      t("list.export.columns.title"),
      t("list.export.columns.jobReference"),
      t("list.export.columns.status"),
      t("list.export.columns.department"),
      t("list.export.columns.location"),
      t("list.export.columns.employmentType"),
      t("list.export.columns.salaryMin"),
      t("list.export.columns.salaryMax"),
      t("list.export.columns.salaryCurrency"),
      t("list.export.columns.recruiterName"),
      t("list.export.columns.applicationCount"),
      t("list.export.columns.createdAt"),
    ];
    const rows: Array<Array<string | number>> = filteredJobs.map((job) => [
      job.title,
      job.job_reference ?? "",
      job.status,
      job.department ?? "",
      job.location ?? "",
      job.employment_type ?? "",
      job.salary_min ?? "",
      job.salary_max ?? "",
      job.currency ?? "",
      job.recruiter_name ?? "",
      job.application_count,
      job.created_at,
    ]);
    try {
      downloadCsv(
        `${t("list.export.filenamePrefix")}-${new Date()
          .toISOString()
          .slice(0, 10)}.csv`,
        headers,
        rows
      );
      toast({ title: t("list.export.success") });
    } catch {
      toast({ title: t("list.export.error"), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("list.title")}
        description={t("list.description")}
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleExportCsv}
              disabled={visibleCount === 0}
              title={t("list.export.tooltip")}
            >
              <Download className="mr-2 h-4 w-4" />
              {t("list.export.button")}
            </Button>
            <Button
              asChild
              variant="outline"
              className="border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 hover:text-purple-800 dark:border-purple-900 dark:bg-purple-950/40 dark:text-purple-300 dark:hover:bg-purple-950/60"
            >
              <Link href="/jobs/new/ai-generator">
                <Wand2 className="mr-2 h-4 w-4" />
                {t("list.aiGenerator")}
              </Link>
            </Button>
            <Button
              asChild
              className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-sm border-0"
            >
              <Link href="/jobs/new">
                <Plus className="mr-2 h-4 w-4" />
                {t("list.newJob")}
              </Link>
            </Button>
          </div>
        }
      />

      <JobsFilterBar
        filters={filters}
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        setFilter={setFilter}
        setFilters={setFilters}
        resetFilters={resetFilters}
        activeCount={activeCount}
        recruiterOptions={recruiterOptions}
        tagOptions={tagOptions}
        quickFilters={quickFilters}
      />

      {/* Result counter */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {isLoading ? (
            <span className="opacity-60">{t("list.loading")}</span>
          ) : (
            <>
              <span className="font-medium text-foreground">{visibleCount}</span>{" "}
              {t("list.results", { count: visibleCount })}
              {totalCount !== visibleCount && (
                <> {t("list.ofTotal", { total: totalCount })}</>
              )}
            </>
          )}
        </span>
      </div>

      {/* Jobs list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : visibleCount === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Briefcase className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {totalCount === 0
              ? t("list.empty.noJobsTitle")
              : t("list.empty.noResultsTitle")}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {totalCount === 0
              ? t("list.empty.noJobsDescription")
              : t("list.empty.noResultsDescription")}
          </p>
          <div className="mt-4 flex gap-2">
            {totalCount === 0 ? (
              <Button asChild>
                <Link href="/jobs/new">
                  <Plus className="mr-2 h-4 w-4" />
                  {t("list.newJob")}
                </Link>
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={resetFilters}
                disabled={activeCount === 0}
              >
                {t("list.empty.resetFilters")}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredJobs.map((job) => (
            <JobRowBoundary key={job.id} jobId={job.id} jobTitle={job.title}>
              <JobCard job={job} />
            </JobRowBoundary>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Client-side filtering & sorting ─────────────────────────────────────────
// TODO(Agent S): vervangen door server-side query-params (`q`, `location`,
// `created_from`, `created_to`, `tags`) zodra de backend dit ondersteunt.

function applyClientSideFilters(jobs: Job[], filters: JobsFilters): Job[] {
  const search = filters.search.trim().toLowerCase();
  const location = filters.location.trim().toLowerCase();
  const fromMs = filters.date_from
    ? new Date(filters.date_from + "T00:00:00").getTime()
    : null;
  const toMs = filters.date_to
    ? new Date(filters.date_to + "T23:59:59").getTime()
    : null;
  const tagsLower = filters.tags.map((t) => t.toLowerCase());

  const matches = jobs.filter((rawJob) => {
    const job = rawJob as JobWithOptionalTags;

    // Search across title + reference (id) + location.
    if (search) {
      const haystack = [
        job.title,
        job.id, // job_reference fallback (mock data heeft geen aparte ref)
        job.location,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    // Location contains. `location` is nullable in JobListItem; jobs zonder
    // locatie matchen geen location-filter.
    if (location) {
      if (!job.location?.toLowerCase().includes(location)) return false;
    }

    // Date range against `created_at`.
    if (fromMs !== null || toMs !== null) {
      const createdMs = new Date(job.created_at).getTime();
      if (fromMs !== null && createdMs < fromMs) return false;
      if (toMs !== null && createdMs > toMs) return false;
    }

    // Tag intersection (job must contain at least one selected tag).
    if (tagsLower.length > 0) {
      const jobTags = (job.tags ?? []).map((t) => t.toLowerCase());
      const intersects = tagsLower.some((t) => jobTags.includes(t));
      if (!intersects) return false;
    }

    return true;
  });

  return [...matches].sort(getComparator(filters.sort));
}

function getComparator(sort: JobsFilters["sort"]): (a: Job, b: Job) => number {
  switch (sort) {
    case "oldest":
      return (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    case "most_applicants":
      return (a, b) => (b.application_count ?? 0) - (a.application_count ?? 0);
    case "fewest_applicants":
      return (a, b) => (a.application_count ?? 0) - (b.application_count ?? 0);
    case "title_az":
      return (a, b) => a.title.localeCompare(b.title, "nl");
    case "newest":
    default:
      return (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  }
}
