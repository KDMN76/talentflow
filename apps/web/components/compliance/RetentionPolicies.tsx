"use client";

import { useState } from "react";
import {
  Archive,
  Calendar,
  Clock,
  Database,
  Eye,
  Plus,
  ShieldAlert,
  Trash2,
  UserX,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useToast } from "@/components/ui/use-toast";
import {
  useRetentionPolicies,
  useCreateRetentionPolicy,
  useUpdateRetentionPolicy,
  useDeleteRetentionPolicy,
  usePreviewRetentionPolicy,
  type RetentionPolicy,
} from "@/hooks/useCompliance";
import {
  RETENTION_ACTION_LABELS,
  RETENTION_ENTITY_LABELS,
  RETENTION_TRIGGER_LABELS,
} from "@/lib/complianceLabels";
import type {
  RetentionAction,
  RetentionEntityType,
  RetentionTriggerField,
} from "@/lib/mockData";
import { cn } from "@/lib/utils";

const ACTION_ICON: Record<RetentionAction, React.ReactNode> = {
  archive: <Archive className="h-3.5 w-3.5" />,
  anonymize: <UserX className="h-3.5 w-3.5" />,
  delete: <Trash2 className="h-3.5 w-3.5" />,
};

const ACTION_COLOR: Record<RetentionAction, string> = {
  archive:
    "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900",
  anonymize:
    "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900",
  delete:
    "bg-red-100 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900",
};

interface PolicyFormState {
  entity_type: RetentionEntityType;
  retention_months: number;
  trigger_field: RetentionTriggerField;
  action_on_expiry: RetentionAction;
  enabled: boolean;
}

const DEFAULT_FORM: PolicyFormState = {
  entity_type: "candidate",
  retention_months: 24,
  trigger_field: "last_activity_at",
  action_on_expiry: "anonymize",
  enabled: true,
};

// ─── Policy form (used in dialog) ────────────────────────────────────────────

interface PolicyFormProps {
  value: PolicyFormState;
  onChange: (next: PolicyFormState) => void;
}

function PolicyForm({ value, onChange }: PolicyFormProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Entiteit-type</Label>
        <Select
          value={value.entity_type}
          onValueChange={(v) =>
            onChange({ ...value, entity_type: v as RetentionEntityType })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(RETENTION_ENTITY_LABELS) as RetentionEntityType[]).map(
              (e) => (
                <SelectItem key={e} value={e}>
                  {RETENTION_ENTITY_LABELS[e]}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Bewaartermijn</Label>
          <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
            {value.retention_months} maanden
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={120}
          value={value.retention_months}
          onChange={(e) =>
            onChange({ ...value, retention_months: Number(e.target.value) })
          }
          className="w-full accent-indigo-600"
        />
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>1 mnd</span>
          <span>24 mnd</span>
          <span>60 mnd</span>
          <span>120 mnd</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Trigger-veld</Label>
        <Select
          value={value.trigger_field}
          onValueChange={(v) =>
            onChange({ ...value, trigger_field: v as RetentionTriggerField })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              Object.keys(RETENTION_TRIGGER_LABELS) as RetentionTriggerField[]
            ).map((t) => (
              <SelectItem key={t} value={t}>
                {RETENTION_TRIGGER_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Vanaf dit moment wordt de bewaartermijn geteld.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Actie bij verloop</Label>
        <Select
          value={value.action_on_expiry}
          onValueChange={(v) =>
            onChange({ ...value, action_on_expiry: v as RetentionAction })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(RETENTION_ACTION_LABELS) as RetentionAction[]).map(
              (a) => (
                <SelectItem key={a} value={a}>
                  {RETENTION_ACTION_LABELS[a]}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
        {value.action_on_expiry === "delete" && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 dark:border-red-900 dark:bg-red-950/30">
            <ShieldAlert className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
            <p className="text-xs text-red-700 dark:text-red-400">
              <span className="font-semibold">Let op:</span> permanent
              verwijderen is onomkeerbaar. Anonimiseren wordt aanbevolen voor
              statistiek-behoud.
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
        <div>
          <p className="text-sm font-medium">Beleid actief</p>
          <p className="text-xs text-muted-foreground">
            Inactieve beleidsregels triggeren geen acties.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value.enabled}
          onClick={() => onChange({ ...value, enabled: !value.enabled })}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors",
            value.enabled ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
          )}
        >
          <span
            className={cn(
              "inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
              value.enabled ? "translate-x-5" : "translate-x-0.5"
            )}
          />
        </button>
      </div>
    </div>
  );
}

// ─── Policy dialog (create + edit) ───────────────────────────────────────────

interface PolicyDialogProps {
  open: boolean;
  policy: RetentionPolicy | null;
  onClose: () => void;
}

function PolicyDialog({ open, policy, onClose }: PolicyDialogProps) {
  const { toast } = useToast();
  const create = useCreateRetentionPolicy();
  const update = useUpdateRetentionPolicy();
  const [form, setForm] = useState<PolicyFormState>(
    policy
      ? {
          entity_type: policy.entity_type,
          retention_months: policy.retention_months,
          trigger_field: policy.trigger_field,
          action_on_expiry: policy.action_on_expiry,
          enabled: policy.enabled,
        }
      : DEFAULT_FORM
  );

  // Reset form when policy changes
  useStableState(policy, setForm);

  const isEdit = !!policy;
  const pending = create.isPending || update.isPending;

  const handleSave = async () => {
    try {
      if (isEdit) {
        await update.mutateAsync({ id: policy.id, ...form });
        toast({ title: "Beleid bijgewerkt" });
      } else {
        await create.mutateAsync(form);
        toast({ title: "Beleid aangemaakt" });
      }
      onClose();
    } catch {
      toast({
        title: "Fout",
        description: "Kon het beleid niet opslaan.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Bewaarbeleid bewerken" : "Nieuw bewaarbeleid"}
          </DialogTitle>
          <DialogDescription>
            Configureer hoe lang gegevens worden bewaard en wat er na afloop
            gebeurt.
          </DialogDescription>
        </DialogHeader>
        <PolicyForm value={form} onChange={setForm} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuleren
          </Button>
          <Button onClick={handleSave} disabled={pending}>
            {pending ? "Opslaan…" : isEdit ? "Wijzigingen opslaan" : "Beleid aanmaken"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Tiny helper to reset form when the source policy changes (alternative to
// `key=` remounting). Kept inline because it's only used here.
import { useEffect } from "react";
function useStableState(
  policy: RetentionPolicy | null,
  setForm: (next: PolicyFormState) => void
) {
  useEffect(() => {
    if (policy) {
      setForm({
        entity_type: policy.entity_type,
        retention_months: policy.retention_months,
        trigger_field: policy.trigger_field,
        action_on_expiry: policy.action_on_expiry,
        enabled: policy.enabled,
      });
    } else {
      setForm(DEFAULT_FORM);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy?.id]);
}

// ─── Preview dialog ──────────────────────────────────────────────────────────

interface PreviewDialogProps {
  policy: RetentionPolicy | null;
  preview: { affected_count: number; sample_names: string[] } | null;
  onClose: () => void;
}

function PreviewDialog({ policy, preview, onClose }: PreviewDialogProps) {
  return (
    <Dialog open={!!policy} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Test-run resultaat</DialogTitle>
          <DialogDescription>
            Dit is een simulatie. Er worden geen gegevens daadwerkelijk
            verwijderd of geanonimiseerd.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-4">
            <div>
              <p className="text-xs text-muted-foreground">
                Records die zouden worden geraakt
              </p>
              <p className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">
                {preview?.affected_count ?? 0}
              </p>
            </div>
            <Wand2 className="h-8 w-8 text-indigo-300" />
          </div>
          {preview && preview.sample_names.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">
                Voorbeeld-records
              </p>
              <ul className="space-y-1 text-sm">
                {preview.sample_names.map((n) => (
                  <li
                    key={n}
                    className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5"
                  >
                    <Database className="h-3.5 w-3.5 text-muted-foreground" />
                    {n}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Sluiten</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function RetentionPolicies() {
  const { data, isLoading } = useRetentionPolicies();
  const update = useUpdateRetentionPolicy();
  const remove = useDeleteRetentionPolicy();
  const preview = usePreviewRetentionPolicy();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<RetentionPolicy | null>(
    null
  );
  const [previewPolicy, setPreviewPolicy] = useState<RetentionPolicy | null>(
    null
  );
  const [previewData, setPreviewData] = useState<{
    affected_count: number;
    sample_names: string[];
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RetentionPolicy | null>(
    null
  );

  const handleToggle = (policy: RetentionPolicy) => {
    update.mutate(
      { id: policy.id, enabled: !policy.enabled },
      {
        onSuccess: () => {
          toast({
            title: policy.enabled ? "Beleid uitgeschakeld" : "Beleid geactiveerd",
            description: RETENTION_ENTITY_LABELS[policy.entity_type],
          });
        },
      }
    );
  };

  const handlePreview = async (policy: RetentionPolicy) => {
    const result = await preview.mutateAsync(policy.id);
    setPreviewPolicy(policy);
    setPreviewData(result);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    await remove.mutateAsync(confirmDelete.id);
    toast({ title: "Beleid verwijderd" });
    setConfirmDelete(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Bewaartermijnen volgens AVG art. 5(1)(e) en art. 17.
        </p>
        <Button
          onClick={() => {
            setEditingPolicy(null);
            setDialogOpen(true);
          }}
          className="gap-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
        >
          <Plus className="h-4 w-4" />
          Nieuw beleid
        </Button>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))
        ) : !data || data.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800 mb-3">
              <Calendar className="h-7 w-7 text-zinc-400" />
            </div>
            <p className="font-semibold">Nog geen bewaarbeleid</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4 max-w-sm">
              Configureer per entiteit-type hoe lang gegevens worden bewaard.
              Dit voldoet aan AVG art. 5(1)(e) — opslagbeperking.
            </p>
            <Button
              onClick={() => {
                setEditingPolicy(null);
                setDialogOpen(true);
              }}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Eerste beleid aanmaken
            </Button>
          </div>
        ) : (
          data.map((policy) => (
            <div
              key={policy.id}
              className="rounded-xl border border-border bg-card p-4 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {RETENTION_ENTITY_LABELS[policy.entity_type]}
                    </span>
                    {policy.enabled ? (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                        Actief
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        Inactief
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs">
                      <Clock className="h-3 w-3" />
                      {policy.retention_months} maanden
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs">
                      <Calendar className="h-3 w-3" />
                      Vanaf{" "}
                      {RETENTION_TRIGGER_LABELS[
                        policy.trigger_field
                      ].toLowerCase()}
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium",
                        ACTION_COLOR[policy.action_on_expiry]
                      )}
                    >
                      {ACTION_ICON[policy.action_on_expiry]}
                      {RETENTION_ACTION_LABELS[policy.action_on_expiry]}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={policy.enabled}
                    onClick={() => handleToggle(policy)}
                    className={cn(
                      "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors",
                      policy.enabled
                        ? "bg-emerald-500"
                        : "bg-zinc-300 dark:bg-zinc-700"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
                        policy.enabled ? "translate-x-5" : "translate-x-0.5"
                      )}
                    />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePreview(policy)}
                  disabled={preview.isPending}
                  className="gap-1.5 h-8 text-xs"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Test run
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingPolicy(policy);
                    setDialogOpen(true);
                  }}
                  className="gap-1.5 h-8 text-xs"
                >
                  Bewerken
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(policy)}
                  className="gap-1.5 h-8 text-xs text-destructive hover:text-destructive hover:bg-red-50 dark:hover:bg-red-950/30 ml-auto"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Verwijderen
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <PolicyDialog
        key={editingPolicy?.id ?? "new"}
        open={dialogOpen}
        policy={editingPolicy}
        onClose={() => {
          setDialogOpen(false);
          setEditingPolicy(null);
        }}
      />

      <PreviewDialog
        policy={previewPolicy}
        preview={previewData}
        onClose={() => {
          setPreviewPolicy(null);
          setPreviewData(null);
        }}
      />

      {confirmDelete && (
        <Dialog
          open={!!confirmDelete}
          onOpenChange={(o) => !o && setConfirmDelete(null)}
        >
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Beleid verwijderen</DialogTitle>
              <DialogDescription>
                Weet je zeker dat je het bewaarbeleid voor{" "}
                <span className="font-semibold">
                  {RETENTION_ENTITY_LABELS[confirmDelete.entity_type]}
                </span>{" "}
                wilt verwijderen?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmDelete(null)}
              >
                Annuleren
              </Button>
              <Button variant="destructive" onClick={handleDelete}>
                Verwijderen
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
