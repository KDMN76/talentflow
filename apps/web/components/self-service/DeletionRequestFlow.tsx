/**
 * DeletionRequestFlow — multi-step confirm-flow voor AVG art. 17 (recht op vergetelheid).
 *
 * Stap 1: Waarschuwing — wat gebeurt er als je je verzoek indient?
 * Stap 2: Reden (optioneel) + verplichte bevestigings-checkbox.
 * Stap 3: Submit → POST /deletion → DSAR-id → success-state met deadline (30 dagen).
 *
 * Als er al een lopend verzoek is, tonen we de status ipv het formulier.
 */

"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useRequestDeletion } from "@/hooks/useSelfService";
import type { SelfServiceDeletionRequest } from "@/lib/mockData";

interface DeletionRequestFlowProps {
  token: string;
  existingRequest: SelfServiceDeletionRequest | null;
}

type Step = "intro" | "form" | "submitted";

export function DeletionRequestFlow({ token, existingRequest }: DeletionRequestFlowProps) {
  const { toast } = useToast();
  const request = useRequestDeletion(token);

  const [step, setStep] = useState<Step>(existingRequest ? "submitted" : "intro");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const handleSubmit = async () => {
    try {
      await request.mutateAsync({ reason: reason.trim() || undefined });
      toast({
        title: "Verwijderverzoek ingediend",
        description:
          "Je verzoek is geregistreerd. Je ontvangt een bevestiging per e-mail.",
      });
      setStep("submitted");
    } catch {
      toast({
        title: "Niet gelukt",
        description:
          "Kon je verzoek niet indienen. Probeer het later opnieuw of neem contact op met de DPO.",
        variant: "destructive",
      });
    }
  };

  const reset = () => {
    setStep("intro");
    setReason("");
    setConfirmed(false);
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5 sm:p-6">
        <div className="mb-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400">
              <Trash2 className="h-4 w-4" />
            </span>
            Mijn data verwijderen
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Op grond van AVG art. 17 (recht op vergetelheid) kun je verzoeken om
            permanente verwijdering van je profiel.
          </p>
        </div>

        {step === "submitted" && (existingRequest || request.data) ? (
          <SubmittedState
            request={
              existingRequest ?? {
                dsar_id: request.data?.dsar_id ?? "—",
                status: "pending",
                requested_at: new Date().toISOString(),
                deadline:
                  request.data?.deadline ??
                  new Date(Date.now() + 30 * 86_400_000).toISOString(),
              }
            }
          />
        ) : step === "intro" ? (
          <IntroStep onContinue={() => setStep("form")} />
        ) : (
          <FormStep
            reason={reason}
            setReason={setReason}
            confirmed={confirmed}
            setConfirmed={setConfirmed}
            isPending={request.isPending}
            onBack={reset}
            onSubmit={handleSubmit}
          />
        )}
      </CardContent>
    </Card>
  );
}

function IntroStep({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-sm dark:border-amber-900/40 dark:bg-amber-950/20">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="space-y-2 text-amber-900 dark:text-amber-200">
            <p className="font-medium">
              Dit verzoekt permanente verwijdering van je profiel.
            </p>
            <ul className="list-disc space-y-1 pl-4 text-[13px] opacity-90">
              <li>Je contactgegevens, CV en sollicitaties worden verwijderd.</li>
              <li>Lopende sollicitaties worden ingetrokken.</li>
              <li>
                Je sollicitaties blijven anoniem in onze rapportages bewaard
                (alleen geaggregeerde, niet-herleidbare statistieken).
              </li>
              <li>
                Wettelijk verplichte data (bijv. financiële records bij plaatsing)
                blijft bewaard volgens de wettelijke termijn.
              </li>
              <li>
                Je verzoek wordt binnen 30 dagen verwerkt (AVG art. 12 lid 3).
              </li>
            </ul>
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          onClick={onContinue}
          variant="outline"
          className="h-9 gap-1.5 border-red-200 text-red-700 hover:bg-red-50"
        >
          Vraag verwijdering aan
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function FormStep({
  reason,
  setReason,
  confirmed,
  setConfirmed,
  isPending,
  onBack,
  onSubmit,
}: {
  reason: string;
  setReason: (v: string) => void;
  confirmed: boolean;
  setConfirmed: (v: boolean) => void;
  isPending: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (confirmed) onSubmit();
      }}
      className="space-y-4"
    >
      <div>
        <Label htmlFor="deletion-reason" className="text-xs text-zinc-700 dark:text-zinc-300">
          Reden (optioneel)
        </Label>
        <textarea
          id="deletion-reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Bijv. ik heb mijn baan gevonden, of ik wil niet langer benaderd worden."
          className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-zinc-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          maxLength={500}
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Helpt ons om onze processen te verbeteren. Maximum 500 tekens.
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/40">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-4 w-4 cursor-pointer rounded border-zinc-300 text-red-600 focus:ring-red-500"
        />
        <span className="text-zinc-700 dark:text-zinc-300">
          Ik begrijp dat dit verzoek mijn profiel binnen 30 dagen permanent zal
          verwijderen en dat dit niet ongedaan kan worden gemaakt.
        </span>
      </label>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack} className="h-9 gap-1.5">
          <ArrowLeft className="h-3.5 w-3.5" />
          Terug
        </Button>
        <Button
          type="submit"
          disabled={!confirmed || isPending}
          className="h-9 gap-1.5 bg-red-600 text-white hover:bg-red-700"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          Verzoek indienen
        </Button>
      </div>
    </form>
  );
}

function SubmittedState({ request }: { request: SelfServiceDeletionRequest }) {
  const STATUS_LABEL: Record<SelfServiceDeletionRequest["status"], string> = {
    pending: "In behandeling",
    processing: "Wordt uitgevoerd",
    completed: "Voltooid",
    rejected: "Afgewezen",
  };

  const STATUS_TONE: Record<SelfServiceDeletionRequest["status"], string> = {
    pending: "border-amber-200 bg-amber-50 text-amber-800",
    processing: "border-blue-200 bg-blue-50 text-blue-800",
    completed: "border-emerald-200 bg-emerald-50 text-emerald-800",
    rejected: "border-zinc-200 bg-zinc-50 text-zinc-700",
  };

  return (
    <div className="space-y-4">
      <div
        className={`flex items-start gap-3 rounded-lg border p-4 ${STATUS_TONE[request.status]}`}
      >
        {request.status === "completed" ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
        ) : (
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
        )}
        <div className="space-y-1.5 text-sm">
          <p className="font-semibold">
            Je verwijderverzoek is {STATUS_LABEL[request.status].toLowerCase()}.
          </p>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-3">
            <div>
              <dt className="text-[10px] uppercase tracking-wider opacity-70">DSAR-ID</dt>
              <dd className="font-mono text-[11px]">{request.dsar_id}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider opacity-70">Ingediend</dt>
              <dd>{formatNl(request.requested_at)}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider opacity-70">Deadline (30 dgn)</dt>
              <dd>{formatNl(request.deadline)}</dd>
            </div>
          </dl>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Je ontvangt een bevestiging per e-mail zodra het verzoek is afgehandeld. Voor
        vragen kun je contact opnemen met de Functionaris Gegevensbescherming (DPO)
        van het recruitment-team.
      </p>
    </div>
  );
}

function formatNl(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
