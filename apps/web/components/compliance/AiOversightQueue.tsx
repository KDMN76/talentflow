"use client";

/**
 * Recruiter-review-wachtrij voor AI-actievoorstellen
 * (EU AI Act art. 14 — human oversight).
 *
 * De workflow-engine voert automatische afwijzingen niet uit maar zet ze hier
 * als voorstel klaar. Een recruiter keurt goed (actie wordt alsnog uitgevoerd)
 * of wijst af (actie wordt geblokkeerd). Elke beslissing wordt append-only
 * gelogd in audit_events.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Check,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  useAiProposals,
  useDecideAiProposal,
  type AiActionProposal,
  type AiProposalStatus,
} from "@/hooks/useAiOversight";

const STATUS_BADGE_CLASSES: Record<AiProposalStatus, string> = {
  pending_review:
    "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  approved:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  rejected: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  failed: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ProposalRow({
  proposal,
  pending,
}: {
  proposal: AiActionProposal;
  pending: boolean;
}) {
  const { t } = useTranslation("aiCompliance");
  const { toast } = useToast();
  const decide = useDecideAiProposal();
  const [note, setNote] = useState("");

  const handleDecision = async (decision: "approve" | "reject") => {
    try {
      const result = await decide.mutateAsync({
        id: proposal.id,
        decision,
        note: note.trim() || null,
      });
      if (decision === "approve") {
        toast({
          title: t("oversight.queue.toasts.approved"),
          description: result.executed
            ? t("oversight.queue.toasts.approvedDescription")
            : t("oversight.queue.toasts.approvedNotExecuted"),
          variant: result.executed ? undefined : "destructive",
        });
      } else {
        toast({
          title: t("oversight.queue.toasts.rejected"),
          description: t("oversight.queue.toasts.rejectedDescription"),
        });
      }
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status;
      toast({
        title: t("oversight.queue.toasts.failed"),
        description:
          status === 409
            ? t("oversight.queue.toasts.alreadyDecided")
            : status === 403
            ? t("oversight.queue.toasts.forbidden")
            : undefined,
        variant: "destructive",
      });
    }
  };

  const meta: Array<{ label: string; value: string | null }> = [
    { label: t("oversight.queue.candidate"), value: proposal.candidate_name },
    { label: t("oversight.queue.job"), value: proposal.job_title },
    { label: t("oversight.queue.workflow"), value: proposal.workflow_name },
    {
      label: t("oversight.queue.targetStage"),
      value:
        proposal.target_stage_name ??
        ((proposal.action_config?.stage_name as string) || null),
    },
    { label: t("oversight.queue.trigger"), value: proposal.trigger_event },
  ];

  return (
    <div className="rounded-xl border border-border bg-white dark:bg-zinc-950 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="secondary"
              className={STATUS_BADGE_CLASSES[proposal.status]}
            >
              {t(`oversight.queue.status.${proposal.status}`)}
            </Badge>
            <span className="text-xs font-mono text-muted-foreground">
              {proposal.action_type}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("oversight.queue.proposedAt")}:{" "}
              {formatDateTime(proposal.proposed_at)}
            </span>
            {proposal.decided_at && (
              <span className="text-xs text-muted-foreground">
                {t("oversight.queue.decidedAt")}:{" "}
                {formatDateTime(proposal.decided_at)}
              </span>
            )}
          </div>

          {proposal.reason && (
            <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300 leading-snug">
              {proposal.reason}
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {meta
              .filter((m) => m.value)
              .map((m) => (
                <span key={m.label} className="text-xs text-muted-foreground">
                  <span className="font-medium text-zinc-600 dark:text-zinc-400">
                    {m.label}:
                  </span>{" "}
                  {m.value}
                </span>
              ))}
          </div>

          {proposal.decision_note && (
            <p className="mt-2 rounded-md bg-zinc-50 dark:bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 italic">
              “{proposal.decision_note}”
            </p>
          )}
        </div>
      </div>

      {pending && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("oversight.queue.notePlaceholder")}
            className="min-h-[60px] text-sm"
            maxLength={2000}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={decide.isPending}
              onClick={() => handleDecision("reject")}
              className="gap-1.5"
            >
              {decide.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
              {t("oversight.queue.reject")}
            </Button>
            <Button
              size="sm"
              disabled={decide.isPending}
              onClick={() => handleDecision("approve")}
              className="gap-1.5"
            >
              {decide.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {t("oversight.queue.approve")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AiOversightQueue() {
  const { t } = useTranslation("aiCompliance");
  const [tab, setTab] = useState<"pending" | "decided">("pending");

  const pendingQuery = useAiProposals("pending_review");
  const allQuery = useAiProposals();

  const pending = pendingQuery.data ?? [];
  const decided = (allQuery.data ?? []).filter(
    (p) => p.status !== "pending_review"
  );

  const isLoading =
    tab === "pending" ? pendingQuery.isLoading : allQuery.isLoading;
  const rows = tab === "pending" ? pending : decided;

  return (
    <Card className="border shadow-sm">
      <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Bot className="h-4 w-4 text-indigo-500" />
          {t("oversight.queue.title")}
          {pending.length > 0 && (
            <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
              {pending.length > 99 ? "99+" : pending.length}
            </span>
          )}
        </CardTitle>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="h-9">
            <TabsTrigger value="pending" className="px-4 text-xs">
              {t("oversight.queue.pendingTab")}
            </TabsTrigger>
            <TabsTrigger value="decided" className="px-4 text-xs">
              {t("oversight.queue.decidedTab")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-10 text-center">
            {tab === "pending" ? (
              <ShieldCheck className="mb-2 h-8 w-8 text-emerald-500/60" />
            ) : (
              <ShieldAlert className="mb-2 h-8 w-8 text-muted-foreground/40" />
            )}
            <p
              className={cn(
                "text-sm",
                tab === "pending"
                  ? "text-zinc-700 dark:text-zinc-300 font-medium"
                  : "text-muted-foreground"
              )}
            >
              {tab === "pending"
                ? t("oversight.queue.emptyPending")
                : t("oversight.queue.emptyDecided")}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((p) => (
              <ProposalRow
                key={p.id}
                proposal={p}
                pending={tab === "pending"}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
