"use client";

import { useEffect } from "react";

/**
 * Laatste vangnet: vangt fouten in de root-layout zelf. Moet een eigen
 * <html>/<body> renderen (vervangt de hele boom) en mag van NIETS afhangen —
 * geen i18n, geen componenten, geen globals.css-zekerheid (inline styles).
 * Lost ook de Sentry-waarschuwing "add a global-error" op.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="nl">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
          background: "#fafafa",
          color: "#18181b",
        }}
      >
        <div style={{ textAlign: "center", padding: 24, maxWidth: 420 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            Er ging iets mis
          </h1>
          <p style={{ fontSize: 14, color: "#71717a", marginBottom: 20 }}>
            De applicatie kon niet worden geladen. Probeer het opnieuw.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#4f46e5",
              color: "#fff",
              border: 0,
              borderRadius: 8,
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Opnieuw proberen
          </button>
        </div>
      </body>
    </html>
  );
}
