"use client";

import { useEffect, useMemo, useState } from "react";
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

const LEVEL_OPTIONS: Array<{ value: JdGeneratorLevel; label: string }> = [
  { value: "junior", label: "Junior" },
  { value: "medior", label: "Medior" },
  { value: "senior", label: "Senior" },
  { value: "lead", label: "Lead" },
  { value: "director", label: "Director" },
];

const TONE_OPTIONS: Array<{ value: JdGeneratorTone; label: string }> = [
  { value: "formal", label: "Formeel" },
  { value: "casual", label: "Informeel" },
  { value: "direct", label: "Direct" },
  { value: "enthusiastic", label: "Enthousiast" },
];

const LENGTH_OPTIONS: Array<{ value: JdGeneratorLength; label: string }> = [
  { value: "short", label: "Kort (~80 woorden)" },
  { value: "medium", label: "Gemiddeld (~150 woorden)" },
  { value: "long", label: "Uitgebreid (~250 woorden)" },
];

const LANGUAGE_OPTIONS: Array<{ value: JdGeneratorLanguage; label: string }> = [
  { value: "NL", label: "Nederlands" },
  { value: "EN", label: "Engels" },
  { value: "DE", label: "Duits" },
  { value: "FR", label: "Frans" },
];

const SEVERITY_COPY: Record<BiasFlag["severity"], { label: string; cls: string }> = {
  low: {
    label: "Laag",
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  },
  medium: {
    label: "Middel",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
  high: {
    label: "Hoog",
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
            Terug naar vacatures
          </Link>
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
          <Wand2 className="h-6 w-6 text-purple-500" />
          AI Vacaturetekst-generator
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Genereer drie varianten en kies de beste — recruiter behoudt het
          finale oordeel.
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
  const steps: { id: WizardStep; label: string; sub: string }[] = [
    { id: "brief", label: "Briefing", sub: "Wat moet de AI weten?" },
    { id: "compare", label: "Vergelijk", sub: "Kies een winnaar" },
    { id: "publish", label: "Publiceer", sub: "Bewerk en plaats" },
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
        title: "Vul de basis in",
        description: "Functietitel en minimaal één skill zijn verplicht.",
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
        title: "Drie varianten gegenereerd",
        description: "Vergelijk en kies de beste.",
      });
      onCreated(draft.id);
    } catch {
      toast({
        variant: "destructive",
        title: "Genereren mislukte",
        description: "Probeer opnieuw of pas de input aan.",
      });
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Basis</CardTitle>
            <CardDescription>
              Vertel de AI welke rol je wilt invullen.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role">Functietitel *</Label>
              <Input
                id="role"
                placeholder="Senior Frontend Developer"
                value={input.role}
                onChange={(e) => set("role", e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Niveau</Label>
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
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Taal</Label>
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
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Kernvaardigheden *</Label>
              <TagInput
                value={input.key_skills}
                onChange={(t) => set("key_skills", t)}
                placeholder="React, TypeScript, Next.js…"
              />
              <p className="text-xs text-muted-foreground">
                Druk op Enter of komma om toe te voegen.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Vereisten en pré</CardTitle>
            <CardDescription>Eén punt per regel.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="must">Must-haves</Label>
              <textarea
                id="must"
                rows={4}
                value={mustText}
                onChange={(e) => setMustText(e.target.value)}
                placeholder="5+ jaar React-ervaring&#10;Sterke TypeScript-vaardigheden"
                className="flex min-h-[100px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 resize-none"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nice">Nice-to-haves</Label>
              <textarea
                id="nice"
                rows={4}
                value={niceText}
                onChange={(e) => setNiceText(e.target.value)}
                placeholder="Ervaring met Next.js App Router&#10;Web-performance kennis"
                className="flex min-h-[100px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 resize-none"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Stijl en context</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Tone-of-voice</Label>
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
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Lengte</Label>
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
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="company">Bedrijfscontext</Label>
              <textarea
                id="company"
                rows={4}
                value={input.company_context ?? ""}
                onChange={(e) => set("company_context", e.target.value)}
                placeholder="Wie zijn jullie? Wat doen jullie? Hoe ziet het team eruit?"
                className="flex min-h-[100px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 resize-none"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button variant="outline" asChild>
            <Link href="/jobs/new">Standaard formulier</Link>
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
            Genereer 3 varianten
          </Button>
        </div>
      </div>

      {/* Sidebar — disclosure + tips */}
      <div className="space-y-4">
        <Card className="border-0 shadow-sm bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-950/30 dark:to-indigo-950/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-500" />
              Wat doet de AI?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
              De generator schrijft drie varianten met dezelfde inhoud, maar in
              verschillende toon en structuur. Je kiest één winnaar, kunt elke
              variant regenereren, en bewerkt zelf voor publicatie.
            </p>
            <p className="mt-3 text-[11px] text-muted-foreground border-t border-purple-200/60 dark:border-purple-900/40 pt-2">
              EU AI Act Art. 50 — recruiter behoudt het finale oordeel.
            </p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Tips voor beste resultaat</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1.5 list-disc ml-4">
              <li>Schrijf must-haves concreet en meetbaar.</li>
              <li>Vermeld team-grootte en werkmodel in de context.</li>
              <li>Voeg minimaal 3 skills toe voor bruikbare output.</li>
              <li>Tone "direct" werkt het best voor tech-rollen.</li>
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
        title: "Variant geselecteerd",
        description: "Je kunt 'm nu bewerken en publiceren.",
      });
      onSelected();
    } catch {
      toast({
        variant: "destructive",
        title: "Fout",
        description: "Selecteren mislukte.",
      });
    }
  };

  const handleRegenerate = async (variantId: string) => {
    setBusyVariant(variantId);
    try {
      await regenerate.mutateAsync({ variant_id: variantId });
      toast({
        title: "Variant ververst",
        description: "Een nieuwe versie is gegenereerd.",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Fout",
        description: "Regenereren mislukte.",
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
          Pas briefing aan
        </Button>
        <div className="flex items-center gap-2">
          <AIBadge label="Drie AI-gegenereerde varianten — recruiter behoudt het finale oordeel." />
          <p className="text-xs text-muted-foreground">
            Door AI gegenereerd — kies of bewerk handmatig.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {draft.variants.map((variant, idx) => (
          <VariantColumn
            key={variant.id}
            variant={variant}
            label={`Variant ${idx + 1}`}
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
              Geselecteerd
            </Badge>
          )}
        </div>
        <CardTitle className="text-base leading-snug">{variant.title}</CardTitle>
      </CardHeader>

      <CardContent className="flex-1 space-y-4">
        {/* Score gauges + word count */}
        <div className="flex items-start justify-around gap-2 rounded-lg bg-zinc-50/60 dark:bg-zinc-800/40 p-3">
          <ScoreGauge label="Helderheid" value={variant.clarity_score} />
          <ScoreGauge label="Inclusief" value={variant.inclusivity_score} />
          <div className="flex flex-col items-center gap-1">
            <div className="flex h-[60px] w-[60px] items-center justify-center text-sm font-bold text-zinc-700 dark:text-zinc-200">
              {variant.word_count}
            </div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Woorden
            </p>
          </div>
        </div>

        {/* Bias flags */}
        {variant.bias_flags.length > 0 ? (
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Aandachtspunten ({variant.bias_flags.length})
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
                  {flag.label} · {SEVERITY_COPY[flag.severity].label}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Geen bias-vlaggen
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
          Regenereer
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
              Geselecteerd
            </>
          ) : (
            <>
              Selecteer
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

  const [overrides, setOverrides] = useState<JdDraftPublishOverrides>({});
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
            Selecteer eerst een variant in stap 2.
          </p>
          <Button onClick={onBack} variant="outline">
            Ga terug
          </Button>
        </CardContent>
      </Card>
    );
  }

  const setOverride = <K extends keyof JdDraftPublishOverrides>(
    key: K,
    value: JdDraftPublishOverrides[K]
  ) => setOverrides((cur) => ({ ...cur, [key]: value }));

  const handlePublish = async () => {
    try {
      const resp = await publish.mutateAsync({
        overrides: {
          ...overrides,
          title: titleEdit.trim() || selectedVariant.title,
          description: descEdit.trim() || selectedVariant.description,
        },
      });
      toast({
        title: "Vacature aangemaakt",
        description: `"${resp.job.title}" staat als concept in je lijst.`,
      });
      router.push(`/jobs/${resp.job.id}`);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Publiceren mislukte",
        description:
          err instanceof Error ? err.message : "Probeer het opnieuw.",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Wissel variant
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Editable variant */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                Bewerk de vacaturetekst
                <AIBadge />
              </CardTitle>
              <CardDescription>
                De AI-output is een startpunt — finetune naar wens.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pub-title">Functietitel *</Label>
                <Input
                  id="pub-title"
                  value={titleEdit}
                  onChange={(e) => setTitleEdit(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pub-desc">Functieomschrijving (Markdown)</Label>
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
              <CardTitle className="text-base">Vacature-details</CardTitle>
              <CardDescription>
                Operationele velden die de AI niet invult.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="dept">Afdeling</Label>
                  <Input
                    id="dept"
                    placeholder="Engineering"
                    value={overrides.department ?? ""}
                    onChange={(e) => setOverride("department", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="loc">Locatie</Label>
                  <Input
                    id="loc"
                    placeholder="Amsterdam"
                    value={overrides.location ?? ""}
                    onChange={(e) => setOverride("location", e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Werklocatie</Label>
                  <Select
                    value={overrides.remote_type ?? ""}
                    onValueChange={(v) => setOverride("remote_type", v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Kies…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="onsite">Op kantoor</SelectItem>
                      <SelectItem value="hybrid">Hybride</SelectItem>
                      <SelectItem value="remote">Remote</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Contracttype</Label>
                  <Select
                    value={overrides.employment_type ?? ""}
                    onValueChange={(v) => setOverride("employment_type", v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Kies…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fulltime">Fulltime</SelectItem>
                      <SelectItem value="parttime">Parttime</SelectItem>
                      <SelectItem value="contract">Contract</SelectItem>
                      <SelectItem value="freelance">Freelance</SelectItem>
                      <SelectItem value="internship">Stage</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="smin">Salaris min</Label>
                  <Input
                    id="smin"
                    type="number"
                    placeholder="65000"
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
                  <Label htmlFor="smax">Salaris max</Label>
                  <Input
                    id="smax"
                    type="number"
                    placeholder="85000"
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
                  <Label>Frequentie</Label>
                  <Select
                    value={overrides.salary_frequency ?? "yearly"}
                    onValueChange={(v) => setOverride("salary_frequency", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hourly">per uur</SelectItem>
                      <SelectItem value="monthly">per maand</SelectItem>
                      <SelectItem value="yearly">per jaar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="opendate">Open vanaf</Label>
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
                  <Label htmlFor="closedate">Sluitingsdatum</Label>
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
                  <Label htmlFor="ref">Referentie</Label>
                  <Input
                    id="ref"
                    placeholder="ENG-FE-2026-04"
                    value={overrides.job_reference ?? ""}
                    onChange={(e) =>
                      setOverride("job_reference", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="head">Aantal posities</Label>
                  <Input
                    id="head"
                    type="number"
                    placeholder="1"
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

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onBack}>
              Terug
            </Button>
            <Button
              onClick={handlePublish}
              disabled={publish.isPending}
              className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
            >
              {publish.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Publiceer als concept
            </Button>
          </div>
        </div>

        {/* Live preview */}
        <div className="space-y-4">
          <Card className="border-0 shadow-sm sticky top-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-500" />
                Voorvertoning
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
