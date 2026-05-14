"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toast";

/**
 * PWARegister
 * --------------------------------------------------------------
 * Registreert /sw.js zodra de root layout mount. Detecteert nieuwe
 * versies via twee paden:
 *   1) reg.onupdatefound + installing.statechange === 'installed'
 *      met een actieve controller → "Nieuwe versie beschikbaar"
 *   2) navigator.serviceWorker.controllerchange → reload
 *
 * In dev (Next.js) registreren we óók — Next levert /sw.js gewoon
 * uit /public, en de SW gebruikt versie-namespacing (`tf-vN-*`)
 * zodat vorige sessies veilig worden opgeruimd.
 */
export default function PWARegister() {
  const { toast } = useToast();
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    let mounted = true;

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          if (!mounted) return;

          // Listener voor nieuwe versies
          reg.addEventListener("updatefound", () => {
            const installing = reg.installing;
            if (!installing) return;

            installing.addEventListener("statechange", () => {
              if (
                installing.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                // Er is een nieuwe versie geïnstalleerd terwijl de
                // huidige nog actief is → bied vernieuwing aan.
                toast({
                  title: "Nieuwe versie beschikbaar",
                  description:
                    "Vernieuw om de laatste verbeteringen te zien.",
                  action: (
                    <ToastAction
                      altText="Vernieuwen"
                      onClick={() => {
                        installing.postMessage({ type: "SKIP_WAITING" });
                      }}
                    >
                      Vernieuwen
                    </ToastAction>
                  ),
                });
              }
            });
          });

          // Periodieke check (elke 30 min) voor lange sessies
          const checkInterval = window.setInterval(
            () => {
              reg.update().catch(() => {});
            },
            30 * 60 * 1000,
          );

          // cleanup hook
          (reg as unknown as { _tfInterval?: number })._tfInterval =
            checkInterval;
        })
        .catch((err) => {
          console.warn("[pwa] service worker registration failed", err);
        });
    };

    // Reload zodra een nieuwe SW de controller wordt
    const onControllerChange = () => {
      if (reloadingRef.current) return;
      reloadingRef.current = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );

    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad, { once: true });
    }

    return () => {
      mounted = false;
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
    };
  }, [toast]);

  return null;
}
