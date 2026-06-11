"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Globe,
  ExternalLink,
  Settings2,
  Trash2,
  AlertCircle,
  Eye,
  FileText,
  Sparkles,
  Power,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  useCareerPages,
  useCreateCareerPage,
  useUpdateCareerPage,
  useDeleteCareerPage,
  TEMPLATE_LABELS,
  LANGUAGE_LABELS,
  LANGUAGE_FLAGS,
  type CareerPage,
  type CareerPageTemplate,
  type CareerPageLanguage,
} from "@/hooks/useCareerPages";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEMPLATES: CareerPageTemplate[] = ["modern", "classic", "minimal", "tech", "creative"];
const LANGUAGES: CareerPageLanguage[] = ["nl", "en", "de", "fr", "es"];

// ─── TemplatePreview ─────────────────────────────────────────────────────────

function TemplatePreview({
  template,
  primaryColor,
  headerText,
}: {
  template: CareerPageTemplate;
  primaryColor: string;
  headerText?: string;
}) {
  const { t } = useTranslation("careerPages");
  const baseHeader = headerText || t("preview.defaultHeader");

  if (template === "minimal") {
    return (
      <div className="relative h-32 w-full overflow-hidden rounded-lg border bg-white dark:bg-zinc-900">
        <div className="flex h-full flex-col items-start justify-end gap-1 p-4">
          <div
            className="h-1 w-10 rounded-full"
            style={{ backgroundColor: primaryColor }}
          />
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 line-clamp-1">
            {baseHeader}
          </p>
          <p className="text-[10px] text-muted-foreground">{t("preview.minimal")}</p>
        </div>
      </div>
    );
  }

  if (template === "classic") {
    return (
      <div className="relative h-32 w-full overflow-hidden rounded-lg border bg-zinc-50 dark:bg-zinc-900">
        <div
          className="h-2 w-full"
          style={{ backgroundColor: primaryColor }}
        />
        <div className="p-4">
          <p
            className="text-sm font-serif font-semibold line-clamp-1"
            style={{ color: primaryColor }}
          >
            {baseHeader}
          </p>
          <p className="mt-1 text-[10px] text-zinc-500">{t("preview.classic")}</p>
        </div>
      </div>
    );
  }

  if (template === "tech") {
    return (
      <div
        className="relative h-32 w-full overflow-hidden rounded-lg border"
        style={{
          background: `linear-gradient(135deg, #0f172a, ${primaryColor}25 60%, #0f172a)`,
        }}
      >
        <div className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)",
            backgroundSize: "12px 12px",
          }}
        />
        <div className="relative flex h-full flex-col justify-end p-4">
          <p className="font-mono text-[10px] text-emerald-400">$ careers --hire</p>
          <p className="mt-1 text-sm font-semibold text-white line-clamp-1">
            {baseHeader}
          </p>
        </div>
      </div>
    );
  }

  if (template === "creative") {
    return (
      <div
        className="relative h-32 w-full overflow-hidden rounded-lg border"
        style={{
          background: `radial-gradient(circle at 20% 20%, ${primaryColor}, transparent 50%), radial-gradient(circle at 80% 80%, ${primaryColor}80, white 70%)`,
        }}
      >
        <div className="relative flex h-full flex-col justify-end p-4">
          <p className="text-sm font-bold text-white drop-shadow line-clamp-1">
            {baseHeader}
          </p>
          <p className="text-[10px] text-white/80">{t("preview.creative")}</p>
        </div>
      </div>
    );
  }

  // modern (default)
  return (
    <div
      className="relative h-32 w-full overflow-hidden rounded-lg border"
      style={{
        background: `linear-gradient(135deg, ${primaryColor}, ${primaryColor}cc)`,
      }}
    >
      <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-white/15" />
      <div className="absolute -bottom-4 -left-4 h-16 w-16 rounded-full bg-white/10" />
      <div className="relative flex h-full flex-col justify-end p-4">
        <p className="text-sm font-semibold text-white drop-shadow line-clamp-1">
          {baseHeader}
        </p>
        <p className="text-[10px] text-white/80">{t("preview.modern")}</p>
      </div>
    </div>
  );
}

// ─── Career Page Card ────────────────────────────────────────────────────────

function CareerPageCard({ page }: { page: CareerPage }) {
  const { t } = useTranslation("careerPages");
  const updatePage = useUpdateCareerPage();
  const deletePage = useDeleteCareerPage();
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleToggleActive = () => {
    updatePage.mutate(
      { id: page.id, active: !page.active },
      {
        onSuccess: () => {
          toast({
            title: page.active
              ? t("card.toasts.deactivated.title")
              : t("card.toasts.activated.title"),
            description: page.active
              ? t("card.toasts.statusOffline", { slug: page.slug })
              : t("card.toasts.statusLive", { slug: page.slug }),
          });
        },
      }
    );
  };

  const handleDelete = () => {
    deletePage.mutate(page.id, {
      onSuccess: () => {
        toast({
          title: t("card.toasts.deleted.title"),
          description: t("card.toasts.deleted.description", { slug: page.slug }),
        });
        setConfirmDelete(false);
      },
    });
  };

  const primaryColor = page.config.primary_color ?? "#6366f1";

  return (
    <>
      <Card className="group overflow-hidden border-0 shadow-sm hover:shadow-md transition-all duration-200">
        <CardContent className="p-0">
          {/* Preview */}
          <div className="p-4 pb-0">
            <TemplatePreview
              template={page.template}
              primaryColor={primaryColor}
              headerText={page.config.header_text}
            />
          </div>

          {/* Body */}
          <div className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[18px] leading-none">
                    {LANGUAGE_FLAGS[page.language]}
                  </span>
                  <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                    /{page.slug}
                  </h3>
                  {page.active ? (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                      {t("card.live")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {t("card.offline")}
                    </span>
                  )}
                </div>
                {page.custom_domain ? (
                  <a
                    href={`https://${page.custom_domain}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline truncate"
                  >
                    <Globe className="h-3 w-3 shrink-0" />
                    <span className="truncate">{page.custom_domain}</span>
                  </a>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("card.noCustomDomain", {
                      template: TEMPLATE_LABELS[page.template],
                    })}
                  </p>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Eye className="h-3.5 w-3.5" />
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {page.visit_count.toLocaleString("nl-NL")}
                </span>
                <span>{t("card.visits")}</span>
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {page.application_count}
                </span>
                <span>{t("card.applications")}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <Button
                asChild
                size="sm"
                className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0 gap-1.5"
              >
                <Link href={`/career-pages/${page.id}`}>
                  <Settings2 className="h-3.5 w-3.5" />
                  {t("card.edit")}
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="gap-1.5"
                title={t("card.openPublicPage")}
              >
                <a
                  href={`/careers/${page.slug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleActive}
                disabled={updatePage.isPending}
                title={page.active ? t("card.deactivate") : t("card.activate")}
                className={
                  page.active
                    ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400"
                    : ""
                }
              >
                <Power className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                className="text-destructive hover:text-destructive hover:bg-red-50 dark:hover:bg-red-950/30"
                title={t("card.delete")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/40 mb-2">
              <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <DialogTitle>{t("card.deleteDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("card.deleteDialog.descriptionBefore")}{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                /{page.slug}
              </span>
              {t("card.deleteDialog.descriptionAfter")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2">
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={deletePage.isPending}
            >
              {t("card.deleteDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deletePage.isPending}
            >
              {deletePage.isPending
                ? t("card.deleteDialog.deleting")
                : t("card.deleteDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Create Dialog ───────────────────────────────────────────────────────────

function CreateCareerPageDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("careerPages");
  const { toast } = useToast();
  const createPage = useCreateCareerPage();

  const [slug, setSlug] = useState("");
  const [template, setTemplate] = useState<CareerPageTemplate>("modern");
  const [language, setLanguage] = useState<CareerPageLanguage>("nl");
  const [primaryColor, setPrimaryColor] = useState("#6366f1");

  const reset = () => {
    setSlug("");
    setTemplate("modern");
    setLanguage("nl");
    setPrimaryColor("#6366f1");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSave = async () => {
    const cleanSlug = slug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    if (!cleanSlug) {
      toast({
        title: t("createDialog.toasts.slugRequired.title"),
        description: t("createDialog.toasts.slugRequired.description"),
        variant: "destructive",
      });
      return;
    }

    try {
      await createPage.mutateAsync({
        slug: cleanSlug,
        template,
        language,
        primary_color: primaryColor,
      });
      toast({
        title: t("createDialog.toasts.created.title"),
        description: t("createDialog.toasts.created.description", {
          slug: cleanSlug,
        }),
      });
      handleClose();
    } catch {
      toast({
        title: t("createDialog.toasts.error.title"),
        description: t("createDialog.toasts.error.description"),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Nieuwe career page</DialogTitle>
          <DialogDescription>
            Maak een publieke vacaturepagina met automatische ATS-koppeling.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="cp-slug">
              Slug <span className="text-destructive">*</span>
            </Label>
            <div className="flex items-center rounded-lg border border-input bg-background overflow-hidden focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1">
              <span className="px-3 py-2 text-sm text-muted-foreground bg-muted border-r border-input">
                /careers/
              </span>
              <input
                id="cp-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="kdmn"
                className="flex-1 px-3 py-2 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                autoFocus
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Alleen kleine letters, cijfers en streepjes.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cp-template">Template</Label>
              <Select
                value={template}
                onValueChange={(v) => setTemplate(v as CareerPageTemplate)}
              >
                <SelectTrigger id="cp-template">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TEMPLATE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cp-language">Taal</Label>
              <Select
                value={language}
                onValueChange={(v) => setLanguage(v as CareerPageLanguage)}
              >
                <SelectTrigger id="cp-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {LANGUAGE_FLAGS[l]} {LANGUAGE_LABELS[l]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cp-color">Hoofdkleur</Label>
            <div className="flex items-center gap-3">
              <input
                id="cp-color"
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded-lg border border-input bg-background p-1"
              />
              <Input
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="font-mono text-sm flex-1"
              />
            </div>
          </div>

          {/* Live preview */}
          <div className="space-y-2">
            <Label>Voorbeeld</Label>
            <TemplatePreview
              template={template}
              primaryColor={primaryColor}
              headerText="Werk bij ons"
            />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={handleClose}>
            Annuleren
          </Button>
          <Button
            onClick={handleSave}
            disabled={!slug.trim() || createPage.isPending}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
          >
            {createPage.isPending ? "Aanmaken…" : "Career page aanmaken"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CareerPagesPage() {
  const { data: pages, isLoading } = useCareerPages();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Career Pages"
        description="Bouw publieke vacaturepagina's met automatische ATS-koppeling"
        actions={
          <Button
            onClick={() => setIsCreateOpen(true)}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0 gap-2"
          >
            <Plus className="h-4 w-4" />
            Nieuwe career page
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72 w-full rounded-xl" />
          ))}
        </div>
      ) : !pages || pages.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-20 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 mb-4 shadow-sm">
            <Sparkles className="h-8 w-8 text-white" />
          </div>
          <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Nog geen career pages
          </p>
          <p className="text-sm text-muted-foreground mt-1 mb-5 max-w-sm">
            Lanceer je eerste publieke vacaturepagina. Bezoekers solliciteren
            direct in jouw ATS — zonder tussenstappen.
          </p>
          <Button
            onClick={() => setIsCreateOpen(true)}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0 gap-2"
          >
            <Plus className="h-4 w-4" />
            Eerste career page
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {pages.map((page) => (
            <CareerPageCard key={page.id} page={page} />
          ))}
        </div>
      )}

      <CreateCareerPageDialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </div>
  );
}
