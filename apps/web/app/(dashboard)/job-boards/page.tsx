"use client";

/**
 * Sprint Q4.3 — Job-board distribution hub.
 *
 * Replaces the earlier stub. Hosts:
 *   - hero with "post in 5 min" pitch
 *   - 3 stat cards (connected boards, live postings, monthly spend)
 *   - catalog grid of all 8 supported boards with connect/manage actions
 *   - "live postings" table with click-to-open detail dialog (events timeline)
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  Briefcase,
  Coins,
  Globe,
  Loader2,
  MapPin,
  Send,
  Settings2,
  Sparkles,
  Plug,
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Activity,
  Inbox,
  LayoutGrid,
  List,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useJobBoardCatalog,
  useJobBoardIntegrations,
  useJobPostings,
  useJobPosting,
  useRetractPosting,
} from "@/hooks/useJobBoards";
import { useToast } from "@/components/ui/use-toast";
import type {
  JobBoardCatalogEntry,
  JobBoardIntegration,
  JobPosting,
  JobPostingStatus,
  JobBoardRegion,
} from "@/lib/types/jobBoards";

// ─── Visual helpers ──────────────────────────────────────────────────────────

const REGION_LABEL: Record<JobBoardRegion, string> = {
  global: "Global",
  nl: "NL",
  de: "DE",
  eu: "EU",
};

const STATUS_PILL: Record<JobPostingStatus, { className: string }> = {
  queued: {
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-0",
  },
  posted: {
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-0",
  },
  rejected: {
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-0",
  },
  expired: {
    className:
      "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-0",
  },
  retracted: {
    className:
      "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 border-0",
  },
  failed: {
    className:
      "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-0",
  },
};

// Deterministic color palette for board initials so the same brand keeps the
// same accent everywhere (catalog grid, posting rows, dialogs).
const BRAND_PALETTE: Array<{ from: string; to: string; text: string }> = [
  { from: "from-indigo-500", to: "to-purple-600", text: "text-white" },
  { from: "from-emerald-500", to: "to-teal-600", text: "text-white" },
  { from: "from-rose-500", to: "to-pink-600", text: "text-white" },
  { from: "from-amber-500", to: "to-orange-600", text: "text-white" },
  { from: "from-sky-500", to: "to-blue-600", text: "text-white" },
  { from: "from-violet-500", to: "to-fuchsia-600", text: "text-white" },
  { from: "from-lime-500", to: "to-emerald-600", text: "text-white" },
  { from: "from-cyan-500", to: "to-blue-600", text: "text-white" },
];

function brandColor(boardId: string) {
  let hash = 0;
  for (let i = 0; i < boardId.length; i++) {
    hash = (hash * 31 + boardId.charCodeAt(i)) >>> 0;
  }
  return BRAND_PALETTE[hash % BRAND_PALETTE.length];
}

function brandInitials(name: string): string {
  return name
    .split(/[\s-]+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function formatEuro(amount: number, currency = "EUR"): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("nl-NL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function JobBoardsHubPage() {
  const { t } = useTranslation("jobBoards");
  const { data: catalog, isLoading: catalogLoading } = useJobBoardCatalog();
  const { data: integrations } = useJobBoardIntegrations();
  const { data: postings } = useJobPostings();

  const [activePostingId, setActivePostingId] = useState<string | null>(null);
  const [catalogView, setCatalogView] = useState<"grid" | "list">("grid");

  const integrationsByBoard = useMemo(() => {
    const map = new Map<string, JobBoardIntegration>();
    for (const i of integrations ?? []) map.set(i.board_id, i);
    return map;
  }, [integrations]);

  const livePostings = useMemo(
    () =>
      (postings ?? [])
        .slice()
        .sort((a, b) => {
          // queued/posted first, then most recent
          const order: Record<JobPostingStatus, number> = {
            queued: 0,
            posted: 1,
            failed: 2,
            rejected: 3,
            expired: 4,
            retracted: 5,
          };
          if (order[a.status] !== order[b.status]) {
            return order[a.status] - order[b.status];
          }
          return (b.created_at ?? "").localeCompare(a.created_at ?? "");
        })
        .slice(0, 12),
    [postings]
  );

  const connectedCount = (integrations ?? []).filter(
    (i) => i.status === "connected"
  ).length;
  const liveCount = (postings ?? []).filter(
    (p) => p.status === "posted" || p.status === "queued"
  ).length;
  const monthSpend = useMemo(() => {
    const now = new Date();
    const startMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return (postings ?? [])
      .filter(
        (p) =>
          p.posted_at &&
          new Date(p.posted_at).getTime() >= startMs &&
          (p.cost_amount ?? 0) > 0
      )
      .reduce((sum, p) => sum + (p.cost_amount ?? 0), 0);
  }, [postings]);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("hub.title")}
        description={t("hub.description")}
      />

      {/* Hero */}
      <Card className="overflow-hidden border-0 shadow-md">
        <CardContent className="relative bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600 p-8 text-white">
          <div className="absolute inset-0 opacity-20 pointer-events-none">
            <div className="absolute -top-10 -right-10 h-48 w-48 rounded-full bg-white blur-3xl" />
            <div className="absolute bottom-0 left-1/3 h-32 w-32 rounded-full bg-pink-200 blur-3xl" />
          </div>
          <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl space-y-2">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur">
                <Sparkles className="h-3.5 w-3.5" />
                {t("hub.hero.badge")}
              </div>
              <h2 className="text-2xl font-bold tracking-tight">
                {t("hub.hero.heading")}
              </h2>
              <p className="text-sm text-white/85">
                {t("hub.hero.subtitle")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/jobs">
                <Button
                  size="sm"
                  variant="secondary"
                  className="bg-white text-indigo-700 hover:bg-white/90"
                >
                  <Briefcase className="mr-1.5 h-4 w-4" />
                  {t("hub.hero.toJobs")}
                </Button>
              </Link>
              <Link href="/analytics/cost-per-hire">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                >
                  <Coins className="mr-1.5 h-4 w-4" />
                  {t("hub.hero.costPerHire")}
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t("hub.stats.connectedBoards")}
          value={String(connectedCount)}
          icon={<Plug className="h-5 w-5" />}
          gradient="from-indigo-500 to-purple-600"
        />
        <StatCard
          label={t("hub.stats.livePostings")}
          value={String(liveCount)}
          icon={<Activity className="h-5 w-5" />}
          gradient="from-emerald-500 to-teal-600"
        />
        <StatCard
          label={t("hub.stats.monthSpend")}
          value={formatEuro(monthSpend)}
          icon={<Coins className="h-5 w-5" />}
          gradient="from-amber-500 to-orange-600"
        />
      </div>

      {/* Catalog */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {t("hub.catalog.title")}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t("hub.catalog.subtitle")}
            </p>
          </div>
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => setCatalogView("grid")}
              aria-label="Rasterweergave"
              className={`rounded-md p-1.5 transition-colors ${
                catalogView === "grid"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setCatalogView("list")}
              aria-label="Lijstweergave"
              className={`rounded-md p-1.5 transition-colors ${
                catalogView === "list"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
        {catalogLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        ) : catalogView === "list" ? (
          <div className="space-y-2">
            {(catalog ?? []).map((board) => (
              <BoardCard
                key={board.id}
                board={board}
                integration={integrationsByBoard.get(board.id) ?? null}
                view="list"
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(catalog ?? []).map((board) => (
              <BoardCard
                key={board.id}
                board={board}
                integration={integrationsByBoard.get(board.id) ?? null}
                view="grid"
              />
            ))}
          </div>
        )}
      </section>

      {/* Live postings */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {t("hub.livePostings.title")}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t("hub.livePostings.subtitle")}
            </p>
          </div>
        </div>

        {(postings ?? []).length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
                <Inbox className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("hub.livePostings.empty.title")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("hub.livePostings.empty.description")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-zinc-50/60 dark:bg-zinc-800/40">
                      <th className="py-3 pl-5 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t("hub.livePostings.columns.job")}
                      </th>
                      <th className="py-3 px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t("hub.livePostings.columns.board")}
                      </th>
                      <th className="py-3 px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t("hub.livePostings.columns.status")}
                      </th>
                      <th className="py-3 px-4 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t("hub.livePostings.columns.applicants")}
                      </th>
                      <th className="py-3 px-4 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t("hub.livePostings.columns.cost")}
                      </th>
                      <th className="py-3 pl-4 pr-5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t("hub.livePostings.columns.posted")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {livePostings.map((p) => (
                      <PostingRow
                        key={p.id}
                        posting={p}
                        boardName={
                          (catalog ?? []).find((b) => b.id === p.board_id)
                            ?.display_name ?? p.board_id
                        }
                        onOpen={() => setActivePostingId(p.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      <PostingDetailDialog
        postingId={activePostingId}
        boardCatalog={catalog ?? []}
        onClose={() => setActivePostingId(null)}
      />
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  gradient,
}: {
  label: string;
  value: string;
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

function BoardCard({
  board,
  integration,
  view = "grid",
}: {
  board: JobBoardCatalogEntry;
  integration: JobBoardIntegration | null;
  view?: "grid" | "list";
}) {
  const { t } = useTranslation("jobBoards");
  const palette = brandColor(board.id);
  const initials = brandInitials(board.display_name);
  const connected = integration?.status === "connected";
  const errored = integration?.status === "error";

  const badgeClass = connected
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
    : errored
    ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  const badgeLabel = connected
    ? t("board.connected")
    : errored
    ? t("board.error")
    : t("board.notConnected");
  const badge = (
    <Badge
      className={`shrink-0 whitespace-nowrap border-0 text-[10px] ${badgeClass}`}
    >
      {badgeLabel}
    </Badge>
  );

  const iconBox = (
    <div
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${palette.from} ${palette.to} text-sm font-bold ${palette.text} shadow-sm`}
      aria-hidden
    >
      {initials}
    </div>
  );

  const meta = (
    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <MapPin className="h-3 w-3 shrink-0" />
      {REGION_LABEL[board.region]}
      <span className="text-zinc-300 dark:text-zinc-600">·</span>
      <span className="capitalize">{board.auth_type.replace("_", " ")}</span>
    </div>
  );

  const actionButton = (
    <Button
      size="sm"
      className={
        connected
          ? "w-full bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          : "w-full border-0 bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700"
      }
      variant={connected ? "secondary" : "default"}
    >
      {connected ? (
        <>
          <Settings2 className="mr-1.5 h-3.5 w-3.5" />
          {t("board.manage")}
        </>
      ) : (
        <>
          <Plug className="mr-1.5 h-3.5 w-3.5" />
          {t("board.connect")}
        </>
      )}
    </Button>
  );

  // ── Lijstweergave: compacte horizontale rij ──
  if (view === "list") {
    return (
      <Card className="border-0 shadow-sm transition-colors hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
        <CardContent className="flex items-center gap-3 p-3">
          {iconBox}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {board.display_name}
            </p>
            {meta}
          </div>
          {badge}
          <Link href={`/job-boards/${board.id}`} className="w-32 shrink-0">
            {actionButton}
          </Link>
        </CardContent>
      </Card>
    );
  }

  // ── Rasterweergave: gelijke hoogte, knop onderaan uitgelijnd ──
  return (
    <Card className="group flex h-full flex-col border-0 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            {iconBox}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {board.display_name}
              </p>
              {meta}
            </div>
          </div>
          {badge}
        </div>

        {integration?.last_error && (
          <p className="flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="line-clamp-2">{integration.last_error}</span>
          </p>
        )}

        <Link href={`/job-boards/${board.id}`} className="mt-auto block">
          {actionButton}
        </Link>
      </CardContent>
    </Card>
  );
}

function PostingRow({
  posting,
  boardName,
  onOpen,
}: {
  posting: JobPosting;
  boardName: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation("jobBoards");
  const palette = brandColor(posting.board_id);
  const status = STATUS_PILL[posting.status];

  return (
    <tr
      className="cursor-pointer transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30"
      onClick={onOpen}
    >
      <td className="py-3.5 pl-5 pr-4">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          <Briefcase className="h-3.5 w-3.5 text-indigo-500" />
          {posting.job_title ?? posting.job_id}
        </div>
      </td>
      <td className="py-3.5 px-4">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br ${palette.from} ${palette.to} text-[10px] font-bold ${palette.text}`}
            aria-hidden
          >
            {brandInitials(boardName)}
          </span>
          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            {boardName}
          </span>
        </div>
      </td>
      <td className="py-3.5 px-4">
        <Badge className={status.className}>
          {t(`status.${posting.status}`)}
        </Badge>
      </td>
      <td className="py-3.5 px-4 text-right text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {posting.applicants_count}
      </td>
      <td className="py-3.5 px-4 text-right text-sm text-zinc-700 dark:text-zinc-300">
        {posting.cost_amount === null
          ? "—"
          : posting.cost_amount === 0
            ? t("hub.free")
            : formatEuro(posting.cost_amount, posting.cost_currency ?? "EUR")}
      </td>
      <td className="py-3.5 pl-4 pr-5 text-xs text-muted-foreground">
        {formatDateTime(posting.posted_at)}
      </td>
    </tr>
  );
}

function PostingDetailDialog({
  postingId,
  boardCatalog,
  onClose,
}: {
  postingId: string | null;
  boardCatalog: JobBoardCatalogEntry[];
  onClose: () => void;
}) {
  const { t } = useTranslation("jobBoards");
  const { data, isLoading } = useJobPosting(postingId ?? undefined);
  const retract = useRetractPosting();
  const { toast } = useToast();

  const board = data
    ? boardCatalog.find((b) => b.id === data.board_id)
    : undefined;

  return (
    <Dialog
      open={!!postingId}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-indigo-600" />
            {t("dialog.title")}
          </DialogTitle>
        </DialogHeader>
        {isLoading || !data ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-lg border border-border bg-zinc-50/60 p-4 dark:bg-zinc-800/30">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {data.job_title ?? data.job_id}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {board?.display_name ?? data.board_id}
                  </p>
                </div>
                <Badge className={STATUS_PILL[data.status].className}>
                  {t(`status.${data.status}`)}
                </Badge>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">{t("dialog.applicants")}</dt>
                <dd className="text-right font-semibold text-zinc-900 dark:text-zinc-100">
                  {data.applicants_count}
                </dd>
                <dt className="text-muted-foreground">{t("dialog.cost")}</dt>
                <dd className="text-right text-zinc-700 dark:text-zinc-300">
                  {data.cost_amount === null
                    ? "—"
                    : data.cost_amount === 0
                      ? t("dialog.free")
                      : formatEuro(
                          data.cost_amount,
                          data.cost_currency ?? "EUR"
                        )}
                </dd>
                <dt className="text-muted-foreground">{t("dialog.posted")}</dt>
                <dd className="text-right text-zinc-700 dark:text-zinc-300">
                  {formatDateTime(data.posted_at)}
                </dd>
                <dt className="text-muted-foreground">{t("dialog.expires")}</dt>
                <dd className="text-right text-zinc-700 dark:text-zinc-300">
                  {formatDateTime(data.expires_at)}
                </dd>
              </dl>

              {data.error_message && (
                <p className="mt-3 flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {data.error_message}
                </p>
              )}
            </div>

            {/* Status events timeline */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("dialog.timeline")}
              </p>
              <ol className="relative space-y-3 border-l border-border pl-4">
                {data.events.length === 0 && (
                  <li className="text-xs text-muted-foreground">
                    {t("dialog.noEvents")}
                  </li>
                )}
                {data.events.map((evt) => (
                  <li key={evt.id} className="relative">
                    <span className="absolute -left-[21px] top-1 flex h-3 w-3 items-center justify-center rounded-full border-2 border-white bg-indigo-500 dark:border-zinc-900" />
                    <div className="flex items-center gap-2 text-xs font-medium text-zinc-900 dark:text-zinc-100">
                      <EventIcon event={evt.event} />
                      <span className="capitalize">{evt.event}</span>
                      <span className="text-[11px] font-normal text-muted-foreground">
                        · {formatDateTime(evt.created_at)}
                      </span>
                    </div>
                    {Object.keys(evt.payload ?? {}).length > 0 && (
                      <pre className="mt-1 max-w-full overflow-x-auto rounded-md bg-zinc-50 p-2 text-[10px] text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-300">
                        {JSON.stringify(evt.payload, null, 2)}
                      </pre>
                    )}
                  </li>
                ))}
              </ol>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              {data.external_url && data.status === "posted" && (
                <a
                  href={data.external_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  {t("dialog.viewExternal")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {data.status === "posted" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={retract.isPending}
                  onClick={async () => {
                    await retract.mutateAsync(data.id);
                    toast({ title: t("dialog.toasts.retracted") });
                    onClose();
                  }}
                >
                  {retract.isPending && (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  )}
                  {t("dialog.retract")}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EventIcon({ event }: { event: string }) {
  const cls = "h-3.5 w-3.5";
  switch (event) {
    case "posted":
      return <Send className={`${cls} text-emerald-500`} />;
    case "failed":
      return <AlertCircle className={`${cls} text-red-500`} />;
    case "retracted":
      return <Inbox className={`${cls} text-zinc-400`} />;
    case "queued":
      return <Clock className={`${cls} text-blue-500`} />;
    case "created":
      return <CheckCircle2 className={`${cls} text-indigo-500`} />;
    default:
      return <Globe className={`${cls} text-muted-foreground`} />;
  }
}
