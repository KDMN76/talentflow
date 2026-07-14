"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  ChevronRight,
  Mail,
  Plus,
  Send,
  XCircle,
  Loader2,
  Inbox,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBulkCampaigns, type BulkCampaign } from "@/hooks/useBulkCampaigns";
import { CampaignBuilder } from "@/components/communications/CampaignBuilder";

// ─── Status helpers ─────────────────────────────────────────────────────────

// Only the four statuses the backend actually sets (bulk_campaigns_status_check).
const STATUS_STYLES: Record<BulkCampaign["status"], string> = {
  running: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400",
  completed:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  cancelled: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
};

const VIA_LABELS: Record<BulkCampaign["via"], string> = {
  resend: "Resend",
  mailbox_integration: "Mailbox",
};

function StatusIcon({ status }: { status: BulkCampaign["status"] }) {
  if (status === "running") return <Loader2 className="h-3 w-3 animate-spin" />;
  if (status === "completed") return <CheckCircle2 className="h-3 w-3" />;
  if (status === "failed") return <XCircle className="h-3 w-3" />;
  if (status === "cancelled") return <Ban className="h-3 w-3" />;
  return <Mail className="h-3 w-3" />;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const { t } = useTranslation("comms");
  const { data: campaigns, isLoading, isError } = useBulkCampaigns();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [detail, setDetail] = useState<BulkCampaign | null>(null);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("campaigns.title")}
        description={t("campaigns.description")}
        actions={
          <Button
            onClick={() => setBuilderOpen(true)}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            {t("campaigns.newCampaign")}
          </Button>
        }
      />

      {/* Error */}
      {isError && (
        <Card className="border-destructive/40 bg-destructive/5 shadow-none">
          <CardContent className="p-5 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
            <p className="text-sm text-destructive">
              {t("campaigns.error")}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {isLoading && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
            {t("campaigns.loading")}
          </CardContent>
        </Card>
      )}

      {/* Empty */}
      {!isLoading && (campaigns?.length ?? 0) === 0 && !isError && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-10 text-center space-y-3">
            <Inbox className="h-10 w-10 text-muted-foreground/40 mx-auto" />
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t("campaigns.empty.title")}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("campaigns.empty.description")}
              </p>
            </div>
            <Button
              onClick={() => setBuilderOpen(true)}
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700 border-0"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              {t("campaigns.newCampaign")}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* List */}
      {!isLoading && (campaigns?.length ?? 0) > 0 && (
        <div className="space-y-3">
          {campaigns!.map((c) => (
            <CampaignRow
              key={c.id}
              campaign={c}
              onClick={() => setDetail(c)}
            />
          ))}
        </div>
      )}

      {/* Builder dialog */}
      <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
        <DialogContent className="sm:max-w-[860px] max-h-[92vh] overflow-y-auto p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>{t("campaigns.dialogTitle")}</DialogTitle>
          </DialogHeader>
          <CampaignBuilder
            onClose={() => setBuilderOpen(false)}
            onCreated={(campaign) => {
              setBuilderOpen(false);
              setDetail(campaign);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <CampaignDetailDialog
        campaign={detail}
        onClose={() => setDetail(null)}
      />
    </div>
  );
}

// ─── Row ────────────────────────────────────────────────────────────────────

function CampaignRow({
  campaign,
  onClick,
}: {
  campaign: BulkCampaign;
  onClick: () => void;
}) {
  const { t } = useTranslation("comms");
  const total = campaign.total_eligible;
  const sent = campaign.total_sent;
  const failed = campaign.total_failed;
  const skipped = campaign.total_skipped_consent;
  const pct = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border bg-white dark:bg-zinc-900 hover:border-indigo-300 hover:shadow-sm transition-all p-4 group"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {campaign.subject}
            </p>
            <Badge
              className={`text-[10px] px-1.5 py-0 border-0 inline-flex items-center gap-1 ${STATUS_STYLES[campaign.status]}`}
            >
              <StatusIcon status={campaign.status} />
              {t(`campaigns.status.${campaign.status}`)}
            </Badge>
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 font-mono"
            >
              {t("campaigns.row.via", { provider: VIA_LABELS[campaign.via] })}
            </Badge>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-zinc-300 group-hover:text-indigo-500 transition-colors shrink-0 mt-1" />
      </div>

      {/* Progress */}
      <div className="space-y-1.5">
        <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              campaign.status === "failed"
                ? "bg-red-500"
                : campaign.status === "completed"
                ? "bg-emerald-500"
                : "bg-gradient-to-r from-indigo-500 to-purple-600"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>
            {t("campaigns.row.sentProgress", { sent, total, pct })}
          </span>
          {skipped > 0 && (
            <span>{t("campaigns.row.skipped", { count: skipped })}</span>
          )}
          {failed > 0 && (
            <span className="text-red-600 dark:text-red-400">
              {t("campaigns.row.failed", { count: failed })}
            </span>
          )}
          <span className="ml-auto">
            {new Date(campaign.started_at).toLocaleDateString("nl-NL", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        </div>
      </div>
    </button>
  );
}

// ─── Detail dialog ──────────────────────────────────────────────────────────

function CampaignDetailDialog({
  campaign,
  onClose,
}: {
  campaign: BulkCampaign | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("comms");
  if (!campaign) return null;

  const total = campaign.total_eligible;
  const sent = campaign.total_sent;
  const pct = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;

  return (
    <Dialog open={!!campaign} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[760px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            <Send className="h-4 w-4 text-indigo-600" />
            {campaign.subject}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Status row */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={`text-xs px-2 py-0.5 border-0 inline-flex items-center gap-1 ${STATUS_STYLES[campaign.status]}`}
            >
              <StatusIcon status={campaign.status} />
              {t(`campaigns.status.${campaign.status}`)}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {t("campaigns.row.via", { provider: VIA_LABELS[campaign.via] })}
            </Badge>
            {campaign.mailbox_integration_id && (
              <Link
                href="/settings/integrations"
                className="text-xs text-indigo-600 hover:underline"
              >
                {t("campaigns.detail.viewMailboxIntegration")}
              </Link>
            )}
          </div>

          {/* Subject */}
          <div className="rounded-lg border border-border bg-zinc-50 dark:bg-zinc-900/40 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              {t("campaigns.detail.subjectLabel")}
            </p>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {campaign.subject}
            </p>
          </div>

          {/* Body preview */}
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="bg-zinc-50 dark:bg-zinc-900/40 px-4 py-2 border-b border-border">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("campaigns.detail.bodyLabel")}
              </p>
            </div>
            <div
              className="prose prose-sm dark:prose-invert max-w-none px-4 py-3 bg-white dark:bg-zinc-900 text-sm text-zinc-800 dark:text-zinc-200"
              /* eslint-disable-next-line react/no-danger -- preview only */
              dangerouslySetInnerHTML={{ __html: campaign.body_html }}
            />
          </div>

          {/* Counts */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <CountTile label={t("campaigns.detail.counts.inAudience")} value={total} />
            <CountTile
              label={t("campaigns.detail.counts.skipped")}
              value={campaign.total_skipped_consent}
            />
            <CountTile
              label={t("campaigns.detail.counts.sent")}
              value={campaign.total_sent}
              accent="emerald"
            />
            <CountTile
              label={t("campaigns.detail.counts.failed")}
              value={campaign.total_failed}
              accent={campaign.total_failed > 0 ? "red" : undefined}
            />
          </div>

          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="h-2.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  campaign.status === "failed"
                    ? "bg-red-500"
                    : campaign.status === "completed"
                    ? "bg-emerald-500"
                    : "bg-gradient-to-r from-indigo-500 to-purple-600"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t("campaigns.detail.progress", { pct, sent, total })}
            </p>
          </div>

          {/* Timestamps — the backend row has no `created_at`; started_at is
              the creation moment (INSERT default now()). */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <TimeBox
              label={t("campaigns.detail.timestamps.started")}
              iso={campaign.started_at}
            />
            <TimeBox
              label={t("campaigns.detail.timestamps.completed")}
              iso={campaign.completed_at}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CountTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "emerald" | "red";
}) {
  const color =
    accent === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : accent === "red"
      ? "text-red-600 dark:text-red-400"
      : "text-zinc-900 dark:text-zinc-100";
  return (
    <div className="rounded-lg border border-border bg-white dark:bg-zinc-900 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function TimeBox({ label, iso }: { label: string; iso: string | null }) {
  const { t } = useTranslation("comms");
  return (
    <div className="rounded-lg border border-border bg-zinc-50/50 dark:bg-zinc-900/40 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-xs text-zinc-700 dark:text-zinc-300 mt-0.5">
        {iso ? new Date(iso).toLocaleString("nl-NL") : t("campaigns.detail.empty")}
      </p>
    </div>
  );
}
