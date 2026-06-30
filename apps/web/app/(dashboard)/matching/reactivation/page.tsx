"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "next/navigation";
import { Sparkles, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AlertRow } from "@/components/matching/ReactivationAlertsWidget";
import { AIBadge } from "@/components/matching/AIBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useJobs } from "@/hooks/useJobs";
import {
  useReactivationAlerts,
  useReactivationStats,
} from "@/hooks/useReactivation";
import type { ReactivationAlertStatus } from "@/lib/types/reactivation";

const STATUS_OPTIONS: Array<{
  value: "all" | ReactivationAlertStatus;
}> = [
  { value: "all" },
  { value: "new" },
  { value: "acknowledged" },
  { value: "dismissed" },
];

const SCORE_RANGES: Array<{
  value: string;
  min?: number;
  max?: number;
}> = [
  { value: "all" },
  { value: "high", min: 80 },
  { value: "mid", min: 60, max: 79 },
  { value: "low", max: 59 },
];

export default function ReactivationAlertsPage() {
  const { t } = useTranslation("miscPortals");
  const searchParams = useSearchParams();
  const initialJobId = searchParams.get("job_id") ?? "all";

  const [jobId, setJobId] = useState<string>(initialJobId);
  const [status, setStatus] = useState<"all" | ReactivationAlertStatus>("new");
  const [scoreRange, setScoreRange] = useState<string>("all");

  const range = SCORE_RANGES.find((r) => r.value === scoreRange);

  const { data: alerts, isLoading } = useReactivationAlerts({
    job_id: jobId === "all" ? undefined : jobId,
    status,
    min_score: range?.min,
    max_score: range?.max,
  });
  const { data: stats } = useReactivationStats();
  const { data: jobs } = useJobs({ status: "open" });

  const sortedAlerts = useMemo(() => alerts ?? [], [alerts]);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("reactivation.header.title")}
        description={t("reactivation.header.description")}
        actions={
          <div className="flex items-center gap-2">
            <AIBadge label={t("reactivation.header.aiLabel")} />
            {stats && stats.unacknowledged > 0 && (
              <Badge
                variant="outline"
                className="bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900"
              >
                {t("reactivation.header.newThisWeek", {
                  count: stats.unacknowledged,
                })}
              </Badge>
            )}
          </div>
        }
      />

      <Card className="border-0 shadow-sm">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5 min-w-[220px]">
              <label className="text-xs font-medium text-muted-foreground">
                {t("reactivation.filters.jobLabel")}
              </label>
              <Select value={jobId} onValueChange={setJobId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("reactivation.filters.allJobs")}
                  </SelectItem>
                  {(jobs ?? []).map((j) => (
                    <SelectItem key={j.id} value={j.id}>
                      {j.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 min-w-[180px]">
              <label className="text-xs font-medium text-muted-foreground">
                {t("reactivation.filters.statusLabel")}
              </label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as typeof status)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {t(`reactivation.statusOptions.${o.value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 min-w-[180px]">
              <label className="text-xs font-medium text-muted-foreground">
                {t("reactivation.filters.scoreLabel")}
              </label>
              <Select value={scoreRange} onValueChange={setScoreRange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCORE_RANGES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {t(`reactivation.scoreRanges.${o.value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(jobId !== "all" || status !== "new" || scoreRange !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setJobId("all");
                  setStatus("new");
                  setScoreRange("all");
                }}
              >
                {t("reactivation.filters.reset")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : sortedAlerts.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-16 text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-purple-50 dark:bg-purple-950/40 flex items-center justify-center">
              <Users className="h-5 w-5 text-purple-500" />
            </div>
            <p className="mt-3 text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {t("reactivation.empty.title")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
              {t("reactivation.empty.description")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-purple-500" />
            <span>
              <span className="font-medium text-foreground">
                {sortedAlerts.length}
              </span>{" "}
              {t("reactivation.results.noun", { count: sortedAlerts.length })}{" "}
              {t("reactivation.results.found")}
            </span>
          </div>
          <div className="space-y-3">
            {sortedAlerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
