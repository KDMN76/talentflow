"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Mic,
  Shield,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { useUploadRecording } from "@/hooks/useInterviewRecordings";
import { cn } from "@/lib/utils";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const ACCEPTED_MIME = "audio/*";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface RecordingUploaderProps {
  interviewId: string;
  /** Called after a successful upload — host can refresh recordings list, etc. */
  onUploaded?: () => void;
}

export function RecordingUploader({
  interviewId,
  onUploaded,
}: RecordingUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadRecording(interviewId);
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setConsent(false);
    setProgress(0);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onPickFile = (f: File | null) => {
    setError(null);
    if (!f) return;
    if (!f.type.startsWith("audio/")) {
      setError("Alleen audio-bestanden zijn toegestaan.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(
        `Bestand is te groot (${formatBytes(f.size)}). Max ${formatBytes(MAX_BYTES)}.`
      );
      return;
    }
    setFile(f);
  };

  const handleUpload = async () => {
    if (!file || !consent) return;
    setError(null);
    setProgress(0);
    try {
      await upload.mutateAsync({
        file,
        consent_given: consent,
        onProgress: (p) => setProgress(p.percent),
      });
      toast({
        title: "Opname geüpload",
        description:
          "Transcriptie wordt verwerkt — je krijgt notificatie zodra klaar.",
      });
      reset();
      onUploaded?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Onbekende fout";
      setError(msg);
      toast({
        variant: "destructive",
        title: "Upload mislukt",
        description: msg,
      });
    }
  };

  const isUploading = upload.isPending;
  const canUpload = !!file && consent && !isUploading;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Mic className="h-4 w-4 text-rose-500" />
          Opname uploaden
        </CardTitle>
        <CardDescription>
          Upload een audio-bestand (max 25 MB). Wij transcriberen automatisch en
          genereren een AI-samenvatting met sterktes en aandachtspunten.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* File picker / drop area */}
        {!file ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full rounded-lg border-2 border-dashed border-border hover:border-indigo-400 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 p-8 transition-colors text-center"
          >
            <Upload className="h-6 w-6 mx-auto text-muted-foreground" />
            <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Klik om audio te kiezen
            </p>
            <p className="text-xs text-muted-foreground">
              MP3, M4A, WAV, OGG · max 25 MB
            </p>
          </button>
        ) : (
          <div className="rounded-lg border border-border p-3 flex items-center gap-3">
            <div className="rounded-md bg-indigo-50 dark:bg-indigo-950/40 h-10 w-10 flex items-center justify-center shrink-0">
              <Mic className="h-5 w-5 text-indigo-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                {file.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(file.size)}
              </p>
            </div>
            {!isUploading && (
              <Button variant="ghost" size="icon" onClick={reset}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_MIME}
          className="hidden"
          onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
        />

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/30 dark:border-rose-900/40 dark:text-rose-300 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Consent — required */}
        <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:bg-amber-950/20 dark:border-amber-900/40 cursor-pointer">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-input"
          />
          <div className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
            <span className="font-semibold flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              AVG-toestemming verplicht
            </span>
            <span className="block mt-1">
              Ik bevestig dat de kandidaat schriftelijk toestemming heeft gegeven
              voor opname van dit interview (AVG art. 6 + 7). Zonder deze
              toestemming is de opname niet rechtsgeldig en moet ze direct
              worden verwijderd.
            </span>
          </div>
        </label>

        {/* Progress bar during upload */}
        {isUploading && (
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                Uploaden…
              </span>
              <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                {progress}%
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all"
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            onClick={handleUpload}
            disabled={!canUpload}
            className="bg-indigo-600 hover:bg-indigo-700 border-0"
          >
            {isUploading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            )}
            Upload &amp; transcribeer
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
