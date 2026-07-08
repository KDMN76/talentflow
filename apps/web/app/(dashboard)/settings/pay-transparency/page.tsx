"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  Scale,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  usePaySettings,
  usePayTransparencyReport,
  useUpdatePaySettings,
} from "@/hooks/useCompliance";
import { cn } from "@/lib/utils";
import type {
  PayTransparencyMissingField,
  SalaryFrequency,
  TenantPaySettings,
} from "@/lib/types/skills";

const CURRENCIES = [
  { value: "EUR", labelKey: "eur" },
  { value: "GBP", labelKey: "gbp" },
  { value: "USD", labelKey: "usd" },
  { value: "CHF", labelKey: "chf" },
] as const;

const FREQUENCIES: SalaryFrequency[] = ["monthly", "annual", "hourly"];

const MISSING_ORDER: PayTransparencyMissingField[] = [
  "salary_min",
  "salary_max",
  "salary_frequency",
];

interface ToggleRowProps {
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

function ToggleRow({ title, description, checked, onChange, disabled }: ToggleRowProps) {
  return (
    <label
      className={cn(
        "flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-background px-4 py-3 cursor-pointer transition-colors",
        disabled && "opacity-60 cursor-not-allowed",
        !disabled && "hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30"
      )}
    >
      <div className="space-y-0.5 min-w-0">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2",
          checked ? "bg-indigo-600" : "bg-zinc-300 dark:bg-zinc-700"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition",
            checked ? "translate-x-5" : "translate-x-0"
          )}
        />
      </button>
    </label>
  );
}

export default function PayTransparencySettingsPage() {
  const { t } = useTranslation("settingsAdvanced");
  const { data, isLoading } = usePaySettings();
  const updateSettings = useUpdatePaySettings();
  const { toast } = useToast();

  const [draft, setDraft] = useState<TenantPaySettings | null>(null);

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const dirty =
    draft &&
    data &&
    JSON.stringify({ ...draft, updated_at: "" }) !==
      JSON.stringify({ ...data, updated_at: "" });

  const handleSave = async () => {
    if (!draft) return;
    try {
      await updateSettings.mutateAsync({
        pay_transparency_enforced: draft.pay_transparency_enforced,
        prohibit_current_salary_questions: draft.prohibit_current_salary_questions,
        reporting_threshold: draft.reporting_threshold,
        default_currency: draft.default_currency,
        default_salary_frequency: draft.default_salary_frequency,
        benchmark_data_consent: draft.benchmark_data_consent,
      });
      toast({
        title: t("payTransparency.toast.saved.title"),
        description: t("payTransparency.toast.saved.description"),
      });
    } catch {
      toast({
        variant: "destructive",
        title: t("payTransparency.toast.error.title"),
        description: t("payTransparency.toast.error.description"),
      });
    }
  };

  return (
    <div className="max-w-3xl space-y-6 animate-fade-in">
      <PageHeader
        title={t("payTransparency.header.title")}
        description={t("payTransparency.header.description")}
      />

      {/* EU Directive info */}
      <Card className="border-0 shadow-sm bg-indigo-50/40 dark:bg-indigo-950/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2 text-indigo-700 dark:text-indigo-300">
            <Info className="h-4 w-4" />
            {t("payTransparency.directive.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
          <p>{t("payTransparency.directive.paragraph1")}</p>
          <p>{t("payTransparency.directive.paragraph2")}</p>
          <a
            href="https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32023L0970"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {t("payTransparency.directive.readMore")}
            <ExternalLink className="h-3 w-3" />
          </a>
        </CardContent>
      </Card>

      {/* Settings form */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Scale className="h-4 w-4 text-indigo-500" />
            {t("payTransparency.policy.title")}
          </CardTitle>
          <CardDescription>
            {t("payTransparency.policy.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading || !draft ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              <ToggleRow
                title={t("payTransparency.policy.enforceSalaryRange.title")}
                description={t(
                  "payTransparency.policy.enforceSalaryRange.description"
                )}
                checked={draft.pay_transparency_enforced}
                onChange={(v) =>
                  setDraft({ ...draft, pay_transparency_enforced: v })
                }
              />
              <ToggleRow
                title={t("payTransparency.policy.forbidCurrentSalary.title")}
                description={t(
                  "payTransparency.policy.forbidCurrentSalary.description"
                )}
                checked={draft.prohibit_current_salary_questions}
                onChange={(v) =>
                  setDraft({ ...draft, prohibit_current_salary_questions: v })
                }
              />
              <ToggleRow
                title={t("payTransparency.policy.anonymousBenchmark.title")}
                description={t(
                  "payTransparency.policy.anonymousBenchmark.description"
                )}
                checked={draft.benchmark_data_consent}
                onChange={(v) =>
                  setDraft({ ...draft, benchmark_data_consent: v })
                }
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-2">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">
                    {t("payTransparency.policy.reportingThreshold.label")}
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={draft.reporting_threshold}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        reporting_threshold: Number(e.target.value),
                      })
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {t("payTransparency.policy.reportingThreshold.help")}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">
                    {t("payTransparency.policy.defaultCurrency.label")}
                  </Label>
                  <Select
                    value={draft.default_currency}
                    onValueChange={(v) =>
                      setDraft({ ...draft, default_currency: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {t(`payTransparency.currencies.${c.labelKey}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    {t("payTransparency.policy.defaultCurrency.help")}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">
                    {t("payTransparency.policy.defaultFrequency.label")}
                  </Label>
                  <Select
                    value={draft.default_salary_frequency}
                    onValueChange={(v) =>
                      setDraft({
                        ...draft,
                        default_salary_frequency: v as SalaryFrequency,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FREQUENCIES.map((f) => (
                        <SelectItem key={f} value={f}>
                          {t(`payTransparency.frequencies.${f}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    {t("payTransparency.policy.defaultFrequency.help")}
                  </p>
                </div>
              </div>

              <div className="flex justify-end pt-3">
                <Button
                  onClick={handleSave}
                  disabled={!dirty || updateSettings.isPending}
                  className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
                >
                  {updateSettings.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {t("payTransparency.policy.save")}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Pay-transparency report */}
      <PayTransparencyReportCard />
    </div>
  );
}

// ─── Rapport: % vacatures met band + actielijst ─────────────────────────────

function PayTransparencyReportCard() {
  const { t } = useTranslation("settingsAdvanced");
  const { data: report, isLoading } = usePayTransparencyReport();

  const pct = report?.totals.pct_open_with_band ?? 0;
  const pctTone =
    pct >= 100
      ? "text-emerald-600 dark:text-emerald-400"
      : pct >= 80
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";
  const barTone =
    pct >= 100 ? "bg-emerald-500" : pct >= 80 ? "bg-amber-500" : "bg-red-500";

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-indigo-500" />
          {t("payTransparency.report.title")}
          {report && (
            <Badge
              variant="secondary"
              className={cn(
                "ml-1 text-[10px] uppercase tracking-wide",
                report.enforced
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                  : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              )}
            >
              {report.enforced
                ? t("payTransparency.report.enforcedOn")
                : t("payTransparency.report.enforcedOff")}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {t("payTransparency.report.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading || !report ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <>
            {/* KPI: % open met volledige band */}
            <div>
              <div className="flex items-end justify-between">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("payTransparency.report.pctLabel")}
                </p>
                <p className={cn("text-2xl font-bold leading-none", pctTone)}>
                  {pct}%
                </p>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className={cn("h-full rounded-full transition-all", barTone)}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            </div>

            {/* Totals */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ReportStat
                label={t("payTransparency.report.stats.open")}
                value={report.totals.open}
              />
              <ReportStat
                label={t("payTransparency.report.stats.withBand")}
                value={report.totals.open_with_band}
              />
              <ReportStat
                label={t("payTransparency.report.stats.withoutBand")}
                value={report.totals.open_without_band}
                warn={report.totals.open_without_band > 0}
              />
              <ReportStat
                label={t("payTransparency.report.stats.withoutFrequency")}
                value={report.totals.open_without_frequency}
                warn={report.totals.open_without_frequency > 0}
              />
            </div>

            {/* Actielijst */}
            <div className="space-y-2">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t("payTransparency.report.actionList.title")}
              </p>
              {report.action_list.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {t("payTransparency.report.actionList.empty")}
                </div>
              ) : (
                <ul className="space-y-2">
                  {report.action_list.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`/jobs/${item.id}`}
                        className="group flex items-center justify-between gap-3 rounded-lg border border-amber-200/70 bg-amber-50/50 px-4 py-2.5 transition-colors hover:bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20 dark:hover:bg-amber-950/40"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                            <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                              {item.title}
                            </span>
                            {item.job_reference && (
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {item.job_reference}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {MISSING_ORDER.filter((f) =>
                              item.missing.includes(f)
                            ).map((field) => (
                              <span
                                key={field}
                                className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                              >
                                {t(`payTransparency.report.missing.${field}`)}
                              </span>
                            ))}
                          </div>
                        </div>
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Link naar pay-equity */}
            <div className="border-t border-border/60 pt-3">
              <Link
                href="/gdpr"
                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {t("payTransparency.report.payEquityLink")}
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ReportStat({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 px-3 py-2 ring-1 ring-inset ring-zinc-200/70 dark:ring-zinc-700/50">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-xl font-bold leading-none",
          warn
            ? "text-amber-600 dark:text-amber-400"
            : "text-zinc-900 dark:text-zinc-100"
        )}
      >
        {value}
      </p>
    </div>
  );
}
