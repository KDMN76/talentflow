"use client";

/**
 * Sprint Q4.6 — Voice-call detail page.
 *
 * Layout:
 *   - Header: candidate + recruiter + duration + status timeline.
 *   - Recording player (HTML5 audio).
 *   - Transcription with copy-button.
 *   - Auto-saving notes textarea.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Copy,
  Mic,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Save,
  User,
  Voicemail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import {
  CallStatusBadge,
  formatCallDuration,
} from "@/components/voice/CallStatusBadge";
import {
  useCallNotes,
  useRequestTranscription,
  useVoiceCall,
} from "@/hooks/useVoice";
import { useCurrentUser } from "@/hooks/useUsers";
import { getInitials } from "@/lib/utils";

export default function CallDetailPage() {
  const { t } = useTranslation("miscPortals");
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const { data: call, isLoading, isError } = useVoiceCall(id);
  const { data: currentUser } = useCurrentUser();
  const { toast } = useToast();
  const saveNotes = useCallNotes();
  const requestTranscription = useRequestTranscription();

  const [notes, setNotes] = useState("");
  const [savedNotes, setSavedNotes] = useState("");
  const [copied, setCopied] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (call && notes === "") {
      setNotes(call.notes ?? "");
      setSavedNotes(call.notes ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call?.id]);

  // Debounced auto-save
  useEffect(() => {
    if (!call) return;
    if (notes === savedNotes) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveNotes.mutate(
        { callId: call.id, notes },
        {
          onSuccess: () => {
            setSavedNotes(notes);
          },
        }
      );
    }, 1_200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  if (isLoading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (isError || !call) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="text-muted-foreground hover:text-foreground -ml-2"
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> {t("voiceCall.back")}
        </Button>
        <Card className="border-0 shadow-sm">
          <CardContent className="py-12 text-center text-sm">
            {isError ? (
              <span className="text-destructive">
                {t("voiceCall.error.loadFailed")}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {t("voiceCall.error.notFound")}
              </span>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleCopy = async () => {
    if (!call.transcription_text) return;
    try {
      await navigator.clipboard.writeText(call.transcription_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
      toast({ title: t("voiceCall.toasts.transcriptionCopied") });
    } catch {
      toast({
        title: t("voiceCall.toasts.copyFailed"),
        variant: "destructive",
      });
    }
  };

  const DirIcon = call.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;

  return (
    <div className="space-y-6 animate-fade-in">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.back()}
        className="text-muted-foreground hover:text-foreground -ml-2"
      >
        <ArrowLeft className="mr-2 h-4 w-4" /> {t("voiceCall.back")}
      </Button>

      {/* Header card */}
      <Card className="border-0 shadow-sm">
        <CardContent className="grid gap-4 p-6 sm:grid-cols-3">
          <div className="flex items-start gap-3 sm:col-span-2">
            <Avatar className="h-12 w-12">
              <AvatarFallback className="bg-gradient-to-br from-purple-400 to-indigo-500 text-sm font-semibold text-white">
                {getInitials(call.candidate_name ?? call.candidate_id)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <Link
                href={`/candidates/${call.candidate_id}`}
                className="text-lg font-bold text-zinc-900 hover:text-indigo-600 dark:text-zinc-100"
              >
                {call.candidate_name ?? t("voiceCall.header.unknownCandidate")}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <DirIcon className="h-3 w-3" />
                  {call.direction === "inbound"
                    ? t("voiceCall.header.inbound")
                    : t("voiceCall.header.outbound")}
                </span>
                <span>·</span>
                <span className="font-mono">{call.from_number}</span>
                <span>→</span>
                <span className="font-mono">{call.to_number}</span>
                {call.voicemail && (
                  <span className="inline-flex items-center gap-1 text-purple-600">
                    <Voicemail className="h-3 w-3" />{" "}
                    {t("voiceCall.header.voicemail")}
                  </span>
                )}
              </div>
              {currentUser?.name && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <User className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    {t("voiceCall.header.recruiterLabel")}
                  </span>
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {currentUser.name}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end justify-between gap-3">
            <CallStatusBadge status={call.status} />
            <div className="text-right">
              <p className="font-mono text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                {formatCallDuration(call.duration_seconds)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {call.started_at
                  ? new Date(call.started_at).toLocaleString("nl-NL", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })
                  : t("voiceCall.header.noDate")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status timeline */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t("voiceCall.timeline.title")}
          </h3>
          <ol className="space-y-2 text-xs">
            <TimelineRow
              icon={<Phone className="h-3.5 w-3.5" />}
              label={t("voiceCall.timeline.started")}
              ts={call.started_at}
              done
            />
            <TimelineRow
              icon={<PhoneIncoming className="h-3.5 w-3.5" />}
              label={t("voiceCall.timeline.answered")}
              ts={call.answered_at}
              done={!!call.answered_at}
            />
            <TimelineRow
              icon={<Phone className="h-3.5 w-3.5" />}
              label={t("voiceCall.timeline.ended")}
              ts={call.ended_at}
              done={!!call.ended_at}
            />
            {call.recording_url && (
              <TimelineRow
                icon={<Mic className="h-3.5 w-3.5" />}
                label={t("voiceCall.timeline.recordingAvailable")}
                ts={call.ended_at}
                done
              />
            )}
          </ol>
        </CardContent>
      </Card>

      {/* Recording */}
      {call.recording_url && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              <Mic className="h-4 w-4 text-purple-500" />{" "}
              {t("voiceCall.recording.title")}
            </h3>
            <audio controls className="w-full" preload="metadata">
              <source src={call.recording_url} />
              {t("voiceCall.recording.unsupported")}
            </audio>
          </CardContent>
        </Card>
      )}

      {/* Transcription */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              <Mic className="h-4 w-4 text-indigo-500" />{" "}
              {t("voiceCall.transcription.title")}
            </h3>
            <div className="flex gap-1.5">
              {!call.transcription_text && call.transcription_status !== "pending" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    requestTranscription.mutate(call.id, {
                      onSuccess: () =>
                        toast({
                          title: t("voiceCall.toasts.transcriptionRequested"),
                        }),
                      onError: () =>
                        toast({
                          title: t("voiceCall.toasts.transcriptionFailed"),
                          variant: "destructive",
                        }),
                    })
                  }
                  className="h-7 text-xs"
                >
                  {t("voiceCall.transcription.generate")}
                </Button>
              )}
              {call.transcription_text && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopy}
                  className="h-7 gap-1 text-xs"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3" />{" "}
                      {t("voiceCall.transcription.copied")}
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />{" "}
                      {t("voiceCall.transcription.copy")}
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
          {call.transcription_status === "pending" ? (
            <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              {t("voiceCall.transcription.pending")}
            </p>
          ) : call.transcription_text ? (
            <p className="whitespace-pre-wrap rounded-md bg-zinc-50 p-4 text-sm leading-relaxed text-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-200">
              {call.transcription_text}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("voiceCall.transcription.none")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Notes */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {t("voiceCall.notes.title")}
            </h3>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Save className="h-3 w-3" />
              {notes === savedNotes
                ? t("voiceCall.notes.saved")
                : saveNotes.isPending
                ? t("voiceCall.notes.saving")
                : t("voiceCall.notes.willSave")}
            </span>
          </div>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("voiceCall.notes.placeholder")}
            className="min-h-[140px]"
          />
        </CardContent>
      </Card>
    </div>
  );
}

function TimelineRow({
  icon,
  label,
  ts,
  done,
}: {
  icon: React.ReactNode;
  label: string;
  ts: string | null;
  done: boolean;
}) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full",
          done
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
            : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
        )}
      >
        {icon}
      </span>
      <span className={cn("flex-1", done ? "text-zinc-700 dark:text-zinc-300" : "text-muted-foreground")}>
        {label}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground">
        {ts
          ? new Date(ts).toLocaleTimeString("nl-NL", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })
          : "—"}
      </span>
    </li>
  );
}
