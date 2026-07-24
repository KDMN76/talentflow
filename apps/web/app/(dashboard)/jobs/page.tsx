"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Plus, Briefcase, Wand2, Download, Loader2, ChevronDown } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";
import { useJobsInfinite } from "@/hooks/useJobs";
import { useJobsFilters } from "@/hooks/useJobsFilters";
import { getCurrentUserId } from "@/lib/auth";
import {
  downloadServerExport,
  EXPORT_FORMAT_LABELS,
  type ExportFormat,
} from "@/lib/exportClient";
import type { JobListItem as Job } from "@talentflow/contracts";

// `tags` is nog geen first-class veld op `Job`; de filter-UI leidt tag-opties
// af van geladen jobs (in de praktijk leeg — jobs hebben geen tags-kolom).
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

  // Server-side filtering: zoek/status/recruiter/locatie/datum/sortering gaan
  // nu allemaal naar de backend, zodat de teller (meta.total) én de export de
  // hele gefilterde set dekken — niet alleen de geladen pagina's.
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useJobsInfinite({
    status: filters.status,
    recruiterId: filters.recruiter_id,
    search: filters.search,
    location: filters.location,
    dateFrom: filters.date_from,
    dateTo: filters.date_to,
    sort: filters.sort,
  });

  // Alle geladen pagina's platgeslagen tot één lijst. Filteren + sorteren doet
  // de server al, dus we tonen de rijen ongewijzigd.
  const jobs = useMemo<Job[]>(
    () => data?.pages.flatMap((p) => p.data) ?? [],
    [data]
  );

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

  // Echte gefilterde totaal uit server-side meta — nu filter-bewust (fix voor
  // de "210 terwijl echt ~50"-telling).
  const totalCount = data?.pages[0]?.meta.total ?? 0;

  // Server filtert + sorteert al; toon de rijen ongewijzigd.
  const filteredJobs = jobs;
  const visibleCount = jobs.length;

  // Server-side export van de VOLLEDIGE gefilterde set (tot 50k), in het
  // gekozen formaat. Stuurt exact dezelfde filters mee als de lijst.
  const [exporting, setExporting] = useState(false);
  const handleExport = async (format: ExportFormat) => {
    setExporting(true);
    try {
      const count = await downloadServerExport("/exports/jobs", format, {
        status: filters.status !== "all" ? filters.status : undefined,
        recruiter_id:
          filters.recruiter_id !== "all" ? filters.recruiter_id : undefined,
        search: filters.search || undefined,
        location: filters.location || undefined,
        date_from: filters.date_from ?? undefined,
        date_to: filters.date_to ?? undefined,
        sort: filters.sort !== "newest" ? filters.sort : undefined,
      });
      toast({
        title: t("list.export.success"),
        description: `${count} vacatures geëxporteerd (${format.toUpperCase()}).`,
      });
    } catch {
      toast({ title: t("list.export.error"), variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("list.title")}
        description={t("list.description")}
        actions={
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={totalCount === 0 || exporting}
                  title={t("list.export.tooltip")}
                >
                  {exporting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  {t("list.export.button")}
                  <ChevronDown className="ml-1.5 h-3.5 w-3.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(["csv", "xlsx", "pdf"] as ExportFormat[]).map((fmt) => (
                  <DropdownMenuItem key={fmt} onClick={() => handleExport(fmt)}>
                    {EXPORT_FORMAT_LABELS[fmt]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
              {/* Toon het ECHTE gefilterde totaal (server-side meta.total),
                  niet de geladen ~20 rijen — dit was de foute "210"-telling. */}
              <span className="font-medium text-foreground">{totalCount}</span>{" "}
              {t("list.results", { count: totalCount })}
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

      {/* Meer laden — page-based paginatie over de geladen vacatures */}
      {!isLoading && jobs.length > 0 && (
        <div className="flex flex-col items-center gap-2 pt-2">
          <p className="text-sm text-muted-foreground">
            {t("list.showingXofY", { shown: jobs.length, total: totalCount })}
          </p>
          {hasNextPage && (
            <Button
              variant="outline"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t("list.loadMore")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

