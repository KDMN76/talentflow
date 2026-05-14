"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  Mail,
  Phone,
  FileText,
  Star,
  Briefcase,
  MessageCircle,
  Send,
  ScrollText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useCandidate } from "@/hooks/useCandidates";
import { useDuplicatesForCandidate } from "@/hooks/useDedupe";
import { MultiCVUpload } from "@/components/candidates/MultiCVUpload";
import { MergeCandidatesDialog } from "@/components/candidates/MergeCandidatesDialog";
import { CandidateCommunicationTab } from "@/components/candidates/CandidateCommunicationTab";
import { useCommunications, useSendMessage } from "@/hooks/useCommunications";
import type { CommunicationChannel } from "@/hooks/useCommunications";
import { ComposeEmailModal } from "@/components/communications/ComposeEmailModal";
import { useInitiateCall, useVoiceIntegration } from "@/hooks/useVoice";
import {
  useSendWhatsAppMessage,
  useWhatsAppConsentForCandidate,
  useWhatsAppIntegration,
} from "@/hooks/useWhatsApp";
import { Linkedin } from "lucide-react";
import { CandidateMatchesWidget } from "@/components/matching/CandidateMatchesWidget";
import { ScorecardForm } from "@/components/scorecards/ScorecardForm";
import { SkillProfileEditor } from "@/components/skills/SkillProfileEditor";
import { SkillsGapViewer } from "@/components/skills/SkillsGapViewer";
import { Merge, AlertCircle } from "lucide-react";
import { mockApplications, mockJobs, mockStages } from "@/lib/mockData";
import { cn, getInitials, getScoreColor, formatDate } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";
import Link from "next/link";

function formatMessageTime(sentAt: string): string {
  const date = new Date(sentAt);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isToday) {
    return date.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  }
  const isThisYear = date.getFullYear() === now.getFullYear();
  if (isThisYear) {
    return date.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  }
  return date.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

function ChannelIcon({ channel }: { channel: CommunicationChannel }) {
  if (channel === "email") return <Mail className="h-3.5 w-3.5 text-indigo-600 shrink-0" />;
  if (channel === "whatsapp") return <MessageCircle className="h-3.5 w-3.5 text-emerald-600 shrink-0" />;
  return <Phone className="h-3.5 w-3.5 text-blue-600 shrink-0" />;
}

export default function CandidateProfilePage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { toast } = useToast();
  const [isMessageOpen, setIsMessageOpen] = useState(false);
  const [isEmailOpen, setIsEmailOpen] = useState(false);
  const [messageChannel, setMessageChannel] = useState<CommunicationChannel>("email");
  const [messageBody, setMessageBody] = useState("");
  const [messageSubject, setMessageSubject] = useState("");

  const { data: candidate, isLoading, isError } = useCandidate(id);
  const { data: communications } = useCommunications(id);
  const { data: duplicates } = useDuplicatesForCandidate(id);
  const [mergeOpen, setMergeOpen] = useState(false);
  const sendMessage = useSendMessage();

  // Q4.6: voice + WhatsApp quick-actions
  const { data: voiceIntegration } = useVoiceIntegration();
  const { data: whatsAppIntegration } = useWhatsAppIntegration();
  const { data: waConsent } = useWhatsAppConsentForCandidate(id);
  const initiateCall = useInitiateCall();
  const sendWhatsApp = useSendWhatsAppMessage();
  const [waOpen, setWaOpen] = useState(false);
  const [waBody, setWaBody] = useState("");

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError || !candidate) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-lg font-semibold">Kandidaat niet gevonden</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => router.push("/candidates")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Terug naar kandidaten
        </Button>
      </div>
    );
  }

  const candidateApplications = mockApplications.filter(
    (a) => a.candidate_id === id
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back button + actions */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="text-muted-foreground hover:text-foreground -ml-2"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Terug
        </Button>
        <div className="flex items-center gap-2">
          {duplicates && duplicates.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMergeOpen(true)}
              className="gap-1.5 border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/30 dark:border-amber-900/40 dark:text-amber-300"
            >
              <Merge className="h-4 w-4" />
              Duplicaten ({duplicates.length})
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={!candidate.phone || voiceIntegration?.status !== "connected"}
            title={
              !candidate.phone
                ? "Geen telefoonnummer bekend"
                : voiceIntegration?.status !== "connected"
                ? "Twilio niet geconfigureerd — ga naar Instellingen → Voice"
                : "Direct bellen via Twilio"
            }
            onClick={async () => {
              const call = await initiateCall.mutateAsync({
                candidate_id: id,
                candidate_name:
                  candidate.name ||
                  `${candidate.first_name ?? ""} ${candidate.last_name ?? ""}`.trim(),
              });
              toast({
                title: "Bellen gestart",
                description: `Twilio-call ${call.id}`,
              });
              router.push(`/voice/calls/${call.id}`);
            }}
            className="gap-1.5"
          >
            <Phone className="h-4 w-4" />
            Bel
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={
              whatsAppIntegration?.status !== "connected" ||
              waConsent?.status !== "granted"
            }
            title={
              whatsAppIntegration?.status !== "connected"
                ? "WhatsApp niet geconfigureerd — ga naar Instellingen → WhatsApp"
                : waConsent?.status !== "granted"
                ? "Geen WhatsApp-toestemming van kandidaat"
                : "Stuur WhatsApp-bericht"
            }
            onClick={() => setWaOpen(true)}
            className="gap-1.5"
          >
            <MessageCircle className="h-4 w-4 text-emerald-600" />
            WhatsApp
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!candidate.email}
            title={
              !candidate.email
                ? "Kandidaat heeft geen e-mailadres"
                : "Stuur een gepersonaliseerde e-mail"
            }
            onClick={() => setIsEmailOpen(true)}
            className="gap-1.5"
          >
            <Mail className="h-4 w-4" />
            E-mail
          </Button>
          <Button
            variant="outline"
            size="sm"
            title="LinkedIn-profiel openen"
            onClick={() =>
              window.open(
                `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
                  candidate.name ||
                    `${candidate.first_name ?? ""} ${candidate.last_name ?? ""}`.trim()
                )}`,
                "_blank"
              )
            }
            className="gap-1.5"
          >
            <Linkedin className="h-4 w-4 text-blue-600" />
            LinkedIn
          </Button>
          <Link
            href={`/compliance/audit/candidate/${candidate.id}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            title="Bekijk de complete WORM audit-trail voor deze kandidaat"
          >
            <ScrollText className="h-4 w-4" />
            Audit-historie
          </Link>
        </div>
      </div>

      {duplicates && duplicates.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-900/40 px-4 py-3 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1 text-sm text-amber-900 dark:text-amber-200">
            <p className="font-medium">
              Mogelijke duplicaten gevonden ({duplicates.length})
            </p>
            <p className="text-xs mt-0.5 opacity-80">
              Deze kandidaat lijkt op {duplicates.map((d) => d.matched_name).join(", ")}.
              Bekijk en voeg samen om dubbele records te voorkomen.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-amber-300 bg-white text-amber-800 hover:bg-amber-100"
            onClick={() => setMergeOpen(true)}
          >
            Samenvoegen
          </Button>
        </div>
      )}

      {duplicates && duplicates.length > 0 && (
        <MergeCandidatesDialog
          primaryId={id}
          duplicateId={duplicates[0].matched_candidate_id}
          open={mergeOpen}
          onOpenChange={setMergeOpen}
        />
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: Candidate details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Profile card */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-start gap-5">
                <Avatar className="h-16 w-16 shrink-0">
                  <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-xl font-bold">
                    {getInitials(
                      candidate.name ||
                        `${candidate.first_name ?? ""} ${candidate.last_name ?? ""}`.trim()
                    )}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                      {candidate.name ||
                        `${candidate.first_name ?? ""} ${candidate.last_name ?? ""}`.trim()}
                    </h1>
                    {candidate.ai_score !== null && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-lg px-3 py-1 text-sm font-bold",
                          getScoreColor(candidate.ai_score)
                        )}
                      >
                        <Star className="h-3.5 w-3.5" />
                        AI Score: {candidate.ai_score}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-sm text-muted-foreground">
                    {candidate.email && (
                      <a
                        href={`mailto:${candidate.email}`}
                        className="flex items-center gap-1.5 hover:text-indigo-600 transition-colors"
                      >
                        <Mail className="h-4 w-4" />
                        {candidate.email}
                      </a>
                    )}
                    {candidate.phone && (
                      <a
                        href={`tel:${candidate.phone}`}
                        className="flex items-center gap-1.5 hover:text-indigo-600 transition-colors"
                      >
                        <Phone className="h-4 w-4" />
                        {candidate.phone}
                      </a>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge
                      variant="outline"
                      className="text-xs font-medium border-indigo-200 text-indigo-700 bg-indigo-50 dark:bg-indigo-950/30 dark:text-indigo-400 dark:border-indigo-800"
                    >
                      {candidate.source ?? "Onbekend"}
                    </Badge>
                    {(candidate.tags ?? []).map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="text-xs font-normal"
                      >
                        #{tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Skill profiel (ESCO) */}
          <SkillProfileEditor candidateId={candidate.id} />

          {/* Notes */}
          {candidate.notes && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Notities</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
                  {candidate.notes}
                </p>
              </CardContent>
            </Card>
          )}

          {/* CV's & AI-analyse */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-indigo-500" />
                CV&apos;s &amp; AI-analyse
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MultiCVUpload
                candidateId={candidate.id}
                candidateName={
                  candidate.name ||
                  `${candidate.first_name ?? ""} ${candidate.last_name ?? ""}`.trim() ||
                  "deze kandidaat"
                }
              />
            </CardContent>
          </Card>
          {/* Q4.6: Communicatie-tab (omni-channel timeline) */}
          <CandidateCommunicationTab
            candidateId={candidate.id}
            candidateName={
              candidate.name ||
              `${candidate.first_name ?? ""} ${candidate.last_name ?? ""}`.trim() ||
              "deze kandidaat"
            }
          />
          {/* Berichten */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Mail className="h-4 w-4 text-indigo-500" />
                  Berichten ({(communications ?? []).length})
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5"
                  onClick={() => setIsMessageOpen(true)}
                >
                  <Send className="h-3.5 w-3.5" />
                  Bericht sturen
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!communications || communications.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nog geen berichten
                </p>
              ) : (
                <div className="space-y-2">
                  {communications.map((msg) => (
                    <div
                      key={msg.id}
                      className="flex items-start gap-3 rounded-lg border border-border p-3 bg-zinc-50 dark:bg-zinc-800/40"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white dark:bg-zinc-800 border border-border mt-0.5">
                        <ChannelIcon channel={msg.channel} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                            {msg.direction === "outbound" ? "→ Verzonden" : "← Ontvangen"}
                          </span>
                        </div>
                        <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-snug mt-0.5 truncate">
                          {msg.body.length > 80 ? msg.body.slice(0, 80) + "…" : msg.body}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 mt-0.5">
                        {formatMessageTime(msg.sent_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Scorecards — toon alleen voor de eerste actieve sollicitatie */}
          {candidateApplications.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Star className="h-4 w-4 text-amber-500" />
                  Scorecards
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Beoordelingen voor sollicitatie op{" "}
                  {mockJobs.find((j) => j.id === candidateApplications[0].job_id)?.title ?? "vacature"}
                </p>
              </CardHeader>
              <CardContent>
                <ScorecardForm
                  applicationId={candidateApplications[0].id}
                  jobId={candidateApplications[0].job_id}
                  stageId={candidateApplications[0].stage_id}
                />
              </CardContent>
            </Card>
          )}

          {/* Bericht sturen Dialog */}
          <Dialog open={isMessageOpen} onOpenChange={setIsMessageOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  Bericht sturen aan{" "}
                  {candidate?.name ||
                    `${candidate?.first_name ?? ""} ${candidate?.last_name ?? ""}`.trim()}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 py-2">
                {/* Channel selector */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Kanaal
                  </label>
                  <div className="flex gap-2">
                    {(["email", "whatsapp", "sms"] as CommunicationChannel[]).map((ch) => {
                      const labels: Record<CommunicationChannel, string> = {
                        email: "E-mail",
                        whatsapp: "WhatsApp",
                        sms: "SMS",
                      };
                      return (
                        <button
                          key={ch}
                          type="button"
                          onClick={() => setMessageChannel(ch)}
                          className={cn(
                            "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                            messageChannel === ch
                              ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-600"
                              : "border-border bg-background text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                          )}
                        >
                          {labels[ch]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Subject (email only) */}
                {messageChannel === "email" && (
                  <div className="space-y-1.5">
                    <label
                      htmlFor="msg-subject"
                      className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      Onderwerp
                    </label>
                    <input
                      id="msg-subject"
                      type="text"
                      value={messageSubject}
                      onChange={(e) => setMessageSubject(e.target.value)}
                      placeholder="Onderwerp van het e-mailbericht"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                    />
                  </div>
                )}

                {/* Body */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="msg-body"
                    className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Bericht
                  </label>
                  <textarea
                    id="msg-body"
                    value={messageBody}
                    onChange={(e) => setMessageBody(e.target.value)}
                    placeholder="Typ hier je bericht…"
                    rows={4}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition resize-none"
                  />
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsMessageOpen(false)}
                  disabled={sendMessage.isPending}
                >
                  Annuleren
                </Button>
                <Button
                  disabled={!messageBody.trim() || sendMessage.isPending}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
                  onClick={async () => {
                    await sendMessage.mutateAsync({
                      candidateId: id,
                      channel: messageChannel,
                      body: messageBody.trim(),
                      subject: messageChannel === "email" ? messageSubject.trim() || undefined : undefined,
                    });
                    toast({
                      title: "Bericht verzonden",
                      description: `Je bericht is verstuurd via ${messageChannel === "email" ? "e-mail" : messageChannel === "whatsapp" ? "WhatsApp" : "SMS"}.`,
                    });
                    setIsMessageOpen(false);
                    setMessageBody("");
                    setMessageSubject("");
                    setMessageChannel("email");
                  }}
                >
                  <Send className="h-3.5 w-3.5" />
                  {sendMessage.isPending ? "Versturen…" : "Versturen"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Right: Applications */}
        <div className="space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-indigo-500" />
                Sollicitaties ({candidateApplications.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {candidateApplications.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Geen sollicitaties
                </p>
              ) : (
                candidateApplications.map((app) => {
                  const job = mockJobs.find((j) => j.id === app.job_id);
                  const stage = mockStages.find((s) => s.id === app.stage_id);
                  return (
                    <div
                      key={app.id}
                      className="rounded-lg border border-border p-3 space-y-3"
                    >
                      <Link
                        href={`/jobs/${app.job_id}/pipeline`}
                        className="block group"
                      >
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 group-hover:text-indigo-600 transition-colors">
                          {job?.title ?? "Onbekende vacature"}
                        </p>
                        <div className="mt-1.5 flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            {stage && (
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ background: stage.color }}
                              />
                            )}
                            <span className="text-xs text-muted-foreground">
                              {stage?.name ?? "Onbekend"}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(app.applied_at)}
                          </span>
                        </div>
                      </Link>
                      <div className="border-t border-border/60 pt-3">
                        <SkillsGapViewer
                          jobId={app.job_id}
                          candidateId={candidate.id}
                          unwrapped
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* AI vacature-matches voor deze kandidaat */}
          <CandidateMatchesWidget
            candidateId={candidate.id}
            candidateName={
              candidate.name ||
              `${candidate.first_name ?? ""} ${candidate.last_name ?? ""}`.trim() ||
              "deze kandidaat"
            }
          />

          {/* Timeline */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Tijdlijn</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="h-2 w-2 rounded-full bg-indigo-500 mt-1.5" />
                    <div className="w-px flex-1 bg-border mt-1.5" />
                  </div>
                  <div className="pb-4">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      Kandidaat aangemaakt
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDate(candidate.created_at)}
                    </p>
                  </div>
                </div>
                {candidateApplications.map((app, i) => {
                  const job = mockJobs.find((j) => j.id === app.job_id);
                  return (
                    <div key={app.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="h-2 w-2 rounded-full bg-purple-500 mt-1.5" />
                        {i < candidateApplications.length - 1 && (
                          <div className="w-px flex-1 bg-border mt-1.5" />
                        )}
                      </div>
                      <div className={i < candidateApplications.length - 1 ? "pb-4" : ""}>
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          Gesolliciteerd: {job?.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatDate(app.applied_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Compose email modal */}
      <ComposeEmailModal
        open={isEmailOpen}
        onOpenChange={setIsEmailOpen}
        candidate={{
          id: candidate.id,
          name:
            candidate.name ||
            `${candidate.first_name ?? ""} ${candidate.last_name ?? ""}`.trim() ||
            "Onbekend",
          email: candidate.email,
          first_name: candidate.first_name,
          last_name: candidate.last_name,
        }}
      />

      {/* Q4.6: WhatsApp compose modal */}
      <Dialog open={waOpen} onOpenChange={setWaOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              WhatsApp aan{" "}
              {candidate.name ||
                `${candidate.first_name ?? ""} ${candidate.last_name ?? ""}`.trim()}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <textarea
              value={waBody}
              onChange={(e) => setWaBody(e.target.value)}
              placeholder="Typ je WhatsApp-bericht…"
              rows={5}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition resize-none"
            />
            <p className="text-[11px] text-muted-foreground">
              Verzonden vanaf {whatsAppIntegration?.phone_number ?? "—"}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaOpen(false)}>
              Annuleren
            </Button>
            <Button
              disabled={!waBody.trim() || sendWhatsApp.isPending}
              onClick={async () => {
                await sendWhatsApp.mutateAsync({
                  candidate_id: id,
                  kind: "text",
                  body: waBody.trim(),
                });
                toast({
                  title: "WhatsApp verzonden",
                  description: `Naar ${candidate.name}`,
                });
                setWaBody("");
                setWaOpen(false);
              }}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            >
              <MessageCircle className="h-4 w-4" />
              {sendWhatsApp.isPending ? "Versturen…" : "Versturen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
