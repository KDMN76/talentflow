"use client";

/**
 * Sprint Q4.6 — Voice (Twilio) settings page.
 *
 * - Connection card: status pill, phone number, account SID, disconnect.
 * - Not connected: connect form with account_sid + auth_token + phone_number.
 * - "Test-bellen" button: kies kandidaat → starts mock call → live status
 *    progression badge (queued → ringing → in_progress → completed).
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import { Check, ExternalLink, Phone, Plug, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  CallStatusBadge,
  formatCallDuration,
} from "@/components/voice/CallStatusBadge";
import {
  useConnectVoice,
  useDisconnectVoice,
  useInitiateCall,
  useVoiceCall,
  useVoiceCalls,
  useVoiceIntegration,
  type VoiceCall as VoiceCallType,
} from "@/hooks/useVoice";
import { useCandidates } from "@/hooks/useCandidates";

export default function VoiceSettingsPage() {
  const { t } = useTranslation("settingsVoice");
  const { data: state, isLoading } = useVoiceIntegration();
  const integration = state?.integration ?? null;
  const serviceActive = state?.serviceActive ?? true;
  const [testOpen, setTestOpen] = useState(false);

  // Eerlijke bevroren-feature-staat: in deze omgeving belt TalentFlow niet
  // echt — geen verbind-formulier of test-bel-knop die anders suggereert.
  if (!isLoading && !serviceActive) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title={t("page.title")}
          description={t("page.description")}
        />
        <NotActivatedCard />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
        actions={
          integration?.status === "connected" && (
            <Button onClick={() => setTestOpen(true)} className="gap-1.5">
              <Phone className="h-4 w-4" /> {t("page.testCall")}
            </Button>
          )
        }
      />

      {isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : integration?.status === "connected" ? (
        <ConnectedCard integration={integration} />
      ) : (
        <ConnectForm />
      )}

      {integration?.status === "connected" && (
        <>
          <CallsList />
          {testOpen && <TestCallDialog onClose={() => setTestOpen(false)} />}
        </>
      )}
    </div>
  );
}

/**
 * Eerlijke staat voor omgevingen waar Voice (nog) niet is geactiveerd.
 */
function NotActivatedCard() {
  const { t } = useTranslation("settingsVoice");
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
          <Phone className="h-7 w-7 text-zinc-400" />
        </div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {t("notActivated.title")}
        </h2>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          {t("notActivated.body")}
        </p>
      </CardContent>
    </Card>
  );
}

function ConnectedCard({
  integration,
}: {
  integration: import("@/lib/types/voice").VoiceIntegration;
}) {
  const { t } = useTranslation("settingsVoice");
  const { toast } = useToast();
  const disconnect = useDisconnectVoice();
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="grid gap-4 p-6 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
            <Badge className="border-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              {t("connected.badge")}
            </Badge>
          </div>
          <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("connected.phoneLabel")}
          </p>
          <p className="font-mono text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {integration.phone_number}
          </p>
        </div>
        <div className="sm:col-span-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("connected.accountSidLabel")}
          </p>
          <p className="mt-1 truncate font-mono text-xs text-zinc-700 dark:text-zinc-300">
            {integration.account_sid ?? "—"}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t("connected.connectedSince")}{" "}
            {integration.connected_at
              ? new Date(integration.connected_at).toLocaleDateString("nl-NL", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })
              : "—"}
          </p>
        </div>
        <div className="flex flex-col items-end justify-between gap-2 sm:col-span-1">
          <Link
            href="https://console.twilio.com"
            target="_blank"
            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
          >
            {t("connected.twilioConsole")} <ExternalLink className="h-3 w-3" />
          </Link>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              disconnect.mutate(undefined, {
                onSuccess: () => toast({ title: t("connected.disconnectedToast") }),
              })
            }
            className="text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            {t("connected.disconnect")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectForm() {
  const { t } = useTranslation("settingsVoice");
  const { toast } = useToast();
  const connect = useConnectVoice();
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [phone, setPhone] = useState("");

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="space-y-5 p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300">
            <Plug className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {t("connectForm.title")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("connectForm.introPrefix")}{" "}
              <Link
                href="https://console.twilio.com"
                target="_blank"
                className="text-indigo-600 hover:underline"
              >
                {t("connectForm.consoleLinkText")}
              </Link>{" "}
              {t("connectForm.introSuffix")}
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="v-sid">{t("connectForm.accountSidLabel")}</Label>
            <Input
              id="v-sid"
              placeholder={t("connectForm.accountSidPlaceholder")}
              value={accountSid}
              onChange={(e) => setAccountSid(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-token">{t("connectForm.authTokenLabel")}</Label>
            <Input
              id="v-token"
              type="password"
              placeholder="••••••••••••••••"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="v-phone">{t("connectForm.phoneLabel")}</Label>
            <Input
              id="v-phone"
              placeholder={t("connectForm.phonePlaceholder")}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
        <Button
          onClick={() => {
            if (!accountSid || !authToken || !phone) {
              toast({
                title: t("connectForm.requiredToast.title"),
                description: t("connectForm.requiredToast.description"),
                variant: "destructive",
              });
              return;
            }
            connect.mutate(
              { account_sid: accountSid, auth_token: authToken, phone_number: phone },
              {
                onSuccess: () =>
                  toast({
                    title: t("connectForm.connectedToast.title"),
                    description: t("connectForm.connectedToast.description"),
                  }),
              }
            );
          }}
          disabled={connect.isPending}
          className="gap-1.5"
        >
          <Check className="h-4 w-4" />
          {connect.isPending ? t("connectForm.connecting") : t("connectForm.connect")}
        </Button>
      </CardContent>
    </Card>
  );
}

function CallsList() {
  const { t } = useTranslation("settingsVoice");
  const { data: calls, isLoading } = useVoiceCalls();

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-0">
        <div className="border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t("calls.title")}
          </h3>
        </div>
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : !calls || calls.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {t("calls.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {calls.slice(0, 12).map((c) => (
              <li key={c.id}>
                <Link
                  href={`/voice/calls/${c.id}`}
                  className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                >
                  <Phone
                    className={cn(
                      "h-4 w-4",
                      c.direction === "inbound"
                        ? "text-emerald-600"
                        : "text-purple-600"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {c.candidate_name ?? c.candidate_id}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {c.direction === "inbound"
                        ? t("calls.inboundFrom", { number: c.from_number })
                        : t("calls.outboundTo", { number: c.to_number })}{" "}
                      · {new Date(c.created_at).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" })}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatCallDuration(c.duration_seconds)}
                  </span>
                  <CallStatusBadge status={c.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TestCallDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("settingsVoice");
  const { toast } = useToast();
  const initiate = useInitiateCall();
  const [candidateId, setCandidateId] = useState("");
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const { data: liveCall } = useVoiceCall(activeCallId ?? undefined);
  const { data: candidates, isLoading: candidatesLoading } = useCandidates();

  // Auto-close 4s after completion
  useEffect(() => {
    if (liveCall?.status === "completed") {
      const id = setTimeout(() => onClose(), 4_000);
      return () => clearTimeout(id);
    }
  }, [liveCall?.status, onClose]);

  const handleStart = async () => {
    if (!candidateId) return;
    const c = (candidates ?? []).find((x) => x.id === candidateId);
    const call = await initiate.mutateAsync({
      candidate_id: candidateId,
      candidate_name: c?.name,
    });
    setActiveCallId(call.id);
    toast({ title: t("testDialog.startedToast"), description: c?.name });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("testDialog.title")}</DialogTitle>
        </DialogHeader>
        {!activeCallId ? (
          <div className="space-y-3">
            <Label>{t("testDialog.candidateLabel")}</Label>
            <Select value={candidateId} onValueChange={setCandidateId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    candidatesLoading
                      ? t("testDialog.candidatesLoading")
                      : !candidates || candidates.length === 0
                        ? t("testDialog.noCandidates")
                        : t("testDialog.selectCandidate")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {(candidates ?? []).slice(0, 20).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} {c.phone ? `· ${c.phone}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <LiveCallView call={liveCall ?? null} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("testDialog.close")}
          </Button>
          {!activeCallId && (
            <Button onClick={handleStart} disabled={!candidateId}>
              <Phone className="mr-1 h-4 w-4" /> {t("testDialog.call")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LiveCallView({ call }: { call: VoiceCallType | null }) {
  const { t } = useTranslation("settingsVoice");
  if (!call) return <Skeleton className="h-24 rounded-lg" />;
  return (
    <div className="space-y-3 rounded-lg border border-border bg-zinc-50/60 p-4 dark:bg-zinc-800/30">
      <div className="flex items-center gap-2">
        <Phone
          className={cn(
            "h-5 w-5",
            (call.status === "ringing" || call.status === "in_progress") &&
              "animate-pulse text-emerald-500",
            call.status === "completed" && "text-emerald-600",
            call.status === "queued" && "text-zinc-500"
          )}
        />
        <CallStatusBadge status={call.status} />
        {call.duration_seconds > 0 && (
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {formatCallDuration(call.duration_seconds)}
          </span>
        )}
      </div>
      <p className="text-sm">
        <span className="font-medium">{call.candidate_name ?? call.candidate_id}</span>{" "}
        — <span className="font-mono text-xs text-muted-foreground">{call.to_number}</span>
      </p>
      {call.status === "completed" && call.transcription_status === "pending" && (
        <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
          <Sparkles className="h-3 w-3 animate-pulse" /> {t("liveCall.transcriptionPending")}
        </p>
      )}
      {call.transcription_status === "done" && call.transcription_text && (
        <p className="rounded bg-white p-2 text-[11px] leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          <strong>{t("liveCall.transcriptionLabel")}</strong> {call.transcription_text}
        </p>
      )}
    </div>
  );
}
