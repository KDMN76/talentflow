"use client";

import { useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  FileText,
  MessageSquare,
  Paperclip,
  Send,
  Trash2,
  Upload,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  useCreateJobNote,
  useDeleteJobAttachment,
  useDeleteJobNote,
  useJobAttachments,
  useJobNotes,
  useUploadJobAttachment,
} from "@/hooks/useJobDetail";
import { cn } from "@/lib/utils";
import { mockUser } from "@/lib/mockData";
import type { JobAttachment, JobNote } from "@/lib/types/jobDetail";

type FilterValue = "all" | "notes" | "files";

const FILTERS: Array<{ value: FilterValue; label: string }> = [
  { value: "all", label: "Alles" },
  { value: "notes", label: "Notities" },
  { value: "files", label: "Bestanden" },
];

interface FeedItem {
  type: "note" | "attachment";
  timestamp: string;
  data: JobNote | JobAttachment;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface JobActiviteitTabProps {
  jobId: string;
}

export function JobActiviteitTab({ jobId }: JobActiviteitTabProps) {
  const { data: notes, isLoading: notesLoading } = useJobNotes(jobId);
  const { data: attachments, isLoading: attachmentsLoading } =
    useJobAttachments(jobId);
  const createNote = useCreateJobNote(jobId);
  const deleteNote = useDeleteJobNote(jobId);
  const uploadAttachment = useUploadJobAttachment(jobId);
  const deleteAttachment = useDeleteJobAttachment(jobId);
  const { toast } = useToast();

  const [filter, setFilter] = useState<FilterValue>("all");
  const [noteBody, setNoteBody] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];
    if (filter === "all" || filter === "notes") {
      (notes ?? []).forEach((n) =>
        items.push({ type: "note", timestamp: n.created_at, data: n })
      );
    }
    if (filter === "all" || filter === "files") {
      (attachments ?? []).forEach((a) =>
        items.push({ type: "attachment", timestamp: a.created_at, data: a })
      );
    }
    return items.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [notes, attachments, filter]);

  const handlePostNote = () => {
    const body = noteBody.trim();
    if (!body) return;
    createNote.mutate(
      { body, mentions: [] },
      {
        onSuccess: () => {
          toast({ title: "Notitie geplaatst" });
          setNoteBody("");
        },
      }
    );
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadAttachment.mutate(file, {
      onSuccess: () => {
        toast({
          title: "Bestand toegevoegd",
          description: file.name,
        });
        if (fileInputRef.current) fileInputRef.current.value = "";
      },
      onError: () => {
        toast({
          title: "Upload mislukt",
          description: "Probeer het opnieuw.",
          variant: "destructive",
        });
      },
    });
  };

  const handleDeleteNote = (id: string) => {
    deleteNote.mutate({ noteId: id }, {
      onSuccess: () => toast({ title: "Notitie verwijderd" }),
    });
  };

  const handleDeleteAttachment = (att: JobAttachment) => {
    deleteAttachment.mutate({ attachmentId: att.id }, {
      onSuccess: () =>
        toast({ title: "Bestand verwijderd", description: att.filename }),
    });
  };

  const isLoading = notesLoading || attachmentsLoading;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Compose lane */}
      <div className="lg:col-span-1 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4 text-indigo-500" />
              Notitie toevoegen
            </CardTitle>
            <CardDescription>
              Zichtbaar voor het team — niet voor de kandidaat.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <textarea
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder="Bv. 'Sterke kandidaat voor stage 2 — afstemmen met Klaas.'"
              rows={4}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handlePostNote}
                disabled={!noteBody.trim() || createNote.isPending}
              >
                <Send className="mr-1 h-3.5 w-3.5" />
                Plaats
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Paperclip className="h-4 w-4 text-purple-500" />
              Bestand toevoegen
            </CardTitle>
            <CardDescription>
              Briefing, contracten, screenshots — alles wat bij deze vacature hoort.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-zinc-50 p-6 text-center transition hover:border-indigo-300 hover:bg-indigo-50/50 dark:bg-zinc-900/40 dark:hover:bg-indigo-950/20"
            >
              <Upload className="h-5 w-5 text-muted-foreground" />
              <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Klik of sleep een bestand
              </div>
              <div className="text-xs text-muted-foreground">
                PDF, DOCX, afbeeldingen — max 25 MB
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              onChange={handleFileSelect}
            />
          </CardContent>
        </Card>
      </div>

      {/* Feed lane */}
      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Activiteit</CardTitle>
                <CardDescription>
                  Alles op één tijdlijn — chronologisch.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFilter(f.value)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition",
                      filter === f.value
                        ? "bg-indigo-600 text-white"
                        : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : feed.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Nog niets te zien — voeg een notitie toe of upload een bestand.
              </div>
            ) : (
              <ul className="space-y-4">
                {feed.map((item) => {
                  const isMine =
                    item.type === "note" &&
                    (item.data as JobNote).author_id === mockUser.id;
                  if (item.type === "note") {
                    const note = item.data as JobNote;
                    return (
                      <li key={`note-${note.id}`} className="flex gap-3">
                        <Avatar className="h-9 w-9 shrink-0">
                          <AvatarFallback className="bg-indigo-100 text-indigo-700 text-xs font-semibold dark:bg-indigo-950/40 dark:text-indigo-300">
                            {initials(note.author_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0 rounded-xl border border-border bg-card p-3">
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>
                              <strong className="text-zinc-700 dark:text-zinc-300">
                                {note.author_name}
                              </strong>
                              {" · "}
                              {formatDateTime(note.created_at)}
                            </span>
                            {isMine && (
                              <button
                                onClick={() => handleDeleteNote(note.id)}
                                className="text-muted-foreground hover:text-destructive"
                                aria-label="Notitie verwijderen"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                            {note.body}
                          </p>
                        </div>
                      </li>
                    );
                  }
                  const att = item.data as JobAttachment;
                  return (
                    <li
                      key={`att-${att.id}`}
                      className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          <a
                            href={att.storage_url}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate hover:underline"
                          >
                            {att.filename}
                          </a>
                          <span className="text-xs text-muted-foreground">
                            {formatBytes(att.size_bytes)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {att.uploaded_by_name} · {formatDateTime(att.created_at)}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteAttachment(att)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Bestand verwijderen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {feed.length > 0 && filter === "all" && (
              <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <ArrowRight className="h-3 w-3" />
                Statuswijzigingen en e-mails verschijnen ook hier zodra de
                workflow-emitter ze in de activities-tabel logt.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
