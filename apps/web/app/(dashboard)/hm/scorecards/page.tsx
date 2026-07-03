"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlarmClock,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Clock,
  CloudOff,
  Loader2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  useHmDecision,
  useHmScorecardDeadlines,
  type HMReview,
  type HMScorecardDeadline,
} from "@/hooks/useHiringManager";
import { InlineScorecard } from "@/components/hm/InlineScorecard";
import { HmBottomNav } from "@/components/hm/HmBottomNav";
import type { ScorecardInput } from "@/lib/types/atsExtensions";
import { cn } from "@/lib/utils";

type Filter = "all" | "today" | "this_week" | "overdue";

type CountdownTranslator = (key: string, options?: Record<string, unknown>) => string;

function formatCountdown(due: string, t: CountdownTranslator): string {
  const ms = new Date(due).getTime() - Date.now();
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const minutes = Math.floor((abs % 3600000) / 60000);
  const overdue = ms < 0;
  const prefix = overdue ? "" : t("scorecards.countdown.over");
  const suffix = overdue ? t("scorecards.countdown.tooLate") : "";
  if (days >= 1) {
    return t("scorecards.countdown.daysHours", { prefix, days, hours, suffix });
  }
  if (hours >= 1) {
    return t("scorecards.countdown.hoursMinutes", {
      prefix,
      hours,
      minutes,
      suffix,
    });
  }
  if (overdue) return t("scorecards.countdown.minutesTooLate", { minutes });
  return t("scorecards.countdown.inMinutes", { minutes: Math.max(1, minutes) });
}

export default function HmScorecardsPage() {
  const { t } = useTranslation("hm");
  const { data, isLoading, isError, refetch } = useHmScorecardDeadlines();
  const decision = useHmDecision();
  const { toast } = useToast();

  const [filter, setFilter] = useState<Filter>("all");
  const [scoring, setScoring] = useState<HMReview | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(() => {
    const list = data ?? [];
    if (filter === "all") return list;
    return list.filter((row) => row.bucket === filter);
  }, [data, filter]);

  const counts = useMemo(() => {
    const list = data ?? [];
    return {
      all: list.length,
      today: list.filter((r) => r.bucket === "today").length,
      this_week: list.filter((r) => r.bucket === "this_week").length,
      overdue: list.filter((r) => r.bucket === "overdue").length,
    };
  }, [data]);

  const startScoring = (row: HMScorecardDeadline) => {
    // Adapt the deadline-row to the InlineScorecard's HMReview contract.
    const adapter: HMReview = {
      application_id: row.application_id,
      candidate_name: row.candidate_name,
      candidate_email: "",
      ai_score: null,
      applied_at: new Date().toISOString(),
      job_id: row.job_id,
      job_title: row.job_title,
      stage_id: row.stage_id,
      stage_name: row.stage_name,
    };
    setScoring(adapter);
  };

  const handleSubmit = async (input: ScorecardInput) => {
    if (!scoring) return;
    setSubmitting(true);
    try {
      await decision.mutateAsync({
        candidateId: scoring.application_id,
        decision: "approve",
        scorecard: input,
        stageId: scoring.stage_id ?? null,
      });
      toast({
        title: t("scorecards.toasts.submitted.title"),
        description: t("scorecards.toasts.submitted.description", {
          name: scoring.candidate_name,
        }),
      });
      setScoring(null);
    } catch {
      toast({
        variant: "destructive",
        title: t("scorecards.toasts.saveFailed.title"),
        description: t("scorecards.toasts.saveFailed.description"),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="space-y-5 pb-28 lg:pb-0 animate-fade-in">
        <PageHeader
          title={t("scorecards.header.title")}
          description={t("scorecards.header.description")}
          actions={
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400">
              <ClipboardList className="h-3.5 w-3.5" />
              {t("scorecards.header.openBadge", { count: counts.all })}
            </span>
          }
        />

        {/* Filter pills */}
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 sm:mx-0 sm:px-0">
          <FilterPill
            active={filter === "all"}
            onClick={() => setFilter("all")}
            count={counts.all}
            Icon={ClipboardList}
            label={t("scorecards.filters.all")}
          />
          <FilterPill
            active={filter === "overdue"}
            onClick={() => setFilter("overdue")}
            count={counts.overdue}
            Icon={AlarmClock}
            label={t("scorecards.filters.overdue")}
            tone="rose"
          />
          <FilterPill
            active={filter === "today"}
            onClick={() => setFilter("today")}
            count={counts.today}
            Icon={Clock}
            label={t("scorecards.filters.today")}
            tone="amber"
          />
          <FilterPill
            active={filter === "this_week"}
            onClick={() => setFilter("this_week")}
            count={counts.this_week}
            Icon={CalendarDays}
            label={t("scorecards.filters.thisWeek")}
          />
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
          </div>
        ) : isError ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="flex flex-col items-center justify-center gap-2 py-14 text-center">
              <CloudOff className="h-8 w-8 text-amber-600" />
              <p className="text-sm font-semibold">{t("scorecards.loadError.title")}</p>
              <p className="text-xs text-muted-foreground">
                {t("scorecards.loadError.description")}
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                {t("scorecards.loadError.retry")}
              </button>
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="flex flex-col items-center justify-center gap-2 py-14 text-center">
              <CalendarClock className="h-8 w-8 text-emerald-600" />
              <p className="text-sm font-semibold">{t("scorecards.empty.title")}</p>
              <p className="text-xs text-muted-foreground">
                {t("scorecards.empty.description")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2.5">
            {filtered.map((row) => (
              <li key={`${row.application_id}-${row.stage_id}`}>
                <button
                  type="button"
                  onClick={() => startScoring(row)}
                  className="group w-full rounded-2xl bg-card p-4 text-left shadow-sm ring-1 ring-zinc-200 dark:ring-zinc-800 transition-shadow hover:shadow-md min-h-[64px]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {row.candidate_name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {row.job_title} — {row.stage_name}
                      </p>
                    </div>
                    <DeadlineBadge bucket={row.bucket} due={row.due_at} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <InlineScorecard
        candidate={scoring}
        onCancel={() => (submitting ? null : setScoring(null))}
        onSubmit={handleSubmit}
        submitting={submitting}
      />

      <HmBottomNav />

      {submitting && (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center">
          <div className="rounded-full bg-zinc-900/80 px-3 py-2 text-xs font-medium text-white inline-flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("scorecards.saving")}
          </div>
        </div>
      )}
    </>
  );
}

function FilterPill({
  active,
  onClick,
  count,
  Icon,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone?: "rose" | "amber";
}) {
  const activeTone =
    tone === "rose"
      ? "bg-rose-600 text-white"
      : tone === "amber"
        ? "bg-amber-500 text-white"
        : "bg-indigo-600 text-white";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors min-h-[40px] inline-flex items-center gap-1.5",
        active
          ? activeTone
          : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
      )}
      aria-pressed={active}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      <span className="ml-0.5 text-[10px] tabular-nums opacity-80">{count}</span>
    </button>
  );
}

function DeadlineBadge({
  bucket,
  due,
}: {
  bucket: HMScorecardDeadline["bucket"];
  due: string;
}) {
  const { t } = useTranslation("hm");
  const tone =
    bucket === "overdue"
      ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
      : bucket === "today"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
        : bucket === "this_week"
          ? "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
          : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";

  const Icon =
    bucket === "overdue" ? AlarmClock : bucket === "today" ? Clock : CalendarDays;

  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap",
        tone
      )}
    >
      <Icon className="h-3 w-3" />
      {formatCountdown(due, t)}
    </span>
  );
}
