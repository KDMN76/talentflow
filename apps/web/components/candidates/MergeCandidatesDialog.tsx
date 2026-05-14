"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Merge, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useCandidate } from "@/hooks/useCandidates";
import {
  useDuplicatesForCandidate,
  useMergeCandidates,
} from "@/hooks/useDedupe";
import { useToast } from "@/components/ui/use-toast";
import { cn, getInitials } from "@/lib/utils";
import type { Candidate } from "@talentflow/shared";

/**
 * Fields shown in the side-by-side comparison. Limited to the practical
 * dedupe-decision set — long-form text (notes/description) is shown in a
 * separate row at the bottom.
 */
const COMPARE_FIELDS: Array<{ key: keyof Candidate; label: string; longform?: boolean }> = [
  { key: "name", label: "Naam" },
  { key: "first_name", label: "Voornaam" },
  { key: "last_name", label: "Achternaam" },
  { key: "email", label: "E-mailadres" },
  { key: "phone", label: "Telefoon" },
  { key: "current_position", label: "Functie" },
  { key: "current_company", label: "Werkgever" },
  { key: "address_city", label: "Stad" },
  { key: "address_country", label: "Land" },
  { key: "source", label: "Bron" },
  { key: "ai_score", label: "AI-score" },
  { key: "description", label: "Omschrijving", longform: true },
  { key: "notes", label: "Notities", longform: true },
];

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "Ja" : "Nee";
  return String(v);
}

interface MergeCandidatesDialogProps {
  primaryId: string;
  duplicateId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MergeCandidatesDialog({
  primaryId,
  duplicateId,
  open,
  onOpenChange,
}: MergeCandidatesDialogProps) {
  const router = useRouter();
  const { toast } = useToast();

  const primaryQ = useCandidate(primaryId);
  const dupQ = useCandidate(duplicateId);
  const mergeMutation = useMergeCandidates();

  const primary = primaryQ.data;
  const dup = dupQ.data;

  // Per-field choice — defaults to "primary" (keep the surviving record's value).
  const [choices, setChoices] = useState<Record<string, "primary" | "duplicate">>({});

  useEffect(() => {
    if (!open) setChoices({});
  }, [open]);

  // Conflict detection: a field is in conflict when both records have a
  // non-empty value AND they differ. Identical-or-empty fields silently
  // default to "primary".
  const conflicts = useMemo(() => {
    if (!primary || !dup) return [];
    return COMPARE_FIELDS.filter(({ key }) => {
      const a = (primary as unknown as Record<string, unknown>)[key as string];
      const b = (dup as unknown as Record<string, unknown>)[key as string];
      const aEmpty = a === null || a === undefined || a === "";
      const bEmpty = b === null || b === undefined || b === "";
      if (aEmpty && bEmpty) return false;
      if (aEmpty || bEmpty) return false;
      return JSON.stringify(a) !== JSON.stringify(b);
    });
  }, [primary, dup]);

  const handleSubmit = async () => {
    if (!primary || !dup) return;
    try {
      await mergeMutation.mutateAsync({
        primary_id: primary.id,
        duplicate_id: dup.id,
        choices: conflicts.map((c) => ({
          field: c.key as string,
          source: choices[c.key as string] ?? "primary",
        })),
      });
      toast({
        title: "Kandidaten samengevoegd",
        description: `${dup.name} is samengevoegd met ${primary.name}.`,
      });
      onOpenChange(false);
      router.push(`/candidates/${primary.id}`);
    } catch {
      toast({
        variant: "destructive",
        title: "Samenvoegen mislukt",
        description: "Er ging iets mis bij het samenvoegen.",
      });
    }
  };

  const isLoading = primaryQ.isLoading || dupQ.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Merge className="h-5 w-5 text-indigo-600" />
            Kandidaten samenvoegen
          </DialogTitle>
          <DialogDescription>
            De primaire kandidaat blijft behouden. De duplicaat wordt verwijderd
            en gekoppelde data (sollicitaties, communicatie) wordt overgezet.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !primary || !dup ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="inline h-5 w-5 animate-spin mr-2" />
            Kandidaten laden...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <RecordHeader label="Primair (behouden)" candidate={primary} tone="emerald" />
              <RecordHeader label="Duplicaat (verwijderen)" candidate={dup} tone="rose" />
            </div>

            {conflicts.length === 0 ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900 px-4 py-3 flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span className="text-emerald-800 dark:text-emerald-300">
                  Geen conflicten — alle velden komen overeen of zijn complementair.
                </span>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 px-4 py-3 flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <span className="text-amber-800 dark:text-amber-300">
                  {conflicts.length} conflict{conflicts.length === 1 ? "" : "en"} — kies per veld welke waarde behouden blijft.
                </span>
              </div>
            )}

            <div className="rounded-lg border border-border divide-y divide-border">
              {COMPARE_FIELDS.map(({ key, label, longform }) => {
                const a = (primary as unknown as Record<string, unknown>)[key as string];
                const b = (dup as unknown as Record<string, unknown>)[key as string];
                const isConflict = conflicts.some((c) => c.key === key);
                const sel = choices[key as string] ?? "primary";

                return (
                  <div
                    key={key as string}
                    className={cn(
                      "grid grid-cols-[1fr_1fr] gap-3 px-4 py-3",
                      longform && "grid-cols-1 sm:grid-cols-[1fr_1fr]",
                      isConflict && "bg-amber-50/40 dark:bg-amber-950/10"
                    )}
                  >
                    <div className="col-span-2 text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">
                      {label}
                      {isConflict && (
                        <span className="ml-2 inline-flex items-center text-amber-600 normal-case font-medium">
                          conflict
                        </span>
                      )}
                    </div>
                    <ValueCell
                      value={formatValue(a)}
                      selected={sel === "primary"}
                      conflicting={isConflict}
                      onSelect={() =>
                        setChoices((c) => ({ ...c, [key as string]: "primary" }))
                      }
                      side="primary"
                    />
                    <ValueCell
                      value={formatValue(b)}
                      selected={sel === "duplicate"}
                      conflicting={isConflict}
                      onSelect={() =>
                        setChoices((c) => ({ ...c, [key as string]: "duplicate" }))
                      }
                      side="duplicate"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuleren
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={mergeMutation.isPending || !primary || !dup}
            className="bg-indigo-600 hover:bg-indigo-700 border-0"
          >
            {mergeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Samenvoegen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordHeader({
  label,
  candidate,
  tone,
}: {
  label: string;
  candidate: Candidate;
  tone: "emerald" | "rose";
}) {
  const toneCls =
    tone === "emerald"
      ? "border-emerald-200 dark:border-emerald-900/40"
      : "border-rose-200 dark:border-rose-900/40";
  const labelCls =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-400"
      : "text-rose-700 dark:text-rose-400";
  return (
    <div className={cn("rounded-lg border p-3", toneCls)}>
      <p className={cn("text-[11px] font-bold uppercase tracking-wide", labelCls)}>
        {label}
      </p>
      <div className="mt-2 flex items-center gap-2.5">
        <Avatar className="h-9 w-9">
          <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-xs font-semibold">
            {getInitials(candidate.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{candidate.name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {candidate.email ?? "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

function ValueCell({
  value,
  selected,
  conflicting,
  onSelect,
  side,
}: {
  value: string;
  selected: boolean;
  conflicting: boolean;
  onSelect: () => void;
  side: "primary" | "duplicate";
}) {
  return (
    <button
      type="button"
      onClick={() => conflicting && onSelect()}
      disabled={!conflicting}
      className={cn(
        "text-left text-sm rounded-md border px-3 py-2 transition-colors break-words min-w-0",
        conflicting
          ? selected
            ? side === "primary"
              ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200"
              : "border-rose-400 bg-rose-50 dark:bg-rose-950/30 text-rose-900 dark:text-rose-200"
            : "border-border hover:border-zinc-300 dark:hover:border-zinc-600"
          : "border-transparent bg-zinc-50/50 dark:bg-zinc-800/30 cursor-default"
      )}
    >
      {conflicting && (
        <span className="block text-[10px] uppercase tracking-wide font-semibold mb-0.5 opacity-70">
          {selected ? (side === "primary" ? "Behouden" : "Vervangen") : "Klik om te kiezen"}
        </span>
      )}
      <span className={cn(value === "—" && "text-muted-foreground")}>{value}</span>
    </button>
  );
}
