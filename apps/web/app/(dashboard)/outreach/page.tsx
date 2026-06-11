"use client";

/**
 * Sprint Q4.5 — Outreach hub.
 *
 * Tabs: Te versturen | Verstuurd | Replies | Signals | Quota's.
 * Each tab is its own self-contained component below.
 *
 * AI disclosure banner is permanently shown above the tabs because every
 * single function on this page is AI-driven (drafts, classification, signals).
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell,
  CheckCircle2,
  Edit3,
  Loader2,
  Mail,
  PauseCircle,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  useApproveMessage,
  useDismissSignal,
  useDraftReactivation,
  useOutreachMessages,
  useOutreachQuotas,
  useRegenerateMessage,
  useRejectMessage,
  useReplies,
  useSignals,
  useUpdateQuota,
} from "@/hooks/useOutreach";
import { useSequences } from "@/hooks/useNurture";
import {
  CHANNEL_ICON,
  CHANNEL_LABEL,
  OUTREACH_STATUS_PILL,
  REPLY_CATEGORY_PILL,
  SIGNAL_TYPE_LABEL,
  formatDateTimeNL,
  formatRelativeNL,
  getInitials,
} from "@/components/sourcing/visualHelpers";
import type {
  OutreachChannel,
  OutreachMessage,
} from "@/lib/types/outreach";

export default function OutreachHubPage() {
  const { t } = useTranslation("outreach");
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("hub.title")}
        description={t("hub.description")}
        actions={<AiDisclosureBadge />}
      />
      <AiDisclosureBadge variant="banner" />

      <Tabs defaultValue="pending" className="space-y-4">
        <TabsList>
          <TabsTrigger value="pending">{t("hub.tabs.pending")}</TabsTrigger>
          <TabsTrigger value="sent">{t("hub.tabs.sent")}</TabsTrigger>
          <TabsTrigger value="replies">{t("hub.tabs.replies")}</TabsTrigger>
          <TabsTrigger value="signals">{t("hub.tabs.signals")}</TabsTrigger>
          <TabsTrigger value="quotas">{t("hub.tabs.quotas")}</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <PendingTab />
        </TabsContent>
        <TabsContent value="sent">
          <SentTab />
        </TabsContent>
        <TabsContent value="replies">
          <RepliesTab />
        </TabsContent>
        <TabsContent value="signals">
          <SignalsTab />
        </TabsContent>
        <TabsContent value="quotas">
          <QuotasTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Pending tab (drafts + pending_approval) ─────────────────────────────────

function PendingTab() {
  const { t } = useTranslation("outreach");
  const drafted = useOutreachMessages({ status: "drafted" });
  const pending = useOutreachMessages({ status: "pending_approval" });
  const messages: OutreachMessage[] = [
    ...(pending.data ?? []),
    ...(drafted.data ?? []),
  ];

  if (drafted.isLoading || pending.isLoading) {
    return <Skeleton className="h-72 rounded-xl" />;
  }
  if (messages.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-500 dark:bg-emerald-950/40">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <p className="text-sm font-medium">{t("pending.empty.title")}</p>
          <p className="text-xs text-muted-foreground">
            {t("pending.empty.description")}
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {messages.map((m) => (
        <PendingMessageCard key={m.id} message={m} />
      ))}
    </div>
  );
}

function PendingMessageCard({ message }: { message: OutreachMessage }) {
  const { t } = useTranslation("outreach");
  const [expanded, setExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [hint, setHint] = useState("");
  const [bodyOverride, setBodyOverride] = useState("");
  const approve = useApproveMessage();
  const reject = useRejectMessage();
  const regenerate = useRegenerateMessage();
  const { toast } = useToast();

  const Icon = CHANNEL_ICON[message.channel];
  const statusPill = OUTREACH_STATUS_PILL[message.status];

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-xs font-semibold text-white">
            {getInitials(message.candidate_name ?? message.candidate_id)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {message.candidate_name ?? message.candidate_id}
                </p>
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Icon className="h-3 w-3" />
                  {CHANNEL_LABEL[message.channel]}
                  <span>·</span>
                  {formatRelativeNL(message.created_at)}
                </p>
              </div>
              <Badge className={statusPill.className}>{statusPill.label}</Badge>
            </div>
            {message.subject && (
              <p className="mt-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                {t("pending.subject", { subject: message.subject })}
              </p>
            )}
          </div>
        </div>

        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger className="text-[11px] font-medium text-muted-foreground hover:text-foreground">
            {expanded ? t("pending.hideMessage") : t("pending.showMessage")}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 whitespace-pre-wrap rounded-md bg-zinc-50 p-3 text-xs text-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
              {message.body_text}
            </pre>
          </CollapsibleContent>
        </Collapsible>

        {!expanded && (
          <p className="line-clamp-3 text-xs text-zinc-600 dark:text-zinc-400">
            {message.body_text}
          </p>
        )}

        {Object.keys(message.personalization_signals).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {Object.entries(message.personalization_signals).map(([k, v]) => (
              <span
                key={k}
                className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
              >
                {k}: {v}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            disabled={approve.isPending}
            onClick={async () => {
              await approve.mutateAsync(message.id);
              toast({ title: t("pending.toasts.approved") });
            }}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {approve.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="mr-1.5 h-3.5 w-3.5" />
            )}
            {t("pending.approve")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setBodyOverride(message.body_text);
              setEditOpen(true);
            }}
          >
            <Edit3 className="mr-1.5 h-3.5 w-3.5" />
            {t("pending.editRegenerate")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-red-600"
            disabled={reject.isPending}
            onClick={async () => {
              await reject.mutateAsync({
                id: message.id,
                reason: t("pending.rejectReason"),
              });
              toast({ title: t("pending.toasts.rejected") });
            }}
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            {t("pending.reject")}
          </Button>
        </div>

        <Dialog
          open={editOpen}
          onOpenChange={(o) => {
            if (!o) setEditOpen(false);
          }}
        >
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-500" />
                {t("pending.dialog.title")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="body-override">
                  {t("pending.dialog.currentDraftLabel")}
                </Label>
                <Textarea
                  id="body-override"
                  rows={6}
                  value={bodyOverride}
                  onChange={(e) => setBodyOverride(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="hint">{t("pending.dialog.hintLabel")}</Label>
                <Input
                  id="hint"
                  placeholder={t("pending.dialog.hintPlaceholder")}
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setEditOpen(false)}>
                {t("pending.dialog.cancel")}
              </Button>
              <Button
                variant="secondary"
                disabled={regenerate.isPending}
                onClick={async () => {
                  await regenerate.mutateAsync({
                    id: message.id,
                    body_override: bodyOverride,
                  });
                  toast({ title: t("pending.toasts.draftSaved") });
                  setEditOpen(false);
                }}
              >
                {t("pending.dialog.saveWithoutRegenerate")}
              </Button>
              <Button
                disabled={regenerate.isPending}
                onClick={async () => {
                  await regenerate.mutateAsync({
                    id: message.id,
                    hint,
                    body_override: bodyOverride,
                  });
                  toast({ title: t("pending.toasts.regenerated") });
                  setEditOpen(false);
                  setHint("");
                }}
                className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700"
              >
                {regenerate.isPending && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                {t("pending.dialog.regenerate")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ─── Sent tab — timeline grouped per candidate ───────────────────────────────

function SentTab() {
  const { t } = useTranslation("outreach");
  const { data, isLoading } = useOutreachMessages({ status: "sent" });
  if (isLoading) return <Skeleton className="h-72 rounded-xl" />;
  if (!data || data.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-sm font-medium">{t("sent.empty.title")}</p>
          <p className="text-xs text-muted-foreground">
            {t("sent.empty.description")}
          </p>
        </CardContent>
      </Card>
    );
  }
  // Group per candidate
  const grouped = new Map<string, OutreachMessage[]>();
  for (const m of data) {
    const arr = grouped.get(m.candidate_id) ?? [];
    arr.push(m);
    grouped.set(m.candidate_id, arr);
  }
  return (
    <div className="space-y-4">
      {Array.from(grouped.entries()).map(([candId, messages]) => {
        const cand = messages[0];
        return (
          <Card key={candId} className="border-0 shadow-sm">
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-xs font-semibold text-white">
                  {getInitials(cand.candidate_name ?? candId)}
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {cand.candidate_name ?? candId}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {t("sent.messageCount", { count: messages.length })}
                  </p>
                </div>
              </div>
              <ol className="relative space-y-3 border-l border-border pl-4">
                {messages
                  .sort((a, b) =>
                    (b.sent_at ?? b.created_at).localeCompare(
                      a.sent_at ?? a.created_at
                    )
                  )
                  .map((m) => {
                    const Icon = CHANNEL_ICON[m.channel];
                    return (
                      <li key={m.id} className="relative">
                        <span className="absolute -left-[21px] top-1 flex h-3 w-3 items-center justify-center rounded-full border-2 border-white bg-emerald-500 dark:border-zinc-900" />
                        <div className="flex items-center gap-2 text-xs">
                          <Icon className="h-3 w-3 text-muted-foreground" />
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">
                            {CHANNEL_LABEL[m.channel]}
                          </span>
                          <span className="text-muted-foreground">
                            · {formatDateTimeNL(m.sent_at)}
                          </span>
                        </div>
                        {m.subject && (
                          <p className="mt-0.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                            {m.subject}
                          </p>
                        )}
                        <p className="line-clamp-2 text-[11px] text-muted-foreground">
                          {m.body_text}
                        </p>
                      </li>
                    );
                  })}
              </ol>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Replies tab — classified inbox ──────────────────────────────────────────

function RepliesTab() {
  const { t } = useTranslation("outreach");
  const { data, isLoading } = useReplies();
  if (isLoading) return <Skeleton className="h-72 rounded-xl" />;
  if (!data || data.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-sm font-medium">{t("replies.empty.title")}</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {data.map((row) => (
        <ReplyCard
          key={row.classification.id}
          classification={row.classification}
          reply={row.reply}
          original={row.original}
        />
      ))}
    </div>
  );
}

function ReplyCard({
  classification,
  reply,
  original,
}: {
  classification: import("@/lib/types/outreach").ReplyClassification;
  reply: OutreachMessage | null;
  original: OutreachMessage | null;
}) {
  const { t } = useTranslation("outreach");
  const pill = REPLY_CATEGORY_PILL[classification.category];
  const candName =
    reply?.candidate_name ?? original?.candidate_name ?? t("replies.unknownCandidate");
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-xs font-semibold text-white">
              {getInitials(candName)}
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {candName}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Reply ontvangen {formatRelativeNL(classification.classified_at)}
              </p>
            </div>
          </div>
          <Badge className={pill.className}>{pill.label}</Badge>
        </div>

        {original && (
          <div className="rounded-md border border-border bg-zinc-50/60 p-2 text-[11px] text-muted-foreground dark:bg-zinc-800/30">
            <p className="font-medium">Origineel ({CHANNEL_LABEL[original.channel]})</p>
            <p className="line-clamp-2">{original.body_text}</p>
          </div>
        )}

        {reply && (
          <div className="rounded-md border border-indigo-200 bg-indigo-50/40 p-3 text-xs dark:border-indigo-900 dark:bg-indigo-950/20">
            <p className="text-zinc-800 dark:text-zinc-200">{reply.body_text}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[150px]">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Vertrouwen
            </p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500"
                style={{ width: `${Math.round(classification.confidence * 100)}%` }}
              />
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {Math.round(classification.confidence * 100)}%
            </p>
          </div>
          <Button
            size="sm"
            className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700"
            onClick={() => {
              // Hooked to no-op in mock — real backend would dispatch the next_action.
              // eslint-disable-next-line no-alert
              alert(
                `Suggested next: ${classification.next_action}\n(real action wired to backend in production)`
              );
            }}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Voorgestelde actie: {nextActionLabel(classification.next_action)}
          </Button>
        </div>

        <p className="text-[11px] italic text-muted-foreground">
          Redenering: {classification.reasoning}
        </p>
      </CardContent>
    </Card>
  );
}

function nextActionLabel(
  action: import("@/lib/types/outreach").ReplyClassification["next_action"]
): string {
  switch (action) {
    case "schedule_call":
      return "Plan gesprek";
    case "send_followup":
      return "Stuur follow-up";
    case "pause_sequence":
      return "Pauzeer sequence";
    case "remove_from_outreach":
      return "Verwijder uit outreach";
    case "manual_review":
      return "Recruiter beslist";
  }
}

// ─── Signals tab ─────────────────────────────────────────────────────────────

function SignalsTab() {
  const { data, isLoading } = useSignals();
  const { data: sequences } = useSequences({ active: true });
  const dismiss = useDismissSignal();
  const draft = useDraftReactivation();
  const { toast } = useToast();
  const [reactivateOpen, setReactivateOpen] = useState<{
    signalId: string;
  } | null>(null);
  const [seqId, setSeqId] = useState<string>("");

  if (isLoading) return <Skeleton className="h-72 rounded-xl" />;
  if (!data || data.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-sm font-medium">Geen signals gedetecteerd</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-zinc-50/60 dark:bg-zinc-800/40">
              <th className="py-3 pl-5 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Kandidaat
              </th>
              <th className="py-3 px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Type
              </th>
              <th className="py-3 px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Verandering
              </th>
              <th className="py-3 px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Bron
              </th>
              <th className="py-3 px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Gedetecteerd
              </th>
              <th className="py-3 pl-4 pr-5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Acties
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.map((s) => (
              <tr key={s.id} className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30">
                <td className="py-3 pl-5 pr-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {s.candidate_name ?? s.candidate_id}
                </td>
                <td className="py-3 px-4">
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                    <Bell className="h-3 w-3" />
                    {SIGNAL_TYPE_LABEL[s.signal_type]}
                  </span>
                </td>
                <td className="py-3 px-4 text-xs text-zinc-700 dark:text-zinc-300">
                  {s.before_value && (
                    <span className="text-muted-foreground">
                      {s.before_value} →{" "}
                    </span>
                  )}
                  <span>{s.after_value ?? "—"}</span>
                </td>
                <td className="py-3 px-4 text-xs text-muted-foreground">
                  {s.source}
                </td>
                <td className="py-3 px-4 text-xs text-muted-foreground">
                  {formatRelativeNL(s.detected_at)}
                </td>
                <td className="py-3 pl-4 pr-5 text-right">
                  {s.reviewed ? (
                    <Badge className="border-0 bg-zinc-100 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      Verwerkt
                    </Badge>
                  ) : (
                    <div className="inline-flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[11px]"
                        onClick={async () => {
                          await dismiss.mutateAsync(s.id);
                          toast({ title: "Genegeerd" });
                        }}
                      >
                        Dismiss
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        onClick={() => {
                          setReactivateOpen({ signalId: s.id });
                          setSeqId(sequences?.[0]?.id ?? "");
                        }}
                      >
                        <Sparkles className="mr-1 h-3 w-3" />
                        Stel reactivatie op
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
      <Dialog
        open={!!reactivateOpen}
        onOpenChange={(o) => {
          if (!o) setReactivateOpen(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reactivatie-sequence kiezen</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {(sequences ?? []).map((seq) => (
              <button
                key={seq.id}
                type="button"
                onClick={() => setSeqId(seq.id)}
                className={
                  seqId === seq.id
                    ? "block w-full rounded-lg border-2 border-indigo-500 bg-indigo-50 p-3 text-left dark:bg-indigo-950/30"
                    : "block w-full rounded-lg border border-border p-3 text-left hover:border-indigo-300"
                }
              >
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {seq.name}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {seq.total_steps} stappen · {seq.description}
                </p>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReactivateOpen(null)}>
              Annuleren
            </Button>
            <Button
              disabled={!seqId || draft.isPending}
              onClick={async () => {
                if (!reactivateOpen) return;
                await draft.mutateAsync({
                  signalId: reactivateOpen.signalId,
                  sequenceId: seqId,
                });
                toast({ title: "Reactivatie opgesteld" });
                setReactivateOpen(null);
              }}
            >
              {draft.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Opstellen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Quotas tab ──────────────────────────────────────────────────────────────

function QuotasTab() {
  const { data, isLoading } = useOutreachQuotas();
  const update = useUpdateQuota();
  const { toast } = useToast();
  const [editing, setEditing] = useState<{
    recruiterId: string;
    channel: OutreachChannel;
    daily: number;
    weekly: number;
  } | null>(null);

  if (isLoading) return <Skeleton className="h-72 rounded-xl" />;
  if (!data || data.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-sm font-medium">Geen quota's geconfigureerd</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <>
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-zinc-50/60 dark:bg-zinc-800/40">
                <th className="py-3 pl-5 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Recruiter
                </th>
                <th className="py-3 px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Kanaal
                </th>
                <th className="py-3 px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Vandaag
                </th>
                <th className="py-3 px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Deze week
                </th>
                <th className="py-3 pl-4 pr-5 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Aanpassen
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((q) => {
                const Icon = CHANNEL_ICON[q.channel];
                const dayPct = Math.min(
                  100,
                  Math.round((q.current_day_count / Math.max(1, q.daily_limit)) * 100)
                );
                const weekPct = Math.min(
                  100,
                  Math.round(
                    (q.current_week_count / Math.max(1, q.weekly_limit)) * 100
                  )
                );
                return (
                  <tr
                    key={`${q.recruiter_id}-${q.channel}`}
                    className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30"
                  >
                    <td className="py-3 pl-5 pr-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {q.recruiter_name ?? q.recruiter_id}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300">
                        <Icon className="h-3.5 w-3.5" />
                        {CHANNEL_LABEL[q.channel]}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <ProgressBar
                        pct={dayPct}
                        label={`${q.current_day_count} / ${q.daily_limit}`}
                      />
                    </td>
                    <td className="py-3 px-4">
                      <ProgressBar
                        pct={weekPct}
                        label={`${q.current_week_count} / ${q.weekly_limit}`}
                      />
                    </td>
                    <td className="py-3 pl-4 pr-5 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        onClick={() =>
                          setEditing({
                            recruiterId: q.recruiter_id,
                            channel: q.channel,
                            daily: q.daily_limit,
                            weekly: q.weekly_limit,
                          })
                        }
                      >
                        <Edit3 className="mr-1 h-3 w-3" />
                        Bewerken
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Dialog
        open={!!editing}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Quota aanpassen</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {CHANNEL_LABEL[editing.channel]} · recruiter {editing.recruiterId}
              </p>
              <div>
                <Label htmlFor="daily">Dagelijkse limiet</Label>
                <Input
                  id="daily"
                  type="number"
                  value={editing.daily}
                  onChange={(e) =>
                    setEditing({ ...editing, daily: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label htmlFor="weekly">Wekelijkse limiet</Label>
                <Input
                  id="weekly"
                  type="number"
                  value={editing.weekly}
                  onChange={(e) =>
                    setEditing({ ...editing, weekly: Number(e.target.value) })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Annuleren
            </Button>
            <Button
              disabled={update.isPending}
              onClick={async () => {
                if (!editing) return;
                await update.mutateAsync({
                  recruiterId: editing.recruiterId,
                  channel: editing.channel,
                  daily_limit: editing.daily,
                  weekly_limit: editing.weekly,
                });
                toast({ title: "Quota bijgewerkt" });
                setEditing(null);
              }}
            >
              {update.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Opslaan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProgressBar({ pct, label }: { pct: number; label: string }) {
  const color =
    pct >= 90
      ? "from-red-500 to-orange-500"
      : pct >= 70
        ? "from-amber-500 to-orange-500"
        : "from-indigo-500 to-purple-500";
  return (
    <div>
      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

// Suppress unused-vars from extra imports we keep for future hooks.
const _keep = { Mail, PauseCircle };
