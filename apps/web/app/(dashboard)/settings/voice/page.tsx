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
import { mockCandidates } from "@/lib/mockData";

export default function VoiceSettingsPage() {
  const { data: integration, isLoading } = useVoiceIntegration();
  const [testOpen, setTestOpen] = useState(false);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Voice & VoIP"
        description="Verbind Twilio en bel kandidaten direct vanuit TalentFlow."
        actions={
          integration?.status === "connected" && (
            <Button onClick={() => setTestOpen(true)} className="gap-1.5">
              <Phone className="h-4 w-4" /> Test-bellen
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

function ConnectedCard({
  integration,
}: {
  integration: import("@/lib/types/voice").VoiceIntegration;
}) {
  const { toast } = useToast();
  const disconnect = useDisconnectVoice();
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="grid gap-4 p-6 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
            <Badge className="border-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              Verbonden
            </Badge>
          </div>
          <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Telefoonnummer
          </p>
          <p className="font-mono text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {integration.phone_number}
          </p>
        </div>
        <div className="sm:col-span-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Twilio Account SID
          </p>
          <p className="mt-1 truncate font-mono text-xs text-zinc-700 dark:text-zinc-300">
            {integration.account_sid ?? "—"}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Verbonden sinds{" "}
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
            Twilio console <ExternalLink className="h-3 w-3" />
          </Link>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              disconnect.mutate(undefined, {
                onSuccess: () => toast({ title: "Verbinding verbroken" }),
              })
            }
            className="text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            Ontkoppelen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectForm() {
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
              Verbind je Twilio-account
            </h2>
            <p className="text-xs text-muted-foreground">
              Voer je Twilio-credentials in. Vind ze in de{" "}
              <Link
                href="https://console.twilio.com"
                target="_blank"
                className="text-indigo-600 hover:underline"
              >
                Twilio Console
              </Link>{" "}
              onder Account → API keys.
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="v-sid">Account SID</Label>
            <Input
              id="v-sid"
              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              value={accountSid}
              onChange={(e) => setAccountSid(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-token">Auth Token</Label>
            <Input
              id="v-token"
              type="password"
              placeholder="••••••••••••••••"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="v-phone">Telefoonnummer</Label>
            <Input
              id="v-phone"
              placeholder="+31 20 1234 5678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
        <Button
          onClick={() => {
            if (!accountSid || !authToken || !phone) {
              toast({
                title: "Verplichte velden",
                description: "Vul Account SID, Auth Token en telefoonnummer in.",
                variant: "destructive",
              });
              return;
            }
            connect.mutate(
              { account_sid: accountSid, auth_token: authToken, phone_number: phone },
              {
                onSuccess: () =>
                  toast({
                    title: "Verbonden",
                    description: "Twilio is nu actief.",
                  }),
              }
            );
          }}
          disabled={connect.isPending}
          className="gap-1.5"
        >
          <Check className="h-4 w-4" />
          {connect.isPending ? "Verbinden…" : "Verbinden"}
        </Button>
      </CardContent>
    </Card>
  );
}

function CallsList() {
  const { data: calls, isLoading } = useVoiceCalls();

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-0">
        <div className="border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Recente gesprekken
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
            Nog geen gesprekken gevoerd.
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
                        ? `Inkomend van ${c.from_number}`
                        : `Uitgaand naar ${c.to_number}`}{" "}
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
  const { toast } = useToast();
  const initiate = useInitiateCall();
  const [candidateId, setCandidateId] = useState("");
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const { data: liveCall } = useVoiceCall(activeCallId ?? undefined);

  // Auto-close 4s after completion
  useEffect(() => {
    if (liveCall?.status === "completed") {
      const id = setTimeout(() => onClose(), 4_000);
      return () => clearTimeout(id);
    }
  }, [liveCall?.status, onClose]);

  const handleStart = async () => {
    if (!candidateId) return;
    const c = mockCandidates.find((x) => x.id === candidateId);
    const call = await initiate.mutateAsync({
      candidate_id: candidateId,
      candidate_name: c?.name,
    });
    setActiveCallId(call.id);
    toast({ title: "Test-call gestart", description: c?.name });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Test-bellen</DialogTitle>
        </DialogHeader>
        {!activeCallId ? (
          <div className="space-y-3">
            <Label>Bel kandidaat</Label>
            <Select value={candidateId} onValueChange={setCandidateId}>
              <SelectTrigger>
                <SelectValue placeholder="Kies een kandidaat…" />
              </SelectTrigger>
              <SelectContent>
                {mockCandidates.slice(0, 20).map((c) => (
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
            Sluiten
          </Button>
          {!activeCallId && (
            <Button onClick={handleStart} disabled={!candidateId}>
              <Phone className="mr-1 h-4 w-4" /> Bellen
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LiveCallView({ call }: { call: VoiceCallType | null }) {
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
          <Sparkles className="h-3 w-3 animate-pulse" /> Transcriptie wordt
          gegenereerd…
        </p>
      )}
      {call.transcription_status === "done" && call.transcription_text && (
        <p className="rounded bg-white p-2 text-[11px] leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          <strong>Transcriptie:</strong> {call.transcription_text}
        </p>
      )}
    </div>
  );
}
