"use client";

/**
 * Sprint Q4.4 — Facturen-overzicht.
 *
 * Lijst met filters (status, klant, contract). Kolommen:
 * Nummer | Klant | Periode | Bedrag | Status | Vervaldatum.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Filter,
  Receipt,
  Search,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useInvoices } from "@/hooks/useBackOffice";
import type { InvoiceStatus } from "@/lib/types/backOffice";

const STATUS_PILL: Record<InvoiceStatus, { cls: string }> = {
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

export default function InvoicesListPage() {
  const { t } = useTranslation("invoices");
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "all">(
    "all"
  );
  const [search, setSearch] = useState("");
  const { data: invoices, isLoading } = useInvoices(
    statusFilter === "all" ? {} : { status: statusFilter }
  );

  const filtered = useMemo(() => {
    if (!invoices) return [];
    if (!search.trim()) return invoices;
    const q = search.toLowerCase();
    return invoices.filter(
      (i) =>
        i.invoice_number.toLowerCase().includes(q) ||
        i.client_name?.toLowerCase().includes(q)
    );
  }, [invoices, search]);

  const stats = useMemo(() => {
    if (!invoices)
      return { outstanding: 0, paid_mtd: 0, overdue: 0, count: 0 };
    const outstanding = invoices
      .filter((i) => i.status === "sent" || i.status === "overdue")
      .reduce((s, i) => s + i.total_amount, 0);
    const paid_mtd = invoices
      .filter(
        (i) =>
          i.status === "paid" &&
          i.paid_date &&
          new Date(i.paid_date).getMonth() === new Date().getMonth() &&
          new Date(i.paid_date).getFullYear() === new Date().getFullYear()
      )
      .reduce((s, i) => s + i.total_amount, 0);
    const overdue = invoices.filter((i) => i.status === "overdue").length;
    return { outstanding, paid_mtd, overdue, count: invoices.length };
  }, [invoices]);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("list.header.title")}
        description={t("list.header.description")}
      />

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile
          icon={<Clock className="h-4 w-4" />}
          label={t("list.stats.outstanding")}
          value={formatMoney(stats.outstanding)}
          accent="indigo"
        />
        <StatTile
          icon={<CheckCircle2 className="h-4 w-4" />}
          label={t("list.stats.paidMtd")}
          value={formatMoney(stats.paid_mtd)}
          accent="emerald"
        />
        <StatTile
          icon={<Receipt className="h-4 w-4" />}
          label={t("list.stats.overdue")}
          value={t("list.stats.overdueValue", { count: stats.overdue })}
          accent={stats.overdue > 0 ? "red" : "zinc"}
        />
        <StatTile
          icon={<Receipt className="h-4 w-4" />}
          label={t("list.stats.total")}
          value={`${stats.count}`}
          accent="zinc"
        />
      </div>

      {/* Filters */}
      <Card className="border-0 shadow-sm">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("list.filters.searchPlaceholder")}
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
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select
              value={statusFilter}
              onValueChange={(v) =>
                setStatusFilter(v as InvoiceStatus | "all")
              }
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("list.filters.allStatuses")}
                </SelectItem>
                <SelectItem value="draft">{t("list.status.draft")}</SelectItem>
                <SelectItem value="sent">{t("list.status.sent")}</SelectItem>
                <SelectItem value="paid">{t("list.status.paid")}</SelectItem>
                <SelectItem value="overdue">
                  {t("list.status.overdue")}
                </SelectItem>
                <SelectItem value="void">{t("list.status.void")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

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
              <Receipt className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm font-semibold">{t("list.empty.title")}</p>
              <p className="text-xs text-muted-foreground">
                {t("list.empty.description")}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-zinc-50/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground dark:bg-zinc-900/40">
                  <tr>
                    <th className="px-4 py-3">{t("list.columns.number")}</th>
                    <th className="px-4 py-3">{t("list.columns.client")}</th>
                    <th className="px-4 py-3">{t("list.columns.period")}</th>
                    <th className="px-4 py-3 text-right">
                      {t("list.columns.amount")}
                    </th>
                    <th className="px-4 py-3">{t("list.columns.status")}</th>
                    <th className="px-4 py-3">{t("list.columns.dueDate")}</th>
                    <th className="w-10 px-2 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i) => {
                    const pill = STATUS_PILL[i.status];
                    const overdue =
                      i.due_date &&
                      new Date(i.due_date) < new Date() &&
                      (i.status === "sent" || i.status === "overdue");
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
                          {i.client_name ?? "—"}
                          {i.external_accounting_provider && (
                            <span className="ml-1.5 inline-flex items-center rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300">
                              {t("list.syncedBadge")}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatDate(i.period_start)} —{" "}
                          {formatDate(i.period_end)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">
                          {formatMoney(i.total_amount, i.currency)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={pill.cls}>
                            {t(`list.status.${i.status}`)}
                          </Badge>
                        </td>
                        <td
                          className={
                            overdue
                              ? "px-4 py-3 text-xs font-semibold text-red-600 dark:text-red-400"
                              : "px-4 py-3 text-xs text-muted-foreground"
                          }
                        >
                          {formatDate(i.due_date)}
                        </td>
                        <td className="px-2 py-3">
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
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
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: "emerald" | "indigo" | "red" | "zinc";
}) {
  const cls: Record<typeof accent, string> = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    indigo: "text-indigo-600 dark:text-indigo-400",
    red: "text-red-600 dark:text-red-400",
    zinc: "text-zinc-700 dark:text-zinc-300",
  };
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5">
        <div className={`flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider ${cls[accent]}`}>
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
