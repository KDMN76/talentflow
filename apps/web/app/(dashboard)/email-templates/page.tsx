"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Eye,
  FileText,
  Mail,
  Pencil,
  Plus,
  Trash2,
  Variable,
} from "lucide-react";
import {
  applyMergeVariables,
  extractMergeVariables,
  type CreateEmailTemplateInput,
  type EmailTemplate,
  type EmailTemplateCategory,
} from "@talentflow/shared";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useToast } from "@/components/ui/use-toast";
import {
  useCreateEmailTemplate,
  useDeleteEmailTemplate,
  useEmailTemplates,
  useUpdateEmailTemplate,
} from "@/hooks/useEmailTemplates";

// ─── Constants ──────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<EmailTemplateCategory, string> = {
  invite: "Uitnodigingen",
  reject: "Afwijzingen",
  offer: "Aanbiedingen",
  general: "Algemeen",
};

const CATEGORY_BADGE_COLORS: Record<string, string> = {
  invite:
    "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-800",
  reject:
    "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800",
  offer:
    "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800",
  general:
    "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
};

const PREVIEW_CONTEXT = {
  candidate: { first_name: "Jan", last_name: "de Vries", full_name: "Jan de Vries", email: "jan@example.nl" },
  job: { title: "Senior Developer" },
  recruiter: { name: "Angelo Valentijn" },
  tenant: { name: "IT Proposal" },
};

const TAB_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Alle" },
  { value: "invite", label: CATEGORY_LABELS.invite },
  { value: "reject", label: CATEGORY_LABELS.reject },
  { value: "offer", label: CATEGORY_LABELS.offer },
  { value: "general", label: CATEGORY_LABELS.general },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category as EmailTemplateCategory] ?? category;
}

function categoryBadgeClass(category: string): string {
  return CATEGORY_BADGE_COLORS[category] ?? CATEGORY_BADGE_COLORS.general;
}

// ─── Editor dialog ──────────────────────────────────────────────────────────

interface EditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: EmailTemplate;
}

function EditorDialog({ open, onOpenChange, initial }: EditorDialogProps) {
  const { toast } = useToast();
  const create = useCreateEmailTemplate();
  const update = useUpdateEmailTemplate();

  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState<string>(initial?.category ?? "invite");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [bodyHtml, setBodyHtml] = useState(initial?.body_html ?? "");
  const [bodyText, setBodyText] = useState(initial?.body_text ?? "");
  const [showPreview, setShowPreview] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset state on open / template switch
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setCategory(initial?.category ?? "invite");
    setSubject(initial?.subject ?? "");
    setBodyHtml(initial?.body_html ?? "");
    setBodyText(initial?.body_text ?? "");
    setShowPreview(false);
    setErrors({});
  }, [open, initial]);

  const detectedVars = useMemo(
    () => extractMergeVariables(`${subject}\n${bodyHtml}\n${bodyText ?? ""}`),
    [subject, bodyHtml, bodyText]
  );

  const subjectPreview = applyMergeVariables(subject, PREVIEW_CONTEXT);
  const bodyPreview = applyMergeVariables(bodyHtml, PREVIEW_CONTEXT);

  const handleSave = async () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Naam is verplicht";
    if (!subject.trim()) newErrors.subject = "Onderwerp is verplicht";
    if (!bodyHtml.trim()) newErrors.body_html = "Bericht mag niet leeg zijn";
    if (Object.keys(newErrors).length) {
      setErrors(newErrors);
      return;
    }

    const payload: CreateEmailTemplateInput = {
      name: name.trim(),
      category,
      subject: subject.trim(),
      body_html: bodyHtml,
      body_text: bodyText.trim() ? bodyText : null,
      merge_variables: detectedVars,
    };

    try {
      if (initial) {
        await update.mutateAsync({ id: initial.id, ...payload });
        toast({
          title: "Template bijgewerkt",
          description: `"${payload.name}" is succesvol opgeslagen.`,
        });
      } else {
        await create.mutateAsync(payload);
        toast({
          title: "Template aangemaakt",
          description: `"${payload.name}" is toegevoegd.`,
        });
      }
      onOpenChange(false);
    } catch {
      toast({
        title: "Opslaan mislukt",
        description: "Er ging iets mis. Probeer het opnieuw.",
        variant: "destructive",
      });
    }
  };

  const isPending = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {initial ? "Template bewerken" : "Nieuw e-mailtemplate"}
          </DialogTitle>
          <DialogDescription>
            Gebruik {"{{candidate.first_name}}"}, {"{{job.title}}"} of{" "}
            {"{{recruiter.name}}"} voor automatische personalisatie.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Name + category */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="tpl-name">Naam</Label>
              <Input
                id="tpl-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (errors.name) setErrors((p) => ({ ...p, name: "" }));
                }}
                placeholder="Bijv. Uitnodiging eerste interview"
              />
              {errors.name && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.name}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-category">Categorie</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="tpl-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="invite">{CATEGORY_LABELS.invite}</SelectItem>
                  <SelectItem value="reject">{CATEGORY_LABELS.reject}</SelectItem>
                  <SelectItem value="offer">{CATEGORY_LABELS.offer}</SelectItem>
                  <SelectItem value="general">{CATEGORY_LABELS.general}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Subject */}
          <div className="space-y-1.5">
            <Label htmlFor="tpl-subject">Onderwerp</Label>
            <Input
              id="tpl-subject"
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                if (errors.subject) setErrors((p) => ({ ...p, subject: "" }));
              }}
              placeholder="Bijv. Uitnodiging gesprek - {{job.title}}"
            />
            {errors.subject && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.subject}
              </p>
            )}
          </div>

          {/* Body HTML */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="tpl-body">Bericht (HTML)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => setShowPreview((p) => !p)}
              >
                <Eye className="h-3.5 w-3.5" />
                {showPreview ? "Preview verbergen" : "Live preview"}
              </Button>
            </div>
            <textarea
              id="tpl-body"
              value={bodyHtml}
              onChange={(e) => {
                setBodyHtml(e.target.value);
                if (errors.body_html) setErrors((p) => ({ ...p, body_html: "" }));
              }}
              rows={10}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition resize-y"
              placeholder="<p>Beste {{candidate.first_name}}…</p>"
            />
            {errors.body_html && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.body_html}
              </p>
            )}
          </div>

          {/* Body text fallback */}
          <div className="space-y-1.5">
            <Label htmlFor="tpl-body-text">
              Plain text fallback{" "}
              <span className="text-xs text-muted-foreground font-normal">
                (optioneel)
              </span>
            </Label>
            <textarea
              id="tpl-body-text"
              value={bodyText ?? ""}
              onChange={(e) => setBodyText(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition resize-y"
              placeholder="Plain-text versie voor clients die HTML blokkeren…"
            />
          </div>

          {/* Detected merge vars */}
          {detectedVars.length > 0 && (
            <div className="rounded-lg border border-dashed border-indigo-200 bg-indigo-50/40 dark:border-indigo-800 dark:bg-indigo-950/20 p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Variable className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                  Gedetecteerde variabelen
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {detectedVars.map((v) => (
                  <Badge
                    key={v}
                    variant="outline"
                    className="font-mono text-[10px] py-0.5 px-1.5"
                  >
                    {v}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Preview */}
          {showPreview && (
            <div className="rounded-lg border border-border bg-zinc-50 dark:bg-zinc-900/40 overflow-hidden">
              <div className="border-b border-border bg-white dark:bg-zinc-900 px-4 py-3 space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Preview met testdata
                </p>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {subjectPreview || (
                    <span className="text-muted-foreground italic font-normal">
                      Geen onderwerp
                    </span>
                  )}
                </p>
              </div>
              <div
                className="prose prose-sm dark:prose-invert max-w-none px-4 py-4 bg-white dark:bg-zinc-900 text-sm text-zinc-800 dark:text-zinc-200"
                /* eslint-disable-next-line react/no-danger -- preview only, recruiter-authored */
                dangerouslySetInnerHTML={{
                  __html:
                    bodyPreview ||
                    '<p class="text-muted-foreground italic">Begin met typen…</p>',
                }}
              />
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Annuleren
          </Button>
          <Button
            onClick={handleSave}
            disabled={isPending}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
          >
            {isPending ? "Opslaan…" : "Opslaan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Template card ──────────────────────────────────────────────────────────

interface TemplateCardProps {
  template: EmailTemplate;
  onEdit: (t: EmailTemplate) => void;
  onDelete: (t: EmailTemplate) => void;
}

function TemplateCard({ template, onEdit, onDelete }: TemplateCardProps) {
  const previewLine = useMemo(
    () => stripHtml(template.body_html).slice(0, 140),
    [template.body_html]
  );

  return (
    <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base font-semibold truncate">
              {template.name}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {template.subject}
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${categoryBadgeClass(
              template.category
            )}`}
          >
            {categoryLabel(template.category)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-snug">
          {previewLine || (
            <span className="italic text-muted-foreground">Geen inhoud</span>
          )}
          {previewLine.length === 140 && "…"}
        </p>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Variable className="h-3 w-3" />
            <span>
              {template.merge_variables.length}{" "}
              {template.merge_variables.length === 1 ? "variabele" : "variabelen"}
            </span>
          </div>
          <span>
            Bijgewerkt:{" "}
            {new Date(template.updated_at).toLocaleDateString("nl-NL", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => onEdit(template)}
          >
            <Pencil className="h-3.5 w-3.5" />
            Bewerken
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-red-50 dark:hover:bg-red-950/30"
            onClick={() => onDelete(template)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Verwijderen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function EmailTemplatesPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string>("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<EmailTemplate | undefined>(undefined);
  const [deleting, setDeleting] = useState<EmailTemplate | undefined>(undefined);

  const { data: templates, isLoading } = useEmailTemplates();
  const deleteTemplate = useDeleteEmailTemplate();

  const filtered = useMemo(() => {
    if (!templates) return [];
    if (activeTab === "all") return templates;
    return templates.filter((t) => t.category === activeTab);
  }, [templates, activeTab]);

  const handleNew = () => {
    setEditing(undefined);
    setEditorOpen(true);
  };

  const handleEdit = (t: EmailTemplate) => {
    setEditing(t);
    setEditorOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deleting) return;
    try {
      await deleteTemplate.mutateAsync(deleting.id);
      toast({
        title: "Template verwijderd",
        description: `"${deleting.name}" is verwijderd.`,
      });
    } catch {
      toast({
        title: "Verwijderen mislukt",
        description: "Probeer het opnieuw.",
        variant: "destructive",
      });
    } finally {
      setDeleting(undefined);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="E-mail templates"
        description="Beheer herbruikbare e-mailteksten met merge-variabelen"
        actions={
          <Button
            onClick={handleNew}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0 gap-2"
          >
            <Plus className="h-4 w-4" />
            Nieuw template
          </Button>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          {TAB_FILTERS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-44 rounded-xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-20 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800 mb-4">
                <Mail className="h-8 w-8 text-zinc-400" />
              </div>
              <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Geen templates in deze categorie
              </p>
              <p className="text-sm text-muted-foreground mt-1 mb-5">
                Maak een nieuw template om consistent te communiceren met
                kandidaten.
              </p>
              <Button
                onClick={handleNew}
                className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0 gap-2"
              >
                <Plus className="h-4 w-4" />
                Eerste template
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((tpl) => (
                <TemplateCard
                  key={tpl.id}
                  template={tpl}
                  onEdit={handleEdit}
                  onDelete={setDeleting}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Editor */}
      <EditorDialog
        key={editing?.id ?? "new"}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initial={editing}
      />

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/40">
                <FileText className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <AlertDialogTitle>Template verwijderen</AlertDialogTitle>
            </div>
            <AlertDialogDescription>
              Weet je zeker dat je{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                &quot;{deleting?.name}&quot;
              </span>{" "}
              wilt verwijderen? Dit kan niet ongedaan worden gemaakt en
              workflows die dit template gebruiken zullen niet meer werken.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteTemplate.isPending}>
              Annuleren
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deleteTemplate.isPending}
            >
              {deleteTemplate.isPending ? "Verwijderen…" : "Verwijderen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
