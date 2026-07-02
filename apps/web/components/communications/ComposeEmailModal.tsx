"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Eye,
  Mail,
  Send,
  Variable,
  X,
} from "lucide-react";
import { z } from "zod";
import {
  applyMergeVariables,
  type EmailTemplate,
} from "@talentflow/shared";
import { Button } from "@/components/ui/button";
import {
  MergeVariableInput,
  RichTextEditor,
} from "@/components/ui/RichTextEditor";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { useEmailTemplates } from "@/hooks/useEmailTemplates";
import { useSendEmail } from "@/hooks/useSendEmail";
import { useCurrentUser } from "@/hooks/useUsers";

// ─── Validation schema ──────────────────────────────────────────────────────

const composeEmailSchema = z.object({
  subject: z.string().trim().min(1, "Onderwerp is verplicht"),
  body_html: z.string().trim().min(1, "Bericht mag niet leeg zijn"),
});

// ─── Types ──────────────────────────────────────────────────────────────────

interface ComposeEmailModalCandidate {
  id: string;
  name: string;
  email: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

interface ComposeEmailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidate: ComposeEmailModalCandidate;
  /** Pre-select a template when opening (e.g. from the candidate page). */
  defaultTemplateId?: string;
  /** Optional context about the active job, used by the merge-variable preview. */
  jobTitle?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ComposeEmailModal({
  open,
  onOpenChange,
  candidate,
  defaultTemplateId,
  jobTitle,
}: ComposeEmailModalProps) {
  const { toast } = useToast();
  const { data: templates, isLoading: templatesLoading } = useEmailTemplates();
  const { data: currentUser } = useCurrentUser();
  const sendEmail = useSendEmail();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    defaultTemplateId ?? "none"
  );
  const [subject, setSubject] = useState<string>("");
  const [bodyHtml, setBodyHtml] = useState<string>("");
  const [errors, setErrors] = useState<{ subject?: string; body_html?: string }>(
    {}
  );

  // Reset content when modal opens / closes or candidate changes
  useEffect(() => {
    if (!open) return;
    setSelectedTemplateId(defaultTemplateId ?? "none");
    setSubject("");
    setBodyHtml("");
    setErrors({});
  }, [open, candidate.id, defaultTemplateId]);

  // When user picks a template, pre-fill subject + body
  useEffect(() => {
    if (selectedTemplateId === "none" || !templates) return;
    const tpl = templates.find((t) => t.id === selectedTemplateId);
    if (tpl) {
      setSubject(tpl.subject);
      setBodyHtml(tpl.body_html);
    }
  }, [selectedTemplateId, templates]);

  // Merge-variable context shared by subject + body preview
  const mergeContext = useMemo(() => {
    const fullName =
      candidate.name?.trim() ||
      [candidate.first_name, candidate.last_name].filter(Boolean).join(" ") ||
      "";
    const [firstFromName, ...rest] = fullName.split(" ");
    return {
      candidate: {
        first_name: candidate.first_name?.trim() || firstFromName || "",
        last_name:
          candidate.last_name?.trim() || rest.join(" ") || "",
        full_name: fullName,
        email: candidate.email ?? "",
      },
      job: { title: jobTitle ?? "" },
      recruiter: { name: currentUser?.name ?? "" },
      tenant: { name: currentUser?.tenant?.name ?? "" },
    };
  }, [candidate, jobTitle, currentUser]);

  const subjectPreview = useMemo(
    () => applyMergeVariables(subject, mergeContext),
    [subject, mergeContext]
  );
  const bodyPreview = useMemo(
    () => applyMergeVariables(bodyHtml, mergeContext),
    [bodyHtml, mergeContext]
  );

  const selectedTemplate: EmailTemplate | undefined = useMemo(
    () =>
      selectedTemplateId === "none"
        ? undefined
        : templates?.find((t) => t.id === selectedTemplateId),
    [selectedTemplateId, templates]
  );

  // Group templates by category for the picker
  const templateGroups = useMemo(() => {
    const groups: Record<string, EmailTemplate[]> = {};
    (templates ?? []).forEach((tpl) => {
      const key = tpl.category || "general";
      if (!groups[key]) groups[key] = [];
      groups[key].push(tpl);
    });
    return groups;
  }, [templates]);

  const hasEmail = !!candidate.email && candidate.email.trim().length > 0;

  const handleSubmit = async () => {
    const parsed = composeEmailSchema.safeParse({ subject, body_html: bodyHtml });
    if (!parsed.success) {
      const fieldErrors: { subject?: string; body_html?: string } = {};
      parsed.error.errors.forEach((err) => {
        if (err.path[0] === "subject") fieldErrors.subject = err.message;
        if (err.path[0] === "body_html") fieldErrors.body_html = err.message;
      });
      setErrors(fieldErrors);
      return;
    }
    if (!hasEmail) return;

    try {
      // Send the rendered (merge-vars-applied) text — the backend can re-apply
      // its own context if needed, but the recruiter sees what they sent.
      await sendEmail.mutateAsync({
        candidate_id: candidate.id,
        template_id:
          selectedTemplateId !== "none" ? selectedTemplateId : undefined,
        subject: subjectPreview,
        body_html: bodyPreview,
      });
      toast({
        title: "E-mail verstuurd",
        description: `Bericht is verzonden aan ${candidate.email}.`,
      });
      onOpenChange(false);
    } catch {
      toast({
        title: "Versturen mislukt",
        description:
          "Er ging iets mis bij het versturen. Probeer het opnieuw.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[860px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400">
              <Mail className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle>E-mail versturen</DialogTitle>
              <DialogDescription>
                Stuur een gepersonaliseerde e-mail aan {candidate.name}.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-2">
          {/* ── Editor column ── */}
          <div className="space-y-4">
            {/* Recipient */}
            <div className="space-y-1.5">
              <Label htmlFor="to-field">Aan</Label>
              <div className="flex items-center gap-2 rounded-lg border border-input bg-zinc-50 dark:bg-zinc-800/40 px-3 py-2">
                <span className="text-sm text-zinc-700 dark:text-zinc-300">
                  {candidate.email ?? (
                    <span className="text-destructive">
                      Geen e-mailadres bekend
                    </span>
                  )}
                </span>
                {hasEmail && (
                  <span className="text-xs text-muted-foreground">
                    (via TalentFlow)
                  </span>
                )}
              </div>
            </div>

            {/* Template */}
            <div className="space-y-1.5">
              <Label htmlFor="template-picker">Template</Label>
              <Select
                value={selectedTemplateId}
                onValueChange={(v) => setSelectedTemplateId(v)}
              >
                <SelectTrigger id="template-picker">
                  <SelectValue
                    placeholder={
                      templatesLoading
                        ? "Templates laden…"
                        : "Kies een template (optioneel)"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Geen template (vrije tekst)</SelectItem>
                  {Object.entries(templateGroups).map(([category, tpls]) => (
                    <SelectGroup key={category}>
                      <SelectLabel>{categoryLabel(category)}</SelectLabel>
                      {tpls.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              {selectedTemplate &&
                selectedTemplate.merge_variables.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    <Variable className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground">
                      Variabelen:
                    </span>
                    {selectedTemplate.merge_variables.map((v) => (
                      <Badge
                        key={v}
                        variant="outline"
                        className="text-[10px] font-mono py-0 px-1.5 h-5"
                      >
                        {v}
                      </Badge>
                    ))}
                  </div>
                )}
            </div>

            {/* Subject */}
            <div className="space-y-1.5">
              <Label htmlFor="email-subject">Onderwerp</Label>
              <MergeVariableInput
                id="email-subject"
                value={subject}
                onChange={(v) => {
                  setSubject(v);
                  if (errors.subject) setErrors((p) => ({ ...p, subject: undefined }));
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

            {/* Body */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Bericht</Label>
                <span className="text-[11px] text-muted-foreground">
                  Typ {"{{"} voor variabelen en vacatures
                </span>
              </div>
              <RichTextEditor
                value={bodyHtml}
                onChange={(html) => {
                  setBodyHtml(html);
                  if (errors.body_html)
                    setErrors((p) => ({ ...p, body_html: undefined }));
                }}
                placeholder="Beste {{candidate.first_name}}… Typ {{ voor variabelen."
              />
              {errors.body_html && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.body_html}
                </p>
              )}
            </div>
          </div>

          {/* ── Preview column ── */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Eye className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm">Live preview</Label>
            </div>
            <div className="rounded-lg border border-border bg-zinc-50 dark:bg-zinc-900/40 overflow-hidden">
              {/* Email header preview */}
              <div className="border-b border-border bg-white dark:bg-zinc-900 px-4 py-3 space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Aan
                </p>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  {candidate.email ?? "—"}
                </p>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mt-2">
                  Onderwerp
                </p>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {subjectPreview || (
                    <span className="text-muted-foreground italic font-normal">
                      Geen onderwerp
                    </span>
                  )}
                </p>
              </div>
              {/* Body */}
              <div
                className="prose prose-sm dark:prose-invert max-w-none px-4 py-4 bg-white dark:bg-zinc-900 min-h-[280px] text-sm text-zinc-800 dark:text-zinc-200"
                /* eslint-disable-next-line react/no-danger -- preview only, content is recruiter-authored */
                dangerouslySetInnerHTML={{
                  __html:
                    bodyPreview ||
                    '<p class="text-muted-foreground italic">Begin met typen of kies een template…</p>',
                }}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sendEmail.isPending}
          >
            <X className="h-4 w-4 mr-1.5" />
            Annuleren
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    onClick={handleSubmit}
                    disabled={!hasEmail || sendEmail.isPending}
                    className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0 gap-1.5"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {sendEmail.isPending ? "Versturen…" : "Versturen"}
                  </Button>
                </span>
              </TooltipTrigger>
              {!hasEmail && (
                <TooltipContent>
                  Kandidaat heeft geen e-mailadres.
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function categoryLabel(category: string): string {
  switch (category) {
    case "invite":
      return "Uitnodigingen";
    case "reject":
      return "Afwijzingen";
    case "offer":
      return "Aanbiedingen";
    case "general":
      return "Algemeen";
    default:
      return category.charAt(0).toUpperCase() + category.slice(1);
  }
}
