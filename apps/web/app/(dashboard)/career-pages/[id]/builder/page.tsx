"use client";

/**
 * Career-page builder — drag-drop block editor.
 *
 * Sprint Q2.2 (agent LL). 3-column layout:
 *   ┌──────────┬──────────────────┬──────────┐
 *   │ Palette  │      Canvas      │   Edit   │
 *   │ (w-64)   │     (flex-1)     │  (w-80)  │
 *   └──────────┴──────────────────┴──────────┘
 *
 * Header strip at the top for save / template / preview / status.
 *
 * Auto-save: a debounced effect fires `saveBlocks` 1500 ms after the last
 * `blocks` mutation. Manual "Opslaan" cancels that timer and saves now.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  AlertCircle,
  Save,
  Globe,
  Loader2,
  Check,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BlockPalette } from "@/components/career-builder/BlockPalette";
import { CanvasBlock } from "@/components/career-builder/CanvasBlock";
import { EditPanel } from "@/components/career-builder/EditPanel";
import { defaultBlockConfig, makeBlock } from "@/components/career-builder/defaults";
import { TEMPLATE_PRESETS, type BuilderTemplate } from "@/components/career-builder/templates";
import {
  useCareerPageWithBlocks,
  useUpdateBuilderBlocks,
} from "@/hooks/useCareerPageBuilder";
import type {
  CareerPageBlock,
  CareerPageBlockType,
  CareerPageBlockConfig,
} from "@/hooks/useCareerPages";
import type { Locale, PublicBranding, PublicJob } from "@/components/career-public/types";

const AUTOSAVE_DEBOUNCE_MS = 1500;

// Synthetic fixtures for the canvas-preview. These never leave the builder.
const PREVIEW_JOBS: PublicJob[] = [
  {
    id: "preview-1",
    title: "Senior Developer",
    department: "Engineering",
    location: "Amsterdam",
    description: "Bouw mee aan ons platform.",
    employment_type: "fulltime",
    salary_min: 65000,
    salary_max: 90000,
    salary_currency: "EUR",
    remote: false,
  },
  {
    id: "preview-2",
    title: "Recruitment Consultant",
    department: "Sales",
    location: "Den Haag",
    description: "Help klanten talent vinden.",
    employment_type: "fulltime",
    salary_min: 45000,
    salary_max: 60000,
    salary_currency: "EUR",
    remote: true,
  },
];

export default function CareerPageBuilderPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const router = useRouter();
  const { toast } = useToast();

  const { data: page, isLoading, isError } = useCareerPageWithBlocks(id);
  const { saveBlocks, isPending: isSaving } = useUpdateBuilderBlocks(id);

  // Local block state — hydrated from server, autosaves on change.
  const [blocks, setBlocks] = useState<CareerPageBlock[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [pendingTemplate, setPendingTemplate] = useState<BuilderTemplate | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocksRef = useRef<CareerPageBlock[]>([]);
  blocksRef.current = blocks;

  // Hydrate from server.
  useEffect(() => {
    if (page && !hydrated) {
      setBlocks(page.blocks ?? []);
      setHydrated(true);
    }
  }, [page, hydrated]);

  // Debounced auto-save (1500 ms after last change).
  useEffect(() => {
    if (!hydrated || !dirty) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void doSave();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, hydrated, dirty]);

  const doSave = async () => {
    try {
      await saveBlocks(blocksRef.current);
      setDirty(false);
      setLastSavedAt(Date.now());
    } catch {
      toast({
        title: "Opslaan mislukt",
        description: "Kon de wijzigingen niet opslaan. Probeer het opnieuw.",
        variant: "destructive",
      });
    }
  };

  const markDirty = (updater: (prev: CareerPageBlock[]) => CareerPageBlock[]) => {
    setBlocks((prev) => updater(prev));
    setDirty(true);
  };

  // ── Block manipulation ────────────────────────────────────────────────────

  const handleAddBlock = (type: CareerPageBlockType) => {
    const block = makeBlock(type);
    block.config = defaultBlockConfig(type);
    markDirty((prev) => [...prev, block]);
    setSelectedId(block.id);
  };

  const handleDeleteBlock = (blockId: string) => {
    markDirty((prev) => prev.filter((b) => b.id !== blockId));
    setSelectedId((curr) => (curr === blockId ? null : curr));
  };

  const handleUpdateConfig = (blockId: string, config: CareerPageBlockConfig) => {
    markDirty((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, config } : b))
    );
  };

  // ── Drag-drop ─────────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    markDirty((prev) => {
      const oldIndex = prev.findIndex((b) => b.id === active.id);
      const newIndex = prev.findIndex((b) => b.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  // ── Template apply ────────────────────────────────────────────────────────

  const applyTemplate = (templateId: BuilderTemplate) => {
    const preset = TEMPLATE_PRESETS.find((p) => p.id === templateId);
    if (!preset) return;
    markDirty(() => preset.build());
    setSelectedId(null);
    setPendingTemplate(null);
    toast({ title: `Template '${preset.label}' toegepast` });
  };

  // ── Preview branding ──────────────────────────────────────────────────────

  const branding: PublicBranding = useMemo(
    () => ({
      brand_name: page?.slug ?? "Bedrijf",
      logo_url: page?.config?.logo_url ?? null,
      primary_color: page?.config?.primary_color ?? "#6366f1",
      accent_color: null,
      font_family: page?.config?.font_family ?? "Inter",
    }),
    [page]
  );

  const previewLocale: Locale = (page?.language === "en" ? "en" : "nl");

  const selectedBlock = useMemo(
    () => blocks.find((b) => b.id === selectedId) ?? null,
    [blocks, selectedId]
  );

  // ── Render guards ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-12 w-1/2" />
        <div className="grid gap-4 md:grid-cols-[16rem_1fr_20rem]">
          <Skeleton className="h-[600px]" />
          <Skeleton className="h-[600px]" />
          <Skeleton className="h-[600px]" />
        </div>
      </div>
    );
  }

  if (isError || !page) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-20 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
          <AlertCircle className="h-6 w-6 text-red-600" />
        </div>
        <p className="text-base font-semibold">Career page niet gevonden</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => router.push("/career-pages")}
        >
          Terug naar overzicht
        </Button>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="-mx-6 -my-6 flex h-[calc(100vh-4rem)] flex-col">
      {/* Header strip */}
      <div className="flex items-center gap-3 border-b border-border bg-white px-4 py-3 dark:bg-zinc-950">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <Link href={`/career-pages/${id}`}>
            <ArrowLeft className="h-4 w-4" />
            Terug
          </Link>
        </Button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Builder · /{page.slug}
          </p>
          <SaveStatus
            isSaving={isSaving}
            dirty={dirty}
            lastSavedAt={lastSavedAt}
          />
        </div>
        <span className="ml-auto" />

        {/* Template picker */}
        <Select
          value=""
          onValueChange={(v) => setPendingTemplate(v as BuilderTemplate)}
        >
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="Template kiezen" />
          </SelectTrigger>
          <SelectContent>
            {TEMPLATE_PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Public preview */}
        <Button asChild variant="outline" size="icon" className="h-9 w-9" title="Bekijk publiek">
          <a href={`/careers/${page.slug}`} target="_blank" rel="noreferrer" aria-label="Bekijk publiek">
            <Globe className="h-4 w-4" />
          </a>
        </Button>

        {/* Manual save */}
        <Button
          onClick={() => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            void doSave();
          }}
          disabled={isSaving || !dirty}
          className="gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
        >
          <Save className="h-4 w-4" />
          {isSaving ? "Opslaan…" : "Sla op"}
        </Button>
      </div>

      {/* 3-column body */}
      <div className="flex flex-1 overflow-hidden">
        <BlockPalette onAddBlock={handleAddBlock} />

        <main className="flex-1 overflow-y-auto bg-zinc-100/50 p-6 dark:bg-zinc-900/40">
          {blocks.length === 0 ? (
            <EmptyCanvas onPickTemplate={() => setPendingTemplate("modern")} />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={blocks.map((b) => b.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="mx-auto flex max-w-3xl flex-col gap-4">
                  {blocks.map((block) => (
                    <CanvasBlock
                      key={block.id}
                      block={block}
                      selected={selectedId === block.id}
                      onSelect={() => setSelectedId(block.id)}
                      onDelete={() => handleDeleteBlock(block.id)}
                      branding={branding}
                      jobs={PREVIEW_JOBS}
                      locale={previewLocale}
                      slug={page.slug}
                      careerPageId={page.id}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </main>

        <EditPanel
          block={selectedBlock}
          onChange={(config) => {
            if (selectedBlock) handleUpdateConfig(selectedBlock.id, config);
          }}
          onDelete={() => {
            if (selectedBlock) handleDeleteBlock(selectedBlock.id);
          }}
          onClose={() => setSelectedId(null)}
        />
      </div>

      {/* Template confirm dialog */}
      <AlertDialog
        open={pendingTemplate !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTemplate(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Template toepassen?</AlertDialogTitle>
            <AlertDialogDescription>
              Dit vervangt alle huidige blokken op de pagina door de inhoud van
              het gekozen template. Deze actie kan niet ongedaan gemaakt worden
              tenzij je daarna opnieuw bewerkt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingTemplate(null)}>
              Annuleren
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingTemplate && applyTemplate(pendingTemplate)}
            >
              Vervang blokken
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Save indicator ──────────────────────────────────────────────────────────

function SaveStatus({
  isSaving,
  dirty,
  lastSavedAt,
}: {
  isSaving: boolean;
  dirty: boolean;
  lastSavedAt: number | null;
}) {
  if (isSaving) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Bezig met opslaan…
      </span>
    );
  }
  if (dirty) {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
        Niet-opgeslagen wijzigingen
      </span>
    );
  }
  if (lastSavedAt) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-emerald-600">
        <Check className="h-3 w-3" />
        Opgeslagen
      </span>
    );
  }
  return (
    <span className="text-[11px] text-muted-foreground">
      Klaar om te bouwen
    </span>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyCanvas({ onPickTemplate }: { onPickTemplate: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zinc-300 bg-white/60 p-12 text-center">
      <p className="text-base font-semibold text-zinc-900">
        Nog geen blokken
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Voeg blokken toe vanuit het palet links — of start met een template.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={onPickTemplate}
      >
        Begin met template
      </Button>
    </div>
  );
}
