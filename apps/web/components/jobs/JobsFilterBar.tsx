"use client";

import { useMemo, useState } from "react";
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
import { cn, formatDate } from "@/lib/utils";
import type {
  JobsFilters,
  JobsFilterSort,
  JobsFilterStatus,
  UseJobsFiltersReturn,
} from "@/hooks/useJobsFilters";

// ─── Static option lists ─────────────────────────────────────────────────────

const STATUS_OPTIONS: Array<{ value: JobsFilterStatus; label: string }> = [
  { value: "all", label: "Alle statussen" },
  { value: "draft", label: "Concept" },
  { value: "open", label: "Open" },
  { value: "filled", label: "Vervuld" },
  { value: "closed", label: "Gesloten" },
];

const SORT_OPTIONS: Array<{ value: JobsFilterSort; label: string }> = [
  { value: "newest", label: "Nieuwste eerst" },
  { value: "oldest", label: "Oudste eerst" },
  { value: "most_applicants", label: "Meeste sollicitanten" },
  { value: "fewest_applicants", label: "Minste sollicitanten" },
  { value: "title_az", label: "Titel A-Z" },
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
  quickFilters,
}: JobsFilterBarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const recruiters = useMemo<RecruiterOption[]>(
    () =>
      recruiterOptions && recruiterOptions.length > 0
        ? recruiterOptions
        : FALLBACK_RECRUITERS,
    [recruiterOptions]
  );

  return (
    <div className="space-y-3">
      {/* Quick filters */}
      {quickFilters && quickFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground mr-1">
            Snel filter:
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

      {/* Desktop filter bar */}
      <div className="hidden md:flex md:flex-wrap md:items-center md:gap-2">
        <SearchControl value={searchInput} onChange={setSearchInput} />
        <StatusControl
          value={filters.status}
          onChange={(v) => setFilter("status", v)}
        />
        <RecruiterControl
          value={filters.recruiter_id}
          onChange={(v) => setFilter("recruiter_id", v)}
          recruiters={recruiters}
        />
        <LocationControl
          value={filters.location}
          onChange={(v) => setFilter("location", v)}
        />
        <DateRangeControl
          from={filters.date_from}
          to={filters.date_to}
          onChange={(from, to) =>
            setFilters({ date_from: from, date_to: to })
          }
        />
        <SortControl
          value={filters.sort}
          onChange={(v) => setFilter("sort", v)}
        />
        {activeCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetFilters}
            className="ml-auto h-10 gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Reset ({activeCount})
          </Button>
        )}
      </div>

      {/* Mobile: search + filters-toggle */}
      <div className="flex items-center gap-2 md:hidden">
        <SearchControl
          value={searchInput}
          onChange={setSearchInput}
          className="flex-1 min-w-0"
        />
        <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="relative shrink-0"
              aria-label="Filters openen"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {activeCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-semibold text-white">
                  {activeCount}
                </span>
              )}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Filters</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <LabelledField label="Status">
                <StatusControl
                  value={filters.status}
                  onChange={(v) => setFilter("status", v)}
                  fullWidth
                />
              </LabelledField>
              <LabelledField label="Recruiter">
                <RecruiterControl
                  value={filters.recruiter_id}
                  onChange={(v) => setFilter("recruiter_id", v)}
                  recruiters={recruiters}
                  fullWidth
                />
              </LabelledField>
              <LabelledField label="Locatie">
                <LocationControl
                  value={filters.location}
                  onChange={(v) => setFilter("location", v)}
                  fullWidth
                />
              </LabelledField>
              <LabelledField label="Geopend tussen">
                <DateRangeControl
                  from={filters.date_from}
                  to={filters.date_to}
                  onChange={(from, to) =>
                    setFilters({ date_from: from, date_to: to })
                  }
                  fullWidth
                />
              </LabelledField>
              <LabelledField label="Sortering">
                <SortControl
                  value={filters.sort}
                  onChange={(v) => setFilter("sort", v)}
                  fullWidth
                />
              </LabelledField>
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
                    Reset ({activeCount})
                  </Button>
                ) : (
                  <span />
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setMobileOpen(false)}
                  className="bg-indigo-600 hover:bg-indigo-700 border-0"
                >
                  Sluiten
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
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
  return (
    <div className={cn("relative w-72", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Zoek op titel, referentie of locatie..."
        className="pl-9"
        aria-label="Zoek vacatures"
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
  return (
    <Select value={value} onValueChange={(v) => onChange(v as JobsFilterStatus)}>
      <SelectTrigger className={cn(fullWidth ? "w-full" : "w-[160px]")}
        aria-label="Filter op status"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
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
  return (
    <Select value={value} onValueChange={(v) => onChange(v)}>
      <SelectTrigger
        className={cn(fullWidth ? "w-full" : "w-[180px]")}
        aria-label="Filter op recruiter"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Alle recruiters</SelectItem>
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
  return (
    <Input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Locatie"
      className={cn(fullWidth ? "w-full" : "w-[160px]")}
      aria-label="Filter op locatie"
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
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState<string>(from ?? "");
  const [draftTo, setDraftTo] = useState<string>(to ?? "");

  const label = useMemo(() => {
    if (!from && !to) return "Geopend tussen";
    if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
    if (from) return `Vanaf ${formatDate(from)}`;
    if (to) return `Tot ${formatDate(to)}`;
    return "Geopend tussen";
  }, [from, to]);

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
          <DialogTitle>Geopend tussen</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <LabelledField label="Vanaf">
            <Input
              type="date"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              max={draftTo || undefined}
            />
          </LabelledField>
          <LabelledField label="Tot en met">
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
            Wissen
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Annuleren
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
              Toepassen
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
  return (
    <Select value={value} onValueChange={(v) => onChange(v as JobsFilterSort)}>
      <SelectTrigger
        className={cn(fullWidth ? "w-full" : "w-[200px]")}
        aria-label="Sorteren"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SORT_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
