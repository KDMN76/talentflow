"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Graceful push-permission banner.
 *
 * Agent QQ owns the canonical `PushPermissionBanner` (service worker + VAPID).
 * Until QQ's PR is merged we render a lightweight stand-in that:
 *   1. Checks the browser supports `Notification` and that we're not already
 *      granted/denied.
 *   2. Reads/writes a localStorage flag so the user can dismiss it for 7 days.
 *   3. Calls `Notification.requestPermission()` on opt-in. The actual subscribe
 *      flow is QQ's job — we only nudge the user.
 *
 * When QQ's component lands, replace this import in `hm/page.tsx`.
 */
const DISMISS_KEY = "hm.push.banner.dismissed_until";
const DISMISS_DAYS = 7;

export function PushPermissionShim() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;

    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (raw) {
        const until = parseInt(raw, 10);
        if (!isNaN(until) && Date.now() < until) return;
      }
    } catch {
      /* ignore: privacy mode disables localStorage */
    }
    setVisible(true);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(
        DISMISS_KEY,
        String(Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000)
      );
    } catch {
      /* ignore */
    }
  };

  const enable = async () => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    setBusy(true);
    try {
      await Notification.requestPermission();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
      setVisible(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-purple-50 p-3 shadow-sm",
        "dark:border-indigo-900 dark:from-indigo-950/50 dark:to-purple-950/50"
      )}
      role="region"
      aria-label="Notificatie-toestemming"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/60">
          <Bell className="h-4 w-4 text-indigo-700 dark:text-indigo-300" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Krijg een seintje bij nieuwe kandidaten
          </p>
          <p className="text-xs text-muted-foreground">
            Push-notificaties houden je op de hoogte zonder de app open te
            houden.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={enable}
              disabled={busy}
              className="rounded-full bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 min-h-[36px]"
            >
              {busy ? "Bezig…" : "Aanzetten"}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-white/60 dark:hover:bg-zinc-800/60 min-h-[36px]"
            >
              Niet nu
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Sluiten"
          className="-mr-1 -mt-1 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-white/60 dark:hover:bg-zinc-800/60"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
