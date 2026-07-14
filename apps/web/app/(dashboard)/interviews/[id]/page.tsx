"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Edit3,
  Loader2,
  MapPin,
  Mic,
  Phone,
  Send,
  Star,
  Users,
  Video,
  X,
  XCircle,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { AgreementMatrixView } from "@/components/interviews/AgreementMatrixView";
import { RecordingUploader } from "@/components/interviews/RecordingUploader";
import { TranscriptViewer } from "@/components/interviews/TranscriptViewer";
import {
  useCancelInterview,
  useInterview,
  useRescheduleInterview,
} from "@/hooks/useInterviews";
import { useInterviewKit } from "@/hooks/useInterviewKits";
import { useRecordings } from "@/hooks/useInterviewRecordings";
import { useScorecardsForApplication } from "@/hooks/useScorecards";
import { cn, getInitials } from "@/lib/utils";
import type {
  Interview,
  InterviewLocationType,
} from "@/lib/types/interviews";

const LOC_ICON: Record<InterviewLocationType, typeof Video> = {
  google_meet: Video,
  teams: Video,
  zoom: Video,
  in_person: MapPin,
  phone: Phone,
};

const STATUS_BADGE: Record<Interview["status"], { cls: string }> = {
  scheduled: {
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  },
  rescheduled: {
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
  completed: {
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  no_show: {
    cls: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  cancelled: {
    cls: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  },
};

export default function InterviewDetailPage() {
  const { t } = useTranslation("interviewKits");
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: interview, isLoading } = useInterview(params.id);
  const { data: recordings } = useRecordings(params.id);
  const cancel = useCancelInterview();
  const reschedule = useRescheduleInterview();
  const { toast } = useToast();
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!interview) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {t("interview.notFound.label")}
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => router.push("/interviews")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("interview.notFound.back")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/interviews"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("interview.back")}
      </Link>

      {/* Header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/40 h-16 w-16 flex flex-col items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
              <span className="text-xs font-semibold uppercase">
                {new Date(interview.scheduled_start).toLocaleDateString(
                  "nl-NL",
                  { month: "short" }
                )}
              </span>
              <span className="text-2xl font-bold leading-none">
                {new Date(interview.scheduled_start).getDate()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold tracking-tight">
                  {interview.candidate_name}
                </h1>
                <Badge
                  className={cn(
                    "border-transparent rounded-md text-[10px] uppercase tracking-wide",
                    (STATUS_BADGE[interview.status] ?? STATUS_BADGE.scheduled).cls
                  )}
                >
                  {t(`interview.status.${interview.status}`)}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {interview.job_title}
              </p>
              <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatLong(interview.scheduled_start)} ·{" "}
                  {t("interview.duration", {
                    count: interview.duration_minutes,
                  })}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {interview.timezone}
                </span>
              </div>
            </div>
            {interview.status === "scheduled" && (
              <div className="flex gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRescheduleOpen(true)}
                >
                  <Edit3 className="h-3.5 w-3.5 mr-1.5" />{" "}
                  {t("interview.actions.reschedule")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmCancelOpen(true)}
                  className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                >
                  <X className="h-3.5 w-3.5 mr-1.5" />{" "}
                  {t("interview.actions.cancel")}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">
            {t("interview.tabs.details")}
          </TabsTrigger>
          <TabsTrigger value="questions">
            {t("interview.tabs.questions")}
          </TabsTrigger>
          <TabsTrigger value="recording">
            {t("interview.tabs.recording")}
            {(recordings ?? []).length > 0 && (
              <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-rose-500" />
            )}
          </TabsTrigger>
          <TabsTrigger value="scorecards">
            {t("interview.tabs.scorecards")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-4">
          <DetailsPanel interview={interview} />
        </TabsContent>

        <TabsContent value="questions" className="mt-4">
          <QuestionsPanel kitId={interview.interview_kit_id ?? null} />
        </TabsContent>

        <TabsContent value="recording" className="mt-4 space-y-4">
          {(recordings ?? []).length === 0 ? (
            <RecordingUploader interviewId={interview.id} />
          ) : (
            <div className="space-y-4">
              {(recordings ?? []).map((rec) => (
                <Card key={rec.id}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Mic className="h-4 w-4 text-rose-500" />
                      {rec.filename}
                    </CardTitle>
                    <CardDescription>
                      {formatBytes(rec.size_bytes)} ·{" "}
                      {formatDuration(rec.duration_seconds)}
                      {rec.uploaded_at && (
                        <>
                          {" · "}
                          {t("interview.recording.uploadedAt", {
                            date: formatLong(rec.uploaded_at),
                          })}
                        </>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <TranscriptViewer recordingId={rec.id} />
                  </CardContent>
                </Card>
              ))}
              <RecordingUploader interviewId={interview.id} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="scorecards" className="mt-4">
          <ScorecardsPanel interview={interview} />
        </TabsContent>
      </Tabs>

      {/* Cancel confirm */}
      <CancelDialog
        open={confirmCancelOpen}
        onOpenChange={setConfirmCancelOpen}
        onConfirm={async (reason) => {
          await cancel.mutateAsync({ id: interview.id, reason });
          toast({
            title: t("interview.toasts.cancelled"),
            description: reason
              ? t("interview.toasts.cancelledReason", { reason })
              : t("interview.toasts.cancelledDefault"),
          });
          setConfirmCancelOpen(false);
        }}
        loading={cancel.isPending}
      />

      {/* Reschedule */}
      <RescheduleDialog
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
        currentStart={interview.scheduled_start}
        onConfirm={async (start) => {
          // Backend needs both start and end — derive end from the existing
          // interview duration.
          const end = new Date(
            new Date(start).getTime() + interview.duration_minutes * 60_000
          ).toISOString();
          await reschedule.mutateAsync({
            id: interview.id,
            scheduled_start: start,
            scheduled_end: end,
          });
          toast({
            title: t("interview.toasts.rescheduled"),
            description: formatLong(start),
          });
          setRescheduleOpen(false);
        }}
        loading={reschedule.isPending}
      />
    </div>
  );
}

// ─── Details panel ──────────────────────────────────────────────────────────

function DetailsPanel({ interview }: { interview: Interview }) {
  const { t } = useTranslation("interviewKits");
  const LocIcon =
    (interview.location_type && LOC_ICON[interview.location_type]) || Video;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <LocIcon className="h-4 w-4 text-purple-500" />
            {t("interview.details.locationTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm font-semibold">
            {interview.location_type
              ? t(`interview.locations.${interview.location_type}`)
              : "Onbekend"}
          </p>
          {interview.meeting_url && (
            <a
              href={interview.meeting_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline mt-1 block break-all"
            >
              {interview.meeting_url}
            </a>
          )}
          {interview.location && (
            <p className="text-xs text-muted-foreground mt-1">
              {interview.location}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4 text-indigo-500" />
            {t("interview.details.interviewersTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {(interview.participants ?? [])
              .filter((p) => (p.participant_type ?? p.role) !== "candidate")
              .map((p) => {
                const label = p.user_name ?? p.email ?? "Onbekend";
                const type = p.participant_type ?? p.role ?? "interviewer";
                return (
                  <div key={p.id} className="flex items-center gap-2.5">
                    <Avatar className="h-7 w-7 shrink-0">
                      <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-[10px] font-semibold">
                        {getInitials(label)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">{label}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {t(`interview.participantTypes.${type}`, {
                          defaultValue: type,
                        })}
                      </p>
                    </div>
                  </div>
                );
              })}
          </div>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Star className="h-4 w-4 text-amber-500" />
            {t("interview.details.kitTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {interview.kit ? (
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{interview.kit.name}</p>
              <Link
                href={`/interview-kits/${interview.kit.id}`}
                className="text-xs text-indigo-600 hover:underline"
              >
                {t("interview.details.kitView")}
              </Link>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("interview.details.noKit")}
            </p>
          )}
        </CardContent>
      </Card>

      {interview.notes && (
        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              {t("interview.details.notesTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-line text-zinc-700 dark:text-zinc-300">
              {interview.notes}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Questions panel ────────────────────────────────────────────────────────

function QuestionsPanel({ kitId }: { kitId: string | null }) {
  const { t } = useTranslation("interviewKits");
  const { data: kit, isLoading } = useInterviewKit(kitId);

  if (!kitId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t("interview.questionsPanel.noKit")}
        </CardContent>
      </Card>
    );
  }
  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }
  if (!kit) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t("interview.questionsPanel.kitNotFound")}
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{kit.name}</CardTitle>
          {kit.description && (
            <CardDescription>{kit.description}</CardDescription>
          )}
        </CardHeader>
      </Card>
      {kit.questions.map((q, i) => (
        <Card key={q.id}>
          <CardContent className="pt-5">
            <div className="flex items-start gap-3">
              <span className="rounded-md bg-indigo-100 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 h-7 w-7 flex items-center justify-center text-xs font-bold shrink-0">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <Badge variant="info" className="text-[10px] uppercase">
                    {q.category}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    ~{q.expected_duration_minutes} min
                  </span>
                </div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {q.text}
                </p>
                {q.evaluation_criteria && (
                  <p className="text-xs text-muted-foreground mt-1.5">
                    <span className="font-semibold">
                      {t("interview.questionsPanel.evaluateOn")}
                    </span>
                    {q.evaluation_criteria}
                  </p>
                )}
                {q.suggested_followups.length > 0 && (
                  <div className="mt-2 rounded-md bg-zinc-50 dark:bg-zinc-900/40 px-2.5 py-1.5 border border-border">
                    <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">
                      {t("interview.questionsPanel.followupsTitle")}
                    </p>
                    <ul className="space-y-0.5">
                      {q.suggested_followups.map((f, j) => (
                        <li
                          key={j}
                          className="text-xs text-zinc-600 dark:text-zinc-400 flex items-start gap-1.5"
                        >
                          <span className="text-indigo-500">↳</span>
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Scorecards panel ───────────────────────────────────────────────────────

function ScorecardsPanel({ interview }: { interview: Interview }) {
  const { t } = useTranslation("interviewKits");
  const { data: scorecards = [] } = useScorecardsForApplication(
    interview.application_id
  );
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Star className="h-4 w-4 text-amber-500" />
            {t("interview.scorecards.title", { count: scorecards.length })}
          </CardTitle>
          <CardDescription>
            {t("interview.scorecards.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {scorecards.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {t("interview.scorecards.empty")}
              <Link
                href={`/candidates/${interview.candidate_id}`}
                className="block mt-2 text-xs text-indigo-600 hover:underline"
              >
                {t("interview.scorecards.openCandidate")}
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {scorecards.map((sc) => (
                <div
                  key={sc.id}
                  className="rounded-md border border-border p-3 flex items-center gap-3"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-[10px] font-semibold">
                      {getInitials(sc.user_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {sc.user_name}
                    </p>
                    <p className="text-[11px] text-muted-foreground capitalize">
                      {sc.recommendation.replace("_", " ")}
                    </p>
                  </div>
                  <span className="text-base font-bold text-indigo-600 dark:text-indigo-400">
                    {sc.overall_score.toFixed(1)}
                    <span className="text-xs text-muted-foreground">
                      {t("interview.scorecards.scoreSuffix")}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {scorecards.length >= 2 && (
        <AgreementMatrixView applicationId={interview.application_id} />
      )}
    </div>
  );
}

// ─── Cancel + reschedule dialogs ────────────────────────────────────────────

function CancelDialog({
  open,
  onOpenChange,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  onConfirm: (reason: string) => Promise<void>;
  loading: boolean;
}) {
  const { t } = useTranslation("interviewKits");
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("interview.cancelDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("interview.cancelDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="cancel-reason">
            {t("interview.cancelDialog.reasonLabel")}
          </Label>
          <Input
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("interview.cancelDialog.reasonPlaceholder")}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("interview.cancelDialog.keep")}
          </Button>
          <Button
            onClick={() => onConfirm(reason)}
            disabled={loading}
            className="bg-rose-600 hover:bg-rose-700"
          >
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t("interview.cancelDialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RescheduleDialog({
  open,
  onOpenChange,
  currentStart,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  currentStart: string;
  onConfirm: (newStart: string) => Promise<void>;
  loading: boolean;
}) {
  const { t } = useTranslation("interviewKits");
  // Pre-fill datetime-local value with the current start (truncate seconds + Z).
  const [value, setValue] = useState(() => {
    const d = new Date(currentStart);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("interview.rescheduleDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("interview.rescheduleDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="new-start">
            {t("interview.rescheduleDialog.newStartLabel")}
          </Label>
          <Input
            id="new-start"
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("interview.rescheduleDialog.cancel")}
          </Button>
          <Button
            onClick={() => onConfirm(new Date(value).toISOString())}
            disabled={loading || !value}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t("interview.rescheduleDialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatLong(iso: string): string {
  return new Date(iso).toLocaleString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(b: number | null | undefined): string {
  if (b == null) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(s: number | null | undefined): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}u ${m % 60}m`;
}
