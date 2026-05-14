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
import { mockJobs } from "@/lib/mockData";
import type { AgentFinding } from "@/lib/types/sourcing";

export default function RunDetailPage() {
  const params = useParams();
  const runId = params?.id as string;

  const { data: run, isLoading } = useAgentRun(runId);
  const { data: brief } = useAgentBrief(run?.brief_id);
  const { data: findings } = useAgentFindings(runId);
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

  const job = brief ? mockJobs.find((j) => j.id === brief.job_id) : undefined;

  if (isLoading || !run) {
    return (
      <div className="space-y-4 animate-fade-in">
        <Skeleton className="h-12 w-1/3 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
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
        Terug naar Sourcing Agent
      </Link>

      <PageHeader
        title={`Run ${run.id}`}
        description={
          brief && job
            ? `Brief: ${job.title}`
            : `Brief ${run.brief_id}`
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
                  toast({ title: "Run geannuleerd" });
                }}
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {cancelRun.isPending && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                <X className="mr-1.5 h-3.5 w-3.5" />
                Cancel run
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
            Gestart {formatRelativeNL(run.started_at ?? run.created_at)}
          </span>
          {run.finished_at && (
            <span className="text-xs text-muted-foreground">
              Afgerond {formatRelativeNL(run.finished_at)}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            iter {run.expansion_iteration}
          </span>
          <div className="ml-auto flex items-center gap-4 text-xs">
            <span>
              <span className="font-semibold">{run.candidates_found}</span> gevonden
            </span>
            <span className="text-emerald-600">
              {run.candidates_approved} goedgekeurd
            </span>
            <span className="text-red-500">
              {run.candidates_rejected} afgewezen
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
            Redenering
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
              Kandidaten ({(findings ?? []).length})
            </h3>
            {selectedIds.length > 0 && (
              <div className="flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-300">
                {selectedIds.length} geselecteerd
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px] hover:bg-emerald-100 hover:text-emerald-700"
                  onClick={async () => {
                    await bulkApprove.mutateAsync({ ids: selectedIds });
                    toast({
                      title: `${selectedIds.length} kandidaten goedgekeurd`,
                    });
                    setSelected({});
                  }}
                  disabled={bulkApprove.isPending}
                >
                  Goedkeuren
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px] hover:bg-red-100 hover:text-red-700"
                  onClick={() => setBulkRejectOpen(true)}
                >
                  Afwijzen
                </Button>
              </div>
            )}
          </div>
          {!findings || findings.length === 0 ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <p className="text-sm font-medium">Nog geen findings</p>
                <p className="text-xs text-muted-foreground">
                  De agent is bezig — kandidaten verschijnen zodra ze gescoord zijn.
                </p>
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
            <DialogTitle>{selectedIds.length} kandidaten afwijzen</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Geef een reden — deze wordt opgeslagen in het audit-spoor.
            </p>
            <Textarea
              rows={3}
              placeholder="Bijv. 'Te ver weg', 'Onvoldoende ervaring met Snowflake'..."
              value={bulkRejectReason}
              onChange={(e) => setBulkRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkRejectOpen(false)}>
              Annuleren
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
                  title: `${selectedIds.length} kandidaten afgewezen`,
                });
                setSelected({});
                setBulkRejectReason("");
                setBulkRejectOpen(false);
              }}
            >
              {bulkReject.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Afwijzen
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
  if (run.reasoning_log.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nog geen redenering — de agent staat nog in de wachtrij.
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
            Agent denkt nog na...
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
            aria-label="Selecteer kandidaat"
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
                  {finding.current_title} · {finding.current_company}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {finding.location} · bron: {finding.external_source}
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
            AI-redenering
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
                Bron
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
                  toast({ title: "Goedgekeurd" });
                }}
              >
                <CheckCircle2 className="mr-1 h-3 w-3 text-emerald-500" />
                Goedkeuren
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[11px] text-muted-foreground hover:text-red-600"
                onClick={() => setRejectOpen(true)}
              >
                <X className="mr-1 h-3 w-3" />
                Afwijzen
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
              <DialogTitle>Kandidaat afwijzen</DialogTitle>
            </DialogHeader>
            <Textarea
              rows={3}
              placeholder="Geef een reden..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRejectOpen(false)}>
                Annuleren
              </Button>
              <Button
                variant="destructive"
                disabled={!rejectReason.trim() || reject.isPending}
                onClick={async () => {
                  await reject.mutateAsync({
                    id: finding.id,
                    reason: rejectReason.trim(),
                  });
                  toast({ title: "Afgewezen" });
                  setRejectReason("");
                  setRejectOpen(false);
                }}
              >
                {reject.isPending && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                Afwijzen
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
