"use client";

/**
 * Sprint Q4.5 — Brief detail page.
 *
 * Shows brief metadata + recent runs + "Start nieuwe run"-button (disabled
 * with tooltip when there's already an active run).
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  ArrowLeft,
  Briefcase,
  Loader2,
  MapPin,
  Play,
  Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { AiDisclosureBadge } from "@/components/ai/AiDisclosureBadge";
import {
  useAgentBrief,
  useAgentRuns,
  useStartRun,
} from "@/hooks/useSourcing";
import {
  RUN_STATUS_PILL,
  RUN_STATUS_ICON,
  formatRelativeNL,
} from "@/components/sourcing/visualHelpers";
import { useJob } from "@/hooks/useJobs";

export default function BriefDetailPage() {
  const { t } = useTranslation("sourcing");
  const params = useParams();
  const briefId = params?.id as string;
  const router = useRouter();
  const { data: brief, isLoading, isError } = useAgentBrief(briefId);
  const { data: runs } = useAgentRuns({ brief_id: briefId });
  const startRun = useStartRun();
  const { toast } = useToast();

  const { data: job } = useJob(brief?.job_id ?? "");
  const activeRun = (runs ?? []).find(
    (r) => r.status === "queued" || r.status === "running"
  );

  if (isLoading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <Skeleton className="h-12 w-1/3 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  if (isError || !brief) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Link
          href="/sourcing-agent"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          {t("briefDetail.back")}
        </Link>
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <AlertCircle className="h-5 w-5 text-rose-500" />
            <p className="text-sm font-medium">
              {isError ? t("briefDetail.error.loadFailed") : t("briefDetail.error.notFound")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleStart = async () => {
    const run = await startRun.mutateAsync({ briefId, trigger: "manual" });
    toast({
      title: t("briefDetail.toasts.runStarted.title"),
      description: t("briefDetail.toasts.runStarted.description"),
    });
    router.push(`/sourcing-agent/runs/${run.id}`);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Link
        href="/sourcing-agent"
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        {t("briefDetail.back")}
      </Link>

      <PageHeader
        title={job?.title ?? brief.job_id}
        description={t("briefDetail.header.description", {
          locations: brief.search_locations.join(" · "),
          count: brief.target_count,
        })}
        actions={
          <div className="flex items-center gap-2">
            <AiDisclosureBadge />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      size="lg"
                      disabled={!!activeRun || startRun.isPending}
                      onClick={handleStart}
                      className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700"
                    >
                      {startRun.isPending ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="mr-1.5 h-4 w-4" />
                      )}
                      {t("briefDetail.startRun")}
                    </Button>
                  </span>
                </TooltipTrigger>
                {activeRun && (
                  <TooltipContent side="bottom" className="max-w-xs text-xs">
                    {t("briefDetail.activeRunTooltip")}
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </div>
        }
      />

      {/* Brief detail */}
      <Card className="border-0 shadow-sm">
        <CardContent className="space-y-4 p-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Briefcase className="h-3.5 w-3.5 text-indigo-500" />
            <Link
              href={`/jobs/${brief.job_id}`}
              className="hover:text-indigo-600 hover:underline"
            >
              {job?.title ?? brief.job_id}
            </Link>
            <span>·</span>
            <MapPin className="h-3.5 w-3.5" />
            {brief.search_locations.join(", ")}
            <span>·</span>
            {t("briefDetail.createdAt", {
              relative: formatRelativeNL(brief.created_at),
            })}
            <span>·</span>
            {brief.active ? (
              <Badge className="border-0 bg-emerald-100 text-[10px] text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                {t("briefDetail.active")}
              </Badge>
            ) : (
              <Badge className="border-0 bg-zinc-100 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {t("briefDetail.archived")}
              </Badge>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("briefDetail.briefLabel")}
            </p>
            <p className="whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">
              {brief.brief_text}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <ChipBlock
              title={t("briefDetail.chips.mustHave")}
              items={brief.must_have}
              color="indigo"
            />
            <ChipBlock
              title={t("briefDetail.chips.niceToHave")}
              items={brief.nice_to_have}
              color="zinc"
            />
            <ChipBlock
              title={t("briefDetail.chips.exclusions")}
              items={brief.exclusions}
              color="red"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              label={t("briefDetail.stats.targetCount")}
              value={String(brief.target_count)}
            />
            <Stat
              label={t("briefDetail.stats.languages")}
              value={brief.language_preferences.join(", ").toUpperCase()}
            />
            <Stat
              label={t("briefDetail.stats.status")}
              value={
                brief.active
                  ? t("briefDetail.statusValue.active")
                  : t("briefDetail.statusValue.archived")
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Recent runs */}
      <section className="space-y-2">
        <h3 className="px-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {t("briefDetail.recentRuns")}
        </h3>
        {(runs ?? []).length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
                <Sparkles className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium">{t("briefDetail.noRuns.title")}</p>
              <p className="text-xs text-muted-foreground">
                {t("briefDetail.noRuns.description")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {(runs ?? []).map((run) => {
                  const StatusIcon = RUN_STATUS_ICON[run.status];
                  const pill = RUN_STATUS_PILL[run.status];
                  return (
                    <li key={run.id}>
                      <Link
                        href={`/sourcing-agent/runs/${run.id}`}
                        className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30"
                      >
                        <div className="flex items-center gap-3">
                          <StatusIcon
                            className={`h-4 w-4 ${
                              run.status === "running"
                                ? "animate-pulse text-indigo-500"
                                : "text-muted-foreground"
                            }`}
                          />
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge className={pill.className}>
                                {pill.label}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {t("briefDetail.runRow.meta", {
                                  iteration: run.expansion_iteration,
                                  trigger: run.trigger,
                                })}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {formatRelativeNL(run.started_at ?? run.created_at)}
                              {run.error_message && (
                                <span className="ml-2 inline-flex items-center gap-1 text-red-600">
                                  <AlertCircle className="h-3 w-3" />
                                  {run.error_message}
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span>
                            <span className="font-semibold">
                              {run.candidates_found}
                            </span>{" "}
                            {t("briefDetail.runRow.found")}
                          </span>
                          <span className="text-emerald-600">
                            {t("briefDetail.runRow.approved", {
                              count: run.candidates_approved,
                            })}
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

function ChipBlock({
  title,
  items,
  color,
}: {
  title: string;
  items: string[];
  color: "indigo" | "zinc" | "red";
}) {
  const cls =
    color === "indigo"
      ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
      : color === "red"
        ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((it) => (
            <span
              key={it}
              className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${cls}`}
            >
              {it}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-zinc-50/60 p-3 dark:bg-zinc-800/30">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </p>
    </div>
  );
}
