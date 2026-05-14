"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  isPushSupported,
  getNotificationPermission,
  getCurrentPushSubscription,
  subscribeToPushNotifications,
} from "@/lib/pushSubscription";

const SNOOZE_KEY = "tf:push-banner-snoozed-until";
const SNOOZE_DAYS = 7;

/**
 * PushPermissionBanner
 * --------------------------------------------------------------
 * Compacte banner bovenaan /hm die gebruikers vraagt om push-
 * notificaties te activeren. Wordt NIET getoond als:
 *   - browser geen push ondersteunt
 *   - permission al granted én een actieve subscription bestaat
 *   - permission permanent denied (gebruiker heeft 'Block' gekozen)
 *   - de gebruiker net "Niet nu" heeft geklikt (7 dagen snooze)
 *
 * Embed dit component in /hm en /hm/* pages.
 */
export default function PushPermissionBanner() {
  const { toast } = useToast();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function evaluate() {
      if (!isPushSupported()) return;

      const permission = getNotificationPermission();
      if (permission === "denied" || permission === "unsupported") {
        // Permanent denied → laat het via /settings/notifications regelen
        return;
      }

      if (permission === "granted") {
        const sub = await getCurrentPushSubscription();
        if (sub) return; // al geregeld
      }

      const snoozedUntil = readSnoozeUntil();
      if (snoozedUntil && snoozedUntil > Date.now()) return;

      if (!cancelled) setVisible(true);
    }

    evaluate();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  async function handleEnable() {
    setBusy(true);
    try {
      await subscribeToPushNotifications();
      toast({
        title: "Meldingen ingeschakeld",
        description:
          "Je ontvangt nu een seintje bij nieuwe kandidaten en deadlines.",
      });
      setVisible(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Onbekende fout";
      toast({
        title: "Inschakelen mislukt",
        description: message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  function handleSnooze() {
    writeSnoozeUntil(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000);
    setVisible(false);
  }

  return (
    <div
      role="region"
      aria-label="Push-notificaties inschakelen"
      className="relative flex flex-col gap-3 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-purple-50 p-4 shadow-sm dark:border-indigo-900/60 dark:from-indigo-950/40 dark:to-purple-950/40 sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300">
        <Bell className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Krijg meldingen op je telefoon
        </p>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          We sturen alleen iets bij nieuwe kandidaten, deadlines en
          urgente updates — geen spam.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={handleSnooze}
          className="text-zinc-700 dark:text-zinc-300"
        >
          Niet nu
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={handleEnable}
          className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-sm hover:from-indigo-600 hover:to-purple-700"
        >
          <Bell className="mr-1.5 h-3.5 w-3.5" />
          {busy ? "Bezig..." : "Schakel in"}
        </Button>
      </div>
      <button
        type="button"
        onClick={handleSnooze}
        aria-label="Sluit melding"
        className="absolute right-2 top-2 rounded-md p-1 text-zinc-400 transition-colors hover:bg-white/60 hover:text-zinc-700 dark:hover:bg-zinc-900/40 sm:hidden"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ----------------------------------------------------------------
// Snooze helpers — localStorage met try/catch voor private mode
// ----------------------------------------------------------------

function readSnoozeUntil(): number | null {
  try {
    const raw = window.localStorage.getItem(SNOOZE_KEY);
    if (!raw) return null;
    const ts = Number(raw);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

function writeSnoozeUntil(ts: number): void {
  try {
    window.localStorage.setItem(SNOOZE_KEY, String(ts));
  } catch {
    // private mode / quota exceeded — silent
  }
}
