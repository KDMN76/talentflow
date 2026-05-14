/**
 * ApplicationsSection — kandidaat ziet zijn eigen sollicitaties + kan terugtrekken.
 */

"use client";

import { useState } from "react";
import { Briefcase, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { useWithdrawApplication } from "@/hooks/useSelfService";
import type { SelfServiceApplication } from "@/lib/mockData";

interface ApplicationsSectionProps {
  applications: SelfServiceApplication[];
  token: string;
}

const STATUS_LABEL: Record<SelfServiceApplication["status"], string> = {
  active: "Lopend",
  in_review: "In behandeling",
  interviewing: "Interview-fase",
  offer: "Aanbieding",
  hired: "Aangenomen",
  rejected: "Afgewezen",
  withdrawn: "Teruggetrokken",
};

const STATUS_TONE: Record<SelfServiceApplication["status"], string> = {
  active: "bg-blue-50 text-blue-700 border-blue-200",
  in_review: "bg-amber-50 text-amber-700 border-amber-200",
  interviewing: "bg-indigo-50 text-indigo-700 border-indigo-200",
  offer: "bg-emerald-50 text-emerald-700 border-emerald-200",
  hired: "bg-emerald-50 text-emerald-800 border-emerald-200",
  rejected: "bg-zinc-100 text-zinc-600 border-zinc-200",
  withdrawn: "bg-zinc-100 text-zinc-500 border-zinc-200",
};

export function ApplicationsSection({ applications, token }: ApplicationsSectionProps) {
  const { toast } = useToast();
  const withdraw = useWithdrawApplication(token);
  const [target, setTarget] = useState<SelfServiceApplication | null>(null);

  const handleConfirm = async () => {
    if (!target) return;
    try {
      await withdraw.mutateAsync(target.id);
      toast({
        title: "Sollicitatie teruggetrokken",
        description: `Je sollicitatie voor "${target.job_title}" is ingetrokken.`,
      });
      setTarget(null);
    } catch {
      toast({
        title: "Niet gelukt",
        description: "Kon de sollicitatie niet terugtrekken. Probeer het opnieuw.",
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
              <Briefcase className="h-4 w-4" />
            </span>
            Mijn sollicitaties
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Een overzicht van de vacatures waar je op gesolliciteerd hebt.
          </p>
        </div>

        {applications.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/60 px-4 py-6 text-center text-sm text-muted-foreground dark:border-zinc-800 dark:bg-zinc-900/40">
            Je hebt nog geen actieve sollicitaties.
          </p>
        ) : (
          <ul className="space-y-2">
            {applications.map((app) => {
              const canWithdraw =
                app.status !== "withdrawn" &&
                app.status !== "hired" &&
                app.status !== "rejected";
              return (
                <li
                  key={app.id}
                  className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {app.job_title}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>Gesolliciteerd op {formatNl(app.applied_at)}</span>
                      {app.current_stage && (
                        <>
                          <span aria-hidden="true">•</span>
                          <span>Fase: {app.current_stage}</span>
                        </>
                      )}
                      {app.withdrawn_at && (
                        <>
                          <span aria-hidden="true">•</span>
                          <span>Teruggetrokken op {formatNl(app.withdrawn_at)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`text-[11px] font-medium ${STATUS_TONE[app.status]}`}
                    >
                      {STATUS_LABEL[app.status]}
                    </Badge>
                    {canWithdraw && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 border-red-200 text-red-700 hover:bg-red-50"
                        onClick={() => setTarget(app)}
                      >
                        <Undo2 className="h-3.5 w-3.5" />
                        Trek terug
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sollicitatie terugtrekken?</DialogTitle>
            <DialogDescription>
              Weet je zeker dat je je sollicitatie voor{" "}
              <span className="font-semibold">{target?.job_title}</span> wilt
              intrekken? Het recruitment-team wordt direct geïnformeerd. Deze actie
              kan niet ongedaan gemaakt worden.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setTarget(null)} disabled={withdraw.isPending}>
              Annuleren
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={withdraw.isPending}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {withdraw.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Undo2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Ja, terugtrekken
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function formatNl(iso: string): string {
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
