/**
 * Portal page — klant-facing shortlist-review (publiek, token-based).
 *
 * Werkstroom:
 *   1. Token uit URL → usePortalAccess() haalt {job, applications, branding}
 *   2. Permission-aware rendering per kandidaat-kaart (PII-vrij contract:
 *      geen e-mail/telefoon/salaris — zie serializePortalApplication in de API)
 *   3. Per kandidaat: ✓ Geschikt / ✗ Niet geschikt / ? Twijfel + comment
 *   4. Algemene opmerking over de hele shortlist (zonder kandidaat)
 *   5. Bulk-feedback bij ≥5 kandidaten via floating action button (mobile) /
 *      header-knop (desktop)
 *   6. View-tracking via intersection-observer in PortalCandidateCard
 *
 * Teksten via i18n (portalPublic-namespace, NL + EN). Nette meldingen per
 * fout-status: 404 ongeldig, 410 verlopen, 429 rate-limited, anders netwerk.
 */

"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslation } from "react-i18next";
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
  MessagesSquare,
  Send,
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
import { formatDate } from "@/lib/utils";
import { PortalCandidateCard } from "@/components/portal/PortalCandidateCard";
import { PortalResumeViewer } from "@/components/portal/PortalResumeViewer";
import {
  PortalErrorScreen,
  PortalSkeleton,
  portalErrorVariantFromStatus,
} from "@/components/portal/PortalStateScreens";

function statusFromError(err: unknown): number | undefined {
  return typeof err === "object" &&
    err !== null &&
    "response" in (err as Record<string, unknown>)
    ? (err as { response?: { status?: number } }).response?.status
    : undefined;
}

export default function PortalAccessPage() {
  const params = useParams();
  const token = (params?.token as string) ?? "";
  const { t } = useTranslation("portalPublic");
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
  const [generalComment, setGeneralComment] = useState("");
  const [generalSubmitting, setGeneralSubmitting] = useState(false);

  const counts = useMemo(() => {
    if (!data) return { total: 0, pending: 0, decided: 0 };
    const total = data.applications.length;
    const decided = data.applications.filter((a) => a.client_feedback).length;
    return { total, pending: total - decided, decided };
  }, [data]);

  if (isLoading) return <PortalSkeleton />;

  if (isError || !data) {
    // 404 → ongeldig/ingetrokken, 410 → verlopen, 429 → rate-limit, rest → netwerk.
    const variant = portalErrorVariantFromStatus(statusFromError(error));
    return <PortalErrorScreen variant={variant} onRetry={() => refetch()} />;
  }

  const { permissions, applications, general_comments, job, recruiter, client_name } =
    data;

  // Geen view_candidates? → toon vergrendelde state.
  if (!permissions.view_candidates) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-center sm:px-6">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900">
          <CircleSlash className="h-7 w-7 text-zinc-500" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-zinc-900 dark:text-zinc-100">
          {t("page.noAccessTitle")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("page.noAccessBody")}</p>
      </div>
    );
  }

  const feedbackFailToast = (err: unknown) => {
    toast({
      title: t("page.toasts.failTitle"),
      description:
        statusFromError(err) === 403
          ? t("page.toasts.failForbidden")
          : t("page.toasts.failGeneric"),
      variant: "destructive",
    });
  };

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
            ? t("page.toasts.approveSent")
            : action === "reject"
            ? t("page.toasts.rejectSent")
            : action === "doubt"
            ? t("page.toasts.doubtSent")
            : t("page.toasts.commentSent"),
        description: t("page.toasts.feedbackDescription"),
      });
    } catch (err) {
      feedbackFailToast(err);
      throw err;
    } finally {
      setSubmittingId(null);
    }
  };

  /** Algemene opmerking over de hele shortlist (geen application_id). */
  const handleGeneralComment = async () => {
    const body = generalComment.trim();
    if (!body) return;
    setGeneralSubmitting(true);
    try {
      await submitFeedback.mutateAsync({
        action: "comment",
        comment: body,
        client_name: reviewerName || client_name || undefined,
      });
      setGeneralComment("");
      toast({
        title: t("page.toasts.generalCommentSent"),
        description: t("page.toasts.feedbackDescription"),
      });
    } catch (err) {
      feedbackFailToast(err);
    } finally {
      setGeneralSubmitting(false);
    }
  };

  const handleBulk = async (action: FeedbackAction) => {
    setBulkPending(action);
    try {
      const targets = applications.filter((a) => !a.client_feedback);
      // Sequentieel: backend heeft rate-limiting + we willen de
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
        title: t("page.toasts.bulkDoneTitle"),
        description: t("page.toasts.bulkDoneDescription", { count: targets.length }),
      });
      setBulkOpen(false);
    } catch {
      toast({
        title: t("page.toasts.bulkFailTitle"),
        description: t("page.toasts.bulkFailDescription"),
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
              {t("page.eyebrow")}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-3xl">
              {job.title}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {client_name
                ? t("page.greetingNamed", { name: client_name })
                : t("page.greeting")}
              {recruiter && <> {t("page.sentBy", { name: recruiter.name })}</>}
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
              {t("page.bulkButton")}
            </Button>
          )}
        </div>

        {/* Stats */}
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
          <StatPill label={t("page.stats.total")} value={counts.total} />
          <StatPill
            label={t("page.stats.decided")}
            value={counts.decided}
            tone="emerald"
          />
          <StatPill label={t("page.stats.pending")} value={counts.pending} tone="amber" />
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
                    {t("page.jobDescriptionTitle")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {descriptionOpen
                      ? t("page.jobDescriptionCollapse")
                      : t("page.jobDescriptionExpand")}
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
              {t("page.reviewerNameLabel")}
            </Label>
            <Input
              id="reviewer-name"
              placeholder={t("page.reviewerNamePlaceholder")}
              value={reviewerName}
              onChange={(e) => setReviewerName(e.target.value)}
              className="mt-1.5 bg-white dark:bg-zinc-900"
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {t("page.reviewerNameHelp")}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Candidate list */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {t("page.candidateCount", { count: applications.length })}
        </h2>
        {applications.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              {t("page.emptyShortlist")}
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

      {/* Algemene opmerkingen over de hele shortlist */}
      {permissions.comment && (
        <section className="mt-8">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <MessagesSquare className="h-4 w-4 text-zinc-500" />
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {t("page.generalComments.title")}
                </h2>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("page.generalComments.description")}
              </p>

              {general_comments.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {general_comments.map((c) => (
                    <li
                      key={c.id}
                      className="rounded-md bg-zinc-50 p-2.5 text-xs dark:bg-zinc-900/50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-zinc-800 dark:text-zinc-200">
                          {c.author ?? t("page.generalComments.anonymous")}
                        </span>
                        <span className="text-[10px] text-zinc-400">
                          {formatDate(c.created_at)}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-line text-zinc-700 dark:text-zinc-300">
                        {c.body}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs italic text-muted-foreground">
                  {t("page.generalComments.empty")}
                </p>
              )}

              <div className="mt-3 space-y-2">
                <textarea
                  value={generalComment}
                  onChange={(e) => setGeneralComment(e.target.value)}
                  placeholder={t("page.generalComments.placeholder")}
                  rows={3}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                />
                <Button
                  size="sm"
                  onClick={handleGeneralComment}
                  disabled={!generalComment.trim() || generalSubmitting}
                  className="border-0 text-white"
                  style={{ backgroundColor: "var(--brand-primary)" }}
                >
                  {generalSubmitting ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {t("page.generalComments.submit")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

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
          {t("page.bulkButton")}
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
            <DialogTitle>{t("page.bulkDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("page.bulkDialog.description", { count: counts.pending })}
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
              {t("page.bulkDialog.approve")}
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
              {t("page.bulkDialog.doubt")}
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
              {t("page.bulkDialog.reject")}
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkOpen(false)}>
              {t("page.bulkDialog.cancel")}
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
