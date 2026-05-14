"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Pencil,
  GripVertical,
  Loader2,
  X,
  Settings2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
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
import {
  useCreateCustomField,
  useCustomFields,
  useDeleteCustomField,
  useReorderCustomFields,
  useUpdateCustomField,
} from "@/hooks/useCustomFields";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import type {
  CreateCustomFieldInput,
  CustomFieldDefinition,
  CustomFieldEntityType,
  CustomFieldType,
} from "@/lib/types/atsExtensions";

const ENTITY_LABELS: Record<CustomFieldEntityType, string> = {
  candidate: "Kandidaten",
  job: "Vacatures",
  application: "Sollicitaties",
};

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Tekst",
  number: "Nummer",
  date: "Datum",
  dropdown: "Dropdown (één keuze)",
  multiselect: "Multiselect",
  boolean: "Ja/Nee",
};

function toSnakeCase(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export default function CustomFieldsSettingsPage() {
  const [activeTab, setActiveTab] = useState<CustomFieldEntityType>("candidate");

  return (
    <div className="max-w-4xl space-y-6 animate-fade-in">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground hover:text-foreground">
        <Link href="/settings">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Terug naar instellingen
        </Link>
      </Button>

      <PageHeader
        title="Custom velden"
        description="Definieer extra velden per entiteit. Custom velden worden automatisch in formulieren en CSV-import getoond."
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as CustomFieldEntityType)}>
        <TabsList>
          {(["candidate", "job", "application"] as CustomFieldEntityType[]).map((e) => (
            <TabsTrigger key={e} value={e}>
              {ENTITY_LABELS[e]}
            </TabsTrigger>
          ))}
        </TabsList>
        {(["candidate", "job", "application"] as CustomFieldEntityType[]).map((e) => (
          <TabsContent key={e} value={e} className="mt-6">
            <CustomFieldsTab entityType={e} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function CustomFieldsTab({ entityType }: { entityType: CustomFieldEntityType }) {
  const { toast } = useToast();
  const { data: fields, isLoading } = useCustomFields(entityType);
  const reorder = useReorderCustomFields();
  const deleteField = useDeleteCustomField();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CustomFieldDefinition | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Local order for drag-handle reordering. Synced from server fetch.
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => {
    if (fields) setOrder(fields.map((f) => f.id));
  }, [fields]);

  const orderedFields = useMemo(() => {
    if (!fields) return [];
    const map = new Map(fields.map((f) => [f.id, f]));
    return order.map((id) => map.get(id)).filter(Boolean) as CustomFieldDefinition[];
  }, [order, fields]);

  const moveField = (id: string, dir: -1 | 1) => {
    const idx = order.indexOf(id);
    if (idx === -1) return;
    const swapWith = idx + dir;
    if (swapWith < 0 || swapWith >= order.length) return;
    const next = [...order];
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    setOrder(next);
    reorder.mutate({ entity_type: entityType, orderedIds: next });
  };

  const handleDeleteConfirmed = async () => {
    if (!confirmDeleteId) return;
    try {
      await deleteField.mutateAsync(confirmDeleteId);
      toast({ title: "Veld verwijderd" });
    } catch {
      toast({ variant: "destructive", title: "Fout", description: "Kon veld niet verwijderen." });
    } finally {
      setConfirmDeleteId(null);
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-indigo-600" />
            Velden voor {ENTITY_LABELS[entityType].toLowerCase()}
          </CardTitle>
          <CardDescription>
            Sleep om de volgorde aan te passen. Verwijderde velden blijven historisch zichtbaar.
          </CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
          className="bg-indigo-600 hover:bg-indigo-700 border-0 shrink-0"
        >
          <Plus className="mr-2 h-4 w-4" />
          Nieuw veld
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
            Laden...
          </div>
        ) : orderedFields.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Nog geen custom velden voor {ENTITY_LABELS[entityType].toLowerCase()}.
          </div>
        ) : (
          <div className="rounded-lg border border-border divide-y divide-border">
            {orderedFields.map((f, idx) => (
              <div
                key={f.id}
                className="flex items-center gap-3 px-3 py-3 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors"
              >
                <div className="flex flex-col gap-0.5 text-zinc-300 dark:text-zinc-600">
                  <button
                    type="button"
                    onClick={() => moveField(f.id, -1)}
                    disabled={idx === 0}
                    className="hover:text-indigo-500 disabled:opacity-30"
                    title="Omhoog"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => moveField(f.id, 1)}
                    disabled={idx === orderedFields.length - 1}
                    className="hover:text-indigo-500 disabled:opacity-30"
                    title="Omlaag"
                  >
                    ▼
                  </button>
                </div>
                <GripVertical className="h-4 w-4 text-zinc-300 dark:text-zinc-600 cursor-grab" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{f.label}</p>
                    <code className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-muted-foreground">
                      {f.key}
                    </code>
                    <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                      {TYPE_LABELS[f.field_type]}
                    </span>
                    {f.required && (
                      <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                        Verplicht
                      </span>
                    )}
                  </div>
                  {f.options && f.options.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {f.options.length} opties: {f.options.slice(0, 3).join(", ")}
                      {f.options.length > 3 && "..."}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => {
                      setEditing(f);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0 border-destructive/40 text-destructive hover:bg-destructive/10"
                    onClick={() => setConfirmDeleteId(f.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <CustomFieldDialog
        entityType={entityType}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
      />

      <AlertDialog open={confirmDeleteId !== null} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Veld verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              Bestaande waarden voor dit veld blijven historisch beschikbaar maar
              worden niet meer in nieuwe formulieren getoond.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirmed} className="bg-rose-600 hover:bg-rose-700">
              Verwijderen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function CustomFieldDialog({
  entityType,
  open,
  onOpenChange,
  editing,
}: {
  entityType: CustomFieldEntityType;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: CustomFieldDefinition | null;
}) {
  const { toast } = useToast();
  const create = useCreateCustomField();
  const update = useUpdateCustomField();

  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [fieldType, setFieldType] = useState<CustomFieldType>("text");
  const [options, setOptions] = useState<string[]>([]);
  const [optionDraft, setOptionDraft] = useState("");
  const [required, setRequired] = useState(false);

  useEffect(() => {
    if (open) {
      if (editing) {
        setLabel(editing.label);
        setKey(editing.key);
        setKeyEdited(true);
        setFieldType(editing.field_type);
        setOptions(editing.options ?? []);
        setRequired(editing.required ?? false);
      } else {
        setLabel("");
        setKey("");
        setKeyEdited(false);
        setFieldType("text");
        setOptions([]);
        setRequired(false);
      }
      setOptionDraft("");
    }
  }, [open, editing]);

  // Auto-derive snake_case key from label until the user manually edits it.
  useEffect(() => {
    if (!keyEdited) setKey(toSnakeCase(label));
  }, [label, keyEdited]);

  const needsOptions = fieldType === "dropdown" || fieldType === "multiselect";

  const handleSubmit = async () => {
    if (!label.trim() || !key.trim()) return;
    if (needsOptions && options.length === 0) {
      toast({
        variant: "destructive",
        title: "Opties vereist",
        description: "Voeg minimaal één optie toe voor dit veldtype.",
      });
      return;
    }
    const input: CreateCustomFieldInput = {
      entity_type: entityType,
      key: key.trim(),
      label: label.trim(),
      field_type: fieldType,
      options: needsOptions ? options : undefined,
      required,
    };
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, ...input });
        toast({ title: "Veld bijgewerkt" });
      } else {
        await create.mutateAsync(input);
        toast({ title: "Veld toegevoegd" });
      }
      onOpenChange(false);
    } catch {
      toast({ variant: "destructive", title: "Fout", description: "Kon veld niet opslaan." });
    }
  };

  const addOption = () => {
    if (!optionDraft.trim()) return;
    if (options.includes(optionDraft.trim())) return;
    setOptions((cur) => [...cur, optionDraft.trim()]);
    setOptionDraft("");
  };

  const isPending = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Veld bewerken" : "Nieuw custom veld"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="cf-label">Label</Label>
            <Input
              id="cf-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Bijv. LinkedIn URL"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cf-key">Key (snake_case)</Label>
            <Input
              id="cf-key"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setKeyEdited(true);
              }}
              placeholder="bijv. linkedin_url"
              disabled={!!editing}
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              {editing
                ? "Key kan niet meer gewijzigd worden na aanmaken."
                : "Wordt automatisch afgeleid uit het label, maar je kunt het aanpassen."}
            </p>
          </div>
          <div className="space-y-2">
            <Label>Veldtype</Label>
            <Select value={fieldType} onValueChange={(v) => setFieldType(v as CustomFieldType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TYPE_LABELS) as CustomFieldType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {needsOptions && (
            <div className="space-y-2">
              <Label>Opties</Label>
              <div className="flex gap-2">
                <Input
                  value={optionDraft}
                  onChange={(e) => setOptionDraft(e.target.value)}
                  placeholder="Nieuwe optie"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addOption();
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={addOption}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {options.map((opt) => (
                  <span
                    key={opt}
                    className="inline-flex items-center gap-1.5 rounded-md bg-indigo-100 dark:bg-indigo-950/40 px-2 py-1 text-xs text-indigo-800 dark:text-indigo-200"
                  >
                    {opt}
                    <button
                      type="button"
                      onClick={() => setOptions(options.filter((o) => o !== opt))}
                      className="hover:text-rose-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {options.length === 0 && (
                  <span className="text-xs text-muted-foreground">Nog geen opties toegevoegd.</span>
                )}
              </div>
            </div>
          )}
          <label
            className={cn(
              "flex items-center justify-between cursor-pointer rounded-md border border-border px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
            )}
          >
            <span className="text-sm font-medium">Verplicht veld</span>
            <input
              type="checkbox"
              className="h-4 w-4 rounded accent-indigo-600"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
            />
          </label>
        </div>
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button variant="outline">Annuleren</Button>
          </DialogClose>
          <Button
            onClick={handleSubmit}
            disabled={!label.trim() || !key.trim() || isPending}
            className="bg-indigo-600 hover:bg-indigo-700 border-0"
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editing ? "Opslaan" : "Aanmaken"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
