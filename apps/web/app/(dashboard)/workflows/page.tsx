"use client";

import { useState } from "react";
import {
  GitBranch,
  Plus,
  Zap,
  Power,
  Trash2,
  Play,
  Clock,
  Settings2,
  Mail,
  MessageCircle,
  Tag,
  XSquare,
  ArrowRightLeft,
  CheckSquare,
  Webhook,
  UserPlus,
  Briefcase,
  Building,
  CalendarCheck,
  Timer,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { useToast } from "@/components/ui/use-toast";
import {
  useWorkflows,
  useCreateWorkflow,
  useToggleWorkflow,
  useDeleteWorkflow,
  TRIGGER_LABELS,
  ACTION_LABELS,
  type Workflow,
  type WorkflowTrigger,
  type WorkflowActionType,
  type CreateWorkflowData,
} from "@/hooks/useWorkflows";
import { useEmailTemplates } from "@/hooks/useEmailTemplates";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Variable } from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "Nooit";
  const d = new Date(iso);
  return d.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const TRIGGER_ICONS: Record<WorkflowTrigger, React.ReactNode> = {
  "candidate.stage_changed": <ArrowRightLeft className="h-4 w-4" />,
  "candidate.created": <UserPlus className="h-4 w-4" />,
  "job.created": <Briefcase className="h-4 w-4" />,
  "job.closed": <Building className="h-4 w-4" />,
  "interview.scheduled": <CalendarCheck className="h-4 w-4" />,
  no_activity_days: <Timer className="h-4 w-4" />,
};

const ACTION_ICONS: Record<WorkflowActionType, React.ReactNode> = {
  send_email: <Mail className="h-4 w-4" />,
  send_whatsapp: <MessageCircle className="h-4 w-4" />,
  add_tag: <Tag className="h-4 w-4" />,
  remove_tag: <XSquare className="h-4 w-4" />,
  move_to_stage: <ArrowRightLeft className="h-4 w-4" />,
  create_task: <CheckSquare className="h-4 w-4" />,
  trigger_webhook: <Webhook className="h-4 w-4" />,
};

// ─── WorkflowCard ────────────────────────────────────────────────────────────

interface WorkflowCardProps {
  workflow: Workflow;
}

function WorkflowCard({ workflow }: WorkflowCardProps) {
  const toggleWorkflow = useToggleWorkflow();
  const deleteWorkflow = useDeleteWorkflow();
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleToggle = () => {
    toggleWorkflow.mutate(workflow.id, {
      onSuccess: () => {
        toast({
          title: workflow.active ? "Workflow gedeactiveerd" : "Workflow geactiveerd",
          description: `"${workflow.name}" is nu ${workflow.active ? "uitgeschakeld" : "ingeschakeld"}.`,
        });
      },
    });
  };

  const handleDelete = () => {
    deleteWorkflow.mutate(workflow.id, {
      onSuccess: () => {
        toast({
          title: "Workflow verwijderd",
          description: `"${workflow.name}" is verwijderd.`,
        });
        setConfirmDelete(false);
      },
    });
  };

  const firstAction = workflow.actions[0];

  return (
    <>
      <div className="group flex items-start gap-4 rounded-xl border border-border bg-card p-4 shadow-sm hover:shadow-md transition-all duration-200 hover:border-indigo-200 dark:hover:border-indigo-900">
        {/* Left icon */}
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-sm text-white mt-0.5">
          <Zap className="h-5 w-5" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Title + badge */}
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm leading-snug">
              {workflow.name}
            </span>
            {workflow.active ? (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                Actief
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                Inactief
              </span>
            )}
          </div>

          {/* Description */}
          <p className="text-sm text-muted-foreground leading-snug mb-3">
            {workflow.description}
          </p>

          {/* Trigger → Action flow */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-400">
              {TRIGGER_ICONS[workflow.trigger]}
              {TRIGGER_LABELS[workflow.trigger]}
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            {firstAction ? (
              <div className="inline-flex items-center gap-1.5 rounded-md border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-400">
                {ACTION_ICONS[firstAction.type]}
                {ACTION_LABELS[firstAction.type]}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground italic">
                Geen actie geconfigureerd
              </span>
            )}
            {workflow.actions.length > 1 && (
              <span className="text-xs text-muted-foreground">
                +{workflow.actions.length - 1} meer
              </span>
            )}
          </div>

          {/* Footer meta */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Play className="h-3 w-3" />
              <span>
                {workflow.run_count} keer uitgevoerd
              </span>
            </div>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>Laatste: {formatDate(workflow.last_run_at)}</span>
            </div>
          </div>
        </div>

        {/* Right actions */}
        <div className="flex flex-col items-end gap-2 shrink-0 ml-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggle}
            disabled={toggleWorkflow.isPending}
            className={
              workflow.active
                ? "h-8 gap-1.5 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300 dark:border-emerald-800 dark:text-emerald-400"
                : "h-8 gap-1.5 text-xs"
            }
          >
            <Power className="h-3.5 w-3.5" />
            {workflow.active ? "Deactiveren" : "Activeren"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmDelete(true)}
            className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Verwijderen
          </Button>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/40 mb-2">
              <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <DialogTitle>Workflow verwijderen</DialogTitle>
            <DialogDescription>
              Weet je zeker dat je{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                &quot;{workflow.name}&quot;
              </span>{" "}
              wilt verwijderen? Dit kan niet ongedaan worden gemaakt.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2">
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={deleteWorkflow.isPending}
            >
              Annuleren
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteWorkflow.isPending}
            >
              {deleteWorkflow.isPending ? "Verwijderen…" : "Verwijderen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Step indicator ──────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: number }) {
  const steps = [
    { n: 1, label: "Basis" },
    { n: 2, label: "Trigger" },
    { n: 3, label: "Actie" },
  ];
  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                step === s.n
                  ? "bg-indigo-600 text-white shadow-sm shadow-indigo-200 dark:shadow-indigo-900"
                  : step > s.n
                  ? "bg-emerald-500 text-white"
                  : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
              }`}
            >
              {step > s.n ? "✓" : s.n}
            </div>
            <span
              className={`text-xs font-medium ${
                step === s.n
                  ? "text-zinc-900 dark:text-zinc-100"
                  : step > s.n
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground"
              }`}
            >
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={`mx-3 h-px w-8 transition-colors ${
                step > s.n ? "bg-emerald-400" : "bg-zinc-200 dark:bg-zinc-700"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Trigger options ─────────────────────────────────────────────────────────

const ALL_TRIGGERS: WorkflowTrigger[] = [
  "candidate.created",
  "candidate.stage_changed",
  "interview.scheduled",
  "no_activity_days",
  "job.created",
  "job.closed",
];

// ─── Action options ───────────────────────────────────────────────────────────

const ALL_ACTIONS: WorkflowActionType[] = [
  "send_email",
  "send_whatsapp",
  "add_tag",
  "remove_tag",
  "move_to_stage",
  "create_task",
  "trigger_webhook",
];

const ACTION_COLORS: Record<WorkflowActionType, string> = {
  send_email:
    "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-400",
  send_whatsapp:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400",
  add_tag:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
  remove_tag:
    "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-400",
  move_to_stage:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-400",
  create_task:
    "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-400",
  trigger_webhook:
    "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

// ─── Send-email action config ────────────────────────────────────────────────

interface SendEmailActionConfigProps {
  config: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}

/**
 * Inline configuration block rendered under the action chip when the user
 * picks `send_email`. Persists into `action.config` as
 * `{ template_id, to_field }` so the existing workflow-data shape
 * (`Record<string, string>`) is preserved.
 */
function SendEmailActionConfig({
  config,
  onChange,
}: SendEmailActionConfigProps) {
  const { data: templates, isLoading } = useEmailTemplates();
  const selected = templates?.find((t) => t.id === config.template_id);
  const toField = config.to_field || "candidate.email";

  return (
    <div className="rounded-lg border border-indigo-200 bg-white dark:border-indigo-900 dark:bg-zinc-900 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-indigo-500" />
        <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          E-mail-actie configureren
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="action-template" className="text-xs">
          Template <span className="text-destructive">*</span>
        </Label>
        <Select
          value={config.template_id ?? ""}
          onValueChange={(v) =>
            onChange({ ...config, template_id: v, to_field: toField })
          }
        >
          <SelectTrigger id="action-template">
            <SelectValue
              placeholder={
                isLoading ? "Templates laden…" : "Kies een e-mailtemplate"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {(templates ?? []).length === 0 && !isLoading && (
              <SelectGroup>
                <SelectLabel>Geen templates beschikbaar</SelectLabel>
              </SelectGroup>
            )}
            {(templates ?? []).map((tpl) => (
              <SelectItem key={tpl.id} value={tpl.id}>
                {tpl.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selected && selected.merge_variables.length > 0 && (
        <div className="rounded-md border border-dashed border-indigo-200 bg-indigo-50/40 dark:border-indigo-800 dark:bg-indigo-950/20 p-2">
          <div className="flex items-center gap-1.5 mb-1">
            <Variable className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
            <p className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
              Variabelen in dit template
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {selected.merge_variables.map((v) => (
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

      <div className="space-y-1.5">
        <Label htmlFor="action-to-field" className="text-xs">
          Stuur naar
        </Label>
        <Select
          value={toField}
          onValueChange={(v) => onChange({ ...config, to_field: v })}
        >
          <SelectTrigger id="action-to-field">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="candidate.email">
              Primair e-mailadres kandidaat
            </SelectItem>
            <SelectItem value="candidate.email_alternative">
              Alternatief e-mailadres kandidaat
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ─── Create Workflow Dialog ───────────────────────────────────────────────────

interface CreateWorkflowDialogProps {
  open: boolean;
  onClose: () => void;
}

function CreateWorkflowDialog({ open, onClose }: CreateWorkflowDialogProps) {
  const { toast } = useToast();
  const createWorkflow = useCreateWorkflow();

  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTrigger, setSelectedTrigger] =
    useState<WorkflowTrigger | null>(null);
  const [selectedAction, setSelectedAction] =
    useState<WorkflowActionType | null>(null);
  const [actionConfig, setActionConfig] = useState<Record<string, string>>({});

  const resetDialog = () => {
    setStep(1);
    setName("");
    setDescription("");
    setSelectedTrigger(null);
    setSelectedAction(null);
    setActionConfig({});
  };

  const handleClose = () => {
    resetDialog();
    onClose();
  };

  const handleSave = async () => {
    if (!selectedTrigger || !selectedAction) return;

    const payload: CreateWorkflowData = {
      name: name.trim(),
      description: description.trim(),
      trigger: selectedTrigger,
      conditions: [],
      actions: [{ type: selectedAction, config: { ...actionConfig } }],
    };

    try {
      await createWorkflow.mutateAsync(payload);
      toast({
        title: "Workflow aangemaakt",
        description: `"${payload.name}" is succesvol aangemaakt en actief.`,
      });
      handleClose();
    } catch {
      toast({
        title: "Fout",
        description: "Kon de workflow niet aanmaken. Probeer het opnieuw.",
        variant: "destructive",
      });
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[600px]"
        onEscapeKeyDown={() => handleClose()}
        onPointerDownOutside={() => handleClose()}
        onInteractOutside={() => handleClose()}
      >
        <DialogHeader>
          <DialogTitle className="text-lg">Nieuwe workflow aanmaken</DialogTitle>
          <DialogDescription>
            Automatiseer een terugkerende taak in je recruitmentproces.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2">
          <StepIndicator step={step} />

          {/* ── Step 1: Basis ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="wf-name">
                  Naam <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="wf-name"
                  placeholder="Bijv. Welkomstmail bij nieuwe sollicitatie"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wf-desc">
                  Beschrijving{" "}
                  <span className="text-xs text-muted-foreground font-normal">
                    (optioneel)
                  </span>
                </Label>
                <textarea
                  id="wf-desc"
                  className="w-full min-h-[80px] rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                  placeholder="Korte omschrijving van wat deze workflow doet…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="flex justify-end pt-2">
                <Button
                  onClick={() => setStep(2)}
                  disabled={!name.trim()}
                  className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
                >
                  Volgende
                  <ChevronRight className="ml-1.5 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 2: Trigger ── */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Wanneer wordt deze workflow geactiveerd?
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {ALL_TRIGGERS.map((trigger) => {
                  const selected = selectedTrigger === trigger;
                  return (
                    <button
                      key={trigger}
                      type="button"
                      onClick={() => setSelectedTrigger(trigger)}
                      className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-all duration-150 ${
                        selected
                          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 shadow-sm"
                          : "border-border bg-card hover:border-indigo-300 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20"
                      }`}
                    >
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                          selected
                            ? "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/60 dark:text-indigo-400"
                            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                        }`}
                      >
                        {TRIGGER_ICONS[trigger]}
                      </div>
                      <span
                        className={`text-xs font-medium leading-snug mt-0.5 ${
                          selected
                            ? "text-indigo-700 dark:text-indigo-300"
                            : "text-zinc-700 dark:text-zinc-300"
                        }`}
                      >
                        {TRIGGER_LABELS[trigger]}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setStep(1)}>
                  Terug
                </Button>
                <Button
                  onClick={() => setStep(3)}
                  disabled={!selectedTrigger}
                  className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
                >
                  Volgende
                  <ChevronRight className="ml-1.5 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 3: Actie ── */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Wat moet er automatisch gebeuren?
              </p>
              <div className="flex flex-wrap gap-2">
                {ALL_ACTIONS.map((action) => {
                  const selected = selectedAction === action;
                  return (
                    <button
                      key={action}
                      type="button"
                      onClick={() => {
                        setSelectedAction(action);
                        // Reset action config when switching action types so
                        // we don't carry over keys that don't apply.
                        setActionConfig({});
                      }}
                      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 ${
                        selected
                          ? ACTION_COLORS[action] +
                            " ring-2 ring-offset-1 ring-current"
                          : "border-border text-zinc-600 dark:text-zinc-400 hover:border-zinc-400"
                      }`}
                    >
                      {ACTION_ICONS[action]}
                      {ACTION_LABELS[action]}
                    </button>
                  );
                })}
              </div>

              {selectedAction && (
                <div className="rounded-lg border border-dashed border-indigo-200 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-950/20 p-3">
                  <p className="text-xs text-muted-foreground mb-1 font-medium">
                    Geselecteerde actie
                  </p>
                  <div
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${ACTION_COLORS[selectedAction]}`}
                  >
                    {ACTION_ICONS[selectedAction]}
                    {ACTION_LABELS[selectedAction]}
                  </div>
                </div>
              )}

              {selectedAction === "send_email" && (
                <SendEmailActionConfig
                  config={actionConfig}
                  onChange={setActionConfig}
                />
              )}

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setStep(2)}>
                  Terug
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={
                    !selectedAction ||
                    createWorkflow.isPending ||
                    (selectedAction === "send_email" && !actionConfig.template_id)
                  }
                  className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
                >
                  {createWorkflow.isPending ? "Opslaan…" : "Workflow opslaan"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function WorkflowsPage() {
  const { data: workflows, isLoading } = useWorkflows();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const total = workflows?.length ?? 0;
  const activeCount = workflows?.filter((w) => w.active).length ?? 0;
  const totalRuns = workflows?.reduce((sum, w) => sum + w.run_count, 0) ?? 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Workflows"
        description="Automatiseer terugkerende recruitmenttaken"
        actions={
          <Button
            onClick={() => setIsCreateOpen(true)}
            className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0 gap-2"
          >
            <Plus className="h-4 w-4" />
            Nieuwe workflow
          </Button>
        }
      />

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
              <GitBranch className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
            </div>
            <div>
              <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 leading-none">
                {isLoading ? <Skeleton className="h-7 w-8 inline-block" /> : total}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Totaal</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-950/40">
              <Power className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 leading-none">
                {isLoading ? <Skeleton className="h-7 w-8 inline-block" /> : activeCount}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Actief</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-950/40">
              <Play className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 leading-none">
                {isLoading ? <Skeleton className="h-7 w-8 inline-block" /> : totalRuns}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Uitgevoerd deze maand
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Workflow list */}
      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))
        ) : !workflows || workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800 mb-4">
              <Settings2 className="h-8 w-8 text-zinc-400" />
            </div>
            <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Nog geen workflows
            </p>
            <p className="text-sm text-muted-foreground mt-1 mb-5">
              Automatiseer je eerste taak in je recruitmentproces.
            </p>
            <Button
              onClick={() => setIsCreateOpen(true)}
              className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0 gap-2"
            >
              <Plus className="h-4 w-4" />
              Eerste workflow aanmaken
            </Button>
          </div>
        ) : (
          workflows.map((workflow) => (
            <WorkflowCard key={workflow.id} workflow={workflow} />
          ))
        )}
      </div>

      {/* Create workflow dialog */}
      <CreateWorkflowDialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </div>
  );
}
