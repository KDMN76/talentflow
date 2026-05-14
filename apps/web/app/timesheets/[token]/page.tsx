/**
 * Sprint Q4.4 — Public timesheets-portaal voor de kandidaat.
 *
 * Token-flow:
 *   1. Token uit URL → usePublicTimesheet
 *   2. Kandidaat ziet header (naam + klant + week) en day-by-day form.
 *   3. Auto-save op blur, totals herrekenen live.
 *   4. "Versturen voor goedkeuring" → submit → read-only confirm-screen.
 *   5. status='rejected' → rode banner met reden, formulier blijft bewerkbaar.
 *
 * Mobile-first, geen dashboard-layout (deze route ligt buiten /(dashboard)).
 */

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  RotateCw,
  Send,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import {
  usePublicTimesheet,
  useSavePublicEntry,
  useSubmitPublicTimesheet,
} from "@/hooks/useBackOffice";
import type { TimesheetEntry } from "@/lib/types/backOffice";

const WEEKDAYS_NL = [
  "Maandag",
  "Dinsdag",
  "Woensdag",
  "Donderdag",
  "Vrijdag",
  "Zaterdag",
  "Zondag",
];

interface DayRow {
  index: number; // 0 = Mon
  date: string;
  weekday: string;
  entry: TimesheetEntry | null;
  hours: string;
  break_minutes: string;
  description: string;
  project_code: string;
}

function buildDayRows(weekStart: string, entries: TimesheetEntry[]): DayRow[] {
  const start = new Date(weekStart);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const entry = entries.find((e) => e.date === dateStr) ?? null;
    return {
      index: i,
      date: dateStr,
      weekday: WEEKDAYS_NL[i],
      entry,
      hours: entry ? String(entry.hours) : "",
      break_minutes: entry ? String(entry.break_minutes) : "30",
      description: entry?.description ?? "",
      project_code: entry?.project_code ?? "",
    };
  });
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "short",
  });
}

export default function PublicTimesheetPortalPage() {
  const params = useParams();
  const token = (params?.token as string) ?? "";
  const { toast } = useToast();

  const { data, isLoading, isError, refetch } = usePublicTimesheet(token);
  const saveEntry = useSavePublicEntry();
  const submit = useSubmitPublicTimesheet();

  const [rows, setRows] = useState<DayRow[]>([]);
  const [showWeekend, setShowWeekend] = useState(false);
  const [confirmedSubmit, setConfirmedSubmit] = useState(false);

  useEffect(() => {
    if (data?.timesheet) {
      setRows(buildDayRows(data.timesheet.week_start, data.timesheet.entries ?? []));
      // Auto-expand weekend if any weekend day already has hours.
      const hasWeekend = (data.timesheet.entries ?? []).some((e) => {
        const d = new Date(e.date);
        const wd = d.getDay();
        return wd === 0 || wd === 6;
      });
      if (hasWeekend) setShowWeekend(true);
    }
  }, [data?.timesheet]);

  if (isLoading) return <PortalSkeleton />;
  if (isError || !data) return <PortalErrorScreen onRetry={() => refetch()} />;

  const { timesheet, contract } = data;

  const totalRegular = rows.reduce(
    (s, r) => s + (parseFloat(r.hours) || 0),
    0
  );
  const totalBreak = rows.reduce(
    (s, r) => s + (parseInt(r.break_minutes, 10) || 0),
    0
  );
  const expectedWeekHours = contract.weekly_hours ?? 40;
  const isReadonly =
    timesheet.status === "submitted" ||
    timesheet.status === "approved" ||
    confirmedSubmit;

  const updateRow = (i: number, patch: Partial<DayRow>) => {
    setRows((cur) => cur.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const persistRow = async (row: DayRow) => {
    if (isReadonly) return;
    const hoursNum = parseFloat(row.hours);
    if (!row.hours || isNaN(hoursNum) || hoursNum <= 0) {
      // Skip empty rows.
      return;
    }
    if (hoursNum > 24) {
      toast({
        title: "Te veel uren",
        description: "Maximaal 24 uur per dag.",
        variant: "destructive",
      });
      return;
    }
    try {
      await saveEntry.mutateAsync({
        token,
        timesheetId: timesheet.id,
        entryId: row.entry?.id,
        date: row.date,
        hours: hoursNum,
        overtime_hours: hoursNum > 8 ? hoursNum - 8 : 0,
        break_minutes: parseInt(row.break_minutes, 10) || 0,
        description: row.description || null,
        project_code: row.project_code || null,
      });
    } catch {
      toast({ title: "Opslaan mislukt", variant: "destructive" });
    }
  };

  const handleSubmit = async () => {
    if (totalRegular <= 0) {
      toast({
        title: "Geen uren ingevuld",
        description: "Vul minstens één dag in voordat je verstuurt.",
        variant: "destructive",
      });
      return;
    }
    // Ensure all dirty rows are persisted first.
    for (const r of rows) {
      if (parseFloat(r.hours) > 0) {
        await persistRow(r);
      }
    }
    try {
      await submit.mutateAsync({ token, timesheetId: timesheet.id });
      setConfirmedSubmit(true);
      toast({
        title: "Verstuurd",
        description: "Je urenstaat is ter goedkeuring naar de recruiter gestuurd.",
      });
    } catch {
      toast({ title: "Versturen mislukt", variant: "destructive" });
    }
  };

  const visibleRows = showWeekend ? rows : rows.slice(0, 5);
  const weekend = rows.slice(5);
  const weekendHours = weekend.reduce(
    (s, r) => s + (parseFloat(r.hours) || 0),
    0
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Brand strip */}
        <div className="mb-5 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 shadow-sm">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            TalentFlow
          </span>
        </div>

        {/* Hero */}
        <header className="mb-5">
          <p className="text-xs font-medium uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            Urenstaat · Kandidaten-portaal
          </p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-2xl">
            Hallo {contract.candidate_name?.split(" ")[0] ?? "kandidaat"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Werkweek bij{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {contract.client_name ?? "—"}
            </span>{" "}
            · {formatDate(timesheet.week_start)} t/m{" "}
            {formatDate(timesheet.week_end)}
          </p>
        </header>

        {/* Status banners */}
        {confirmedSubmit || timesheet.status === "submitted" ? (
          <ReadonlyConfirmationBanner status="submitted" />
        ) : timesheet.status === "approved" ? (
          <ReadonlyConfirmationBanner status="approved" />
        ) : timesheet.status === "rejected" ? (
          <RejectionBanner reason={timesheet.rejection_reason} />
        ) : null}

        {/* Day rows */}
        <div className="mt-4 space-y-2.5">
          {visibleRows.map((row) => (
            <DayCard
              key={row.date}
              row={row}
              readonly={isReadonly}
              onChange={(patch) => updateRow(row.index, patch)}
              onBlur={() => persistRow(row)}
            />
          ))}

          {!showWeekend && (
            <button
              type="button"
              onClick={() => setShowWeekend(true)}
              className="w-full rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-3 text-xs font-medium text-zinc-500 transition hover:border-indigo-300 hover:text-indigo-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-indigo-700 dark:hover:text-indigo-400"
            >
              + Weekend toevoegen ({weekendHours > 0 ? `${weekendHours}u ingevuld` : "Zaterdag & Zondag"})
            </button>
          )}
        </div>

        {/* Totals */}
        <div className="mt-5 rounded-xl border border-border bg-white p-4 shadow-sm dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Totaal deze week
            </p>
            <p className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
              {totalRegular.toFixed(2)}
              <span className="ml-1 text-sm font-medium text-muted-foreground">
                uur
              </span>
            </p>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Verwacht: {expectedWeekHours} uur</span>
            <span>{totalBreak} min pauze</span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-600 transition-all"
              style={{
                width: `${Math.min(100, (totalRegular / expectedWeekHours) * 100)}%`,
              }}
            />
          </div>
        </div>

        {/* Submit button */}
        {!isReadonly && (
          <Button
            onClick={handleSubmit}
            disabled={submit.isPending || totalRegular <= 0}
            className="mt-5 w-full border-0 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
            size="lg"
          >
            {submit.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Versturen voor goedkeuring
          </Button>
        )}

        {/* Auto-save indicator */}
        {!isReadonly && (
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            {saveEntry.isPending ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Opslaan...
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Wijzigingen worden automatisch opgeslagen
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

interface DayCardProps {
  row: DayRow;
  readonly: boolean;
  onChange: (patch: Partial<DayRow>) => void;
  onBlur: () => void;
}

function DayCard({ row, readonly, onChange, onBlur }: DayCardProps) {
  const [showDetails, setShowDetails] = useState(
    !!row.description || !!row.project_code
  );
  const hours = parseFloat(row.hours) || 0;
  const isWeekend = row.index === 5 || row.index === 6;

  return (
    <div className="rounded-xl border border-border bg-white p-3 shadow-sm transition hover:shadow-md dark:bg-zinc-900">
      <div className="flex items-center gap-3">
        <div className="flex w-16 flex-col items-start sm:w-20">
          <span
            className={
              isWeekend
                ? "text-xs font-semibold text-zinc-500 dark:text-zinc-400"
                : "text-xs font-semibold text-zinc-700 dark:text-zinc-300"
            }
          >
            {row.weekday}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {formatDate(row.date)}
          </span>
        </div>
        <div className="flex flex-1 items-center gap-2">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            max={24}
            step={0.25}
            value={row.hours}
            onChange={(e) => onChange({ hours: e.target.value })}
            onBlur={onBlur}
            disabled={readonly}
            placeholder="0.00"
            className="h-11 max-w-[110px] text-right font-mono text-base font-semibold tabular-nums"
            aria-label={`Uren ${row.weekday}`}
          />
          <span className="text-xs font-medium text-muted-foreground">u</span>
        </div>
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
        >
          {showDetails ? "−" : "+"} details
        </button>
      </div>

      {showDetails && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor={`break-${row.date}`} className="text-[11px]">
                Pauze (min)
              </Label>
              <Input
                id={`break-${row.date}`}
                type="number"
                min={0}
                max={240}
                step={5}
                value={row.break_minutes}
                onChange={(e) => onChange({ break_minutes: e.target.value })}
                onBlur={onBlur}
                disabled={readonly}
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label htmlFor={`proj-${row.date}`} className="text-[11px]">
                Projectcode
              </Label>
              <Input
                id={`proj-${row.date}`}
                value={row.project_code}
                onChange={(e) => onChange({ project_code: e.target.value })}
                onBlur={onBlur}
                disabled={readonly}
                placeholder="bv. PRJ-001"
                className="h-9 text-sm"
              />
            </div>
          </div>
          <div>
            <Label htmlFor={`desc-${row.date}`} className="text-[11px]">
              Werkomschrijving (optioneel)
            </Label>
            <Textarea
              id={`desc-${row.date}`}
              rows={2}
              value={row.description}
              onChange={(e) => onChange({ description: e.target.value })}
              onBlur={onBlur}
              disabled={readonly}
              placeholder="Bv. sprint planning + feature X"
              className="text-sm"
            />
          </div>
        </div>
      )}

      {hours > 8 && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
          <Clock className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            {(hours - 8).toFixed(2)} uur boven 8u/dag wordt als overuren
            afgerekend.
          </span>
        </div>
      )}
    </div>
  );
}

function ReadonlyConfirmationBanner({
  status,
}: {
  status: "submitted" | "approved";
}) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
      <div className="flex items-start gap-2.5">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div>
          <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
            {status === "submitted"
              ? "Urenstaat verstuurd"
              : "Goedgekeurd door recruiter"}
          </p>
          <p className="mt-0.5 text-xs text-emerald-800/90 dark:text-emerald-300/90">
            {status === "submitted"
              ? "Je recruiter ontvangt een melding en gaat de uren controleren. Je kunt dit tabblad sluiten."
              : "Deze week is afgerond — bedankt voor het tijdig invullen."}
          </p>
        </div>
      </div>
    </div>
  );
}

function RejectionBanner({ reason }: { reason: string | null }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/20">
      <div className="flex items-start gap-2.5">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
        <div>
          <p className="text-sm font-semibold text-red-900 dark:text-red-200">
            Urenstaat afgekeurd
          </p>
          <p className="mt-0.5 text-xs text-red-800/90 dark:text-red-300/90">
            {reason ?? "Geen reden opgegeven."} Pas de uren aan en verstuur
            opnieuw.
          </p>
        </div>
      </div>
    </div>
  );
}

function PortalSkeleton() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
        <Skeleton className="mb-4 h-8 w-32" />
        <Skeleton className="mb-2 h-7 w-56" />
        <Skeleton className="mb-6 h-4 w-72" />
        <div className="space-y-2.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

function PortalErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
      <div className="w-full max-w-md space-y-4 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/30">
          <AlertCircle className="h-7 w-7 text-red-600 dark:text-red-400" />
        </div>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
          Deze link is verlopen of ongeldig
        </h1>
        <p className="text-sm text-muted-foreground">
          Vraag de recruiter om een nieuwe link. Mogelijk is je urenstaat al
          verwerkt of is de link verlopen om je gegevens te beschermen.
        </p>
        <div className="pt-2">
          <Button onClick={onRetry} variant="outline">
            <RotateCw className="mr-1.5 h-3.5 w-3.5" />
            Opnieuw proberen
          </Button>
        </div>
      </div>
    </div>
  );
}

