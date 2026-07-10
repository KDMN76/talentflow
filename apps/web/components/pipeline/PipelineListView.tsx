"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useMoveApplication } from "@/hooks/usePipeline";
import {
  cn,
  getInitials,
  getScoreColor,
  formatDate,
  formatRelativeDate,
} from "@/lib/utils";
import type { Application, PipelineStage } from "@/lib/mockData";
import {
  nextSortState,
  sortApplications,
  type SortColumn,
  type SortState,
} from "./pipelineData";

interface PipelineListViewProps {
  applications: Application[];
  stages: PipelineStage[];
  jobId: string;
  /** Show the exact application date instead of a relative one. */
  showAbsoluteDate?: boolean;
}

/** Column definitions for the sortable table header. */
const COLUMNS: {
  key: SortColumn;
  labelKey: string;
  align: "left" | "center";
  thClass: string;
}[] = [
  { key: "candidate", labelKey: "list.columns.candidate", align: "left", thClass: "py-3 pl-5 pr-4" },
  { key: "stage", labelKey: "list.columns.stage", align: "left", thClass: "py-3 px-4" },
  { key: "score", labelKey: "list.columns.score", align: "center", thClass: "py-3 px-4" },
  { key: "applied", labelKey: "list.columns.applied", align: "left", thClass: "py-3 px-4" },
];

function resolve(application: Application) {
  const name =
    application.candidate?.name ?? application.candidate_name ?? "Onbekend";
  const email =
    application.candidate?.email ?? application.candidate_email ?? "";
  const score = application.candidate?.ai_score ?? application.ai_score ?? null;
  return { name, email, score };
}

/**
 * Tabel-alternatief voor het kanban-board: één rij per sollicitant, met de fase
 * als dropdown (de lijst-equivalent van slepen → roept dezelfde move-mutatie aan).
 */
export function PipelineListView({
  applications,
  stages,
  jobId,
  showAbsoluteDate,
}: PipelineListViewProps) {
  const { t } = useTranslation("pipeline");
  const { toast } = useToast();
  const moveApplication = useMoveApplication();

  const [sort, setSort] = useState<SortState | null>(null);
  const sortedApplications = useMemo(
    () => sortApplications(applications, stages, sort),
    [applications, stages, sort]
  );

  const handleSort = (column: SortColumn) =>
    setSort((prev) => nextSortState(prev, column));

  const handleStageChange = async (app: Application, stageId: string) => {
    if (app.stage_id === stageId) return;
    try {
      await moveApplication.mutateAsync({
        applicationId: app.id,
        stageId,
        jobId,
      });
    } catch {
      toast({
        variant: "destructive",
        title: t("toast.moveFailed.title"),
        description: t("toast.moveFailed.description"),
      });
    }
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-white dark:bg-zinc-900">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-zinc-50/60 text-left dark:bg-zinc-800/40">
            {COLUMNS.map((col) => {
              const isActive = sort?.column === col.key;
              const ariaSort = isActive
                ? sort!.direction === "asc"
                  ? "ascending"
                  : "descending"
                : "none";
              const label = t(col.labelKey);
              return (
                <th
                  key={col.key}
                  aria-sort={ariaSort}
                  className={cn(
                    col.thClass,
                    col.align === "center" && "text-center"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleSort(col.key)}
                    title={t("list.sortBy", { column: label })}
                    className={cn(
                      "group inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground",
                      col.align === "center" && "justify-center"
                    )}
                  >
                    <span>{label}</span>
                    <span className="inline-flex w-3.5 justify-center">
                      {isActive ? (
                        sort!.direction === "asc" ? (
                          <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                        )
                      ) : (
                        <ChevronsUpDown
                          className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-40"
                          aria-hidden
                        />
                      )}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {applications.length === 0 && (
            <tr>
              <td
                colSpan={4}
                className="py-12 text-center text-sm text-muted-foreground"
              >
                {t("list.empty")}
              </td>
            </tr>
          )}
          {sortedApplications.map((app) => {
            const { name, email, score } = resolve(app);
            return (
              <tr
                key={app.id}
                className="transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30"
              >
                <td className="py-3 pl-5 pr-4">
                  <Link
                    href={`/candidates/${app.candidate_id}`}
                    className="group flex items-center gap-3"
                  >
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-xs font-semibold text-white">
                        {getInitials(name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-zinc-900 transition-colors group-hover:text-indigo-600 dark:text-zinc-100">
                        {name}
                      </p>
                      {email && (
                        <p className="truncate text-xs text-muted-foreground">
                          {email}
                        </p>
                      )}
                    </div>
                  </Link>
                </td>
                <td className="py-3 px-4">
                  <Select
                    value={app.stage_id}
                    onValueChange={(v) => handleStageChange(app, v)}
                  >
                    <SelectTrigger className="h-8 w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {stages.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          <span className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ background: s.color }}
                            />
                            {s.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="py-3 px-4 text-center">
                  {score !== null ? (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold",
                        getScoreColor(score)
                      )}
                    >
                      {score}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td
                  className="py-3 px-4 text-xs text-muted-foreground"
                  title={formatDate(app.applied_at)}
                >
                  {showAbsoluteDate
                    ? formatDate(app.applied_at)
                    : formatRelativeDate(app.applied_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
