"use client";

/**
 * Sprint Q4.5 — Unified outreach inbox.
 *
 * Combines pending-drafts (need approval) + unhandled replies into one
 * single screen — answers "what does the recruiter need to act on right now?".
 *
 * Items are interleaved chronologically. Pending drafts route to outreach
 * approve/reject; replies show classification + suggested next action.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Inbox as InboxIcon,
  MessageSquare,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AiDisclosureBadge } from "@/components/ai/AiDisclosureBadge";
import {
  useOutreachMessages,
  useReplies,
} from "@/hooks/useOutreach";
import {
  CHANNEL_ICON,
  CHANNEL_LABEL,
  REPLY_CATEGORY_PILL,
  formatRelativeNL,
  getInitials,
} from "@/components/sourcing/visualHelpers";
import type { OutreachMessage } from "@/lib/types/outreach";

type InboxItem =
  | {
      kind: "draft";
      ts: string;
      message: OutreachMessage;
    }
  | {
      kind: "reply";
      ts: string;
      classification: import("@/lib/types/outreach").ReplyClassification;
      reply: OutreachMessage | null;
      original: OutreachMessage | null;
    };

export default function InboxPage() {
  const { t } = useTranslation("outreach");
  const drafts = useOutreachMessages({ status: "drafted" });
  const pending = useOutreachMessages({ status: "pending_approval" });
  const replies = useReplies();

  const items: InboxItem[] = useMemo(() => {
    const list: InboxItem[] = [];
    for (const m of pending.data ?? []) {
      list.push({ kind: "draft", ts: m.created_at, message: m });
    }
    for (const m of drafts.data ?? []) {
      list.push({ kind: "draft", ts: m.created_at, message: m });
    }
    for (const r of replies.data ?? []) {
      list.push({
        kind: "reply",
        ts: r.classification.classified_at,
        classification: r.classification,
        reply: r.reply,
        original: r.original,
      });
    }
    return list.sort((a, b) => b.ts.localeCompare(a.ts));
  }, [drafts.data, pending.data, replies.data]);

  const isLoading = drafts.isLoading || pending.isLoading || replies.isLoading;
  const draftCount =
    (drafts.data?.length ?? 0) + (pending.data?.length ?? 0);
  const replyCount = replies.data?.length ?? 0;
  const interestedCount = (replies.data ?? []).filter(
    (r) => r.classification.category === "interested"
  ).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("inbox.title")}
        description={t("inbox.description")}
        actions={<AiDisclosureBadge />}
      />

      {/* Stat strip */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t("inbox.stats.draftsToReview")}
          value={draftCount}
          icon={<AlertTriangle className="h-5 w-5" />}
          gradient="from-amber-500 to-orange-600"
        />
        <StatCard
          label={t("inbox.stats.repliesIn")}
          value={replyCount}
          icon={<MessageSquare className="h-5 w-5" />}
          gradient="from-indigo-500 to-purple-600"
        />
        <StatCard
          label={t("inbox.stats.interested")}
          value={interestedCount}
          icon={<CheckCircle2 className="h-5 w-5" />}
          gradient="from-emerald-500 to-teal-600"
        />
      </div>

      {isLoading ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : items.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-500 dark:bg-emerald-950/40">
              <InboxIcon className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium">{t("inbox.empty.title")}</p>
            <p className="text-xs text-muted-foreground">
              {t("inbox.empty.description")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {items.map((item, i) =>
                item.kind === "draft" ? (
                  <DraftItem key={`draft-${item.message.id}-${i}`} message={item.message} />
                ) : (
                  <ReplyItem
                    key={`reply-${item.classification.id}-${i}`}
                    classification={item.classification}
                    reply={item.reply}
                    original={item.original}
                  />
                )
              )}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  gradient,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  gradient: string;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="flex items-center gap-4 p-5">
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} text-white shadow-sm`}
        >
          {icon}
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function DraftItem({ message }: { message: OutreachMessage }) {
  const { t } = useTranslation("outreach");
  const Icon = CHANNEL_ICON[message.channel];
  return (
    <li className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-xs font-semibold text-white">
        {getInitials(message.candidate_name ?? message.candidate_id)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge className="border-0 bg-amber-100 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            {t("inbox.draftBadge")}
          </Badge>
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            {message.candidate_name ?? message.candidate_id}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Icon className="h-3 w-3" />
            {CHANNEL_LABEL[message.channel]}
          </span>
          <span className="text-[11px] text-muted-foreground">
            · {formatRelativeNL(message.created_at)}
          </span>
        </div>
        {message.subject && (
          <p className="mt-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {message.subject}
          </p>
        )}
        <p className="line-clamp-1 text-[11px] text-muted-foreground">
          {message.body_text}
        </p>
      </div>
      <Link
        href="/outreach"
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
      >
        {t("inbox.review")}
        <ArrowRight className="h-3 w-3" />
      </Link>
    </li>
  );
}

function ReplyItem({
  classification,
  reply,
  original,
}: {
  classification: import("@/lib/types/outreach").ReplyClassification;
  reply: OutreachMessage | null;
  original: OutreachMessage | null;
}) {
  const { t } = useTranslation("outreach");
  const candName =
    reply?.candidate_name ?? original?.candidate_name ?? t("inbox.unknownCandidate");
  const pill = REPLY_CATEGORY_PILL[classification.category];
  return (
    <li className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-xs font-semibold text-white">
        {getInitials(candName)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={pill.className}>{pill.label}</Badge>
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            {candName}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {t("inbox.replyMeta", {
              time: formatRelativeNL(classification.classified_at),
            })}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {t("inbox.confidenceMeta", {
              percent: Math.round(classification.confidence * 100),
            })}
          </span>
        </div>
        {reply && (
          <p className="mt-1 line-clamp-1 text-xs text-zinc-700 dark:text-zinc-300">
            {reply.body_text}
          </p>
        )}
        <p className="text-[11px] italic text-muted-foreground">
          {classification.reasoning}
        </p>
      </div>
      <Link
        href="/outreach"
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
      >
        {t("inbox.handle")}
        <ArrowRight className="h-3 w-3" />
      </Link>
    </li>
  );
}
