"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  Wand2,
} from "lucide-react";
import { AIBadge } from "@/components/matching/AIBadge";
import { JdMarkdown } from "@/components/jobs/jd-generator/JdMarkdown";
import { ScoreGauge } from "@/components/jobs/jd-generator/ScoreGauge";
import { TagInput } from "@/components/jobs/jd-generator/TagInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  useCreateJdDraft,
  useJdDraft,
  usePublishJdDraft,
  useRegenerateVariant,
  useSelectVariant,
} from "@/hooks/useJdGenerator";
import { usePaySettings } from "@/hooks/useCompliance";
import { cn } from "@/lib/utils";
import type {
  JdDraftPublishOverrides,
  JdGeneratorInput,
  JdGeneratorLanguage,
  JdGeneratorLength,
  JdGeneratorLevel,
  JdGeneratorTone,
  JdVariant,
} from "@/lib/types/jdGenerator";
import type { BiasFlag } from "@/lib/types/jobDetail";

// ─── Static option lists ────────────────────────────────────────────────────
// Module-level consts can't call `t`; they hold i18n KEY strings that are
// resolved with `t(...)` at each render site.

const LEVEL_OPTIONS: Array<{ value: JdGeneratorLevel; labelKey: string }> = [
  { value: "junior", labelKey: "options.level.junior" },
  { value: "medior", labelKey: "options.level.medior" },
  { value: "senior", labelKey: "options.level.senior" },
  { value: "lead", labelKey: "options.level.lead" },
  { value: "director", labelKey: "options.level.director" },
];

const TONE_OPTIONS: Array<{ value: JdGeneratorTone; labelKey: string }> = [
  { value: "formal", labelKey: "options.tone.formal" },
  { value: "casual", labelKey: "options.tone.casual" },
  { value: "direct", labelKey: "options.tone.direct" },
  { value: "enthusiastic", labelKey: "options.tone.enthusiastic" },
];

const LENGTH_OPTIONS: Array<{ value: JdGeneratorLength; labelKey: string }> = [
  { value: "short", labelKey: "options.length.short" },
  { value: "medium", labelKey: "options.length.medium" },
  { value: "long", labelKey: "options.length.long" },
];

const LANGUAGE_OPTIONS: Array<{ value: JdGeneratorLanguage; labelKey: string }> = [
  { value: "NL", labelKey: "options.language.NL" },
  { value: "EN", labelKey: "options.language.EN" },
  { value: "DE", labelKey: "options.language.DE" },
  { value: "FR", labelKey: "options.language.FR" },
];

const SEVERITY_COPY: Record<BiasFlag["severity"], { labelKey: string; cls: string }> = {
  low: {
    labelKey: "options.severity.low",
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  },
  medium: {
    labelKey: "options.severity.medium",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
  high: {
    labelKey: "options.severity.high",
    cls: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  },
};

// ─── Default input ──────────────────────────────────────────────────────────

const DEFAULT_INPUT: JdGeneratorInput = {
  role: "",
  level: "medior",
  key_skills: [],
  must_haves: [],
  nice_to_haves: [],
  tone: "direct",
  length: "medium",
  language: "NL",
  company_context: "",
};

type WizardStep = "brief" | "compare" | "publish";

// ─── Page ───────────────────────────────────────────────────────────────────

export default function JdGeneratorWizardPage() {
  const { t } = useTranslation("aiGenerator");
  const searchParams = useSearchParams();
  const initialDraftId = searchParams.get("draft");

  const [draftId, setDraftId] = useState<string | null>(initialDraftId);
  const [step, setStep] = useState<WizardStep>(
    initialDraftId ? "compare" : "brief"
  );

  return (
    <div className="space-y-6 animate-fade-in max-w-7xl">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="text-muted-foreground hover:text-foreground -ml-2"
        >
          <Link href="/jobs">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("header.back")}
          </Link>
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
          <Wand2 className="h-6 w-6 text-purple-500" />
          {t("header.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("header.subtitle")}
        </p>
      </div>

      <StepIndicator step={step} draftId={draftId} />

      {step === "brief" && (
        <BriefStep
          onCreated={(id) => {
            setDraftId(id);
            setStep("compare");
          }}
        />
      )}
      {step === "compare" && draftId && (
        <CompareStep
          draftId={draftId}
          onBack={() => setStep("brief")}
          onSelected={() => setStep("publish")}
        />
      )}
      {step === "publish" && draftId && (
        <PublishStep
          draftId={draftId}
          onBack={() => setStep("compare")}
        />
      )}
    </div>
  );
}

// ─── Step indicator ─────────────────────────────────────────────────────────

function StepIndicator({
  step,
  draftId,
}: {
  step: WizardStep;
  draftId: string | null;
}) {
  const { t } = useTranslation("aiGenerator");
  const steps: { id: WizardStep; label: string; sub: string }[] = [
    { id: "brief", label: t("steps.brief.label"), sub: t("steps.brief.sub") },
    { id: "compare", label: t("steps.compare.label"), sub: t("steps.compare.sub") },
    { id: "publish", label: t("steps.publish.label"), sub: t("steps.publish.sub") },
  ];
  const order: WizardStep[] = ["brief", "compare", "publish"];
  const currentIdx = order.indexOf(step);

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {steps.map((s, i) => {
        const isActive = s.id === step;
        const isComplete =
          i < currentIdx || (s.id === "brief" && draftId !== null);
        return (
          <div key={s.id} className="flex items-center gap-2 shrink-0">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold border-2 transition-all",
                isComplete
                  ? "bg-emerald-500 text-white border-emerald-500"
                  : isActive
                  ? "bg-gradient-to-br from-indigo-500 to-purple-600 text-white border-purple-300"
                  : "bg-zinc-100 text-muted-foreground border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700"
              )}
            >
              {isComplete ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            <div className="hidden sm:block">
              <p
                className={cn(
                  "text-sm font-semibold",
                  isActive
                    ? "text-zinc-900 dark:text-zinc-100"
                    : "text-muted-foreground"
                )}
              >
                {s.label}
              </p>
              <p className="text-[10px] text-muted-foreground">{s.sub}</p>
            </div>
            {i < steps.length - 1 && (
              <div className="h-0.5 w-8 sm:w-16 bg-zinc-200 dark:bg-zinc-700 mx-2" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── STEP 1: Brief ──────────────────────────────────────────────────────────

function BriefStep({ onCreated }: { onCreated: (draftId: string) => void }) {
  const { t } = useTranslation("aiGenerator");
  const { toast } = useToast();
  const create = useCreateJdDraft();
  const [input, setInput] = useState<JdGeneratorInput>(DEFAULT_INPUT);
  const [mustText, setMustText] = useState("");
  const [niceText, setNiceText] = useState("");

  const set = <K extends keyof JdGeneratorInput>(
    key: K,
    value: JdGeneratorInput[K]
  ) => setInput((cur) => ({ ...cur, [key]: value }));

  const isValid =
    input.role.trim().length >= 2 && input.key_skills.length >= 1;

  const handleSubmit = async () => {
    if (!isValid) {
      toast({
        variant: "destructive",
        title: t("brief.toasts.invalidTitle"),
        description: t("brief.toasts.invalidDescription"),
      });
      return;
    }
    const must_haves = mustText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const nice_to_haves = niceText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const draft = await create.mutateAsync({
        ...input,
        must_haves,
        nice_to_haves,
      });
      toast({
        title: t("brief.toasts.successTitle"),
        description: t("brief.toasts.successDescription"),
      });
      onCreated(draft.id);
    } catch {
      toast({
        variant: "destructive",
        title: t("brief.toasts.errorTitle"),
        description: t("brief.toasts.errorDescription"),
      });
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">{t("brief.basics.title")}</CardTitle>
            <CardDescription>
              {t("brief.basics.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role">{t("brief.basics.roleLabel")}</Label>
              <Input
                id="role"
                placeholder={t("brief.basics.rolePlaceholder")}
                value={input.role}
                onChange={(e) => set("role", e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("brief.basics.levelLabel")}</Label>
                <Select
                  value={input.level}
                  onValueChange={(v) => set("level", v as JdGeneratorLevel)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVEL_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {t(o.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("brief.basics.languageLabel")}</Label>
                <Select
                  value={input.language}
                  onValueChange={(v) => set("language", v as JdGeneratorLanguage)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {t(o.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("brief.basics.skillsLabel")}</Label>
              <TagInput
                value={input.key_skills}
                onChange={(tags) => set("key_skills", tags)}
                placeholder={t("brief.basics.skillsPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">
                {t("brief.basics.skillsHint")}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">{t("brief.requirements.title")}</CardTitle>
            <CardDescription>{t("brief.requirements.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="must">{t("brief.requirements.mustLabel")}</Label>
              <textarea
                id="must"
                rows={4}
                value={mustText}
                onChange={(e) => setMustText(e.target.value)}
                placeholder={t("brief.requirements.mustPlaceholder")}
                className="flex min-h-[100px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 resize-none"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nice">{t("brief.requirements.niceLabel")}</Label>
              <textarea
                id="nice"
                rows={4}
                value={niceText}
                onChange={(e) => setNiceText(e.target.value)}
                placeholder={t("brief.requirements.nicePlaceholder")}
                className="flex min-h-[100px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 resize-none"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">{t("brief.style.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("brief.style.toneLabel")}</Label>
                <Select
                  value={input.tone}
                  onValueChange={(v) => set("tone", v as JdGeneratorTone)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TONE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {t(o.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("brief.style.lengthLabel")}</Label>
                <Select
                  value={input.length}
                  onValueChange={(v) => set("length", v as JdGeneratorLength)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LENGTH_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {t(o.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="company">{t("brief.style.contextLabel")}</Label>
              <textarea
                id="company"
                rows={4}
                value={input.company_context ?? ""}
                onChange={(e) => set("company_context", e.target.value)}
                placeholder={t("brief.style.contextPlaceholder")}
                className="flex min-h-[100px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 resize-none"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button variant="outline" asChild>
            <Link href="/jobs/new">{t("brief.standardForm")}</Link>
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || create.isPending}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
          >
            {create.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            {t("brief.generate")}
          </Button>
        </div>
      </div>

      {/* Sidebar — disclosure + tips */}
      <div className="space-y-4">
        <Card className="border-0 shadow-sm bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-950/30 dark:to-indigo-950/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-500" />
              {t("brief.aiInfo.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
              {t("brief.aiInfo.body")}
            </p>
            <p className="mt-3 text-[11px] text-muted-foreground border-t border-purple-200/60 dark:border-purple-900/40 pt-2">
              {t("brief.aiInfo.disclosure")}
            </p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("brief.tips.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1.5 list-disc ml-4">
              <li>{t("brief.tips.tip1")}</li>
              <li>{t("brief.tips.tip2")}</li>
              <li>{t("brief.tips.tip3")}</li>
              <li>{t("brief.tips.tip4")}</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── STEP 2: Compare variants ───────────────────────────────────────────────

function CompareStep({
  draftId,
  onBack,
  onSelected,
}: {
  draftId: string;
  onBack: () => void;
  onSelected: () => void;
}) {
  const { t } = useTranslation("aiGenerator");
  const { toast } = useToast();
  const { data: draft, isLoading } = useJdDraft(draftId);
  const select = useSelectVariant(draftId);
  const regenerate = useRegenerateVariant(draftId);
  const [busyVariant, setBusyVariant] = useState<string | null>(null);

  // Auto-advance when a selection is locked in.
  useEffect(() => {
    if (draft?.selected_variant_id) {
      // user already picked previously — but don't auto-jump unless explicit
    }
  }, [draft?.selected_variant_id]);

  if (isLoading || !draft) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[480px] rounded-xl" />
        ))}
      </div>
    );
  }

  const handleSelect = async (variantId: string) => {
    try {
      await select.mutateAsync({ variant_id: variantId });
      toast({
        title: t("compare.toasts.selectedTitle"),
        description: t("compare.toasts.selectedDescription"),
      });
      onSelected();
    } catch {
      toast({
        variant: "destructive",
        title: t("compare.toasts.errorTitle"),
        description: t("compare.toasts.selectFailed"),
      });
    }
  };

  const handleRegenerate = async (variantId: string) => {
    setBusyVariant(variantId);
    try {
      await regenerate.mutateAsync({ variant_id: variantId });
      toast({
        title: t("compare.toasts.regeneratedTitle"),
        description: t("compare.toasts.regeneratedDescription"),
      });
    } catch {
      toast({
        variant: "destructive",
        title: t("compare.toasts.errorTitle"),
        description: t("compare.toasts.regenerateFailed"),
      });
    } finally {
      setBusyVariant(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("compare.adjustBriefing")}
        </Button>
        <div className="flex items-center gap-2">
          <AIBadge label={t("compare.aiBadgeLabel")} />
          <p className="text-xs text-muted-foreground">
            {t("compare.aiHint")}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {draft.variants.map((variant, idx) => (
          <VariantColumn
            key={variant.id}
            variant={variant}
            label={t("compare.variantLabel", { number: idx + 1 })}
            isSelected={draft.selected_variant_id === variant.id}
            isBusy={busyVariant === variant.id || regenerate.isPending}
            onSelect={() => handleSelect(variant.id)}
            onRegenerate={() => handleRegenerate(variant.id)}
          />
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground border-t border-border pt-2 flex items-start gap-1.5">
        <Sparkles className="h-3 w-3 mt-0.5 text-purple-500 shrink-0" />
        <span>{draft.ai_disclosure}</span>
      </p>
    </div>
  );
}

function VariantColumn({
  variant,
  label,
  isSelected,
  isBusy,
  onSelect,
  onRegenerate,
}: {
  variant: JdVariant;
  label: string;
  isSelected: boolean;
  isBusy: boolean;
  onSelect: () => void;
  onRegenerate: () => void;
}) {
  const { t } = useTranslation("aiGenerator");
  return (
    <Card
      className={cn(
        "flex flex-col border-2 transition-all",
        isSelected
          ? "border-emerald-500 shadow-lg shadow-emerald-100 dark:shadow-emerald-950/40"
          : "border-transparent shadow-sm"
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          {isSelected && (
            <Badge variant="success" className="text-[10px]">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              {t("variant.selected")}
            </Badge>
          )}
        </div>
        <CardTitle className="text-base leading-snug">{variant.title}</CardTitle>
      </CardHeader>

      <CardContent className="flex-1 space-y-4">
        {/* Score gauges + word count */}
        <div className="flex items-start justify-around gap-2 rounded-lg bg-zinc-50/60 dark:bg-zinc-800/40 p-3">
          <ScoreGauge label={t("variant.clarity")} value={variant.clarity_score} />
          <ScoreGauge label={t("variant.inclusive")} value={variant.inclusivity_score} />
          <div className="flex flex-col items-center gap-1">
            <div className="flex h-[60px] w-[60px] items-center justify-center text-sm font-bold text-zinc-700 dark:text-zinc-200">
              {variant.word_count}
            </div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("variant.words")}
            </p>
          </div>
        </div>

        {/* Bias flags */}
        {variant.bias_flags.length > 0 ? (
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("variant.attentionPoints", { count: variant.bias_flags.length })}
            </p>
            <div className="flex flex-wrap gap-1">
              {variant.bias_flags.map((flag, i) => (
                <span
                  key={i}
                  className={cn(
                    "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                    SEVERITY_COPY[flag.severity].cls
                  )}
                  title={flag.suggestion}
                >
                  {flag.label} · {t(SEVERITY_COPY[flag.severity].labelKey)}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t("variant.noBiasFlags")}
          </div>
        )}

        {/* Description */}
        <div className="rounded-lg border border-border bg-background max-h-72 overflow-y-auto p-3">
          <JdMarkdown source={variant.description} />
        </div>
      </CardContent>

      <div className="border-t border-border p-3 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={onRegenerate}
          disabled={isBusy}
        >
          {isBusy ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          {t("variant.regenerate")}
        </Button>
        <Button
          type="button"
          size="sm"
          className={cn(
            "flex-1",
            isSelected
              ? "bg-emerald-500 hover:bg-emerald-600 text-white"
              : "bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white"
          )}
          onClick={onSelect}
        >
          {isSelected ? (
            <>
              <Check className="mr-1.5 h-3.5 w-3.5" />
              {t("variant.selected")}
            </>
          ) : (
            <>
              {t("variant.select")}
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}

// ─── STEP 3: Edit + publish ─────────────────────────────────────────────────

function PublishStep({
  draftId,
  onBack,
}: {
  draftId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation("aiGenerator");
  const router = useRouter();
  const { toast } = useToast();
  const { data: draft, isLoading } = useJdDraft(draftId);
  const publish = usePublishJdDraft(draftId);

  const selectedVariant = useMemo(() => {
    if (!draft) return null;
    return (
      draft.variants.find((v) => v.id === draft.selected_variant_id) ?? null
    );
  }, [draft]);

  const { data: paySettings } = usePaySettings();
  const [overrides, setOverrides] = useState<JdDraftPublishOverrides>({});
  const [publishStatus, setPublishStatus] = useState<"draft" | "open">("draft");
  const [titleEdit, setTitleEdit] = useState("");
  const [descEdit, setDescEdit] = useState("");

  // Sync local edits when the draft loads.
  useEffect(() => {
    if (selectedVariant) {
      setTitleEdit(selectedVariant.title);
      setDescEdit(selectedVariant.description);
    }
  }, [selectedVariant]);

  if (isLoading || !draft) {
    return <Skeleton className="h-[600px] rounded-xl" />;
  }

  if (!selectedVariant) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="py-10 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("publish.noVariant")}
          </p>
          <Button onClick={onBack} variant="outline">
            {t("publish.goBack")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const setOverride = <K extends keyof JdDraftPublishOverrides>(
    key: K,
    value: JdDraftPublishOverrides[K]
  ) => setOverrides((cur) => ({ ...cur, [key]: value }));

  // Publiceer-gate (EU 2023/970): live zetten vereist een volledige
  // salarisband wanneer de tenant afdwingt. Frequentie valt zonder keuze
  // terug op de DB-default 'monthly' en is dus nooit "leeg" in deze flow.
  const enforced = !!paySettings?.pay_transparency_enforced;
  const bandIncomplete =
    overrides.salary_min == null || overrides.salary_max == null;
  const publishBlocked = publishStatus === "open" && enforced && bandIncomplete;

  const handlePublish = async () => {
    try {
      const resp = await publish.mutateAsync({
        overrides: {
          ...overrides,
          status: publishStatus,
          title: titleEdit.trim() || selectedVariant.title,
          description: descEdit.trim() || selectedVariant.description,
          // Frequentie expliciet meesturen: de Select toont zonder keuze de
          // tenant-default (kan 'annual' zijn), maar zonder dit veld zou de
          // DB-default 'monthly' opslaan — WYSIWYG-mismatch.
          salary_frequency:
            overrides.salary_frequency ??
            paySettings?.default_salary_frequency ??
            "monthly",
        },
      });
      toast({
        title: t("publish.toasts.createdTitle"),
        description:
          publishStatus === "open"
            ? t("publish.toasts.createdOpen", { title: resp.job.title })
            : t("publish.toasts.createdDraft", { title: resp.job.title }),
      });
      router.push(`/jobs/${resp.job.id}`);
    } catch (err) {
      const apiError = (
        err as {
          response?: { data?: { error?: { code?: string; message?: string } } };
        }
      )?.response?.data?.error;
      toast({
        variant: "destructive",
        title:
          apiError?.code === "PAY_TRANSPARENCY_REQUIRED"
            ? t("publish.toasts.payRequiredTitle")
            : t("publish.toasts.errorTitle"),
        description:
          apiError?.message ??
          (err instanceof Error ? err.message : t("publish.toasts.errorFallback")),
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("publish.switchVariant")}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Editable variant */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {t("publish.editTitle")}
                <AIBadge />
              </CardTitle>
              <CardDescription>
                {t("publish.editDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pub-title">{t("publish.roleLabel")}</Label>
                <Input
                  id="pub-title"
                  value={titleEdit}
                  onChange={(e) => setTitleEdit(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pub-desc">{t("publish.descriptionLabel")}</Label>
                <textarea
                  id="pub-desc"
                  rows={16}
                  value={descEdit}
                  onChange={(e) => setDescEdit(e.target.value)}
                  className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 resize-y"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">{t("publish.details.title")}</CardTitle>
              <CardDescription>
                {t("publish.details.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="dept">{t("publish.details.departmentLabel")}</Label>
                  <Input
                    id="dept"
                    placeholder={t("publish.details.departmentPlaceholder")}
                    value={overrides.department ?? ""}
                    onChange={(e) => setOverride("department", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="loc">{t("publish.details.locationLabel")}</Label>
                  <Input
                    id="loc"
                    placeholder={t("publish.details.locationPlaceholder")}
                    value={overrides.location ?? ""}
                    onChange={(e) => setOverride("location", e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("publish.details.remoteLabel")}</Label>
                  <Select
                    value={overrides.remote_type ?? ""}
                    onValueChange={(v) => setOverride("remote_type", v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("publish.details.selectPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="onsite">{t("publish.details.remoteOnsite")}</SelectItem>
                      <SelectItem value="hybrid">{t("publish.details.remoteHybrid")}</SelectItem>
                      <SelectItem value="remote">{t("publish.details.remoteRemote")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("publish.details.employmentLabel")}</Label>
                  <Select
                    value={overrides.employment_type ?? ""}
                    onValueChange={(v) => setOverride("employment_type", v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("publish.details.selectPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fulltime">{t("publish.details.employmentFulltime")}</SelectItem>
                      <SelectItem value="parttime">{t("publish.details.employmentParttime")}</SelectItem>
                      <SelectItem value="contract">{t("publish.details.employmentContract")}</SelectItem>
                      <SelectItem value="freelance">{t("publish.details.employmentFreelance")}</SelectItem>
                      <SelectItem value="internship">{t("publish.details.employmentInternship")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="smin">{t("publish.details.salaryMinLabel")}</Label>
                  <Input
                    id="smin"
                    type="number"
                    placeholder={t("publish.details.salaryMinPlaceholder")}
                    value={overrides.salary_min ?? ""}
                    onChange={(e) =>
                      setOverride(
                        "salary_min",
                        e.target.value ? Number(e.target.value) : null
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smax">{t("publish.details.salaryMaxLabel")}</Label>
                  <Input
                    id="smax"
                    type="number"
                    placeholder={t("publish.details.salaryMaxPlaceholder")}
                    value={overrides.salary_max ?? ""}
                    onChange={(e) =>
                      setOverride(
                        "salary_max",
                        e.target.value ? Number(e.target.value) : null
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("publish.details.frequencyLabel")}</Label>
                  <Select
                    value={
                      overrides.salary_frequency ??
                      paySettings?.default_salary_frequency ??
                      "monthly"
                    }
                    onValueChange={(v) => setOverride("salary_frequency", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hourly">{t("publish.details.frequencyHourly")}</SelectItem>
                      <SelectItem value="monthly">{t("publish.details.frequencyMonthly")}</SelectItem>
                      <SelectItem value="annual">{t("publish.details.frequencyAnnual")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="comp-criteria">
                  {t("publish.details.criteriaLabel")}
                </Label>
                <textarea
                  id="comp-criteria"
                  rows={3}
                  placeholder={t("publish.details.criteriaPlaceholder")}
                  value={overrides.compensation_criteria ?? ""}
                  onChange={(e) =>
                    setOverride(
                      "compensation_criteria",
                      e.target.value || null
                    )
                  }
                  className="flex min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 resize-none"
                />
                <p className="text-[11px] text-muted-foreground">
                  {t("publish.details.criteriaHint")}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="opendate">{t("publish.details.openDateLabel")}</Label>
                  <Input
                    id="opendate"
                    type="date"
                    value={overrides.open_date ?? ""}
                    onChange={(e) =>
                      setOverride("open_date", e.target.value || null)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="closedate">{t("publish.details.closeDateLabel")}</Label>
                  <Input
                    id="closedate"
                    type="date"
                    value={overrides.close_date ?? ""}
                    onChange={(e) =>
                      setOverride("close_date", e.target.value || null)
                    }
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ref">{t("publish.details.referenceLabel")}</Label>
                  <Input
                    id="ref"
                    placeholder={t("publish.details.referencePlaceholder")}
                    value={overrides.job_reference ?? ""}
                    onChange={(e) =>
                      setOverride("job_reference", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="head">{t("publish.details.headcountLabel")}</Label>
                  <Input
                    id="head"
                    type="number"
                    placeholder={t("publish.details.headcountPlaceholder")}
                    value={overrides.headcount ?? ""}
                    onChange={(e) =>
                      setOverride(
                        "headcount",
                        e.target.value ? Number(e.target.value) : null
                      )
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {publishBlocked && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              {t("publish.payWarning")}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button variant="outline" onClick={onBack}>
              {t("publish.back")}
            </Button>
            <Select
              value={publishStatus}
              onValueChange={(v) => setPublishStatus(v as "draft" | "open")}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">{t("publish.statusDraft")}</SelectItem>
                <SelectItem value="open">{t("publish.statusOpen")}</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={handlePublish}
              disabled={publish.isPending || publishBlocked}
              className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
            >
              {publish.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              {publishStatus === "open" ? t("publish.publishLive") : t("publish.publishDraft")}
            </Button>
          </div>
        </div>

        {/* Live preview */}
        <div className="space-y-4">
          <Card className="border-0 shadow-sm sticky top-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-500" />
                {t("publish.preview")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-3">
                {titleEdit || selectedVariant.title}
              </p>
              <div className="max-h-[500px] overflow-y-auto rounded-lg border border-border bg-zinc-50/60 dark:bg-zinc-800/40 p-3">
                <JdMarkdown source={descEdit || selectedVariant.description} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
