"use client";

/**
 * Report builder — drag-drop config editor.
 *
 * Layout (3 columns):
 *   ┌──────────┬──────────────────┬──────────┐
 *   │ Palette  │      Canvas      │   Edit   │
 *   │ (w-72)   │     (flex-1)     │  (w-96)  │
 *   └──────────┴──────────────────┴──────────┘
 *
 * Header strip: name (inline edit), date-range, Save, Run, Embed dropdown.
 * Run-result is stored locally and passed to each block-renderer.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  Link as LinkIcon,
  Loader2,
  Play,
  Save,
  Trash2,
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { BlockPalette } from "@/components/reports/BlockPalette";
import { CanvasBlock } from "@/components/reports/CanvasBlock";
import { EditPanel } from "@/components/reports/EditPanel";
import { TemplateLoader } from "@/components/reports/TemplateLoader";
import { DateRangeSelector } from "@/components/reports/DateRangeSelector";
import { makeBlock } from "@/components/reports/defaults";
import {
  useGenerateEmbedToken,
  useReport,
  useReportDimensions,
  useReportMetrics,
  useReportTemplates,
  useRevokeEmbedToken,
  useRunReport,
  useUpdateReport,
} from "@/hooks/useReports";
import type {
  BlockConfig,
  BlockResult,
  BlockType,
  ReportBlock,
  ReportConfig,
  SystemTemplate,
} from "@/lib/types/reports";

export default function ReportBuilderPage() {
  const { t } = useTranslation("reportsPage");
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const { data: report, isLoading, isError } = useReport(id);
  const { data: metrics } = useReportMetrics();
  const { data: dimensions } = useReportDimensions();
  const { data: templates } = useReportTemplates();
  const updateReport = useUpdateReport();
  const runReport = useRunReport(id);
  const generateEmbed = useGenerateEmbedToken();
  const revokeEmbed = useRevokeEmbedToken();

  // Local mutable state — hydrated from server.
  const [name, setName] = useState("");
  const [config, setConfig] = useState<ReportConfig>({
    date_range: { preset: "last_30_days" },
    blocks: [],
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [results, setResults] = useState<Record<string, BlockResult>>({});
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<SystemTemplate | null>(null);
  const [embedDialogOpen, setEmbedDialogOpen] = useState(false);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);

  // Hydrate from server.
  useEffect(() => {
    if (report && !hydrated) {
      setName(report.name);
      setConfig(report.config);
      setHydrated(true);
      // Auto-run when ?view=run
      if (searchParams.get("view") === "run") {
        // Run on next tick so report is loaded.
        setTimeout(() => doRun(), 0);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, hydrated]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const markDirty = (mut: () => void) => {
    mut();
    setDirty(true);
  };

  const handleSave = async () => {
    try {
      await updateReport.mutateAsync({ id, name, config });
      setDirty(false);
      toast({ title: t("builder.toasts.saved") });
    } catch {
      toast({ title: t("builder.toasts.saveError"), variant: "destructive" });
    }
  };

  const doRun = async () => {
    try {
      const res = await runReport.mutateAsync();
      const map: Record<string, BlockResult> = {};
      res.blocks.forEach((b) => {
        map[b.block_id] = b;
      });
      setResults(map);
      setRanAt(res.ran_at);
    } catch {
      toast({ title: t("builder.toasts.runError"), variant: "destructive" });
    }
  };

  // ── Block manipulation ────────────────────────────────────────────────────

  const handleAddBlock = (type: BlockType) => {
    const b = makeBlock(type);
    markDirty(() => setConfig((c) => ({ ...c, blocks: [...c.blocks, b] })));
    setSelectedId(b.id);
  };

  const handleDeleteBlock = (blockId: string) => {
    markDirty(() =>
      setConfig((c) => ({
        ...c,
        blocks: c.blocks.filter((b) => b.id !== blockId),
      }))
    );
    setSelectedId((cur) => (cur === blockId ? null : cur));
  };

  const handleUpdateTitle = (blockId: string, title: string) => {
    markDirty(() =>
      setConfig((c) => ({
        ...c,
        blocks: c.blocks.map((b) => (b.id === blockId ? { ...b, title } : b)),
      }))
    );
  };

  const handleUpdateConfig = (blockId: string, blockConfig: BlockConfig) => {
    markDirty(() =>
      setConfig((c) => ({
        ...c,
        blocks: c.blocks.map((b) =>
          b.id === blockId ? ({ ...b, config: blockConfig } as ReportBlock) : b
        ),
      }))
    );
  };

  const handleApplyTemplate = (tpl: SystemTemplate) => {
    markDirty(() => {
      // Re-id blocks so they don't collide with previous results / drag IDs.
      const reidBlocks = tpl.config.blocks.map((b) => ({
        ...b,
        id: `blk-${Math.random().toString(36).slice(2, 10)}`,
        config: { ...b.config },
      }));
      setConfig({
        date_range: tpl.config.date_range,
        blocks: reidBlocks,
        filters: tpl.config.filters,
      });
    });
    setResults({});
    setRanAt(null);
    setSelectedId(null);
    setTemplateModalOpen(false);
    setPendingTemplate(null);
    toast({ title: t("builder.toasts.templateApplied", { name: tpl.name }) });
  };

  // ── Drag-drop ─────────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    markDirty(() =>
      setConfig((c) => {
        const oldI = c.blocks.findIndex((b) => b.id === active.id);
        const newI = c.blocks.findIndex((b) => b.id === over.id);
        if (oldI < 0 || newI < 0) return c;
        return { ...c, blocks: arrayMove(c.blocks, oldI, newI) };
      })
    );
  };

  // ── Embed ─────────────────────────────────────────────────────────────────

  const handleGenerateEmbed = async () => {
    try {
      const res = await generateEmbed.mutateAsync(id);
      setEmbedUrl(res.url);
      setEmbedDialogOpen(true);
    } catch {
      toast({ title: t("builder.toasts.embedError"), variant: "destructive" });
    }
  };

  const handleRevokeEmbed = async () => {
    try {
      await revokeEmbed.mutateAsync(id);
      setEmbedDialogOpen(false);
      toast({ title: t("builder.toasts.revoked") });
    } catch {
      toast({ title: t("builder.toasts.revokeError"), variant: "destructive" });
    }
  };

  // ── Selectors ─────────────────────────────────────────────────────────────

  const selectedBlock = useMemo(
    () => config.blocks.find((b) => b.id === selectedId) ?? null,
    [config.blocks, selectedId]
  );

  // ── Loading / error ───────────────────────────────────────────────────────

  if (isLoading || !hydrated) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-12 w-1/2" />
        <div className="grid gap-4 md:grid-cols-[18rem_1fr_24rem]">
          <Skeleton className="h-[600px]" />
          <Skeleton className="h-[600px]" />
          <Skeleton className="h-[600px]" />
        </div>
      </div>
    );
  }

  if (isError || !report) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-20 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
          <AlertCircle className="h-6 w-6 text-red-600" />
        </div>
        <p className="text-base font-semibold">{t("builder.loadError.title")}</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/reports")}>
          {t("builder.loadError.back")}
        </Button>
      </div>
    );
  }

  return (
    <div className="-mx-6 -my-6 flex h-[calc(100vh-4rem)] flex-col">
      {/* Header strip */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-white px-4 py-3 dark:bg-zinc-950">
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link href="/reports">
            <ArrowLeft className="h-4 w-4" />
            {t("builder.header.back")}
          </Link>
        </Button>
        <div className="min-w-0 flex-1 max-w-md">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            className="h-9 border-transparent bg-transparent text-base font-semibold hover:border-zinc-200 focus:border-zinc-300 focus:bg-white dark:hover:border-zinc-700 dark:focus:bg-zinc-900"
            placeholder={t("builder.header.namePlaceholder")}
          />
          <SaveStatus
            isSaving={updateReport.isPending}
            dirty={dirty}
            ranAt={ranAt}
          />
        </div>

        <DateRangeSelector
          value={config.date_range}
          onChange={(date_range) => {
            setConfig((c) => ({ ...c, date_range }));
            setDirty(true);
          }}
        />

        <Button
          onClick={doRun}
          disabled={runReport.isPending || config.blocks.length === 0}
          variant="outline"
          className="gap-2"
        >
          {runReport.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {t("builder.header.run")}
        </Button>

        <Button
          onClick={handleSave}
          disabled={updateReport.isPending || !dirty}
          className="gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
        >
          <Save className="h-4 w-4" />
          {updateReport.isPending
            ? t("builder.header.saving")
            : t("builder.header.save")}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2">
              <LinkIcon className="h-4 w-4" />
              {t("builder.header.embed")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>{t("builder.embedMenu.label")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {report.embed_enabled && report.embed_token ? (
              <>
                <DropdownMenuItem
                  onClick={() => {
                    const url =
                      typeof window !== "undefined"
                        ? `${window.location.origin}/embed/reports/${report.embed_token}`
                        : `/embed/reports/${report.embed_token}`;
                    setEmbedUrl(url);
                    setEmbedDialogOpen(true);
                  }}
                >
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  {t("builder.embedMenu.showLink")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleRevokeEmbed}
                  className="text-red-600"
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  {t("builder.embedMenu.revoke")}
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onClick={handleGenerateEmbed}>
                <LinkIcon className="mr-2 h-3.5 w-3.5" />
                {t("builder.embedMenu.generate")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 3-column body */}
      <div className="flex flex-1 overflow-hidden">
        <BlockPalette
          onAddBlock={handleAddBlock}
          onPickTemplate={(tpl) => setPendingTemplate(tpl)}
          templates={templates}
        />

        <main className="flex-1 overflow-y-auto bg-zinc-100/50 p-6 dark:bg-zinc-900/40">
          {config.blocks.length === 0 ? (
            <EmptyCanvas onPickTemplate={() => setTemplateModalOpen(true)} />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={config.blocks.map((b) => b.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="mx-auto flex max-w-4xl flex-col gap-4">
                  {config.blocks.map((block) => (
                    <CanvasBlock
                      key={block.id}
                      block={block}
                      result={results[block.id]}
                      selected={selectedId === block.id}
                      onSelect={() => setSelectedId(block.id)}
                      onDelete={() => handleDeleteBlock(block.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </main>

        <EditPanel
          block={selectedBlock}
          metrics={metrics ?? []}
          dimensions={dimensions ?? []}
          onChangeTitle={(t) =>
            selectedBlock && handleUpdateTitle(selectedBlock.id, t)
          }
          onChangeConfig={(c) =>
            selectedBlock && handleUpdateConfig(selectedBlock.id, c)
          }
          onDelete={() => selectedBlock && handleDeleteBlock(selectedBlock.id)}
          onClose={() => setSelectedId(null)}
        />
      </div>

      {/* Template loader (modal) */}
      <TemplateLoader
        open={templateModalOpen || pendingTemplate !== null}
        templates={templates}
        onClose={() => {
          setTemplateModalOpen(false);
          setPendingTemplate(null);
        }}
        onApply={handleApplyTemplate}
      />

      {/* Embed link dialog */}
      <AlertDialog open={embedDialogOpen} onOpenChange={setEmbedDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("builder.embedDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("builder.embedDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {embedUrl && (
            <div className="flex items-center gap-2 rounded-md border bg-zinc-50 px-3 py-2 text-xs dark:bg-zinc-900">
              <LinkIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <code className="flex-1 truncate font-mono">{embedUrl}</code>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => {
                  if (typeof navigator !== "undefined" && navigator.clipboard) {
                    navigator.clipboard.writeText(embedUrl);
                    toast({ title: t("builder.toasts.copied") });
                  }
                }}
              >
                {t("builder.embedDialog.copy")}
              </Button>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("builder.embedDialog.close")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={handleRevokeEmbed}
            >
              {t("builder.embedDialog.revoke")}
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
  ranAt,
}: {
  isSaving: boolean;
  dirty: boolean;
  ranAt: string | null;
}) {
  const { t } = useTranslation("reportsPage");
  if (isSaving) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("builder.saveStatus.saving")}
      </span>
    );
  }
  if (dirty) {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
        {t("builder.saveStatus.unsaved")}
      </span>
    );
  }
  if (ranAt) {
    const ts = new Date(ranAt).toLocaleString("nl-NL");
    return (
      <span className="flex items-center gap-1 text-[11px] text-emerald-600">
        <Check className="h-3 w-3" />
        {t("builder.saveStatus.lastRun", { date: ts })}
      </span>
    );
  }
  return (
    <span className="text-[11px] text-muted-foreground">
      {t("builder.saveStatus.ready")}
    </span>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyCanvas({ onPickTemplate }: { onPickTemplate: () => void }) {
  const { t } = useTranslation("reportsPage");
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zinc-300 bg-white/60 p-12 text-center dark:border-zinc-700 dark:bg-zinc-950/40">
      <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
        {t("builder.emptyCanvas.title")}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("builder.emptyCanvas.description")}
      </p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onPickTemplate}>
        {t("builder.emptyCanvas.startWithTemplate")}
      </Button>
    </div>
  );
}
