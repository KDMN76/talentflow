"use client";

/**
 * EditPanel — right sidebar of the builder.
 *
 * Context-aware: renders an edit form for the currently-selected block.
 * For MVP we ship 4 fully-typed forms (Hero / Features / JobsList / Cta).
 * The remaining 4 block-types (about / testimonials / footer / custom_html)
 * fall back to a JSON-textarea editor so recruiters can still tweak them.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CareerPageBlock,
  CareerPageBlockType,
  CareerPageBlockConfig,
  HeroBlockConfig,
  FeaturesBlockConfig,
  JobsListBlockConfig,
  CtaBlockConfig,
} from "@/hooks/useCareerPages";

const BLOCK_TYPE_LABELS: Record<CareerPageBlockType, string> = {
  hero: "Hero",
  features: "Features",
  jobs_list: "Vacatures",
  about: "Over ons",
  testimonials: "Reviews",
  cta: "Call to Action",
  footer: "Footer",
  custom_html: "Custom HTML",
};

export interface EditPanelProps {
  block: CareerPageBlock | null;
  onChange: (config: CareerPageBlockConfig) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function EditPanel({ block, onChange, onDelete, onClose }: EditPanelProps) {
  if (!block) {
    return (
      <aside className="w-80 shrink-0 border-l border-border bg-zinc-50/40 dark:bg-zinc-900/40">
        <div className="sticky top-0 flex h-full min-h-[400px] flex-col items-center justify-center gap-2 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Geen blok geselecteerd
          </p>
          <p className="text-xs text-muted-foreground">
            Klik een blok in het canvas om te bewerken.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-80 shrink-0 border-l border-border bg-zinc-50/40 dark:bg-zinc-900/40">
      <div className="sticky top-0 flex h-screen flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border bg-white/80 px-4 py-3 dark:bg-zinc-950/60">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Blok
          </span>
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {BLOCK_TYPE_LABELS[block.type] ?? block.type}
          </span>
          <span className="ml-auto" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-zinc-400 hover:text-red-600"
            onClick={onDelete}
            aria-label="Blok verwijderen"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-zinc-400 hover:text-zinc-700"
            onClick={onClose}
            aria-label="Paneel sluiten"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <BlockEditor block={block} onChange={onChange} />
        </div>
      </div>
    </aside>
  );
}

// ─── Per-type editors ────────────────────────────────────────────────────────

function BlockEditor({
  block,
  onChange,
}: {
  block: CareerPageBlock;
  onChange: (config: CareerPageBlockConfig) => void;
}) {
  switch (block.type) {
    case "hero":
      return (
        <HeroEditPanel
          config={block.config as HeroBlockConfig}
          onChange={onChange}
        />
      );
    case "features":
      return (
        <FeaturesEditPanel
          config={block.config as FeaturesBlockConfig}
          onChange={onChange}
        />
      );
    case "jobs_list":
      return (
        <JobsListEditPanel
          config={block.config as JobsListBlockConfig}
          onChange={onChange}
        />
      );
    case "cta":
      return (
        <CtaEditPanel
          config={block.config as CtaBlockConfig}
          onChange={onChange}
        />
      );
    default:
      return <JsonFallbackEditor config={block.config} onChange={onChange} />;
  }
}

// ─── Hero ────────────────────────────────────────────────────────────────────

function HeroEditPanel({
  config,
  onChange,
}: {
  config: HeroBlockConfig;
  onChange: (config: HeroBlockConfig) => void;
}) {
  const set = <K extends keyof HeroBlockConfig>(k: K, v: HeroBlockConfig[K]) =>
    onChange({ ...config, [k]: v });

  return (
    <div className="space-y-4">
      <Field label="Headline">
        <Input
          value={config.headline ?? ""}
          onChange={(e) => set("headline", e.target.value)}
          placeholder="Werk bij ons"
        />
      </Field>
      <Field label="Subheadline">
        <Input
          value={config.subheadline ?? ""}
          onChange={(e) => set("subheadline", e.target.value)}
          placeholder="Maak het verschil"
        />
      </Field>
      <Field label="Achtergrondafbeelding (URL)">
        <Input
          value={config.image_url ?? ""}
          onChange={(e) => set("image_url", e.target.value)}
          placeholder="https://…/foto.jpg"
        />
      </Field>
      <Field label="Knop label">
        <Input
          value={config.cta_label ?? ""}
          onChange={(e) => set("cta_label", e.target.value)}
          placeholder="Bekijk vacatures"
        />
      </Field>
      <Field label="Knop link">
        <Input
          value={config.cta_link ?? ""}
          onChange={(e) => set("cta_link", e.target.value)}
          placeholder="#jobs"
        />
      </Field>
    </div>
  );
}

// ─── Features ────────────────────────────────────────────────────────────────

function FeaturesEditPanel({
  config,
  onChange,
}: {
  config: FeaturesBlockConfig;
  onChange: (config: FeaturesBlockConfig) => void;
}) {
  const items = config.items ?? [];

  const updateItem = (idx: number, patch: Partial<FeaturesBlockConfig["items"][number]>) => {
    onChange({
      ...config,
      items: items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    });
  };
  const addItem = () =>
    onChange({
      ...config,
      items: [...items, { icon: "Sparkles", title: "Nieuw voordeel", body: "Korte beschrijving" }],
    });
  const removeItem = (idx: number) =>
    onChange({ ...config, items: items.filter((_, i) => i !== idx) });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Items ({items.length})
        </Label>
        <Button size="sm" variant="outline" className="h-7 gap-1" onClick={addItem}>
          <Plus className="h-3.5 w-3.5" />
          Toevoegen
        </Button>
      </div>
      <div className="space-y-3">
        {items.map((it, i) => (
          <div
            key={i}
            className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                #{i + 1}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-zinc-400 hover:text-red-600"
                onClick={() => removeItem(i)}
                aria-label={`Item ${i + 1} verwijderen`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="space-y-2">
              <Field label="Icoon (Lucide-naam)" tight>
                <Input
                  value={it.icon ?? ""}
                  onChange={(e) => updateItem(i, { icon: e.target.value })}
                  placeholder="Sparkles"
                />
              </Field>
              <Field label="Titel" tight>
                <Input
                  value={it.title}
                  onChange={(e) => updateItem(i, { title: e.target.value })}
                />
              </Field>
              <Field label="Tekst" tight>
                <Input
                  value={it.body}
                  onChange={(e) => updateItem(i, { body: e.target.value })}
                />
              </Field>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Jobs list ───────────────────────────────────────────────────────────────

function JobsListEditPanel({
  config,
  onChange,
}: {
  config: JobsListBlockConfig;
  onChange: (config: JobsListBlockConfig) => void;
}) {
  const set = <K extends keyof JobsListBlockConfig>(
    k: K,
    v: JobsListBlockConfig[K]
  ) => onChange({ ...config, [k]: v });

  const setFilter = (
    k: "department" | "location",
    v: string
  ) => {
    const next = { ...(config.filter ?? {}), [k]: v };
    if (!v) delete next[k];
    onChange({ ...config, filter: next });
  };

  return (
    <div className="space-y-4">
      <Field label="Layout">
        <Select
          value={config.layout ?? "cards"}
          onValueChange={(v) => set("layout", v as JobsListBlockConfig["layout"])}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cards">Kaarten</SelectItem>
            <SelectItem value="list">Lijst</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Maximum aantal vacatures">
        <Input
          type="number"
          min={0}
          value={config.limit ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            set("limit", raw === "" ? undefined : Number(raw));
          }}
          placeholder="Onbeperkt"
        />
      </Field>
      <Field label="Filter op afdeling">
        <Input
          value={config.filter?.department ?? ""}
          onChange={(e) => setFilter("department", e.target.value)}
          placeholder="bv. Engineering"
        />
      </Field>
      <Field label="Filter op locatie">
        <Input
          value={config.filter?.location ?? ""}
          onChange={(e) => setFilter("location", e.target.value)}
          placeholder="bv. Den Haag"
        />
      </Field>
    </div>
  );
}

// ─── CTA ─────────────────────────────────────────────────────────────────────

function CtaEditPanel({
  config,
  onChange,
}: {
  config: CtaBlockConfig;
  onChange: (config: CtaBlockConfig) => void;
}) {
  const set = <K extends keyof CtaBlockConfig>(k: K, v: CtaBlockConfig[K]) =>
    onChange({ ...config, [k]: v });

  return (
    <div className="space-y-4">
      <Field label="Tekst">
        <Input
          value={config.text ?? ""}
          onChange={(e) => set("text", e.target.value)}
          placeholder="Klaar voor een nieuwe stap?"
        />
      </Field>
      <Field label="Knop label">
        <Input
          value={config.button_label ?? ""}
          onChange={(e) => set("button_label", e.target.value)}
          placeholder="Bekijk vacatures"
        />
      </Field>
      <Field label="Knop link">
        <Input
          value={config.button_link ?? ""}
          onChange={(e) => set("button_link", e.target.value)}
          placeholder="#jobs"
        />
      </Field>
    </div>
  );
}

// ─── JSON fallback (about / testimonials / footer / custom_html) ─────────────

function JsonFallbackEditor({
  config,
  onChange,
}: {
  config: CareerPageBlockConfig;
  onChange: (config: CareerPageBlockConfig) => void;
}) {
  const formatted = useMemo(() => JSON.stringify(config, null, 2), [config]);
  const [draft, setDraft] = useState(formatted);
  const [parseError, setParseError] = useState<string | null>(null);

  // Re-sync draft when external config changes (e.g. user picks another block)
  useEffect(() => {
    setDraft(formatted);
    setParseError(null);
  }, [formatted]);

  const handleChange = (value: string) => {
    setDraft(value);
    try {
      const parsed = JSON.parse(value) as CareerPageBlockConfig;
      setParseError(null);
      onChange(parsed);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Ongeldige JSON");
    }
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Geavanceerd: bewerk JSON config
      </Label>
      <textarea
        rows={14}
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
        className={`w-full resize-y rounded-lg border bg-white p-3 font-mono text-xs leading-relaxed shadow-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 dark:bg-zinc-950 ${
          parseError
            ? "border-red-400 ring-1 ring-red-200"
            : "border-zinc-200"
        }`}
      />
      {parseError ? (
        <p className="text-[11px] font-medium text-red-600">
          JSON-fout: {parseError}
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Wijzigingen worden direct toegepast wanneer JSON geldig is.
        </p>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Field({
  label,
  children,
  tight,
}: {
  label: string;
  children: React.ReactNode;
  tight?: boolean;
}) {
  return (
    <div className={tight ? "space-y-1" : "space-y-1.5"}>
      <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
