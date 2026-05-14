"use client";

/**
 * Sprint Q4.3 — Job-detail "Distributie"-tab.
 *
 * Per-board state matrix, multi-select bulk-post, intrekken, retry-on-failed,
 * total-spend summary and per-source applicants chart.
 *
 * Wired into the existing 6-tab job detail page (Slice 4.5) by adding a 7th
 * tab. To wire this in, add the following to
 * `apps/web/app/(dashboard)/jobs/[id]/page.tsx`:
 *
 *   import { JobDistributionTab } from "@/components/jobs/tabs/JobDistributionTab";
 *   const VALID_TABS = [..., "distributie"] as const;
 *   <TabsTrigger value="distributie">Distributie</TabsTrigger>
 *   <TabsContent value="distributie"><JobDistributionTab jobId={jobId} jobTitle={job.title} /></TabsContent>
 */

import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Coins,
  Globe,
  Loader2,
  RefreshCw,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  useCreatePostings,
  useJobBoardCatalog,
  useJobBoardIntegrations,
  useJobPostings,
  useRetractPosting,
} from "@/hooks/useJobBoards";
import type { JobBoardIntegration, JobPosting } from "@/lib/types/jobBoards";

interface JobDistributionTabProps {
  jobId: string;
  jobTitle?: string;
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

export function JobDistributionTab({ jobId, jobTitle }: JobDistributionTabProps) {
  const { toast } = useToast();
  const { data: catalog, isLoading: catalogLoading } = useJobBoardCatalog();
  const { data: integrations } = useJobBoardIntegrations();
  const { data: postings, isLoading: postingsLoading } = useJobPostings({
    job_id: jobId,
  });

  const createPostings = useCreatePostings();
  const retract = useRetractPosting();

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const integrationByBoard = useMemo(() => {
    const map = new Map<string, JobBoardIntegration>();
    for (const i of integrations ?? []) map.set(i.board_id, i);
    return map;
  }, [integrations]);

  const postingByBoard = useMemo(() => {
    const map = new Map<string, JobPosting>();
    // most recent posting wins when multiple exist for the same board
    for (const p of postings ?? []) {
      const cur = map.get(p.board_id);
      if (!cur || (cur.created_at ?? "") < (p.created_at ?? "")) {
        map.set(p.board_id, p);
      }
    }
    return map;
  }, [postings]);

  const totalSpend = (postings ?? [])
    .filter((p) => p.status === "posted" || p.status === "expired" || p.status === "retracted")
    .reduce((sum, p) => sum + (p.cost_amount ?? 0), 0);

  const totalApplicants = (postings ?? []).reduce(
    (sum, p) => sum + p.applicants_count,
    0
  );

  const applicantsChartData = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of postings ?? []) {
      map.set(p.board_id, (map.get(p.board_id) ?? 0) + p.applicants_count);
    }
    const cat = catalog ?? [];
    return Array.from(map.entries())
      .map(([board_id, applicants]) => ({
        board: cat.find((b) => b.id === board_id)?.display_name ?? board_id,
        applicants,
      }))
      .sort((a, b) => b.applicants - a.applicants);
  }, [postings, catalog]);

  const toggle = (boardId: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(boardId)) next.delete(boardId);
      else next.add(boardId);
      return next;
    });
  };

  const handleBulkPost = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    try {
      await createPostings.mutateAsync({
        job_id: jobId,
        job_title: jobTitle,
        board_ids: ids,
      });
      toast({
        title: `${ids.length} plaatsing(en) aangemaakt`,
        description: "Status volgt zodra de boards de plaatsingen verwerken.",
      });
      setSelected(new Set());
    } catch {
      toast({ title: "Plaatsen mislukt", variant: "destructive" });
    }
  };

  const handleSinglePost = async (boardId: string) => {
    try {
      await createPostings.mutateAsync({
        job_id: jobId,
        job_title: jobTitle,
        board_ids: [boardId],
      });
      toast({ title: "Plaatsing aangemaakt" });
    } catch {
      toast({ title: "Plaatsen mislukt", variant: "destructive" });
    }
  };

  const handleRetract = async (postingId: string) => {
    try {
      await retract.mutateAsync(postingId);
      toast({ title: "Plaatsing ingetrokken" });
    } catch {
      toast({ title: "Intrekken mislukt", variant: "destructive" });
    }
  };

  if (catalogLoading || postingsLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const sortedCatalog = (catalog ?? []).slice().sort((a, b) => {
    // connected boards float to top
    const aConn = integrationByBoard.get(a.id)?.status === "connected" ? 0 : 1;
    const bConn = integrationByBoard.get(b.id)?.status === "connected" ? 0 : 1;
    if (aConn !== bConn) return aConn - bConn;
    return a.display_name.localeCompare(b.display_name);
  });

  return (
    <div className="space-y-5">
      {/* Bulk action bar */}
      <Card className="border-0 bg-gradient-to-r from-indigo-50 to-purple-50 shadow-sm dark:from-indigo-950/30 dark:to-purple-950/30">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm">
              <Send className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Multi-board plaatsen
              </p>
              <p className="text-xs text-muted-foreground">
                Selecteer één of meerdere vacaturebanken hieronder en plaats in
                één klik.
              </p>
            </div>
          </div>
          <Button
            onClick={handleBulkPost}
            disabled={selected.size === 0 || createPostings.isPending}
            className="border-0 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
          >
            {createPostings.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-1.5 h-4 w-4" />
            )}
            Plaats op geselecteerde ({selected.size})
          </Button>
        </CardContent>
      </Card>

      {/* Board grid */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {sortedCatalog.map((board) => {
              const integration = integrationByBoard.get(board.id);
              const posting = postingByBoard.get(board.id);
              const connected = integration?.status === "connected";
              const isSelected = selected.has(board.id);
              const canSelect =
                connected && (!posting || posting.status === "expired" || posting.status === "retracted");
              return (
                <BoardRow
                  key={board.id}
                  boardId={board.id}
                  boardName={board.display_name}
                  region={board.region.toUpperCase()}
                  connected={connected}
                  posting={posting}
                  selected={isSelected}
                  selectable={canSelect}
                  onToggle={() => toggle(board.id)}
                  onPost={() => handleSinglePost(board.id)}
                  onRetract={(id) => handleRetract(id)}
                  isPosting={createPostings.isPending}
                  isRetracting={retract.isPending}
                />
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Cost summary + applicants chart */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-0 shadow-sm">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-sm">
                <Coins className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Totaal besteed
                </p>
                <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                  {formatEuro(totalSpend)}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs">
              <div>
                <p className="text-muted-foreground">Sollicitaties</p>
                <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {totalApplicants}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Actieve plaatsingen</p>
                <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {(postings ?? []).filter((p) => p.status === "posted").length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-purple-500" />
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Sollicitaties per kanaal
              </p>
            </div>
            {applicantsChartData.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Nog geen sollicitaties geregistreerd.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(140, applicantsChartData.length * 32)}>
                <BarChart
                  data={applicantsChartData}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
                >
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "#71717a" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="board"
                    width={120}
                    tick={{ fontSize: 11, fill: "#71717a" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(v) => [String(v ?? 0), "sollicitaties"]}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid #e4e4e7",
                      fontSize: "12px",
                    }}
                    cursor={{ fill: "#f4f4f5" }}
                  />
                  <Bar
                    dataKey="applicants"
                    fill="#8b5cf6"
                    radius={[0, 4, 4, 0]}
                    maxBarSize={20}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface BoardRowProps {
  boardId: string;
  boardName: string;
  region: string;
  connected: boolean;
  posting: JobPosting | undefined;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
  onPost: () => void;
  onRetract: (postingId: string) => void;
  isPosting: boolean;
  isRetracting: boolean;
}

function BoardRow(props: BoardRowProps) {
  const {
    boardId,
    boardName,
    region,
    connected,
    posting,
    selected,
    selectable,
    onToggle,
    onPost,
    onRetract,
    isPosting,
    isRetracting,
  } = props;

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30 sm:flex-row sm:items-center">
      {/* Checkbox */}
      <label
        className={`flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border transition-colors ${
          !selectable
            ? "cursor-not-allowed border-zinc-200 bg-zinc-100/60 dark:border-zinc-700 dark:bg-zinc-800/60"
            : selected
              ? "border-indigo-500 bg-indigo-500 text-white"
              : "border-zinc-300 hover:border-indigo-400 dark:border-zinc-600 dark:hover:border-indigo-500"
        }`}
      >
        <input
          type="checkbox"
          className="sr-only"
          checked={selected}
          disabled={!selectable}
          onChange={onToggle}
          aria-label={`${boardName} selecteren`}
        />
        {selected && <CheckCircle2 className="h-3 w-3" />}
      </label>

      {/* Brand + name */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-100 to-purple-100 text-xs font-bold text-indigo-700 dark:from-indigo-950/40 dark:to-purple-950/40 dark:text-indigo-300">
          {brandInitials(boardName)}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {boardName}
          </p>
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Globe className="h-3 w-3" />
            {region}
            {!connected && (
              <span className="ml-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[9px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                niet verbonden
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Status / action area */}
      <div className="flex shrink-0 items-center gap-2">
        {!connected ? (
          <a
            href={`/job-boards/${boardId}`}
            className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Verbinden →
          </a>
        ) : posting?.status === "posted" ? (
          <>
            <Badge className="border-0 bg-emerald-100 text-[11px] text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              Live op {boardName}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {posting.applicants_count} sollicitaties
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRetract(posting.id)}
              disabled={isRetracting}
              className="h-7 border-destructive/40 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="mr-1 h-3 w-3" />
              Intrekken
            </Button>
          </>
        ) : posting?.status === "queued" ? (
          <Badge className="border-0 bg-blue-100 text-[11px] text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            In wachtrij
          </Badge>
        ) : posting?.status === "failed" ? (
          <>
            <Badge className="border-0 bg-red-100 text-[11px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
              <AlertCircle className="mr-1 h-3 w-3" />
              Mislukt
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={onPost}
              disabled={isPosting}
              className="h-7 text-[11px]"
            >
              <RefreshCw className="mr-1 h-3 w-3" />
              Opnieuw
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            onClick={onPost}
            disabled={isPosting}
            className="h-7 border-0 bg-gradient-to-r from-indigo-500 to-purple-600 text-[11px] hover:from-indigo-600 hover:to-purple-700"
          >
            {isPosting ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Send className="mr-1 h-3 w-3" />
            )}
            Plaatsen
          </Button>
        )}
      </div>
    </div>
  );
}
