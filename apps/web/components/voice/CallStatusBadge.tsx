"use client";

/**
 * Sprint Q4.6 — Colour-coded badge for voice-call status.
 */

import {
  CheckCircle2,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  Voicemail,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CallStatus } from "@/lib/types/voice";

export const CALL_STATUS_PILL: Record<
  CallStatus,
  { label: string; className: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  queued: {
    label: "In de wacht",
    className:
      "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
    Icon: Phone,
  },
  ringing: {
    label: "Belt over",
    className:
      "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/50 animate-pulse",
    Icon: Phone,
  },
  in_progress: {
    label: "In gesprek",
    className:
      "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50 animate-pulse",
    Icon: PhoneIncoming,
  },
  completed: {
    label: "Afgerond",
    className:
      "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:ring-emerald-900/40",
    Icon: CheckCircle2,
  },
  busy: {
    label: "Bezet",
    className:
      "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:ring-orange-900/40",
    Icon: PhoneOff,
  },
  no_answer: {
    label: "Niet opgenomen",
    className:
      "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:ring-orange-900/40",
    Icon: PhoneMissed,
  },
  failed: {
    label: "Mislukt",
    className:
      "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/30 dark:text-red-400 dark:ring-red-900/40",
    Icon: XCircle,
  },
  canceled: {
    label: "Geannuleerd",
    className:
      "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
    Icon: XCircle,
  },
  voicemail: {
    label: "Voicemail",
    className:
      "bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-950/30 dark:text-purple-400 dark:ring-purple-900/40",
    Icon: Voicemail,
  },
};

export function CallStatusBadge({
  status,
  className,
}: {
  status: CallStatus;
  className?: string;
}) {
  const pill = CALL_STATUS_PILL[status];
  const Icon = pill.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        pill.className,
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {pill.label}
    </span>
  );
}

export function formatCallDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}
