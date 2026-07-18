"use client";

/**
 * Sprint Q4.4 — Contract detail (recruiter).
 *
 * - Header met kandidaat + klant + status pill.
 * - Tabs: Overzicht | Timesheets | Facturen | Commissie.
 * - Acties: Verlengen / Beëindigen / Genereer factuur.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Coins,
  Euro,
  FileText,
  Loader2,
  Receipt,
  ShieldCheck,
  StopCircle,
  TrendingUp,
  User,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
  useCommissionAssignments,
  useCommissionRecords,
  useContract,
  useContractExtensions,
  useCreateInvoice,
  useExtendContract,
  useInvoices,
  useTerminateContract,
  useTimesheets,
} from "@/hooks/useBackOffice";
import type {
  ContractStatus,
  TimesheetStatus,
  InvoiceStatus,
  CommissionRecordStatus,
} from "@/lib/types/backOffice";

const STATUS_PILL: Record<ContractStatus, { cls: string }> = {
  draft: {
    cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-0",
  },
  active: {
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-0",
  },
  ended: {
    cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 border-0",
  },
  terminated: {
    cls: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-0",
  },
  renewed: {
    cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border-0",
  },
};

const TS_STATUS_PILL: Record<TimesheetStatus, { cls: string }> = {
  draft: {
    cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-0",
  },
  submitted: {
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-0",
  },
  approved: {
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-0",
  },
  rejected: {
    cls: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-0",
  },
  disputed: {
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-0",
  },
};

const INV_STATUS_PILL: Record<InvoiceStatus, { cls: string }> = {
  draft: {
    cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-0",
  },
  sent: {
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-0",
  },
  paid: {
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-0",
  },
  overdue: {
    cls: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-0",
  },
  void: {
    cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 border-0",
  },
};

const COMM_STATUS_PILL: Record<CommissionRecordStatus, { cls: string }> = {
  pending: {
    cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-0",
  },
  approved: {
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-0",
  },
  paid: {
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-0",
  },
  disputed: {
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-0",
  },
  reversed: {
    cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 border-0",
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

function formatMoney(amount: number, currency = "EUR"): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency,
  }).format(amount);
}

export default function ContractDetailPage() {
  const { t } = useTranslation("contracts");
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const { toast } = useToast();

  const { data: contract, isLoading } = useContract(id);
  const { data: extensions } = useContractExtensions(id);
  const { data: timesheets } = useTimesheets({ contract_id: id });
  const { data: invoices } = useInvoices({ contract_id: id });
  const { data: assignments } = useCommissionAssignments({ contract_id: id });
  const { data: records } = useCommissionRecords({ contract_id: id });

  const [extendOpen, setExtendOpen] = useState(false);
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  const extendMut = useExtendContract();
  const terminateMut = useTerminateContract();
  const createInvoice = useCreateInvoice();

  const [newEndDate, setNewEndDate] = useState("");
  const [extendReason, setExtendReason] = useState("");
  const [terminateReason, setTerminateReason] = useState("");
  const [terminateDate, setTerminateDate] = useState("");
  const [invoicePeriodStart, setInvoicePeriodStart] = useState("");
  const [invoicePeriodEnd, setInvoicePeriodEnd] = useState("");

  const submittedTimesheets = useMemo(
    () => (timesheets ?? []).filter((t) => t.status === "submitted").length,
    [timesheets]
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="space-y-4">
        <Link href="/contracts">
          <Button variant="ghost" size="sm" className="-ml-2">
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t("detail.backShort")}
          </Button>
        </Link>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("detail.notFound")}
          </CardContent>
        </Card>
      </div>
    );
  }

  const status = STATUS_PILL[contract.status];
  const isClosed =
    contract.status === "terminated" || contract.status === "ended";

  const handleExtend = async () => {
    if (!newEndDate) return;
    try {
      await extendMut.mutateAsync({
        id: contract.id,
        new_end_date: newEndDate,
        reason: extendReason,
      });
      toast({
        title: t("detail.toasts.extended.title"),
        description: t("detail.toasts.extended.description", {
          date: formatDate(newEndDate),
        }),
      });
      setExtendOpen(false);
      setNewEndDate("");
      setExtendReason("");
    } catch {
      toast({
        title: t("detail.toasts.extendError.title"),
        variant: "destructive",
      });
    }
  };

  const handleTerminate = async () => {
    if (!terminateReason) return;
    try {
      await terminateMut.mutateAsync({
        id: contract.id,
        reason: terminateReason,
        effective_date: terminateDate || undefined,
      });
      toast({
        title: t("detail.toasts.terminated.title"),
        description: t("detail.toasts.terminated.description"),
      });
      setTerminateOpen(false);
      setTerminateReason("");
      setTerminateDate("");
    } catch {
      toast({
        title: t("detail.toasts.terminateError.title"),
        variant: "destructive",
      });
    }
  };

  const handleCreateInvoice = async () => {
    if (!invoicePeriodStart || !invoicePeriodEnd) return;
    try {
      const inv = await createInvoice.mutateAsync({
        contract_id: contract.id,
        period_start: invoicePeriodStart,
        period_end: invoicePeriodEnd,
      });
      toast({
        title: t("detail.toasts.invoiceCreated.title"),
        description: t("detail.toasts.invoiceCreated.description", {
          number: inv.invoice_number,
        }),
      });
      setInvoiceOpen(false);
      router.push(`/invoices/${inv.id}`);
    } catch {
      toast({
        title: t("detail.toasts.invoiceError.title"),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/contracts")}
        className="-ml-2"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        {t("detail.back")}
      </Button>

      <PageHeader
        title={contract.candidate_name ?? t("detail.fallbackTitle")}
        description={
          contract.job_title
            ? t("detail.descriptionAtJob", {
                type: t(`type.${contract.contract_type}`),
                client: contract.client_name ?? t("detail.noClient"),
                job: contract.job_title,
              })
            : t("detail.descriptionAt", {
                type: t(`type.${contract.contract_type}`),
                client: contract.client_name ?? t("detail.noClient"),
              })
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={status.cls}>{t(`status.${contract.status}`)}</Badge>
            {!isClosed && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setExtendOpen(true)}
                >
                  <Calendar className="mr-1.5 h-3.5 w-3.5" />
                  {t("detail.actions.extend")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTerminateOpen(true)}
                  className="border-destructive/40 text-destructive hover:bg-destructive/10"
                >
                  <StopCircle className="mr-1.5 h-3.5 w-3.5" />
                  {t("detail.actions.terminate")}
                </Button>
                <Button
                  size="sm"
                  onClick={() => setInvoiceOpen(true)}
                  className="border-0 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
                >
                  <Receipt className="mr-1.5 h-3.5 w-3.5" />
                  {t("detail.actions.generateInvoice")}
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* KPI cards */}
      <div className="grid gap-3 sm:grid-cols-4">
        <KpiCard
          icon={<Clock className="h-4 w-4" />}
          label={t("detail.kpi.weeklyHours")}
          value={contract.weekly_hours?.toString() ?? "—"}
        />
        <KpiCard
          icon={<Euro className="h-4 w-4" />}
          label={t("detail.kpi.rateClient")}
          value={
            contract.hourly_rate_client != null
              ? `${formatMoney(contract.hourly_rate_client, contract.currency)}/u`
              : "—"
          }
        />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          label={t("detail.kpi.margin")}
          value={
            contract.margin_percent != null
              ? `${contract.margin_percent.toFixed(1)}%`
              : "—"
          }
          accent={
            contract.margin_percent != null && contract.margin_percent >= 30
              ? "emerald"
              : "amber"
          }
        />
        <KpiCard
          icon={<FileText className="h-4 w-4" />}
          label={t("detail.kpi.toApprove")}
          value={submittedTimesheets.toString()}
          accent={submittedTimesheets > 0 ? "amber" : "zinc"}
        />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t("detail.tabs.overview")}</TabsTrigger>
          <TabsTrigger value="timesheets">
            {t("detail.tabs.timesheets", { count: timesheets?.length ?? 0 })}
          </TabsTrigger>
          <TabsTrigger value="invoices">
            {t("detail.tabs.invoices", { count: invoices?.length ?? 0 })}
          </TabsTrigger>
          <TabsTrigger value="commission">{t("detail.tabs.commission")}</TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="space-y-5 p-6">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t("detail.overview.title")}
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  icon={<User className="h-3.5 w-3.5" />}
                  label={t("detail.overview.candidate")}
                  value={contract.candidate_name ?? "—"}
                />
                <Field
                  icon={<Building2 className="h-3.5 w-3.5" />}
                  label={t("detail.overview.client")}
                  value={contract.client_name ?? "—"}
                />
                <Field
                  icon={<Briefcase className="h-3.5 w-3.5" />}
                  label={t("detail.overview.job")}
                  value={contract.job_title ?? "—"}
                />
                <Field
                  icon={<FileText className="h-3.5 w-3.5" />}
                  label={t("detail.overview.type")}
                  value={t(`type.${contract.contract_type}`)}
                />
                <Field
                  icon={<Calendar className="h-3.5 w-3.5" />}
                  label={t("detail.overview.startDate")}
                  value={formatDate(contract.start_date)}
                />
                <Field
                  icon={<Calendar className="h-3.5 w-3.5" />}
                  label={t("detail.overview.endDate")}
                  value={formatDate(contract.end_date)}
                />
                <Field
                  icon={<Clock className="h-3.5 w-3.5" />}
                  label={t("detail.overview.weeklyHours")}
                  value={contract.weekly_hours?.toString() ?? "—"}
                />
                <Field
                  icon={<Euro className="h-3.5 w-3.5" />}
                  label={t("detail.overview.rateCandidate")}
                  value={
                    contract.hourly_rate_candidate != null
                      ? `${formatMoney(contract.hourly_rate_candidate, contract.currency)}/u`
                      : "—"
                  }
                />
                <Field
                  icon={<Euro className="h-3.5 w-3.5" />}
                  label={t("detail.overview.rateClient")}
                  value={
                    contract.hourly_rate_client != null
                      ? `${formatMoney(contract.hourly_rate_client, contract.currency)}/u`
                      : "—"
                  }
                />
                <Field
                  icon={<TrendingUp className="h-3.5 w-3.5" />}
                  label={t("detail.overview.marginPercent")}
                  value={
                    contract.margin_percent != null
                      ? `${contract.margin_percent.toFixed(1)}%`
                      : "—"
                  }
                />
                <Field
                  icon={<ShieldCheck className="h-3.5 w-3.5" />}
                  label={t("detail.overview.cao")}
                  value={contract.cao ?? "—"}
                />
                <Field
                  icon={
                    contract.wtza_compliant === true ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    ) : contract.wtza_compliant === false ? (
                      <XCircle className="h-3.5 w-3.5 text-red-500" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )
                  }
                  label={t("detail.overview.wtzaCompliant")}
                  value={
                    contract.wtza_compliant === true
                      ? t("detail.overview.wtzaYes")
                      : contract.wtza_compliant === false
                      ? t("detail.overview.wtzaNo")
                      : t("detail.overview.wtzaNa")
                  }
                />
              </div>

              {contract.termination_reason && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
                  <p className="font-semibold">{t("detail.overview.terminationReason")}</p>
                  <p className="mt-0.5">{contract.termination_reason}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Extension history */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-6">
              <h3 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t("detail.extensions.title")}
              </h3>
              {!extensions || extensions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("detail.extensions.empty")}
                </p>
              ) : (
                <ol className="space-y-3 border-l border-border pl-5">
                  {extensions.map((e) => (
                    <li key={e.id} className="relative">
                      <span className="absolute -left-[26px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-950/40">
                        <Calendar className="h-2.5 w-2.5 text-indigo-600 dark:text-indigo-400" />
                      </span>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {t("detail.extensions.until", {
                          date: formatDate(e.new_end_date),
                        })}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {t("detail.extensions.was", {
                            date: formatDate(e.previous_end_date),
                          })}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {e.reason ?? t("detail.extensions.noReason")} ·{" "}
                        {formatDate(e.signed_at)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TIMESHEETS */}
        <TabsContent value="timesheets" className="space-y-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              {!timesheets || timesheets.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                  {t("detail.timesheets.empty")}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border bg-zinc-50/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground dark:bg-zinc-900/40">
                      <tr>
                        <th className="px-4 py-3">{t("detail.timesheets.columns.week")}</th>
                        <th className="px-4 py-3">{t("detail.timesheets.columns.status")}</th>
                        <th className="px-4 py-3 text-right">{t("detail.timesheets.columns.hours")}</th>
                        <th className="px-4 py-3 text-right">{t("detail.timesheets.columns.overtime")}</th>
                        <th className="w-10 px-2 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...timesheets]
                        .sort((a, b) =>
                          a.week_start < b.week_start ? 1 : -1
                        )
                        .map((ts) => {
                          const pill = TS_STATUS_PILL[ts.status];
                          return (
                            <tr
                              key={ts.id}
                              onClick={() =>
                                router.push(`/timesheets?focus=${ts.id}`)
                              }
                              className="cursor-pointer border-b border-border/60 transition hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
                            >
                              <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                                {formatDate(ts.week_start)} — {formatDate(ts.week_end)}
                              </td>
                              <td className="px-4 py-3">
                                <Badge className={pill.cls}>{t(`timesheetStatus.${ts.status}`)}</Badge>
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums">
                                {ts.total_hours.toFixed(1)}u
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums text-amber-600 dark:text-amber-400">
                                {ts.total_overtime_hours > 0
                                  ? `+${ts.total_overtime_hours.toFixed(1)}u`
                                  : "—"}
                              </td>
                              <td className="px-2 py-3">
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
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
        </TabsContent>

        {/* INVOICES */}
        <TabsContent value="invoices" className="space-y-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              {!invoices || invoices.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                  {t("detail.invoices.empty")}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border bg-zinc-50/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground dark:bg-zinc-900/40">
                      <tr>
                        <th className="px-4 py-3">{t("detail.invoices.columns.number")}</th>
                        <th className="px-4 py-3">{t("detail.invoices.columns.status")}</th>
                        <th className="px-4 py-3">{t("detail.invoices.columns.period")}</th>
                        <th className="px-4 py-3 text-right">{t("detail.invoices.columns.amount")}</th>
                        <th className="w-10 px-2 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((i) => {
                        const pill = INV_STATUS_PILL[i.status];
                        return (
                          <tr
                            key={i.id}
                            onClick={() => router.push(`/invoices/${i.id}`)}
                            className="cursor-pointer border-b border-border/60 transition hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
                          >
                            <td className="px-4 py-3 font-mono text-xs font-medium text-zinc-900 dark:text-zinc-100">
                              {i.invoice_number}
                            </td>
                            <td className="px-4 py-3">
                              <Badge className={pill.cls}>{t(`invoiceStatus.${i.status}`)}</Badge>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {formatDate(i.period_start)} —{" "}
                              {formatDate(i.period_end)}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold tabular-nums">
                              {formatMoney(i.total_amount, i.currency)}
                            </td>
                            <td className="px-2 py-3">
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
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
        </TabsContent>

        {/* COMMISSION */}
        <TabsContent value="commission" className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="space-y-3 p-6">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t("detail.commission.assignedTitle")}
              </h3>
              {!assignments || assignments.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("detail.commission.assignedEmpty")}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {assignments.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between py-2.5"
                    >
                      <div>
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {a.recruiter_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {a.scheme_name}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {t("detail.commission.share", { percent: a.share_percent })}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="space-y-3 p-6">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t("detail.commission.recordsTitle")}
              </h3>
              {!records || records.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("detail.commission.recordsEmpty")}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {records.map((r) => {
                    const pill = COMM_STATUS_PILL[r.status];
                    return (
                      <li
                        key={r.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                              {r.recruiter_name}
                            </p>
                            <Badge className={pill.cls}>{t(`commissionStatus.${r.status}`)}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t("detail.commission.period", {
                              start: formatDate(r.period_start),
                              end: formatDate(r.period_end),
                            })}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {formatMoney(r.commission_amount)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {t("detail.commission.of", {
                              amount: formatMoney(r.base_amount),
                            })}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* EXTEND DIALOG */}
      <Dialog open={extendOpen} onOpenChange={setExtendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("detail.extendDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("detail.extendDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="ext-date">{t("detail.extendDialog.newEndDate")}</Label>
              <Input
                id="ext-date"
                type="date"
                value={newEndDate}
                onChange={(e) => setNewEndDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ext-reason">{t("detail.extendDialog.reason")}</Label>
              <Textarea
                id="ext-reason"
                rows={3}
                value={extendReason}
                onChange={(e) => setExtendReason(e.target.value)}
                placeholder={t("detail.extendDialog.reasonPlaceholder")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendOpen(false)}>
              {t("detail.extendDialog.cancel")}
            </Button>
            <Button
              onClick={handleExtend}
              disabled={!newEndDate || extendMut.isPending}
            >
              {extendMut.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              {t("detail.extendDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* TERMINATE DIALOG */}
      <Dialog open={terminateOpen} onOpenChange={setTerminateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t("detail.terminateDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("detail.terminateDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="term-date">{t("detail.terminateDialog.effectiveDate")}</Label>
              <Input
                id="term-date"
                type="date"
                value={terminateDate}
                onChange={(e) => setTerminateDate(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("detail.terminateDialog.effectiveDateHint")}
              </p>
            </div>
            <div>
              <Label htmlFor="term-reason">{t("detail.terminateDialog.reason")}</Label>
              <Textarea
                id="term-reason"
                rows={3}
                value={terminateReason}
                onChange={(e) => setTerminateReason(e.target.value)}
                placeholder={t("detail.terminateDialog.reasonPlaceholder")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTerminateOpen(false)}>
              {t("detail.terminateDialog.cancel")}
            </Button>
            <Button
              onClick={handleTerminate}
              disabled={!terminateReason || terminateMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {terminateMut.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              {t("detail.terminateDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* INVOICE DIALOG */}
      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-indigo-500" />
              {t("detail.invoiceDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("detail.invoiceDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="inv-start">{t("detail.invoiceDialog.periodStart")}</Label>
              <Input
                id="inv-start"
                type="date"
                value={invoicePeriodStart}
                onChange={(e) => setInvoicePeriodStart(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="inv-end">{t("detail.invoiceDialog.periodEnd")}</Label>
              <Input
                id="inv-end"
                type="date"
                value={invoicePeriodEnd}
                onChange={(e) => setInvoicePeriodEnd(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoiceOpen(false)}>
              {t("detail.invoiceDialog.cancel")}
            </Button>
            <Button
              onClick={handleCreateInvoice}
              disabled={
                !invoicePeriodStart ||
                !invoicePeriodEnd ||
                createInvoice.isPending
              }
              className="border-0 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
            >
              {createInvoice.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              {t("detail.invoiceDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  accent = "indigo",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: "indigo" | "emerald" | "amber" | "zinc";
}) {
  const accentClass: Record<typeof accent, string> = {
    indigo: "text-indigo-600 dark:text-indigo-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    zinc: "text-zinc-700 dark:text-zinc-300",
  };
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4">
        <div className={`flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider ${accentClass[accent]}`}>
          {icon}
          {label}
        </div>
        <p className="mt-1.5 text-xl font-bold text-zinc-900 dark:text-zinc-100">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function Field({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-0.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {value}
      </p>
    </div>
  );
}
