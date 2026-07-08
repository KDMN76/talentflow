/**
 * Self-service portaal — kandidaat ziet en beheert zijn AVG-rechten.
 *
 * Token-flow:
 *   1. Token uit URL → useSelfServiceData haalt {candidate, applications,
 *      communications, consents, retention, deletion_request, tenant}.
 *   2. Loading → Skeleton.
 *   3. 404/410/401/403 → "Deze link is verlopen / ongeldig" — vraag nieuwe link.
 *   4. Netwerk-fout → retry-button + uitleg.
 *   5. Success → 6 secties op één pagina (geen tabs):
 *       A. Mijn profiel        → ProfileSection
 *       B. Mijn sollicitaties  → ApplicationsSection
 *       C. Mijn communicatie   → CommunicationsSection
 *       D. Mijn toestemmingen  → ConsentSection
 *       E. Mijn gegevens downloaden → DataExportSection (AVG art. 15)
 *       F. Mijn data verwijderen → DeletionRequestFlow (AVG art. 17)
 */

"use client";

import { useParams } from "next/navigation";
import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  classifySelfServiceError,
  useSelfServiceData,
} from "@/hooks/useSelfService";
import { ProfileSection } from "@/components/self-service/ProfileSection";
import { ApplicationsSection } from "@/components/self-service/ApplicationsSection";
import { CommunicationsSection } from "@/components/self-service/CommunicationsSection";
import { ConsentSection } from "@/components/self-service/ConsentSection";
import { DataExportSection } from "@/components/self-service/DataExportSection";
import { DeletionRequestFlow } from "@/components/self-service/DeletionRequestFlow";

export default function SelfServicePage() {
  const params = useParams();
  const token = (params?.token as string) ?? "";

  const { data, isLoading, isError, error, refetch } = useSelfServiceData(token);

  if (isLoading) return <SelfServiceSkeleton />;

  if (isError || !data) {
    const variant = classifySelfServiceError(error);
    return <SelfServiceErrorScreen variant={variant} onRetry={() => refetch()} />;
  }

  const fullName =
    [data.candidate.first_name, data.candidate.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() || "kandidaat";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Hero */}
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
          AVG-rechten · Privacy-portaal
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-3xl">
          Hallo {fullName.split(" ")[0]}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Dit zijn de gegevens die{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {data.tenant.name}
          </span>{" "}
          over jou heeft. Je kunt ze hier inzien, corrigeren, of verwijderen volgens
          AVG art. 15-17.
        </p>
      </header>

      <div className="space-y-4">
        <ProfileSection candidate={data.candidate} token={token} />
        <ApplicationsSection applications={data.applications} token={token} />
        <CommunicationsSection communications={data.communications} />
        <ConsentSection
          consents={data.consents}
          retention={data.retention}
          token={token}
        />
        <DataExportSection token={token} />
        <DeletionRequestFlow
          token={token}
          existingRequest={data.deletion_request}
        />
      </div>

      {data.tenant.privacy_email && (
        <p className="mt-8 text-center text-[11px] text-muted-foreground">
          Vragen over je privacy? Neem contact op met{" "}
          <a
            href={`mailto:${data.tenant.privacy_email}`}
            className="font-medium text-indigo-600 hover:underline"
          >
            {data.tenant.privacy_email}
          </a>
          .
        </p>
      )}
    </div>
  );
}

function SelfServiceSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-40 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

function SelfServiceErrorScreen({
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
            ? "Vraag de recruiter om een nieuwe link. Mogelijk is je verzoek al verwerkt of is de link verlopen om je gegevens te beschermen."
            : "We konden je gegevens niet ophalen. Controleer je verbinding en probeer het opnieuw."}
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
