"use client";

/**
 * Sprint Q4.5 — Run detail page.
 *
 * Two-column layout:
 *   - left: chronological reasoning_log timeline + cancel button
 *   - right: findings grid with match-score gauge, expandable reasoning, source
 *     link, and approve/reject actions per card. Bulk action bar at top.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  ArrowLeft,
  Briefcase,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Square,
  CheckSquare,
  CheckCircle2,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { AiDisclosureBadge } from "@/components/ai/AiDisclosureBadge";
import {
  useAgentRun,
  useAgentBrief,
  useAgentFindings,
  useApproveFinding,
  useRejectFinding,
  useBulkApproveFindings,
  useBulkRejectFindings,
  useCancelRun,
  useSourcingSources,
} from "@/hooks/useSourcing";
import {
  RUN_STATUS_PILL,
  FINDING_STATUS_PILL,
  RUN_STATUS_ICON,
  MatchScoreGauge,
  reasoningStepIcon,
  formatDateTimeNL,
  formatRelativeNL,
  getInitials,
} from "@/components/sourcing/visualHelpers";
import { useJob } from "@/hooks/useJobs";
import type { AgentFinding } from "@/lib/types/sourcing";

export default function RunDetailPage() {
  const { t } = useTranslation("sourcing");
  const params = useParams();
  const runId = params?.id as string;

  const { data: run, isLoading, isError } = useAgentRun(runId);
  const { data: brief } = useAgentBrief(run?.brief_id);
  const { data: findings } = useAgentFindings(runId);
  const { data: job } = useJob(brief?.job_id ?? "");
  const { data: sources } = useSourcingSources();
  const externalSourcesEnabled = (sources ?? []).some(
    (s) => s.external && s.enabled
  );
  const cancelRun = useCancelRun();
  const bulkApprove = useBulkApproveFindings();
  const bulkReject = useBulkRejectFindings();
  const { toast } = useToast();

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState("");

  const selectedIds = Object.entries(selected)
    .filter(([, v]) => v)
    .map(([k]) => k);

  if (isLoading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <Skeleton className="h-12 w-1/3 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  if (isError || !run) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Link
          href="/sourcing-agent"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          {t("runDetail.back")}
        </Link>
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <AlertCircle className="h-5 w-5 text-rose-500" />
            <p className="text-sm font-medium">
              {isError ? t("runDetail.error.loadFailed") : t("runDetail.error.notFound")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const StatusIcon = RUN_STATUS_ICON[run.status];
  const pill = RUN_STATUS_PILL[run.status];
  const canCancel = run.status === "queued" || run.status === "running";

  return (
    <div className="space-y-6 animate-fade-in">
      <Link
        href="/sourcing-agent"
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        {t("runDetail.back")}
      </Link>

      <PageHeader
        title={t("runDetail.header.title", { id: run.id })}
        description={
          brief && job
            ? t("runDetail.header.briefWithTitle", { title: job.title })
            : t("runDetail.header.briefFallback", { briefId: run.brief_id })
        }
        actions={
          <div className="flex items-center gap-2">
            <AiDisclosureBadge />
            {canCancel && (
              <Button
                variant="outline"
                size="sm"
                disabled={cancelRun.isPending}
                onClick={async () => {
                  await cancelRun.mutateAsync(runId);
                  toast({ title: t("runDetail.toasts.runCancelled") });
                }}
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {cancelRun.isPending && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                <X className="mr-1.5 h-3.5 w-3.5" />
                {t("runDetail.cancelRun")}
              </Button>
            )}
          </div>
        }
      />

      {/* Header card */}
      <Card className="border-0 shadow-sm">
        <CardContent className="flex flex-wrap items-center gap-4 p-5">
          <div className="flex items-center gap-2">
            <StatusIcon
              className={`h-4 w-4 ${
                run.status === "running"
                  ? "animate-pulse text-indigo-500"
                  : "text-muted-foreground"
              }`}
            />
            <Badge className={pill.className}>{pill.label}</Badge>
          </div>
          {brief && (
            <Link
              href={`/sourcing-agent/briefs/${brief.id}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              <Briefcase className="h-3.5 w-3.5" />
              {job?.title ?? brief.id}
            </Link>
          )}
          <span className="text-xs text-muted-foreground">
            {t("runDetail.startedAt", {
              relative: formatRelativeNL(run.started_at ?? run.created_at),
            })}
          </span>
          {run.finished_at && (
            <span className="text-xs text-muted-foreground">
              {t("runDetail.finishedAt", {
                relative: formatRelativeNL(run.finished_at),
              })}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {t("runDetail.iteration", { count: run.expansion_iteration })}
          </span>
          <div className="ml-auto flex items-center gap-4 text-xs">
            <span>
              <span className="font-semibold">{run.candidates_found}</span>{" "}
              {t("runDetail.stats.found")}
            </span>
            <span className="text-emerald-600">
              {t("runDetail.stats.approved", { count: run.candidates_approved })}
            </span>
            <span className="text-red-500">
              {t("runDetail.stats.rejected", { count: run.candidates_rejected })}
            </span>
          </div>
        </CardContent>
      </Card>

      {run.error_message && (
        <Card className="border-red-200 bg-red-50 shadow-sm dark:border-red-900 dark:bg-red-950/20">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-red-800 dark:text-red-300">
            <AlertCircle className="h-4 w-4" />
            {run.error_message}
          </CardContent>
        </Card>
      )}

      {/* Two columns */}
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* Reasoning log */}
        <section className="space-y-2">
          <h3 className="px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t("runDetail.reasoning.title")}
          </h3>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5">
              <ReasoningTimeline run={run} />
            </CardContent>
          </Card>
        </section>

        {/* Findings grid */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t("runDetail.candidates.title", {
                count: (findings ?? []).length,
              })}
            </h3>
            {selectedIds.length > 0 && (
              <div className="flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-300">
                {t("runDetail.candidates.selectedCount", {
                  count: selectedIds.length,
                })}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px] hover:bg-emerald-100 hover:text-emerald-700"
                  onClick={async () => {
                    await bulkApprove.mutateAsync({ ids: selectedIds });
                    toast({
                      title: t("runDetail.toasts.bulkApproved", {
                        count: selectedIds.length,
                      }),
                    });
                    setSelected({});
                  }}
                  disabled={bulkApprove.isPending}
                >
                  {t("runDetail.candidates.approve")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px] hover:bg-red-100 hover:text-red-700"
                  onClick={() => setBulkRejectOpen(true)}
                >
                  {t("runDetail.candidates.reject")}
                </Button>
              </div>
            )}
          </div>
          {!findings || findings.length === 0 ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                {run.status === "queued" || run.status === "running" ? (
                  <>
                    <p className="text-sm font-medium">
                      {t("runDetail.findings.empty.title")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("runDetail.findings.empty.description")}
                    </p>
                  </>
                ) : !externalSourcesEnabled ? (
                  // Eerlijke uitleg: er zijn geen externe bronnen actief, dus
                  // alleen de eigen database is doorzocht.
                  <>
                    <AlertCircle className="h-6 w-6 text-amber-500" />
                    <p className="text-sm font-medium">
                      {t("runDetail.findings.noSources.title")}
                    </p>
                    <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                      {t("runDetail.findings.noSources.description")}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium">
                      {t("runDetail.findings.noneFound.title")}
                    </p>
                    <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                      {t("runDetail.findings.noneFound.description")}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {findings.map((f) => (
                <FindingCard
                  key={f.id}
                  finding={f}
                  selected={!!selected[f.id]}
                  onToggleSelect={(v) =>
                    setSelected((cur) => ({ ...cur, [f.id]: v }))
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <Dialog
        open={bulkRejectOpen}
        onOpenChange={(o) => {
          if (!o) setBulkRejectOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("runDetail.bulkReject.title", { count: selectedIds.length })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {t("runDetail.bulkReject.description")}
            </p>
            <Textarea
              rows={3}
              placeholder={t("runDetail.bulkReject.placeholder")}
              value={bulkRejectReason}
              onChange={(e) => setBulkRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkRejectOpen(false)}>
              {t("runDetail.bulkReject.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={!bulkRejectReason.trim() || bulkReject.isPending}
              onClick={async () => {
                await bulkReject.mutateAsync({
                  ids: selectedIds,
                  reason: bulkRejectReason.trim(),
                });
                toast({
                  title: t("runDetail.toasts.bulkRejected", {
                    count: selectedIds.length,
                  }),
                });
                setSelected({});
                setBulkRejectReason("");
                setBulkRejectOpen(false);
              }}
            >
              {bulkReject.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              {t("runDetail.bulkReject.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReasoningTimeline({
  run,
}: {
  run: import("@/lib/types/sourcing").AgentRun;
}) {
  const { t } = useTranslation("sourcing");
  if (run.reasoning_log.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("runDetail.reasoning.empty")}
      </p>
    );
  }
  return (
    <ol className="relative space-y-3 border-l border-border pl-4">
      {run.reasoning_log.map((entry, idx) => (
        <li key={`${entry.ts}-${idx}`} className="relative">
          <span className="absolute -left-[21px] top-1 flex h-3 w-3 items-center justify-center rounded-full border-2 border-white bg-indigo-500 dark:border-zinc-900" />
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-900 dark:text-zinc-100">
            {reasoningStepIcon(entry.step)}
            <span className="capitalize">{entry.step.replace(/_/g, " ")}</span>
            <span className="text-[11px] font-normal text-muted-foreground">
              · {formatDateTimeNL(entry.ts)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            {entry.reason}
          </p>
        </li>
      ))}
      {(run.status === "running" || run.status === "queued") && (
        <li className="relative">
          <span className="absolute -left-[21px] top-1 flex h-3 w-3 items-center justify-center rounded-full border-2 border-white bg-indigo-300 dark:border-zinc-900">
            <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
          </span>
          <p className="text-xs italic text-muted-foreground">
            {t("runDetail.reasoning.thinking")}
          </p>
        </li>
      )}
    </ol>
  );
}

function FindingCard({
  finding,
  selected,
  onToggleSelect,
}: {
  finding: AgentFinding;
  selected: boolean;
  onToggleSelect: (v: boolean) => void;
}) {
  const { t } = useTranslation("sourcing");
  const [expanded, setExpanded] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const approve = useApproveFinding();
  const reject = useRejectFinding();
  const { toast } = useToast();

  const pill = FINDING_STATUS_PILL[finding.status];
  const canAct = finding.status === "pending_review";

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => onToggleSelect(!selected)}
            className="mt-1 text-zinc-400 hover:text-indigo-600"
            aria-label={t("runDetail.findingCard.selectAria")}
          >
            {selected ? (
              <CheckSquare className="h-4 w-4 text-indigo-600" />
            ) : (
              <Square className="h-4 w-4" />
            )}
          </button>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-xs font-semibold text-white">
            {getInitials(finding.full_name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {finding.full_name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {t("runDetail.findingCard.title", {
                    title: finding.current_title,
                    company: finding.current_company,
                  })}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t("runDetail.findingCard.locationSource", {
                    location: finding.location,
                    source: finding.external_source,
                  })}
                </p>
              </div>
              <MatchScoreGauge score={finding.match_score} />
            </div>
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            {t("runDetail.findingCard.aiReasoning")}
          </button>
          <p
            className={
              expanded
                ? "mt-1 text-xs text-zinc-700 dark:text-zinc-300"
                : "mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400"
            }
          >
            {finding.match_reasoning}
          </p>
        </div>

        <div className="flex flex-wrap gap-1">
          {finding.skills.slice(0, 6).map((s) => (
            <span
              key={s}
              className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {s}
            </span>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2 text-[11px]">
            <Badge className={pill.className}>{pill.label}</Badge>
            {finding.external_url && (
              <a
                href={finding.external_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-indigo-600"
              >
                <ExternalLink className="h-3 w-3" />
                {t("runDetail.findingCard.source")}
              </a>
            )}
          </div>
          {canAct && (
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                disabled={approve.isPending}
                onClick={async () => {
                  await approve.mutateAsync({ id: finding.id });
                  toast({ title: t("runDetail.toasts.approved") });
                }}
              >
                <CheckCircle2 className="mr-1 h-3 w-3 text-emerald-500" />
                {t("runDetail.findingCard.approve")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[11px] text-muted-foreground hover:text-red-600"
                onClick={() => setRejectOpen(true)}
              >
                <X className="mr-1 h-3 w-3" />
                {t("runDetail.findingCard.reject")}
              </Button>
            </div>
          )}
        </div>

        <Dialog
          open={rejectOpen}
          onOpenChange={(o) => {
            if (!o) setRejectOpen(false);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {t("runDetail.findingCard.rejectDialog.title")}
              </DialogTitle>
            </DialogHeader>
            <Textarea
              rows={3}
              placeholder={t("runDetail.findingCard.rejectDialog.placeholder")}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRejectOpen(false)}>
                {t("runDetail.findingCard.rejectDialog.cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={!rejectReason.trim() || reject.isPending}
                onClick={async () => {
                  await reject.mutateAsync({
                    id: finding.id,
                    reason: rejectReason.trim(),
                  });
                  toast({ title: t("runDetail.toasts.rejected") });
                  setRejectReason("");
                  setRejectOpen(false);
                }}
              >
                {reject.isPending && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                {t("runDetail.findingCard.rejectDialog.reject")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
