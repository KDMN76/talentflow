"use client";

/**
 * Sprint Q4.4 — Contracten-overzicht (recruiter).
 *
 * - Lijst met filters: status, kandidaat, vacature.
 * - Status-pills, kolommen Kandidaat | Klant | Type | Status | Start | Eind |
 *   Uren/wk | Marge %.
 * - Click rij → detail-pagina.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  FileSignature,
  Filter,
  Plus,
  Search,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { useContracts } from "@/hooks/useBackOffice";
import type { ContractStatus, ContractType } from "@/lib/types/backOffice";

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

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function ContractsListPage() {
  const { t } = useTranslation("contracts");
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<ContractStatus | "all">(
    "all"
  );
  const [search, setSearch] = useState("");
  const { data: contracts, isLoading } = useContracts(
    statusFilter === "all" ? {} : { status: statusFilter }
  );

  const filtered = useMemo(() => {
    if (!contracts) return [];
    if (!search.trim()) return contracts;
    const q = search.toLowerCase();
    return contracts.filter(
      (c) =>
        c.candidate_name?.toLowerCase().includes(q) ||
        c.client_name?.toLowerCase().includes(q) ||
        c.job_title?.toLowerCase().includes(q)
    );
  }, [contracts, search]);

  const stats = useMemo(() => {
    if (!contracts) return { active: 0, total: 0, ending_soon: 0 };
    const today = new Date();
    const in30 = new Date();
    in30.setDate(in30.getDate() + 30);
    return {
      active: contracts.filter((c) => c.status === "active").length,
      total: contracts.length,
      ending_soon: contracts.filter(
        (c) =>
          c.status === "active" &&
          c.end_date &&
          new Date(c.end_date) <= in30 &&
          new Date(c.end_date) >= today
      ).length,
    };
  }, [contracts]);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("list.title")}
        description={t("list.description")}
        actions={
          <Link href="/contracts/new">
            <Button className="border-0 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700">
              <Plus className="mr-1.5 h-4 w-4" />
              {t("list.newContract")}
            </Button>
          </Link>
        }
      />

      {/* Stat cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t("list.stats.active")} value={stats.active} accent="emerald" />
        <StatCard label={t("list.stats.total")} value={stats.total} accent="indigo" />
        <StatCard
          label={t("list.stats.endingSoon")}
          value={stats.ending_soon}
          accent={stats.ending_soon > 0 ? "amber" : "zinc"}
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
              placeholder={t("list.searchPlaceholder")}
              className="pl-9"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-zinc-600"
                aria-label={t("list.clearSearchAria")}
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
                setStatusFilter(v as ContractStatus | "all")
              }
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("list.filterStatus.all")}</SelectItem>
                <SelectItem value="draft">{t("list.filterStatus.draft")}</SelectItem>
                <SelectItem value="active">{t("list.filterStatus.active")}</SelectItem>
                <SelectItem value="ended">{t("list.filterStatus.ended")}</SelectItem>
                <SelectItem value="terminated">{t("list.filterStatus.terminated")}</SelectItem>
                <SelectItem value="renewed">{t("list.filterStatus.renewed")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
            <EmptyState />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-zinc-50/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground dark:bg-zinc-900/40">
                  <tr>
                    <th className="px-4 py-3">{t("list.columns.candidate")}</th>
                    <th className="px-4 py-3">{t("list.columns.client")}</th>
                    <th className="px-4 py-3">{t("list.columns.type")}</th>
                    <th className="px-4 py-3">{t("list.columns.status")}</th>
                    <th className="px-4 py-3">{t("list.columns.start")}</th>
                    <th className="px-4 py-3">{t("list.columns.end")}</th>
                    <th className="px-4 py-3 text-right">{t("list.columns.weeklyHours")}</th>
                    <th className="px-4 py-3 text-right">{t("list.columns.margin")}</th>
                    <th className="w-10 px-2 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const status = STATUS_PILL[c.status];
                    return (
                      <tr
                        key={c.id}
                        onClick={() => router.push(`/contracts/${c.id}`)}
                        className="cursor-pointer border-b border-border/60 transition hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-zinc-900 dark:text-zinc-100">
                            {c.candidate_name ?? "—"}
                          </p>
                          {c.job_title && (
                            <p className="text-xs text-muted-foreground">
                              {c.job_title}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                          {c.client_name ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className="border-zinc-200 bg-white text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                          >
                            {t(`type.${c.contract_type}`)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={status.cls}>{t(`status.${c.status}`)}</Badge>
                        </td>
                        <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                          {formatDate(c.start_date)}
                        </td>
                        <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                          {formatDate(c.end_date)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-zinc-700 dark:text-zinc-300">
                          {c.weekly_hours ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {c.margin_percent != null ? (
                            <span
                              className={
                                c.margin_percent >= 30
                                  ? "font-semibold text-emerald-600"
                                  : c.margin_percent >= 20
                                  ? "font-semibold text-amber-600"
                                  : "font-semibold text-red-600"
                              }
                            >
                              {c.margin_percent.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
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

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "emerald" | "indigo" | "amber" | "zinc";
}) {
  const accentClass: Record<typeof accent, string> = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    indigo: "text-indigo-600 dark:text-indigo-400",
    amber: "text-amber-600 dark:text-amber-400",
    zinc: "text-zinc-700 dark:text-zinc-300",
  };
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className={`mt-1 text-2xl font-bold ${accentClass[accent]}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  const { t } = useTranslation("contracts");
  return (
    <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-950/30">
        <FileSignature className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
      </div>
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {t("list.empty.title")}
      </p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
        {t("list.empty.description")}
      </p>
      <Link href="/contracts/new" className="mt-4">
        <Button size="sm">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t("list.empty.newContract")}
        </Button>
      </Link>
    </div>
  );
}
