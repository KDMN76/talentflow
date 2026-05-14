"use client";

import {
  Bot,
  Brain,
  Calendar,
  CheckCircle2,
  Clock,
  Linkedin,
  Mail,
  MessageCircle,
  Phone,
  Search,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { ComponentType } from "react";
import type {
  AgentRunStatus,
  FindingStatus,
} from "@/lib/types/sourcing";
import type {
  OutreachChannel,
  OutreachStatus,
  ReplyCategory,
  SignalType,
} from "@/lib/types/outreach";

/**
 * Sprint Q4.5 — Shared visual helpers (status pills, channel icons, score
 * tiers) for the agentic-sourcing + outreach UI.
 */

export const RUN_STATUS_PILL: Record<
  AgentRunStatus,
  { label: string; className: string }
> = {
  queued: {
    label: "In wachtrij",
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-0",
  },
  running: {
    label: "Bezig",
    className:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border-0 animate-pulse",
  },
  review_required: {
    label: "Review nodig",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-0",
  },
  completed: {
    label: "Voltooid",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-0",
  },
  failed: {
    label: "Mislukt",
    className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-0",
  },
  cancelled: {
    label: "Geannuleerd",
    className:
      "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-0",
  },
};

export const FINDING_STATUS_PILL: Record<
  FindingStatus,
  { label: string; className: string }
> = {
  pending_review: {
    label: "Te beoordelen",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-0",
  },
  approved: {
    label: "Goedgekeurd",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-0",
  },
  rejected: {
    label: "Afgewezen",
    className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-0",
  },
  contacted: {
    label: "Benaderd",
    className:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border-0",
  },
  dismissed: {
    label: "Genegeerd",
    className:
      "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-0",
  },
};

export const OUTREACH_STATUS_PILL: Record<
  OutreachStatus,
  { label: string; className: string }
> = {
  drafted: {
    label: "Concept",
    className:
      "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-0",
  },
  pending_approval: {
    label: "Wacht op goedkeuring",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-0",
  },
  approved: {
    label: "Goedgekeurd",
    className:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border-0",
  },
  sending: {
    label: "Verzenden",
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-0",
  },
  sent: {
    label: "Verstuurd",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-0",
  },
  failed: {
    label: "Mislukt",
    className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-0",
  },
  rejected_by_recruiter: {
    label: "Afgewezen door recruiter",
    className:
      "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-0",
  },
};

export const REPLY_CATEGORY_PILL: Record<
  ReplyCategory,
  { label: string; className: string }
> = {
  interested: {
    label: "Geïnteresseerd",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-0",
  },
  not_now: {
    label: "Niet nu",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-0",
  },
  not_interested: {
    label: "Niet geïnteresseerd",
    className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-0",
  },
  out_of_office: {
    label: "Out of office",
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-0",
  },
  unsubscribe: {
    label: "Uitgeschreven",
    className:
      "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-0",
  },
  spam: {
    label: "Spam",
    className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-0",
  },
  question: {
    label: "Vraag",
    className:
      "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border-0",
  },
  unknown: {
    label: "Onbekend",
    className:
      "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-0",
  },
};

export const SIGNAL_TYPE_LABEL: Record<SignalType, string> = {
  job_change: "Nieuwe baan",
  title_change: "Titel veranderd",
  company_growth: "Bedrijfsgroei",
  funding_round: "Financiering",
  linkedin_post: "LinkedIn post",
  open_to_work_flag: "Open voor werk",
};

export const CHANNEL_ICON: Record<
  OutreachChannel,
  ComponentType<{ className?: string }>
> = {
  linkedin_inmail: Linkedin,
  linkedin_connection: Linkedin,
  email: Mail,
  sms: Phone,
  whatsapp: MessageCircle,
};

export const CHANNEL_LABEL: Record<OutreachChannel, string> = {
  linkedin_inmail: "LinkedIn InMail",
  linkedin_connection: "LinkedIn connectie",
  email: "E-mail",
  sms: "SMS",
  whatsapp: "WhatsApp",
};

export function matchScoreColor(score: number): {
  text: string;
  bg: string;
  ring: string;
} {
  if (score >= 85) {
    return {
      text: "text-emerald-700 dark:text-emerald-300",
      bg: "bg-emerald-100 dark:bg-emerald-950/40",
      ring: "stroke-emerald-500",
    };
  }
  if (score >= 70) {
    return {
      text: "text-indigo-700 dark:text-indigo-300",
      bg: "bg-indigo-100 dark:bg-indigo-950/40",
      ring: "stroke-indigo-500",
    };
  }
  if (score >= 55) {
    return {
      text: "text-amber-700 dark:text-amber-300",
      bg: "bg-amber-100 dark:bg-amber-950/40",
      ring: "stroke-amber-500",
    };
  }
  return {
    text: "text-zinc-600 dark:text-zinc-400",
    bg: "bg-zinc-100 dark:bg-zinc-800",
    ring: "stroke-zinc-400",
  };
}

export function MatchScoreGauge({ score }: { score: number }) {
  const c = matchScoreColor(score);
  const pct = Math.max(0, Math.min(100, score));
  // SVG circular progress.
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  return (
    <div className="relative inline-flex h-12 w-12 items-center justify-center">
      <svg className="h-12 w-12 -rotate-90" viewBox="0 0 44 44">
        <circle
          cx="22"
          cy="22"
          r={radius}
          stroke="currentColor"
          strokeWidth="4"
          fill="none"
          className="text-zinc-200 dark:text-zinc-700"
        />
        <circle
          cx="22"
          cy="22"
          r={radius}
          strokeWidth="4"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={c.ring}
        />
      </svg>
      <span className={`absolute text-xs font-bold ${c.text}`}>{score}</span>
    </div>
  );
}

export function reasoningStepIcon(step: string) {
  if (step === "plan")
    return <Brain className="h-3.5 w-3.5 text-indigo-500" />;
  if (step.startsWith("search"))
    return <Search className="h-3.5 w-3.5 text-blue-500" />;
  if (step === "score")
    return <Sparkles className="h-3.5 w-3.5 text-amber-500" />;
  if (step === "expand")
    return <Bot className="h-3.5 w-3.5 text-purple-500" />;
  if (step === "review_required" || step === "completed")
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (step === "error" || step === "failed")
    return <XCircle className="h-3.5 w-3.5 text-red-500" />;
  if (step === "cancelled")
    return <XCircle className="h-3.5 w-3.5 text-zinc-400" />;
  return <Calendar className="h-3.5 w-3.5 text-muted-foreground" />;
}

export function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function formatRelativeNL(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (Math.abs(diffMin) < 1) return "zojuist";
  if (Math.abs(diffMin) < 60)
    return diffMin > 0 ? `${diffMin} min geleden` : `over ${-diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (Math.abs(diffH) < 24)
    return diffH > 0 ? `${diffH} u geleden` : `over ${-diffH} u`;
  const diffD = Math.round(diffH / 24);
  if (Math.abs(diffD) < 14)
    return diffD > 0 ? `${diffD} d geleden` : `over ${-diffD} d`;
  return d.toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTimeNL(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("nl-NL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const RUN_STATUS_ICON: Record<
  AgentRunStatus,
  ComponentType<{ className?: string }>
> = {
  queued: Clock,
  running: Bot,
  review_required: CheckCircle2,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: XCircle,
};
