/**
 * Portal page — klant-facing shortlist-review.
 *
 * Werkstroom:
 *   1. Token uit URL → usePortalAccess() haalt {portal, applications, branding}
 *   2. Permission-aware rendering per kandidaat-kaart
 *   3. Per kandidaat: ✓ Geschikt / ✗ Niet geschikt / ? Twijfel + comment
 *   4. Bulk-feedback bij ≥5 kandidaten via floating action button (mobile) /
 *      header-knop (desktop)
 *   5. View-tracking via intersection-observer in PortalCandidateCard
 *
 * Mobile-strategy: kaart-stack overal (single column). De `sm:` breakpoint
 * (640px) gebruiken we om de header-actie-knoppen + contact-info inline te
 * leggen. FAB toont alleen op <sm.
 */

"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Briefcase,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Loader2,
  CircleSlash,
  ListChecks,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  usePortalAccess,
  usePortalFeedback,
  usePortalLogView,
  type FeedbackAction,
} from "@/hooks/usePortal";
import { PortalCandidateCard } from "@/components/portal/PortalCandidateCard";
import { PortalResumeViewer } from "@/components/portal/PortalResumeViewer";
import {
  PortalErrorScreen,
  PortalSkeleton,
} from "@/components/portal/PortalStateScreens";

export default function PortalAccessPage() {
  const params = useParams();
  const token = (params?.token as string) ?? "";
  const { toast } = useToast();

  const { data, isLoading, isError, refetch, error } = usePortalAccess(token);
  const submitFeedback = usePortalFeedback(token);
  const logView = usePortalLogView(token);

  const [reviewerName, setReviewerName] = useState("");
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [resumeState, setResumeState] = useState<{
    open: boolean;
    url: string | null;
    name: string;
  }>({ open: false, url: null, name: "" });
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPending, setBulkPending] = useState<FeedbackAction | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const counts = useMemo(() => {
    if (!data) return { total: 0, pending: 0, decided: 0 };
    const total = data.applications.length;
    const decided = data.applications.filter((a) => a.client_feedback).length;
    return { total, pending: total - decided, decided };
  }, [data]);

  if (isLoading) return <PortalSkeleton />;

  if (isError || !data) {
    // Onderscheid: 404-achtige statuscodes → "ongeldig", anders → "netwerk".
    const errObj = error as unknown;
    const status =
      typeof errObj === "object" &&
      errObj !== null &&
      "response" in (errObj as Record<string, unknown>)
        ? (errObj as { response?: { status?: number } }).response?.status
        : undefined;
    const variant = status === 404 || status === 410 ? "invalid" : "network";
    return <PortalErrorScreen variant={variant} onRetry={() => refetch()} />;
  }

  const { permissions, applications, job, recruiter, client_name } = data;

  // Geen view_candidates? → toon vergrendelde state.
  if (!permissions.view_candidates) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-center sm:px-6">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900">
          <CircleSlash className="h-7 w-7 text-zinc-500" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-zinc-900 dark:text-zinc-100">
          Geen toegang tot kandidaten
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Deze portal-link heeft geen toestemming om kandidaten te bekijken. Neem
          contact op met je recruiter voor toegang.
        </p>
      </div>
    );
  }

  const handleFeedback = async (
    applicationId: string,
    action: FeedbackAction,
    comment?: string
  ) => {
    setSubmittingId(applicationId);
    try {
      await submitFeedback.mutateAsync({
        application_id: applicationId,
        action,
        comment,
        client_name: reviewerName || client_name || undefined,
      });
      toast({
        title:
          action === "approve"
            ? "Geschikt verstuurd"
            : action === "reject"
            ? "Niet geschikt verstuurd"
            : action === "doubt"
            ? "Twijfel genoteerd"
            : "Reactie verstuurd",
        description: "De recruiter is op de hoogte gebracht.",
      });
    } catch (err) {
      const errObj = err as unknown;
      const status =
        typeof errObj === "object" &&
        errObj !== null &&
        "response" in (errObj as Record<string, unknown>)
          ? (errObj as { response?: { status?: number } }).response?.status
          : undefined;
      toast({
        title: "Niet gelukt",
        description:
          status === 403
            ? "Je hebt geen toestemming voor deze actie."
            : "Probeer het opnieuw — kon de actie niet versturen.",
        variant: "destructive",
      });
      throw err;
    } finally {
      setSubmittingId(null);
    }
  };

  const handleBulk = async (action: FeedbackAction) => {
    setBulkPending(action);
    try {
      const targets = applications.filter((a) => !a.client_feedback);
      // Sequentieel: backend heeft mogelijk rate-limiting + we willen de
      // optimistic-updates één-voor-één in de cache zetten.
      for (const app of targets) {
        // eslint-disable-next-line no-await-in-loop
        await submitFeedback.mutateAsync({
          application_id: app.id,
          action,
          client_name: reviewerName || client_name || undefined,
        });
      }
      toast({
        title: "Bulk-feedback verstuurd",
        description: `${targets.length} kandidaten gemarkeerd.`,
      });
      setBulkOpen(false);
    } catch {
      toast({
        title: "Bulk-actie mislukte gedeeltelijk",
        description: "Niet alle kandidaten konden worden verwerkt.",
        variant: "destructive",
      });
    } finally {
      setBulkPending(null);
    }
  };

  const canBulk = permissions.accept_reject && counts.pending >= 5;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Hero */}
      <section className="mb-6 sm:mb-8">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Recruitment shortlist
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-3xl">
              {job.title}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Welkom{client_name ? `, ${client_name}` : ""} — geef ons feedback op
              deze shortlist
              {recruiter ? (
                <>
                  {" "}
                  (verstuurd door{" "}
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {recruiter.name}
                  </span>
                  ).
                </>
              ) : (
                "."
              )}
            </p>
          </div>
          {canBulk && (
            <Button
              onClick={() => setBulkOpen(true)}
              variant="outline"
              size="sm"
              className="hidden sm:inline-flex"
            >
              <ListChecks className="mr-1.5 h-3.5 w-3.5" />
              Bulk-feedback
            </Button>
          )}
        </div>

        {/* Stats */}
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
          <StatPill label="Kandidaten" value={counts.total} />
          <StatPill label="Beoordeeld" value={counts.decided} tone="emerald" />
          <StatPill label="Open" value={counts.pending} tone="amber" />
        </div>
      </section>

      {/* Job description (collapsible) */}
      {job.description && (
        <Card className="mb-6 border-0 shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <button
              type="button"
              onClick={() => setDescriptionOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    background:
                      "linear-gradient(135deg, var(--brand-primary), var(--brand-accent))",
                  }}
                >
                  <Briefcase className="h-4 w-4 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Vacaturebeschrijving
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {descriptionOpen
                      ? "Inklappen"
                      : "Bekijk de volledige beschrijving"}
                  </p>
                </div>
              </div>
              {descriptionOpen ? (
                <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
            </button>
            {descriptionOpen && (
              <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                <p className="whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">
                  {job.description}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Reviewer-name input */}
      {(permissions.comment || permissions.accept_reject) && (
        <Card
          className="mb-6 border-0 shadow-sm"
          style={{
            background:
              "linear-gradient(135deg, color-mix(in srgb, var(--brand-primary) 8%, transparent), color-mix(in srgb, var(--brand-accent) 8%, transparent))",
          }}
        >
          <CardContent className="p-4">
            <Label
              htmlFor="reviewer-name"
              className="text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Jouw naam (optioneel)
            </Label>
            <Input
              id="reviewer-name"
              placeholder="Hoe mogen we je noemen?"
              value={reviewerName}
              onChange={(e) => setReviewerName(e.target.value)}
              className="mt-1.5 bg-white dark:bg-zinc-900"
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Wordt getoond bij je reacties zodat de recruiter weet van wie ze komen.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Candidate list */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {applications.length}{" "}
          {applications.length === 1 ? "kandidaat" : "kandidaten"}
        </h2>
        {applications.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Er zijn nog geen kandidaten gedeeld voor deze vacature.
            </CardContent>
          </Card>
        ) : (
          applications.map((app, i) => (
            <PortalCandidateCard
              key={app.id}
              index={i}
              application={app}
              permissions={permissions}
              onView={logView}
              onFeedback={handleFeedback}
              onOpenResume={(url, name) =>
                setResumeState({ open: true, url, name })
              }
              isSubmitting={submittingId === app.id}
            />
          ))
        )}
      </section>

      {/* Floating Action Button — alleen op mobile, alleen als bulk mogelijk is */}
      {canBulk && (
        <Button
          onClick={() => setBulkOpen(true)}
          className="fixed bottom-5 right-5 z-30 inline-flex h-12 items-center gap-2 rounded-full px-5 text-sm font-semibold text-white shadow-lg sm:hidden"
          style={{
            background:
              "linear-gradient(135deg, var(--brand-primary), var(--brand-accent))",
          }}
        >
          <ListChecks className="h-4 w-4" />
          Bulk-feedback
        </Button>
      )}

      {/* PDF-viewer modal */}
      <PortalResumeViewer
        open={resumeState.open}
        onOpenChange={(o) =>
          setResumeState((s) => ({ ...s, open: o, url: o ? s.url : null }))
        }
        resumeUrl={resumeState.url}
        candidateName={resumeState.name}
        canDownload={permissions.download_cv}
      />

      {/* Bulk-feedback dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Markeer alle openstaande kandidaten</DialogTitle>
            <DialogDescription>
              Pas dezelfde feedback toe op alle {counts.pending} kandidaten zonder
              beoordeling. Dit kan niet ongedaan worden gemaakt.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button
              onClick={() => handleBulk("approve")}
              disabled={!!bulkPending}
              className="border-0 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {bulkPending === "approve" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              )}
              Geschikt
            </Button>
            <Button
              onClick={() => handleBulk("doubt")}
              disabled={!!bulkPending}
              variant="outline"
              className="border-amber-200 text-amber-700 hover:bg-amber-50"
            >
              {bulkPending === "doubt" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <HelpCircle className="mr-1.5 h-3.5 w-3.5" />
              )}
              Twijfel
            </Button>
            <Button
              onClick={() => handleBulk("reject")}
              disabled={!!bulkPending}
              variant="outline"
              className="border-red-200 text-red-600 hover:bg-red-50"
            >
              {bulkPending === "reject" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <XCircle className="mr-1.5 h-3.5 w-3.5" />
              )}
              Niet geschikt
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkOpen(false)}>
              Annuleren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber";
}) {
  const cls =
    tone === "emerald"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
      : tone === "amber"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${cls}`}>
      <span className="font-semibold">{value}</span>
      <span>{label}</span>
    </span>
  );
}
