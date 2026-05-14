"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCheck,
  Eye,
  EyeOff,
  Mail,
  Sparkles,
  Users,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AIBadge } from "@/components/matching/AIBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  ComposeEmailModal,
} from "@/components/communications/ComposeEmailModal";
import {
  useAcknowledgeAlert,
  useDismissAlert,
  useReactivationAlerts,
  useReactivationStats,
} from "@/hooks/useReactivation";
import { cn, getInitials } from "@/lib/utils";
import type {
  ReactivationReason,
  TalentReactivationAlert,
} from "@/lib/types/reactivation";

/**
 * "Reactivation alerts" widget — surfaces candidates already in the database
 * that newly match an open vacancy, so the recruiter can re-engage them
 * instead of sourcing fresh.
 *
 * Two rendering modes:
 *  - `variant="dashboard"`: compact card with aggregate stats. Click expands
 *    a modal listing every open alert across all jobs.
 *  - `variant="job-tab"`:   per-job sub-section, embedded inside the AI Suite
 *    tab on the job-detail page.
 */

export interface ReactivationAlertsWidgetProps {
  variant: "dashboard" | "job-tab";
  /** Required when variant="job-tab" — scopes alerts to a single vacancy. */
  jobId?: string;
  /** Required when variant="job-tab" — used in card subtitle. */
  jobTitle?: string;
  /** Maximum visible rows in the inline list (default 4). */
  limit?: number;
}

export function ReactivationAlertsWidget(props: ReactivationAlertsWidgetProps) {
  if (props.variant === "dashboard") {
    return <DashboardWidget limit={props.limit ?? 4} />;
  }
  return (
    <JobTabWidget
      jobId={props.jobId!}
      jobTitle={props.jobTitle ?? ""}
      limit={props.limit ?? 4}
    />
  );
}

// ─── Variant A — Dashboard widget ───────────────────────────────────────────

function DashboardWidget({ limit }: { limit: number }) {
  const [open, setOpen] = useState(false);
  const { data: stats, isLoading: statsLoading } = useReactivationStats();
  const { data: alerts } = useReactivationAlerts({ status: "new" });

  const visible = (alerts ?? []).slice(0, limit);
  const overflow = (alerts?.length ?? 0) - visible.length;

  return (
    <>
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-purple-500" />
                Reactivatie-alerts
                <AIBadge label="AI heeft kandidaten in je database gevonden die matchen met openstaande vacatures." />
              </CardTitle>
              <CardDescription className="mt-1">
                {statsLoading
                  ? "Laden..."
                  : stats && stats.unacknowledged > 0
                  ? `${stats.unacknowledged} kandidaten uit je database matchen openstaande vacatures.`
                  : "Geen nieuwe reactivatie-kandidaten op dit moment."}
              </CardDescription>
            </div>
            {stats && stats.unacknowledged > 0 && (
              <Badge
                variant="outline"
                className="bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900 shrink-0"
              >
                {stats.unacknowledged} nieuw
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {visible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-6 text-center">
              <Sparkles className="h-5 w-5 mx-auto text-muted-foreground/60" />
              <p className="mt-2 text-xs text-muted-foreground">
                Zodra een nieuwe match opduikt, zie je hem hier verschijnen.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {visible.map((alert) => (
                <CompactAlertRow key={alert.id} alert={alert} />
              ))}
            </div>
          )}
          <div className="mt-4 flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(true)}
              className="text-xs"
              disabled={(alerts?.length ?? 0) === 0}
            >
              Bekijk alle alerts
              {overflow > 0 && (
                <span className="ml-1 text-muted-foreground">(+{overflow})</span>
              )}
            </Button>
            <Button asChild variant="ghost" size="sm" className="text-xs">
              <Link href="/matching/reactivation">
                Volledige lijst
                <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <ReactivationListDialog
        open={open}
        onOpenChange={setOpen}
        title="Reactivatie-kandidaten"
        description="Kandidaten in je database die matchen met openstaande vacatures."
      />
    </>
  );
}

// ─── Variant B — Job-detail tab widget ──────────────────────────────────────

function JobTabWidget({
  jobId,
  jobTitle,
  limit,
}: {
  jobId: string;
  jobTitle: string;
  limit: number;
}) {
  const { data: alerts, isLoading } = useReactivationAlerts({
    job_id: jobId,
    status: "new",
  });

  const visible = (alerts ?? []).slice(0, limit);
  const overflow = (alerts?.length ?? 0) - visible.length;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-purple-500" />
          Reactivatie-kandidaten
          <AIBadge label="Door AI gemarkeerde kandidaten uit je database die opnieuw matchen met deze vacature." />
        </CardTitle>
        <CardDescription>
          Bestaande kandidaten in je database die matchen met "{jobTitle}". Pak ze
          op voordat je nieuwe sourcing start.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-8 text-center">
            <Sparkles className="h-5 w-5 mx-auto text-muted-foreground/60" />
            <p className="mt-2 text-xs text-muted-foreground">
              Geen reactivatie-kandidaten voor deze vacature.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((alert) => (
              <AlertRow key={alert.id} alert={alert} dense />
            ))}
            {overflow > 0 && (
              <Button asChild variant="ghost" size="sm" className="w-full text-xs">
                <Link href={`/matching/reactivation?job_id=${jobId}`}>
                  Bekijk {overflow} meer
                  <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Compact row (dashboard) ────────────────────────────────────────────────

function CompactAlertRow({ alert }: { alert: TalentReactivationAlert }) {
  return (
    <Link
      href={`/candidates/${alert.candidate_id}`}
      className="group flex items-center gap-3 rounded-lg border border-border p-2.5 hover:border-indigo-200 hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40 transition-colors"
    >
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-xs font-bold">
          {getInitials(alert.candidate_name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate group-hover:text-indigo-600 transition-colors">
          {alert.candidate_name}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {alert.job_title}
          {alert.reasons[0] && (
            <span className="ml-1.5">· {alert.reasons[0].label}</span>
          )}
        </p>
      </div>
      <ScoreBadge percent={alert.match_percent} />
    </Link>
  );
}

// ─── Full alert row (job tab + dialog) ──────────────────────────────────────

export function AlertRow({
  alert,
  dense = false,
}: {
  alert: TalentReactivationAlert;
  dense?: boolean;
}) {
  const { toast } = useToast();
  const acknowledge = useAcknowledgeAlert();
  const dismiss = useDismissAlert();
  const [composeOpen, setComposeOpen] = useState(false);

  const handleAcknowledge = async () => {
    try {
      await acknowledge.mutateAsync(alert.id);
      toast({
        title: "Bevestigd",
        description: "Alert is gemarkeerd als gezien.",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Fout",
        description: "Bevestigen mislukte.",
      });
    }
  };

  const handleDismiss = async () => {
    try {
      await dismiss.mutateAsync(alert.id);
      toast({
        title: "Verborgen",
        description: "Alert is verborgen.",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Fout",
        description: "Verbergen mislukte.",
      });
    }
  };

  return (
    <>
      <div
        className={cn(
          "rounded-xl border border-border bg-card transition-all hover:border-indigo-200 dark:hover:border-indigo-900/60",
          dense ? "p-3" : "p-4"
        )}
      >
        <div className="flex items-start gap-3">
          <Avatar className={cn("shrink-0", dense ? "h-9 w-9" : "h-10 w-10")}>
            <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-xs font-bold">
              {getInitials(alert.candidate_name)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Link
                href={`/candidates/${alert.candidate_id}`}
                className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors truncate"
              >
                {alert.candidate_name}
              </Link>
              <AIBadge />
              {alert.status === "acknowledged" && (
                <Badge variant="info" className="text-[10px]">
                  Bevestigd
                </Badge>
              )}
              {alert.status === "dismissed" && (
                <Badge variant="secondary" className="text-[10px]">
                  Verborgen
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground truncate">
              {alert.candidate_position ?? "Geen functie bekend"}
              {!dense && ` · matched op "${alert.job_title}"`}
            </p>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {alert.reasons.map((reason, i) => (
                <ReasonBadge key={i} reason={reason} />
              ))}
            </div>

            {alert.ai_explanation && !dense && (
              <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed line-clamp-2">
                {alert.ai_explanation}
              </p>
            )}
          </div>

          <ScoreBadge percent={alert.match_percent} large />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
            >
              <Link href={`/candidates/${alert.candidate_id}`}>
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                Bekijk profiel
              </Link>
            </Button>
            {alert.candidate_email && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/40"
                onClick={() => setComposeOpen(true)}
              >
                <Mail className="mr-1.5 h-3.5 w-3.5" />
                Stuur reactivatie-mail
              </Button>
            )}
          </div>
          <div className="flex items-center gap-1">
            {alert.status === "new" && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={handleAcknowledge}
                  disabled={acknowledge.isPending}
                >
                  <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
                  Acknowledge
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-muted-foreground hover:text-foreground"
                  onClick={handleDismiss}
                  disabled={dismiss.isPending}
                >
                  <EyeOff className="mr-1.5 h-3.5 w-3.5" />
                  Verberg
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {alert.candidate_email && (
        <ComposeEmailModal
          open={composeOpen}
          onOpenChange={setComposeOpen}
          candidate={{
            id: alert.candidate_id,
            name: alert.candidate_name,
            email: alert.candidate_email,
            first_name: alert.candidate_name.split(" ")[0] ?? null,
            last_name:
              alert.candidate_name.split(" ").slice(1).join(" ") || null,
          }}
          jobTitle={alert.job_title}
        />
      )}
    </>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function ScoreBadge({
  percent,
  large = false,
}: {
  percent: number;
  large?: boolean;
}) {
  const tone =
    percent >= 80
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
      : percent >= 60
      ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md font-bold tabular-nums",
        large ? "h-10 w-12 text-sm" : "h-7 w-11 text-xs",
        tone
      )}
    >
      {percent}%
    </span>
  );
}

function ReasonBadge({ reason }: { reason: ReactivationReason }) {
  const palette: Record<string, string> = {
    rejected_similar_role:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900",
    profile_updated:
      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900",
    dormant_strong_match:
      "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-900",
    near_miss_previous_round:
      "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-300 dark:border-indigo-900",
    high_score_uncontacted:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900",
  };
  const cls = palette[reason.type] ?? palette.high_score_uncontacted;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        cls
      )}
      title={reason.detail ?? undefined}
    >
      {reason.label}
    </span>
  );
}

// ─── Modal listing all open alerts ──────────────────────────────────────────

function ReactivationListDialog({
  open,
  onOpenChange,
  title,
  description,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
}) {
  const { data: alerts } = useReactivationAlerts({ status: "new" });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-purple-500" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          {(alerts ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Geen open alerts.
            </p>
          ) : (
            (alerts ?? []).map((alert) => (
              <AlertRow key={alert.id} alert={alert} />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
