"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Loader2,
  MinusCircle,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import { AIBadge } from "@/components/matching/AIBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranscript } from "@/hooks/useInterviewRecordings";
import { cn } from "@/lib/utils";
import type {
  AIRecommendation,
  InterviewTranscript,
  TranscriptStatus,
} from "@/lib/types/interviews";

const STATUS_LABEL: Record<TranscriptStatus, string> = {
  pending: "In wachtrij",
  processing: "Wordt verwerkt",
  done: "Klaar",
  failed: "Mislukt",
  skipped: "Overgeslagen",
};

const STATUS_CLASS: Record<TranscriptStatus, string> = {
  pending: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  processing:
    "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  failed: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  skipped: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const RECOMMENDATION_META: Record<
  AIRecommendation,
  { label: string; cls: string }
> = {
  strong_yes: {
    label: "Strong Yes",
    cls: "bg-emerald-600 text-white",
  },
  yes: {
    label: "Yes",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  neutral: {
    label: "Neutraal",
    cls: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  no: {
    label: "No",
    cls: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  },
  strong_no: {
    label: "Strong No",
    cls: "bg-rose-600 text-white",
  },
};

export interface TranscriptViewerProps {
  recordingId: string;
  /** When provided, skip fetching. */
  transcript?: InterviewTranscript | null;
}

export function TranscriptViewer({
  recordingId,
  transcript: provided,
}: TranscriptViewerProps) {
  const fetched = useTranscript(provided ? null : recordingId);
  const transcript = provided ?? fetched.data;
  const isLoading = !provided && fetched.isLoading;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (!transcript) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Nog geen transcript beschikbaar.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StatusHeader
        status={transcript.status}
        language={transcript.language ?? null}
      />

      {transcript.status !== "done" ? (
        <ProcessingState status={transcript.status} />
      ) : (
        <>
          <SummarySection summary={transcript.summary ?? null} />
          <SignalsSection
            strengths={transcript.strengths ?? []}
            concerns={transcript.concerns ?? []}
          />
          <RecommendationSection rec={transcript.recommendation ?? null} />
          <FullTranscriptSection text={transcript.text ?? null} />
          <DownloadButtons
            recordingId={recordingId}
            text={transcript.text ?? null}
            summary={transcript.summary ?? null}
          />
        </>
      )}
    </div>
  );
}

function StatusHeader({
  status,
  language,
}: {
  status: TranscriptStatus;
  language: string | null;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold",
          STATUS_CLASS[status]
        )}
      >
        {status === "done" && <CheckCircle2 className="h-3.5 w-3.5" />}
        {status === "processing" && (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        )}
        {status === "pending" && <Clock className="h-3.5 w-3.5" />}
        {status === "skipped" && <MinusCircle className="h-3.5 w-3.5" />}
        {status === "failed" && <XCircle className="h-3.5 w-3.5" />}
        {STATUS_LABEL[status]}
      </span>
      {language && (
        <span className="text-xs text-muted-foreground">
          Taal: {language.toUpperCase()}
        </span>
      )}
    </div>
  );
}

function ProcessingState({ status }: { status: TranscriptStatus }) {
  if (status === "failed") {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 dark:bg-rose-950/30 dark:border-rose-900/40">
        <p className="text-sm text-rose-700 dark:text-rose-300 font-semibold">
          Transcriptie is mislukt
        </p>
        <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">
          Probeer de opname opnieuw te uploaden of neem contact op met support.
        </p>
      </div>
    );
  }
  if (status === "skipped") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:bg-zinc-900/40 dark:border-zinc-800">
        <p className="text-sm text-zinc-700 dark:text-zinc-300 font-semibold">
          Transcriptie overgeslagen
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Voor deze opname is geen transcript gegenereerd.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:bg-blue-950/30 dark:border-blue-900/40">
      <p className="text-sm text-blue-700 dark:text-blue-300 font-semibold flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Transcript wordt verwerkt…
      </p>
      <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
        Je krijgt een notificatie zodra de samenvatting klaar is. Dit duurt
        meestal 2–5 minuten per uur audio.
      </p>
    </div>
  );
}

function SummarySection({ summary }: { summary: string | null }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="h-4 w-4 text-purple-500" />
          Samenvatting (door AI)
          <AIBadge />
          <button
            type="button"
            className="ml-auto text-[11px] font-medium text-muted-foreground hover:text-zinc-900 dark:hover:text-zinc-100 underline-offset-2 hover:underline"
            onClick={() =>
              alert(
                "Override flow komt in Q3.5 — de recruiter kan de samenvatting dan overschrijven en de AI-versie wordt als revisie bewaard voor compliance."
              )
            }
          >
            AI-tekst overschrijven
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 whitespace-pre-line">
          {summary ?? "Nog geen AI-samenvatting gegenereerd voor deze opname."}
        </p>
      </CardContent>
    </Card>
  );
}

function SignalsSection({
  strengths,
  concerns,
}: {
  strengths: string[];
  concerns: string[];
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            <ThumbsUp className="h-4 w-4" />
            Sterktes
            <AIBadge className="ml-1" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {strengths.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Geen sterktes gedetecteerd.
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm text-zinc-700 dark:text-zinc-300">
              {strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            Aandachtspunten
            <AIBadge className="ml-1" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {concerns.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Geen aandachtspunten gedetecteerd.
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm text-zinc-700 dark:text-zinc-300">
              {concerns.map((c, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RecommendationSection({ rec }: { rec: AIRecommendation | null }) {
  if (!rec) return null;
  const meta = RECOMMENDATION_META[rec];
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ThumbsDown className="h-4 w-4 text-indigo-500" />
          Aanbeveling
          <AIBadge className="ml-1" />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <span
          className={cn(
            "inline-flex items-center rounded-md px-3 py-1.5 text-sm font-semibold",
            meta.cls
          )}
        >
          {meta.label}
        </span>
        <p className="text-xs text-muted-foreground mt-2">
          De AI-aanbeveling is een suggestie. De finale beslissing ligt altijd
          bij de recruiter (AVG / EU AI Act Art. 14).
        </p>
      </CardContent>
    </Card>
  );
}

function FullTranscriptSection({ text }: { text: string | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <CardTitle className="text-sm">Volledig transcript</CardTitle>
        </button>
      </CardHeader>
      {expanded && (
        <CardContent>
          <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400 whitespace-pre-line max-h-96 overflow-y-auto pr-2">
            {text}
          </p>
        </CardContent>
      )}
    </Card>
  );
}

function DownloadButtons({
  recordingId,
  text,
  summary,
}: {
  recordingId: string;
  text: string | null;
  summary: string | null;
}) {
  const downloadAs = (format: "txt" | "json" | "pdf") => {
    if (format === "pdf") {
      alert(
        "PDF-export komt in Q3.5 — momenteel kun je TXT of JSON downloaden en converteren."
      );
      return;
    }
    let blob: Blob;
    let filename: string;
    if (format === "json") {
      blob = new Blob(
        [
          JSON.stringify(
            { recording_id: recordingId, summary, text },
            null,
            2
          ),
        ],
        { type: "application/json" }
      );
      filename = `transcript-${recordingId}.json`;
    } else {
      const body =
        (summary ? `Samenvatting:\n${summary}\n\n` : "") + (text ?? "");
      blob = new Blob([body], { type: "text/plain;charset=utf-8" });
      filename = `transcript-${recordingId}.txt`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2_000);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground mr-1">Download:</span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => downloadAs("txt")}
        className="h-8"
      >
        <Download className="h-3.5 w-3.5 mr-1.5" /> TXT
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => downloadAs("pdf")}
        className="h-8"
      >
        <Download className="h-3.5 w-3.5 mr-1.5" /> PDF
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => downloadAs("json")}
        className="h-8"
      >
        <Download className="h-3.5 w-3.5 mr-1.5" /> JSON
      </Button>
    </div>
  );
}
