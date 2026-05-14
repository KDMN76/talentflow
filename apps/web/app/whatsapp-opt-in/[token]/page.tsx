"use client";

/**
 * Sprint Q4.6 — Public WhatsApp opt-in landing page.
 *
 * Mobile-first, no sidebar. The token in the URL identifies the consent-record.
 *
 *   1. Header: tenant logo + name.
 *   2. Body: explainer + GDPR-friendly bullet list.
 *   3. Two big buttons: "Ja, ik geef toestemming" (green) and "Nee, bedankt".
 *   4. Success/decline screens (no redirect — keep the user in a calm state).
 *   5. Footer: privacy-policy link.
 */

import { useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  MessageCircle,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  usePublicOptInAccept,
  usePublicOptInDecline,
} from "@/hooks/useWhatsApp";

type Stage = "decision" | "accepted" | "declined";

export default function WhatsAppOptInPage() {
  const params = useParams();
  const token = (params?.token as string) ?? "";
  const accept = usePublicOptInAccept();
  const decline = usePublicOptInDecline();
  const [stage, setStage] = useState<Stage>("decision");

  const handleAccept = async () => {
    await accept.mutateAsync(token);
    setStage("accepted");
  };
  const handleDecline = async () => {
    await decline.mutateAsync(token);
    setStage("declined");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-white dark:from-emerald-950/30 dark:via-zinc-950 dark:to-zinc-950">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 py-6 sm:py-12">
        {/* Header */}
        <header className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 shadow-sm">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              TechRecruit B.V.
            </p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              powered by TalentFlow
            </p>
          </div>
        </header>

        <main className="mt-10 flex-1">
          {stage === "decision" && (
            <DecisionView
              onAccept={handleAccept}
              onDecline={handleDecline}
              loadingAccept={accept.isPending}
              loadingDecline={decline.isPending}
            />
          )}
          {stage === "accepted" && <AcceptedView />}
          {stage === "declined" && <DeclinedView />}
        </main>

        <footer className="mt-10 flex items-center justify-between border-t border-border pt-4 text-[11px] text-muted-foreground">
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-indigo-600 hover:underline"
          >
            Privacybeleid
          </a>
          <span>AVG art. 7 — Toestemming</span>
        </footer>
      </div>
    </div>
  );
}

function DecisionView({
  onAccept,
  onDecline,
  loadingAccept,
  loadingDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
  loadingAccept: boolean;
  loadingDecline: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 shadow-sm dark:bg-emerald-950/40">
        <MessageCircle className="h-8 w-8 text-emerald-600" />
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-3xl">
          Wil je via WhatsApp updates ontvangen?
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          We willen je graag op de hoogte houden over je sollicitatie — sneller
          en directer dan e-mail.
        </p>
      </div>

      <ul className="space-y-2.5">
        <BulletItem
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
          text="Statusupdates over je sollicitatie"
        />
        <BulletItem
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
          text="Uitnodigingen voor gesprekken"
        />
        <BulletItem
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
          text="Snel beantwoorden via je telefoon"
        />
        <BulletItem
          icon={<ShieldCheck className="h-4 w-4 text-indigo-600" />}
          text="Je kunt je toestemming altijd intrekken — geen marketing-spam."
        />
      </ul>

      <div className="space-y-2 pt-2">
        <Button
          onClick={onAccept}
          disabled={loadingAccept || loadingDecline}
          className="h-12 w-full gap-2 bg-emerald-600 text-base hover:bg-emerald-700"
        >
          <CheckCircle2 className="h-5 w-5" />
          {loadingAccept ? "Bezig…" : "Ja, ik geef toestemming"}
        </Button>
        <Button
          onClick={onDecline}
          disabled={loadingAccept || loadingDecline}
          variant="outline"
          className="h-12 w-full gap-2 text-base"
        >
          <X className="h-5 w-5" />
          Nee, bedankt
        </Button>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          Door &quot;Ja&quot; te klikken geef je TechRecruit B.V. toestemming
          om je via WhatsApp te benaderen. We delen je gegevens niet met derden.
          Zie ons{" "}
          <a href="/privacy" className="underline">
            privacybeleid
          </a>{" "}
          voor details.
        </p>
      </div>
    </div>
  );
}

function AcceptedView() {
  return (
    <div className="space-y-5 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/40">
        <CheckCircle2 className="h-10 w-10 text-emerald-600" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
        Bedankt!
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Je ontvangt vanaf nu updates via WhatsApp. Onze recruiter kan je nu
        direct bereiken — sneller dan via e-mail.
      </p>
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 text-left text-xs text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
        <p className="font-semibold">Wat nu?</p>
        <ol className="mt-1.5 list-decimal space-y-1 pl-4">
          <li>Sla onze nummer op in je telefoon: +31 6 1234 5678.</li>
          <li>We sturen binnenkort een eerste bericht.</li>
          <li>
            Je kunt op elk moment STOP sturen om toestemming in te trekken.
          </li>
        </ol>
      </div>
    </div>
  );
}

function DeclinedView() {
  return (
    <div className="space-y-5 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
        <X className="h-10 w-10 text-zinc-500" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
        Geen probleem
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Je ontvangt alleen e-mail van ons over je sollicitatie. Je voorkeur is
        vastgelegd in onze administratie.
      </p>
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-left text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-300">
        <p className="font-semibold">Toch via WhatsApp?</p>
        <p className="mt-1.5">
          Mocht je later van gedachten veranderen, neem dan contact op met je
          recruiter of klik op een nieuwe opt-in link.
        </p>
      </div>
      <a
        href="https://techrecruit.example/careers"
        className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
      >
        Bekijk vacatures
        <ChevronRight className="h-4 w-4" />
      </a>
    </div>
  );
}

function BulletItem({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <li className="flex items-start gap-2.5 rounded-lg bg-white/60 p-2.5 text-sm text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-900/60 dark:text-zinc-300 dark:ring-zinc-800">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{text}</span>
    </li>
  );
}
