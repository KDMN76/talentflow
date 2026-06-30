"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Info, Loader2, Scale } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
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
  useUpdatePaySettings,
} from "@/hooks/useCompliance";
import { cn } from "@/lib/utils";
import type { TenantPaySettings } from "@/lib/types/skills";

const CURRENCIES = [
  { value: "EUR", labelKey: "eur" },
  { value: "GBP", labelKey: "gbp" },
  { value: "USD", labelKey: "usd" },
  { value: "CHF", labelKey: "chf" },
] as const;

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
        enforce_salary_range: draft.enforce_salary_range,
        forbid_current_salary_question: draft.forbid_current_salary_question,
        reporting_threshold_employees: draft.reporting_threshold_employees,
        default_currency: draft.default_currency,
        allow_anonymous_benchmark: draft.allow_anonymous_benchmark,
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
                checked={draft.enforce_salary_range}
                onChange={(v) =>
                  setDraft({ ...draft, enforce_salary_range: v })
                }
              />
              <ToggleRow
                title={t("payTransparency.policy.forbidCurrentSalary.title")}
                description={t(
                  "payTransparency.policy.forbidCurrentSalary.description"
                )}
                checked={draft.forbid_current_salary_question}
                onChange={(v) =>
                  setDraft({ ...draft, forbid_current_salary_question: v })
                }
              />
              <ToggleRow
                title={t("payTransparency.policy.anonymousBenchmark.title")}
                description={t(
                  "payTransparency.policy.anonymousBenchmark.description"
                )}
                checked={draft.allow_anonymous_benchmark}
                onChange={(v) =>
                  setDraft({ ...draft, allow_anonymous_benchmark: v })
                }
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-2">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">
                    {t("payTransparency.policy.reportingThreshold.label")}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={draft.reporting_threshold_employees}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        reporting_threshold_employees: Number(e.target.value),
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
    </div>
  );
}
