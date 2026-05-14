/**
 * PortalStateScreens — friendly NL-state-screens voor het klantportaal.
 *
 * - PortalSkeleton: skeleton-cards tijdens initial load
 * - PortalErrorScreen: token-invalid / netwerk-error met optionele retry
 */

"use client";

import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function PortalSkeleton() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-24 w-full rounded-lg" />
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function PortalErrorScreen({
  variant,
  onRetry,
}: {
  variant: "invalid" | "network";
  onRetry?: () => void;
}) {
  const isInvalid = variant === "invalid";
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-4 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/30">
          <AlertCircle className="h-7 w-7 text-red-600 dark:text-red-400" />
        </div>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
          {isInvalid
            ? "Deze link is verlopen of ongeldig"
            : "Even niet bereikbaar"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isInvalid
            ? "Vraag de recruiter om een nieuwe link. Mogelijk is de toegang ingetrokken of is de link verlopen."
            : "We konden de gegevens niet ophalen. Controleer je verbinding en probeer het opnieuw."}
        </p>
        {!isInvalid && onRetry && (
          <div className="pt-2">
            <Button onClick={onRetry} variant="outline">
              <RotateCw className="mr-1.5 h-3.5 w-3.5" />
              Opnieuw proberen
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
