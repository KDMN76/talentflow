"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * Route-level error-boundary (App Router). Vangt runtime-fouten in pagina's op
 * en toont een nette foutkaart i.p.v. een wit scherm. Bewust geen i18n-hook of
 * eigen UI-componenten: dit moet ook renderen wanneer juist díé lagen stuk zijn.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Naar de console (en Sentry, indien geconfigureerd) — niet stil falen.
    console.error("[route-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950/40">
          <AlertTriangle className="h-6 w-6 text-amber-500" />
        </div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Er ging iets mis
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Deze pagina kon niet worden geladen. Probeer het opnieuw — als het
          probleem aanhoudt, is het team op de hoogte.
        </p>
        {error.digest && (
          <p className="mt-2 text-xs text-zinc-400">Referentie: {error.digest}</p>
        )}
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
        >
          <RotateCcw className="h-4 w-4" />
          Opnieuw proberen
        </button>
      </div>
    </div>
  );
}
