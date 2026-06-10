"use client";

/**
 * Sprint Q4.4 — Recruiter timesheets-overzicht.
 *
 * - Lijst met filters: status, contract, week.
 * - Approve / reject inline op submitted rows.
 * - Click rij → detail-dialog met entries grid.
 */

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import {
  useApproveTimesheet,
  useContracts,
  useRejectTimesheet,
  useTimesheets,
} from "@/hooks/useBackOffice";
import type { Timesheet, TimesheetStatus } from "@/lib/types/backOffice";

const STATUS_PILL: Record<TimesheetStatus, { label: string; cls: string }> = {
  draft: {
    label: "Concept",
    cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-0",
  },
  submitted: {
    label: "Ingediend",
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-0",
  },
  approved: {
    label: "Goedgekeurd",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-0",
  },
  rejected: {
    label: "Afgekeurd",
    cls: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-0",
  },
  disputed: {
    label: "Bezwaar",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-0",
  },
};

const WEEKDAYS_NL = [
  "Ma",
  "Di",
  "Wo",
  "Do",
  "Vr",
  "Za",
  "Zo",
];

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDay(value: string): string {
  return new Date(value).toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

export default function TimesheetsListPage() {
  const searchParams = useSearchParams();
  const focusId = searchParams?.get("focus") ?? null;
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState<TimesheetStatus | "all">(
    "all"
  );
  const [contractFilter, setContractFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data: contracts } = useContracts();
  const { data: timesheets, isLoading } = useTimesheets(
    contractFilter === "all" ? {} : { contract_id: contractFilter }
  );

  const approve = useApproveTimesheet();
  const reject = useRejectTimesheet();

  const [detail, setDetail] = useState<Timesheet | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectTarget, setRejectTarget] = useState<Timesheet | null>(null);

  const filtered = useMemo(() => {
    if (!timesheets) return [];
    let list = timesheets;
    if (statusFilter !== "all") list = list.filter((t) => t.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) => {
        const c = contracts?.find((ct) => ct.id === t.contract_id);
        return (
          c?.candidate_name?.toLowerCase().includes(q) ||
          c?.client_name?.toLowerCase().includes(q)
        );
      });
    }
    return [...list].sort((a, b) => (a.week_start < b.week_start ? 1 : -1));
  }, [timesheets, statusFilter, search, contracts]);

  // Auto-open detail dialog if ?focus=ts-X is in URL.
  useMemo(() => {
    if (focusId && timesheets && !detail) {
      const t = timesheets.find((ts) => ts.id === focusId);
      if (t) setDetail(t);
    }
  }, [focusId, timesheets, detail]);

  const stats = useMemo(() => {
    if (!timesheets) return { total: 0, pending: 0, approved: 0, rejected: 0 };
    return {
      total: timesheets.length,
      pending: timesheets.filter((t) => t.status === "submitted").length,
      approved: timesheets.filter((t) => t.status === "approved").length,
      rejected: timesheets.filter(
        (t) => t.status === "rejected" || t.status === "disputed"
      ).length,
    };
  }, [timesheets]);

  const findContract = (contractId: string) =>
    contracts?.find((c) => c.id === contractId);

  const handleApprove = async (id: string) => {
    try {
      await approve.mutateAsync(id);
      toast({
        title: "Goedgekeurd",
        description: "Timesheet kan nu worden gefactureerd.",
      });
    } catch {
      toast({ title: "Goedkeuren mislukt", variant: "destructive" });
    }
  };

  const openReject = (t: Timesheet) => {
    setRejectTarget(t);
    setRejectReason("");
    setRejectOpen(true);
  };

  const handleReject = async () => {
    if (!rejectTarget || !rejectReason.trim()) return;
    try {
      await reject.mutateAsync({
        id: rejectTarget.id,
        reason: rejectReason.trim(),
      });
      toast({
        title: "Afgekeurd",
        description: "Kandidaat ontvangt een melding om de uren te corrigeren.",
      });
      setRejectOpen(false);
      setRejectTarget(null);
      setRejectReason("");
    } catch {
      toast({ title: "Afkeuren mislukt", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Timesheets"
        description="Beoordeel ingediende urenstaten en geef vrij voor facturatie."
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Totaal" value={stats.total} accent="zinc" />
        <StatTile label="Te keuren" value={stats.pending} accent="amber" />
        <StatTile label="Goedgekeurd" value={stats.approved} accent="emerald" />
        <StatTile label="Afgekeurd / bezwaar" value={stats.rejected} accent="red" />
      </div>

      {/* Filters */}
      <Card className="border-0 shadow-sm">
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Zoek op kandidaat of klant..."
              className="pl-9"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-zinc-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) =>
              setStatusFilter(v as TimesheetStatus | "all")
            }
          >
            <SelectTrigger className="w-full lg:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle statussen</SelectItem>
              <SelectItem value="submitted">Ingediend</SelectItem>
              <SelectItem value="approved">Goedgekeurd</SelectItem>
              <SelectItem value="rejected">Afgekeurd</SelectItem>
              <SelectItem value="disputed">Bezwaar</SelectItem>
              <SelectItem value="draft">Concept</SelectItem>
            </SelectContent>
          </Select>
          <Select value={contractFilter} onValueChange={setContractFilter}>
            <SelectTrigger className="w-full lg:w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle contracten</SelectItem>
              {(contracts ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.candidate_name} — {c.client_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-16 text-center">
              <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm font-semibold">Geen timesheets gevonden</p>
              <p className="text-xs text-muted-foreground">
                Pas de filters aan om meer resultaten te zien.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-zinc-50/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground dark:bg-zinc-900/40">
                  <tr>
                    <th className="px-4 py-3">Kandidaat / klant</th>
                    <th className="px-4 py-3">Week</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Uren</th>
                    <th className="px-4 py-3 text-right">Overuren</th>
                    <th className="px-4 py-3 text-right">Acties</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => {
                    const c = findContract(t.contract_id);
                    const pill = STATUS_PILL[t.status];
                    return (
                      <tr
                        key={t.id}
                        onClick={() => setDetail(t)}
                        className="cursor-pointer border-b border-border/60 transition hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-zinc-900 dark:text-zinc-100">
                            {c?.candidate_name ?? "—"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {c?.client_name ?? "—"}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400">
                          {formatDate(t.week_start)} —{" "}
                          {formatDate(t.week_end)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={pill.cls}>{pill.label}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold">
                          {t.total_hours.toFixed(1)}u
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-amber-600 dark:text-amber-400">
                          {t.total_overtime_hours > 0
                            ? `+${t.total_overtime_hours.toFixed(1)}u`
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {t.status === "submitted" ? (
                            <div
                              className="flex justify-end gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openReject(t)}
                                className="h-8 border-destructive/40 text-destructive hover:bg-destructive/10"
                              >
                                <XCircle className="mr-1 h-3.5 w-3.5" />
                                Afkeuren
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => handleApprove(t.id)}
                                disabled={approve.isPending}
                                className="h-8 border-0 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700"
                              >
                                {approve.isPending ? (
                                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                )}
                                Goedkeuren
                              </Button>
                            </div>
                          ) : (
                            <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* DETAIL DIALOG */}
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {findContract(detail.contract_id)?.candidate_name ?? "Timesheet"}
                </DialogTitle>
                <DialogDescription>
                  Werkweek {formatDate(detail.week_start)} —{" "}
                  {formatDate(detail.week_end)} ·{" "}
                  <Badge className={STATUS_PILL[detail.status].cls}>
                    {STATUS_PILL[detail.status].label}
                  </Badge>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Entries */}
                <div className="rounded-lg border border-border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border bg-zinc-50/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground dark:bg-zinc-900/40">
                      <tr>
                        <th className="px-3 py-2">Dag</th>
                        <th className="px-3 py-2 text-right">Uren</th>
                        <th className="px-3 py-2 text-right">Overuren</th>
                        <th className="px-3 py-2 text-right">Pauze</th>
                        <th className="px-3 py-2">Omschrijving</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.entries ?? []).length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-3 py-6 text-center text-xs text-muted-foreground"
                          >
                            Geen uren ingevuld.
                          </td>
                        </tr>
                      ) : (
                        (detail.entries ?? []).map((e) => {
                          const wd = new Date(e.date).getDay();
                          const idx = wd === 0 ? 6 : wd - 1;
                          return (
                            <tr
                              key={e.id}
                              className="border-b border-border/40 last:border-0"
                            >
                              <td className="px-3 py-2 text-xs">
                                <span className="font-medium">
                                  {WEEKDAYS_NL[idx]}
                                </span>{" "}
                                <span className="text-muted-foreground">
                                  {formatDay(e.date)}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {e.hours.toFixed(1)}u
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-amber-600">
                                {e.overtime_hours > 0
                                  ? `+${e.overtime_hours.toFixed(1)}u`
                                  : "—"}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                {e.break_minutes}m
                              </td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">
                                {e.description ?? "—"}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                    <tfoot className="border-t border-border bg-zinc-50/40 dark:bg-zinc-900/40">
                      <tr>
                        <td className="px-3 py-2 text-xs font-semibold">
                          Totaal
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">
                          {detail.total_hours.toFixed(1)}u
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-600">
                          {detail.total_overtime_hours > 0
                            ? `+${detail.total_overtime_hours.toFixed(1)}u`
                            : "—"}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Audit trail */}
                <div className="rounded-lg border border-border bg-zinc-50/50 p-3 text-xs dark:bg-zinc-900/40">
                  <p className="mb-1.5 font-semibold text-zinc-700 dark:text-zinc-300">
                    Activiteit
                  </p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3" /> Aangemaakt op{" "}
                      {formatDate(detail.created_at)}
                    </li>
                    {detail.submitted_at && (
                      <li className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3" /> Ingediend op{" "}
                        {formatDate(detail.submitted_at)}
                      </li>
                    )}
                    {detail.approved_at && (
                      <li className="flex items-center gap-1.5 text-emerald-600">
                        <CheckCircle2 className="h-3 w-3" /> Goedgekeurd op{" "}
                        {formatDate(detail.approved_at)}
                      </li>
                    )}
                    {detail.rejected_at && (
                      <li className="flex items-start gap-1.5 text-red-600">
                        <XCircle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>
                          Afgekeurd op {formatDate(detail.rejected_at)} —{" "}
                          {detail.rejection_reason ?? "geen reden"}
                        </span>
                      </li>
                    )}
                  </ul>
                </div>
              </div>

              <DialogFooter>
                {detail.status === "submitted" && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setDetail(null);
                        openReject(detail);
                      }}
                      className="border-destructive/40 text-destructive hover:bg-destructive/10"
                    >
                      <XCircle className="mr-1.5 h-4 w-4" />
                      Afkeuren
                    </Button>
                    <Button
                      onClick={async () => {
                        await handleApprove(detail.id);
                        setDetail(null);
                      }}
                      className="border-0 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700"
                    >
                      <CheckCircle2 className="mr-1.5 h-4 w-4" />
                      Goedkeuren
                    </Button>
                  </>
                )}
                {detail.status !== "submitted" && (
                  <Button variant="outline" onClick={() => setDetail(null)}>
                    Sluiten
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* REJECT DIALOG */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Timesheet afkeuren</DialogTitle>
            <DialogDescription>
              De kandidaat ontvangt direct je opmerking en kan de uren
              corrigeren.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="reject-reason">Reden van afkeuring</Label>
            <Textarea
              id="reject-reason"
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Bv. Pauze van 30min ontbreekt op woensdag"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Annuleren
            </Button>
            <Button
              onClick={handleReject}
              disabled={!rejectReason.trim() || reject.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {reject.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              Afkeuren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "emerald" | "indigo" | "amber" | "red" | "zinc";
}) {
  const cls: Record<typeof accent, string> = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    indigo: "text-indigo-600 dark:text-indigo-400",
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-red-600 dark:text-red-400",
    zinc: "text-zinc-700 dark:text-zinc-300",
  };
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className={`mt-1 text-2xl font-bold ${cls[accent]}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
