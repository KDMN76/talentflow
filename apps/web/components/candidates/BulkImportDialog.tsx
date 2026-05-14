"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Upload,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Download,
  ArrowRight,
  ArrowLeft,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  usePreviewCsv,
  useStartImport,
  useImportStatus,
} from "@/hooks/useBulkImport";
import { useToast } from "@/components/ui/use-toast";
import type { ImportPreviewResponse } from "@/lib/types/atsExtensions";
import { cn } from "@/lib/utils";

type Step = "upload" | "map" | "running" | "result";

const FIELD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "— Negeren —" },
  { value: "name", label: "Volledige naam" },
  { value: "first_name", label: "Voornaam" },
  { value: "last_name", label: "Achternaam" },
  { value: "email", label: "E-mailadres" },
  { value: "phone", label: "Telefoon" },
  { value: "current_position", label: "Huidige functie" },
  { value: "current_company", label: "Huidige werkgever" },
  { value: "current_department", label: "Afdeling" },
  { value: "address_city", label: "Stad" },
  { value: "address_country", label: "Land" },
  { value: "skills", label: "Skills (komma gescheiden)" },
  { value: "tags", label: "Tags" },
  { value: "source", label: "Bron" },
  { value: "linkedin_url", label: "LinkedIn URL (custom)" },
  { value: "notes", label: "Notities" },
];

interface BulkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

export function BulkImportDialog({
  open,
  onOpenChange,
  onComplete,
}: BulkImportDialogProps) {
  const { toast } = useToast();
  const previewCsv = usePreviewCsv();
  const startImport = useStartImport();

  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importId, setImportId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const status = useImportStatus(step === "running" || step === "result" ? importId : null);

  // Reset internal state whenever the dialog is closed.
  useEffect(() => {
    if (!open) {
      setStep("upload");
      setFile(null);
      setPreview(null);
      setMapping({});
      setImportId(null);
    }
  }, [open]);

  // When the polled status reaches a terminal state, advance to "result".
  useEffect(() => {
    if (step === "running" && status.data) {
      if (status.data.status === "done" || status.data.status === "failed") {
        setStep("result");
      }
    }
  }, [step, status.data]);

  const handleFile = async (selected: File | null) => {
    if (!selected) return;
    if (!/\.csv$/i.test(selected.name)) {
      toast({
        variant: "destructive",
        title: "Ongeldig bestand",
        description: "Alleen .csv-bestanden worden ondersteund.",
      });
      return;
    }
    setFile(selected);
    try {
      const result = await previewCsv.mutateAsync(selected);
      setPreview(result);
      setMapping(result.suggested_mapping);
      setStep("map");
    } catch {
      toast({
        variant: "destructive",
        title: "Preview mislukt",
        description: "Kon het CSV-bestand niet inlezen.",
      });
    }
  };

  const handleStart = async () => {
    if (!preview) return;
    try {
      const initial = await startImport.mutateAsync({
        import_id: preview.import_id,
        mapping,
      });
      setImportId(initial.id);
      setStep("running");
    } catch {
      toast({
        variant: "destructive",
        title: "Import mislukt",
        description: "Kon de import niet starten.",
      });
    }
  };

  const progressPct = useMemo(() => {
    if (!status.data || status.data.total_rows === 0) return 0;
    return Math.min(
      100,
      Math.round((status.data.processed_rows / status.data.total_rows) * 100)
    );
  }, [status.data]);

  const titleByStep: Record<Step, string> = {
    upload: "CSV-bestand importeren",
    map: "Kolommen koppelen",
    running: "Import wordt uitgevoerd",
    result: "Import afgerond",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{titleByStep[step]}</DialogTitle>
          <DialogDescription>
            {step === "upload" && "Sleep een CSV-bestand of klik om te bladeren."}
            {step === "map" && "Controleer de detectie en koppel kolommen aan kandidaat-velden."}
            {step === "running" && "Even geduld terwijl de kandidaten worden ingelezen."}
            {step === "result" && "Bekijk het resultaat en download eventueel de fouten-CSV."}
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {(["upload", "map", "running", "result"] as Step[]).map((s, idx) => {
            const isPast =
              ["upload", "map", "running", "result"].indexOf(step) > idx;
            const isCurrent = s === step;
            return (
              <div key={s} className="flex items-center gap-2">
                <span
                  className={cn(
                    "h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-semibold",
                    isCurrent
                      ? "bg-indigo-600 text-white"
                      : isPast
                        ? "bg-emerald-500 text-white"
                        : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700"
                  )}
                >
                  {idx + 1}
                </span>
                <span className={cn(isCurrent && "text-zinc-900 dark:text-zinc-100 font-medium")}>
                  {{ upload: "Bestand", map: "Mapping", running: "Verwerken", result: "Klaar" }[s]}
                </span>
                {idx < 3 && <span className="text-muted-foreground/40">›</span>}
              </div>
            );
          })}
        </div>

        {/* Step content */}
        <div className="py-2">
          {step === "upload" && (
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) handleFile(dropped);
              }}
              className={cn(
                "block cursor-pointer border-2 border-dashed rounded-xl p-10 text-center transition-colors",
                dragOver
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20"
                  : "border-zinc-200 hover:border-indigo-300 dark:border-zinc-700"
              )}
            >
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
              {previewCsv.isPending ? (
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <p className="text-sm">Bestand wordt voorbereid...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <Upload className="h-10 w-10 text-indigo-500" />
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      Sleep een CSV-bestand of klik om te bladeren
                    </p>
                    <p className="text-xs mt-1">Maximaal 5 MB · UTF-8 aanbevolen</p>
                  </div>
                </div>
              )}
            </label>
          )}

          {step === "map" && preview && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-1">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  {file?.name}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-md bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 px-2 py-1 font-medium">
                  {preview.total_rows} rijen totaal
                </span>
                {preview.duplicate_count > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 px-2 py-1 font-medium">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {preview.duplicate_count} duplicaten gevonden — worden overgeslagen
                  </span>
                )}
              </div>

              <div className="rounded-lg border border-border overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-50 dark:bg-zinc-800/50 sticky top-0">
                    <tr>
                      {preview.headers.map((h) => (
                        <th key={h} className="text-left px-3 py-2 font-semibold align-top">
                          <div className="space-y-1.5">
                            <div className="text-zinc-900 dark:text-zinc-100 font-mono">{h}</div>
                            <Select
                              value={mapping[h] ?? ""}
                              onValueChange={(val) =>
                                setMapping((m) => ({ ...m, [h]: val }))
                              }
                            >
                              <SelectTrigger className="h-7 text-xs font-normal w-full">
                                <SelectValue placeholder="Kies veld" />
                              </SelectTrigger>
                              <SelectContent>
                                {FIELD_OPTIONS.map((opt) => (
                                  <SelectItem key={opt.value || "skip"} value={opt.value}>
                                    {opt.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {preview.rows.map((r) => (
                      <tr
                        key={r.row}
                        className={cn(
                          r.duplicate_of && "bg-amber-50/50 dark:bg-amber-950/10"
                        )}
                      >
                        {preview.headers.map((h) => (
                          <td key={h} className="px-3 py-1.5 align-top text-muted-foreground truncate max-w-[12rem]">
                            {r.values[h] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === "running" && (
            <div className="space-y-4 py-6">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 text-indigo-600 animate-spin" />
                <p className="text-sm font-medium">Bezig met verwerken...</p>
              </div>
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                  <span>
                    {status.data?.processed_rows ?? 0} van {status.data?.total_rows ?? 0} rijen
                  </span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-purple-600 transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Je kunt dit venster sluiten — de import gaat door op de achtergrond.
              </p>
            </div>
          )}

          {step === "result" && status.data && (
            <div className="space-y-5 py-3">
              <div className="flex items-center gap-3">
                {status.data.status === "done" ? (
                  <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                ) : (
                  <X className="h-8 w-8 text-rose-500" />
                )}
                <div>
                  <p className="text-sm font-semibold">
                    {status.data.status === "done"
                      ? "Import voltooid"
                      : "Import mislukt"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {status.data.imported_count} kandidaten geïmporteerd,{" "}
                    {status.data.skipped_count} overgeslagen,{" "}
                    {status.data.error_count} fouten
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <ResultStat label="Geïmporteerd" value={status.data.imported_count} tone="emerald" />
                <ResultStat label="Overgeslagen" value={status.data.skipped_count} tone="amber" />
                <ResultStat label="Fouten" value={status.data.error_count} tone="rose" />
              </div>

              {status.data.error_csv_url && status.data.error_count > 0 && (
                <a
                  href={status.data.error_csv_url}
                  download
                  className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:underline"
                >
                  <Download className="h-4 w-4" />
                  Download fouten-CSV
                </a>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {step === "map" && (
            <>
              <Button variant="outline" onClick={() => setStep("upload")}>
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                Terug
              </Button>
              <Button
                onClick={handleStart}
                disabled={startImport.isPending}
                className="bg-indigo-600 hover:bg-indigo-700 border-0"
              >
                {startImport.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Import starten
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </>
          )}
          {step === "result" && (
            <Button
              onClick={() => {
                onOpenChange(false);
                onComplete?.();
              }}
              className="bg-indigo-600 hover:bg-indigo-700 border-0"
            >
              Sluiten
            </Button>
          )}
          {(step === "upload" || step === "running") && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {step === "running" ? "Achtergrond" : "Annuleren"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResultStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "rose";
}) {
  const toneClasses: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300 border-emerald-200/50 dark:border-emerald-900/40",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300 border-amber-200/50 dark:border-amber-900/40",
    rose: "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300 border-rose-200/50 dark:border-rose-900/40",
  };
  return (
    <div className={cn("rounded-lg border p-3", toneClasses[tone])}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-[11px] uppercase tracking-wide font-medium opacity-80">{label}</p>
    </div>
  );
}
