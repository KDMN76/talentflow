"use client";

import { useRef, useState } from "react";
import {
  Upload,
  FileText,
  Trash2,
  Star,
  Download,
  Loader2,
  Sparkles,
  ChevronDown,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import {
  useCandidateResumes,
  useUploadCandidateResumes,
  useDeleteCandidateResume,
  useSetPrimaryResume,
} from "@/hooks/useCandidates";
import type { CandidateResume, ResumeParseStatus } from "@talentflow/shared";

const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const ACCEPTED_EXT = [".pdf", ".doc", ".docx"];

interface MultiCVUploadProps {
  candidateId: string;
  candidateName: string;
}

const dateFormatter = new Intl.DateTimeFormat("nl-NL", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIsAccepted(file: File): boolean {
  if (file.type && ACCEPTED_MIME.has(file.type)) return true;
  const lower = file.name.toLowerCase();
  return ACCEPTED_EXT.some((ext) => lower.endsWith(ext));
}

function ParseStatusBadge({
  status,
  error,
}: {
  status: ResumeParseStatus;
  error: string | null;
}) {
  if (status === "pending") {
    return (
      <Badge variant="warning" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        Wachten op AI
      </Badge>
    );
  }
  if (status === "processing") {
    return (
      <Badge variant="info" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        Bezig met analyseren...
      </Badge>
    );
  }
  if (status === "done") {
    return (
      <Badge variant="success" className="gap-1">
        <Sparkles className="h-3 w-3" />
        Geanalyseerd
      </Badge>
    );
  }
  // failed
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge variant="destructive" className="gap-1 cursor-help">
              <AlertCircle className="h-3 w-3" />
              Analyse mislukt
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-xs leading-snug">{error ?? "Onbekende fout tijdens parsing."}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ResumeCard({
  resume,
  candidateId,
  candidateName,
  apiBase,
}: {
  resume: CandidateResume;
  candidateId: string;
  candidateName: string;
  apiBase: string;
}) {
  const setPrimary = useSetPrimaryResume(candidateId);
  const deleteResume = useDeleteCandidateResume(candidateId);
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const downloadHref = `${apiBase}/candidates/${candidateId}/resumes/${resume.id}/download`;

  const handleSetPrimary = async () => {
    try {
      await setPrimary.mutateAsync(resume.id);
      toast({
        title: "Primaire CV bijgewerkt",
        description: `${resume.filename} is nu de primaire CV.`,
      });
    } catch {
      toast({
        title: "Bijwerken mislukt",
        description: "Kon de primaire CV niet wijzigen. Probeer het opnieuw.",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    try {
      await deleteResume.mutateAsync(resume.id);
      toast({
        title: "CV verwijderd",
        description: `${resume.filename} is verwijderd.`,
      });
    } catch {
      toast({
        title: "Verwijderen mislukt",
        description: "Kon de CV niet verwijderen. Probeer het opnieuw.",
        variant: "destructive",
      });
    } finally {
      setConfirmOpen(false);
    }
  };

  return (
    <Card className="border border-border shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 dark:bg-red-950/30">
            <FileText className="h-5 w-5 text-red-500" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p
                  className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate"
                  title={resume.filename}
                >
                  {resume.filename}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {dateFormatter.format(new Date(resume.created_at))}
                  {resume.size_bytes ? ` · ${formatFileSize(resume.size_bytes)}` : ""}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                {resume.is_primary ? (
                  <Badge variant="success" className="gap-1">
                    <Star className="h-3 w-3 fill-current" />
                    Primair
                  </Badge>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleSetPrimary}
                    disabled={setPrimary.isPending}
                  >
                    <Star className="mr-1 h-3 w-3" />
                    Maak primair
                  </Button>
                )}
                <ParseStatusBadge status={resume.parse_status} error={resume.parse_error} />
              </div>
            </div>

            {resume.ai_summary && (
              <Collapsible defaultOpen={false} className="mt-3">
                <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md border border-border bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2 text-left text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                  <span className="flex-1">AI-samenvatting</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 rounded-md border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/50 dark:bg-indigo-950/20 px-3 py-2.5">
                  <p className="text-sm italic text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
                    {resume.ai_summary}
                  </p>
                </CollapsibleContent>
              </Collapsible>
            )}

            <div className="mt-3 flex items-center gap-2">
              <a
                href={downloadHref}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-accent hover:text-accent-foreground transition-colors"
                )}
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </a>

              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40"
                    disabled={deleteResume.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>CV verwijderen?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Weet je zeker dat je <strong>{resume.filename}</strong> van{" "}
                      {candidateName} wilt verwijderen? Deze actie kan niet ongedaan
                      worden gemaakt.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuleren</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={handleDelete}
                      disabled={deleteResume.isPending}
                    >
                      {deleteResume.isPending ? "Verwijderen..." : "Verwijderen"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function MultiCVUpload({ candidateId, candidateName }: MultiCVUploadProps) {
  const { data: resumes, isLoading } = useCandidateResumes(candidateId);
  const upload = useUploadCandidateResumes(candidateId);
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const apiBase =
    typeof process !== "undefined"
      ? (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api")
      : "/api";

  const handleFiles = async (rawFiles: FileList | File[]) => {
    const all = Array.from(rawFiles);
    if (all.length === 0) return;

    const accepted: File[] = [];
    const rejected: { file: File; reason: string }[] = [];

    for (const file of all) {
      if (!fileIsAccepted(file)) {
        rejected.push({ file, reason: "Niet-ondersteund bestandstype" });
        continue;
      }
      if (file.size > MAX_BYTES) {
        rejected.push({ file, reason: "Groter dan 10 MB" });
        continue;
      }
      accepted.push(file);
    }

    if (accepted.length > MAX_FILES) {
      rejected.push(
        ...accepted.slice(MAX_FILES).map((file) => ({
          file,
          reason: `Maximaal ${MAX_FILES} bestanden per upload`,
        }))
      );
      accepted.length = MAX_FILES;
    }

    if (rejected.length > 0) {
      toast({
        title: `${rejected.length} bestand(en) overgeslagen`,
        description: rejected
          .map((r) => `${r.file.name}: ${r.reason}`)
          .join(" · "),
        variant: "destructive",
      });
    }

    if (accepted.length === 0) return;

    const formData = new FormData();
    accepted.forEach((file) => formData.append("files", file));

    toast({
      title: `${accepted.length} CV('s) uploaden...`,
      description: "AI-analyse start zodra de upload is voltooid.",
    });

    try {
      await upload.mutateAsync(formData);
      toast({
        title: "Upload voltooid",
        description: `${accepted.length} CV('s) toegevoegd aan ${candidateName}.`,
      });
    } catch {
      toast({
        title: "Upload mislukt",
        description: "Er ging iets mis bij het uploaden. Probeer het opnieuw.",
        variant: "destructive",
      });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    }
  };

  const list = resumes ?? [];

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer",
          isDragging
            ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30"
            : "border-border hover:border-indigo-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50",
          upload.isPending && "opacity-70 cursor-wait"
        )}
        onDragOver={(e) => {
          e.preventDefault();
          if (!upload.isPending) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          if (!upload.isPending) handleDrop(e);
          else e.preventDefault();
        }}
        onClick={() => {
          if (!upload.isPending) inputRef.current?.click();
        }}
      >
        {upload.isPending ? (
          <Loader2 className="h-7 w-7 text-indigo-500 animate-spin" />
        ) : (
          <Upload className="h-7 w-7 text-muted-foreground" />
        )}
        <div>
          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            {upload.isPending
              ? "Bezig met uploaden..."
              : "Sleep CV-bestanden hierheen of klik om te selecteren"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            PDF, DOC of DOCX · max {MAX_FILES} tegelijk · max 10 MB per bestand
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void handleFiles(e.target.files);
            e.target.value = "";
          }
        }}
      />

      {/* Existing resumes list */}
      {isLoading ? (
        <div className="rounded-lg border border-border bg-zinc-50 dark:bg-zinc-800/40 p-4">
          <p className="text-sm text-muted-foreground text-center">CV's laden...</p>
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-zinc-50/50 dark:bg-zinc-800/20 p-6 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">
            Nog geen CV's geüpload — sleep een bestand hierboven.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((resume) => (
            <ResumeCard
              key={resume.id}
              resume={resume}
              candidateId={candidateId}
              candidateName={candidateName}
              apiBase={apiBase}
            />
          ))}
        </div>
      )}
    </div>
  );
}
