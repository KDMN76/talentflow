"use client";

/**
 * Sprint Q4.6 — Channel-specific message bubble for the unified-inbox timeline.
 *
 * Each channel gets its own colour palette so the timeline reads visually like
 * Slack/iMessage rather than a flat list. Outbound messages align right, inbound
 * left (chat-style).
 */

import { useState } from "react";
import { ChevronDown, ChevronUp, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChannelIcon, CHANNEL_THEME } from "@/components/inbox/ChannelIcon";
import type { TimelineEvent } from "@/lib/types/inbox";

interface ChannelBubbleProps {
  event: TimelineEvent;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return "Vandaag";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Gisteren";
  return d.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export function ChannelBubble({ event }: ChannelBubbleProps) {
  const theme = CHANNEL_THEME[event.channel];
  const isOutbound = event.direction === "outbound";
  const [expanded, setExpanded] = useState(false);
  const isLong = event.body.length > 280;
  const showFull = expanded || !isLong;
  const displayBody = showFull ? event.body : event.body.slice(0, 280) + "…";

  const isVoice = event.channel === "voice";
  const audioAttachment = event.attachments.find((a) => a.mime.startsWith("audio/"));
  const otherAttachments = event.attachments.filter(
    (a) => !a.mime.startsWith("audio/")
  );

  return (
    <div
      className={cn(
        "flex w-full gap-3",
        isOutbound ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar / channel marker */}
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset",
          theme.bg,
          theme.ring
        )}
      >
        <ChannelIcon channel={event.channel} className="h-4 w-4" />
      </div>

      {/* Bubble */}
      <div
        className={cn(
          "flex max-w-[min(85%,640px)] flex-col",
          isOutbound ? "items-end" : "items-start"
        )}
      >
        <div className="mb-1 flex items-center gap-2 text-[11px]">
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">
            {event.sender_name}
          </span>
          <ChannelIcon channel={event.channel} variant="chip" />
          <span className="text-muted-foreground">
            {formatDate(event.timestamp)} · {formatTime(event.timestamp)}
          </span>
        </div>

        <div
          className={cn(
            "rounded-2xl border px-4 py-2.5 text-sm leading-relaxed shadow-sm",
            theme.bg,
            "border-transparent",
            isOutbound
              ? "rounded-tr-md text-zinc-900 dark:text-zinc-100"
              : "rounded-tl-md text-zinc-900 dark:text-zinc-100"
          )}
        >
          {isVoice && audioAttachment ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-purple-700 dark:text-purple-300">
                {event.preview}
              </p>
              <audio
                controls
                preload="metadata"
                className="w-full max-w-[420px]"
                src={audioAttachment.url}
              >
                Audio wordt niet ondersteund.
              </audio>
              {event.body && event.body !== event.preview && (
                <p className="whitespace-pre-wrap text-xs text-zinc-700 dark:text-zinc-300">
                  {event.body}
                </p>
              )}
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words">{displayBody}</p>
          )}

          {isLong && !isVoice && (
            <button
              type="button"
              onClick={() => setExpanded((x) => !x)}
              className="mt-1.5 inline-flex items-center gap-0.5 text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {expanded ? (
                <>
                  Minder <ChevronUp className="h-3 w-3" />
                </>
              ) : (
                <>
                  Meer <ChevronDown className="h-3 w-3" />
                </>
              )}
            </button>
          )}

          {otherAttachments.length > 0 && (
            <div className="mt-2 space-y-1">
              {otherAttachments.map((a, i) => (
                <a
                  key={i}
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-white/70 px-2 py-1 text-[11px] font-medium text-zinc-700 ring-1 ring-zinc-200 hover:bg-white dark:bg-zinc-800/70 dark:text-zinc-200 dark:ring-zinc-700"
                >
                  <Paperclip className="h-3 w-3" />
                  {a.name ?? a.url.split("/").pop() ?? "Bijlage"}
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Status footer */}
        {(event.metadata?.status === "failed" ||
          typeof event.metadata?.error === "string") && (
          <span className="mt-1 text-[10px] font-medium text-red-600 dark:text-red-400">
            Mislukt
            {typeof event.metadata?.error === "string"
              ? ` · ${event.metadata.error}`
              : ""}
          </span>
        )}
      </div>
    </div>
  );
}
