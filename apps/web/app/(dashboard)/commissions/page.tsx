"use client";

/**
 * Sprint Q4.4 — Commissie management.
 *
 * Tabs: Records | Schemes | Assignments.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle2,
  Coins,
  Edit2,
  Layers,
  Loader2,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
  useApproveCommission,
  useCommissionAssignments,
  useCommissionRecords,
  useCommissionSchemes,
  useContracts,
  useCreateCommissionAssignment,
  useCreateCommissionScheme,
  useDisputeCommission,
  usePayCommission,
  useUpdateCommissionScheme,
} from "@/hooks/useBackOffice";
import type {
  CommissionRecordStatus,
  CommissionScheme,
  CommissionSchemeType,
} from "@/lib/types/backOffice";

// TODO: replace with a real `useTenantUsers()` hook once a backend
// `/users` endpoint exists. Until then we derive the recruiter dropdown
// from the actual data we receive (commission records / assignments /
// contracts) so we never invent users.
interface TenantRecruiter {
  id: string;
  name: string;
}

const RECORD_STATUS_PILL: Record<CommissionRecordStatus, string> = {
  pending:
    "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-0",
  approved:
    "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-0",
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-0",
  disputed:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-0",
};

// Maps the API enum value to the i18n key under commissions.records.status.
const RECORD_STATUS_KEY: Record<CommissionRecordStatus, string> = {
  pending: "pending",
  approved: "approved",
  paid: "paid",
  disputed: "disputed",
};

// Maps the API enum value to the i18n key under commissions.schemeType.
const SCHEME_TYPE_KEY: Record<CommissionSchemeType, string> = {
  flat: "flat",
  percent_of_fee: "percentOfFee",
  percent_of_margin: "percentOfMargin",
  tiered: "tiered",
  recurring_monthly: "recurringMonthly",
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

export default function CommissionsPage() {
  const { toast } = useToast();
  const { t } = useTranslation("invoices");

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("commissions.header.title")}
        description={t("commissions.header.description")}
      />

      <Tabs defaultValue="records">
        <TabsList>
          <TabsTrigger value="records">{t("commissions.tabs.records")}</TabsTrigger>
          <TabsTrigger value="schemes">{t("commissions.tabs.schemes")}</TabsTrigger>
          <TabsTrigger value="assignments">{t("commissions.tabs.assignments")}</TabsTrigger>
        </TabsList>

        <TabsContent value="records" className="space-y-3">
          <RecordsTab toast={toast} />
        </TabsContent>
        <TabsContent value="schemes" className="space-y-3">
          <SchemesTab toast={toast} />
        </TabsContent>
        <TabsContent value="assignments" className="space-y-3">
          <AssignmentsTab toast={toast} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── RECORDS ─────────────────────────────────────────────────────────────────

type Toast = ReturnType<typeof import("@/components/ui/use-toast").useToast>["toast"];

function RecordsTab({ toast }: { toast: Toast }) {
  const { t } = useTranslation("invoices");
  const [statusFilter, setStatusFilter] = useState<
    CommissionRecordStatus | "all"
  >("all");
  const [recruiterFilter, setRecruiterFilter] = useState<string>("all");
  const { data: records, isLoading } = useCommissionRecords(
    statusFilter === "all" ? {} : { status: statusFilter }
  );
  const approve = useApproveCommission();
  const pay = usePayCommission();
  const dispute = useDisputeCommission();

  // Build recruiter options from the actual commission records so we
  // never offer fake/test users in the filter.
  const recruiterOptions = useMemo<TenantRecruiter[]>(() => {
    const seen = new Map<string, string>();
    for (const r of records ?? []) {
      if (!seen.has(r.recruiter_id)) {
        seen.set(r.recruiter_id, r.recruiter_name ?? r.recruiter_id);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [records]);

  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeTarget, setDisputeTarget] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");

  const filtered = useMemo(() => {
    if (!records) return [];
    if (recruiterFilter === "all") return records;
    return records.filter((r) => r.recruiter_id === recruiterFilter);
  }, [records, recruiterFilter]);

  const totals = useMemo(() => {
    if (!records) return { pending: 0, approved: 0, paid: 0 };
    return {
      pending: records
        .filter((r) => r.status === "pending")
        .reduce((s, r) => s + r.commission_amount, 0),
      approved: records
        .filter((r) => r.status === "approved")
        .reduce((s, r) => s + r.commission_amount, 0),
      paid: records
        .filter((r) => r.status === "paid")
        .reduce((s, r) => s + r.commission_amount, 0),
    };
  }, [records]);

  const handleApprove = async (id: string) => {
    try {
      await approve.mutateAsync(id);
      toast({ title: t("commissions.records.toasts.approved") });
    } catch {
      toast({
        title: t("commissions.records.toasts.approveError"),
        variant: "destructive",
      });
    }
  };
  const handlePay = async (id: string) => {
    try {
      await pay.mutateAsync(id);
      toast({ title: t("commissions.records.toasts.paid") });
    } catch {
      toast({
        title: t("commissions.records.toasts.payError"),
        variant: "destructive",
      });
    }
  };
  const handleDispute = async () => {
    if (!disputeTarget || !disputeReason.trim()) return;
    try {
      await dispute.mutateAsync({
        id: disputeTarget,
        reason: disputeReason,
      });
      toast({ title: t("commissions.records.toasts.disputed") });
      setDisputeOpen(false);
      setDisputeTarget(null);
      setDisputeReason("");
    } catch {
      toast({
        title: t("commissions.records.toasts.disputeError"),
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiTile
          label={t("commissions.records.kpi.pending")}
          value={formatMoney(totals.pending)}
          accent="amber"
        />
        <KpiTile
          label={t("commissions.records.kpi.approved")}
          value={formatMoney(totals.approved)}
          accent="indigo"
        />
        <KpiTile
          label={t("commissions.records.kpi.paidYtd")}
          value={formatMoney(totals.paid)}
          accent="emerald"
        />
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
          <Select
            value={statusFilter}
            onValueChange={(v) =>
              setStatusFilter(v as CommissionRecordStatus | "all")
            }
          >
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("commissions.records.filters.allStatuses")}
              </SelectItem>
              <SelectItem value="pending">
                {t("commissions.records.status.pending")}
              </SelectItem>
              <SelectItem value="approved">
                {t("commissions.records.status.approved")}
              </SelectItem>
              <SelectItem value="paid">
                {t("commissions.records.status.paid")}
              </SelectItem>
              <SelectItem value="disputed">
                {t("commissions.records.status.disputed")}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select value={recruiterFilter} onValueChange={setRecruiterFilter}>
            <SelectTrigger className="w-full sm:w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("commissions.records.filters.allRecruiters")}
              </SelectItem>
              {recruiterOptions.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              {t("commissions.records.empty")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-zinc-50/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground dark:bg-zinc-900/40">
                  <tr>
                    <th className="px-4 py-3">
                      {t("commissions.records.columns.recruiter")}
                    </th>
                    <th className="px-4 py-3">
                      {t("commissions.records.columns.period")}
                    </th>
                    <th className="px-4 py-3 text-right">
                      {t("commissions.records.columns.base")}
                    </th>
                    <th className="px-4 py-3 text-right">
                      {t("commissions.records.columns.commission")}
                    </th>
                    <th className="px-4 py-3">
                      {t("commissions.records.columns.status")}
                    </th>
                    <th className="px-4 py-3 text-right">
                      {t("commissions.records.columns.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const pillCls = RECORD_STATUS_PILL[r.status];
                    return (
                      <tr
                        key={r.id}
                        className="border-b border-border/60 hover:bg-zinc-50/40 dark:hover:bg-zinc-900/40"
                      >
                        <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                          {r.recruiter_name ?? r.recruiter_id}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatDate(r.period_start)} —{" "}
                          {formatDate(r.period_end)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                          {formatMoney(r.base_amount)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold">
                          {formatMoney(r.commission_amount)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={pillCls}>
                            {t(
                              `commissions.records.status.${RECORD_STATUS_KEY[r.status]}`
                            )}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1.5">
                            {r.status === "pending" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleApprove(r.id)}
                                className="h-8"
                              >
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                {t("commissions.records.actions.approve")}
                              </Button>
                            )}
                            {r.status === "approved" && (
                              <Button
                                size="sm"
                                onClick={() => handlePay(r.id)}
                                className="h-8 border-0 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700"
                              >
                                <Coins className="mr-1 h-3.5 w-3.5" />
                                {t("commissions.records.actions.pay")}
                              </Button>
                            )}
                            {(r.status === "pending" ||
                              r.status === "approved") && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setDisputeTarget(r.id);
                                  setDisputeOpen(true);
                                }}
                                className="h-8 text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                              >
                                <AlertCircle className="mr-1 h-3.5 w-3.5" />
                                {t("commissions.records.actions.dispute")}
                              </Button>
                            )}
                          </div>
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

      <Dialog open={disputeOpen} onOpenChange={setDisputeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("commissions.records.disputeDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("commissions.records.disputeDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            placeholder={t("commissions.records.disputeDialog.placeholder")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputeOpen(false)}>
              {t("commissions.records.disputeDialog.cancel")}
            </Button>
            <Button
              onClick={handleDispute}
              disabled={!disputeReason.trim()}
              className="bg-amber-500 text-white hover:bg-amber-600"
            >
              {t("commissions.records.disputeDialog.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── SCHEMES ─────────────────────────────────────────────────────────────────

interface TierRow {
  up_to: string;
  percent: string;
}

function SchemesTab({ toast }: { toast: Toast }) {
  const { t } = useTranslation("invoices");
  const { data: schemes, isLoading } = useCommissionSchemes();
  const create = useCreateCommissionScheme();
  const update = useUpdateCommissionScheme();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CommissionScheme | null>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState<CommissionSchemeType>("percent_of_fee");
  const [active, setActive] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  // Type-specific config:
  const [flatAmount, setFlatAmount] = useState("");
  const [percent, setPercent] = useState("");
  const [monthlyAmount, setMonthlyAmount] = useState("");
  const [tiers, setTiers] = useState<TierRow[]>([
    { up_to: "5000", percent: "10" },
    { up_to: "", percent: "12.5" },
  ]);

  const reset = () => {
    setEditing(null);
    setName("");
    setType("percent_of_fee");
    setActive(true);
    setIsDefault(false);
    setFlatAmount("");
    setPercent("");
    setMonthlyAmount("");
    setTiers([
      { up_to: "5000", percent: "10" },
      { up_to: "", percent: "12.5" },
    ]);
  };

  const openEdit = (s: CommissionScheme) => {
    setEditing(s);
    setName(s.name);
    setType(s.type);
    setActive(s.active);
    setIsDefault(s.is_default);
    if (s.type === "flat")
      setFlatAmount(String((s.config as { amount?: number }).amount ?? ""));
    if (s.type === "percent_of_fee" || s.type === "percent_of_margin")
      setPercent(String((s.config as { percent?: number }).percent ?? ""));
    if (s.type === "recurring_monthly")
      setMonthlyAmount(
        String((s.config as { monthly_amount?: number }).monthly_amount ?? "")
      );
    if (s.type === "tiered") {
      const t = (s.config as { tiers?: { up_to: number | null; percent: number }[] })
        .tiers ?? [];
      setTiers(
        t.map((row) => ({
          up_to: row.up_to == null ? "" : String(row.up_to),
          percent: String(row.percent),
        }))
      );
    }
    setOpen(true);
  };

  const buildConfig = (): Record<string, unknown> => {
    switch (type) {
      case "flat":
        return { amount: parseFloat(flatAmount) || 0 };
      case "percent_of_fee":
      case "percent_of_margin":
        return { percent: parseFloat(percent) || 0 };
      case "recurring_monthly":
        return { monthly_amount: parseFloat(monthlyAmount) || 0 };
      case "tiered":
        return {
          tiers: tiers.map((t) => ({
            up_to: t.up_to ? parseFloat(t.up_to) : null,
            percent: parseFloat(t.percent) || 0,
          })),
        };
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          patch: {
            name,
            type,
            config: buildConfig(),
            active,
            is_default: isDefault,
          },
        });
        toast({ title: t("commissions.schemes.toasts.updated") });
      } else {
        await create.mutateAsync({
          name,
          type,
          config: buildConfig(),
          active,
          is_default: isDefault,
        });
        toast({ title: t("commissions.schemes.toasts.created") });
      }
      setOpen(false);
      reset();
    } catch {
      toast({
        title: t("commissions.schemes.toasts.saveError"),
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <div className="flex justify-end">
        <Button
          onClick={() => {
            reset();
            setOpen(true);
          }}
          className="border-0 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          {t("commissions.schemes.newScheme")}
        </Button>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !schemes || schemes.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              <Layers className="mx-auto mb-2 h-10 w-10 text-muted-foreground/40" />
              {t("commissions.schemes.empty")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {schemes.map((s) => (
                <li key={s.id} className="flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/40">
                    <Layers className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {s.name}
                      </p>
                      {s.is_default && (
                        <Badge className="border-0 bg-emerald-100 px-1.5 py-0 text-[10px] uppercase text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          {t("commissions.schemes.defaultBadge")}
                        </Badge>
                      )}
                      {!s.active && (
                        <Badge className="border-0 bg-zinc-100 px-1.5 py-0 text-[10px] uppercase text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                          {t("commissions.schemes.inactiveBadge")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t(`commissions.schemeType.${SCHEME_TYPE_KEY[s.type]}`)} ·{" "}
                      {describeConfig(s, t)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(s)}
                  >
                    <Edit2 className="mr-1 h-3.5 w-3.5" />
                    {t("commissions.schemes.edit")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t("commissions.schemes.dialog.editTitle")
                : t("commissions.schemes.dialog.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("commissions.schemes.dialog.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label htmlFor="scheme-name">
                {t("commissions.schemes.dialog.nameLabel")}
              </Label>
              <Input
                id="scheme-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("commissions.schemes.dialog.namePlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="scheme-type">
                {t("commissions.schemes.dialog.typeLabel")}
              </Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as CommissionSchemeType)}
              >
                <SelectTrigger id="scheme-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="flat">
                    {t("commissions.schemeType.flat")}
                  </SelectItem>
                  <SelectItem value="percent_of_fee">
                    {t("commissions.schemeType.percentOfFee")}
                  </SelectItem>
                  <SelectItem value="percent_of_margin">
                    {t("commissions.schemeType.percentOfMargin")}
                  </SelectItem>
                  <SelectItem value="tiered">
                    {t("commissions.schemeType.tiered")}
                  </SelectItem>
                  <SelectItem value="recurring_monthly">
                    {t("commissions.schemeType.recurringMonthly")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {type === "flat" && (
              <div>
                <Label>{t("commissions.schemes.dialog.flatLabel")}</Label>
                <Input
                  type="number"
                  value={flatAmount}
                  onChange={(e) => setFlatAmount(e.target.value)}
                  placeholder={t("commissions.schemes.dialog.flatPlaceholder")}
                />
              </div>
            )}

            {(type === "percent_of_fee" || type === "percent_of_margin") && (
              <div>
                <Label>{t("commissions.schemes.dialog.percentLabel")}</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  placeholder={t(
                    "commissions.schemes.dialog.percentPlaceholder"
                  )}
                />
              </div>
            )}

            {type === "recurring_monthly" && (
              <div>
                <Label>{t("commissions.schemes.dialog.monthlyLabel")}</Label>
                <Input
                  type="number"
                  value={monthlyAmount}
                  onChange={(e) => setMonthlyAmount(e.target.value)}
                  placeholder={t(
                    "commissions.schemes.dialog.monthlyPlaceholder"
                  )}
                />
              </div>
            )}

            {type === "tiered" && (
              <div className="space-y-2">
                <Label>{t("commissions.schemes.dialog.tiersLabel")}</Label>
                {tiers.map((tier, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-[1fr_1fr_auto] items-center gap-2"
                  >
                    <Input
                      placeholder={t(
                        "commissions.schemes.dialog.tierUpToPlaceholder"
                      )}
                      value={tier.up_to}
                      onChange={(e) =>
                        setTiers((cur) =>
                          cur.map((r, i) =>
                            i === idx ? { ...r, up_to: e.target.value } : r
                          )
                        )
                      }
                    />
                    <Input
                      type="number"
                      step="0.5"
                      placeholder={t(
                        "commissions.schemes.dialog.tierPercentPlaceholder"
                      )}
                      value={tier.percent}
                      onChange={(e) =>
                        setTiers((cur) =>
                          cur.map((r, i) =>
                            i === idx ? { ...r, percent: e.target.value } : r
                          )
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setTiers((cur) => cur.filter((_, i) => i !== idx))
                      }
                      className="text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setTiers((cur) => [...cur, { up_to: "", percent: "" }])
                  }
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {t("commissions.schemes.dialog.addTier")}
                </Button>
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium">
                  {t("commissions.schemes.dialog.activeTitle")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("commissions.schemes.dialog.activeDescription")}
                </p>
              </div>
              <Switch checked={active} onCheckedChange={setActive} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium">
                  {t("commissions.schemes.dialog.defaultTitle")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("commissions.schemes.dialog.defaultDescription")}
                </p>
              </div>
              <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("commissions.schemes.dialog.cancel")}
            </Button>
            <Button
              onClick={handleSave}
              disabled={!name.trim() || create.isPending || update.isPending}
              className="border-0 bg-gradient-to-r from-indigo-500 to-purple-600"
            >
              {(create.isPending || update.isPending) && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              {editing
                ? t("commissions.schemes.dialog.save")
                : t("commissions.schemes.dialog.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function describeConfig(
  s: CommissionScheme,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  const cfg = s.config as Record<string, unknown>;
  switch (s.type) {
    case "flat":
      return t("commissions.schemes.describe.flat", {
        amount: formatMoney((cfg.amount as number) ?? 0),
      });
    case "percent_of_fee":
      return t("commissions.schemes.describe.percentOfFee", {
        percent: cfg.percent ?? 0,
      });
    case "percent_of_margin":
      return t("commissions.schemes.describe.percentOfMargin", {
        percent: cfg.percent ?? 0,
      });
    case "tiered": {
      const tiers = (cfg.tiers as { up_to: number | null; percent: number }[] | undefined) ?? [];
      return t("commissions.schemes.describe.tiered", {
        count: tiers.length,
        max: tiers[tiers.length - 1]?.percent ?? 0,
      });
    }
    case "recurring_monthly":
      return t("commissions.schemes.describe.recurringMonthly", {
        amount: formatMoney((cfg.monthly_amount as number) ?? 0),
      });
  }
}

// ─── ASSIGNMENTS ─────────────────────────────────────────────────────────────

function AssignmentsTab({ toast }: { toast: Toast }) {
  const { t } = useTranslation("invoices");
  const { data: assignments, isLoading } = useCommissionAssignments();
  const { data: schemes } = useCommissionSchemes();
  const { data: contracts } = useContracts();
  const { data: records } = useCommissionRecords({});
  const create = useCreateCommissionAssignment();

  const [open, setOpen] = useState(false);
  const [recruiter, setRecruiter] = useState<string>("");
  const [contractId, setContractId] = useState<string>("");
  const [schemeId, setSchemeId] = useState<string>("");
  const [share, setShare] = useState("100");

  // Derive recruiter options from the data we already have. Once a real
  // `/users` endpoint exists this should be replaced by `useTenantUsers()`.
  const recruiterOptions = useMemo<TenantRecruiter[]>(() => {
    const seen = new Map<string, string>();
    for (const a of assignments ?? []) {
      if (!seen.has(a.recruiter_id)) {
        seen.set(a.recruiter_id, a.recruiter_name ?? a.recruiter_id);
      }
    }
    for (const r of records ?? []) {
      if (!seen.has(r.recruiter_id)) {
        seen.set(r.recruiter_id, r.recruiter_name ?? r.recruiter_id);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [assignments, records]);

  const handleCreate = async () => {
    if (!recruiter || !contractId || !schemeId) return;
    const recruiterMember = recruiterOptions.find((m) => m.id === recruiter);
    const scheme = schemes?.find((s) => s.id === schemeId);
    try {
      await create.mutateAsync({
        recruiter_id: recruiter,
        recruiter_name: recruiterMember?.name,
        contract_id: contractId,
        scheme_id: schemeId,
        scheme_name: scheme?.name,
        share_percent: parseFloat(share) || 100,
      });
      toast({ title: t("commissions.assignments.toasts.created") });
      setOpen(false);
      setRecruiter("");
      setContractId("");
      setSchemeId("");
      setShare("100");
    } catch {
      toast({
        title: t("commissions.assignments.toasts.createError"),
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <div className="flex justify-end">
        <Button
          onClick={() => setOpen(true)}
          className="border-0 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          {t("commissions.assignments.newAssignment")}
        </Button>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !assignments || assignments.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              <Users className="mx-auto mb-2 h-10 w-10 text-muted-foreground/40" />
              {t("commissions.assignments.empty")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-zinc-50/50 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground dark:bg-zinc-900/40">
                  <tr>
                    <th className="px-4 py-3">
                      {t("commissions.assignments.columns.recruiter")}
                    </th>
                    <th className="px-4 py-3">
                      {t("commissions.assignments.columns.contract")}
                    </th>
                    <th className="px-4 py-3">
                      {t("commissions.assignments.columns.scheme")}
                    </th>
                    <th className="px-4 py-3 text-right">
                      {t("commissions.assignments.columns.share")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a) => {
                    const c = contracts?.find((ct) => ct.id === a.contract_id);
                    return (
                      <tr
                        key={a.id}
                        className="border-b border-border/60 hover:bg-zinc-50/40 dark:hover:bg-zinc-900/40"
                      >
                        <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                          {a.recruiter_name ?? a.recruiter_id}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-zinc-700 dark:text-zinc-300">
                            {c?.candidate_name ?? a.contract_id}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {c?.client_name ?? "—"}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">
                          {a.scheme_name ?? a.scheme_id}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Badge variant="outline" className="text-xs">
                            {a.share_percent}%
                          </Badge>
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("commissions.assignments.dialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("commissions.assignments.dialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("commissions.assignments.dialog.recruiterLabel")}</Label>
              {recruiterOptions.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  {t("commissions.assignments.dialog.noRecruiters")}
                </p>
              ) : (
                <Select value={recruiter} onValueChange={setRecruiter}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t(
                        "commissions.assignments.dialog.recruiterPlaceholder"
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {recruiterOptions.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div>
              <Label>{t("commissions.assignments.dialog.contractLabel")}</Label>
              <Select value={contractId} onValueChange={setContractId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={t(
                      "commissions.assignments.dialog.contractPlaceholder"
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(contracts ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.candidate_name} — {c.client_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("commissions.assignments.dialog.schemeLabel")}</Label>
              <Select value={schemeId} onValueChange={setSchemeId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={t(
                      "commissions.assignments.dialog.schemePlaceholder"
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(schemes ?? [])
                    .filter((s) => s.active)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("commissions.assignments.dialog.shareLabel")}</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={share}
                onChange={(e) => setShare(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("commissions.assignments.dialog.shareHint")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("commissions.assignments.dialog.cancel")}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={
                !recruiter || !contractId || !schemeId || create.isPending
              }
              className="border-0 bg-gradient-to-r from-indigo-500 to-purple-600"
            >
              {create.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              {t("commissions.assignments.dialog.assign")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Shared ─────────────────────────────────────────────────────────────────

function KpiTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "amber" | "indigo" | "emerald";
}) {
  const cls: Record<typeof accent, string> = {
    amber: "text-amber-600 dark:text-amber-400",
    indigo: "text-indigo-600 dark:text-indigo-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
  };
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className={`mt-1 text-xl font-bold ${cls[accent]}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
