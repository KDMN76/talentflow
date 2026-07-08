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
import { useTranslation } from "react-i18next";
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

const STATUS_PILL: Record<TimesheetStatus, { labelKey: string; cls: string }> = {
  draft: {
    labelKey: "status.draft",
    cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-0",
  },
  submitted: {
    labelKey: "status.submitted",
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-0",
  },
  approved: {
    labelKey: "status.approved",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-0",
  },
  rejected: {
    labelKey: "status.rejected",
    cls: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-0",
  },
  disputed: {
    labelKey: "status.disputed",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-0",
  },
};

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
  const { t } = useTranslation("timesheets");

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
        title: t("toast.approvedTitle"),
        description: t("toast.approvedDescription"),
      });
    } catch {
      toast({ title: t("toast.approveFailed"), variant: "destructive" });
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
        title: t("toast.rejectedTitle"),
        description: t("toast.rejectedDescription"),
      });
      setRejectOpen(false);
      setRejectTarget(null);
      setRejectReason("");
    } catch {
      toast({ title: t("toast.rejectFailed"), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("header.title")}
        description={t("header.description")}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label={t("stats.total")} value={stats.total} accent="zinc" />
        <StatTile label={t("stats.pending")} value={stats.pending} accent="amber" />
        <StatTile label={t("stats.approved")} value={stats.approved} accent="emerald" />
        <StatTile label={t("stats.rejected")} value={stats.rejected} accent="red" />
      </div>

      {/* Filters */}
      <Card className="border-0 shadow-sm">
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("filters.searchPlaceholder")}
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
              <SelectItem value="all">{t("filters.allStatuses")}</SelectItem>
              <SelectItem value="submitted">{t("filters.statusSubmitted")}</SelectItem>
              <SelectItem value="approved">{t("filters.statusApproved")}</SelectItem>
              <SelectItem value="rejected">{t("filters.statusRejected")}</SelectItem>
              <SelectItem value="disputed">{t("filters.statusDisputed")}</SelectItem>
              <SelectItem value="draft">{t("filters.statusDraft")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={contractFilter} onValueChange={setContractFilter}>
            <SelectTrigger className="w-full lg:w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.allContracts")}</SelectItem>
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
              <p className="text-sm font-semibold">{t("empty.title")}</p>
              <p className="text-xs text-muted-foreground">
                {t("empty.description")}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-zinc-50/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground dark:bg-zinc-900/40">
                  <tr>
                    <th className="px-4 py-3">{t("table.candidateClient")}</th>
                    <th className="px-4 py-3">{t("table.week")}</th>
                    <th className="px-4 py-3">{t("table.status")}</th>
                    <th className="px-4 py-3 text-right">{t("table.hours")}</th>
                    <th className="px-4 py-3 text-right">{t("table.overtime")}</th>
                    <th className="px-4 py-3 text-right">{t("table.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((ts) => {
                    const c = findContract(ts.contract_id);
                    const pill = STATUS_PILL[ts.status];
                    return (
                      <tr
                        key={ts.id}
                        onClick={() => setDetail(ts)}
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
                          {formatDate(ts.week_start)} —{" "}
                          {formatDate(ts.week_end)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={pill.cls}>{t(pill.labelKey)}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold">
                          {t("units.hours", { value: ts.total_hours.toFixed(1) })}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-amber-600 dark:text-amber-400">
                          {ts.total_overtime_hours > 0
                            ? t("units.overtime", {
                                value: ts.total_overtime_hours.toFixed(1),
                              })
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {ts.status === "submitted" ? (
                            <div
                              className="flex justify-end gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openReject(ts)}
                                className="h-8 border-destructive/40 text-destructive hover:bg-destructive/10"
                              >
                                <XCircle className="mr-1 h-3.5 w-3.5" />
                                {t("actions.reject")}
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => handleApprove(ts.id)}
                                disabled={approve.isPending}
                                className="h-8 border-0 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700"
                              >
                                {approve.isPending ? (
                                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                )}
                                {t("actions.approve")}
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
                  {findContract(detail.contract_id)?.candidate_name ??
                    t("detail.titleFallback")}
                </DialogTitle>
                <DialogDescription>
                  {t("detail.week", {
                    start: formatDate(detail.week_start),
                    end: formatDate(detail.week_end),
                  })}{" "}
                  <Badge className={STATUS_PILL[detail.status].cls}>
                    {t(STATUS_PILL[detail.status].labelKey)}
                  </Badge>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Entries */}
                <div className="rounded-lg border border-border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border bg-zinc-50/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground dark:bg-zinc-900/40">
                      <tr>
                        <th className="px-3 py-2">{t("detail.entries.day")}</th>
                        <th className="px-3 py-2 text-right">{t("detail.entries.hours")}</th>
                        <th className="px-3 py-2 text-right">{t("detail.entries.overtime")}</th>
                        <th className="px-3 py-2 text-right">{t("detail.entries.break")}</th>
                        <th className="px-3 py-2">{t("detail.entries.description")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.entries ?? []).length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-3 py-6 text-center text-xs text-muted-foreground"
                          >
                            {t("detail.entries.empty")}
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
                                  {t(`weekdays.${idx}`)}
                                </span>{" "}
                                <span className="text-muted-foreground">
                                  {formatDay(e.date)}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {t("units.hours", { value: e.hours.toFixed(1) })}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-amber-600">
                                {e.overtime_hours > 0
                                  ? t("units.overtime", {
                                      value: e.overtime_hours.toFixed(1),
                                    })
                                  : "—"}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                {t("units.breakMinutes", { value: e.break_minutes })}
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
                          {t("detail.entries.total")}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">
                          {t("units.hours", {
                            value: detail.total_hours.toFixed(1),
                          })}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-600">
                          {detail.total_overtime_hours > 0
                            ? t("units.overtime", {
                                value: detail.total_overtime_hours.toFixed(1),
                              })
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
                    {t("detail.audit.title")}
                  </p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />{" "}
                      {t("detail.audit.created", {
                        date: formatDate(detail.created_at),
                      })}
                    </li>
                    {detail.submitted_at && (
                      <li className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3" />{" "}
                        {t("detail.audit.submitted", {
                          date: formatDate(detail.submitted_at),
                        })}
                      </li>
                    )}
                    {detail.approved_at && (
                      <li className="flex items-center gap-1.5 text-emerald-600">
                        <CheckCircle2 className="h-3 w-3" />{" "}
                        {t("detail.audit.approved", {
                          date: formatDate(detail.approved_at),
                        })}
                      </li>
                    )}
                    {detail.rejected_at && (
                      <li className="flex items-start gap-1.5 text-red-600">
                        <XCircle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>
                          {t("detail.audit.rejected", {
                            date: formatDate(detail.rejected_at),
                            reason:
                              detail.rejection_reason ??
                              t("detail.audit.noReason"),
                          })}
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
                      {t("actions.reject")}
                    </Button>
                    <Button
                      onClick={async () => {
                        await handleApprove(detail.id);
                        setDetail(null);
                      }}
                      className="border-0 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700"
                    >
                      <CheckCircle2 className="mr-1.5 h-4 w-4" />
                      {t("actions.approve")}
                    </Button>
                  </>
                )}
                {detail.status !== "submitted" && (
                  <Button variant="outline" onClick={() => setDetail(null)}>
                    {t("actions.close")}
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
            <DialogTitle>{t("reject.title")}</DialogTitle>
            <DialogDescription>
              {t("reject.description")}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="reject-reason">{t("reject.reasonLabel")}</Label>
            <Textarea
              id="reject-reason"
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t("reject.reasonPlaceholder")}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              {t("reject.cancel")}
            </Button>
            <Button
              onClick={handleReject}
              disabled={!rejectReason.trim() || reject.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {reject.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              {t("reject.submit")}
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
