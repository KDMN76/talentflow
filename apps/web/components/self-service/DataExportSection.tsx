/**
 * DataExportSection — AVG art. 15 (recht op een kopie van je gegevens).
 *
 * De kandidaat vraagt met één klik een export aan. De API registreert een
 * DSAR-verzoek, bouwt direct een kort-levende download-link (24 uur geldig,
 * maximaal 3 downloads) en geeft die terug. We openen de download meteen en
 * tonen de link daarna nog als fallback.
 */

"use client";

import { useState } from "react";
import { Download, FileArchive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import {
  useRequestDataExport,
  type DataExportResponse,
} from "@/hooks/useSelfService";

interface DataExportSectionProps {
  token: string;
}

export function DataExportSection({ token }: DataExportSectionProps) {
  const { toast } = useToast();
  const requestExport = useRequestDataExport(token);
  const [result, setResult] = useState<DataExportResponse | null>(null);

  const handleExport = async () => {
    try {
      const res = await requestExport.mutateAsync();
      setResult(res);
      if (res.url) {
        // Directe download — de link blijft daarna zichtbaar als fallback.
        window.location.href = res.url;
      }
      toast({
        title: "Je export is klaar",
        description: "De download start automatisch. De link blijft 24 uur geldig.",
      });
    } catch {
      toast({
        title: "Export niet gelukt",
        description:
          "We konden je gegevens nu niet exporteren. Probeer het later opnieuw of neem contact op met het recruitment-team.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5 sm:p-6">
        <div className="mb-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400">
              <FileArchive className="h-4 w-4" />
            </span>
            Mijn gegevens downloaden
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Op grond van AVG art. 15 kun je een kopie van al je gegevens
            opvragen: profiel, sollicitaties, communicatie, beoordelingen,
            AI-verwerkingen en CV-bestanden — als ZIP met een leesbare
            samenvatting.
          </p>
        </div>

        {result ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200">
              <p className="font-medium">Je export is aangemaakt.</p>
              <p className="mt-1 text-[13px] opacity-90">
                Start de download niet automatisch? Gebruik dan de knop
                hieronder. De link is geldig tot{" "}
                {formatNl(result.expires_at)} en werkt maximaal 3 keer.
              </p>
            </div>
            <div className="flex justify-end">
              <Button
                variant="outline"
                className="h-9 gap-1.5"
                onClick={() => {
                  if (result.url) window.location.href = result.url;
                }}
              >
                <Download className="h-3.5 w-3.5" />
                Download opnieuw
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button
              onClick={handleExport}
              disabled={requestExport.isPending}
              variant="outline"
              className="h-9 gap-1.5 border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900/40 dark:text-indigo-400 dark:hover:bg-indigo-950/30"
            >
              {requestExport.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Vraag mijn gegevens op
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatNl(iso: string): string {
  try {
    return new Date(iso).toLocaleString("nl-NL", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
