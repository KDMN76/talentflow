"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * BeforeInstallPromptEvent (niet in lib.dom.d.ts; eigen typing).
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

/**
 * InstallPwaButton
 * --------------------------------------------------------------
 * Toont een "Installeer als app" knop zodra Chrome/Edge/Brave het
 * `beforeinstallprompt` event vuurt. Op iOS Safari (geen event)
 * blijft de knop verborgen — daar moet de gebruiker via "Voeg toe
 * aan beginscherm" werken.
 *
 * Gebruik in /hm header of dashboard. Verbergt zichzelf zodra de
 * app daadwerkelijk geïnstalleerd is.
 */
export default function InstallPwaButton({
  className,
}: {
  className?: string;
}) {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Detecteer als al in standalone modus draait
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // @ts-expect-error: iOS Safari proprietary
      (typeof navigator !== "undefined" && navigator.standalone === true);
    if (isStandalone) {
      setInstalled(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const installedHandler = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  if (installed || !deferredPrompt) return null;

  async function handleClick() {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setDeferredPrompt(null);
      }
    } catch (err) {
      console.warn("[pwa] install prompt failed", err);
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={handleClick}
      className={className}
    >
      <Download className="mr-1.5 h-3.5 w-3.5" />
      Installeer als app
    </Button>
  );
}
