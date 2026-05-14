/**
 * ConsentSection — toestemmingen-paneel (AVG art. 7).
 *
 * Twee toggles: GDPR-consent (verplicht voor opslag) en Email-consent (marketing/
 * direct contact). De UI is een custom switch (geen shadcn Switch beschikbaar in
 * de huidige UI-kit). Toggle → POST /consent met optimistic update.
 *
 * Belangrijk: bij intrekken van GDPR-consent waarschuwen we de kandidaat dat
 * zijn data binnen 30 dagen verwijderd zal worden — daarvoor verwijzen we naar
 * de DeletionRequestFlow.
 */

"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Shield, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useUpdateSelfConsent, type ConsentType } from "@/hooks/useSelfService";
import type { SelfServiceConsent, SelfServiceRetention } from "@/lib/mockData";

interface ConsentSectionProps {
  consents: SelfServiceConsent[];
  retention: SelfServiceRetention;
  token: string;
}

const CONSENT_META: Record<
  ConsentType,
  { title: string; description: string; revokeWarning?: string }
> = {
  gdpr: {
    title: "Toestemming voor verwerking (AVG)",
    description:
      "Je geeft toestemming dat we je gegevens (CV, contactinfo, sollicitaties) verwerken volgens de AVG.",
    revokeWarning:
      "Zonder AVG-toestemming mogen we je gegevens niet langer bewaren. Als je intrekt, sturen we je verzoek door als verwijderverzoek (afgehandeld binnen 30 dagen).",
  },
  email: {
    title: "E-mailcommunicatie",
    description:
      "Je gaat akkoord met e-mails over je sollicitaties, interview-afspraken en feedback.",
    revokeWarning:
      "Bij intrekken kunnen we je niet meer per e-mail benaderen. Lopende sollicitaties kunnen daardoor stilvallen.",
  },
};

export function ConsentSection({ consents, retention, token }: ConsentSectionProps) {
  const { toast } = useToast();
  const update = useUpdateSelfConsent(token);
  const [pending, setPending] = useState<ConsentType | null>(null);
  const [confirmType, setConfirmType] = useState<ConsentType | null>(null);

  const find = (type: ConsentType): SelfServiceConsent =>
    consents.find((c) => c.type === type) ?? {
      type,
      granted: false,
      granted_at: null,
      revoked_at: null,
      source: null,
    };

  const handleToggle = async (type: ConsentType, nextGranted: boolean) => {
    setPending(type);
    try {
      await update.mutateAsync({ type, granted: nextGranted });
      toast({
        title: nextGranted ? "Toestemming verleend" : "Toestemming ingetrokken",
        description: nextGranted
          ? `Je ${type === "gdpr" ? "AVG" : "e-mail"}-toestemming is geregistreerd.`
          : `Je ${type === "gdpr" ? "AVG" : "e-mail"}-toestemming is ingetrokken en gelogd in onze WORM-audit-trail.`,
      });
    } catch {
      toast({
        title: "Niet gelukt",
        description: "Kon je toestemming niet aanpassen. Probeer het opnieuw.",
        variant: "destructive",
      });
    } finally {
      setPending(null);
      setConfirmType(null);
    }
  };

  const requestToggle = (type: ConsentType) => {
    const current = find(type);
    // Bij INTREKKEN: confirm-dialog. Bij verlenen: direct doen.
    if (current.granted) {
      setConfirmType(type);
    } else {
      void handleToggle(type, true);
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5 sm:p-6">
        <div className="mb-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400">
              <Shield className="h-4 w-4" />
            </span>
            Mijn toestemmingen
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Bekijk en beheer welke toestemmingen je hebt gegeven. Wijzigingen worden
            direct vastgelegd in onze WORM-audit-trail.
          </p>
        </div>

        <ul className="space-y-3">
          {(["gdpr", "email"] as ConsentType[]).map((type) => {
            const consent = find(type);
            const meta = CONSENT_META[type];
            const isPending = pending === type;
            return (
              <li
                key={type}
                className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {meta.title}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {meta.description}
                  </p>
                  <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                    {consent.granted ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" />
                        Verleend op {formatNl(consent.granted_at)}
                        {consent.source ? ` via ${consent.source}` : ""}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-zinc-500">
                        <ShieldAlert className="h-3 w-3" />
                        {consent.revoked_at
                          ? `Ingetrokken op ${formatNl(consent.revoked_at)}`
                          : "Niet verleend"}
                      </span>
                    )}
                  </p>
                </div>
                <ToggleSwitch
                  checked={consent.granted}
                  pending={isPending}
                  label={meta.title}
                  onChange={() => requestToggle(type)}
                />
              </li>
            );
          })}
        </ul>

        <p className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 py-2 text-[11px] text-muted-foreground dark:border-zinc-800 dark:bg-zinc-900/40">
          <strong className="font-medium text-zinc-700 dark:text-zinc-300">
            Bewaartermijn:{" "}
          </strong>
          {retention.policy_name}.{" "}
          {retention.delete_at
            ? `Geplande verwijdering op ${formatNl(retention.delete_at)} (≈ ${retention.days_remaining ?? "?"} dagen).`
            : "Geen automatische verwijderdatum bekend."}
        </p>
      </CardContent>

      {/* Confirm-dialog voor INTREKKEN */}
      <Dialog open={!!confirmType} onOpenChange={(o) => !o && setConfirmType(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Toestemming intrekken?</DialogTitle>
            <DialogDescription>
              {confirmType ? CONSENT_META[confirmType].revokeWarning : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="ghost"
              onClick={() => setConfirmType(null)}
              disabled={update.isPending}
            >
              Annuleren
            </Button>
            <Button
              onClick={() => confirmType && handleToggle(confirmType, false)}
              disabled={update.isPending}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {update.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Ja, intrekken
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ToggleSwitch({
  checked,
  pending,
  label,
  onChange,
}: {
  checked: boolean;
  pending: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={pending}
      className={[
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2",
        checked
          ? "bg-emerald-500"
          : "bg-zinc-300 dark:bg-zinc-700",
        pending ? "opacity-60" : "",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        ].join(" ")}
      />
      {pending && (
        <Loader2 className="absolute right-1.5 h-3 w-3 animate-spin text-white" />
      )}
    </button>
  );
}

function formatNl(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
