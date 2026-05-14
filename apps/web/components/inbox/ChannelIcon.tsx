"use client";

/**
 * Sprint Q4.6 — Channel-icon mapper. Each channel has its own colour identity
 * so users can scan the inbox by colour and recognise channels instantly.
 */

import {
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  Linkedin,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChannelType } from "@/lib/types/inbox";

interface ChannelTheme {
  icon: LucideIcon;
  label: string;
  /** Tailwind text colour for icon-only display. */
  fg: string;
  /** Tailwind bg colour (light) for chips/pills. */
  bg: string;
  /** Tailwind ring/border colour. */
  ring: string;
  /** Tailwind solid dot bg-colour. */
  dot: string;
}

export const CHANNEL_THEME: Record<ChannelType, ChannelTheme> = {
  email: {
    icon: Mail,
    label: "E-mail",
    fg: "text-zinc-600 dark:text-zinc-300",
    bg: "bg-zinc-100 dark:bg-zinc-800/60",
    ring: "ring-zinc-300 dark:ring-zinc-700",
    dot: "bg-zinc-500",
  },
  whatsapp: {
    icon: MessageCircle,
    label: "WhatsApp",
    fg: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    ring: "ring-emerald-200 dark:ring-emerald-900/50",
    dot: "bg-emerald-500",
  },
  sms: {
    icon: MessageSquare,
    label: "SMS",
    fg: "text-cyan-600 dark:text-cyan-400",
    bg: "bg-cyan-50 dark:bg-cyan-950/40",
    ring: "ring-cyan-200 dark:ring-cyan-900/50",
    dot: "bg-cyan-500",
  },
  voice: {
    icon: Phone,
    label: "Voice",
    fg: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-50 dark:bg-purple-950/40",
    ring: "ring-purple-200 dark:ring-purple-900/50",
    dot: "bg-purple-500",
  },
  linkedin_inmail: {
    icon: Linkedin,
    label: "LinkedIn InMail",
    fg: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950/40",
    ring: "ring-blue-200 dark:ring-blue-900/50",
    dot: "bg-blue-500",
  },
  linkedin_connection: {
    icon: Linkedin,
    label: "LinkedIn",
    fg: "text-sky-600 dark:text-sky-400",
    bg: "bg-sky-50 dark:bg-sky-950/40",
    ring: "ring-sky-200 dark:ring-sky-900/50",
    dot: "bg-sky-500",
  },
};

interface ChannelIconProps {
  channel: ChannelType;
  className?: string;
  variant?: "icon" | "chip" | "dot";
}

export function ChannelIcon({
  channel,
  className,
  variant = "icon",
}: ChannelIconProps) {
  const theme = CHANNEL_THEME[channel];
  const Icon = theme.icon;

  if (variant === "dot") {
    return (
      <span
        className={cn(
          "inline-block h-2 w-2 rounded-full",
          theme.dot,
          className
        )}
        title={theme.label}
        aria-label={theme.label}
      />
    );
  }

  if (variant === "chip") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
          theme.bg,
          theme.fg,
          theme.ring,
          className
        )}
      >
        <Icon className="h-3 w-3" />
        {theme.label}
      </span>
    );
  }

  return (
    <Icon
      className={cn("h-4 w-4", theme.fg, className)}
      aria-label={theme.label}
    />
  );
}
