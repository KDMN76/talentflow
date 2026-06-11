"use client";

/**
 * Sprint Q4.5 — Agentic AI Sourcing hub.
 *
 * Composes:
 *   - hero with brief→25-candidates pitch + AiDisclosureBadge
 *   - 4 stat-cards (active runs, findings to review, approved this month, AI cost)
 *   - tab strip: Briefs | Runs | Findings | Audit Trail
 *   - "Nieuwe brief"-modal (job picker + brief text + chips + locations + slider)
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Bot,
  Briefcase,
  CheckCircle2,
  Coins,
  Inbox,
  Loader2,
  Plus,
  Search,
  Shield,
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
  Dialog,
  DialogContent,
  DialogDescription,
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
import { AiDisclosureBadge } from "@/components/ai/AiDisclosureBadge";
import {
  useAgentBriefs,
  useAgentRuns,
  useAgentFindings,
  useAgentActions,
  useCreateBrief,
  useApproveFinding,
  useRejectFinding,
  useBulkApproveFindings,
} from "@/hooks/useSourcing";
import { useJobs } from "@/hooks/useJobs";
import {
  RUN_STATUS_PILL,
  FINDING_STATUS_PILL,
  RUN_STATUS_ICON,
  MatchScoreGauge,
  formatDateTimeNL,
  formatRelativeNL,
  getInitials,
} from "@/components/sourcing/visualHelpers";
import type { AgentBrief } from "@/lib/types/sourcing";

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SourcingAgentHubPage() {
  const { t } = useTranslation("sourcing");
  const { data: briefs } = useAgentBriefs();
  const { data: runs } = useAgentRuns();
  const { data: findings } = useAgentFindings(undefined);
  const { data: actions } = useAgentActions(undefined);

  const activeRuns = (runs ?? []).filter(
    (r) => r.status === "queued" || r.status === "running"
  ).length;
  const findingsToReview = (findings ?? []).filter(
    (f) => f.status === "pending_review"
  ).length;
  const approvedThisMonth = useMemo(() => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return (findings ?? []).filter(
      (f) =>
        f.status === "approved" &&
        f.reviewed_at &&
        new Date(f.reviewed_at).getTime() >= start.getTime()
    ).length;
  }, [findings]);
  const aiCostThisMonth = useMemo(() => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return (actions ?? [])
      .filter(
        (a) =>
          a.cost_usd !== null && new Date(a.created_at).getTime() >= start.getTime()
      )
      .reduce((sum, a) => sum + (a.cost_usd ?? 0), 0);
  }, [actions]);

  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("hub.header.title")}
        description={t("hub.header.description")}
        actions={<AiDisclosureBadge />}
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
                {t("hub.hero.title")}
              </h2>
              <p className="text-sm text-white/85">
                {t("hub.hero.description")}
              </p>
            </div>
            <Button
              size="lg"
              variant="secondary"
              className="bg-white text-indigo-700 hover:bg-white/90"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              {t("hub.hero.newBrief")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("hub.stats.activeRuns.label")}
          value={String(activeRuns)}
          hint={t("hub.stats.activeRuns.hint", { count: (runs ?? []).length })}
          gradient="from-indigo-500 to-purple-600"
          icon={<Bot className="h-5 w-5" />}
        />
        <StatCard
          label={t("hub.stats.toReview.label")}
          value={String(findingsToReview)}
          hint={t("hub.stats.toReview.hint")}
          gradient="from-amber-500 to-orange-600"
          icon={<Inbox className="h-5 w-5" />}
        />
        <StatCard
          label={t("hub.stats.approvedThisMonth.label")}
          value={String(approvedThisMonth)}
          hint={t("hub.stats.approvedThisMonth.hint")}
          gradient="from-emerald-500 to-teal-600"
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
        <StatCard
          label={t("hub.stats.aiCost.label")}
          value={`$${aiCostThisMonth.toFixed(2)}`}
          hint={t("hub.stats.aiCost.hint")}
          gradient="from-rose-500 to-pink-600"
          icon={<Coins className="h-5 w-5" />}
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="briefs" className="space-y-4">
        <TabsList>
          <TabsTrigger value="briefs">{t("hub.tabs.briefs")}</TabsTrigger>
          <TabsTrigger value="runs">{t("hub.tabs.runs")}</TabsTrigger>
          <TabsTrigger value="findings">{t("hub.tabs.findings")}</TabsTrigger>
          <TabsTrigger value="audit">{t("hub.tabs.audit")}</TabsTrigger>
        </TabsList>

        <TabsContent value="briefs" className="space-y-3">
          <BriefsTab onNewBrief={() => setCreateOpen(true)} />
        </TabsContent>

        <TabsContent value="runs">
          <RunsTab />
        </TabsContent>

        <TabsContent value="findings">
          <FindingsTab />
        </TabsContent>

        <TabsContent value="audit">
          <AuditTrailTab />
        </TabsContent>
      </Tabs>

      <CreateBriefDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  hint,
  gradient,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  gradient: string;
  icon: React.ReactNode;
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
          <p className="text-[11px] text-muted-foreground">{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Briefs tab ──────────────────────────────────────────────────────────────

function BriefsTab({ onNewBrief }: { onNewBrief: () => void }) {
  const { t } = useTranslation("sourcing");
  const { data, isLoading } = useAgentBriefs();
  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
    );
  }
  if (!data || data.length === 0) {
    return (
      <EmptyState
        title={t("hub.briefsTab.empty.title")}
        description={t("hub.briefsTab.empty.description")}
        action={
          <Button onClick={onNewBrief}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t("hub.hero.newBrief")}
          </Button>
        }
      />
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {data.map((brief) => (
        <BriefCard key={brief.id} brief={brief} />
      ))}
    </div>
  );
}

function BriefCard({ brief }: { brief: AgentBrief }) {
  const { t } = useTranslation("sourcing");
  const { data: jobs } = useJobs("all");
  const job = (jobs ?? []).find((j) => j.id === brief.job_id);
  return (
    <Link href={`/sourcing-agent/briefs/${brief.id}`}>
      <Card className="group h-full border-0 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
        <CardContent className="space-y-3 p-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 line-clamp-2">
                {job?.title ?? brief.job_id}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t("hub.briefsTab.card.meta", {
                  locations: brief.search_locations.join(" · "),
                  count: brief.target_count,
                })}
              </p>
            </div>
            {brief.active ? (
              <Badge className="border-0 bg-emerald-100 text-[10px] text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                {t("hub.briefsTab.card.active")}
              </Badge>
            ) : (
              <Badge className="border-0 bg-zinc-100 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {t("hub.briefsTab.card.archived")}
              </Badge>
            )}
          </div>
          <p className="line-clamp-3 text-xs text-zinc-600 dark:text-zinc-400">
            {brief.brief_text}
          </p>
          <div className="flex flex-wrap gap-1">
            {brief.must_have.slice(0, 4).map((m) => (
              <span
                key={m}
                className="rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
              >
                {m}
              </span>
            ))}
            {brief.must_have.length > 4 && (
              <span className="text-[10px] text-muted-foreground">
                +{brief.must_have.length - 4}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// ─── Runs tab ────────────────────────────────────────────────────────────────

function RunsTab() {
  const { t } = useTranslation("sourcing");
  const { data, isLoading } = useAgentRuns();
  const { data: briefs } = useAgentBriefs();
  const { data: jobs } = useJobs("all");
  if (isLoading) return <Skeleton className="h-72 rounded-xl" />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        title={t("hub.runsTab.empty.title")}
        description={t("hub.runsTab.empty.description")}
      />
    );
  }
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-zinc-50/60 dark:bg-zinc-800/40">
                <th className="py-3 pl-5 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("hub.runsTab.columns.status")}
                </th>
                <th className="py-3 px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("hub.runsTab.columns.brief")}
                </th>
                <th className="py-3 px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("hub.runsTab.columns.progress")}
                </th>
                <th className="py-3 px-4 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("hub.runsTab.columns.found")}
                </th>
                <th className="py-3 px-4 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("hub.runsTab.columns.approved")}
                </th>
                <th className="py-3 pl-4 pr-5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("hub.runsTab.columns.started")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((run) => {
                const brief = (briefs ?? []).find((b) => b.id === run.brief_id);
                const job = brief
                  ? (jobs ?? []).find((j) => j.id === brief.job_id)
                  : undefined;
                const StatusIcon = RUN_STATUS_ICON[run.status];
                const pill = RUN_STATUS_PILL[run.status];
                const running = run.status === "running";
                const progressPct =
                  run.candidates_found > 0
                    ? Math.min(
                        100,
                        Math.round(
                          (run.candidates_found /
                            Math.max(1, brief?.target_count ?? 25)) *
                            100
                        )
                      )
                    : running
                      ? 35
                      : 0;
                return (
                  <tr
                    key={run.id}
                    className="cursor-pointer transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30"
                  >
                    <td className="py-3.5 pl-5 pr-4">
                      <Link
                        href={`/sourcing-agent/runs/${run.id}`}
                        className="inline-flex items-center gap-2"
                      >
                        <StatusIcon
                          className={`h-3.5 w-3.5 ${
                            running ? "animate-pulse text-indigo-500" : "text-muted-foreground"
                          }`}
                        />
                        <Badge className={pill.className}>{pill.label}</Badge>
                      </Link>
                    </td>
                    <td className="py-3.5 px-4">
                      <Link
                        href={`/sourcing-agent/runs/${run.id}`}
                        className="text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-100"
                      >
                        {job?.title ?? run.brief_id}
                      </Link>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                          <div
                            className={`h-full rounded-full transition-all ${
                              running
                                ? "animate-pulse bg-gradient-to-r from-indigo-500 to-purple-500"
                                : "bg-emerald-500"
                            }`}
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          {t("hub.runsTab.iteration", {
                            count: run.expansion_iteration,
                          })}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {run.candidates_found}
                    </td>
                    <td className="py-3.5 px-4 text-right text-sm text-emerald-600">
                      {run.candidates_approved}
                    </td>
                    <td className="py-3.5 pl-4 pr-5 text-xs text-muted-foreground">
                      {formatRelativeNL(run.started_at ?? run.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Findings tab — cross-run inbox ──────────────────────────────────────────

function FindingsTab() {
  const { t } = useTranslation("sourcing");
  const { data: findings, isLoading } = useAgentFindings(undefined, {
    status: "pending_review",
  });
  const { data: briefs } = useAgentBriefs();
  const { data: jobs } = useJobs("all");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const bulkApprove = useBulkApproveFindings();
  const { toast } = useToast();

  const grouped = useMemo(() => {
    const map = new Map<string, typeof findings>();
    for (const f of findings ?? []) {
      const arr = map.get(f.brief_id) ?? [];
      arr.push(f);
      map.set(f.brief_id, arr);
    }
    return map;
  }, [findings]);

  const selectedIds = Object.entries(selected)
    .filter(([, v]) => v)
    .map(([k]) => k);

  if (isLoading) return <Skeleton className="h-72 rounded-xl" />;
  if (!findings || findings.length === 0) {
    return (
      <EmptyState
        title="Geen kandidaten ter beoordeling"
        description="Goed nieuws — alles is afgehandeld. Start een nieuwe run om door te gaan."
      />
    );
  }
  return (
    <div className="space-y-4">
      {selectedIds.length > 0 && (
        <Card className="border-indigo-200 bg-indigo-50/60 shadow-sm dark:border-indigo-900 dark:bg-indigo-950/30">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <p className="text-sm font-medium text-indigo-900 dark:text-indigo-200">
              {selectedIds.length} geselecteerd
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelected({})}
              >
                Wissen
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  await bulkApprove.mutateAsync({ ids: selectedIds });
                  toast({
                    title: `${selectedIds.length} kandidaten goedgekeurd`,
                  });
                  setSelected({});
                }}
                disabled={bulkApprove.isPending}
              >
                {bulkApprove.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1.5 h-4 w-4" />
                )}
                Goedkeuren
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {Array.from(grouped.entries()).map(([briefId, items]) => {
        const brief = (briefs ?? []).find((b) => b.id === briefId);
        const job = brief
          ? (jobs ?? []).find((j) => j.id === brief.job_id)
          : undefined;
        return (
          <div key={briefId} className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <Briefcase className="h-3.5 w-3.5 text-indigo-500" />
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {job?.title ?? briefId} · {(items ?? []).length} kandidaten
              </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {(items ?? []).map((f) => (
                <FindingInboxRow
                  key={f.id}
                  finding={f}
                  selected={!!selected[f.id]}
                  onToggleSelect={(v) =>
                    setSelected((cur) => ({ ...cur, [f.id]: v }))
                  }
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FindingInboxRow({
  finding,
  selected,
  onToggleSelect,
}: {
  finding: import("@/lib/types/sourcing").AgentFinding;
  selected: boolean;
  onToggleSelect: (v: boolean) => void;
}) {
  const approve = useApproveFinding();
  const reject = useRejectFinding();
  const { toast } = useToast();
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="flex items-start gap-3 p-4">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggleSelect(e.target.checked)}
          className="mt-1 h-4 w-4 cursor-pointer rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
          aria-label="Selecteer kandidaat"
        />
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-xs font-semibold text-white">
          {getInitials(finding.full_name)}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {finding.full_name}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {finding.current_title} · {finding.current_company} ·{" "}
                {finding.location}
              </p>
            </div>
            <MatchScoreGauge score={finding.match_score} />
          </div>
          <p className="line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">
            {finding.match_reasoning}
          </p>
          <div className="flex flex-wrap gap-1 pt-1">
            {finding.skills.slice(0, 5).map((s) => (
              <span
                key={s}
                className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {s}
              </span>
            ))}
          </div>
          <div className="flex gap-2 pt-2">
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
              className="h-7 text-[11px] text-muted-foreground"
              disabled={reject.isPending}
              onClick={async () => {
                await reject.mutateAsync({
                  id: finding.id,
                  reason: "Niet relevant",
                });
                toast({ title: "Afgewezen" });
              }}
            >
              <X className="mr-1 h-3 w-3" />
              Afwijzen
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Audit trail tab ─────────────────────────────────────────────────────────

function AuditTrailTab() {
  const { data: actions, isLoading } = useAgentActions(undefined);
  if (isLoading) return <Skeleton className="h-72 rounded-xl" />;
  if (!actions || actions.length === 0) {
    return (
      <EmptyState
        title="Geen agent-acties geregistreerd"
        description="Zodra de agent runs uitvoert verschijnt hier het volledige audit-spoor."
      />
    );
  }
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b border-border bg-amber-50/60 px-5 py-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <Shield className="h-3.5 w-3.5" />
          WORM — read-only audit log voor compliance.
        </div>
        <ol className="divide-y divide-border">
          {actions.map((a) => (
            <li key={a.id} className="flex items-start gap-4 px-5 py-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800">
                <Bot className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {a.action}
                  </code>
                  <span className="text-[11px] text-muted-foreground">
                    run {a.run_id} · {formatDateTimeNL(a.created_at)}
                  </span>
                  {a.requires_approval && !a.approved_at && (
                    <Badge className="border-0 bg-amber-100 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                      Wacht op goedkeuring
                    </Badge>
                  )}
                  {a.approved_at && (
                    <Badge className="border-0 bg-emerald-100 text-[10px] text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      Goedgekeurd
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-zinc-700 dark:text-zinc-300">
                  {a.reasoning}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  {a.ai_model && <span>model: {a.ai_model}</span>}
                  {a.cost_usd !== null && (
                    <span>kost: ${a.cost_usd.toFixed(3)}</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

// ─── New brief modal ─────────────────────────────────────────────────────────

function CreateBriefDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: jobs, isLoading: jobsLoading } = useJobs("open");
  const [jobId, setJobId] = useState<string>("");
  const [briefText, setBriefText] = useState("");
  const [targetCount, setTargetCount] = useState(25);
  const [mustHaveInput, setMustHaveInput] = useState("");
  const [mustHave, setMustHave] = useState<string[]>([]);
  const [exclusionsInput, setExclusionsInput] = useState("");
  const [exclusions, setExclusions] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>(["Amsterdam"]);
  const create = useCreateBrief();
  const { toast } = useToast();

  // Default to first job when list loads
  useEffect(() => {
    if (!jobId && jobs && jobs.length > 0) {
      setJobId(jobs[0].id);
    }
  }, [jobs, jobId]);

  const ALL_LOCATIONS = [
    "Amsterdam",
    "Utrecht",
    "Rotterdam",
    "Den Haag",
    "Eindhoven",
    "Remote NL",
    "Remote EU",
  ];

  const addChip = (
    value: string,
    setValue: (v: string) => void,
    list: string[],
    setList: (v: string[]) => void
  ) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (list.includes(trimmed)) return;
    setList([...list, trimmed]);
    setValue("");
  };

  const reset = () => {
    setJobId(jobs?.[0]?.id ?? "");
    setBriefText("");
    setTargetCount(25);
    setMustHaveInput("");
    setMustHave([]);
    setExclusionsInput("");
    setExclusions([]);
    setLocations(["Amsterdam"]);
  };

  const handleSubmit = async () => {
    if (!jobId || !briefText.trim()) {
      toast({
        title: "Vul alle verplichte velden in",
        variant: "destructive",
      });
      return;
    }
    await create.mutateAsync({
      job_id: jobId,
      brief_text: briefText.trim(),
      must_have: mustHave,
      nice_to_have: [],
      exclusions,
      target_count: targetCount,
      search_locations: locations,
      language_preferences: ["nl", "en"],
    });
    toast({ title: "Brief aangemaakt" });
    reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-500" />
            Nieuwe sourcing-brief
          </DialogTitle>
          <DialogDescription>
            De agent gebruikt deze brief om kandidaten te vinden, te scoren, en
            ter beoordeling aan te bieden.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="brief-job">Vacature</Label>
            <Select value={jobId} onValueChange={setJobId}>
              <SelectTrigger id="brief-job">
                <SelectValue
                  placeholder={
                    jobsLoading
                      ? "Vacatures laden..."
                      : !jobs || jobs.length === 0
                        ? "Geen openstaande vacatures"
                        : "Kies een vacature"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {(jobs ?? []).map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="brief-text">Brief</Label>
            <Textarea
              id="brief-text"
              rows={5}
              placeholder="Beschrijf het profiel zoals je tegen een collega zou doen — taal, locatie, must-haves, dealbreakers..."
              value={briefText}
              onChange={(e) => setBriefText(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Doelaantal kandidaten</Label>
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                value={targetCount}
                onChange={(e) => setTargetCount(Number(e.target.value))}
                className="mt-2 w-full accent-indigo-500"
              />
              <p className="text-xs text-muted-foreground">
                {targetCount} kandidaten
              </p>
            </div>
            <div>
              <Label>Locaties</Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {ALL_LOCATIONS.map((loc) => {
                  const active = locations.includes(loc);
                  return (
                    <button
                      key={loc}
                      type="button"
                      onClick={() =>
                        setLocations((cur) =>
                          active
                            ? cur.filter((l) => l !== loc)
                            : [...cur, loc]
                        )
                      }
                      className={
                        active
                          ? "rounded-full border border-indigo-300 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-medium text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300"
                          : "rounded-full border border-zinc-200 px-2.5 py-0.5 text-[11px] font-medium text-zinc-600 hover:border-indigo-200 hover:text-indigo-600 dark:border-zinc-700 dark:text-zinc-300"
                      }
                    >
                      {loc}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Must-have</Label>
              <div className="mt-1 flex flex-wrap gap-1">
                {mustHave.map((m) => (
                  <Chip
                    key={m}
                    label={m}
                    onRemove={() => setMustHave(mustHave.filter((x) => x !== m))}
                    color="indigo"
                  />
                ))}
              </div>
              <Input
                className="mt-2"
                placeholder="Druk Enter om toe te voegen"
                value={mustHaveInput}
                onChange={(e) => setMustHaveInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addChip(mustHaveInput, setMustHaveInput, mustHave, setMustHave);
                  }
                }}
              />
            </div>
            <div>
              <Label>Uitsluitingen</Label>
              <div className="mt-1 flex flex-wrap gap-1">
                {exclusions.map((m) => (
                  <Chip
                    key={m}
                    label={m}
                    onRemove={() =>
                      setExclusions(exclusions.filter((x) => x !== m))
                    }
                    color="red"
                  />
                ))}
              </div>
              <Input
                className="mt-2"
                placeholder="Druk Enter om toe te voegen"
                value={exclusionsInput}
                onChange={(e) => setExclusionsInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addChip(
                      exclusionsInput,
                      setExclusionsInput,
                      exclusions,
                      setExclusions
                    );
                  }
                }}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuleren
          </Button>
          <Button onClick={handleSubmit} disabled={create.isPending}>
            {create.isPending && (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            )}
            Brief aanmaken
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Chip({
  label,
  onRemove,
  color,
}: {
  label: string;
  onRemove: () => void;
  color: "indigo" | "red";
}) {
  const cls =
    color === "indigo"
      ? "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900"
      : "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full p-0.5 hover:bg-black/5"
        aria-label="Verwijder"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
          <Search className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {title}
        </p>
        <p className="text-xs text-muted-foreground">{description}</p>
        {action ? (
          <div className="mt-2">{action}</div>
        ) : (
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <AlertCircle className="h-3 w-3" />
            Tip: gebruik de tabs hierboven om te navigeren.
          </span>
        )}
      </CardContent>
    </Card>
  );
}
