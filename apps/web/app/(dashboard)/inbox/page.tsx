"use client";

/**
 * Sprint Q4.6 — Unified omni-channel inbox.
 *
 * Slack-style 3-pane layout:
 *   Left (240px):  filter sidebar (Inbox / Ongelezen / Toegewezen aan mij /
 *                  Gepind / Archief + per-channel filters with badge counts)
 *   Middle (380px): thread list with avatar, channel-dot, preview, time, unread
 *                  badge. Search bar at top.
 *   Right (flex):  selected-thread timeline with header (actions: assign / pin /
 *                  archive / labels), bubbles per channel + compose-bar.
 *
 * Live: polls every 10s (threads) and every 6s (timeline). Mock-mode injects a
 * new inbound message every ~12s into a thread (visible animation).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  Archive,
  ArchiveRestore,
  Trash2,
  Inbox as InboxIcon,
  Pin,
  PinOff,
  Search,
  Tag,
  UserPlus,
  X,
  CircleDot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { ChannelIcon, CHANNEL_THEME } from "@/components/inbox/ChannelIcon";
import { ChannelBubble } from "@/components/inbox/ChannelBubble";
import { ComposeBar } from "@/components/inbox/ComposeBar";
import {
  useArchiveThread,
  useAssignThread,
  useDeleteThread,
  useInboxThreads,
  useMarkThreadRead,
  usePinThread,
  useThreadLabels,
  useThreadTimeline,
  type InboxFilters,
} from "@/hooks/useInbox";
import { useVoiceIntegration } from "@/hooks/useVoice";
import { useWhatsAppIntegration } from "@/hooks/useWhatsApp";
import { getCurrentUserId } from "@/lib/auth";
import { getInitials } from "@/lib/utils";
import type { ChannelType, UnifiedThread } from "@/lib/types/inbox";

// TODO: replace with a real `useTenantUsers()` hook once a backend
// `/users` endpoint exists. Until then the assignee picker is empty and
// the "Toewijzen" button shows a clear "geen recruiters beschikbaar"
// state rather than seeding fake team members.
const tenantUsers: Array<{ id: string; name: string }> = [];

type FilterPreset =
  | "all"
  | "unread"
  | "mine"
  | "pinned"
  | "archived"
  | "channel";

interface SidebarFilter {
  preset: FilterPreset;
  channel?: ChannelType;
}

function formatRelative(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "nu";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}u`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ts).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

export default function UnifiedInboxPage() {
  const [filter, setFilter] = useState<SidebarFilter>({ preset: "all" });
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const currentUserId = getCurrentUserId();

  // Build server-filters from preset
  const serverFilters: InboxFilters = useMemo(() => {
    const f: InboxFilters = {};
    if (filter.preset === "unread") f.unread = true;
    else if (filter.preset === "mine" && currentUserId)
      f.assignee_user_id = currentUserId;
    else if (filter.preset === "pinned") f.pinned = true;
    else if (filter.preset === "archived") f.archived = true;
    else if (filter.preset === "channel" && filter.channel) f.channel = filter.channel;
    if (search) f.q = search;
    return f;
  }, [filter, search, currentUserId]);

  const { data: threads, isLoading } = useInboxThreads(serverFilters);
  const { data: allThreads } = useInboxThreads({});
  const { data: voiceState } = useVoiceIntegration();
  const { data: whatsAppState } = useWhatsAppIntegration();

  // Per-channel counts for sidebar
  const channelCounts = useMemo(() => {
    const counts: Record<ChannelType, number> = {
      email: 0,
      whatsapp: 0,
      sms: 0,
      voice: 0,
      linkedin_inmail: 0,
      linkedin_connection: 0,
    };
    for (const t of allThreads ?? []) {
      if (t.archived_at) continue;
      counts[t.last_channel] += t.unread_count_for_assignee > 0 ? 1 : 0;
    }
    return counts;
  }, [allThreads]);

  const unreadTotal = (allThreads ?? []).filter(
    (t) => t.unread_count_for_assignee > 0 && !t.archived_at
  ).length;
  const mineCount = currentUserId
    ? (allThreads ?? []).filter(
        (t) => t.assignee_user_id === currentUserId && !t.archived_at
      ).length
    : 0;
  const pinnedCount = (allThreads ?? []).filter(
    (t) => t.pinned && !t.archived_at
  ).length;
  const archivedCount = (allThreads ?? []).filter((t) => t.archived_at).length;

  // Auto-select first thread when list changes
  useEffect(() => {
    if (!selectedId && threads && threads.length > 0) {
      setSelectedId(threads[0].id);
    }
    if (selectedId && threads && !threads.some((t) => t.id === selectedId)) {
      setSelectedId(threads[0]?.id ?? null);
    }
  }, [threads, selectedId]);

  const selectedThread = useMemo(
    () => (allThreads ?? []).find((t) => t.id === selectedId) ?? null,
    [allThreads, selectedId]
  );

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100vh-64px-0px)] overflow-hidden bg-zinc-50 dark:bg-zinc-950 lg:-mx-6">
      <FilterSidebar
        filter={filter}
        setFilter={setFilter}
        counts={{
          all: (allThreads ?? []).filter((t) => !t.archived_at).length,
          unread: unreadTotal,
          mine: mineCount,
          pinned: pinnedCount,
          archived: archivedCount,
          channels: channelCounts,
        }}
      />

      <ThreadListPane
        threads={threads ?? []}
        isLoading={isLoading}
        selectedId={selectedId}
        onSelect={setSelectedId}
        search={search}
        onSearchChange={setSearch}
      />

      <div className="flex flex-1 flex-col bg-white dark:bg-zinc-900">
        {selectedThread ? (
          <ThreadDetail
            thread={selectedThread}
            voiceIntegration={voiceState?.integration ?? null}
            voiceServiceActive={voiceState?.serviceActive ?? true}
            whatsAppIntegration={whatsAppState?.integration ?? null}
            whatsAppServiceActive={whatsAppState?.serviceActive ?? true}
          />
        ) : (
          <EmptyDetail />
        )}
      </div>
    </div>
  );
}

// ─── Filter sidebar ──────────────────────────────────────────────────────────

function FilterSidebar({
  filter,
  setFilter,
  counts,
}: {
  filter: SidebarFilter;
  setFilter: (f: SidebarFilter) => void;
  counts: {
    all: number;
    unread: number;
    mine: number;
    pinned: number;
    archived: number;
    channels: Record<ChannelType, number>;
  };
}) {
  const { t } = useTranslation("miscInbox");
  const isActive = (f: SidebarFilter) =>
    f.preset === filter.preset && f.channel === filter.channel;

  const FilterRow = ({
    f,
    icon,
    label,
    count,
    accent,
  }: {
    f: SidebarFilter;
    icon: React.ReactNode;
    label: string;
    count: number;
    accent?: string;
  }) => (
    <button
      type="button"
      onClick={() => setFilter(f)}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
        isActive(f)
          ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
      )}
    >
      <span className={cn("flex items-center gap-2", accent)}>
        {icon}
        {label}
      </span>
      {count > 0 && (
        <span
          className={cn(
            "inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
            isActive(f)
              ? "bg-indigo-200 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200"
              : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300"
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-white px-3 py-4 dark:bg-zinc-900 lg:flex">
      <div className="mb-2 px-1">
        <h2 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          {t("inbox.sidebar.title")}
        </h2>
        <p className="text-[11px] text-muted-foreground">
          {t("inbox.sidebar.subtitle")}
        </p>
      </div>

      <div className="mt-2 space-y-0.5">
        <FilterRow
          f={{ preset: "all" }}
          icon={<InboxIcon className="h-4 w-4" />}
          label={t("inbox.sidebar.filters.inbox")}
          count={counts.all}
        />
        <FilterRow
          f={{ preset: "unread" }}
          icon={<CircleDot className="h-4 w-4 text-indigo-500" />}
          label={t("inbox.sidebar.filters.unread")}
          count={counts.unread}
        />
        <FilterRow
          f={{ preset: "mine" }}
          icon={<UserPlus className="h-4 w-4" />}
          label={t("inbox.sidebar.filters.mine")}
          count={counts.mine}
        />
        <FilterRow
          f={{ preset: "pinned" }}
          icon={<Pin className="h-4 w-4" />}
          label={t("inbox.sidebar.filters.pinned")}
          count={counts.pinned}
        />
        <FilterRow
          f={{ preset: "archived" }}
          icon={<Archive className="h-4 w-4" />}
          label={t("inbox.sidebar.filters.archived")}
          count={counts.archived}
        />
      </div>

      <div className="my-3 border-t border-border" />

      <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        {t("inbox.sidebar.channelsHeading")}
      </p>
      <div className="space-y-0.5">
        {(
          [
            "email",
            "whatsapp",
            "sms",
            "voice",
            "linkedin_inmail",
          ] as ChannelType[]
        ).map((c) => {
          const theme = CHANNEL_THEME[c];
          return (
            <FilterRow
              key={c}
              f={{ preset: "channel", channel: c }}
              icon={<ChannelIcon channel={c} />}
              label={theme.label}
              count={counts.channels[c]}
            />
          );
        })}
      </div>
    </aside>
  );
}

// ─── Thread list pane ────────────────────────────────────────────────────────

function ThreadListPane({
  threads,
  isLoading,
  selectedId,
  onSelect,
  search,
  onSearchChange,
}: {
  threads: UnifiedThread[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearchChange: (s: string) => void;
}) {
  const { t } = useTranslation("miscInbox");
  return (
    <div className="flex w-full max-w-[380px] shrink-0 flex-col border-r border-border bg-white dark:bg-zinc-900">
      {/* Search */}
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("inbox.list.searchPlaceholder")}
            className="h-9 pl-8"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1 p-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : threads.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
            <InboxIcon className="h-8 w-8 text-zinc-300 dark:text-zinc-600" />
            <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t("inbox.list.emptyTitle")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("inbox.list.emptyDescription")}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {threads.map((t) => (
              <ThreadListItem
                key={t.id}
                thread={t}
                active={t.id === selectedId}
                onClick={() => onSelect(t.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ThreadListItem({
  thread,
  active,
  onClick,
}: {
  thread: UnifiedThread;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation("miscInbox");
  const unread = thread.unread_count_for_assignee;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors",
          active
            ? "bg-indigo-50/70 dark:bg-indigo-950/30"
            : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40",
          unread > 0 && !active && "bg-white dark:bg-zinc-900"
        )}
      >
        <div className="relative shrink-0">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-xs font-semibold text-white">
              {getInitials(thread.candidate_name ?? thread.candidate_id)}
            </AvatarFallback>
          </Avatar>
          <span className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-white dark:ring-zinc-900">
            <ChannelIcon channel={thread.last_channel} variant="dot" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {thread.pinned && (
              <Pin className="h-3 w-3 text-amber-500" fill="currentColor" />
            )}
            <p
              className={cn(
                "truncate text-sm",
                unread > 0
                  ? "font-semibold text-zinc-900 dark:text-zinc-100"
                  : "font-medium text-zinc-700 dark:text-zinc-300"
              )}
            >
              {thread.candidate_name ?? t("inbox.list.unknownCandidate")}
            </p>
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
              {formatRelative(thread.last_message_at)}
            </span>
          </div>
          <p
            className={cn(
              "mt-0.5 truncate text-xs",
              unread > 0
                ? "text-zinc-700 dark:text-zinc-200"
                : "text-muted-foreground"
            )}
          >
            {thread.last_message_preview}
          </p>
          <div className="mt-1 flex items-center gap-1.5">
            {thread.labels.slice(0, 2).map((l) => (
              <span
                key={l}
                className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              >
                #{l}
              </span>
            ))}
            {unread > 0 && (
              <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

// ─── Thread detail ───────────────────────────────────────────────────────────

function ThreadDetail({
  thread,
  voiceIntegration,
  voiceServiceActive,
  whatsAppIntegration,
  whatsAppServiceActive,
}: {
  thread: UnifiedThread;
  voiceIntegration: import("@/lib/types/voice").VoiceIntegration | null;
  voiceServiceActive: boolean;
  whatsAppIntegration: import("@/lib/types/whatsapp").WhatsAppIntegration | null;
  whatsAppServiceActive: boolean;
}) {
  const { t } = useTranslation("miscInbox");
  const { toast } = useToast();
  const { data: timeline, isLoading } = useThreadTimeline(thread.id);
  const markRead = useMarkThreadRead();
  const pin = usePinThread();
  const archive = useArchiveThread();
  const del = useDeleteThread();
  const assign = useAssignThread();
  const { addLabel, removeLabel } = useThreadLabels();

  const [assignOpen, setAssignOpen] = useState(false);
  const [assigneeId, setAssigneeId] = useState(thread.assignee_user_id ?? "");
  const [labelInput, setLabelInput] = useState("");
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (thread.unread_count_for_assignee > 0) {
      markRead.mutate(thread.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id]);

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border bg-white px-5 py-3 dark:bg-zinc-900">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-sm font-semibold text-white">
              {getInitials(thread.candidate_name ?? thread.candidate_id)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link
                href={`/candidates/${thread.candidate_id}`}
                className="text-base font-semibold text-zinc-900 hover:text-indigo-600 dark:text-zinc-100 dark:hover:text-indigo-400"
              >
                {thread.candidate_name ?? t("inbox.detail.unknownCandidate")}
              </Link>
              {thread.pinned && <Pin className="h-3.5 w-3.5 text-amber-500" fill="currentColor" />}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>
                {t("inbox.detail.assignedTo")}{" "}
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {thread.assignee_name ?? t("inbox.detail.noAssignee")}
                </span>
              </span>
              {thread.labels.length > 0 && (
                <>
                  <span>·</span>
                  {thread.labels.map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() =>
                        removeLabel.mutate({ threadId: thread.id, label: l })
                      }
                      className="group inline-flex items-center gap-0.5 rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-700 hover:bg-red-100 hover:text-red-700 dark:bg-zinc-800 dark:text-zinc-300"
                      title={t("inbox.detail.removeLabelTitle")}
                    >
                      #{l}
                      <X className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" />
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-xs"
            onClick={() => setAssignOpen(true)}
          >
            <UserPlus className="h-3.5 w-3.5" /> {t("inbox.detail.assign")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-xs"
            onClick={() =>
              pin.mutate(
                { threadId: thread.id, pinned: !thread.pinned },
                {
                  onSuccess: () =>
                    toast({
                      title: thread.pinned
                        ? t("inbox.detail.pinRemoved")
                        : t("inbox.detail.pinned"),
                    }),
                }
              )
            }
          >
            {thread.pinned ? (
              <>
                <PinOff className="h-3.5 w-3.5" /> {t("inbox.detail.unpin")}
              </>
            ) : (
              <>
                <Pin className="h-3.5 w-3.5" /> {t("inbox.detail.pin")}
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-xs"
            onClick={() => setLabelsOpen(true)}
          >
            <Tag className="h-3.5 w-3.5" /> {t("inbox.detail.label")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-xs"
            onClick={() =>
              archive.mutate(
                { threadId: thread.id, archived: !thread.archived_at },
                {
                  onSuccess: () =>
                    toast({
                      title: thread.archived_at
                        ? t("inbox.detail.restoredFromArchive")
                        : t("inbox.detail.archived"),
                    }),
                }
              )
            }
          >
            {thread.archived_at ? (
              <>
                <ArchiveRestore className="h-3.5 w-3.5" /> {t("inbox.detail.restore")}
              </>
            ) : (
              <>
                <Archive className="h-3.5 w-3.5" /> {t("inbox.detail.archive")}
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" /> Verwijderen
          </Button>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-5 py-6">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-20 w-3/4 rounded-2xl" />
            <Skeleton className="ml-auto h-20 w-3/4 rounded-2xl" />
            <Skeleton className="h-20 w-3/4 rounded-2xl" />
          </div>
        ) : !timeline || timeline.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t("inbox.detail.timelineEmptyTitle")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("inbox.detail.timelineEmptyDescription")}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {[...timeline]
              .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
              .map((e) => (
                <ChannelBubble key={e.id} event={e} />
              ))}
          </div>
        )}
      </div>

      {/* Compose */}
      <ComposeBar
        candidateId={thread.candidate_id}
        candidateName={thread.candidate_name ?? t("inbox.detail.composeFallbackName")}
        defaultChannel={thread.last_channel === "linkedin_connection" ? "linkedin_inmail" : thread.last_channel}
        voiceIntegration={voiceIntegration}
        voiceServiceActive={voiceServiceActive}
        whatsappIntegration={whatsAppIntegration}
        whatsappServiceActive={whatsAppServiceActive}
      />

      {/* Assign dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("inbox.detail.assignDialog.title")}</DialogTitle>
          </DialogHeader>
          {tenantUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              {t("inbox.detail.assignDialog.noRecruiters")}
            </p>
          ) : (
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger>
                <SelectValue placeholder={t("inbox.detail.assignDialog.placeholder")} />
              </SelectTrigger>
              <SelectContent>
                {tenantUsers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              {t("inbox.detail.assignDialog.cancel")}
            </Button>
            <Button
              disabled={tenantUsers.length === 0 || !assigneeId}
              onClick={async () => {
                if (!assigneeId) return;
                const user = tenantUsers.find((m) => m.id === assigneeId);
                await assign.mutateAsync({
                  threadId: thread.id,
                  user_id: assigneeId,
                  user_name: user?.name,
                });
                toast({
                  title: t("inbox.detail.assignDialog.assignedToast", {
                    name: user?.name ?? assigneeId,
                  }),
                });
                setAssignOpen(false);
              }}
            >
              {t("inbox.detail.assignDialog.assign")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bericht verwijderen?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Deze thread verdwijnt uit je inbox. Berichten blijven bewaard voor
            de audit, maar zijn hier niet meer zichtbaar.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Annuleren
            </Button>
            <Button
              variant="destructive"
              disabled={del.isPending}
              onClick={async () => {
                await del.mutateAsync(thread.id);
                toast({ title: "Bericht verwijderd" });
                setDeleteOpen(false);
              }}
            >
              {del.isPending ? "Verwijderen…" : "Verwijderen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Label dialog */}
      <Dialog open={labelsOpen} onOpenChange={setLabelsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("inbox.detail.labelDialog.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              placeholder={t("inbox.detail.labelDialog.placeholder")}
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
              {["interview", "hot", "follow-up", "afgehaakt"].map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLabelInput(l)}
                  className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  #{l}
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLabelsOpen(false)}>
              {t("inbox.detail.labelDialog.cancel")}
            </Button>
            <Button
              onClick={async () => {
                const v = labelInput.trim();
                if (!v) return;
                await addLabel.mutateAsync({ threadId: thread.id, label: v });
                toast({
                  title: t("inbox.detail.labelDialog.addedToast", { label: v }),
                });
                setLabelInput("");
                setLabelsOpen(false);
              }}
            >
              {t("inbox.detail.labelDialog.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EmptyDetail() {
  const { t } = useTranslation("miscInbox");
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <div className="rounded-full bg-indigo-50 p-4 dark:bg-indigo-950/40">
        <InboxIcon className="h-8 w-8 text-indigo-500" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
        {t("inbox.empty.title")}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("inbox.empty.description")}
      </p>
    </div>
  );
}
