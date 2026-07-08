/**
 * PortalCandidateCard — kandidaat-kaart in het klantportaal.
 *
 * PII-beleid: de publieke portal-API levert bewust GEEN e-mail, telefoon of
 * salaris (zie serializePortalApplication in apps/api). Deze kaart toont dus
 * alleen naam, skills, matchscore en cv-samenvatting.
 *
 * Permission-aware rendering:
 *   - view_ai_scores        → AI-score badge tonen
 *   - view_contact_info     → echte naam tonen (anders "Kandidaat #X")
 *   - view_pipeline_history → pipeline-stage badge + timeline
 *   - view_resumes          → cv-samenvatting + "CV bekijken"-knop
 *   - download_cv           → "Downloaden"-knop in CV-modal
 *   - accept_reject         → ✓ Geschikt / ✗ Niet geschikt / ? Twijfel knoppen
 *   - comment               → comment-thread + textarea
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  XCircle,
  HelpCircle,
  MessageSquare,
  FileText,
  Loader2,
  Send,
  History,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn, formatDate, getInitials } from "@/lib/utils";
import type {
  FeedbackAction,
  PortalApplication,
  PortalPermissions,
} from "@/hooks/usePortal";

interface PortalCandidateCardProps {
  index: number;
  application: PortalApplication;
  permissions: PortalPermissions;
  onView: (candidateId: string) => void;
  onFeedback: (
    applicationId: string,
    action: FeedbackAction,
    comment?: string
  ) => Promise<void>;
  onOpenResume: (resumeUrl: string, candidateName: string) => void;
  isSubmitting: boolean;
}

export function PortalCandidateCard({
  index,
  application,
  permissions,
  onView,
  onFeedback,
  onOpenResume,
  isSubmitting,
}: PortalCandidateCardProps) {
  const { t } = useTranslation("portalPublic");
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<FeedbackAction | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // ── Intersection observer: log-view zodra kaart ≥30% in beeld is ──────────
  useEffect(() => {
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.3) {
            onView(application.candidate_id || application.id);
          }
        }
      },
      { threshold: [0.3] }
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [application.candidate_id, application.id, onView]);

  const showAiScore =
    permissions.view_ai_scores && typeof application.ai_score === "number";
  const displayName = permissions.view_contact_info
    ? application.candidate_name
    : t("card.anonymousCandidate", { index: index + 1 });

  const given = application.client_feedback;

  const handleAction = async (action: FeedbackAction, comment?: string) => {
    setPendingAction(action);
    try {
      await onFeedback(application.id, action, comment);
      if (action === "comment") {
        setCommentOpen(false);
        setCommentText("");
      }
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <Card
      ref={cardRef as unknown as React.Ref<HTMLDivElement>}
      className="border-0 shadow-sm transition-shadow hover:shadow-md"
      data-candidate-id={application.id}
    >
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {/* Avatar */}
          <Avatar className="h-12 w-12 shrink-0">
            <AvatarFallback
              className="font-semibold text-white"
              style={{
                background:
                  "linear-gradient(135deg, var(--brand-primary), var(--brand-accent))",
              }}
            >
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1 space-y-2">
            {/* Header row */}
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                {displayName}
              </h3>
              {showAiScore && (
                <AiScoreBadge score={application.ai_score as number} />
              )}
              {permissions.view_pipeline_history && application.stage_name && (
                <Badge
                  variant="secondary"
                  className="border-0 bg-purple-100 px-1.5 py-0 text-[10px] text-purple-700 dark:bg-purple-950/50 dark:text-purple-400"
                >
                  {application.stage_name}
                </Badge>
              )}
            </div>

            {/* Meta — bewust géén e-mail/telefoon: PII blijft buiten het portaal. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {application.applied_at && (
                <span>
                  {t("card.appliedOn", { date: formatDate(application.applied_at) })}
                </span>
              )}
              {!permissions.view_contact_info && (
                <span className="italic">{t("card.contactHidden")}</span>
              )}
            </div>

            {/* Skills */}
            {application.skills.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {application.skills.slice(0, 8).map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            )}

            {/* Cv-samenvatting (alleen met view_resumes-permission geleverd) */}
            {application.resume_summary && (
              <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/50">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {t("card.resumeSummaryTitle")}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                  {application.resume_summary}
                </p>
              </div>
            )}

            {/* Pipeline history */}
            {permissions.view_pipeline_history &&
              application.pipeline_history.length > 0 && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setHistoryOpen((o) => !o)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
                  >
                    <History className="h-3 w-3" />
                    {historyOpen
                      ? t("card.historyHide", {
                          count: application.pipeline_history.length,
                        })
                      : t("card.historyShow", {
                          count: application.pipeline_history.length,
                        })}
                    {historyOpen ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                  </button>
                  {historyOpen && (
                    <ol className="ml-4 mt-2 space-y-1 border-l border-zinc-200 pl-3 dark:border-zinc-800">
                      {application.pipeline_history.map((h, i) => (
                        <li key={i} className="text-[11px] text-zinc-600 dark:text-zinc-400">
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">
                            {h.stage_name}
                          </span>{" "}
                          — {formatDate(h.entered_at)}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

            {/* CV button */}
            {permissions.view_resumes && application.resume_url && (
              <div className="pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2.5 text-xs"
                  onClick={() =>
                    onOpenResume(application.resume_url as string, displayName)
                  }
                >
                  <FileText className="mr-1.5 h-3 w-3" />
                  {t("card.viewCv")}
                </Button>
              </div>
            )}

            {/* Action buttons */}
            {given ? (
              <div className="pt-2">
                <FeedbackResultBadge action={given} />
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 pt-2">
                {permissions.accept_reject && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => handleAction("approve")}
                      disabled={isSubmitting || !!pendingAction}
                      className="border-0 bg-emerald-600 text-white hover:bg-emerald-700"
                    >
                      {pendingAction === "approve" ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      {t("card.approve")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAction("reject")}
                      disabled={isSubmitting || !!pendingAction}
                      className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
                    >
                      {pendingAction === "reject" ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <XCircle className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      {t("card.reject")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAction("doubt")}
                      disabled={isSubmitting || !!pendingAction}
                      className="border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-900 dark:text-amber-400 dark:hover:bg-amber-950/30"
                    >
                      {pendingAction === "doubt" ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <HelpCircle className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      {t("card.doubt")}
                    </Button>
                  </>
                )}
                {permissions.comment && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setCommentOpen((o) => !o)}
                  >
                    <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                    {t("card.comment")}
                    {application.comments.length > 0 && (
                      <span className="ml-1 rounded-full bg-zinc-200 px-1.5 text-[10px] font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                        {application.comments.length}
                      </span>
                    )}
                  </Button>
                )}
              </div>
            )}

            {/* Comment thread */}
            {permissions.comment &&
              (commentOpen || application.comments.length > 0) && (
                <div className="mt-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/50">
                  {application.comments.length > 0 && (
                    <ul className="mb-3 space-y-2">
                      {application.comments.map((c) => (
                        <li
                          key={c.id}
                          className="rounded-md bg-white p-2.5 text-xs shadow-sm dark:bg-zinc-900"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-zinc-800 dark:text-zinc-200">
                              {c.author ?? t("card.anonymous")}
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
                  )}
                  {commentOpen && !given && (
                    <div className="space-y-2">
                      <textarea
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder={t("card.commentPlaceholder")}
                        rows={3}
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleAction("comment", commentText)}
                          disabled={!commentText.trim() || pendingAction === "comment"}
                          className="border-0 text-white"
                          style={{
                            backgroundColor: "var(--brand-primary)",
                          }}
                        >
                          {pendingAction === "comment" ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Send className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          {t("card.commentSubmit")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setCommentOpen(false);
                            setCommentText("");
                          }}
                        >
                          {t("card.cancel")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AiScoreBadge({ score }: { score: number }) {
  const { t } = useTranslation("portalPublic");
  const tone =
    score >= 80
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
      : score >= 60
      ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
      : "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold",
        tone
      )}
      title={t("card.aiScoreTitle", { score })}
    >
      {t("card.aiScore", { score })}
    </span>
  );
}

function FeedbackResultBadge({
  action,
}: {
  action: NonNullable<PortalApplication["client_feedback"]>;
}) {
  const { t } = useTranslation("portalPublic");
  const map: Record<
    NonNullable<PortalApplication["client_feedback"]>,
    { labelKey: string; cls: string }
  > = {
    approve: {
      labelKey: "card.sent.approve",
      cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
    },
    reject: {
      labelKey: "card.sent.reject",
      cls: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
    },
    doubt: {
      labelKey: "card.sent.doubt",
      cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
    },
  };
  const { labelKey, cls } = map[action];
  return (
    <Badge variant="outline" className={cn("border-0 px-2 py-0.5 text-[11px]", cls)}>
      {t(labelKey)}
    </Badge>
  );
}
