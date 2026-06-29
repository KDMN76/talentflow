"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
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

interface PipelineListViewProps {
  applications: Application[];
  stages: PipelineStage[];
  jobId: string;
  /** Show the exact application date instead of a relative one. */
  showAbsoluteDate?: boolean;
}

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
          <tr className="border-b border-border bg-zinc-50/60 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground dark:bg-zinc-800/40">
            <th className="py-3 pl-5 pr-4">{t("list.columns.candidate")}</th>
            <th className="py-3 px-4">{t("list.columns.stage")}</th>
            <th className="py-3 px-4 text-center">{t("list.columns.score")}</th>
            <th className="py-3 px-4">{t("list.columns.applied")}</th>
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
          {applications.map((app) => {
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
