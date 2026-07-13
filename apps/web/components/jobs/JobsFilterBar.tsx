"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Calendar as CalendarIcon,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelect, type MultiSelectOption } from "@/components/ui/multi-select";
import { cn, formatDate } from "@/lib/utils";
import type {
  JobsFilters,
  JobsFilterSort,
  JobsFilterStatus,
  UseJobsFiltersReturn,
} from "@/hooks/useJobsFilters";

// ─── Static option lists ─────────────────────────────────────────────────────
// Labels via i18n-sleutels (filters.* in jobs.json); de VALUES zijn
// filter-/API-waarden en blijven onaangetast.

const STATUS_OPTIONS: Array<{ value: JobsFilterStatus; labelKey: string }> = [
  { value: "all", labelKey: "filters.status.all" },
  { value: "draft", labelKey: "filters.status.draft" },
  { value: "open", labelKey: "filters.status.open" },
  { value: "filled", labelKey: "filters.status.filled" },
  { value: "closed", labelKey: "filters.status.closed" },
];

const SORT_OPTIONS: Array<{ value: JobsFilterSort; labelKey: string }> = [
  { value: "newest", labelKey: "filters.sort.newest" },
  { value: "oldest", labelKey: "filters.sort.oldest" },
  { value: "most_applicants", labelKey: "filters.sort.mostApplicants" },
  { value: "fewest_applicants", labelKey: "filters.sort.fewestApplicants" },
  { value: "title_az", labelKey: "filters.sort.titleAz" },
];

// Mock-mode fallback recruiter list. In productie zou dit via een `useUsers`
// hook of (anders) via unieke `recruiter_id`s uit de jobs-lijst worden
// opgebouwd; we accepteren beide via de `recruiterOptions` prop.
const FALLBACK_RECRUITERS: RecruiterOption[] = [
  { id: "user-1", name: "Emma Bakker" },
  { id: "user-2", name: "Jan Peters" },
  { id: "user-3", name: "Lisa Smits" },
  { id: "user-4", name: "Mark de Vries" },
];

export interface RecruiterOption {
  id: string;
  name: string;
}

export interface QuickFilter {
  id: string;
  label: string;
  /** Patch applied via `setFilters` when the chip is clicked. */
  patch: Partial<JobsFilters>;
  /** Predicate to determine whether this chip is currently "active". */
  isActive: (filters: JobsFilters) => boolean;
}

interface JobsFilterBarProps
  extends Pick<
    UseJobsFiltersReturn,
    | "filters"
    | "searchInput"
    | "setSearchInput"
    | "setFilter"
    | "setFilters"
    | "resetFilters"
    | "activeCount"
  > {
  /** Recruiter list to populate the recruiter dropdown. */
  recruiterOptions?: RecruiterOption[];
  /**
   * Available tag values for the tags multi-select. Derived from the loaded
   * jobs by the page. When empty the tags control is not rendered at all — no
   * empty dropdown.
   */
  tagOptions?: MultiSelectOption[];
  /** Quick-filter chips rendered above the bar. */
  quickFilters?: QuickFilter[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function JobsFilterBar({
  filters,
  searchInput,
  setSearchInput,
  setFilter,
  setFilters,
  resetFilters,
  activeCount,
  recruiterOptions,
  tagOptions,
  quickFilters,
}: JobsFilterBarProps) {
  const { t } = useTranslation(["jobs", "common"]);
  const [moreOpen, setMoreOpen] = useState(false);

  const recruiters = useMemo<RecruiterOption[]>(
    () =>
      recruiterOptions && recruiterOptions.length > 0
        ? recruiterOptions
        : FALLBACK_RECRUITERS,
    [recruiterOptions]
  );

  const tags = tagOptions ?? [];

  // Count of the *low-frequency* filters that live behind "Meer filters", so
  // the button can show a badge for what's hidden inside it.
  const advancedActiveCount =
    (filters.recruiter_id !== "all" ? 1 : 0) +
    (filters.location ? 1 : 0) +
    (filters.date_from ? 1 : 0) +
    (filters.date_to ? 1 : 0) +
    (filters.tags.length > 0 ? 1 : 0);

  return (
    <div className="space-y-3">
      {/* Quick filters */}
      {quickFilters && quickFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground mr-1">
            {t("filters.quickFilterLabel")}
          </span>
          {quickFilters.map((qf) => {
            const active = qf.isActive(filters);
            return (
              <button
                key={qf.id}
                type="button"
                onClick={() => setFilters(qf.patch)}
                className={cn(
                  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
                    : "border-input bg-background text-muted-foreground hover:border-indigo-300 hover:text-foreground"
                )}
                aria-pressed={active}
              >
                {qf.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Filter bar — Zoeken + Status + Sortering blijven inline; de
          laag-frequente filters (Recruiter, Locatie, Datumbereik, Tags)
          vouwen op elk formaat weg achter "Meer filters". */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchControl
          value={searchInput}
          onChange={setSearchInput}
          className="w-full sm:w-72"
        />
        <StatusControl
          value={filters.status}
          onChange={(v) => setFilter("status", v)}
        />
        <SortControl
          value={filters.sort}
          onChange={(v) => setFilter("sort", v)}
        />

        <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="h-10 shrink-0 gap-2"
              aria-label={t("filters.moreFilters")}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span>{t("filters.moreFilters")}</span>
              {advancedActiveCount > 0 && (
                <span className="ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-semibold text-white">
                  {advancedActiveCount}
                </span>
              )}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t("filters.dialogTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <LabelledField label={t("filters.fields.recruiter")}>
                <RecruiterControl
                  value={filters.recruiter_id}
                  onChange={(v) => setFilter("recruiter_id", v)}
                  recruiters={recruiters}
                  fullWidth
                />
              </LabelledField>
              <LabelledField label={t("filters.fields.location")}>
                <LocationControl
                  value={filters.location}
                  onChange={(v) => setFilter("location", v)}
                  fullWidth
                />
              </LabelledField>
              <LabelledField label={t("filters.fields.openedBetween")}>
                <DateRangeControl
                  from={filters.date_from}
                  to={filters.date_to}
                  onChange={(from, to) =>
                    setFilters({ date_from: from, date_to: to })
                  }
                  fullWidth
                />
              </LabelledField>
              {/* Tags: alleen tonen als er daadwerkelijk tag-waarden zijn —
                  geen lege dropdown. */}
              {tags.length > 0 && (
                <LabelledField label={t("filters.fields.tags")}>
                  <MultiSelect
                    options={tags}
                    selected={filters.tags}
                    onChange={(next) => setFilter("tags", next)}
                    placeholder={t("filters.tags.all")}
                    countLabel={(count) => t("filters.tags.selected", { count })}
                    clearLabel={t("filters.tags.clear")}
                    aria-label={t("filters.tagsAria")}
                    className="w-full"
                  />
                </LabelledField>
              )}
              <div className="flex items-center justify-between pt-2">
                {activeCount > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      resetFilters();
                    }}
                    className="gap-1.5 text-muted-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                    {t("filters.reset", { count: activeCount })}
                  </Button>
                ) : (
                  <span />
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setMoreOpen(false)}
                  className="bg-indigo-600 hover:bg-indigo-700 border-0"
                >
                  {t("common:actions.close")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {activeCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetFilters}
            className="ml-auto h-10 gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            {t("filters.reset", { count: activeCount })}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Sub-controls ────────────────────────────────────────────────────────────

function LabelledField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function SearchControl({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const { t } = useTranslation("jobs");
  return (
    <div className={cn("relative w-72", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("filters.searchPlaceholder")}
        className="pl-9"
        aria-label={t("filters.searchAria")}
      />
    </div>
  );
}

function StatusControl({
  value,
  onChange,
  fullWidth,
}: {
  value: JobsFilterStatus;
  onChange: (next: JobsFilterStatus) => void;
  fullWidth?: boolean;
}) {
  const { t } = useTranslation("jobs");
  return (
    <Select value={value} onValueChange={(v) => onChange(v as JobsFilterStatus)}>
      <SelectTrigger className={cn(fullWidth ? "w-full" : "w-[160px]")}
        aria-label={t("filters.statusAria")}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {t(opt.labelKey)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RecruiterControl({
  value,
  onChange,
  recruiters,
  fullWidth,
}: {
  value: string | "all";
  onChange: (next: string | "all") => void;
  recruiters: RecruiterOption[];
  fullWidth?: boolean;
}) {
  const { t } = useTranslation("jobs");
  return (
    <Select value={value} onValueChange={(v) => onChange(v)}>
      <SelectTrigger
        className={cn(fullWidth ? "w-full" : "w-[180px]")}
        aria-label={t("filters.recruiterAria")}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t("filters.allRecruiters")}</SelectItem>
        {recruiters.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {r.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LocationControl({
  value,
  onChange,
  fullWidth,
}: {
  value: string;
  onChange: (next: string) => void;
  fullWidth?: boolean;
}) {
  const { t } = useTranslation("jobs");
  return (
    <Input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t("filters.fields.location")}
      className={cn(fullWidth ? "w-full" : "w-[160px]")}
      aria-label={t("filters.locationAria")}
    />
  );
}

function DateRangeControl({
  from,
  to,
  onChange,
  fullWidth,
}: {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
  fullWidth?: boolean;
}) {
  const { t } = useTranslation(["jobs", "common"]);
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState<string>(from ?? "");
  const [draftTo, setDraftTo] = useState<string>(to ?? "");

  const label = useMemo(() => {
    if (!from && !to) return t("filters.fields.openedBetween");
    if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
    if (from) return t("filters.dateRange.from", { date: formatDate(from) });
    if (to) return t("filters.dateRange.until", { date: formatDate(to) });
    return t("filters.fields.openedBetween");
  }, [from, to, t]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraftFrom(from ?? "");
          setDraftTo(to ?? "");
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-10 justify-start gap-2 font-normal text-sm",
            fullWidth ? "w-full" : "w-[220px]",
            !from && !to && "text-muted-foreground"
          )}
        >
          <CalendarIcon className="h-4 w-4" />
          <span className="truncate">{label}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("filters.fields.openedBetween")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <LabelledField label={t("filters.dateRange.fromLabel")}>
            <Input
              type="date"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              max={draftTo || undefined}
            />
          </LabelledField>
          <LabelledField label={t("filters.dateRange.untilLabel")}>
            <Input
              type="date"
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
              min={draftFrom || undefined}
            />
          </LabelledField>
        </div>
        <div className="flex items-center justify-between pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraftFrom("");
              setDraftTo("");
              onChange(null, null);
              setOpen(false);
            }}
            className="text-muted-foreground"
            disabled={!from && !to && !draftFrom && !draftTo}
          >
            {t("filters.dateRange.clear")}
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onChange(draftFrom || null, draftTo || null);
                setOpen(false);
              }}
              className="bg-indigo-600 hover:bg-indigo-700 border-0"
            >
              {t("filters.dateRange.apply")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SortControl({
  value,
  onChange,
  fullWidth,
}: {
  value: JobsFilterSort;
  onChange: (next: JobsFilterSort) => void;
  fullWidth?: boolean;
}) {
  const { t } = useTranslation("jobs");
  return (
    <Select value={value} onValueChange={(v) => onChange(v as JobsFilterSort)}>
      <SelectTrigger
        className={cn(fullWidth ? "w-full" : "w-[200px]")}
        aria-label={t("filters.sortAria")}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SORT_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {t(opt.labelKey)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
